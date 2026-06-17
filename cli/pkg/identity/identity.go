// Package identity derives the same "session identity" the VS Code extension
// computes from a working directory: a `{repo-basename}-{sha1[:8]}` namespace
// plus a per-worktree slug. The CLI uses it to build session names that
// match the extension's view of the same repo byte-for-byte.
package identity

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/kargnas/tmux-worktree-tui/pkg/naming"
)

// Resolved describes the multiplexer session that maps to a working directory.
type Resolved struct {
	// IdentityRoot is the absolute path the namespace hash was computed from.
	// For git workspaces this is the primary worktree path, NOT the current
	// (possibly linked) worktree. For non-git folders this is the folder
	// itself.
	IdentityRoot string

	// CurrentRoot is the absolute path of the worktree the user is currently
	// inside. Equal to IdentityRoot for the primary worktree and for non-git
	// folders.
	CurrentRoot string

	// Namespace is `{sanitized-basename}-{sha1[:8]}` of IdentityRoot.
	Namespace string

	// Slug is the per-worktree identifier ("main", branch slug, etc.) used as
	// the second half of the session name.
	Slug string

	// SessionName is `{Namespace}_{Slug}` after sanitization.
	SessionName string

	// IsGit is true when CurrentRoot is inside a git worktree.
	IsGit bool

	// IsPrimary is true when CurrentRoot matches IdentityRoot (i.e. the user
	// is in the primary worktree, or this is a non-git folder).
	IsPrimary bool
}

// ResolveFromCwd inspects the given working directory and returns the session
// identity for it. When the directory is not inside a git worktree, the
// folder itself becomes the identity root with slug "main" — matching the
// extension's `current project (no git)` fallback.
func ResolveFromCwd(cwd string) (*Resolved, error) {
	absCwd, err := filepath.Abs(cwd)
	if err != nil {
		return nil, fmt.Errorf("resolve cwd: %w", err)
	}

	// `git rev-parse --show-toplevel` returns the current worktree root. We
	// use --git-common-dir separately to identify the primary worktree path,
	// which is the stable anchor for the namespace.
	currentRoot, currentErr := runGit(absCwd, "rev-parse", "--show-toplevel")
	if currentErr != nil {
		// Not a git repo (or git missing). Fall back to the folder itself
		// so the user still gets a session that matches the extension's
		// no-git label.
		return buildNonGitResolved(absCwd), nil
	}

	primaryRoot, primaryErr := resolvePrimaryWorktree(absCwd)
	if primaryErr != nil {
		// `--git-common-dir` failing while `--show-toplevel` succeeded is
		// rare but possible on very old git versions. Use the current
		// worktree as the identity root to avoid a hard failure.
		primaryRoot = currentRoot
	}

	repoBasename := filepath.Base(primaryRoot)
	isPrimary := samePath(currentRoot, primaryRoot)
	slug := naming.GetSlugFromWorktree(currentRoot, repoBasename, isPrimary)

	namespace := naming.ComputeRepoNamespace(primaryRoot)
	sessionName := naming.BuildSessionName(namespace, slug)

	return &Resolved{
		IdentityRoot: primaryRoot,
		CurrentRoot:  currentRoot,
		Namespace:    namespace,
		Slug:         slug,
		SessionName:  sessionName,
		IsGit:        true,
		IsPrimary:    isPrimary,
	}, nil
}

func buildNonGitResolved(absCwd string) *Resolved {
	namespace := naming.ComputeRepoNamespace(absCwd)
	slug := "main"
	return &Resolved{
		IdentityRoot: absCwd,
		CurrentRoot:  absCwd,
		Namespace:    namespace,
		Slug:         slug,
		SessionName:  naming.BuildSessionName(namespace, slug),
		IsGit:        false,
		IsPrimary:    true,
	}
}

// resolvePrimaryWorktree returns the absolute path of the primary worktree by
// asking git for the shared `--git-common-dir`. The parent of that directory
// is the primary worktree root, mirroring src/utils/git.ts.
func resolvePrimaryWorktree(cwd string) (string, error) {
	// Prefer the absolute-format variant so we don't have to second-guess
	// whether git returned a relative path. Older gits ignore the flag,
	// in which case we fall through and resolve relative paths manually.
	out, err := runGit(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir")
	if err != nil {
		out, err = runGit(cwd, "rev-parse", "--git-common-dir")
		if err != nil {
			return "", err
		}
	}
	commonDir := strings.TrimSpace(out)
	if commonDir == "" {
		return "", fmt.Errorf("git returned empty --git-common-dir")
	}

	if !filepath.IsAbs(commonDir) {
		commonDir = filepath.Join(cwd, commonDir)
	}
	abs, err := filepath.Abs(commonDir)
	if err != nil {
		return "", fmt.Errorf("absolutize common dir: %w", err)
	}
	return filepath.Dir(abs), nil
}

func runGit(cwd string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = cwd
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// samePath compares two paths after Clean() + Abs(). It deliberately does NOT
// follow symlinks because the extension also keeps symlink aliases intact
// (see "Canonical Path Matching" in AGENTS.md).
func samePath(a, b string) bool {
	aAbs, errA := filepath.Abs(filepath.Clean(a))
	bAbs, errB := filepath.Abs(filepath.Clean(b))
	if errA != nil || errB != nil {
		return false
	}
	return aAbs == bAbs
}
