package git

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
)

// Worktree represents a git worktree.
type Worktree struct {
	Path     string
	Branch   string
	Head     string
	IsMain   bool
	Prunable bool
}

func normalizePath(targetPath string) string {
	absPath, err := filepath.Abs(targetPath)
	if err != nil {
		return targetPath
	}
	return absPath
}

func getMainWorktreePath(repoRoot string) string {
	cmd := exec.Command("git", "rev-parse", "--git-common-dir")
	cmd.Dir = repoRoot
	output, err := cmd.Output()
	if err != nil {
		return repoRoot
	}

	commonDir := strings.TrimSpace(string(output))
	if commonDir == "" {
		return repoRoot
	}

	if filepath.IsAbs(commonDir) {
		return filepath.Dir(commonDir)
	}

	return filepath.Dir(filepath.Join(repoRoot, commonDir))
}

// ListWorktrees returns a list of worktrees for the given repo root.
// It parses `git worktree list --porcelain`.
func ListWorktrees(repoRoot string) ([]Worktree, error) {
	cmd := exec.Command("git", "worktree", "list", "--porcelain")
	cmd.Dir = repoRoot
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git worktree list failed: %w", err)
	}

	var worktrees []Worktree
	blocks := strings.Split(string(output), "\n\n")
	mainWorktreePath := normalizePath(getMainWorktreePath(repoRoot))

	for _, block := range blocks {
		if strings.TrimSpace(block) == "" {
			continue
		}

		lines := strings.Split(block, "\n")
		var wt Worktree

		for _, line := range lines {
			if strings.HasPrefix(line, "worktree ") {
				wt.Path = strings.TrimPrefix(line, "worktree ")
			} else if strings.HasPrefix(line, "branch ") {
				wt.Branch = strings.TrimPrefix(line, "branch refs/heads/") // Strip refs/heads/
			} else if strings.HasPrefix(line, "HEAD ") {
				wt.Head = strings.TrimPrefix(line, "HEAD ")
			} else if line == "prunable" {
				wt.Prunable = true
			}
		}

		if wt.Path != "" && !wt.Prunable {
			wt.IsMain = normalizePath(wt.Path) == mainWorktreePath
			worktrees = append(worktrees, wt)
		}
	}

	return worktrees, nil
}

// GetRepoRoot returns the absolute path to the git repository root.
func GetRepoRoot(path string) (string, error) {
	cmd := exec.Command("git", "rev-parse", "--show-toplevel")
	cmd.Dir = path
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("not a git repository: %w", err)
	}
	return strings.TrimSpace(string(output)), nil
}
