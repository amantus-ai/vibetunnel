//go:build linux
// +build linux

package session

import (
	"fmt"
	"sync"
	"syscall"
	"time"
	
	"golang.org/x/sys/unix"
)

// epollEventLoop implements EventLoop using epoll (Linux)
type epollEventLoop struct {
	epfd     int
	mu       sync.Mutex
	running  bool
	stopChan chan struct{}
	fdData   map[int]interface{}
}

func newPlatformEventLoop() (EventLoop, error) {
	epfd, err := unix.EpollCreate1(unix.EPOLL_CLOEXEC)
	if err != nil {
		return nil, fmt.Errorf("failed to create epoll: %w", err)
	}
	
	return &epollEventLoop{
		epfd:     epfd,
		stopChan: make(chan struct{}),
		fdData:   make(map[int]interface{}),
	}, nil
}

func (e *epollEventLoop) Add(fd int, events EventType, data interface{}) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	
	e.fdData[fd] = data
	
	var epollEvents uint32
	if events&EventRead != 0 {
		epollEvents |= unix.EPOLLIN | unix.EPOLLPRI
	}
	if events&EventWrite != 0 {
		epollEvents |= unix.EPOLLOUT
	}
	if events&EventError != 0 {
		epollEvents |= unix.EPOLLERR
	}
	if events&EventHup != 0 {
		epollEvents |= unix.EPOLLHUP | unix.EPOLLRDHUP
	}
	
	// Use edge-triggered mode for better performance
	epollEvents |= unix.EPOLLET
	
	event := unix.EpollEvent{
		Events: epollEvents,
		Fd:     int32(fd),
	}
	
	if err := unix.EpollCtl(e.epfd, unix.EPOLL_CTL_ADD, fd, &event); err != nil {
		delete(e.fdData, fd)
		return fmt.Errorf("failed to add fd %d to epoll: %w", fd, err)
	}
	
	// Set non-blocking mode
	if err := unix.SetNonblock(fd, true); err != nil {
		// Not fatal, but log it
		debugLog("[WARN] Failed to set non-blocking mode on fd %d: %v", fd, err)
	}
	
	return nil
}

func (e *epollEventLoop) Remove(fd int) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	
	delete(e.fdData, fd)
	
	if err := unix.EpollCtl(e.epfd, unix.EPOLL_CTL_DEL, fd, nil); err != nil {
		if err != syscall.ENOENT {
			return fmt.Errorf("failed to remove fd %d from epoll: %w", fd, err)
		}
	}
	
	return nil
}

func (e *epollEventLoop) Modify(fd int, events EventType) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	
	var epollEvents uint32
	if events&EventRead != 0 {
		epollEvents |= unix.EPOLLIN | unix.EPOLLPRI
	}
	if events&EventWrite != 0 {
		epollEvents |= unix.EPOLLOUT
	}
	if events&EventError != 0 {
		epollEvents |= unix.EPOLLERR
	}
	if events&EventHup != 0 {
		epollEvents |= unix.EPOLLHUP | unix.EPOLLRDHUP
	}
	
	// Use edge-triggered mode
	epollEvents |= unix.EPOLLET
	
	event := unix.EpollEvent{
		Events: epollEvents,
		Fd:     int32(fd),
	}
	
	if err := unix.EpollCtl(e.epfd, unix.EPOLL_CTL_MOD, fd, &event); err != nil {
		return fmt.Errorf("failed to modify fd %d in epoll: %w", fd, err)
	}
	
	return nil
}

func (e *epollEventLoop) Run(handler EventHandler) error {
	e.mu.Lock()
	if e.running {
		e.mu.Unlock()
		return fmt.Errorf("event loop already running")
	}
	e.running = true
	e.mu.Unlock()
	
	defer func() {
		e.mu.Lock()
		e.running = false
		e.mu.Unlock()
	}()
	
	events := make([]unix.EpollEvent, 128)
	
	for {
		select {
		case <-e.stopChan:
			return nil
		default:
		}
		
		// Wait for events with 1ms timeout for maximum responsiveness
		n, err := unix.EpollWait(e.epfd, events, 1)
		
		if err != nil {
			if err == unix.EINTR {
				continue
			}
			return fmt.Errorf("epoll wait failed: %w", err)
		}
		
		// Process events
		for i := 0; i < n; i++ {
			event := &events[i]
			fd := int(event.Fd)
			
			e.mu.Lock()
			data := e.fdData[fd]
			e.mu.Unlock()
			
			var eventType EventType
			
			// Convert epoll events to our EventType
			if event.Events&(unix.EPOLLIN|unix.EPOLLPRI) != 0 {
				eventType |= EventRead
			}
			if event.Events&unix.EPOLLOUT != 0 {
				eventType |= EventWrite
			}
			if event.Events&(unix.EPOLLHUP|unix.EPOLLRDHUP) != 0 {
				eventType |= EventHup
			}
			if event.Events&unix.EPOLLERR != 0 {
				eventType |= EventError
			}
			
			handler(Event{
				FD:     fd,
				Events: eventType,
				Data:   data,
			})
		}
	}
}

func (e *epollEventLoop) RunOnce(handler EventHandler, timeoutMs int) error {
	events := make([]unix.EpollEvent, 128)
	
	n, err := unix.EpollWait(e.epfd, events, timeoutMs)
	if err != nil {
		if err == unix.EINTR {
			return nil
		}
		return fmt.Errorf("epoll wait failed: %w", err)
	}
	
	// Process events
	for i := 0; i < n; i++ {
		event := &events[i]
		fd := int(event.Fd)
		
		e.mu.Lock()
		data := e.fdData[fd]
		e.mu.Unlock()
		
		var eventType EventType
		
		if event.Events&(unix.EPOLLIN|unix.EPOLLPRI) != 0 {
			eventType |= EventRead
		}
		if event.Events&unix.EPOLLOUT != 0 {
			eventType |= EventWrite
		}
		if event.Events&(unix.EPOLLHUP|unix.EPOLLRDHUP) != 0 {
			eventType |= EventHup
		}
		if event.Events&unix.EPOLLERR != 0 {
			eventType |= EventError
		}
		
		handler(Event{
			FD:     fd,
			Events: eventType,
			Data:   data,
		})
	}
	
	return nil
}

func (e *epollEventLoop) Stop() error {
	close(e.stopChan)
	
	// Create a new stop channel for future runs
	e.stopChan = make(chan struct{})
	
	return nil
}

func (e *epollEventLoop) Close() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	
	if e.running {
		e.Stop()
		// Give it a moment to stop
		time.Sleep(10 * time.Millisecond)
	}
	
	if e.epfd >= 0 {
		err := unix.Close(e.epfd)
		e.epfd = -1
		return err
	}
	
	return nil
}