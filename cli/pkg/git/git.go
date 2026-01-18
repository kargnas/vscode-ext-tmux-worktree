package git

import (
	"fmt"
	"os/exec"
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
			// Determine IsMain based on branch name (using same logic as TS)
			// In TS: isMain: !branch.startsWith('task/')
			wt.IsMain = !strings.HasPrefix(wt.Branch, "task/")
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
