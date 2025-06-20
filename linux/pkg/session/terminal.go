package session

import (
	"fmt"
	"os"
	"runtime"
	"syscall"

	"golang.org/x/sys/unix"
)

// TerminalMode represents terminal mode settings
type TerminalMode struct {
	Raw         bool
	Echo        bool
	LineMode    bool
	FlowControl bool
}

// configurePTYTerminal configures the PTY terminal attributes to match node-pty behavior
// This ensures proper terminal behavior with flow control, signal handling, and line editing
func configurePTYTerminal(ptyFile *os.File) error {
	fd := int(ptyFile.Fd())

	// Get current terminal attributes
	termios, err := unix.IoctlGetTermios(fd, ioctlGetTermios)
	if err != nil {
		// Non-fatal: some systems may not support this
		debugLog("[DEBUG] Could not get terminal attributes, using defaults: %v", err)
		return nil
	}

	// Match node-pty's default behavior: keep most settings from the parent terminal
	// but ensure proper signal handling and character processing

	// Configure input processing to match node-pty behavior exactly
	// ICRNL: Map CR to NL on input (node-pty enables this!)
	// IXON: Enable XON/XOFF flow control on output
	// IXANY: Allow any character to restart output
	// IMAXBEL: Ring bell on input queue full
	// BRKINT: Send SIGINT on break
	termios.Iflag |= unix.ICRNL | unix.IXON | unix.IXANY | unix.IMAXBEL | unix.BRKINT
	
	// Enable IUTF8 if available (node-pty enables this on newer systems)
	if runtime.GOOS == "linux" {
		// IUTF8 is a Linux-specific flag for UTF-8 input processing
		const IUTF8 = 0x00004000
		termios.Iflag |= IUTF8
	}
	// Note: We KEEP flow control enabled to match node-pty behavior

	// Configure output flags
	// OPOST: Enable output processing
	// ONLCR: Map NL to CR-NL on output (important for proper line endings)
	termios.Oflag |= unix.OPOST | unix.ONLCR

	// Configure control flags to match node-pty
	// CS8: 8-bit characters
	// CREAD: Enable receiver
	// HUPCL: Hang up on last close
	termios.Cflag |= unix.CS8 | unix.CREAD | unix.HUPCL
	termios.Cflag &^= unix.PARENB // Disable parity

	// Configure local flags to match node-pty behavior exactly
	// ISIG: Enable signal generation (SIGINT on Ctrl+C, etc)
	// ICANON: Enable canonical mode (line editing)
	// IEXTEN: Enable extended functions
	// ECHO: Enable echo (node-pty enables this!)
	// ECHOE: Echo erase character as BS-SP-BS
	// ECHOK: Echo KILL by erasing line
	// ECHOKE: BS-SP-BS entire line on KILL
	// ECHOCTL: Echo control characters as ^X
	termios.Lflag |= unix.ISIG | unix.ICANON | unix.IEXTEN | unix.ECHO | unix.ECHOE | unix.ECHOK | unix.ECHOKE | unix.ECHOCTL

	// Set control characters to match node-pty defaults exactly
	termios.Cc[unix.VEOF] = 4      // Ctrl+D
	termios.Cc[unix.VERASE] = 0x7f // DEL (127)
	termios.Cc[unix.VWERASE] = 23  // Ctrl+W (word erase)
	termios.Cc[unix.VKILL] = 21    // Ctrl+U
	termios.Cc[unix.VREPRINT] = 18 // Ctrl+R (reprint line)
	termios.Cc[unix.VINTR] = 3     // Ctrl+C
	termios.Cc[unix.VQUIT] = 0x1c  // Ctrl+\ (28)
	termios.Cc[unix.VSUSP] = 26    // Ctrl+Z
	termios.Cc[unix.VSTART] = 17   // Ctrl+Q (XON)
	termios.Cc[unix.VSTOP] = 19    // Ctrl+S (XOFF)
	termios.Cc[unix.VLNEXT] = 22   // Ctrl+V (literal next)
	termios.Cc[unix.VDISCARD] = 15 // Ctrl+O (discard output)
	termios.Cc[unix.VMIN] = 1      // Minimum characters for read
	termios.Cc[unix.VTIME] = 0     // Timeout for read

	// Set platform-specific control characters for macOS
	// These constants might not exist on all platforms, so we check
	if vdsusp, ok := getControlCharConstant("VDSUSP"); ok {
		termios.Cc[vdsusp] = 25 // Ctrl+Y (delayed suspend)
	}
	if vstatus, ok := getControlCharConstant("VSTATUS"); ok {
		termios.Cc[vstatus] = 20 // Ctrl+T (status)
	}

	// Apply the terminal attributes
	if err := unix.IoctlSetTermios(fd, ioctlSetTermios, termios); err != nil {
		// Non-fatal: log but continue
		debugLog("[DEBUG] Could not set terminal attributes: %v", err)
		return nil
	}

	debugLog("[DEBUG] PTY terminal configured to match node-pty defaults with echo and flow control enabled")
	return nil
}

// setPTYSize sets the window size of the PTY
func setPTYSize(ptyFile *os.File, cols, rows uint16) error {
	fd := int(ptyFile.Fd())

	ws := &unix.Winsize{
		Row:    rows,
		Col:    cols,
		Xpixel: 0,
		Ypixel: 0,
	}

	if err := unix.IoctlSetWinsize(fd, unix.TIOCSWINSZ, ws); err != nil {
		return fmt.Errorf("failed to set PTY size: %w", err)
	}

	return nil
}

// getPTYSize gets the current window size of the PTY
func getPTYSize(ptyFile *os.File) (cols, rows uint16, err error) {
	fd := int(ptyFile.Fd())

	ws, err := unix.IoctlGetWinsize(fd, unix.TIOCGWINSZ)
	if err != nil {
		return 0, 0, fmt.Errorf("failed to get PTY size: %w", err)
	}

	return ws.Col, ws.Row, nil
}

// sendSignalToPTY sends a signal to the PTY process group
func sendSignalToPTY(ptyFile *os.File, signal syscall.Signal) error {
	fd := int(ptyFile.Fd())

	// Get the process group ID of the PTY
	pgid, err := unix.IoctlGetInt(fd, unix.TIOCGPGRP)
	if err != nil {
		return fmt.Errorf("failed to get PTY process group: %w", err)
	}

	// Send signal to the process group
	if err := syscall.Kill(-pgid, signal); err != nil {
		return fmt.Errorf("failed to send signal to PTY process group: %w", err)
	}

	return nil
}

// isTerminal checks if a file descriptor is a terminal
func isTerminal(fd int) bool {
	_, err := unix.IoctlGetTermios(fd, ioctlGetTermios)
	return err == nil
}
