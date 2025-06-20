package session

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
)

// DirectOutputCallback is called when PTY output is available
type DirectOutputCallback func(sessionID string, data []byte)

type Manager struct {
	controlPath         string
	runningSessions     map[string]*Session
	mutex               sync.RWMutex
	doNotAllowColumnSet bool
	directOutputCallbacks map[string][]DirectOutputCallback
	callbackMutex       sync.RWMutex
}

func NewManager(controlPath string) *Manager {
	return &Manager{
		controlPath:           controlPath,
		runningSessions:       make(map[string]*Session),
		directOutputCallbacks: make(map[string][]DirectOutputCallback),
	}
}

// SetDoNotAllowColumnSet sets the flag to disable terminal resizing for all sessions
func (m *Manager) SetDoNotAllowColumnSet(value bool) {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	m.doNotAllowColumnSet = value
}

// GetDoNotAllowColumnSet returns the current value of the resize disable flag
func (m *Manager) GetDoNotAllowColumnSet() bool {
	m.mutex.RLock()
	defer m.mutex.RUnlock()
	return m.doNotAllowColumnSet
}

func (m *Manager) CreateSession(config Config) (*Session, error) {
	if err := os.MkdirAll(m.controlPath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create control directory: %w", err)
	}

	session, err := newSession(m.controlPath, config, m)
	if err != nil {
		return nil, err
	}

	// For spawned sessions, don't start the PTY immediately
	// The PTY will be created when the spawned terminal connects
	if !config.IsSpawned {
		if err := session.Start(); err != nil {
			if removeErr := os.RemoveAll(session.Path()); removeErr != nil {
				log.Printf("[ERROR] Failed to remove session path after start failure: %v", removeErr)
			}
			return nil, err
		}
	} else {
		if os.Getenv("VIBETUNNEL_DEBUG") != "" {
			log.Printf("[DEBUG] Created spawned session %s - waiting for terminal to attach", session.ID[:8])
		}
	}

	// Add to running sessions registry
	m.mutex.Lock()
	m.runningSessions[session.ID] = session
	m.mutex.Unlock()

	return session, nil
}

func (m *Manager) CreateSessionWithID(id string, config Config) (*Session, error) {
	if err := os.MkdirAll(m.controlPath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create control directory: %w", err)
	}

	session, err := newSessionWithID(m.controlPath, id, config, m)
	if err != nil {
		return nil, err
	}

	// For spawned sessions, don't start the PTY immediately
	// The PTY will be created when the spawned terminal connects
	if !config.IsSpawned {
		if err := session.Start(); err != nil {
			if removeErr := os.RemoveAll(session.Path()); removeErr != nil {
				log.Printf("[ERROR] Failed to remove session path after start failure: %v", removeErr)
			}
			return nil, err
		}
	} else {
		if os.Getenv("VIBETUNNEL_DEBUG") != "" {
			log.Printf("[DEBUG] Created spawned session %s with ID - waiting for terminal to attach", session.ID[:8])
		}
	}

	// Add to running sessions registry
	m.mutex.Lock()
	m.runningSessions[session.ID] = session
	m.mutex.Unlock()

	return session, nil
}

func (m *Manager) GetSession(id string) (*Session, error) {
	// First check if we have this session in our running sessions registry
	m.mutex.RLock()
	if session, exists := m.runningSessions[id]; exists {
		m.mutex.RUnlock()
		return session, nil
	}
	m.mutex.RUnlock()

	// Fall back to loading from disk (for sessions that might have been started before this manager instance)
	return loadSession(m.controlPath, id, m)
}

func (m *Manager) FindSession(nameOrID string) (*Session, error) {
	sessions, err := m.ListSessions()
	if err != nil {
		return nil, err
	}

	for _, s := range sessions {
		if s.ID == nameOrID || s.Name == nameOrID || strings.HasPrefix(s.ID, nameOrID) {
			return m.GetSession(s.ID)
		}
	}

	return nil, fmt.Errorf("session not found: %s", nameOrID)
}

func (m *Manager) ListSessions() ([]*Info, error) {
	entries, err := os.ReadDir(m.controlPath)
	if err != nil {
		if os.IsNotExist(err) {
			return []*Info{}, nil
		}
		return nil, err
	}

	sessions := make([]*Info, 0)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		session, err := loadSession(m.controlPath, entry.Name(), m)
		if err != nil {
			// Log the error when we can't load a session
			if os.Getenv("VIBETUNNEL_DEBUG") != "" {
				log.Printf("[DEBUG] Failed to load session %s: %v", entry.Name(), err)
			}
			continue
		}

		// Only update status if it's not already marked as exited to reduce CPU usage
		if session.info.Status != string(StatusExited) {
			if err := session.UpdateStatus(); err != nil {
				log.Printf("[WARN] Failed to update session status for %s: %v", session.ID, err)
			}
		}

		sessions = append(sessions, session.info)
	}

	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].StartedAt.After(sessions[j].StartedAt)
	})

	return sessions, nil
}

// CleanupExitedSessions now only updates session status to match Rust behavior
// Use RemoveExitedSessions for actual cleanup
func (m *Manager) CleanupExitedSessions() error {
	// This method now just updates statuses to match Rust implementation
	return m.UpdateAllSessionStatuses()
}

// RemoveExitedSessions actually removes dead sessions from disk (manual cleanup)
func (m *Manager) RemoveExitedSessions() error {
	sessions, err := m.ListSessions()
	if err != nil {
		return err
	}

	var errs []error
	for _, info := range sessions {
		// Check if the process is actually alive, not just the stored status
		shouldRemove := false

		if info.Pid == 0 {
			// No PID recorded, consider it exited
			shouldRemove = true
		} else {
			// Use ps command to check process status (portable across Unix systems)
			cmd := exec.Command("ps", "-p", strconv.Itoa(info.Pid), "-o", "stat=")
			output, err := cmd.Output()

			if err != nil {
				// Process doesn't exist
				shouldRemove = true
			} else {
				// Check if it's a zombie process (status starts with 'Z')
				stat := strings.TrimSpace(string(output))
				if strings.HasPrefix(stat, "Z") {
					// It's a zombie, should remove
					shouldRemove = true

					// Try to reap the zombie
					var status syscall.WaitStatus
					if _, err := syscall.Wait4(info.Pid, &status, syscall.WNOHANG, nil); err != nil {
						log.Printf("[WARN] Failed to reap zombie process %d: %v", info.Pid, err)
					}
				}
			}
		}

		if shouldRemove {
			sessionPath := filepath.Join(m.controlPath, info.ID)
			if err := os.RemoveAll(sessionPath); err != nil {
				errs = append(errs, fmt.Errorf("failed to remove %s: %w", info.ID, err))
			} else {
				fmt.Printf("Cleaned up session: %s\n", info.ID)
			}
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("cleanup errors: %v", errs)
	}

	return nil
}

// UpdateAllSessionStatuses updates the status of all sessions
func (m *Manager) UpdateAllSessionStatuses() error {
	sessions, err := m.ListSessions()
	if err != nil {
		return err
	}

	for _, info := range sessions {
		if sess, err := m.GetSession(info.ID); err == nil {
			if err := sess.UpdateStatus(); err != nil {
				log.Printf("[WARN] Failed to update session status for %s: %v", info.ID, err)
			}
		}
	}

	return nil
}

func (m *Manager) RemoveSession(id string) error {
	// Remove from running sessions registry
	m.mutex.Lock()
	delete(m.runningSessions, id)
	m.mutex.Unlock()

	// Remove direct output callbacks
	m.callbackMutex.Lock()
	delete(m.directOutputCallbacks, id)
	m.callbackMutex.Unlock()

	sessionPath := filepath.Join(m.controlPath, id)
	return os.RemoveAll(sessionPath)
}

// RegisterDirectOutputCallback registers a callback for direct PTY output (like Node.js)
func (m *Manager) RegisterDirectOutputCallback(sessionID string, callback DirectOutputCallback) {
	m.callbackMutex.Lock()
	defer m.callbackMutex.Unlock()
	
	m.directOutputCallbacks[sessionID] = append(m.directOutputCallbacks[sessionID], callback)
}

// UnregisterDirectOutputCallback removes a callback for direct PTY output
func (m *Manager) UnregisterDirectOutputCallback(sessionID string, callback DirectOutputCallback) {
	m.callbackMutex.Lock()
	defer m.callbackMutex.Unlock()
	
	callbacks := m.directOutputCallbacks[sessionID]
	for i, cb := range callbacks {
		// Compare function pointers (this is tricky, so we'll use a different approach)
		// For now, we'll clear all callbacks when unregistering
		_ = cb
		if i == 0 {
			m.directOutputCallbacks[sessionID] = nil
			break
		}
	}
}

// NotifyDirectOutput notifies all registered callbacks of new PTY output (like Node.js)
func (m *Manager) NotifyDirectOutput(sessionID string, data []byte) {
	m.callbackMutex.RLock()
	callbacks := m.directOutputCallbacks[sessionID]
	m.callbackMutex.RUnlock()
	
	// Call all registered callbacks immediately (like Node.js PTY events)
	for _, callback := range callbacks {
		go callback(sessionID, data) // Non-blocking to prevent slowdowns
	}
}

// RegisterRawPTYCallback registers a callback for raw PTY bytes (goterm-style)
type RawPTYCallback func(sessionID string, data []byte)

var rawPTYCallbacks = make(map[string][]RawPTYCallback)
var rawCallbackMutex sync.RWMutex

func (m *Manager) RegisterRawPTYCallback(sessionID string, callback RawPTYCallback) {
	rawCallbackMutex.Lock()
	defer rawCallbackMutex.Unlock()
	rawPTYCallbacks[sessionID] = append(rawPTYCallbacks[sessionID], callback)
}

func (m *Manager) UnregisterRawPTYCallback(sessionID string) {
	rawCallbackMutex.Lock()
	defer rawCallbackMutex.Unlock()
	delete(rawPTYCallbacks, sessionID)
}

func (m *Manager) NotifyRawPTY(sessionID string, data []byte) {
	rawCallbackMutex.RLock()
	callbacks := rawPTYCallbacks[sessionID]
	rawCallbackMutex.RUnlock()
	
	for _, callback := range callbacks {
		callback(sessionID, data) // Direct call - no goroutine for raw speed
	}
}
