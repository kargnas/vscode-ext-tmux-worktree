package git

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// GitStatus represents the status of a git repository.
// Each field counts the number of files in that state.
type GitStatus struct {
	Modified  int // Modified files (staged or unstaged)
	Added     int // Added files (staged)
	Deleted   int // Deleted files (staged or unstaged)
	Untracked int // Untracked files
}

// IsDirty returns true if there are any changes in the repository.
func (s *GitStatus) IsDirty() bool {
	return s.Modified+s.Added+s.Deleted+s.Untracked > 0
}

// GetStatus returns the git status for the given repository path.
// It runs `git status --porcelain` with a 2-second timeout.
// XY format parsing:
//   - `??` → Untracked
//   - `A ` or ` A` → Added
//   - `M ` or ` M` → Modified
//   - `D ` or ` D` → Deleted
//   - `R ` → Modified (rename treated as modified)
//   - `UU` → Modified (conflict treated as modified)
func GetStatus(repoPath string) (*GitStatus, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "git", "status", "--porcelain")
	cmd.Dir = repoPath
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git status failed: %w", err)
	}

	status := &GitStatus{}
	lines := strings.Split(string(output), "\n")

	for _, line := range lines {
		if len(line) < 2 {
			continue
		}

		// XY format: first two characters indicate status
		xy := line[0:2]

		switch {
		case xy == "??":
			status.Untracked++
		case xy[0] == 'A' || xy[1] == 'A':
			status.Added++
		case xy[0] == 'M' || xy[1] == 'M':
			status.Modified++
		case xy[0] == 'D' || xy[1] == 'D':
			status.Deleted++
		case xy[0] == 'R': // Rename treated as modified
			status.Modified++
		case xy == "UU": // Unmerged (conflict) treated as modified
			status.Modified++
		}
	}

	return status, nil
}
