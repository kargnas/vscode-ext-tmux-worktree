package discovery

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// FindGitRepos scans directories for git repositories.
// Expands ~ in paths and handles symlinks correctly.
func FindGitRepos(roots []string, maxDepth int) []string {
	var repos []string
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, root := range roots {
		wg.Add(1)
		go func(path string) {
			defer wg.Done()
			// Expand tilde (~) to home directory
			expandedPath := expandTilde(path)
			found := scan(expandedPath, maxDepth)
			mu.Lock()
			repos = append(repos, found...)
			mu.Unlock()
		}(root)
	}

	wg.Wait()
	return repos
}

// expandTilde replaces ~ with the user's home directory
func expandTilde(path string) string {
	if !strings.HasPrefix(path, "~") {
		return path
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return path // Fallback to original if home dir not found
	}
	if path == "~" {
		return home
	}
	if strings.HasPrefix(path, "~/") {
		return filepath.Join(home, path[2:])
	}
	return path
}

func scan(root string, depth int) []string {
	if depth < 0 {
		return nil
	}

	var results []string
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil
	}

	isRepo := false
	for _, entry := range entries {
		if entry.Name() == ".git" {
			isRepo = true
			break
		}
	}

	if isRepo {
		results = append(results, root)
		// Don't scan deeper if it's a repo?
		// Usually we stop at repo root.
		return results
	}

	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}

		fullPath := filepath.Join(root, name)

		info, err := entry.Info()
		if err != nil {
			continue
		}

		// Handle symlinks: scan the resolved path, not the symlink itself
		if info.Mode()&os.ModeSymlink != 0 {
			resolved, err := filepath.EvalSymlinks(fullPath)
			if err == nil {
				stat, err := os.Stat(resolved)
				if err == nil && stat.IsDir() {
					results = append(results, scan(resolved, depth-1)...)
				}
			}
			continue
		}

		if entry.IsDir() {
			results = append(results, scan(fullPath, depth-1)...)
		}
	}

	return results
}
