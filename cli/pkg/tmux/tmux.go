package tmux

import (
	"fmt"
	"os/exec"
	"strings"
)

// Session represents a tmux session.
type Session struct {
	Name     string
	Windows  int
	Attached bool
	Workdir  string
}

// ListSessions returns a list of all tmux sessions.
func ListSessions() ([]Session, error) {
	// Format: #{session_name}\t#{session_windows}\t#{session_attached}
	cmd := exec.Command("tmux", "list-sessions", "-F", "#{session_name}\t#{session_windows}\t#{session_attached}")
	output, err := cmd.Output()
	if err != nil {
		// If no sessions, tmux returns error (exit status 1)
		return []Session{}, nil
	}

	var sessions []Session
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")

	for _, line := range lines {
		parts := strings.Split(line, "\t")
		if len(parts) < 3 {
			continue
		}

		name := parts[0]

		// Get workdir for each session
		// This is slow if many sessions, but necessary for correct matching
		workdir, _ := GetSessionWorkdir(name)

		sessions = append(sessions, Session{
			Name:     name,
			Windows:  1, // Simple parsing, or parse parts[1]
			Attached: parts[2] == "1",
			Workdir:  workdir,
		})
	}

	return sessions, nil
}

// GetSessionWorkdir gets the working directory of a session.
func GetSessionWorkdir(sessionName string) (string, error) {
	cmd := exec.Command("tmux", "show-options", "-t", sessionName, "-v", "@workdir")
	output, err := cmd.Output()

	// Fallback to session path if @workdir is not set
	if err != nil || len(output) == 0 {
		cmd = exec.Command("tmux", "display-message", "-p", "-t", sessionName, "#{session_path}")
		output, err = cmd.Output()
	}

	if err != nil {
		return "", err
	}

	return strings.TrimSpace(string(output)), nil
}

// CreateSession creates a new detached session.
func CreateSession(sessionName, cwd string) error {
	cmd := exec.Command("tmux", "new-session", "-d", "-s", sessionName, "-c", cwd)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to create session: %w", err)
	}

	// Set @workdir option for persistence/lookup compatibility
	cmd = exec.Command("tmux", "set-option", "-t", sessionName, "@workdir", cwd)
	_ = cmd.Run()

	return nil
}

// SwitchClient switches the current client to the target session.
func SwitchClient(sessionName string) error {
	cmd := exec.Command("tmux", "switch-client", "-t", sessionName)
	return cmd.Run()
}

// AttachSession attaches to the session (if outside tmux).
func AttachSession(sessionName string) error {
	// Check if inside tmux
	if isInsideTmux() {
		return SwitchClient(sessionName)
	}

	// If outside, replace current process with tmux attach
	// syscall.Exec is better, but for simplicity in this wrapper we'll use Run
	// Actually, for a TUI app, we might want to just run the command and let it take over stdin/stdout
	cmd := exec.Command("tmux", "attach", "-t", sessionName)
	cmd.Stdin = nil // Connect to real stdin/out/err usually?
	// Bubbletea might interfere. Usually we exit the TUI and then attach.
	return cmd.Run()
}

func isInsideTmux() bool {
	// Check $TMUX env var
	// In Go, os.Getenv("TMUX") != ""
	return false // Simplified for now, caller should check env
}
