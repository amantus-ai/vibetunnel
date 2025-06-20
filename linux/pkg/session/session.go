package session

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/shirou/gopsutil/v3/process"
)

// GenerateID generates a new unique session ID
func GenerateID() string {
	return uuid.New().String()
}

type Status string

const (
	StatusStarting Status = "starting"
	StatusRunning  Status = "running"
	StatusExited   Status = "exited"
)

type Config struct {
	Name      string
	Cmdline   []string
	Cwd       string
	Env       []string
	Width     int
	Height    int
	IsSpawned bool // Whether this session was spawned in a terminal
}

type Info struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Cmdline   string            `json:"cmdline"`
	Cwd       string            `json:"cwd"`
	Pid       int               `json:"pid,omitempty"`
	Status    string            `json:"status"`
	ExitCode  *int              `json:"exit_code,omitempty"`
	StartedAt time.Time         `json:"started_at"`
	Term      string            `json:"term"`
	Width     int               `json:"width"`
	Height    int               `json:"height"`
	Env       map[string]string `json:"env,omitempty"`
	Args      []string          `json:"-"`          // Internal use only
	IsSpawned bool              `json:"is_spawned"` // Whether session was spawned in terminal
}

type Session struct {
	ID          string
	controlPath string
	info        *Info
	pty         *PTY
	stdinPipe   *os.File
	stdinMutex  sync.Mutex
	mu          sync.RWMutex
}

func newSession(controlPath string, config Config) (*Session, error) {
	id := uuid.New().String()
	return newSessionWithID(controlPath, id, config)
}

func newSessionWithID(controlPath string, id string, config Config) (*Session, error) {
	sessionPath := filepath.Join(controlPath, id)

	// Only log in debug mode
	if os.Getenv("VIBETUNNEL_DEBUG") != "" {
		log.Printf("[DEBUG] Creating new session %s with config: Name=%s, Cmdline=%v, Cwd=%s",
			id[:8], config.Name, config.Cmdline, config.Cwd)
	}

	if err := os.MkdirAll(sessionPath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create session directory: %w", err)
	}

	if config.Name == "" {
		config.Name = id[:8]
	}

	// Set default command if empty
	if len(config.Cmdline) == 0 {
		shell := os.Getenv("SHELL")
		if shell == "" {
			shell = "/bin/bash"
		}
		config.Cmdline = []string{shell}
		if os.Getenv("VIBETUNNEL_DEBUG") != "" {
			log.Printf("[DEBUG] Session %s: Set default command to %v", id[:8], config.Cmdline)
		}
	}

	// Set default working directory if empty
	if config.Cwd == "" {
		cwd, err := os.Getwd()
		if err != nil {
			config.Cwd = os.Getenv("HOME")
			if config.Cwd == "" {
				config.Cwd = "/"
			}
		} else {
			config.Cwd = cwd
		}
		if os.Getenv("VIBETUNNEL_DEBUG") != "" {
			log.Printf("[DEBUG] Session %s: Set default working directory to %s", id[:8], config.Cwd)
		}
	}

	term := os.Getenv("TERM")
	if term == "" {
		term = "xterm-256color"
	}

	// Set default terminal dimensions if not provided
	width := config.Width
	if width <= 0 {
		width = 120 // Better default for modern terminals
	}
	height := config.Height
	if height <= 0 {
		height = 30 // Better default for modern terminals
	}

	info := &Info{
		ID:        id,
		Name:      config.Name,
		Cmdline:   strings.Join(config.Cmdline, " "),
		Cwd:       config.Cwd,
		Status:    string(StatusStarting),
		StartedAt: time.Now(),
		Term:      term,
		Width:     width,
		Height:    height,
		Args:      config.Cmdline,
		IsSpawned: config.IsSpawned,
	}

	if err := info.Save(sessionPath); err != nil {
		if err := os.RemoveAll(sessionPath); err != nil {
			log.Printf("[WARN] Failed to remove session path %s: %v", sessionPath, err)
		}
		return nil, fmt.Errorf("failed to save session info: %w", err)
	}

	return &Session{
		ID:          id,
		controlPath: controlPath,
		info:        info,
	}, nil
}

func loadSession(controlPath, id string) (*Session, error) {
	sessionPath := filepath.Join(controlPath, id)
	info, err := LoadInfo(sessionPath)
	if err != nil {
		return nil, err
	}

	session := &Session{
		ID:          id,
		controlPath: controlPath,
		info:        info,
	}

	// Validate that essential session files exist
	streamPath := filepath.Join(sessionPath, "stream-out")
	if _, err := os.Stat(streamPath); os.IsNotExist(err) {
		// Stream file doesn't exist - this might be an orphaned session
		if os.Getenv("VIBETUNNEL_DEBUG") != "" {
			log.Printf("[DEBUG] Session %s missing stream-out file, marking as exited", id[:8])
		}
		// Mark session as exited if it claims to be running but has no stream file
		if info.Status == string(StatusRunning) {
			info.Status = string(StatusExited)
			exitCode := 1
			info.ExitCode = &exitCode
			if err := info.Save(sessionPath); err != nil {
				log.Printf("[ERROR] Failed to save session info to %s: %v", sessionPath, err)
			}
		}
	}

	// If session is running, we need to reconnect to the PTY for operations like resize
	// For now, we'll handle this by checking if we need PTY access in individual methods

	return session, nil
}

func (s *Session) Path() string {
	return filepath.Join(s.controlPath, s.ID)
}

func (s *Session) StreamOutPath() string {
	return filepath.Join(s.Path(), "stream-out")
}

func (s *Session) StdinPath() string {
	return filepath.Join(s.Path(), "stdin")
}

func (s *Session) NotificationPath() string {
	return filepath.Join(s.Path(), "notification-stream")
}

func (s *Session) Start() error {
	pty, err := NewPTY(s)
	if err != nil {
		return fmt.Errorf("failed to create PTY: %w", err)
	}

	s.pty = pty
	s.info.Status = string(StatusRunning)
	s.info.Pid = pty.Pid()

	if err := s.info.Save(s.Path()); err != nil {
		if err := pty.Close(); err != nil {
			log.Printf("[ERROR] Failed to close PTY: %v", err)
		}
		return fmt.Errorf("failed to update session info: %w", err)
	}

	go func() {
		if err := s.pty.Run(); err != nil {
			if os.Getenv("VIBETUNNEL_DEBUG") != "" {
				log.Printf("[DEBUG] Session %s: PTY.Run() exited with error: %v", s.ID[:8], err)
			}
		} else {
			if os.Getenv("VIBETUNNEL_DEBUG") != "" {
				log.Printf("[DEBUG] Session %s: PTY.Run() exited normally", s.ID[:8])
			}
		}
	}()

	// Start control listener
	s.startControlListener()

	// Process status will be checked on first access - no artificial delay needed
	if os.Getenv("VIBETUNNEL_DEBUG") != "" {
		log.Printf("[DEBUG] Session %s: Started successfully", s.ID[:8])
	}

	return nil
}

func (s *Session) Attach() error {
	if s.pty == nil {
		return fmt.Errorf("session not started")
	}
	return s.pty.Attach()
}

func (s *Session) SendKey(key string) error {
	return s.sendInput([]byte(key))
}

func (s *Session) SendText(text string) error {
	return s.sendInput([]byte(text))
}

func (s *Session) sendInput(data []byte) error {
	s.stdinMutex.Lock()
	defer s.stdinMutex.Unlock()

	// Open pipe if not already open
	if s.stdinPipe == nil {
		stdinPath := s.StdinPath()
		pipe, err := os.OpenFile(stdinPath, os.O_WRONLY, 0)
		if err != nil {
			// If pipe fails, try Node.js proxy fallback like Rust
			if os.Getenv("VIBETUNNEL_DEBUG") != "" {
				log.Printf("[DEBUG] Failed to open stdin pipe, trying Node.js proxy fallback: %v", err)
			}
			return s.proxyInputToNodeJS(data)
		}
		s.stdinPipe = pipe
	}

	_, err := s.stdinPipe.Write(data)
	if err != nil {
		// If write fails, close and reset the pipe for next attempt
		if err := s.stdinPipe.Close(); err != nil {
			log.Printf("[ERROR] Failed to close stdin pipe: %v", err)
		}
		s.stdinPipe = nil

		// Try Node.js proxy fallback like Rust
		if os.Getenv("VIBETUNNEL_DEBUG") != "" {
			log.Printf("[DEBUG] Failed to write to stdin pipe, trying Node.js proxy fallback: %v", err)
		}
		return s.proxyInputToNodeJS(data)
	}
	return nil
}

// proxyInputToNodeJS sends input via Node.js server fallback (like Rust implementation)
func (s *Session) proxyInputToNodeJS(data []byte) error {
	client := &http.Client{
		Timeout: 5 * time.Second,
	}

	url := fmt.Sprintf("http://localhost:3000/api/sessions/%s/input", s.ID)

	payload := map[string]interface{}{
		"data": string(data),
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal input data: %w", err)
	}

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("failed to create proxy request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("node.js proxy fallback failed: %w", err)
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			log.Printf("[WARN] Failed to close response body: %v", err)
		}
	}()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("node.js proxy returned status %d: %s", resp.StatusCode, string(body))
	}

	if os.Getenv("VIBETUNNEL_DEBUG") != "" {
		log.Printf("[DEBUG] Successfully sent input via Node.js proxy for session %s", s.ID[:8])
	}

	return nil
}

func (s *Session) Signal(sig string) error {
	if s.info.Pid == 0 {
		return fmt.Errorf("no process to signal")
	}

	// Check if process is still alive before signaling
	if !s.IsAlive() {
		// Process is already dead, update status and return success
		s.info.Status = string(StatusExited)
		exitCode := 0
		s.info.ExitCode = &exitCode
		if err := s.info.Save(s.Path()); err != nil {
			log.Printf("[ERROR] Failed to save session info: %v", err)
		}
		return nil
	}

	proc, err := os.FindProcess(s.info.Pid)
	if err != nil {
		return err
	}

	switch sig {
	case "SIGTERM":
		return proc.Signal(os.Interrupt)
	case "SIGKILL":
		err = proc.Kill()
		// If kill fails with "process already finished", that's okay
		if err != nil && strings.Contains(err.Error(), "process already finished") {
			return nil
		}
		return err
	default:
		return fmt.Errorf("unsupported signal: %s", sig)
	}
}

func (s *Session) Stop() error {
	return s.Signal("SIGTERM")
}

func (s *Session) Kill() error {
	// First check if the session is already dead
	if s.info.Status == string(StatusExited) {
		// Already exited, just cleanup and return success
		s.cleanup()
		return nil
	}

	// Try to kill the process
	err := s.Signal("SIGKILL")
	s.cleanup()

	// If the error is because the process doesn't exist, that's fine
	if err != nil && (strings.Contains(err.Error(), "no such process") ||
		strings.Contains(err.Error(), "process already finished")) {
		return nil
	}

	return err
}

func (s *Session) cleanup() {
	s.stdinMutex.Lock()
	defer s.stdinMutex.Unlock()

	if s.stdinPipe != nil {
		if err := s.stdinPipe.Close(); err != nil {
			log.Printf("[ERROR] Failed to close stdin pipe: %v", err)
		}
		s.stdinPipe = nil
	}
}

func (s *Session) Resize(width, height int) error {
	if s.pty == nil {
		return fmt.Errorf("session not started")
	}

	// Check if session is still alive
	if s.info.Status == string(StatusExited) {
		return fmt.Errorf("cannot resize exited session")
	}

	// Validate dimensions
	if width <= 0 || height <= 0 {
		return fmt.Errorf("invalid dimensions: width=%d, height=%d", width, height)
	}

	// Update session info
	s.info.Width = width
	s.info.Height = height

	// Save updated session info
	if err := s.info.Save(s.Path()); err != nil {
		log.Printf("[ERROR] Failed to save session info after resize: %v", err)
	}

	// Resize the PTY
	return s.pty.Resize(width, height)
}

func (s *Session) IsAlive() bool {
	s.mu.RLock()
	pid := s.info.Pid
	status := s.info.Status
	s.mu.RUnlock()

	if pid == 0 {
		if os.Getenv("VIBETUNNEL_DEBUG") != "" {
			log.Printf("[DEBUG] IsAlive: PID is 0 for session %s", s.ID[:8])
		}
		return false
	}

	// If already marked as exited, don't check again
	if status == string(StatusExited) {
		return false
	}

	// On Windows, use gopsutil (no kill() available)
	if runtime.GOOS == "windows" {
		exists, err := process.PidExists(int32(pid))
		if err != nil {
			if os.Getenv("VIBETUNNEL_DEBUG") != "" {
				log.Printf("[DEBUG] IsAlive: Windows gopsutil failed for PID %d: %v", pid, err)
			}
			return false
		}
		if os.Getenv("VIBETUNNEL_DEBUG") != "" {
			log.Printf("[DEBUG] IsAlive: Windows gopsutil PidExists for PID %d: %t (session %s)", pid, exists, s.ID[:8])
		}
		return exists
	}

	// On POSIX systems (Linux, macOS, FreeBSD, etc.), use efficient kill(pid, 0)
	osProcess, err := os.FindProcess(pid)
	if err != nil {
		if os.Getenv("VIBETUNNEL_DEBUG") != "" {
			log.Printf("[DEBUG] IsAlive: POSIX FindProcess failed for PID %d: %v", pid, err)
		}
		return false
	}

	// Send signal 0 to check if process exists (POSIX only)
	err = osProcess.Signal(syscall.Signal(0))
	if err != nil {
		if os.Getenv("VIBETUNNEL_DEBUG") != "" {
			log.Printf("[DEBUG] IsAlive: POSIX kill(0) failed for PID %d: %v", pid, err)
		}
		return false
	}

	if os.Getenv("VIBETUNNEL_DEBUG") != "" {
		log.Printf("[DEBUG] IsAlive: POSIX kill(0) confirmed PID %d is alive (session %s)", pid, s.ID[:8])
	}
	return true
}

// IsSpawned returns whether this session was spawned in a terminal
func (s *Session) IsSpawned() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.info.IsSpawned
}

func (s *Session) UpdateStatus() error {
	if s.info.Status == string(StatusExited) {
		return nil
	}

	alive := s.IsAlive()
	if os.Getenv("VIBETUNNEL_DEBUG") != "" {
		log.Printf("[DEBUG] UpdateStatus for session %s: PID=%d, alive=%v", s.ID[:8], s.info.Pid, alive)
	}

	if !alive {
		s.info.Status = string(StatusExited)
		exitCode := 0
		s.info.ExitCode = &exitCode
		return s.info.Save(s.Path())
	}

	return nil
}

// GetInfo returns the session info
func (s *Session) GetInfo() *Info {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.info
}

func (i *Info) Save(sessionPath string) error {
	// Convert to Rust format for saving
	rustInfo := RustSessionInfo{
		ID:        i.ID,
		Name:      i.Name,
		Cmdline:   i.Args, // Use Args array instead of Cmdline string
		Cwd:       i.Cwd,
		Status:    i.Status,
		ExitCode:  i.ExitCode,
		Term:      i.Term,
		SpawnType: "pty", // Default spawn type
		Cols:      &i.Width,
		Rows:      &i.Height,
		Env:       i.Env,
	}

	// Only include Pid if non-zero
	if i.Pid > 0 {
		rustInfo.Pid = &i.Pid
	}

	// Only include StartedAt if not zero time
	if !i.StartedAt.IsZero() {
		rustInfo.StartedAt = &i.StartedAt
	}

	data, err := json.MarshalIndent(rustInfo, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(filepath.Join(sessionPath, "session.json"), data, 0644)
}

// RustSessionInfo represents the session format used by the Rust server
type RustSessionInfo struct {
	ID        string            `json:"id,omitempty"`
	Name      string            `json:"name"`
	Cmdline   []string          `json:"cmdline"`
	Cwd       string            `json:"cwd"`
	Pid       *int              `json:"pid,omitempty"`
	Status    string            `json:"status"`
	ExitCode  *int              `json:"exit_code,omitempty"`
	StartedAt *time.Time        `json:"started_at,omitempty"`
	Term      string            `json:"term"`
	SpawnType string            `json:"spawn_type,omitempty"`
	Cols      *int              `json:"cols,omitempty"`
	Rows      *int              `json:"rows,omitempty"`
	Env       map[string]string `json:"env,omitempty"`
}

func LoadInfo(sessionPath string) (*Info, error) {
	data, err := os.ReadFile(filepath.Join(sessionPath, "session.json"))
	if err != nil {
		return nil, err
	}

	// Load Rust format (the only format we support)
	var rustInfo RustSessionInfo
	if err := json.Unmarshal(data, &rustInfo); err != nil {
		return nil, fmt.Errorf("failed to parse session.json: %w", err)
	}

	// Convert Rust format to internal Info format
	info := Info{
		ID:       rustInfo.ID,
		Name:     rustInfo.Name,
		Cmdline:  strings.Join(rustInfo.Cmdline, " "),
		Cwd:      rustInfo.Cwd,
		Status:   rustInfo.Status,
		ExitCode: rustInfo.ExitCode,
		Term:     rustInfo.Term,
		Args:     rustInfo.Cmdline,
		Env:      rustInfo.Env,
	}

	// Handle PID conversion
	if rustInfo.Pid != nil {
		info.Pid = *rustInfo.Pid
	}

	// Handle dimensions: use cols/rows if available, otherwise defaults
	if rustInfo.Cols != nil {
		info.Width = *rustInfo.Cols
	} else {
		info.Width = 120
	}
	if rustInfo.Rows != nil {
		info.Height = *rustInfo.Rows
	} else {
		info.Height = 30
	}

	// Handle timestamp
	if rustInfo.StartedAt != nil {
		info.StartedAt = *rustInfo.StartedAt
	} else {
		info.StartedAt = time.Now()
	}

	// If ID is empty (Rust doesn't store it in JSON), derive it from directory name
	if info.ID == "" {
		info.ID = filepath.Base(sessionPath)
	}

	return &info, nil
}
