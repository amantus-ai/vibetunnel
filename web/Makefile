# VibeTunnel Web - Log Access Commands

# Default log file location
LOG_FILE := ~/.vibetunnel/log.txt

# Show last 50 lines and follow new entries
tail-logs:
	@echo "Following logs (Ctrl+C to stop)..."
	@tail -f -n 50 $(LOG_FILE)

# Just show last N lines (default 100)
logs:
	@tail -n 100 $(LOG_FILE)

# Show only errors
logs-error:
	@echo "Recent errors:"
	@grep -E "(ERROR|Error|error)" $(LOG_FILE) | tail -n 50

# Show only warnings
logs-warn:
	@echo "Recent warnings:"
	@grep -E "(WARN|Warning|warning)" $(LOG_FILE) | tail -n 50

# Show debug messages (if debug mode was enabled)
logs-debug:
	@echo "Recent debug messages:"
	@grep "DEBUG" $(LOG_FILE) | tail -n 50

# Search logs with a pattern
# Usage: make logs-grep filter="pattern"
logs-grep:
	@if [ -z "$(filter)" ]; then \
		echo "Usage: make logs-grep filter=\"pattern\""; \
		exit 1; \
	fi
	@echo "Searching for '$(filter)':"
	@grep -i "$(filter)" $(LOG_FILE) | tail -n 50

# Show log file information
logs-info:
	@echo "Log file: $(LOG_FILE)"
	@echo "Size: $$(du -h $(LOG_FILE) | cut -f1)"
	@echo "Lines: $$(wc -l < $(LOG_FILE))"
	@echo "Last modified: $$(date -r $(LOG_FILE) '+%Y-%m-%d %H:%M:%S' 2>/dev/null || stat -f '%Sm' -t '%Y-%m-%d %H:%M:%S' $(LOG_FILE))"
	@echo ""
	@echo "Rotated logs:"
	@ls -lh ~/.vibetunnel/log.*.txt 2>/dev/null || echo "  No rotated logs found"

# Clear the main log file
logs-clear:
	@echo "Clearing log file..."
	@> $(LOG_FILE)
	@echo "Log file cleared."

# Show all available log commands
help-logs:
	@echo "VibeTunnel Log Commands:"
	@echo ""
	@echo "  make tail-logs      - Follow logs in real-time (last 50 lines)"
	@echo "  make logs           - Show last 100 lines"
	@echo "  make logs-error     - Show recent errors"
	@echo "  make logs-warn      - Show recent warnings"
	@echo "  make logs-debug     - Show debug messages"
	@echo "  make logs-grep filter=\"pattern\" - Search for pattern"
	@echo "  make logs-info      - Show log file information"
	@echo "  make logs-clear     - Clear the log file"
	@echo ""
	@echo "Or use npm scripts:"
	@echo "  pnpm run logs:50    - Show last 50 lines"
	@echo "  pnpm run logs       - Follow logs"
	@echo "  pnpm run logs:error - Show errors"
	@echo ""
	@echo "Or use the logs.sh script:"
	@echo "  ./logs.sh          - Show last 50 lines"
	@echo "  ./logs.sh tail     - Follow logs"
	@echo "  ./logs.sh help     - Show all options"

.PHONY: tail-logs logs logs-error logs-warn logs-debug logs-grep logs-info logs-clear help-logs