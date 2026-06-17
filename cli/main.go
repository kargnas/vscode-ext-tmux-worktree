package main

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/kargnas/tmux-worktree-tui/cmd"
	"github.com/kargnas/tmux-worktree-tui/internal/ui"
	"github.com/kargnas/tmux-worktree-tui/pkg/tmux"
)

func main() {
	// Subcommand dispatch. The default (no args) keeps backwards compatibility
	// with the Bubble Tea TUI; "open" attaches/creates the multiplexer session
	// the VS Code extension would use for the current directory.
	if len(os.Args) >= 2 {
		switch os.Args[1] {
		case "open":
			os.Exit(cmd.RunOpen(os.Args[2:], os.Stdout, os.Stderr))
		case "-h", "--help", "help":
			printUsage()
			return
		}
	}

	runTUI()
}

func printUsage() {
	fmt.Fprintln(os.Stderr, "Usage: tmux-worktree-tui [subcommand]")
	fmt.Fprintln(os.Stderr)
	fmt.Fprintln(os.Stderr, "Subcommands:")
	fmt.Fprintln(os.Stderr, "  (none)   Launch the interactive worktree/session picker (TUI).")
	fmt.Fprintln(os.Stderr, "  open     Attach to (or create) the tmux/zellij session that the")
	fmt.Fprintln(os.Stderr, "           VS Code extension would use for the current directory.")
	fmt.Fprintln(os.Stderr)
	fmt.Fprintln(os.Stderr, "Run `tmux-worktree-tui open --help` for `open` flags.")
}

func runTUI() {
	model := ui.NewModel()
	p := tea.NewProgram(model)

	finalModel, err := p.Run()
	if err != nil {
		fmt.Printf("Alas, there's been an error: %v", err)
		os.Exit(1)
	}

	m, ok := finalModel.(ui.Model)
	if !ok || m.AttachSession == nil {
		return
	}

	// Create session if it doesn't exist
	err = tmux.CreateSession(m.AttachSession.SessionName, m.AttachSession.Cwd)
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
		return
	}

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
