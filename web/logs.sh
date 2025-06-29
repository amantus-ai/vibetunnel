#!/bin/bash

# VibeTunnel Log Viewer
# Simple script for accessing server logs

LOG_FILE="$HOME/.vibetunnel/log.txt"

# Check if log file exists
if [ ! -f "$LOG_FILE" ]; then
    echo "Log file not found at: $LOG_FILE"
    echo "Make sure the VibeTunnel server has been run at least once."
    exit 1
fi

case "$1" in
    tail|follow)
        # Follow logs in real-time, showing last N lines
        lines="${2:-50}"
        echo "Following logs (last $lines lines)..."
        tail -f -n "$lines" "$LOG_FILE"
        ;;
    
    last|show)
        # Show last N lines
        lines="${2:-50}"
        tail -n "$lines" "$LOG_FILE"
        ;;
    
    error|errors)
        # Show recent errors
        lines="${2:-50}"
        grep -E "(ERROR|Error|error)" "$LOG_FILE" | tail -n "$lines"
        ;;
    
    warn|warnings)
        # Show recent warnings
        lines="${2:-50}"
        grep -E "(WARN|Warning|warning)" "$LOG_FILE" | tail -n "$lines"
        ;;
    
    debug)
        # Show debug messages
        lines="${2:-50}"
        grep "DEBUG" "$LOG_FILE" | tail -n "$lines"
        ;;
    
    search|grep)
        # Search for pattern
        if [ -z "$2" ]; then
            echo "Usage: $0 search <pattern> [lines]"
            exit 1
        fi
        pattern="$2"
        lines="${3:-50}"
        grep -i "$pattern" "$LOG_FILE" | tail -n "$lines"
        ;;
    
    clear|reset)
        # Clear log file
        echo "Clearing log file..."
        > "$LOG_FILE"
        echo "Log file cleared."
        ;;
    
    info|stats)
        # Show log file info
        echo "Log file: $LOG_FILE"
        echo "Size: $(du -h "$LOG_FILE" | cut -f1)"
        echo "Lines: $(wc -l < "$LOG_FILE")"
        echo "Last modified: $(date -r "$LOG_FILE" '+%Y-%m-%d %H:%M:%S')"
        ;;
    
    help|--help|-h|"")
        # Show help
        echo "VibeTunnel Log Viewer"
        echo ""
        echo "Usage: $0 [command] [options]"
        echo ""
        echo "Commands:"
        echo "  tail, follow [N]     Follow logs in real-time (default: 50 lines)"
        echo "  last, show [N]       Show last N lines (default: 50)"
        echo "  error, errors [N]    Show recent errors"
        echo "  warn, warnings [N]   Show recent warnings"
        echo "  debug [N]            Show debug messages"
        echo "  search <pattern> [N] Search for pattern (case-insensitive)"
        echo "  clear, reset         Clear the log file"
        echo "  info, stats          Show log file information"
        echo "  help                 Show this help message"
        echo ""
        echo "Examples:"
        echo "  $0                   Show last 50 lines (default)"
        echo "  $0 tail              Follow logs in real-time"
        echo "  $0 error 100         Show last 100 error messages"
        echo "  $0 search 'session'  Search for 'session' in logs"
        ;;
    
    *)
        # Default: show last 50 lines
        tail -n 50 "$LOG_FILE"
        ;;
esac