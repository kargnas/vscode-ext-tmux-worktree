package main

import (
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/kargnas/tmux-worktree-tui/internal/ui"
	"github.com/kargnas/tmux-worktree-tui/pkg/tmux"
)

func main() {
	model := ui.NewModel()
	p := tea.NewProgram(model, tea.WithAltScreen())

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

			// Attach
			err = tmux.AttachSession(m.AttachSession.SessionName)
			if err != nil {
				fmt.Printf("Error attaching to session: %v\n", err)
				os.Exit(1)
			}
		}
	}
}
