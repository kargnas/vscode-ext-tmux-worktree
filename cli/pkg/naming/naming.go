package naming

import (
	"path/filepath"
	"strings"
)

// GetRepoName returns the basename of the repository root directory.
func GetRepoName(repoRoot string) string {
	return filepath.Base(repoRoot)
}

// GetSlugFromSessionName extracts the slug from a tmux session name.
// Format: {repoName}_{slug}
func GetSlugFromSessionName(sessionName, repoName string) string {
	prefix := repoName + "_"
	if !strings.HasPrefix(sessionName, prefix) {
		// If prefix doesn't match, it might not be a managed session,
		// but if we force it, return raw name or handle as needed.
		// For now, consistent with TS logic:
		return sessionName
	}

	slug := strings.TrimPrefix(sessionName, prefix)
	if slug == "" {
		return "main"
	}
	return slug
}

// GetSlugFromWorktree determines the slug from a worktree path.
func GetSlugFromWorktree(worktreePath, repoName string, isMain bool) string {
	slug := filepath.Base(worktreePath)

	// 1. If worktree is main branch AND path does not contain ".worktrees"
	//    (usually the root repo directory) -> force "main"
	if isMain && !strings.Contains(worktreePath, ".worktrees") {
		return "main"
	}

	// 2. If the directory name (slug) equals the repo name -> force "main"
	//    (e.g. /path/to/my-project)
	if slug == repoName {
		return "main"
	}

	return slug
}

// GetSessionName constructs the tmux session name.
func GetSessionName(repoName, slug string) string {
	return repoName + "_" + slug
}

// IsMainBranch determines if a branch is considered "main".
// Logic: If it starts with "task/", it is NOT main.
func IsMainBranch(branch string) bool {
	return !strings.HasPrefix(branch, "task/")
}

// IsRoot determines if this item should be labeled as "(root)" in the UI.
func IsRoot(slug, repoName string, worktreePath string, isMain bool) bool {
	// Logic from TmuxSessionItem constructor
	// if (!label || label === repoName) -> (root)

	if slug == "" || slug == repoName || slug == "main" {
		return true
	}

	// Logic from worktree path check
	if worktreePath != "" {
		base := filepath.Base(worktreePath)
		if base == repoName {
			return true
		}

		// if (worktree.isMain && !worktree.path.includes('.worktrees'))
		if isMain && !strings.Contains(worktreePath, ".worktrees") {
			return true
		}
	}

	return false
}
