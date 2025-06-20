package session

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/vibetunnel/linux/pkg/protocol"
	"golang.org/x/term"
)

// useSelectPolling determines whether to use select-based polling
// Enable this for better control FIFO integration
const useSelectPolling = true

type PTY struct {
	session      *Session
	cmd          *exec.Cmd
	pty          *os.File
	oldState     *term.State
	streamWriter *protocol.StreamWriter
	stdinPipe    *os.File
	resizeMutex  sync.Mutex
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

	cmd := exec.Command(cmdline[0], cmdline[1:]...)

	// Set working directory, ensuring it's valid
	if session.info.Cwd != "" {
		// Verify the directory exists and is accessible
		if _, err := os.Stat(session.info.Cwd); err != nil {
			log.Printf("[ERROR] NewPTY: Working directory '%s' not accessible: %v", session.info.Cwd, err)
			return nil, fmt.Errorf("working directory '%s' not accessible: %w", session.info.Cwd, err)
		}
		cmd.Dir = session.info.Cwd
		debugLog("[DEBUG] NewPTY: Set working directory to: %s", session.info.Cwd)
	}

	// Set up environment with filtered variables like Rust implementation
	// Only pass safe environment variables
	safeEnvVars := []string{"TERM", "SHELL", "LANG", "LC_ALL", "PATH", "USER", "HOME"}
	env := make([]string, 0)
	
	// Copy only safe environment variables from parent
	for _, v := range os.Environ() {
		parts := strings.SplitN(v, "=", 2)
		if len(parts) == 2 {
			for _, safe := range safeEnvVars {
				if parts[0] == safe {
					env = append(env, v)
					break
				}
			}
		}
	}
	
	// Ensure TERM and SHELL are set
	hasTermVar := false
	hasShellVar := false
	for _, v := range env {
		if strings.HasPrefix(v, "TERM=") {
			hasTermVar = true
		}
		if strings.HasPrefix(v, "SHELL=") {
			hasShellVar = true
		}
	}
	
	if !hasTermVar {
		env = append(env, "TERM="+session.info.Term)
	}
	if !hasShellVar {
		env = append(env, "SHELL="+cmdline[0])
	}
	
	cmd.Env = env

	ptmx, err := pty.Start(cmd)
	if err != nil {
		log.Printf("[ERROR] NewPTY: Failed to start PTY: %v", err)
		return nil, fmt.Errorf("failed to start PTY: %w", err)
	}

	debugLog("[DEBUG] NewPTY: PTY started successfully, PID: %d", cmd.Process.Pid)
	
	// Log the actual command being executed
	debugLog("[DEBUG] NewPTY: Executing command: %v in directory: %s", cmdline, cmd.Dir)
	debugLog("[DEBUG] NewPTY: Environment has %d variables", len(cmd.Env))

	if err := pty.Setsize(ptmx, &pty.Winsize{
		Rows: uint16(session.info.Height),
		Cols: uint16(session.info.Width),
	}); err != nil {
		log.Printf("[ERROR] NewPTY: Failed to set PTY size: %v", err)
		ptmx.Close()
		cmd.Process.Kill()
		return nil, fmt.Errorf("failed to set PTY size: %w", err)
	}

	// Set terminal flags to match Rust implementation
	// Get the current terminal attributes
	oldState, err := term.MakeRaw(int(ptmx.Fd()))
	if err != nil {
		debugLog("[DEBUG] NewPTY: Failed to get terminal attributes: %v", err)
	} else {
		// Restore the terminal but with specific flags enabled
		// We don't want raw mode, we want interactive mode with ISIG, ICANON, and ECHO
		term.Restore(int(ptmx.Fd()), oldState)
		
		// The creack/pty library should have already set up the terminal properly
		// for interactive use. The key is that the PTY slave (not master) needs
		// these settings, and they're typically inherited from the process.
		debugLog("[DEBUG] NewPTY: Terminal configured for interactive mode")
	}

	streamOut, err := os.Create(session.StreamOutPath())
	if err != nil {
		log.Printf("[ERROR] NewPTY: Failed to create stream-out: %v", err)
		ptmx.Close()
		cmd.Process.Kill()
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
		streamOut.Close()
		ptmx.Close()
		cmd.Process.Kill()
		return nil, fmt.Errorf("failed to write stream header: %w", err)
	}

	stdinPath := session.StdinPath()
	debugLog("[DEBUG] NewPTY: Creating stdin FIFO at: %s", stdinPath)
	if err := syscall.Mkfifo(stdinPath, 0600); err != nil {
		log.Printf("[ERROR] NewPTY: Failed to create stdin pipe: %v", err)
		streamOut.Close()
		ptmx.Close()
		cmd.Process.Kill()
		return nil, fmt.Errorf("failed to create stdin pipe: %w", err)
	}

	// Create control FIFO
	if err := session.createControlFIFO(); err != nil {
		log.Printf("[ERROR] NewPTY: Failed to create control FIFO: %v", err)
		// Don't fail if control FIFO creation fails - it's optional
	}

	return &PTY{
		session:      session,
		cmd:          cmd,
		pty:          ptmx,
		streamWriter: streamWriter,
	}, nil
}

func (p *PTY) Pid() int {
	if p.cmd.Process != nil {
		return p.cmd.Process.Pid
	}
	return 0
}

func (p *PTY) Run() error {
	defer p.Close()

	debugLog("[DEBUG] PTY.Run: Starting PTY run for session %s, PID %d", p.session.ID[:8], p.cmd.Process.Pid)

	stdinPipe, err := os.OpenFile(p.session.StdinPath(), os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		log.Printf("[ERROR] PTY.Run: Failed to open stdin pipe: %v", err)
		return fmt.Errorf("failed to open stdin pipe: %w", err)
	}
	defer stdinPipe.Close()
	p.stdinPipe = stdinPipe

	debugLog("[DEBUG] PTY.Run: Stdin pipe opened successfully")

	// Use select-based polling if available
	if useSelectPolling {
		return p.pollWithSelect()
	}

	// Fallback to goroutine-based implementation
	errCh := make(chan error, 3)

	go func() {
		debugLog("[DEBUG] PTY.Run: Starting output reading goroutine")
		buf := make([]byte, 32*1024)

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

	go func() {
		debugLog("[DEBUG] PTY.Run: Starting stdin reading goroutine")
		buf := make([]byte, 4096)
		for {
			n, err := stdinPipe.Read(buf)
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
		p.session.info.Save(p.session.Path())
		
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

	defer func() {
		term.Restore(int(os.Stdin.Fd()), oldState)
	}()

	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGWINCH)
	go func() {
		for range ch {
			p.updateSize()
		}
	}()
	defer signal.Stop(ch)

	p.updateSize()

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
	if p.streamWriter != nil {
		p.streamWriter.Close()
	}
	if p.pty != nil {
		p.pty.Close()
	}
	if p.oldState != nil {
		term.Restore(int(os.Stdin.Fd()), p.oldState)
	}
	return nil
}
