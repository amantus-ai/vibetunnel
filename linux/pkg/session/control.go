package session

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

// ControlCommand represents a command sent through the control FIFO
type ControlCommand struct {
	Cmd  string `json:"cmd"`
	Cols int    `json:"cols,omitempty"`
	Rows int    `json:"rows,omitempty"`
}

// createControlFIFO creates the control FIFO for a session
func (s *Session) createControlFIFO() error {
	controlPath := filepath.Join(s.Path(), "control")

	// Remove existing FIFO if it exists
	if err := os.Remove(controlPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove existing control FIFO: %w", err)
	}

	// Create new FIFO
	if err := syscall.Mkfifo(controlPath, 0600); err != nil {
		return fmt.Errorf("failed to create control FIFO: %w", err)
	}

	debugLog("[DEBUG] Created control FIFO at %s", controlPath)
	return nil
}

// startControlListener starts listening for control commands
func (s *Session) startControlListener() {
	controlPath := filepath.Join(s.Path(), "control")

	go func() {
		for {
			// Check if session is still running
			s.mu.RLock()
			if s.info.Status == string(StatusExited) {
				s.mu.RUnlock()
				break
			}
			s.mu.RUnlock()

			// Open control FIFO in non-blocking mode
			fd, err := syscall.Open(controlPath, syscall.O_RDONLY|syscall.O_NONBLOCK, 0)
			if err != nil {
				log.Printf("[ERROR] Failed to open control FIFO: %v", err)
				time.Sleep(1 * time.Second)
				continue
			}

			file := os.NewFile(uintptr(fd), controlPath)
			decoder := json.NewDecoder(file)

			// Read commands from FIFO
			for {
				var cmd ControlCommand
				if err := decoder.Decode(&cmd); err != nil {
					// Check if it's just EOF (no data available)
					if err.Error() != "EOF" && err.Error() != "read /dev/stdin: resource temporarily unavailable" {
						debugLog("[DEBUG] Control FIFO decode error: %v", err)
					}
					break
				}

				// Process command
				s.handleControlCommand(&cmd)
			}

			file.Close()

			// Longer delay before reopening to reduce CPU usage
			time.Sleep(1 * time.Second)
		}

		debugLog("[DEBUG] Control listener stopped for session %s", s.ID[:8])
	}()
}

// handleControlCommand processes a control command
func (s *Session) handleControlCommand(cmd *ControlCommand) {
	debugLog("[DEBUG] Received control command for session %s: %+v", s.ID[:8], cmd)

	switch cmd.Cmd {
	case "resize":
		if cmd.Cols > 0 && cmd.Rows > 0 {
			if err := s.Resize(cmd.Cols, cmd.Rows); err != nil {
				log.Printf("[ERROR] Failed to resize session %s: %v", s.ID[:8], err)
			}
		}
	default:
		log.Printf("[WARN] Unknown control command: %s", cmd.Cmd)
	}
}

// SendControlCommand sends a command to a session's control FIFO
func SendControlCommand(sessionPath string, cmd *ControlCommand) error {
	controlPath := filepath.Join(sessionPath, "control")

	// Open FIFO with timeout
	done := make(chan error, 1)
	go func() {
		file, err := os.OpenFile(controlPath, os.O_WRONLY, 0)
		if err != nil {
			done <- err
			return
		}
		defer file.Close()

		encoder := json.NewEncoder(file)
		if err := encoder.Encode(cmd); err != nil {
			done <- err
			return
		}

		done <- nil
	}()

	// Wait with timeout
	select {
	case err := <-done:
		return err
	case <-time.After(1 * time.Second):
		return fmt.Errorf("timeout sending control command")
	}
}
