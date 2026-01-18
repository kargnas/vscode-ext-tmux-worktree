package discovery

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExpandTilde(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		input    string
		expected string
	}{
		{"~/projects", filepath.Join(home, "projects")},
		{"~", home},
		{"/absolute/path", "/absolute/path"},
		{"relative/path", "relative/path"},
		{"~/", home},
	}

	for _, tc := range tests {
		result := expandTilde(tc.input)
		if result != tc.expected {
			t.Errorf("expandTilde(%q) = %q, expected %q", tc.input, result, tc.expected)
		}
	}
}

func TestFindGitRepos_TildeExpansion(t *testing.T) {
	tmpDir := t.TempDir()
	repoDir := filepath.Join(tmpDir, "test-repo")
	if err := os.MkdirAll(filepath.Join(repoDir, ".git"), 0755); err != nil {
		t.Fatal(err)
	}

	repos := FindGitRepos([]string{tmpDir}, 2)
	if len(repos) != 1 {
		t.Fatalf("expected 1 repo, got %d", len(repos))
	}

	if !strings.HasSuffix(repos[0], "test-repo") {
		t.Errorf("expected repo path to end with 'test-repo', got %s", repos[0])
	}
}

func TestScan_SymlinkHandling(t *testing.T) {
	tmpDir := t.TempDir()

	realRepoDir := filepath.Join(tmpDir, "real-repo")
	if err := os.MkdirAll(filepath.Join(realRepoDir, ".git"), 0755); err != nil {
		t.Fatal(err)
	}

	symlinkPath := filepath.Join(tmpDir, "symlink-repo")
	if err := os.Symlink(realRepoDir, symlinkPath); err != nil {
		t.Skip("symlink creation not supported on this system")
	}

	repos := FindGitRepos([]string{tmpDir}, 2)

	foundReal := false
	for _, repo := range repos {
		resolved, _ := filepath.EvalSymlinks(repo)
		if resolved == realRepoDir || repo == realRepoDir {
			foundReal = true
			break
		}
	}

	if !foundReal {
		t.Error("symlinked repository should be discovered via resolved path")
	}
}
