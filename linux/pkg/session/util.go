package session

import (
	"log"
	"os"
)

// debugLog logs debug messages only if VIBETUNNEL_DEBUG is set
func debugLog(format string, args ...interface{}) {
	if os.Getenv("VIBETUNNEL_DEBUG") != "" {
		log.Printf(format, args...)
	}
}
