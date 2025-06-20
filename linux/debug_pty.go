package main

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"github.com/creack/pty"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)

	// Test different shell configurations
	tests := []struct {
		name    string
		cmd     []string
		workDir string
	}{
		{"zsh", []string{"zsh"}, "/Users/hjanuschka/agent-1"},
		{"zsh-interactive", []string{"zsh", "-i"}, "/Users/hjanuschka/agent-1"},
		{"bash", []string{"/bin/bash"}, "/Users/hjanuschka/agent-1"},
		{"bash-interactive", []string{"/bin/bash", "-i"}, "/Users/hjanuschka/agent-1"},
		{"sh", []string{"/bin/sh"}, "/Users/hjanuschka/agent-1"},
		{"sh-interactive", []string{"/bin/sh", "-i"}, "/Users/hjanuschka/agent-1"},
	}

	for _, test := range tests {
		fmt.Printf("\n=== Testing: %s ===\n", test.name)
		testShellSpawn(test.cmd, test.workDir)
		time.Sleep(1 * time.Second)
	}
}

func testShellSpawn(cmdline []string, workDir string) {
	log.Printf("Starting command: %v in directory: %s", cmdline, workDir)

	// Check if working directory exists
	if _, err := os.Stat(workDir); err != nil {
		log.Printf("Working directory %s not accessible: %v", workDir, err)
		return
	}

	// Create command
	cmd := exec.Command(cmdline[0], cmdline[1:]...)
	cmd.Dir = workDir

	// Set up environment
	env := os.Environ()
	env = append(env, "TERM=xterm-256color")
	env = append(env, "SHELL="+cmdline[0])
	cmd.Env = env

	log.Printf("Command setup: %s, Args: %v, Dir: %s", cmd.Path, cmd.Args, cmd.Dir)

	// Start PTY
	ptmx, err := pty.Start(cmd)
	if err != nil {
		log.Printf("Failed to start PTY: %v", err)
		return
	}
	defer func() {
		if err := ptmx.Close(); err != nil {
			log.Printf("[ERROR] Failed to close PTY: %v", err)
		}
		if cmd.Process != nil {
			if err := cmd.Process.Kill(); err != nil {
				log.Printf("[ERROR] Failed to kill process: %v", err)
			}
		}
	}()

	log.Printf("PTY started successfully, PID: %d", cmd.Process.Pid)

	// Set PTY size
	if err := pty.Setsize(ptmx, &pty.Winsize{Rows: 24, Cols: 80}); err != nil {
		log.Printf("Failed to set PTY size: %v", err)
	}

	// Monitor process for a few seconds
	done := make(chan error, 1)
	go func() {
		done <- cmd.Wait()
	}()

	// Read initial output for 3 seconds
	outputDone := make(chan bool)
	go func() {
		defer func() { outputDone <- true }()
		buf := make([]byte, 1024)
		timeout := time.After(3 * time.Second)

		for {
			select {
			case <-timeout:
				log.Printf("Output reading timeout")
				return
			default:
				if err := ptmx.SetReadDeadline(time.Now().Add(100 * time.Millisecond)); err != nil {
					log.Printf("[ERROR] Failed to set read deadline: %v", err)
				}
				n, err := ptmx.Read(buf)
				if n > 0 {
					output := strings.TrimSpace(string(buf[:n]))
					if output != "" {
						log.Printf("PTY output: %q", output)
					}
				}
				if err != nil && err != os.ErrDeadlineExceeded {
					if err != io.EOF {
						log.Printf("PTY read error: %v", err)
					}
					return
				}
			}
		}
	}()

	// Send a simple command to test interactivity
	time.Sleep(500 * time.Millisecond)
	log.Printf("Sending test command: 'echo hello'")
	if _, err := ptmx.Write([]byte("echo hello\n")); err != nil {
		log.Printf("[ERROR] Failed to write to PTY: %v", err)
	}

	// Wait for either process exit or timeout
	select {
	case err := <-done:
		if err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				if status, ok := exitErr.Sys().(syscall.WaitStatus); ok {
					log.Printf("Process exited with code: %d", status.ExitStatus())
				} else {
					log.Printf("Process exited with error: %v", err)
				}
			} else {
				log.Printf("Process exited with error: %v", err)
			}
		} else {
			log.Printf("Process exited normally (code 0)")
		}
	case <-time.After(5 * time.Second):
		log.Printf("Process still running after 5 seconds - looks good!")
		if cmd.Process != nil {
			if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
				log.Printf("[ERROR] Failed to send SIGTERM: %v", err)
			}
			select {
			case <-done:
				log.Printf("Process terminated")
			case <-time.After(2 * time.Second):
				log.Printf("Process didn't respond to SIGTERM, killing")
				if err := cmd.Process.Kill(); err != nil {
					log.Printf("[ERROR] Failed to kill process: %v", err)
				}
			}
		}
	}

	<-outputDone
}
