package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/gorilla/mux"
	"github.com/vibetunnel/linux/pkg/ngrok"
	"github.com/vibetunnel/linux/pkg/session"
	"github.com/vibetunnel/linux/pkg/terminal"
	"github.com/vibetunnel/linux/pkg/termsocket"
)

// debugLog logs debug messages only if VIBETUNNEL_DEBUG is set
func debugLog(format string, args ...interface{}) {
	if os.Getenv("VIBETUNNEL_DEBUG") != "" {
		log.Printf(format, args...)
	}
}

type Server struct {
	manager              *session.Manager
	staticPath           string
	password             string
	ngrokService         *ngrok.Service
	port                 int
	noSpawn              bool
	doNotAllowColumnSet  bool
}

func NewServer(manager *session.Manager, staticPath, password string, port int) *Server {
	return &Server{
		manager:      manager,
		staticPath:   staticPath,
		password:     password,
		ngrokService: ngrok.NewService(),
		port:         port,
	}
}

func (s *Server) SetNoSpawn(noSpawn bool) {
	s.noSpawn = noSpawn
}

func (s *Server) SetDoNotAllowColumnSet(doNotAllowColumnSet bool) {
	s.doNotAllowColumnSet = doNotAllowColumnSet
}

func (s *Server) Start(addr string) error {
	handler := s.createHandler()
	
	// Setup graceful shutdown
	srv := &http.Server{
		Addr:    addr,
		Handler: handler,
	}
	
	// Handle shutdown signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	
	go func() {
		<-sigChan
		fmt.Println("\nShutting down server...")
		
		// Mark all running sessions as exited
		if sessions, err := s.manager.ListSessions(); err == nil {
			for _, session := range sessions {
				if session.Status == "running" || session.Status == "starting" {
					if sess, err := s.manager.GetSession(session.ID); err == nil {
						sess.UpdateStatus()
					}
				}
			}
		}
		
		
		// Shutdown HTTP server
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(ctx)
	}()
	
	return srv.ListenAndServe()
}

func (s *Server) createHandler() http.Handler {
	r := mux.NewRouter()

	api := r.PathPrefix("/api").Subrouter()
	if s.password != "" {
		api.Use(s.basicAuthMiddleware)
	}

	api.HandleFunc("/health", s.handleHealth).Methods("GET")
	api.HandleFunc("/sessions", s.handleListSessions).Methods("GET")
	api.HandleFunc("/sessions", s.handleCreateSession).Methods("POST")
	api.HandleFunc("/sessions/{id}", s.handleGetSession).Methods("GET")
	api.HandleFunc("/sessions/{id}/stream", s.handleStreamSession).Methods("GET")
	api.HandleFunc("/sessions/{id}/snapshot", s.handleSnapshotSession).Methods("GET")
	api.HandleFunc("/sessions/{id}/input", s.handleSendInput).Methods("POST")
	api.HandleFunc("/sessions/{id}", s.handleKillSession).Methods("DELETE")
	api.HandleFunc("/sessions/{id}/cleanup", s.handleCleanupSession).Methods("DELETE")
	api.HandleFunc("/sessions/{id}/cleanup", s.handleCleanupSession).Methods("POST") // Alternative method
	api.HandleFunc("/sessions/{id}/resize", s.handleResizeSession).Methods("POST")
	api.HandleFunc("/sessions/multistream", s.handleMultistream).Methods("GET")
	api.HandleFunc("/cleanup-exited", s.handleCleanupExited).Methods("POST")
	api.HandleFunc("/fs/browse", s.handleBrowseFS).Methods("GET")
	api.HandleFunc("/mkdir", s.handleMkdir).Methods("POST")

	// Ngrok endpoints
	api.HandleFunc("/ngrok/start", s.handleNgrokStart).Methods("POST")
	api.HandleFunc("/ngrok/stop", s.handleNgrokStop).Methods("POST")
	api.HandleFunc("/ngrok/status", s.handleNgrokStatus).Methods("GET")

	// WebSocket endpoint for binary terminal streaming
	bufferHandler := NewBufferWebSocketHandler(s.manager)
	// Apply authentication middleware if password is set
	if s.password != "" {
		r.Handle("/buffers", s.basicAuthMiddleware(bufferHandler))
	} else {
		r.Handle("/buffers", bufferHandler)
	}

	if s.staticPath != "" {
		// Serve static files with index.html fallback for directories
		r.PathPrefix("/").HandlerFunc(s.serveStaticWithIndex)
	}

	return r
}

func (s *Server) basicAuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if auth == "" {
			s.unauthorized(w)
			return
		}

		const prefix = "Basic "
		if !strings.HasPrefix(auth, prefix) {
			s.unauthorized(w)
			return
		}

		decoded, err := base64.StdEncoding.DecodeString(auth[len(prefix):])
		if err != nil {
			s.unauthorized(w)
			return
		}

		parts := strings.SplitN(string(decoded), ":", 2)
		if len(parts) != 2 || parts[0] != "admin" || parts[1] != s.password {
			s.unauthorized(w)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (s *Server) serveStaticWithIndex(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path

	// Add CORS headers (like Rust server)
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// Clean the path
	if path == "/" {
		path = "/index.html"
	}

	// Log the request for debugging
	debugLog("[DEBUG] Static request: %s -> %s (static path: %s)", r.URL.Path, path, s.staticPath)

	// Try to serve the file
	fullPath := filepath.Join(s.staticPath, filepath.Clean(path))

	// Check if it's a directory
	info, err := os.Stat(fullPath)
	if err == nil && info.IsDir() {
		// Try to serve index.html from the directory
		indexPath := filepath.Join(fullPath, "index.html")
		if _, err := os.Stat(indexPath); err == nil {
			debugLog("[DEBUG] Serving directory index: %s", indexPath)
			http.ServeFile(w, r, indexPath)
			return
		}
	}

	// Check if file exists
	if err == nil && !info.IsDir() {
		// File exists, serve it
		debugLog("[DEBUG] Serving file: %s", fullPath)
		http.ServeFile(w, r, fullPath)
		return
	}

	// File doesn't exist - SPA fallback
	// For any non-existent path, serve the root index.html
	// This allows client-side routing to handle the route
	indexPath := filepath.Join(s.staticPath, "index.html")
	if _, err := os.Stat(indexPath); err == nil {
		debugLog("[DEBUG] SPA fallback - serving index.html for: %s", r.URL.Path)
		http.ServeFile(w, r, indexPath)
		return
	}

	// If even index.html doesn't exist, return 404
	log.Printf("[ERROR] Static path not configured correctly - index.html not found at: %s", indexPath)
	log.Printf("[ERROR] Static path is: %s", s.staticPath)
	http.NotFound(w, r)
}

func (s *Server) unauthorized(w http.ResponseWriter) {
	w.Header().Set("WWW-Authenticate", `Basic realm="VibeTunnel"`)
	http.Error(w, "Unauthorized", http.StatusUnauthorized)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	sessions, err := s.manager.ListSessions()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Convert to API response format
	type APISessionInfo struct {
		ID           string    `json:"id"`
		Name         string    `json:"name"`
		Command      string    `json:"command"`      
		WorkingDir   string    `json:"workingDir"`   
		Pid          *int      `json:"pid,omitempty"`
		Status       string    `json:"status"`
		ExitCode     *int      `json:"exitCode,omitempty"`     
		StartedAt    time.Time `json:"startedAt"`               
		Term         string    `json:"term"`
		Width        int       `json:"width"`
		Height       int       `json:"height"`
		Env          map[string]string `json:"env,omitempty"`
		LastModified time.Time `json:"lastModified"`           
	}

	apiSessions := make([]APISessionInfo, len(sessions))
	for i, s := range sessions {
		// Convert PID to pointer for omitempty behavior
		var pid *int
		if s.Pid > 0 {
			pid = &s.Pid
		}
		
		apiSessions[i] = APISessionInfo{
			ID:           s.ID,
			Name:         s.Name,
			Command:      s.Cmdline,  // Already a string
			WorkingDir:   s.Cwd,
			Pid:          pid,
			Status:       s.Status,
			ExitCode:     s.ExitCode,
			StartedAt:    s.StartedAt,
			Term:         s.Term,
			Width:        s.Width,
			Height:       s.Height,
			Env:          s.Env,
			LastModified: s.StartedAt, // Use StartedAt as LastModified for now
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(apiSessions)
}

func (s *Server) handleCreateSession(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name          string   `json:"name"`
		Command       []string `json:"command"`        // Rust API format
		WorkingDir    string   `json:"workingDir"`     // Rust API format
		Cols          int      `json:"cols"`           // Terminal columns
		Rows          int      `json:"rows"`           // Terminal rows
		SpawnTerminal bool     `json:"spawn_terminal"` // Open in native terminal
		Term          string   `json:"term"`           // Terminal type (e.g., "ghostty")
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body. Expected JSON with 'command' array and optional 'workingDir'", http.StatusBadRequest)
		return
	}

	if len(req.Command) == 0 {
		http.Error(w, "Command array is required", http.StatusBadRequest)
		return
	}

	cmdline := req.Command
	cwd := req.WorkingDir

	// Set default terminal dimensions if not provided
	cols := req.Cols
	if cols <= 0 {
		cols = 120 // Better default for modern terminals
	}
	rows := req.Rows
	if rows <= 0 {
		rows = 30 // Better default for modern terminals
	}

	// Handle working directory
	if cwd != "" {
		// Expand ~ in working directory
		if cwd[0] == '~' {
			if cwd == "~" || cwd[:2] == "~/" {
				homeDir, err := os.UserHomeDir()
				if err == nil {
					if cwd == "~" {
						cwd = homeDir
					} else {
						cwd = filepath.Join(homeDir, cwd[2:])
					}
				}
			}
		}
		
		// Validate the working directory exists
		if _, err := os.Stat(cwd); err != nil {
			log.Printf("[WARN] Working directory '%s' not accessible: %v. Using home directory instead.", cwd, err)
			// Fall back to home directory
			homeDir, err := os.UserHomeDir()
			if err != nil {
				log.Printf("[ERROR] Failed to get home directory: %v", err)
				cwd = "" // Let PTY decide the default
			} else {
				cwd = homeDir
			}
		}
	} else {
		// No working directory specified, use home directory
		homeDir, err := os.UserHomeDir()
		if err == nil {
			cwd = homeDir
		}
	}

	// Check if we should spawn in a terminal
	if req.SpawnTerminal && !s.noSpawn {
		// Try to use the Mac app's terminal spawn service first
		if conn, err := termsocket.TryConnect(""); err == nil {
			defer conn.Close()

			// Generate a session ID
			sessionID := session.GenerateID()

			// Get vt binary path (not vibetunnel)
			vtPath := findVTBinary()
			if vtPath == "" {
				log.Printf("[ERROR] vt binary not found")
				http.Error(w, "vt binary not found", http.StatusInternalServerError)
				return
			}

			// Format spawn request - this will be sent to the Mac app
			spawnReq := &termsocket.SpawnRequest{
				Command:    termsocket.FormatCommand(sessionID, vtPath, cmdline),
				WorkingDir: cwd,
				SessionID:  sessionID,
				TTYFwdPath: vtPath,
				Terminal:   req.Term,
			}

			// Create the session first with the specified ID
			sess, err := s.manager.CreateSessionWithID(sessionID, session.Config{
				Name:      req.Name,
				Cmdline:   cmdline,
				Cwd:       cwd,
				Width:     cols,
				Height:    rows,
				IsSpawned: true, // This is a spawned session
			})
			if err != nil {
				log.Printf("[ERROR] Failed to create session: %v", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}

			// Send spawn request to Mac app
			resp, err := termsocket.SendSpawnRequest(conn, spawnReq)
			if err != nil {
				log.Printf("[ERROR] Failed to send terminal spawn request: %v", err)
				// Clean up the session since spawn failed
				s.manager.RemoveSession(sess.ID)
				http.Error(w, fmt.Sprintf("Failed to spawn terminal: %v", err), http.StatusInternalServerError)
				return
			}

			if !resp.Success {
				errorMsg := resp.Error
				if errorMsg == "" {
					errorMsg = "Unknown error"
				}
				log.Printf("[ERROR] Terminal spawn failed: %s", errorMsg)
				// Clean up the session since spawn failed
				s.manager.RemoveSession(sess.ID)
				http.Error(w, fmt.Sprintf("Terminal spawn failed: %s", errorMsg), http.StatusInternalServerError)
				return
			}

			log.Printf("[INFO] Successfully spawned terminal session via Mac app: %s", sessionID)

			// Return success response
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success":   true,
				"message":   "Terminal session spawned successfully",
				"error":     nil,
				"sessionId": sessionID,
			})
			return
		} else {
			// Mac app terminal spawn service not available - fallback to native terminal spawning
			log.Printf("[INFO] Mac app socket not available (%v), falling back to native terminal spawn", err)

			// Create session locally
			sess, err := s.manager.CreateSession(session.Config{
				Name:      req.Name,
				Cmdline:   cmdline,
				Cwd:       cwd,
				Width:     cols,
				Height:    rows,
				IsSpawned: true, // This is a spawned session
			})
			if err != nil {
				log.Printf("[ERROR] Failed to create session: %v", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}

			// Get vt binary path (not vibetunnel)
			vtPath := findVTBinary()
			if vtPath == "" {
				log.Printf("[ERROR] vt binary not found for native terminal spawn")
				s.manager.RemoveSession(sess.ID)
				http.Error(w, "vt binary not found", http.StatusInternalServerError)
				return
			}

			// Spawn terminal using native method
			if err := terminal.SpawnInTerminal(sess.ID, vtPath, cmdline, cwd); err != nil {
				log.Printf("[ERROR] Failed to spawn native terminal: %v", err)
				// Clean up the session since terminal spawn failed
				s.manager.RemoveSession(sess.ID)
				http.Error(w, fmt.Sprintf("Failed to spawn terminal: %v", err), http.StatusInternalServerError)
				return
			}

			log.Printf("[INFO] Successfully spawned terminal session natively: %s", sess.ID)

			// Return success response
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success":   true,
				"message":   "Terminal session spawned successfully (native)",
				"error":     nil,
				"sessionId": sess.ID,
			})
			return
		}
	}

	// Regular session creation
	sess, err := s.manager.CreateSession(session.Config{
		Name:      req.Name,
		Cmdline:   cmdline,
		Cwd:       cwd,
		Width:     cols,
		Height:    rows,
		IsSpawned: false, // This is not a spawned session (detached)
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":   true,
		"message":   "Session created successfully",
		"error":     nil,
		"sessionId": sess.ID,
	})
}

func (s *Server) handleGetSession(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sess, err := s.manager.GetSession(vars["id"])
	if err != nil {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	// Get session info and convert to Rust-compatible format
	info := sess.GetInfo()
	if info == nil {
		http.Error(w, "Session info not available", http.StatusInternalServerError)
		return
	}

	// Update status on-demand
	sess.UpdateStatus()
	
	// Convert to Rust-compatible format like in handleListSessions
	rustInfo := session.RustSessionInfo{
		ID:        info.ID,
		Name:      info.Name,
		Cmdline:   info.Args,
		Cwd:       info.Cwd,
		Status:    info.Status,
		ExitCode:  info.ExitCode,
		Term:      info.Term,
		SpawnType: "pty",
		Cols:      &info.Width,
		Rows:      &info.Height,
		Env:       info.Env,
	}
	
	if info.Pid > 0 {
		rustInfo.Pid = &info.Pid
	}
	
	if !info.StartedAt.IsZero() {
		rustInfo.StartedAt = &info.StartedAt
	}
	
	// Convert to API response format with camelCase like Rust
	response := map[string]interface{}{
		"id":          rustInfo.ID,
		"name":        rustInfo.Name,
		"command":     strings.Join(rustInfo.Cmdline, " "),
		"workingDir":  rustInfo.Cwd,
		"pid":         rustInfo.Pid,
		"status":      rustInfo.Status,
		"exitCode":    rustInfo.ExitCode,
		"startedAt":   rustInfo.StartedAt,
		"term":        rustInfo.Term,
		"width":       rustInfo.Cols,
		"height":      rustInfo.Rows,
		"env":         rustInfo.Env,
	}
	
	// Add lastModified like Rust does
	if stat, err := os.Stat(sess.Path()); err == nil {
		response["lastModified"] = stat.ModTime()
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (s *Server) handleStreamSession(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sess, err := s.manager.GetSession(vars["id"])
	if err != nil {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	streamer := NewSSEStreamer(w, sess)
	streamer.Stream()
}

func (s *Server) handleSnapshotSession(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sess, err := s.manager.GetSession(vars["id"])
	if err != nil {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	snapshot, err := GetSessionSnapshot(sess)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(snapshot)
}

func (s *Server) handleSendInput(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sess, err := s.manager.GetSession(vars["id"])
	if err != nil {
		log.Printf("[ERROR] handleSendInput: Session %s not found", vars["id"])
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	var req struct {
		Input string `json:"input"`
		Text  string `json:"text"` // Alternative field name
		Type  string `json:"type"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("[ERROR] handleSendInput: Failed to decode request: %v", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Handle alternative field names for compatibility
	input := req.Input
	if input == "" && req.Text != "" {
		input = req.Text
	}

	// Define special keys exactly as in Swift/macOS version
	specialKeys := map[string]string{
		"arrow_up":    "\x1b[A",
		"arrow_down":  "\x1b[B",
		"arrow_right": "\x1b[C",
		"arrow_left":  "\x1b[D",
		"escape":      "\x1b",
		"enter":       "\r",       // CR, not LF (to match Swift)
		"ctrl_enter":  "\r",       // CR for ctrl+enter
		"shift_enter": "\x1b\x0d", // ESC + CR for shift+enter
	}

	// Check if this is a special key (automatic detection like Swift version)
	if mappedKey, isSpecialKey := specialKeys[input]; isSpecialKey {
		debugLog("[DEBUG] handleSendInput: Sending special key '%s' (%q) to session %s", input, mappedKey, sess.ID[:8])
		err = sess.SendKey(mappedKey)
	} else {
		debugLog("[DEBUG] handleSendInput: Sending text '%s' to session %s", input, sess.ID[:8])
		err = sess.SendText(input)
	}

	if err != nil {
		log.Printf("[ERROR] handleSendInput: Failed to send input: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	debugLog("[DEBUG] handleSendInput: Successfully sent input to session %s", sess.ID[:8])
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleKillSession(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sess, err := s.manager.GetSession(vars["id"])
	if err != nil {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	// Update session status before attempting kill
	sess.UpdateStatus()

	// Check if session is already dead
	info := sess.GetInfo()
	if info != nil && info.Status == string(session.StatusExited) {
		// Return 410 Gone for already dead sessions
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusGone)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "Session already exited",
		})
		return
	}

	if err := sess.Kill(); err != nil {
		log.Printf("[ERROR] Failed to kill session %s: %v", vars["id"], err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Session deleted successfully",
	})
}

func (s *Server) handleCleanupSession(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	if err := s.manager.RemoveSession(vars["id"]); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleCleanupExited(w http.ResponseWriter, r *http.Request) {
	if err := s.manager.RemoveExitedSessions(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleMultistream(w http.ResponseWriter, r *http.Request) {
	sessionIDs := r.URL.Query()["session_id"]
	if len(sessionIDs) == 0 {
		http.Error(w, "No session IDs provided", http.StatusBadRequest)
		return
	}

	streamer := NewMultiSSEStreamer(w, s.manager, sessionIDs)
	streamer.Stream()
}

func (s *Server) handleBrowseFS(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		path = "~"
	}

	log.Printf("[DEBUG] Browse directory request for path: %s", path)

	// Expand ~ to home directory
	if path == "~" || strings.HasPrefix(path, "~/") {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			log.Printf("[ERROR] Failed to get home directory: %v", err)
			http.Error(w, "Failed to get home directory", http.StatusInternalServerError)
			return
		}
		if path == "~" {
			path = homeDir
		} else {
			path = filepath.Join(homeDir, path[2:])
		}
	}

	// Ensure the path is absolute
	absPath, err := filepath.Abs(path)
	if err != nil {
		log.Printf("[ERROR] Failed to get absolute path for %s: %v", path, err)
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	entries, err := BrowseDirectory(absPath)
	if err != nil {
		log.Printf("[ERROR] Failed to browse directory %s: %v", absPath, err)
		http.Error(w, fmt.Sprintf("Failed to read directory: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("[DEBUG] Found %d entries in %s", len(entries), absPath)

	// Create response in the format expected by the web client
	response := struct {
		AbsolutePath string     `json:"absolutePath"`
		Files        []FSEntry  `json:"files"`
	}{
		AbsolutePath: absPath,
		Files:        entries,
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("[ERROR] Failed to encode response: %v", err)
	}
}

func (s *Server) handleMkdir(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
		Name string `json:"name,omitempty"` // Optional name field for web client
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("[ERROR] Failed to decode mkdir request: %v", err)
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Support both formats:
	// 1. iOS format: { "path": "/full/path/to/new/folder" }
	// 2. Web format: { "path": "/parent/path", "name": "newfolder" }
	fullPath := req.Path
	if req.Name != "" {
		fullPath = filepath.Join(req.Path, req.Name)
	}

	if fullPath == "" {
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	log.Printf("[DEBUG] Create directory request for path: %s", fullPath)

	// Expand ~ to home directory
	if fullPath == "~" || strings.HasPrefix(fullPath, "~/") {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			log.Printf("[ERROR] Failed to get home directory: %v", err)
			http.Error(w, "Failed to get home directory", http.StatusInternalServerError)
			return
		}
		if fullPath == "~" {
			fullPath = homeDir
		} else {
			fullPath = filepath.Join(homeDir, fullPath[2:])
		}
	}

	// Create directory with proper permissions
	if err := os.MkdirAll(fullPath, 0755); err != nil {
		log.Printf("[ERROR] Failed to create directory %s: %v", fullPath, err)
		http.Error(w, fmt.Sprintf("Failed to create directory: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("[DEBUG] Successfully created directory: %s", fullPath)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"path":    fullPath,
	})
}

func (s *Server) handleResizeSession(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sess, err := s.manager.GetSession(vars["id"])
	if err != nil {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	var req struct {
		Cols int `json:"cols"`
		Rows int `json:"rows"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Cols <= 0 || req.Rows <= 0 {
		http.Error(w, "Cols and rows must be positive integers", http.StatusBadRequest)
		return
	}

	// Check if resizing is disabled for all sessions
	if s.doNotAllowColumnSet {
		log.Printf("[INFO] Resize blocked for session %s (--do-not-allow-column-set enabled)", vars["id"][:8])
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "Terminal resizing is disabled by server configuration",
			"error":   "resize_disabled_by_server",
		})
		return
	}

	if err := sess.Resize(req.Cols, req.Rows); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Session resized successfully",
		"cols":    req.Cols,
		"rows":    req.Rows,
	})
}

// Ngrok Handlers

func (s *Server) handleNgrokStart(w http.ResponseWriter, r *http.Request) {
	var req ngrok.StartRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.AuthToken == "" {
		http.Error(w, "Auth token is required", http.StatusBadRequest)
		return
	}

	// Check if ngrok is already running
	if s.ngrokService.IsRunning() {
		status := s.ngrokService.GetStatus()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "Ngrok tunnel is already running",
			"tunnel":  status,
		})
		return
	}

	// Start the tunnel
	if err := s.ngrokService.Start(req.AuthToken, s.port); err != nil {
		log.Printf("[ERROR] Failed to start ngrok tunnel: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Return immediate response - tunnel status will be updated asynchronously
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Ngrok tunnel is starting",
		"tunnel":  s.ngrokService.GetStatus(),
	})
}

func (s *Server) handleNgrokStop(w http.ResponseWriter, r *http.Request) {
	if !s.ngrokService.IsRunning() {
		http.Error(w, "Ngrok tunnel is not running", http.StatusBadRequest)
		return
	}

	if err := s.ngrokService.Stop(); err != nil {
		log.Printf("[ERROR] Failed to stop ngrok tunnel: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Ngrok tunnel stopped",
	})
}

func (s *Server) handleNgrokStatus(w http.ResponseWriter, r *http.Request) {
	status := s.ngrokService.GetStatus()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"tunnel":  status,
	})
}

// StartNgrok is a convenience method for CLI integration
func (s *Server) StartNgrok(authToken string) error {
	return s.ngrokService.Start(authToken, s.port)
}

// StopNgrok is a convenience method for CLI integration
func (s *Server) StopNgrok() error {
	return s.ngrokService.Stop()
}

// GetNgrokStatus returns the current ngrok status
func (s *Server) GetNgrokStatus() ngrok.StatusResponse {
	return s.ngrokService.GetStatus()
}

// findVTBinary locates the vt binary in common locations
func findVTBinary() string {
	// Get the directory of the current executable (vibetunnel)
	execPath, err := os.Executable()
	if err == nil {
		execDir := filepath.Dir(execPath)
		// Check if vt is in the same directory as vibetunnel
		vtPath := filepath.Join(execDir, "vt")
		if _, err := os.Stat(vtPath); err == nil {
			return vtPath
		}
	}

	// Check common locations
	paths := []string{
		// App bundle location
		"/Applications/VibeTunnel.app/Contents/Resources/vt",
		// Development locations
		"./vt",
		"../vt",
		"../../linux/vt",
		// Installed location
		"/usr/local/bin/vt",
	}

	for _, path := range paths {
		if _, err := os.Stat(path); err == nil {
			absPath, _ := filepath.Abs(path)
			return absPath
		}
	}

	// Try to find in PATH
	if path, err := exec.LookPath("vt"); err == nil {
		return path
	}

	return ""
}
