package protocol

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sync"
	"time"
)

type AsciinemaHeader struct {
	Version   uint32            `json:"version"`
	Width     uint32            `json:"width"`
	Height    uint32            `json:"height"`
	Timestamp int64             `json:"timestamp,omitempty"`
	Command   string            `json:"command,omitempty"`
	Title     string            `json:"title,omitempty"`
	Env       map[string]string `json:"env,omitempty"`
}

type EventType string

const (
	EventOutput EventType = "o"
	EventInput  EventType = "i"
	EventResize EventType = "r"
	EventMarker EventType = "m"
)

type AsciinemaEvent struct {
	Time float64   `json:"time"`
	Type EventType `json:"type"`
	Data string    `json:"data"`
}

type StreamEvent struct {
	Type    string           `json:"type"`
	Header  *AsciinemaHeader `json:"header,omitempty"`
	Event   *AsciinemaEvent  `json:"event,omitempty"`
	Message string           `json:"message,omitempty"`
}

type StreamWriter struct {
	writer     io.Writer
	header     *AsciinemaHeader
	startTime  time.Time
	mutex      sync.Mutex
	closed     bool
	buffer     []byte
	lastWrite  time.Time
	flushTimer *time.Timer
	syncTimer  *time.Timer
	needsSync  bool
}

func NewStreamWriter(writer io.Writer, header *AsciinemaHeader) *StreamWriter {
	return &StreamWriter{
		writer:    writer,
		header:    header,
		startTime: time.Now(),
		buffer:    make([]byte, 0, 4096),
		lastWrite: time.Now(),
	}
}

func (w *StreamWriter) WriteHeader() error {
	w.mutex.Lock()
	defer w.mutex.Unlock()

	if w.closed {
		return fmt.Errorf("stream writer closed")
	}

	if w.header.Timestamp == 0 {
		w.header.Timestamp = w.startTime.Unix()
	}

	data, err := json.Marshal(w.header)
	if err != nil {
		return err
	}

	_, err = fmt.Fprintf(w.writer, "%s\n", data)
	return err
}

func (w *StreamWriter) WriteOutput(data []byte) error {
	return w.writeEvent(EventOutput, data)
}

func (w *StreamWriter) WriteInput(data []byte) error {
	return w.writeEvent(EventInput, data)
}

func (w *StreamWriter) WriteResize(width, height uint32) error {
	data := fmt.Sprintf("%dx%d", width, height)
	return w.writeEvent(EventResize, []byte(data))
}

func (w *StreamWriter) writeEvent(eventType EventType, data []byte) error {
	w.mutex.Lock()
	defer w.mutex.Unlock()

	if w.closed {
		return fmt.Errorf("stream writer closed")
	}

	w.buffer = append(w.buffer, data...)
	w.lastWrite = time.Now()

	completeData, remaining := extractCompleteUTF8(w.buffer)
	w.buffer = remaining

	if len(completeData) == 0 {
		// If we have incomplete UTF-8 data, set up a timer to flush it after a short delay
		if len(w.buffer) > 0 {
			w.scheduleFlush()
		}
		return nil
	}

	elapsed := time.Since(w.startTime).Seconds()
	event := []interface{}{elapsed, string(eventType), string(completeData)}

	eventData, err := json.Marshal(event)
	if err != nil {
		return err
	}

	_, err = fmt.Fprintf(w.writer, "%s\n", eventData)
	if err != nil {
		return err
	}

	// Schedule sync instead of immediate sync for better performance
	w.scheduleBatchSync()

	return nil
}

// scheduleFlush sets up a timer to flush incomplete UTF-8 data after a short delay
func (w *StreamWriter) scheduleFlush() {
	// Cancel existing timer if any
	if w.flushTimer != nil {
		w.flushTimer.Stop()
	}

	// Set up new timer for 5ms flush delay
	w.flushTimer = time.AfterFunc(5*time.Millisecond, func() {
		w.mutex.Lock()
		defer w.mutex.Unlock()

		if w.closed || len(w.buffer) == 0 {
			return
		}

		// Force flush incomplete UTF-8 data for real-time streaming
		elapsed := time.Since(w.startTime).Seconds()
		event := []interface{}{elapsed, string(EventOutput), string(w.buffer)}

		eventData, err := json.Marshal(event)
		if err != nil {
			return
		}

		if _, err := fmt.Fprintf(w.writer, "%s\n", eventData); err != nil {
			// Log but don't fail - this is a best effort flush
			// Cannot use log here as we might be in a defer/cleanup path
			return
		}

		// Schedule sync instead of immediate sync for better performance
		w.scheduleBatchSync()

		// Clear buffer after flushing
		w.buffer = w.buffer[:0]
	})
}

// scheduleBatchSync batches sync operations to reduce I/O overhead
func (w *StreamWriter) scheduleBatchSync() {
	w.needsSync = true

	// Cancel existing sync timer if any
	if w.syncTimer != nil {
		w.syncTimer.Stop()
	}

	// Schedule sync after 5ms to batch multiple writes
	w.syncTimer = time.AfterFunc(5*time.Millisecond, func() {
		if w.needsSync {
			if file, ok := w.writer.(*os.File); ok {
				if err := file.Sync(); err != nil {
					// Sync failed - this is not critical for streaming operations
					// Using fmt instead of log to avoid potential deadlock in timer context
					fmt.Fprintf(os.Stderr, "Warning: Failed to sync asciinema file: %v\n", err)
				}
			}
			w.needsSync = false
		}
	})
}

func (w *StreamWriter) Close() error {
	w.mutex.Lock()
	defer w.mutex.Unlock()

	if w.closed {
		return nil
	}

	// Cancel timers
	if w.flushTimer != nil {
		w.flushTimer.Stop()
	}
	if w.syncTimer != nil {
		w.syncTimer.Stop()
	}

	if len(w.buffer) > 0 {
		elapsed := time.Since(w.startTime).Seconds()
		event := []interface{}{elapsed, string(EventOutput), string(w.buffer)}
		eventData, _ := json.Marshal(event)
		if _, err := fmt.Fprintf(w.writer, "%s\n", eventData); err != nil {
			// Write failed during close - log to stderr to avoid deadlock
			fmt.Fprintf(os.Stderr, "Warning: Failed to write final asciinema event: %v\n", err)
		}
	}

	w.closed = true
	if closer, ok := w.writer.(io.Closer); ok {
		return closer.Close()
	}

	return nil
}

func extractCompleteUTF8(data []byte) (complete, remaining []byte) {
	if len(data) == 0 {
		return nil, nil
	}

	lastValid := len(data)
	for i := len(data) - 1; i >= 0 && i >= len(data)-4; i-- {
		if data[i]&0x80 == 0 {
			break
		}
		if data[i]&0xC0 == 0xC0 {
			expectedLen := 1
			if data[i]&0xE0 == 0xC0 {
				expectedLen = 2
			} else if data[i]&0xF0 == 0xE0 {
				expectedLen = 3
			} else if data[i]&0xF8 == 0xF0 {
				expectedLen = 4
			}

			if i+expectedLen > len(data) {
				lastValid = i
			}
			break
		}
	}

	return data[:lastValid], data[lastValid:]
}

type StreamReader struct {
	reader     io.Reader
	decoder    *json.Decoder
	header     *AsciinemaHeader
	headerRead bool
}

func NewStreamReader(reader io.Reader) *StreamReader {
	return &StreamReader{
		reader:  reader,
		decoder: json.NewDecoder(reader),
	}
}

func (r *StreamReader) Next() (*StreamEvent, error) {
	if !r.headerRead {
		var header AsciinemaHeader
		if err := r.decoder.Decode(&header); err != nil {
			return nil, err
		}
		r.header = &header
		r.headerRead = true
		return &StreamEvent{
			Type:   "header",
			Header: &header,
		}, nil
	}

	var raw json.RawMessage
	if err := r.decoder.Decode(&raw); err != nil {
		if err == io.EOF {
			return &StreamEvent{Type: "end"}, nil
		}
		return nil, err
	}

	var array []interface{}
	if err := json.Unmarshal(raw, &array); err != nil {
		return nil, err
	}

	if len(array) != 3 {
		return nil, fmt.Errorf("invalid event format")
	}

	timestamp, ok := array[0].(float64)
	if !ok {
		return nil, fmt.Errorf("invalid timestamp")
	}

	eventType, ok := array[1].(string)
	if !ok {
		return nil, fmt.Errorf("invalid event type")
	}

	data, ok := array[2].(string)
	if !ok {
		return nil, fmt.Errorf("invalid event data")
	}

	return &StreamEvent{
		Type: "event",
		Event: &AsciinemaEvent{
			Time: timestamp,
			Type: EventType(eventType),
			Data: data,
		},
	}, nil
}
