// Package cmd holds the CLI subcommands invoked from main.go.
package cmd

import (
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/kargnas/tmux-worktree-tui/pkg/identity"
	"github.com/kargnas/tmux-worktree-tui/pkg/multiplexer"
	"github.com/kargnas/tmux-worktree-tui/pkg/vscodeconfig"
)

// RunOpen implements `tmux-worktree-tui open`.
//
// It walks the same rules the VS Code extension applies — primary-worktree
// hashing for the namespace, basename-derived slug, env scrub on attach — so
// the resulting session name matches what the extension would pick for the
// same folder.
//
// Recognized flags (parsed from args, not os.Args, so callers can route from
// main.go without re-slicing):
//
//	--multiplexer tmux|zellij   Override VS Code's tmuxWorktree.multiplexer.
//	--print                     Print the resolved session name and exit
//	                            without opening anything. Useful for
//	                            scripting or for verifying naming alignment
//	                            with the extension.
//	-h, --help                  Show usage and exit.
func RunOpen(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("open", flag.ContinueOnError)
	fs.SetOutput(stderr)

	multiplexerOverride := fs.String("multiplexer", "",
		"override the multiplexer chosen by VS Code settings ('tmux' or 'zellij')")
	printOnly := fs.Bool("print", false,
		"print the resolved session name and exit without opening")

	fs.Usage = func() {
		fmt.Fprintln(stderr, "Usage: tmux-worktree-tui open [--multiplexer tmux|zellij] [--print]")
		fmt.Fprintln(stderr)
		fmt.Fprintln(stderr, "Open (or attach to) the tmux/zellij session that the VS Code extension")
		fmt.Fprintln(stderr, "would use for the current directory.")
		fmt.Fprintln(stderr)
		fmt.Fprintln(stderr, "Flags:")
		fs.PrintDefaults()
	}

	if err := fs.Parse(args); err != nil {
		// flag already printed an error; just exit.
		return 2
	}
	if fs.NArg() != 0 {
		fmt.Fprintf(stderr, "error: open does not accept positional arguments (got %q)\n", fs.Args())
		fs.Usage()
		return 2
	}

	cwd, err := os.Getwd()
	if err != nil {
		fmt.Fprintf(stderr, "error: cannot read current directory: %v\n", err)
		return 1
	}

	resolved, err := identity.ResolveFromCwd(cwd)
	if err != nil {
		fmt.Fprintf(stderr, "error: cannot resolve session identity: %v\n", err)
		return 1
	}

	// Workspace settings only apply when we're inside a real git workspace —
	// passing the current dir for a non-git folder would let an unrelated
	// `.vscode/settings.json` further up the tree leak in.
	var workspaceRoot string
	if resolved.IsGit {
		workspaceRoot = resolved.IdentityRoot
	}
	settings := vscodeconfig.Load(workspaceRoot)

	chosen := settings.Multiplexer
	if *multiplexerOverride != "" {
		switch *multiplexerOverride {
		case "tmux", "zellij":
			chosen = *multiplexerOverride
		default:
			fmt.Fprintf(stderr, "error: --multiplexer must be 'tmux' or 'zellij', got %q\n", *multiplexerOverride)
			return 2
		}
	}

	if *printOnly {
		fmt.Fprintf(stdout, "session   %s\n", resolved.SessionName)
		fmt.Fprintf(stdout, "namespace %s\n", resolved.Namespace)
		fmt.Fprintf(stdout, "slug      %s\n", resolved.Slug)
		fmt.Fprintf(stdout, "root      %s\n", resolved.IdentityRoot)
		fmt.Fprintf(stdout, "cwd       %s\n", resolved.CurrentRoot)
		fmt.Fprintf(stdout, "multiplexer %s\n", chosen)
		fmt.Fprintf(stdout, "socketDir   %s\n", settings.SocketDir)
		if resolved.IsGit {
			fmt.Fprintln(stdout, "kind      git worktree")
		} else {
			fmt.Fprintln(stdout, "kind      non-git folder")
		}
		return 0
	}

	backend, err := buildBackend(chosen, settings.SocketDir)
	if err != nil {
		fmt.Fprintf(stderr, "error: %v\n", err)
		return 1
	}

	// Pass the worktree root (not pwd) so freshly created sessions land at
	// the project root, matching what the extension does when it creates
	// a session from a deeply nested file.
	if err := backend.Open(resolved.SessionName, resolved.CurrentRoot); err != nil {
		fmt.Fprintf(stderr, "error: %v\n", err)
		return 1
	}
	// Backend.Open replaces this process on the success path (outside-of-mux
	// case). Reaching here means the nested-mux path ran successfully — the
	// user is now attached/switched and we exit cleanly.
	return 0
}

func buildBackend(name, socketDir string) (multiplexer.Backend, error) {
	switch name {
	case "zellij":
		return &multiplexer.Zellij{SocketDir: socketDir}, nil
	case "tmux", "":
		return &multiplexer.Tmux{SocketDir: socketDir}, nil
	default:
		return nil, fmt.Errorf("unsupported multiplexer %q (expected 'tmux' or 'zellij')", name)
	}
}
