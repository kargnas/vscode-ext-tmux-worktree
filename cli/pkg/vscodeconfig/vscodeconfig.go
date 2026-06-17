// Package vscodeconfig reads the VS Code extension's user-facing settings
// (multiplexer, socketDir) from JSONC settings files so the CLI follows the
// same rules the user already configured for the extension.
//
// Resolution order — first hit wins:
//  1. Workspace settings: `<repoRoot>/.vscode/settings.json`
//  2. User settings: known Code/Cursor/Insiders/Antigravity paths
//  3. Built-in defaults
//
// The reader is intentionally lenient: parse failures are treated as
// "no value", not fatal errors, so a broken settings file in one editor
// variant does not prevent `tmux-worktree-tui open` from working.
package vscodeconfig

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Settings are the subset of VS Code preferences the CLI consumes.
type Settings struct {
	// Multiplexer is either "tmux" or "zellij" (default "tmux").
	Multiplexer string

	// SocketDir is the directory tmux/zellij IPC sockets live in
	// (default "/var/tmp"). Expanded `~` is resolved before returning.
	SocketDir string
}

// Defaults must match src/utils/multiplexer.ts and src/utils/socketDir.ts so
// the CLI's "no settings found" behavior matches the extension's defaults.
const (
	defaultMultiplexer = "tmux"
	defaultSocketDir   = "/var/tmp"
)

// Load reads workspace + user settings and merges them into one Settings
// struct. workspaceRoot may be empty when called outside a git repo; in that
// case only user settings are consulted.
func Load(workspaceRoot string) Settings {
	out := Settings{
		Multiplexer: defaultMultiplexer,
		SocketDir:   defaultSocketDir,
	}

	// Order: workspace first, then user variants. We OR-merge per key so an
	// unset workspace key falls through to user settings, matching the way
	// VS Code overlays workspace settings on top of user settings.
	var sources []string
	if workspaceRoot != "" {
		sources = append(sources, filepath.Join(workspaceRoot, ".vscode", "settings.json"))
	}
	sources = append(sources, userSettingsPaths()...)

	merged := map[string]any{}
	for _, p := range sources {
		raw := readSettings(p)
		for k, v := range raw {
			if _, seen := merged[k]; !seen {
				merged[k] = v
			}
		}
	}

	if v, ok := lookupString(merged, "tmuxWorktree.multiplexer"); ok {
		// Defensive normalize: accept only the two known values; anything
		// else falls back to the default so a typo doesn't break attach.
		switch strings.ToLower(v) {
		case "tmux":
			out.Multiplexer = "tmux"
		case "zellij":
			out.Multiplexer = "zellij"
		}
	}
	if v, ok := lookupString(merged, "tmuxWorktree.socketDir"); ok && strings.TrimSpace(v) != "" {
		out.SocketDir = expandHome(strings.TrimSpace(v))
	}

	return out
}

// userSettingsPaths returns candidate paths in priority order. We only emit
// paths whose parent dir exists so we don't waste IO on editors the user
// doesn't have installed.
func userSettingsPaths() []string {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}

	var base string
	switch runtime.GOOS {
	case "darwin":
		base = filepath.Join(home, "Library", "Application Support")
	case "linux":
		base = filepath.Join(home, ".config")
	default:
		// Windows / others are not in the project's supported list (see
		// AGENTS.md "Tested VS Code"), so skip them.
		return nil
	}

	// Order chosen to match the AGENTS.md "Tested VS Code" list (code,
	// antigravity, cursor) plus Insiders for parity with VS Code stable.
	variants := []string{
		"Code",
		"Code - Insiders",
		"Cursor",
		"Antigravity",
	}

	var paths []string
	for _, v := range variants {
		candidate := filepath.Join(base, v, "User", "settings.json")
		if _, err := os.Stat(filepath.Dir(candidate)); err == nil {
			paths = append(paths, candidate)
		}
	}
	return paths
}

func readSettings(path string) map[string]any {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	stripped := stripJSONCComments(string(data))
	stripped = stripTrailingCommas(stripped)

	var out map[string]any
	if err := json.Unmarshal([]byte(stripped), &out); err != nil {
		// Settings file exists but is malformed: skip it rather than fail
		// the whole CLI invocation.
		return nil
	}
	return out
}

// lookupString tries the key as both a flat dotted key ("tmuxWorktree.multiplexer")
// and a nested object ({"tmuxWorktree": {"multiplexer": "..."}}). VS Code
// writes the flat form by default, but some users prefer the nested form.
func lookupString(m map[string]any, dottedKey string) (string, bool) {
	if v, ok := m[dottedKey]; ok {
		if s, ok := v.(string); ok {
			return s, true
		}
	}
	parts := strings.SplitN(dottedKey, ".", 2)
	if len(parts) == 2 {
		if inner, ok := m[parts[0]].(map[string]any); ok {
			if v, ok := inner[parts[1]]; ok {
				if s, ok := v.(string); ok {
					return s, true
				}
			}
		}
	}
	return "", false
}

// stripJSONCComments removes // line comments and /* */ block comments while
// leaving comment-looking sequences inside string literals alone. It does not
// try to be a full JSONC parser — just enough to feed encoding/json.
func stripJSONCComments(s string) string {
	var b strings.Builder
	b.Grow(len(s))

	inString := false
	inLineComment := false
	inBlockComment := false

	for i := 0; i < len(s); i++ {
		c := s[i]
		if inLineComment {
			if c == '\n' {
				inLineComment = false
				b.WriteByte(c)
			}
			continue
		}
		if inBlockComment {
			if c == '*' && i+1 < len(s) && s[i+1] == '/' {
				inBlockComment = false
				i++ // skip the '/'
			}
			continue
		}
		if inString {
			b.WriteByte(c)
			if c == '\\' && i+1 < len(s) {
				// keep the escaped char so we don't misread `\"` as string end
				b.WriteByte(s[i+1])
				i++
				continue
			}
			if c == '"' {
				inString = false
			}
			continue
		}

		if c == '"' {
			inString = true
			b.WriteByte(c)
			continue
		}
		if c == '/' && i+1 < len(s) {
			next := s[i+1]
			if next == '/' {
				inLineComment = true
				i++
				continue
			}
			if next == '*' {
				inBlockComment = true
				i++
				continue
			}
		}
		b.WriteByte(c)
	}

	return b.String()
}

// stripTrailingCommas removes commas that sit immediately before a closing
// ']' or '}', which JSONC tolerates but encoding/json does not.
func stripTrailingCommas(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	inString := false

	for i := 0; i < len(s); i++ {
		c := s[i]
		if inString {
			b.WriteByte(c)
			if c == '\\' && i+1 < len(s) {
				b.WriteByte(s[i+1])
				i++
				continue
			}
			if c == '"' {
				inString = false
			}
			continue
		}
		if c == '"' {
			inString = true
			b.WriteByte(c)
			continue
		}
		if c == ',' {
			// Look ahead past whitespace for the next significant byte.
			j := i + 1
			for j < len(s) && (s[j] == ' ' || s[j] == '\t' || s[j] == '\n' || s[j] == '\r') {
				j++
			}
			if j < len(s) && (s[j] == ']' || s[j] == '}') {
				// drop the trailing comma
				continue
			}
		}
		b.WriteByte(c)
	}
	return b.String()
}

func expandHome(p string) string {
	if p == "~" {
		if home, err := os.UserHomeDir(); err == nil {
			return home
		}
		return p
	}
	if strings.HasPrefix(p, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, p[2:])
		}
	}
	return p
}
