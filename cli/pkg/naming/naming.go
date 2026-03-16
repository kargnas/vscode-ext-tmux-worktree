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
	parentName := filepath.Base(filepath.Dir(worktreePath))
	grandParentName := filepath.Base(filepath.Dir(filepath.Dir(worktreePath)))
	isManagedStoragePath := parentName == ".worktrees" || grandParentName == ".tmux-worktrees"

	// 1. If worktree is main branch AND path does not contain ".worktrees"
	//    (usually the root repo directory) -> force "main"
	if isMain && !isManagedStoragePath {
		return "main"
	}

	// 2. External worktrees that reuse the repo directory name need a parent suffix.
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
