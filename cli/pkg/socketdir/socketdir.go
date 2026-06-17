// Package socketdir mirrors src/utils/socketDir.ts: it resolves the directory
// tmux/zellij IPC sockets live in (default /var/tmp) and exposes the per-
// multiplexer subdirs the extension uses.
//
// Keeping this layout identical to the extension is what lets the CLI and the
// VS Code extension attach to the same running sessions.
package socketdir

import (
	"fmt"
	"os"
	"path/filepath"
)

// EnsureExists makes sure the configured socket dir is present so tmux/zellij
// don't error out with "connection refused" before they ever start. We use
// MkdirAll so concurrent CLI invocations don't race.
func EnsureExists(dir string) error {
	if dir == "" {
		return fmt.Errorf("socketdir: empty path")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("socketdir: mkdir %s: %w", dir, err)
	}
	return nil
}

// ZellijSocketDir is `$SOCKET_DIR/zellij`. Zellij stores its IPC socket at
// `$ZELLIJ_SOCKET_DIR/<session>`, so we use a dedicated subdir to keep its
// files away from tmux's `tmux-<UID>/` subdir.
func ZellijSocketDir(base string) string {
	return filepath.Join(base, "zellij")
}

// TmuxTmpDir equals the configured socket dir. Tmux derives its full socket
// path from `$TMUX_TMPDIR/tmux-<UID>/<socket-name>` and auto-creates the
// `tmux-<UID>` subdir on demand, so we only need to ensure the parent.
func TmuxTmpDir(base string) string {
	return base
}
