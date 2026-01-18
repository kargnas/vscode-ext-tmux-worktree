package main

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/kargnas/tmux-worktree-tui/internal/ui"
	"github.com/kargnas/tmux-worktree-tui/pkg/tmux"
)

func main() {
	model := ui.NewModel()
	p := tea.NewProgram(model)

	finalModel, err := p.Run()
	if err != nil {
		fmt.Printf("Alas, there's been an error: %v", err)
		os.Exit(1)
	}

	if m, ok := finalModel.(ui.Model); ok {
		if m.AttachSession != nil {
			// Create session if it doesn't exist
			err := tmux.CreateSession(m.AttachSession.SessionName, m.AttachSession.Cwd)
			if err != nil {
				// Ignore error if session already exists (tmux new-session returns error)
				// or handle strictly if needed. For now, try attach anyway.
			}

			// Attach - use syscall.Exec to replace current process
			if tmux.IsInsideTmux() {
				// Inside tmux: use switch-client
				err = tmux.SwitchClient(m.AttachSession.SessionName)
				if err != nil {
					fmt.Printf("Error switching to session: %v\n", err)
					os.Exit(1)
				}
			} else {
				// Outside tmux: replace process with tmux attach
				tmuxPath, err := exec.LookPath("tmux")
				if err != nil {
					fmt.Printf("Error finding tmux: %v\n", err)
					os.Exit(1)
				}

				// syscall.Exec replaces the current process entirely
				// This ensures proper terminal handling for tmux
				err = syscall.Exec(tmuxPath, []string{"tmux", "attach", "-t", m.AttachSession.SessionName}, os.Environ())
				if err != nil {
					fmt.Printf("Error attaching to session: %v\n", err)
					os.Exit(1)
				}
			}
		}
	}
}
