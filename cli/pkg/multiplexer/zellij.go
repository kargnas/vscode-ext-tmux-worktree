package multiplexer

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"

	"github.com/kargnas/tmux-worktree-tui/pkg/socketdir"
)

// Zellij implements Backend on top of the `zellij` binary.
//
// SocketDir is the parent passed to socketdir.ZellijSocketDir — it must match
// the value the extension is using (see src/utils/socketDir.ts) or the CLI
// will end up talking to a different zellij server than VS Code.
type Zellij struct {
	SocketDir string
}

// Name reports the backend identifier used in diagnostic messages.
func (z *Zellij) Name() string { return "zellij" }

// Open replaces the current process with `zellij attach --create
// --force-run-commands <name>`, sanitizing env and pinning ZELLIJ_SOCKET_DIR
// so the CLI and the extension share the same zellij server.
//
// Leading-dash session names (common when the repo basename starts with '.',
// e.g. `.hermes`) are passed after `--` so zellij does not parse them as
// flags. This mirrors the workaround documented in AGENTS.md under
// "Zellij Leading-Dash Session Names".
func (z *Zellij) Open(sessionName, cwd string) error {
	if os.Getenv("ZELLIJ") != "" {
		// Zellij has no `switch-client` equivalent: re-attaching from inside
		// a session corrupts the parent client. Tell the user instead of
		// silently misbehaving.
		return fmt.Errorf(
			"already inside a zellij session (ZELLIJ env set). "+
				"Detach first (Ctrl+P → D) before opening %q",
			sessionName,
		)
	}

	binPath, err := exec.LookPath("zellij")
	if err != nil {
		return fmt.Errorf("zellij not found in PATH (install: `cargo install zellij` or `brew install zellij`)")
	}

	socketDir := socketdir.ZellijSocketDir(z.SocketDir)
	if err := socketdir.EnsureExists(socketDir); err != nil {
		return fmt.Errorf("zellij: %w", err)
	}

	// Build args. The flag order matches buildZellijInteractiveAttachCommand
	// in src/utils/zellijCommands.ts. We deliberately skip the
	// `options --simplified-ui true` tail because the CLI runs in the user's
	// native terminal (which normally has full glyph coverage); the extension
	// only needs simplified UI for VS Code's integrated terminal.
	args := []string{"zellij", "attach", "--create", "--force-run-commands"}
	if strings.HasPrefix(sessionName, "-") {
		args = append(args, "--", sessionName)
	} else {
		args = append(args, sessionName)
	}

	if cwd != "" {
		// `zellij attach` ignores --cwd; the spawned shell inherits the
		// CWD of the process invoking attach. Chdir before exec so a newly
		// created session opens its first pane in the requested folder.
		if err := os.Chdir(cwd); err != nil {
			return fmt.Errorf("zellij: chdir %s: %w", cwd, err)
		}
	}

	env := buildSanitizedEnv(map[string]string{
		// Seed the bootstrap shell with a sane terminal type so detached
		// sessions don't end up with TERM=dumb — see the "Zellij Detached
		// Session TERM Trap" note in the project's AGENTS.md.
		"TERM":              "xterm-256color",
		"COLORTERM":         "truecolor",
		"ZELLIJ_SOCKET_DIR": socketDir,
	})

	// syscall.Exec replaces the current process so the user's terminal
	// becomes the zellij client directly. Any return from Exec means it
	// failed, so wrap the error for the caller.
	if err := syscall.Exec(binPath, args, env); err != nil {
		return fmt.Errorf("zellij: exec %s: %w", binPath, err)
	}
	return nil
}
