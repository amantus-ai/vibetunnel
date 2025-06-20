//go:build darwin || freebsd || openbsd || netbsd
// +build darwin freebsd openbsd netbsd

package session

import (
	"fmt"
	"sync"
	"syscall"
	"time"
	
	"golang.org/x/sys/unix"
)

// kqueueEventLoop implements EventLoop using kqueue (macOS/BSD)
type kqueueEventLoop struct {
	kq       int
	mu       sync.Mutex
	running  bool
	stopChan chan struct{}
	fdData   map[int]interface{}
}

func newPlatformEventLoop() (EventLoop, error) {
	kq, err := unix.Kqueue()
	if err != nil {
		return nil, fmt.Errorf("failed to create kqueue: %w", err)
	}
	
	return &kqueueEventLoop{
		kq:       kq,
		stopChan: make(chan struct{}),
		fdData:   make(map[int]interface{}),
	}, nil
}

func (e *kqueueEventLoop) Add(fd int, events EventType, data interface{}) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	
	e.fdData[fd] = data
	
	var kevents []unix.Kevent_t
	
	if events&EventRead != 0 {
		kevents = append(kevents, unix.Kevent_t{
			Ident:  uint64(fd),
			Filter: unix.EVFILT_READ,
			Flags:  unix.EV_ADD | unix.EV_ENABLE,
		})
	}
	
	if events&EventWrite != 0 {
		kevents = append(kevents, unix.Kevent_t{
			Ident:  uint64(fd),
			Filter: unix.EVFILT_WRITE,
			Flags:  unix.EV_ADD | unix.EV_ENABLE,
		})
	}
	
	if len(kevents) > 0 {
		_, err := unix.Kevent(e.kq, kevents, nil, nil)
		if err != nil {
			delete(e.fdData, fd)
			return fmt.Errorf("failed to add fd %d to kqueue: %w", fd, err)
		}
	}
	
	// Set non-blocking mode
	if err := unix.SetNonblock(fd, true); err != nil {
		// Not fatal, but log it
		debugLog("[WARN] Failed to set non-blocking mode on fd %d: %v", fd, err)
	}
	
	return nil
}

func (e *kqueueEventLoop) Remove(fd int) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	
	delete(e.fdData, fd)
	
	// Remove both read and write filters
	kevents := []unix.Kevent_t{
		{
			Ident:  uint64(fd),
			Filter: unix.EVFILT_READ,
			Flags:  unix.EV_DELETE,
		},
		{
			Ident:  uint64(fd),
			Filter: unix.EVFILT_WRITE,
			Flags:  unix.EV_DELETE,
		},
	}
	
	_, err := unix.Kevent(e.kq, kevents, nil, nil)
	if err != nil && err != syscall.ENOENT {
		return fmt.Errorf("failed to remove fd %d from kqueue: %w", fd, err)
	}
	
	return nil
}

func (e *kqueueEventLoop) Modify(fd int, events EventType) error {
	// For kqueue, we need to remove and re-add
	if err := e.Remove(fd); err != nil {
		return err
	}
	
	e.mu.Lock()
	data := e.fdData[fd]
	e.mu.Unlock()
	
	return e.Add(fd, events, data)
}

func (e *kqueueEventLoop) Run(handler EventHandler) error {
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
	
	events := make([]unix.Kevent_t, 128)
	
	for {
		select {
		case <-e.stopChan:
			return nil
		default:
		}
		
		// Wait for events with 1ms timeout for maximum responsiveness
		n, err := unix.Kevent(e.kq, nil, events, &unix.Timespec{
			Sec:  0,
			Nsec: 1 * 1000 * 1000, // 1ms for near-instant response
		})
		
		if err != nil {
			if err == unix.EINTR {
				continue
			}
			return fmt.Errorf("kevent wait failed: %w", err)
		}
		
		// Process events
		for i := 0; i < n; i++ {
			event := &events[i]
			fd := int(event.Ident)
			
			e.mu.Lock()
			data := e.fdData[fd]
			e.mu.Unlock()
			
			var eventType EventType
			
			// Convert kqueue events to our EventType
			if event.Filter == unix.EVFILT_READ {
				eventType |= EventRead
			}
			if event.Filter == unix.EVFILT_WRITE {
				eventType |= EventWrite
			}
			if event.Flags&unix.EV_EOF != 0 {
				eventType |= EventHup
			}
			if event.Flags&unix.EV_ERROR != 0 {
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

func (e *kqueueEventLoop) RunOnce(handler EventHandler, timeoutMs int) error {
	events := make([]unix.Kevent_t, 128)
	
	var timeout *unix.Timespec
	if timeoutMs >= 0 {
		timeout = &unix.Timespec{
			Sec:  int64(timeoutMs / 1000),
			Nsec: int64((timeoutMs % 1000) * 1000 * 1000),
		}
	}
	
	n, err := unix.Kevent(e.kq, nil, events, timeout)
	if err != nil {
		if err == unix.EINTR {
			return nil
		}
		return fmt.Errorf("kevent wait failed: %w", err)
	}
	
	// Process events
	for i := 0; i < n; i++ {
		event := &events[i]
		fd := int(event.Ident)
		
		e.mu.Lock()
		data := e.fdData[fd]
		e.mu.Unlock()
		
		var eventType EventType
		
		if event.Filter == unix.EVFILT_READ {
			eventType |= EventRead
		}
		if event.Filter == unix.EVFILT_WRITE {
			eventType |= EventWrite
		}
		if event.Flags&unix.EV_EOF != 0 {
			eventType |= EventHup
		}
		if event.Flags&unix.EV_ERROR != 0 {
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

func (e *kqueueEventLoop) Stop() error {
	close(e.stopChan)
	
	// Create a new stop channel for future runs
	e.stopChan = make(chan struct{})
	
	return nil
}

func (e *kqueueEventLoop) Close() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	
	if e.running {
		e.Stop()
		// Give it a moment to stop
		time.Sleep(10 * time.Millisecond)
	}
	
	if e.kq >= 0 {
		err := unix.Close(e.kq)
		e.kq = -1
		return err
	}
	
	return nil
}