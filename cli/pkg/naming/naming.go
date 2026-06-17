package naming

import (
	"crypto/sha1"
	"encoding/hex"
	"path/filepath"
	"regexp"
	"strings"
)

// sessionNameSanitizer matches the chars the VS Code extension flattens to '-'
// in src/utils/tmuxBackend.ts and src/utils/zellijBackend.ts. Keep this in
// sync with `MultiplexerBackend.sanitizeSessionName` (regex /[/\\\s.:]/g).
var sessionNameSanitizer = regexp.MustCompile(`[/\\\s.:]`)

// SanitizeSessionName flattens path-like and whitespace chars in a slug or
// namespace so tmux and zellij accept it as a session name. Mirrors the
// extension's sanitize logic byte-for-byte.
func SanitizeSessionName(name string) string {
	return sessionNameSanitizer.ReplaceAllString(name, "-")
}

// ComputeRepoNamespace derives the `{sanitized-basename}-{sha1[:8]}` namespace
// for a primary-worktree (identity) path. Matches
// `getRepoSessionNamespaceForRoot` in src/utils/git.ts so the CLI's session
// names line up with the VS Code extension byte-for-byte.
//
// identityRoot SHOULD be an absolute path. Callers that have a relative path
// must resolve it before calling, otherwise the hash will differ from the
// extension's view of the same repo.
func ComputeRepoNamespace(identityRoot string) string {
	base := filepath.Base(identityRoot)
	if base == "" || base == "." || base == "/" {
		base = "repo"
	}
	repoName := SanitizeSessionName(base)

	sum := sha1.Sum([]byte(identityRoot))
	rootHash := hex.EncodeToString(sum[:])[:8]

	return repoName + "-" + rootHash
}

// BuildSessionName composes `{namespace}_{slug}` after sanitizing both halves.
// Pass the value from ComputeRepoNamespace as namespace.
func BuildSessionName(namespace, slug string) string {
	return SanitizeSessionName(namespace) + "_" + SanitizeSessionName(slug)
}

// ─── Legacy helpers (used by the existing TUI in cli/internal/ui) ─────────
// These functions predate the path-hash namespace used by the extension and
// remain here only to avoid breaking the bundled Bubble Tea TUI. Do NOT use
// them for new code paths; prefer ComputeRepoNamespace + BuildSessionName.

// GetRepoName returns the basename of the repository root directory.
//
// Deprecated: use ComputeRepoNamespace + the primary-worktree path instead.
func GetRepoName(repoRoot string) string {
	return filepath.Base(repoRoot)
}

// GetSlugFromSessionName extracts the slug from a tmux session name.
// Format: {repoName}_{slug}
//
// Deprecated: the extension now uses {namespace}_{slug} where namespace
// already contains a hash suffix. Use SlugFromSessionName(name, namespace).
func GetSlugFromSessionName(sessionName, repoName string) string {
	prefix := repoName + "_"
	if !strings.HasPrefix(sessionName, prefix) {
		return sessionName
	}
	slug := strings.TrimPrefix(sessionName, prefix)
	if slug == "" {
		return "main"
	}
	return slug
}

// SlugFromSessionName extracts the slug given the full namespace produced by
// ComputeRepoNamespace. Returns "" when the session doesn't belong to that
// namespace so callers can skip foreign sessions.
func SlugFromSessionName(sessionName, namespace string) string {
	prefix := SanitizeSessionName(namespace) + "_"
	if !strings.HasPrefix(sessionName, prefix) {
		return ""
	}
	slug := strings.TrimPrefix(sessionName, prefix)
	if slug == "" {
		return "main"
	}
	return slug
}

// GetSlugFromWorktree determines the slug from a worktree path.
//
// Mirrors src/utils/git.ts: the primary worktree is "main"; managed storage
// (`~/.tmux-worktrees/<ns>/<slug>` or repo-local `.worktrees/<slug>`) uses the
// basename as-is; external worktrees that happen to reuse the repo name get a
// parent-folder suffix so they don't collide with the primary slug.
func GetSlugFromWorktree(worktreePath, repoName string, isMain bool) string {
	slug := filepath.Base(worktreePath)
	parentName := filepath.Base(filepath.Dir(worktreePath))
	grandParentName := filepath.Base(filepath.Dir(filepath.Dir(worktreePath)))
	isManagedStoragePath := parentName == ".worktrees" || grandParentName == ".tmux-worktrees"

	if isMain && !isManagedStoragePath {
		return "main"
	}

	if slug == repoName {
		if isManagedStoragePath {
			return slug
		}
		if parentName != "" && parentName != slug {
			return slug + "-" + parentName
		}
	}

	return slug
}

// GetSessionName constructs the tmux session name.
//
// Deprecated: prefer BuildSessionName(ComputeRepoNamespace(identityRoot), slug)
// so the CLI matches the extension's namespace+hash format.
func GetSessionName(repoName, slug string) string {
	return repoName + "_" + slug
}

// IsRoot determines if this item should be labeled as "(root)" in the UI.
func IsRoot(_ string, repoName string, worktreePath string, isMain bool) bool {
	if isMain {
		return true
	}

	if worktreePath != "" {
		base := filepath.Base(worktreePath)
		parentName := filepath.Base(filepath.Dir(worktreePath))
		grandParentName := filepath.Base(filepath.Dir(filepath.Dir(worktreePath)))
		isManagedStoragePath := parentName == ".worktrees" || grandParentName == ".tmux-worktrees"
		if base == repoName && !isManagedStoragePath {
			return true
		}
	}

	return false
}
