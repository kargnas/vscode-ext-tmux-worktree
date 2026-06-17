// Package multiplexer wraps the platform-specific tmux/zellij invocation
// logic the CLI shares with the VS Code extension.
//
// Both backends apply the same env-scrub policy the extension uses
// (see src/utils/{tmux,zellij}Backend.ts) so that a session created from
// VS Code and one created from `tmux-worktree-tui open` behave identically:
// no leaked VSCODE_* / ELECTRON_RUN_AS_NODE / TERM_PROGRAM env, and the
// IPC socket lives under the configured socketDir.
package multiplexer

import (
	"os"
	"strings"
)

// Backend abstracts "open a session by name in the given cwd, replacing
// the current process if possible". Implementations live in zellij.go and
// tmux.go.
type Backend interface {
	// Name returns the canonical short name ("tmux" / "zellij") for
	// diagnostic messages.
	Name() string

	// Open attaches to the session, creating it if missing. cwd is used
	// when a new session is created. On success this function does NOT
	// return — it replaces the current process via syscall.Exec.
	Open(sessionName, cwd string) error
}

// stripEnvKeys lists the env vars both backends remove before launching the
// multiplexer. Mirrors the constants in tmuxBackend.ts and zellijBackend.ts.
//
// We also drop anything whose name starts with `VSCODE_` because VS Code
// sometimes injects fresh shell-integration variables (e.g.
// `VSCODE_GIT_IPC_HANDLE`) that did not exist when this list was written.
var stripEnvKeys = []string{
	"ELECTRON_RUN_AS_NODE",
	"TERM_PROGRAM",
	"TERM_PROGRAM_VERSION",
	"VSCODE_INJECTION",
	"VSCODE_SHELL_INTEGRATION",
}

// shouldStripEnv mirrors `isTmuxIntegrationEnvKey` / `isZellijIntegrationEnvKey`
// in the extension: drop the explicit list plus any `VSCODE_*` key.
func shouldStripEnv(key string) bool {
	if strings.HasPrefix(key, "VSCODE_") {
		return true
	}
	for _, k := range stripEnvKeys {
		if key == k {
			return true
		}
	}
	return false
}

// buildSanitizedEnv returns os.Environ() with the strip-keys removed and the
// caller-supplied overrides merged in last (overrides win over the inherited
// environment). The result is suitable for syscall.Exec.
//
// Overrides with an empty string explicitly *set* the variable to "", which
// is intentional — that lets callers force e.g. `COLORTERM=truecolor` even
// when the user's shell had it unset.
func buildSanitizedEnv(overrides map[string]string) []string {
	keep := make([]string, 0, len(os.Environ()))
	overridden := make(map[string]bool, len(overrides))
	for k := range overrides {
		overridden[k] = true
	}

	for _, kv := range os.Environ() {
		eq := strings.IndexByte(kv, '=')
		if eq < 0 {
			continue
		}
		key := kv[:eq]
		if shouldStripEnv(key) {
			continue
		}
		if overridden[key] {
			// Skip; the override is appended below in deterministic order.
			continue
		}
		keep = append(keep, kv)
	}

	for k, v := range overrides {
		keep = append(keep, k+"="+v)
	}
	return keep
}
