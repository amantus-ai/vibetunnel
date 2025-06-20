package terminal

import (
	"fmt"
	"os/exec"
	"runtime"
	"strings"
)

// SpawnInTerminal opens a new terminal window running the specified command
// This is used as a fallback when the Mac app's terminal service is not available
func SpawnInTerminal(sessionID, vtBinaryPath string, cmdline []string, workingDir string) error {
	// Format the command to run in the terminal
	// This matches the format used by the Rust implementation
	vtCommand := fmt.Sprintf("TTY_SESSION_ID=\"%s\" \"%s\" -- %s",
		sessionID, vtBinaryPath, shellQuoteArgs(cmdline))

	switch runtime.GOOS {
	case "darwin":
		return spawnMacTerminal(vtCommand, workingDir)
	case "linux":
		return spawnLinuxTerminal(vtCommand, workingDir)
	default:
		return fmt.Errorf("terminal spawning not supported on %s", runtime.GOOS)
	}
}

func spawnMacTerminal(command, workingDir string) error {
	// Use osascript to open Terminal.app with the command
	script := fmt.Sprintf(`
		tell application "Terminal"
			activate
			do script "cd %s && %s"
		end tell
	`, shellQuote(workingDir), command)

	cmd := exec.Command("osascript", "-e", script)
	return cmd.Run()
}

func spawnLinuxTerminal(command, workingDir string) error {
	// Try common Linux terminal emulators in order of preference
	terminals := []struct {
		name string
		args func(string, string) []string
	}{
		{"gnome-terminal", func(cmd, wd string) []string {
			return []string{"--working-directory=" + wd, "--", "bash", "-c", cmd}
		}},
		{"konsole", func(cmd, wd string) []string {
			return []string{"--workdir", wd, "-e", "bash", "-c", cmd}
		}},
		{"xfce4-terminal", func(cmd, wd string) []string {
			return []string{"--working-directory=" + wd, "-e", "bash -c " + shellQuote(cmd)}
		}},
		{"xterm", func(cmd, wd string) []string {
			return []string{"-e", "bash", "-c", "cd " + shellQuote(wd) + " && " + cmd}
		}},
	}

	for _, term := range terminals {
		if _, err := exec.LookPath(term.name); err == nil {
			cmd := exec.Command(term.name, term.args(command, workingDir)...)
			if err := cmd.Start(); err == nil {
				return nil
			}
		}
	}

	return fmt.Errorf("no suitable terminal emulator found")
}

func shellQuote(s string) string {
	if strings.ContainsAny(s, " \t\n\"'$`\\") {
		// Simple shell escaping - replace quotes and wrap in single quotes
		escaped := strings.ReplaceAll(s, "'", "'\"'\"'")
		return "'" + escaped + "'"
	}
	return s
}

func shellQuoteArgs(args []string) string {
	quoted := make([]string, len(args))
	for i, arg := range args {
		quoted[i] = shellQuote(arg)
	}
	return strings.Join(quoted, " ")
}
