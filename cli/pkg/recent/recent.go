package recent

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// standardExcludeDirs defines directories to always skip during scanning
// These are common build artifacts, dependencies, and cache directories
var standardExcludeDirs = map[string]bool{
	".git":         true,
	"node_modules": true,
	"dist":         true,
	"build":        true,
	"vendor":       true,
	".sisyphus":    true,
	"__pycache__":  true,
	".venv":        true,
	"venv":         true,
}

// GetRecentTime scans a repository path for the most recent file modification time.
// It performs a depth-limited scan (max depth 2) with gitignore-aware filtering.
//
// Scanning strategy:
// - Level 0: Files in repo root (scanned)
// - Level 1: Direct subdirectories of root (contents scanned)
// - Level 2+: Deeper subdirectories (skipped with SkipDir)
//
// Timeout: 2 seconds per repository scan
//
// Parameters:
//   - repoPath: Absolute path to the repository root
//
// Returns:
//   - Most recent modification time found
//   - Error if path doesn't exist, scan fails, or timeout occurs
func GetRecentTime(repoPath string) (time.Time, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	var mostRecent time.Time
	repoPathClean := filepath.Clean(repoPath)

	// Load .gitignore patterns if exists
	gitignorePatterns := loadGitignorePatterns(repoPath)

	// Channel to signal scan completion
	done := make(chan error, 1)

	go func() {
		err := filepath.WalkDir(repoPathClean, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				// Skip errors for inaccessible files/directories
				return nil
			}

			// Calculate depth relative to repo root
			relPath, err := filepath.Rel(repoPathClean, path)
			if err != nil {
				return nil
			}

			depth := 0
			if relPath != "." {
				depth = strings.Count(relPath, string(os.PathSeparator)) + 1
			}

			// Skip directories based on depth and exclusion rules
			if d.IsDir() {
				baseName := d.Name()

				// Level 2+ directories: SkipDir immediately
				if depth > 1 {
					return fs.SkipDir
				}

				// Standard exclude directories: SkipDir
				if standardExcludeDirs[baseName] {
					return fs.SkipDir
				}

				// Gitignore-matched directories: SkipDir
				if shouldIgnore(relPath, gitignorePatterns, true) {
					return fs.SkipDir
				}

				// Continue scanning this directory
				return nil
			}

			// For files: check gitignore patterns
			if shouldIgnore(relPath, gitignorePatterns, false) {
				return nil
			}

			// Get file info and update most recent time
			info, err := d.Info()
			if err != nil {
				return nil
			}

			modTime := info.ModTime()
			if modTime.After(mostRecent) {
				mostRecent = modTime
			}

			return nil
		})
		done <- err
	}()

	// Wait for either completion or timeout
	select {
	case err := <-done:
		if err != nil {
			return time.Time{}, fmt.Errorf("scan failed: %w", err)
		}
		return mostRecent, nil
	case <-ctx.Done():
		return mostRecent, fmt.Errorf("scan timeout after 2 seconds")
	}
}

// FormatRelativeTime formats a time as a human-readable relative time string.
//
// Format rules:
//   - < 1 minute: "just now"
//   - 1-59 minutes: "Nm ago" (e.g., "5m ago")
//   - 1-23 hours: "Nh ago" (e.g., "2h ago")
//   - 1-6 days: "Nd ago" (e.g., "3d ago")
//   - 7-29 days: "Nw ago" (e.g., "2w ago")
//   - 30+ days: "Nmo ago" (e.g., "2mo ago")
//   - zero time: "N/A"
//
// Parameters:
//   - t: Time to format
//
// Returns:
//   - Formatted relative time string
func FormatRelativeTime(t time.Time) string {
	if t.IsZero() {
		return "N/A"
	}

	duration := time.Since(t)

	// < 1 minute
	if duration < time.Minute {
		return "just now"
	}

	// 1-59 minutes
	if duration < time.Hour {
		minutes := int(duration.Minutes())
		return fmt.Sprintf("%dm ago", minutes)
	}

	// 1-23 hours
	if duration < 24*time.Hour {
		hours := int(duration.Hours())
		return fmt.Sprintf("%dh ago", hours)
	}

	// 1-6 days
	if duration < 7*24*time.Hour {
		days := int(duration.Hours() / 24)
		return fmt.Sprintf("%dd ago", days)
	}

	// 7-29 days (weeks)
	if duration < 30*24*time.Hour {
		weeks := int(duration.Hours() / 24 / 7)
		return fmt.Sprintf("%dw ago", weeks)
	}

	// 30+ days (months - approximate as 30 days)
	months := int(duration.Hours() / 24 / 30)
	return fmt.Sprintf("%dmo ago", months)
}

// GetCombinedRecentTime returns the most recent time between mtime scan and OpenCode session.
// It compares the filesystem mtime with the most recent OpenCode session activity
// and returns whichever is more recent.
//
// Parameters:
//   - repoPath: Absolute path to the repository root
//
// Returns:
//   - Most recent time (max of mtime and OpenCode session time)
func GetCombinedRecentTime(repoPath string) time.Time {
	mtime, _ := GetRecentTime(repoPath)
	opencodeTime, _ := GetOpenCodeLastUsed(repoPath)

	// Return the more recent of the two times
	if opencodeTime.After(mtime) {
		return opencodeTime
	}
	return mtime
}

// loadGitignorePatterns loads patterns from .gitignore file
// Returns empty slice if file doesn't exist or can't be read
func loadGitignorePatterns(repoPath string) []string {
	gitignorePath := filepath.Join(repoPath, ".gitignore")
	data, err := os.ReadFile(gitignorePath)
	if err != nil {
		return nil
	}

	var patterns []string
	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		// Skip empty lines and comments
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		patterns = append(patterns, line)
	}

	return patterns
}

// shouldIgnore checks if a path matches gitignore patterns
// Uses simple pattern matching without full gitignore spec compliance
func shouldIgnore(relPath string, patterns []string, isDir bool) bool {
	if len(patterns) == 0 {
		return false
	}

	// Normalize path separators for matching
	normalizedPath := filepath.ToSlash(relPath)
	if isDir && !strings.HasSuffix(normalizedPath, "/") {
		normalizedPath += "/"
	}

	for _, pattern := range patterns {
		// Normalize pattern
		pattern = filepath.ToSlash(pattern)

		// Handle directory-specific patterns (ending with /)
		if strings.HasSuffix(pattern, "/") {
			if !isDir {
				continue
			}
			pattern = strings.TrimSuffix(pattern, "/")
		}

		// Simple matching: exact match or prefix match with /**/ or *
		if strings.Contains(pattern, "*") {
			matched, _ := filepath.Match(pattern, normalizedPath)
			if matched {
				return true
			}
			// Try matching just the basename
			matched, _ = filepath.Match(pattern, filepath.Base(relPath))
			if matched {
				return true
			}
		} else {
			// Exact match or prefix match
			if normalizedPath == pattern || strings.HasPrefix(normalizedPath, pattern+"/") {
				return true
			}
		}
	}

	return false
}
