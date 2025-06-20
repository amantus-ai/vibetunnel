package api

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/vibetunnel/linux/pkg/protocol"
	"github.com/vibetunnel/linux/pkg/session"
)

type SSEStreamer struct {
	w       http.ResponseWriter
	session *session.Session
	flusher http.Flusher
}

func NewSSEStreamer(w http.ResponseWriter, session *session.Session) *SSEStreamer {
	flusher, _ := w.(http.Flusher)
	return &SSEStreamer{
		w:       w,
		session: session,
		flusher: flusher,
	}
}

func (s *SSEStreamer) Stream() {
	s.w.Header().Set("Content-Type", "text/event-stream")
	s.w.Header().Set("Cache-Control", "no-cache")
	s.w.Header().Set("Connection", "keep-alive")
	s.w.Header().Set("X-Accel-Buffering", "no")

	streamPath := s.session.StreamOutPath()

	debugLog("[DEBUG] SSE: Starting live stream for session %s", s.session.ID[:8])

	// Create file watcher for high-performance event detection
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Printf("[ERROR] SSE: Failed to create file watcher: %v", err)
		s.sendError(fmt.Sprintf("Failed to create watcher: %v", err))
		return
	}
	defer watcher.Close()

	// Add the stream file to the watcher
	err = watcher.Add(streamPath)
	if err != nil {
		log.Printf("[ERROR] SSE: Failed to watch stream file: %v", err)
		s.sendError(fmt.Sprintf("Failed to watch file: %v", err))
		return
	}

	headerSent := false
	seenBytes := int64(0)

	// Send initial content immediately and check for client disconnect
	if err := s.processNewContent(streamPath, &headerSent, &seenBytes); err != nil {
		debugLog("[DEBUG] SSE: Client disconnected during initial content: %v", err)
		return
	}

	// Watch for file changes
	for {
		select {
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}

			// Process file writes (new content) and check for client disconnect
			if event.Op&fsnotify.Write == fsnotify.Write {
				if err := s.processNewContent(streamPath, &headerSent, &seenBytes); err != nil {
					debugLog("[DEBUG] SSE: Client disconnected during content streaming: %v", err)
					return
				}
			}

		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			log.Printf("[ERROR] SSE: File watcher error: %v", err)

		case <-time.After(30 * time.Second):
			// Check if session is still alive less frequently for better performance
			if !s.session.IsAlive() {
				debugLog("[DEBUG] SSE: Session %s is dead, ending stream", s.session.ID[:8])
				if err := s.sendEvent(&protocol.StreamEvent{Type: "end"}); err != nil {
					debugLog("[DEBUG] SSE: Client disconnected during end event: %v", err)
				}
				return
			}
		}
	}
}

func (s *SSEStreamer) processNewContent(streamPath string, headerSent *bool, seenBytes *int64) error {
	// Open the file for reading
	file, err := os.Open(streamPath)
	if err != nil {
		log.Printf("[ERROR] SSE: Failed to open stream file: %v", err)
		return err
	}
	defer file.Close()

	// Get current file size
	fileInfo, err := file.Stat()
	if err != nil {
		log.Printf("[ERROR] SSE: Failed to stat stream file: %v", err)
		return err
	}

	currentSize := fileInfo.Size()

	// If file hasn't grown, nothing to do
	if currentSize <= *seenBytes {
		return nil
	}

	// Seek to the position we last read
	if _, err := file.Seek(*seenBytes, 0); err != nil {
		log.Printf("[ERROR] SSE: Failed to seek to position %d: %v", *seenBytes, err)
		return err
	}

	// Read only the new content
	newContentSize := currentSize - *seenBytes
	newContent := make([]byte, newContentSize)

	bytesRead, err := file.Read(newContent)
	if err != nil {
		log.Printf("[ERROR] SSE: Failed to read new content: %v", err)
		return err
	}

	// Update seen bytes
	*seenBytes = currentSize

	// Process the new content line by line
	content := string(newContent[:bytesRead])
	lines := strings.Split(content, "\n")

	// Handle the case where the last line might be incomplete
	// If the content doesn't end with a newline, don't process the last line yet
	endIndex := len(lines)
	if !strings.HasSuffix(content, "\n") && len(lines) > 0 {
		// Move back the file position to exclude the incomplete line
		incompleteLineBytes := int64(len(lines[len(lines)-1]))
		*seenBytes -= incompleteLineBytes
		endIndex = len(lines) - 1
	}

	// Process complete lines
	for i := 0; i < endIndex; i++ {
		line := lines[i]
		if line == "" {
			continue
		}

		// Try to parse as header first
		if !*headerSent {
			var header protocol.AsciinemaHeader
			if err := json.Unmarshal([]byte(line), &header); err == nil && header.Version > 0 {
				*headerSent = true
				debugLog("[DEBUG] SSE: Sending event type=header")
				// Skip sending header for now, frontend doesn't need it
				continue
			}
		}

		// Try to parse as event array [timestamp, type, data]
		var eventArray []interface{}
		if err := json.Unmarshal([]byte(line), &eventArray); err == nil && len(eventArray) == 3 {
			timestamp, ok1 := eventArray[0].(float64)
			eventType, ok2 := eventArray[1].(string)
			data, ok3 := eventArray[2].(string)

			if ok1 && ok2 && ok3 {
				event := &protocol.StreamEvent{
					Type: "event",
					Event: &protocol.AsciinemaEvent{
						Time: timestamp,
						Type: protocol.EventType(eventType),
						Data: data,
					},
				}

				debugLog("[DEBUG] SSE: Sending event type=%s", event.Type)
				if err := s.sendRawEvent(event); err != nil {
					log.Printf("[ERROR] SSE: Failed to send event: %v", err)
					return err
				}
			}
		}
	}
	return nil
}

func (s *SSEStreamer) sendEvent(event *protocol.StreamEvent) error {
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}

	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		if _, err := fmt.Fprintf(s.w, "data: %s\n", line); err != nil {
			return err // Client disconnected
		}
	}
	if _, err := fmt.Fprintf(s.w, "\n"); err != nil {
		return err // Client disconnected
	}

	if s.flusher != nil {
		s.flusher.Flush()
	}

	return nil
}

func (s *SSEStreamer) sendRawEvent(event *protocol.StreamEvent) error {
	// Match Rust behavior exactly - send raw arrays for terminal events
	if event.Type == "header" {
		// Skip headers like Rust does
		return nil
	} else if event.Type == "event" && event.Event != nil {
		// Send raw array directly like Rust: [timestamp, type, data]
		data := []interface{}{
			event.Event.Time,
			string(event.Event.Type),
			event.Event.Data,
		}
		
		jsonData, err := json.Marshal(data)
		if err != nil {
			return err
		}
		
		// Send as SSE data
		if _, err := fmt.Fprintf(s.w, "data: %s\n\n", jsonData); err != nil {
			return err // Client disconnected
		}
		
		if s.flusher != nil {
			s.flusher.Flush()
		}
		
		return nil
	}
	
	// For other event types (error, end), send without wrapping
	jsonData, err := json.Marshal(event)
	if err != nil {
		return err
	}

	lines := strings.Split(string(jsonData), "\n")
	for _, line := range lines {
		if _, err := fmt.Fprintf(s.w, "data: %s\n", line); err != nil {
			return err // Client disconnected
		}
	}
	if _, err := fmt.Fprintf(s.w, "\n"); err != nil {
		return err // Client disconnected
	}

	if s.flusher != nil {
		s.flusher.Flush()
	}

	return nil
}

func (s *SSEStreamer) sendError(message string) error {
	event := &protocol.StreamEvent{
		Type:    "error",
		Message: message,
	}
	return s.sendEvent(event)
}

type SessionSnapshot struct {
	SessionID string                    `json:"session_id"`
	Header    *protocol.AsciinemaHeader `json:"header"`
	Events    []protocol.AsciinemaEvent `json:"events"`
}

func GetSessionSnapshot(sess *session.Session) (*SessionSnapshot, error) {
	streamPath := sess.StreamOutPath()
	file, err := os.Open(streamPath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	reader := protocol.NewStreamReader(file)
	snapshot := &SessionSnapshot{
		SessionID: sess.ID,
		Events:    make([]protocol.AsciinemaEvent, 0),
	}

	lastClearIndex := -1
	eventIndex := 0

	for {
		event, err := reader.Next()
		if err != nil {
			if err != io.EOF {
				return nil, err
			}
			break
		}

		switch event.Type {
		case "header":
			snapshot.Header = event.Header
		case "event":
			snapshot.Events = append(snapshot.Events, *event.Event)
			if event.Event.Type == protocol.EventOutput && containsClearScreen(event.Event.Data) {
				lastClearIndex = eventIndex
			}
			eventIndex++
		}
	}

	if lastClearIndex >= 0 && lastClearIndex < len(snapshot.Events)-1 {
		snapshot.Events = snapshot.Events[lastClearIndex:]
		if len(snapshot.Events) > 0 {
			firstTime := snapshot.Events[0].Time
			for i := range snapshot.Events {
				snapshot.Events[i].Time -= firstTime
			}
		}
	}

	return snapshot, nil
}

func containsClearScreen(data string) bool {
	clearSequences := []string{
		"\x1b[H\x1b[2J",
		"\x1b[2J",
		"\x1b[3J",
		"\x1bc",
	}

	for _, seq := range clearSequences {
		if strings.Contains(data, seq) {
			return true
		}
	}

	return false
}
