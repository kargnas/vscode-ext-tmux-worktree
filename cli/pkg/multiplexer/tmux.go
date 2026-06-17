package multiplexer

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"

	"github.com/kargnas/tmux-worktree-tui/pkg/socketdir"
)

// Tmux implements Backend on top of the `tmux` binary.
//
// SocketDir is the base passed to socketdir.TmuxTmpDir — it must match the
// `tmuxWorktree.socketDir` setting in VS Code or the CLI will talk to a
// different tmux server than the extension is using.
type Tmux struct {
	SocketDir string
}

// Name reports the backend identifier used in diagnostic messages.
func (t *Tmux) Name() string { return "tmux" }

// Open attaches to the session, creating it if missing.
//
// Behaviour differs by context:
//   - Inside tmux (TMUX env set): ensures the session exists, then issues
//     `tmux switch-client -t <name>` so the user's existing client jumps
//     to it. The CLI process exits normally after the switch.
//   - Outside tmux: replaces the current process with
//     `tmux new-session -A -s <name>` so the terminal becomes the tmux
//     client directly. `-A` attaches when the session already exists.
//
// Both paths apply the same env scrub the extension uses
// (see src/utils/tmuxBackend.ts) so VSCODE_* / TERM_PROGRAM leakage does
// not poison the running tmux server.
func (t *Tmux) Open(sessionName, cwd string) error {
	binPath, err := exec.LookPath("tmux")
	if err != nil {
		return fmt.Errorf("tmux not found in PATH (install: `brew install tmux`)")
	}

	tmpDir := socketdir.TmuxTmpDir(t.SocketDir)
	if err := socketdir.EnsureExists(tmpDir); err != nil {
		return fmt.Errorf("tmux: %w", err)
	}

	// Scrub VSCODE_* / TERM_PROGRAM keys that may already be cached on the
	// running tmux server. This is the Go equivalent of the
	// `buildStoredTmuxEnvScrubCommand` helper in src/utils/tmuxBackend.ts —
	// without it, panes spawned after the CLI attaches can still inherit
	// stale shell-integration markers from a server that was originally
	// started by VS Code.
	scrubServerEnv(binPath, tmpDir, sessionName)

	// Build the env the new tmux process (or the existing server's new
	// session) sees. We always pin TMUX_TMPDIR so the socket lands in the
	// configured dir regardless of the user's current shell env.
	env := buildSanitizedEnv(map[string]string{
		"TERM":        "xterm-256color",
		"COLORTERM":   "truecolor",
		"TMUX_TMPDIR": tmpDir,
	})

	if os.Getenv("TMUX") != "" {
		// Nested tmux: don't try to replace the process — the parent client
		// already owns the terminal. Make sure the target session exists,
		// then ask the server to switch the current client to it.
		ensureSession(binPath, tmpDir, sessionName, cwd)

		cmd := exec.Command(binPath, "switch-client", "-t", sessionName)
		cmd.Env = env
		cmd.Stdin = os.Stdin
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("tmux: switch-client %s: %w", sessionName, err)
		}
		return nil
	}

	// Outside tmux: hand the terminal over to tmux. `-A` makes `new-session`
	// attach if the session is already there, so we don't need a separate
	// has-session probe.
	args := []string{
		"tmux", "new-session", "-A", "-s", sessionName,
	}
	if cwd != "" {
		args = append(args, "-c", cwd)
	}

	if err := syscall.Exec(binPath, args, env); err != nil {
		return fmt.Errorf("tmux: exec %s: %w", binPath, err)
	}
	return nil
}

// ensureSession creates the session in detached mode if it doesn't exist yet.
// Errors are swallowed because the most common one ("duplicate session")
// already means the session is there, which is what we want.
func ensureSession(binPath, tmpDir, sessionName, cwd string) {
	check := exec.Command(binPath, "has-session", "-t", sessionName)
	check.Env = append(os.Environ(), "TMUX_TMPDIR="+tmpDir)
	if err := check.Run(); err == nil {
		return // session already exists
	}

	args := []string{"new-session", "-d", "-s", sessionName}
	if cwd != "" {
		args = append(args, "-c", cwd)
	}
	create := exec.Command(binPath, args...)
	create.Env = buildSanitizedEnv(map[string]string{"TMUX_TMPDIR": tmpDir})
	_ = create.Run()
}

// scrubServerEnv clears VSCODE_* / TERM_PROGRAM* on the global tmux
// environment and on the target session if it exists. Failures are silent:
// a missing server simply means there's nothing to scrub, which is fine.
func scrubServerEnv(binPath, tmpDir, sessionName string) {
	envPrefix := append(os.Environ(), "TMUX_TMPDIR="+tmpDir)

	keys := []string{
		"ELECTRON_RUN_AS_NODE",
		"TERM_PROGRAM",
		"TERM_PROGRAM_VERSION",
		"VSCODE_INJECTION",
		"VSCODE_SHELL_INTEGRATION",
	}
	for _, key := range keys {
		run := exec.Command(binPath, "set-environment", "-gu", key)
		run.Env = envPrefix
		_ = run.Run()
		if sessionName != "" {
			run = exec.Command(binPath, "set-environment", "-t", sessionName, "-u", key)
			run.Env = envPrefix
			_ = run.Run()
		}
	}

	// Also iterate the server's stored env in case it accumulated other
	// VSCODE_* keys we don't know about (extension does the same loop).
	listCmd := exec.Command(binPath, "show-environment", "-g")
	listCmd.Env = envPrefix
	out, err := listCmd.Output()
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(out), "\n") {
		if line == "" {
			continue
		}
		name := line
		if eq := strings.IndexByte(line, '='); eq >= 0 {
			name = line[:eq]
		}
		if !strings.HasPrefix(name, "VSCODE_") {
			continue
		}
		run := exec.Command(binPath, "set-environment", "-gu", name)
		run.Env = envPrefix
		_ = run.Run()
		if sessionName != "" {
			run = exec.Command(binPath, "set-environment", "-t", sessionName, "-u", name)
			run.Env = envPrefix
			_ = run.Run()
		}
	}
}
