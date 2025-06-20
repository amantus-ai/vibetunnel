package api

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/vibetunnel/linux/pkg/session"
)

// RawTerminalWebSocketHandler handles direct PTY streaming (like goterm)
type RawTerminalWebSocketHandler struct {
	manager *session.Manager
}

func NewRawTerminalWebSocketHandler(manager *session.Manager) *RawTerminalWebSocketHandler {
	return &RawTerminalWebSocketHandler{
		manager: manager,
	}
}

func (h *RawTerminalWebSocketHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[RawWebSocket] Failed to upgrade connection: %v", err)
		return
	}
	defer func() {
		if err := conn.Close(); err != nil {
			log.Printf("[RawWebSocket] Failed to close connection: %v", err)
		}
	}()

	// Set up connection parameters
	conn.SetReadLimit(maxMessageSize)
	if err := conn.SetReadDeadline(time.Now().Add(pongWait)); err != nil {
		log.Printf("[RawWebSocket] Failed to set read deadline: %v", err)
	}
	conn.SetPongHandler(func(string) error {
		if err := conn.SetReadDeadline(time.Now().Add(pongWait)); err != nil {
			log.Printf("[RawWebSocket] Failed to set read deadline in pong handler: %v", err)
		}
		return nil
	})

	// Start ping ticker
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()

	// Channel for writing messages
	send := make(chan []byte, 256)
	done := make(chan struct{})
	var closeOnce sync.Once

	// Helper function to safely close done channel
	closeOnceFunc := func() {
		closeOnce.Do(func() {
			close(done)
		})
	}

	// Start writer goroutine
	go h.writer(conn, send, ticker, done)

	// Handle incoming messages
	for {
		messageType, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[RawWebSocket] Error: %v", err)
			}
			closeOnceFunc()
			return
		}

		if messageType == websocket.TextMessage {
			h.handleTextMessage(conn, message, send, done, closeOnceFunc)
		}
	}
}

func (h *RawTerminalWebSocketHandler) handleTextMessage(conn *websocket.Conn, message []byte, send chan []byte, done chan struct{}, closeFunc func()) {
	var msg map[string]interface{}
	if err := json.Unmarshal(message, &msg); err != nil {
		log.Printf("[RawWebSocket] Failed to parse message: %v", err)
		return
	}

	msgType, ok := msg["type"].(string)
	if !ok {
		return
	}

	switch msgType {
	case "ping":
		// Send pong response
		pong, _ := json.Marshal(map[string]string{"type": "pong"})
		if !safeSend(send, pong, done) {
			return
		}

	case "subscribe":
		sessionID, ok := msg["sessionId"].(string)
		if !ok {
			return
		}

		// Subscribe to RAW PTY output (no buffer processing!)
		go h.subscribeToRawPTY(sessionID, send, done)

	case "unsubscribe":
		// Close the connection when unsubscribing
		closeFunc()
	}
}

func (h *RawTerminalWebSocketHandler) subscribeToRawPTY(sessionID string, send chan []byte, done chan struct{}) {
	// Simple debouncing like Node.js
	var lastData []byte
	var flushTimer *time.Timer
	var dataMutex sync.Mutex
	
	// Register for direct raw PTY callbacks (goterm-style)
	h.manager.RegisterRawPTYCallback(sessionID, func(sid string, data []byte) {
		dataMutex.Lock()
		defer dataMutex.Unlock()
		
		// Simple debouncing like Node.js - no complex animation detection
		lastData = data
		
		// Reset flush timer - simple 50ms debouncing like Node.js
		if flushTimer != nil {
			flushTimer.Stop()
		}
		flushTimer = time.AfterFunc(50*time.Millisecond, func() {
			dataMutex.Lock()
			if lastData != nil {
				safeSend(send, lastData, done)
				lastData = nil
			}
			dataMutex.Unlock()
		})
		// Note: timer will handle sending, no immediate send needed
	})

	// Wait for done signal
	<-done
	
	// Cleanup
	dataMutex.Lock()
	if flushTimer != nil {
		flushTimer.Stop()
	}
	dataMutex.Unlock()
	
	// Unregister callback when done
	h.manager.UnregisterRawPTYCallback(sessionID)
}

// calculateSimilarity returns a value between 0.0 and 1.0 indicating how similar two byte arrays are
func calculateSimilarity(a, b []byte) float64 {
	if len(a) == 0 || len(b) == 0 {
		return 0.0
	}
	
	// Fast similarity check: count common subsequences
	minLen := len(a)
	if len(b) < minLen {
		minLen = len(b)
	}
	
	matches := 0
	for i := 0; i < minLen; i++ {
		if a[i] == b[i] {
			matches++
		}
	}
	
	return float64(matches) / float64(minLen)
}

// Direct PTY streaming - no file processing needed!

func (h *RawTerminalWebSocketHandler) writer(conn *websocket.Conn, send chan []byte, ticker *time.Ticker, done chan struct{}) {
	defer close(send)

	for {
		select {
		case message, ok := <-send:
			if err := conn.SetWriteDeadline(time.Now().Add(writeWait)); err != nil {
				log.Printf("[RawWebSocket] Failed to set write deadline: %v", err)
				return
			}
			if !ok {
				if err := conn.WriteMessage(websocket.CloseMessage, []byte{}); err != nil {
					log.Printf("[RawWebSocket] Failed to write close message: %v", err)
				}
				return
			}

			// Always send as binary (raw PTY data)
			if err := conn.WriteMessage(websocket.BinaryMessage, message); err != nil {
				return
			}

		case <-ticker.C:
			if err := conn.SetWriteDeadline(time.Now().Add(writeWait)); err != nil {
				log.Printf("[RawWebSocket] Failed to set write deadline for ping: %v", err)
				return
			}
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}

		case <-done:
			return
		}
	}
}