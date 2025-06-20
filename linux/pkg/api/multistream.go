package api

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/vibetunnel/linux/pkg/protocol"
	"github.com/vibetunnel/linux/pkg/session"
)

type MultiSSEStreamer struct {
	w          http.ResponseWriter
	manager    *session.Manager
	sessionIDs []string
	flusher    http.Flusher
	done       chan struct{}
	wg         sync.WaitGroup
}

func NewMultiSSEStreamer(w http.ResponseWriter, manager *session.Manager, sessionIDs []string) *MultiSSEStreamer {
	flusher, _ := w.(http.Flusher)
	return &MultiSSEStreamer{
		w:          w,
		manager:    manager,
		sessionIDs: sessionIDs,
		flusher:    flusher,
		done:       make(chan struct{}),
	}
}

func (m *MultiSSEStreamer) Stream() {
	m.w.Header().Set("Content-Type", "text/event-stream")
	m.w.Header().Set("Cache-Control", "no-cache")
	m.w.Header().Set("Connection", "keep-alive")
	m.w.Header().Set("X-Accel-Buffering", "no")

	// Start a goroutine for each session
	for _, sessionID := range m.sessionIDs {
		m.wg.Add(1)
		go m.streamSession(sessionID)
	}

	// Wait for all streams to complete
	m.wg.Wait()
}

func (m *MultiSSEStreamer) streamSession(sessionID string) {
	defer m.wg.Done()

	sess, err := m.manager.GetSession(sessionID)
	if err != nil {
		if err := m.sendError(sessionID, fmt.Sprintf("Session not found: %v", err)); err != nil {
			// Log error but continue - client might have disconnected
			log.Printf("[ERROR] MultiStream: Failed to send error for session %s: %v", sessionID, err)
		}
		return
	}

	streamPath := sess.StreamOutPath()
	file, err := os.Open(streamPath)
	if err != nil {
		if err := m.sendError(sessionID, fmt.Sprintf("Failed to open stream: %v", err)); err != nil {
			log.Printf("Failed to send error message: %v", err)
		}
		return
	}
	defer func() {
		if err := file.Close(); err != nil {
			log.Printf("Failed to close stream file: %v", err)
		}
	}()

	// Seek to end for live streaming
	if _, err := file.Seek(0, io.SeekEnd); err != nil {
		log.Printf("Failed to seek to end of stream file: %v", err)
	}

	reader := protocol.NewStreamReader(file)
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-m.done:
			return
		case <-ticker.C:
			for {
				event, err := reader.Next()
				if err != nil {
					if err != io.EOF {
						if err := m.sendError(sessionID, fmt.Sprintf("Stream read error: %v", err)); err != nil {
							log.Printf("Failed to send stream error to client: %v", err)
						}
						return
					}
					break
				}

				if err := m.sendEvent(sessionID, event); err != nil {
					return
				}

				if event.Type == "end" {
					return
				}
			}
		}
	}
}

func (m *MultiSSEStreamer) sendEvent(sessionID string, event *protocol.StreamEvent) error {
	// Match Rust format: send raw arrays for terminal events
	if event.Type == "event" && event.Event != nil {
		// For terminal events, send as raw array
		data := []interface{}{
			event.Event.Time,
			string(event.Event.Type),
			event.Event.Data,
		}

		jsonData, err := json.Marshal(data)
		if err != nil {
			return err
		}

		// Match Rust multistream format: sessionID:event_json
		prefixedEvent := fmt.Sprintf("%s:%s", sessionID, jsonData)

		if _, err := fmt.Fprintf(m.w, "data: %s\n\n", prefixedEvent); err != nil {
			return err // Client disconnected
		}
	} else {
		// For other event types, serialize the event
		jsonData, err := json.Marshal(event)
		if err != nil {
			return err
		}

		// Match Rust multistream format: sessionID:event_json
		prefixedEvent := fmt.Sprintf("%s:%s", sessionID, jsonData)

		if _, err := fmt.Fprintf(m.w, "data: %s\n\n", prefixedEvent); err != nil {
			return err // Client disconnected
		}
	}

	if m.flusher != nil {
		m.flusher.Flush()
	}

	return nil
}

func (m *MultiSSEStreamer) sendError(sessionID string, message string) error {
	event := &protocol.StreamEvent{
		Type:    "error",
		Message: message,
	}
	return m.sendEvent(sessionID, event)
}
