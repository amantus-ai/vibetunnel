package session

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/vibetunnel/linux/pkg/protocol"
	"golang.org/x/sys/unix"
	"golang.org/x/term"
)

// useEventDrivenIO determines whether to use native event-driven I/O
// This uses epoll on Linux and kqueue on macOS for zero-latency I/O
const useEventDrivenIO = true

// isShellBuiltin checks if a command is a shell builtin
func isShellBuiltin(cmd string) bool {
	builtins := []string{
		"cd", "echo", "pwd", "export", "alias", "source", ".", 
		"unset", "set", "eval", "exec", "exit", "return",
		"break", "continue", "shift", "trap", "wait", "umask",
		"ulimit", "times", "test", "[", "[[", "type", "hash",
		"help", "history", "jobs", "kill", "let", "local",
		"logout", "popd", "pushd", "read", "readonly", "true",
		"false", ":", "printf", "declare", "typeset", "unalias",
	}
	
	for _, builtin := range builtins {
		if cmd == builtin {
			return true
		}
	}
	return false
}

type PTY struct {
	session             *Session
	cmd                 *exec.Cmd
	pty                 *os.File
	oldState            *term.State
	streamWriter        *protocol.StreamWriter
	stdinPipe           *os.File
	useEventDrivenStdin bool
	resizeMutex         sync.Mutex
}

func NewPTY(session *Session) (*PTY, error) {
	debugLog("[DEBUG] NewPTY: Starting PTY creation for session %s", session.ID[:8])

	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}

	cmdline := session.info.Args
	if len(cmdline) == 0 {
		cmdline = []string{shell}
	}

	debugLog("[DEBUG] NewPTY: Initial cmdline: %v", cmdline)

	// Execute through shell to handle aliases, functions, and proper PATH resolution
	var cmd *exec.Cmd
	if len(cmdline) == 1 && cmdline[0] == shell {
		// If just launching the shell itself, don't use -c
		cmd = exec.Command(shell)
	} else {
		// Execute command through login shell for proper environment handling
		// This ensures aliases and functions from .zshrc/.bashrc are loaded
		shellCmd := strings.Join(cmdline, " ")

		// Check if this is a shell builtin command
		if isShellBuiltin(cmdline[0]) {
			// For builtins, we don't need interactive mode
			cmd = exec.Command(shell, "-c", shellCmd)
			debugLog("[DEBUG] NewPTY: Executing builtin command: %s -c %q", shell, shellCmd)
		} else if strings.Contains(shell, "zsh") {
			// For zsh, use login shell to load configurations
			// Interactive mode (-i) can cause issues with some commands
			cmd = exec.Command(shell, "-l", "-c", shellCmd)
			debugLog("[DEBUG] NewPTY: Executing through zsh login shell: %s -l -c %q", shell, shellCmd)
		} else {
			// For other shells (bash, sh), use interactive login
			// This ensures aliases and functions are available
			cmd = exec.Command(shell, "-i", "-l", "-c", shellCmd)
			debugLog("[DEBUG] NewPTY: Executing through interactive login shell: %s -i -l -c %q", shell, shellCmd)
		}

		// Add some debugging to understand what's happening
		debugLog("[DEBUG] NewPTY: Shell: %s", shell)
		debugLog("[DEBUG] NewPTY: Command: %v", cmdline)
		debugLog("[DEBUG] NewPTY: Shell command: %s", shellCmd)
	}

	// Set working directory, ensuring it's valid
	if session.info.Cwd != "" {
		// Verify the directory exists and is accessible
		if _, err := os.Stat(session.info.Cwd); err != nil {
			log.Printf("[ERROR] NewPTY: Working directory '%s' not accessible: %v", session.info.Cwd, err)
			return nil, NewSessionErrorWithCause(
				fmt.Sprintf("working directory '%s' not accessible", session.info.Cwd),
				ErrInvalidArgument,
				session.ID,
				err,
			)
		}
		cmd.Dir = session.info.Cwd
		debugLog("[DEBUG] NewPTY: Set working directory to: %s", session.info.Cwd)
	}

	// Pass all environment variables like Node.js implementation does
	// This ensures terminal features, locale settings, and shell prompts work correctly
	env := os.Environ()

	// Log PATH for debugging
	pathFound := false
	for _, e := range env {
		if strings.HasPrefix(e, "PATH=") {
			debugLog("[DEBUG] NewPTY: PATH=%s", e[5:])
			pathFound = true
			break
		}
	}
	if !pathFound {
		debugLog("[DEBUG] NewPTY: No PATH found in environment!")
	}

	// Override TERM if specified in session info
	termSet := false
	for i, v := range env {
		if strings.HasPrefix(v, "TERM=") {
			env[i] = "TERM=" + session.info.Term
			termSet = true
			break
		}
	}
	if !termSet {
		env = append(env, "TERM="+session.info.Term)
	}

	cmd.Env = env

	ptmx, err := pty.Start(cmd)
	if err != nil {
		// Provide more helpful error message for common failures
		errorMsg := fmt.Sprintf("Failed to start PTY for command '%s'", strings.Join(cmdline, " "))
		if strings.Contains(err.Error(), "no such file or directory") || strings.Contains(err.Error(), "not found") {
			errorMsg = fmt.Sprintf("Command '%s' not found. Make sure it's installed and in your PATH, or is a valid shell alias/function. The command was executed through %s to load your shell configuration.", cmdline[0], shell)
		} else if strings.Contains(err.Error(), "permission denied") {
			errorMsg = fmt.Sprintf("Permission denied executing '%s'", strings.Join(cmdline, " "))
		}
		log.Printf("[ERROR] NewPTY: %s: %v", errorMsg, err)
		log.Printf("[ERROR] NewPTY: Shell used: %s, Working directory: %s", shell, session.info.Cwd)
		return nil, NewSessionErrorWithCause(errorMsg, ErrPTYCreationFailed, session.ID, err)
	}

	debugLog("[DEBUG] NewPTY: PTY started successfully, PID: %d", cmd.Process.Pid)

	// Log the actual command being executed
	debugLog("[DEBUG] NewPTY: Executing command: %v in directory: %s", cmdline, cmd.Dir)
	debugLog("[DEBUG] NewPTY: Environment has %d variables", len(cmd.Env))

	// Configure terminal attributes to match node-pty behavior
	// This must be done before setting size and after the process starts
	if err := configurePTYTerminal(ptmx); err != nil {
		log.Printf("[ERROR] NewPTY: Failed to configure PTY terminal: %v", err)
		// Don't fail on terminal configuration errors, just log them
	}
	

	// Set PTY size using our enhanced function
	if err := setPTYSize(ptmx, uint16(session.info.Width), uint16(session.info.Height)); err != nil {
		log.Printf("[ERROR] NewPTY: Failed to set PTY size: %v", err)
		if err := ptmx.Close(); err != nil {
			log.Printf("[ERROR] NewPTY: Failed to close PTY: %v", err)
		}
		if err := cmd.Process.Kill(); err != nil {
			log.Printf("[ERROR] NewPTY: Failed to kill process: %v", err)
		}
		return nil, NewSessionErrorWithCause(
			"failed to set PTY size",
			ErrPTYResizeFailed,
			session.ID,
			err,
		)
	}

	debugLog("[DEBUG] NewPTY: Terminal configured for interactive mode with flow control")

	streamOut, err := os.Create(session.StreamOutPath())
	if err != nil {
		log.Printf("[ERROR] NewPTY: Failed to create stream-out: %v", err)
		if err := ptmx.Close(); err != nil {
			log.Printf("[ERROR] NewPTY: Failed to close PTY: %v", err)
		}
		if err := cmd.Process.Kill(); err != nil {
			log.Printf("[ERROR] NewPTY: Failed to kill process: %v", err)
		}
		return nil, fmt.Errorf("failed to create stream-out: %w", err)
	}

	streamWriter := protocol.NewStreamWriter(streamOut, &protocol.AsciinemaHeader{
		Version: 2,
		Width:   uint32(session.info.Width),
		Height:  uint32(session.info.Height),
		Command: strings.Join(cmdline, " "),
		Env:     session.info.Env,
	})

	if err := streamWriter.WriteHeader(); err != nil {
		log.Printf("[ERROR] NewPTY: Failed to write stream header: %v", err)
		if err := streamOut.Close(); err != nil {
			log.Printf("[ERROR] NewPTY: Failed to close stream-out: %v", err)
		}
		if err := ptmx.Close(); err != nil {
			log.Printf("[ERROR] NewPTY: Failed to close PTY: %v", err)
		}
		if err := cmd.Process.Kill(); err != nil {
			log.Printf("[ERROR] NewPTY: Failed to kill process: %v", err)
		}
		return nil, fmt.Errorf("failed to write stream header: %w", err)
	}

	stdinPath := session.StdinPath()
	debugLog("[DEBUG] NewPTY: Creating stdin FIFO at: %s", stdinPath)
	if err := syscall.Mkfifo(stdinPath, 0600); err != nil {
		log.Printf("[ERROR] NewPTY: Failed to create stdin pipe: %v", err)
		if err := streamOut.Close(); err != nil {
			log.Printf("[ERROR] NewPTY: Failed to close stream-out: %v", err)
		}
		if err := ptmx.Close(); err != nil {
			log.Printf("[ERROR] NewPTY: Failed to close PTY: %v", err)
		}
		if err := cmd.Process.Kill(); err != nil {
			log.Printf("[ERROR] NewPTY: Failed to kill process: %v", err)
		}
		return nil, fmt.Errorf("failed to create stdin pipe: %w", err)
	}

	// Create control FIFO
	if err := session.createControlFIFO(); err != nil {
		log.Printf("[ERROR] NewPTY: Failed to create control FIFO: %v", err)
		// Don't fail if control FIFO creation fails - it's optional
	}

	ptyObj := &PTY{
		session:      session,
		cmd:          cmd,
		pty:          ptmx,
		streamWriter: streamWriter,
	}
	
	// For spawned sessions that will be attached, disable echo immediately
	// to prevent race condition where output is processed before Attach() disables echo
	if session.info.IsSpawned {
		debugLog("[DEBUG] NewPTY: Spawned session detected, disabling PTY echo immediately")
		if err := ptyObj.disablePTYEcho(); err != nil {
			log.Printf("[ERROR] NewPTY: Failed to disable PTY echo for spawned session: %v", err)
		}
	}
	
	return ptyObj, nil
}

func (p *PTY) Pid() int {
	if p.cmd.Process != nil {
		return p.cmd.Process.Pid
	}
	return 0
}


// runEventDriven runs the PTY using native event-driven I/O (epoll/kqueue)
func (p *PTY) runEventDriven() error {
	debugLog("[DEBUG] PTY.runEventDriven: Starting event-driven I/O for session %s", p.session.ID[:8])
	
	// Create event loop
	eventLoop, err := NewEventLoop()
	if err != nil {
		log.Printf("[ERROR] PTY.runEventDriven: Failed to create event loop: %v", err)
		// Fall back to polling
		return p.pollWithSelect()
	}
	defer eventLoop.Close()
	
	// Set PTY to non-blocking mode
	if err := unix.SetNonblock(int(p.pty.Fd()), true); err != nil {
		log.Printf("[WARN] PTY.runEventDriven: Failed to set PTY non-blocking: %v", err)
	}
	
	// Add PTY to event loop for reading
	ptyFD := int(p.pty.Fd())
	if err := eventLoop.Add(ptyFD, EventRead|EventHup, "pty"); err != nil {
		log.Printf("[ERROR] PTY.runEventDriven: Failed to add PTY to event loop: %v", err)
		return fmt.Errorf("failed to add PTY to event loop: %w", err)
	}
	
	// Open stdin pipe
	stdinPipe, err := os.OpenFile(p.session.StdinPath(), os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		log.Printf("[ERROR] PTY.runEventDriven: Failed to open stdin pipe: %v", err)
		return fmt.Errorf("failed to open stdin pipe: %w", err)
	}
	defer stdinPipe.Close()
	
	// Add stdin pipe to event loop
	stdinFD := int(stdinPipe.Fd())
	if err := eventLoop.Add(stdinFD, EventRead, "stdin"); err != nil {
		log.Printf("[ERROR] PTY.runEventDriven: Failed to add stdin to event loop: %v", err)
		return fmt.Errorf("failed to add stdin to event loop: %w", err)
	}
	
	// Track process exit
	exitCh := make(chan error, 1)
	go func() {
		waitErr := p.cmd.Wait()
		
		if waitErr != nil {
			if exitError, ok := waitErr.(*exec.ExitError); ok {
				if ws, ok := exitError.Sys().(syscall.WaitStatus); ok {
					exitCode := ws.ExitStatus()
					p.session.info.ExitCode = &exitCode
				}
			}
		} else {
			exitCode := 0
			p.session.info.ExitCode = &exitCode
		}
		
		p.session.UpdateStatus()
		
		// Close the stream writer to finalize the recording
		if err := p.streamWriter.Close(); err != nil {
			log.Printf("[ERROR] PTY.runEventDriven: Failed to close stream writer: %v", err)
		}
		
		eventLoop.Stop()
		exitCh <- waitErr
	}()
	
	// Buffers for I/O
	ptyBuf := make([]byte, 4096)
	stdinBuf := make([]byte, 1024)
	
	debugLog("[DEBUG] PTY.runEventDriven: Starting event loop")
	
	// Run the event loop
	err = eventLoop.Run(func(event Event) {
		switch event.Data.(string) {
		case "pty":
			if event.Events&EventRead != 0 {
				// Read all available data
				for {
					n, err := syscall.Read(event.FD, ptyBuf)
					if n > 0 {
						outputData := ptyBuf[:n]
						
						// Write to asciinema stream file
						if err := p.streamWriter.WriteOutput(outputData); err != nil {
							log.Printf("[ERROR] PTY.runEventDriven: Failed to write output: %v", err)
						}
						
						// CRITICAL: Direct streaming like Node.js!
						// Notify direct output callbacks immediately (no file I/O delay!)
						if p.session.manager != nil {
							p.session.manager.NotifyDirectOutput(p.session.ID, outputData)
							// Also notify raw PTY callbacks for goterm-style direct streaming
							p.session.manager.NotifyRawPTY(p.session.ID, outputData)
						}
					}
					
					if err != nil {
						if err == syscall.EAGAIN || err == syscall.EWOULDBLOCK {
							// No more data available
							break
						}
						if err != io.EOF {
							log.Printf("[ERROR] PTY.runEventDriven: PTY read error: %v", err)
						}
						eventLoop.Stop()
						break
					}
					
					// If we read less than buffer size, no more data
					if n < len(ptyBuf) {
						break
					}
				}
			}
			
			if event.Events&EventHup != 0 {
				debugLog("[DEBUG] PTY.runEventDriven: PTY closed (HUP)")
				eventLoop.Stop()
			}
			
		case "stdin":
			if event.Events&EventRead != 0 {
				// Read from stdin pipe
				n, err := syscall.Read(event.FD, stdinBuf)
				if n > 0 {
					if _, err := p.pty.Write(stdinBuf[:n]); err != nil {
						log.Printf("[ERROR] PTY.runEventDriven: Failed to write to PTY: %v", err)
					}
					
					if err := p.streamWriter.WriteInput(stdinBuf[:n]); err != nil {
						log.Printf("[ERROR] PTY.runEventDriven: Failed to write input to stream: %v", err)
					}
				}
				
				if err != nil && err != syscall.EAGAIN && err != syscall.EWOULDBLOCK {
					if err != io.EOF {
						log.Printf("[ERROR] PTY.runEventDriven: Stdin read error: %v", err)
					}
					eventLoop.Remove(event.FD)
				}
			}
		}
	})
	
	if err != nil {
		log.Printf("[ERROR] PTY.runEventDriven: Event loop error: %v", err)
	}
	
	// Wait for process exit
	result := <-exitCh
	
	debugLog("[DEBUG] PTY.runEventDriven: Completed with result: %v", result)
	return result
}

func (p *PTY) Run() error {
	defer func() {
		if err := p.Close(); err != nil {
			log.Printf("[ERROR] PTY.Run: Failed to close PTY: %v", err)
		}
	}()

	debugLog("[DEBUG] PTY.Run: Starting PTY run for session %s, PID %d", p.session.ID[:8], p.cmd.Process.Pid)

	// Use event-driven stdin handling like Node.js
	stdinWatcher, err := NewStdinWatcher(p.session.StdinPath(), p.pty)
	if err != nil {
		// Fall back to polling if watcher fails
		log.Printf("[WARN] PTY.Run: Failed to create stdin watcher, falling back to polling: %v", err)

		stdinPipe, err := os.OpenFile(p.session.StdinPath(), os.O_RDONLY|syscall.O_NONBLOCK, 0)
		if err != nil {
			log.Printf("[ERROR] PTY.Run: Failed to open stdin pipe: %v", err)
			return fmt.Errorf("failed to open stdin pipe: %w", err)
		}
		defer func() {
			if err := stdinPipe.Close(); err != nil {
				log.Printf("[ERROR] PTY.Run: Failed to close stdin pipe: %v", err)
			}
		}()
		p.stdinPipe = stdinPipe
	} else {
		// Start the watcher
		stdinWatcher.Start()
		defer stdinWatcher.Stop()
		p.useEventDrivenStdin = true
		debugLog("[DEBUG] PTY.Run: Using event-driven stdin handling")
	}

	debugLog("[DEBUG] PTY.Run: Stdin handling initialized")

	// Set up SIGWINCH handling for terminal resize
	winchCh := make(chan os.Signal, 1)
	signal.Notify(winchCh, syscall.SIGWINCH)
	defer signal.Stop(winchCh)

	// Handle SIGWINCH in a separate goroutine
	go func() {
		for range winchCh {
			// Check if resizing is disabled globally
			if p.session.manager != nil && p.session.manager.GetDoNotAllowColumnSet() {
				debugLog("[DEBUG] PTY.Run: Received SIGWINCH but resizing is disabled by server configuration")
				continue
			}

			// Get current terminal size if we're attached to a terminal
			if term.IsTerminal(int(os.Stdin.Fd())) {
				width, height, err := term.GetSize(int(os.Stdin.Fd()))
				if err == nil {
					debugLog("[DEBUG] PTY.Run: Received SIGWINCH, resizing to %dx%d", width, height)
					if err := setPTYSize(p.pty, uint16(width), uint16(height)); err != nil {
						log.Printf("[ERROR] PTY.Run: Failed to resize PTY: %v", err)
					} else {
						// Update session info
						p.session.mu.Lock()
						p.session.info.Width = width
						p.session.info.Height = height
						p.session.mu.Unlock()

						// Write resize event to stream
						if err := p.streamWriter.WriteResize(uint32(width), uint32(height)); err != nil {
							log.Printf("[ERROR] PTY.Run: Failed to write resize event: %v", err)
						}
					}
				}
			}
		}
	}()

	// Use event-driven I/O if available
	if useEventDrivenIO {
		return p.runEventDriven()
	}
	
	// Use select-based polling as fallback
	if runtime.GOOS == "linux" || runtime.GOOS == "darwin" {
		return p.pollWithSelect()
	}

	// Fallback to goroutine-based implementation
	errCh := make(chan error, 3)

	go func() {
		debugLog("[DEBUG] PTY.Run: Starting output reading goroutine")
		buf := make([]byte, 1024) // 1KB buffer for maximum responsiveness

		for {
			// Use a timeout-based approach for cross-platform compatibility
			// This avoids the complexity of non-blocking I/O syscalls
			n, err := p.pty.Read(buf)
			if n > 0 {
				debugLog("[DEBUG] PTY.Run: Read %d bytes of output from PTY", n)
				if err := p.streamWriter.WriteOutput(buf[:n]); err != nil {
					log.Printf("[ERROR] PTY.Run: Failed to write output: %v", err)
					errCh <- fmt.Errorf("failed to write output: %w", err)
					return
				}
				// Continue reading immediately if we got data
				continue
			}
			if err != nil {
				if err == io.EOF {
					// For blocking reads, EOF typically means the process exited
					debugLog("[DEBUG] PTY.Run: PTY reached EOF, process likely exited")
					return
				}
				// For other errors, this is a problem
				log.Printf("[ERROR] PTY.Run: OUTPUT GOROUTINE sending error to errCh: %v", err)
				errCh <- fmt.Errorf("PTY read error: %w", err)
				return
			}
			// If we get here, n == 0 and err == nil, which is unusual for blocking reads
			// Give a longer pause to prevent excessive CPU usage
			time.Sleep(10 * time.Millisecond)
		}
	}()

	// Only start stdin goroutine if not using event-driven mode
	if !p.useEventDrivenStdin && p.stdinPipe != nil {
		go func() {
			debugLog("[DEBUG] PTY.Run: Starting stdin reading goroutine")
			buf := make([]byte, 4096)
			for {
				n, err := p.stdinPipe.Read(buf)
				if n > 0 {
					debugLog("[DEBUG] PTY.Run: Read %d bytes from stdin, writing to PTY", n)
					if _, err := p.pty.Write(buf[:n]); err != nil {
						log.Printf("[ERROR] PTY.Run: Failed to write to PTY: %v", err)
						// Only exit if the PTY is really broken, not on temporary errors
						if err != syscall.EPIPE && err != syscall.ECONNRESET {
							errCh <- fmt.Errorf("failed to write to PTY: %w", err)
							return
						}
						// For broken pipe, just continue - the PTY might be closing
						debugLog("[DEBUG] PTY.Run: PTY write failed with pipe error, continuing...")
						time.Sleep(10 * time.Millisecond)
					}
					// Continue immediately after successful write
					continue
				}
				if err == syscall.EAGAIN || err == syscall.EWOULDBLOCK {
					// No data available, longer pause to prevent excessive CPU usage
					time.Sleep(10 * time.Millisecond)
					continue
				}
				if err == io.EOF {
					// No writers to the FIFO yet, longer pause before retry
					time.Sleep(50 * time.Millisecond)
					continue
				}
				if err != nil {
					// Log other errors but don't crash the session - stdin issues shouldn't kill the PTY
					log.Printf("[WARN] PTY.Run: Stdin read error (non-fatal): %v", err)
					time.Sleep(10 * time.Millisecond)
					continue
				}
			}
		}()
	}

	go func() {
		debugLog("[DEBUG] PTY.Run: Starting process wait goroutine for PID %d", p.cmd.Process.Pid)
		err := p.cmd.Wait()
		debugLog("[DEBUG] PTY.Run: Process wait completed for PID %d, error: %v", p.cmd.Process.Pid, err)

		if err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				if status, ok := exitErr.Sys().(syscall.WaitStatus); ok {
					exitCode := status.ExitStatus()
					p.session.info.ExitCode = &exitCode
					debugLog("[DEBUG] PTY.Run: Process exited with code %d", exitCode)
				}
			} else {
				debugLog("[DEBUG] PTY.Run: Process exited with non-exit error: %v", err)
			}
		} else {
			exitCode := 0
			p.session.info.ExitCode = &exitCode
			debugLog("[DEBUG] PTY.Run: Process exited normally (code 0)")
		}
		p.session.info.Status = string(StatusExited)
		if err := p.session.info.Save(p.session.Path()); err != nil {
			log.Printf("[ERROR] PTY.Run: Failed to save session info: %v", err)
		}

		// Reap any zombie child processes
		for {
			var status syscall.WaitStatus
			pid, err := syscall.Wait4(-1, &status, syscall.WNOHANG, nil)
			if err != nil || pid <= 0 {
				break
			}
			debugLog("[DEBUG] PTY.Run: Reaped zombie process PID %d", pid)
		}

		debugLog("[DEBUG] PTY.Run: PROCESS WAIT GOROUTINE sending completion to errCh")
		errCh <- err
	}()

	debugLog("[DEBUG] PTY.Run: Waiting for first error from goroutines...")
	result := <-errCh
	debugLog("[DEBUG] PTY.Run: Received error from goroutine: %v", result)
	debugLog("[DEBUG] PTY.Run: Process PID %d status after error: alive=%v", p.cmd.Process.Pid, p.session.IsAlive())
	return result
}

func (p *PTY) Attach() error {
	if !term.IsTerminal(int(os.Stdin.Fd())) {
		return fmt.Errorf("not a terminal")
	}

	oldState, err := term.MakeRaw(int(os.Stdin.Fd()))
	if err != nil {
		return fmt.Errorf("failed to set raw mode: %w", err)
	}
	p.oldState = oldState

	// When attaching to a PTY interactively, we need to disable ECHO on the PTY
	// to prevent double-echoing (since the controlling terminal is in raw mode)
	if err := p.disablePTYEcho(); err != nil {
		log.Printf("[WARN] PTY.Attach: Failed to disable PTY echo: %v", err)
		// Continue anyway - some programs might handle this themselves
	}

	defer func() {
		if err := term.Restore(int(os.Stdin.Fd()), oldState); err != nil {
			log.Printf("[ERROR] PTY.Attach: Failed to restore terminal: %v", err)
		}
	}()

	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGWINCH)
	go func() {
		for range ch {
			// Check if resizing is disabled globally
			if p.session.manager != nil && p.session.manager.GetDoNotAllowColumnSet() {
				debugLog("[DEBUG] PTY.Attach: Received SIGWINCH but resizing is disabled by server configuration")
				continue
			}
			if err := p.updateSize(); err != nil {
				log.Printf("[ERROR] PTY.Attach: Failed to update size: %v", err)
			}
		}
	}()
	defer signal.Stop(ch)

	// Only update size initially if resizing is allowed
	if p.session.manager == nil || !p.session.manager.GetDoNotAllowColumnSet() {
		if err := p.updateSize(); err != nil {
			log.Printf("[ERROR] PTY.Attach: Failed to update initial size: %v", err)
		}
	} else {
		debugLog("[DEBUG] PTY.Attach: Skipping initial resize - resizing is disabled by server configuration")
	}

	errCh := make(chan error, 2)

	go func() {
		_, err := io.Copy(p.pty, os.Stdin)
		errCh <- err
	}()

	go func() {
		_, err := io.Copy(os.Stdout, p.pty)
		errCh <- err
	}()

	return <-errCh
}

func (p *PTY) updateSize() error {
	if !term.IsTerminal(int(os.Stdin.Fd())) {
		return nil
	}

	width, height, err := term.GetSize(int(os.Stdin.Fd()))
	if err != nil {
		return err
	}

	return pty.Setsize(p.pty, &pty.Winsize{
		Rows: uint16(height),
		Cols: uint16(width),
	})
}

// disablePTYEcho disables echo on the PTY to prevent double-echoing
// when the controlling terminal is in raw mode
func (p *PTY) disablePTYEcho() error {
	// Get current PTY termios
	termios, err := unix.IoctlGetTermios(int(p.pty.Fd()), unix.TIOCGETA)
	if err != nil {
		return fmt.Errorf("failed to get PTY termios: %w", err)
	}

	// Disable echo flags to prevent double-echoing
	// Keep other flags like ICANON for line processing
	termios.Lflag &^= unix.ECHO | unix.ECHOE | unix.ECHOK | unix.ECHOKE | unix.ECHOCTL

	// Apply the new settings
	if err := unix.IoctlSetTermios(int(p.pty.Fd()), unix.TIOCSETA, termios); err != nil {
		return fmt.Errorf("failed to set PTY termios: %w", err)
	}

	debugLog("[DEBUG] PTY.disablePTYEcho: Disabled echo on PTY")
	return nil
}

func (p *PTY) Resize(width, height int) error {
	if p.pty == nil {
		return fmt.Errorf("PTY not initialized")
	}

	p.resizeMutex.Lock()
	defer p.resizeMutex.Unlock()

	debugLog("[DEBUG] PTY.Resize: Resizing PTY to %dx%d for session %s", width, height, p.session.ID[:8])

	// Resize the actual PTY
	err := pty.Setsize(p.pty, &pty.Winsize{
		Rows: uint16(height),
		Cols: uint16(width),
	})

	if err != nil {
		log.Printf("[ERROR] PTY.Resize: Failed to resize PTY: %v", err)
		return fmt.Errorf("failed to resize PTY: %w", err)
	}

	// Write resize event to stream if streamWriter is available
	if p.streamWriter != nil {
		if err := p.streamWriter.WriteResize(uint32(width), uint32(height)); err != nil {
			log.Printf("[ERROR] PTY.Resize: Failed to write resize event: %v", err)
			// Don't fail the resize operation if we can't write the event
		}
	}

	debugLog("[DEBUG] PTY.Resize: Successfully resized PTY to %dx%d", width, height)
	return nil
}

func (p *PTY) Close() error {
	var firstErr error

	if p.streamWriter != nil {
		if err := p.streamWriter.Close(); err != nil {
			log.Printf("[ERROR] PTY.Close: Failed to close stream writer: %v", err)
			if firstErr == nil {
				firstErr = err
			}
		}
	}
	if p.pty != nil {
		if err := p.pty.Close(); err != nil {
			log.Printf("[ERROR] PTY.Close: Failed to close PTY: %v", err)
			if firstErr == nil {
				firstErr = err
			}
		}
	}
	if p.oldState != nil {
		if err := term.Restore(int(os.Stdin.Fd()), p.oldState); err != nil {
			log.Printf("[ERROR] PTY.Close: Failed to restore terminal: %v", err)
			if firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}
