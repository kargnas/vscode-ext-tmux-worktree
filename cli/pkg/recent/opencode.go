package recent

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// openCodeSession represents the structure of an OpenCode session JSON file
type openCodeSession struct {
	Directory string `json:"directory"`
	Time      struct {
		Updated int64 `json:"updated"`
	} `json:"time"`
}

// GetOpenCodeLastUsed scans OpenCode session files and returns the most recent
// update time for the given repository path.
//
// It searches ~/.local/share/opencode/storage/session/*/ses_*.json files,
// matches them by the 'directory' field, and returns the most recent 'time.updated'.
//
// Returns zero time if no matching session is found or if any error occurs.
func GetOpenCodeLastUsed(repoPath string) (time.Time, error) {
	// Normalize the input path for exact matching
	cleanRepoPath := filepath.Clean(repoPath)

	// Get the OpenCode session storage directory
	homeDir, err := os.UserHomeDir()
	if err != nil {
		// Return zero time on error, as per MUST DO requirement
		return time.Time{}, nil
	}

	sessionStorageDir := filepath.Join(homeDir, ".local/share/opencode/storage/session")

	// Check if the directory exists
	if _, err := os.Stat(sessionStorageDir); os.IsNotExist(err) {
		// No OpenCode sessions exist
		return time.Time{}, nil
	}

	// Read all project directories
	projectDirs, err := os.ReadDir(sessionStorageDir)
	if err != nil {
		// Return zero time on read error
		return time.Time{}, nil
	}

	var mostRecent time.Time

	// Iterate through each project directory
	for _, projectDir := range projectDirs {
		if !projectDir.IsDir() {
			continue
		}

		projectPath := filepath.Join(sessionStorageDir, projectDir.Name())

		// Find all ses_*.json files in this project directory
		sessionFiles, err := filepath.Glob(filepath.Join(projectPath, "ses_*.json"))
		if err != nil {
			// Skip on error
			continue
		}

		// Check each session file
		for _, sessionFile := range sessionFiles {
			data, err := os.ReadFile(sessionFile)
			if err != nil {
				// Skip unreadable files
				continue
			}

			var session openCodeSession
			if err := json.Unmarshal(data, &session); err != nil {
				// Skip invalid JSON
				continue
			}

			// Normalize the session directory path
			cleanSessionDir := filepath.Clean(session.Directory)

			// Exact match only
			if cleanSessionDir == cleanRepoPath {
				// Convert Unix milliseconds to time.Time
				sessionTime := time.UnixMilli(session.Time.Updated)

				// Keep track of the most recent time
				if sessionTime.After(mostRecent) {
					mostRecent = sessionTime
				}
			}
		}
	}

	return mostRecent, nil
}
