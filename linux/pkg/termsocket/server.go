package termsocket

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	// DefaultSocketPath is the default Unix socket path for terminal spawning
	DefaultSocketPath = "/tmp/vibetunnel-terminal.sock"
)

// SpawnRequest represents a request to spawn a terminal
type SpawnRequest struct {
	Command    string `json:"command"`
	WorkingDir string `json:"workingDir"`
	SessionID  string `json:"sessionId"`
	TTYFwdPath string `json:"ttyFwdPath"`
	Terminal   string `json:"terminal,omitempty"`
}

// SpawnResponse represents the response from a spawn request
type SpawnResponse struct {
	Success   bool   `json:"success"`
	Error     string `json:"error,omitempty"`
	SessionID string `json:"sessionId,omitempty"`
}

// Server handles terminal spawn requests via Unix socket
type Server struct {
	socketPath string
	listener   net.Listener
	mu         sync.RWMutex
	handlers   map[string]SpawnHandler
	running    bool
	wg         sync.WaitGroup
}

// SpawnHandler is called when a spawn request is received
type SpawnHandler func(req *SpawnRequest) error

// NewServer creates a new terminal socket server
func NewServer(socketPath string) *Server {
	if socketPath == "" {
		socketPath = DefaultSocketPath
	}
	return &Server{
		socketPath: socketPath,
		handlers:   make(map[string]SpawnHandler),
	}
}

// RegisterHandler registers a spawn handler
func (s *Server) RegisterHandler(terminal string, handler SpawnHandler) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.handlers[terminal] = handler
}

// RegisterDefaultHandler registers the default spawn handler
func (s *Server) RegisterDefaultHandler(handler SpawnHandler) {
	s.RegisterHandler("", handler)
}

// Start starts the Unix socket server
func (s *Server) Start() error {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return fmt.Errorf("server already running")
	}
	s.mu.Unlock()

	// Remove existing socket if it exists
	if err := os.RemoveAll(s.socketPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove existing socket: %w", err)
	}

	// Ensure socket directory exists
	socketDir := filepath.Dir(s.socketPath)
	if err := os.MkdirAll(socketDir, 0755); err != nil {
		return fmt.Errorf("failed to create socket directory: %w", err)
	}

	// Create Unix socket listener
	listener, err := net.Listen("unix", s.socketPath)
	if err != nil {
		return fmt.Errorf("failed to create Unix socket: %w", err)
	}

	// Set socket permissions
	if err := os.Chmod(s.socketPath, 0600); err != nil {
		if closeErr := listener.Close(); closeErr != nil {
			log.Printf("[ERROR] Failed to close listener: %v", closeErr)
		}
		return fmt.Errorf("failed to set socket permissions: %w", err)
	}

	s.mu.Lock()
	s.listener = listener
	s.running = true
	s.mu.Unlock()

	// Start accepting connections
	s.wg.Add(1)
	go s.acceptLoop()

	log.Printf("[INFO] Terminal socket server listening on %s", s.socketPath)
	return nil
}

// Stop stops the Unix socket server
func (s *Server) Stop() error {
	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return nil
	}
	s.running = false
	listener := s.listener
	s.mu.Unlock()

	if listener != nil {
		if err := listener.Close(); err != nil {
			log.Printf("[ERROR] Failed to close listener: %v", err)
		}
	}

	// Wait for all handlers to complete
	s.wg.Wait()

	// Remove socket file
	if err := os.Remove(s.socketPath); err != nil && !os.IsNotExist(err) {
		log.Printf("[ERROR] Failed to remove socket file: %v", err)
	}

	log.Printf("[INFO] Terminal socket server stopped")
	return nil
}

// IsRunning returns whether the server is running
func (s *Server) IsRunning() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.running
}

func (s *Server) acceptLoop() {
	defer s.wg.Done()

	for {
		conn, err := s.listener.Accept()
		if err != nil {
			s.mu.RLock()
			running := s.running
			s.mu.RUnlock()

			if !running {
				// Server is shutting down
				return
			}
			log.Printf("[ERROR] Failed to accept connection: %v", err)
			continue
		}

		s.wg.Add(1)
		go s.handleConnection(conn)
	}
}

func (s *Server) handleConnection(conn net.Conn) {
	defer s.wg.Done()
	defer func() {
		if err := conn.Close(); err != nil {
			log.Printf("[ERROR] Failed to close connection: %v", err)
		}
	}()

	// Decode request
	var req SpawnRequest
	decoder := json.NewDecoder(conn)
	if err := decoder.Decode(&req); err != nil {
		log.Printf("[ERROR] Failed to decode spawn request: %v", err)
		s.sendResponse(conn, &SpawnResponse{
			Success: false,
			Error:   fmt.Sprintf("Failed to decode request: %v", err),
		})
		return
	}

	log.Printf("[INFO] Received spawn request: sessionId=%s, terminal=%s", req.SessionID, req.Terminal)

	// Get appropriate handler
	s.mu.RLock()
	handler, ok := s.handlers[req.Terminal]
	if !ok {
		// Try default handler
		handler = s.handlers[""]
	}
	s.mu.RUnlock()

	if handler == nil {
		s.sendResponse(conn, &SpawnResponse{
			Success: false,
			Error:   fmt.Sprintf("No handler for terminal type: %s", req.Terminal),
		})
		return
	}

	// Execute handler
	if err := handler(&req); err != nil {
		log.Printf("[ERROR] Spawn handler failed: %v", err)
		s.sendResponse(conn, &SpawnResponse{
			Success: false,
			Error:   err.Error(),
		})
		return
	}

	// Send success response
	s.sendResponse(conn, &SpawnResponse{
		Success:   true,
		SessionID: req.SessionID,
	})
}

func (s *Server) sendResponse(conn net.Conn, resp *SpawnResponse) {
	encoder := json.NewEncoder(conn)
	if err := encoder.Encode(resp); err != nil {
		log.Printf("[ERROR] Failed to send response: %v", err)
	}
}

// TryConnect attempts to connect to an existing terminal socket server with timeout
func TryConnect(socketPath string) (net.Conn, error) {
	if socketPath == "" {
		socketPath = DefaultSocketPath
	}

	// Check if socket exists
	if _, err := os.Stat(socketPath); err != nil {
		return nil, fmt.Errorf("socket not found: %w", err)
	}

	// Try to connect with timeout
	dialer := net.Dialer{
		Timeout: 5 * time.Second,
	}
	conn, err := dialer.Dial("unix", socketPath)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to socket: %w", err)
	}

	// Set read/write timeout for ongoing operations
	if err := conn.SetDeadline(time.Now().Add(30 * time.Second)); err != nil {
		log.Printf("[WARN] Failed to set connection deadline: %v", err)
	}

	return conn, nil
}

// SendSpawnRequest sends a spawn request to the terminal socket server
func SendSpawnRequest(conn net.Conn, req *SpawnRequest) (*SpawnResponse, error) {
	// Send request
	encoder := json.NewEncoder(conn)
	if err := encoder.Encode(req); err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}

	// Read response
	var resp SpawnResponse
	decoder := json.NewDecoder(conn)
	if err := decoder.Decode(&resp); err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	return &resp, nil
}

// FormatCommand formats a command for the spawn request
func FormatCommand(sessionID, ttyFwdPath string, cmdline []string) string {
	// Format: TTY_SESSION_ID="uuid" /path/to/vibetunnel -- command args
	escapedArgs := make([]string, len(cmdline))
	for i, arg := range cmdline {
		if strings.Contains(arg, " ") || strings.Contains(arg, "\"") {
			// Escape quotes and wrap in quotes
			escaped := strings.ReplaceAll(arg, "\"", "\\\"")
			escapedArgs[i] = fmt.Sprintf("\"%s\"", escaped)
		} else {
			escapedArgs[i] = arg
		}
	}

	return fmt.Sprintf("TTY_SESSION_ID=\"%s\" \"%s\" -- %s",
		sessionID, ttyFwdPath, strings.Join(escapedArgs, " "))
}
