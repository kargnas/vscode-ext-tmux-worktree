# tmux-worktree-tui

**공식 명칭**: `tmux-worktree-tui`  
**실행 명령어**: `tmux-worktree-tui`

This project is a Go CLI that provides two entry points for the same
multiplexer (tmux / zellij) sessions the `vscode-tmux-worktree` extension
manages:

- `tmux-worktree-tui` (no args) — Bubble Tea TUI for browsing existing
  sessions and worktrees across configured search paths.
- `tmux-worktree-tui open` — attach to (or create) the session the
  extension would use for the current directory.

It **MUST** follow the same naming and env-handling rules as the extension
so a session created from one tool can be attached from the other without
any drift.

## 📦 Installation

```bash
cd cli && go install ./...
# Binary: ~/go/bin/tmux-worktree-tui
```

## 📏 Naming Conventions (STRICT)

These rules come from `src/utils/git.ts` and
`src/utils/{tmux,zellij}Backend.ts` in the extension. Keep them in sync.

### 1. Identity Root

- Always derive identity from the **primary worktree** path, not the
  current (possibly linked) worktree.
- Find it with `git rev-parse --git-common-dir`; the parent of that dir is
  the primary worktree root.
- For non-git folders, the identity root is the folder itself.

### 2. Session Namespace

- Format: `{sanitized-basename}-{sha1[:8]}`
- The hash is taken from the **absolute identity-root path** (no
  `realpath`, no symlink resolution).
- This is the part that prevents same-named repos in different folders
  from colliding on a shared multiplexer server.

### 3. Slug

- Primary worktree → `main`.
- Managed storage (`~/.tmux-worktrees/<ns>/<slug>` or repo-local
  `.worktrees/<slug>`) → basename of the worktree path.
- External worktree whose basename equals the repo name → suffix with the
  parent dir (`repo` + `-` + parent).
- Otherwise → basename of the worktree path.

### 4. Session Name

- Format: `{namespace}_{slug}`
- Both halves run through the sanitizer that replaces `/ \ . : <space>`
  with `-`.
- Examples:
  - `my-project-7b66cd9f_main`
  - `my-project-7b66cd9f_feature-login`

### 5. Slug Collision

- Primary `main` slug is reserved for the primary worktree. If another
  worktree would sanitize to `main`, suffix it (CLI behavior should match
  the extension's auto-disambiguation; today only the extension creates
  new worktrees so this rule mainly applies to the TUI's `new task`
  flow).

## ⚙️ VS Code Settings Integration

`open` reads two VS Code settings so the CLI matches what the extension
is configured to do for the same folder:

- `tmuxWorktree.multiplexer` (`tmux` | `zellij`, default `tmux`)
- `tmuxWorktree.socketDir` (default `/var/tmp`)

Resolution order (first hit wins):

1. Workspace settings: `<repoRoot>/.vscode/settings.json`
2. User settings (in this order, when present):
   - `~/Library/Application Support/Code/User/settings.json`
   - `~/Library/Application Support/Code - Insiders/User/settings.json`
   - `~/Library/Application Support/Cursor/User/settings.json`
   - `~/Library/Application Support/Antigravity/User/settings.json`
   - Linux equivalents under `~/.config/<variant>/User/settings.json`
3. Built-in defaults.

JSONC quirks (line/block comments, trailing commas) are stripped before
JSON parsing; a malformed settings file is silently skipped so the CLI
keeps working when one editor variant has a broken file.

## 🧼 Env Scrub on Attach

Both backends strip `VSCODE_*`, `ELECTRON_RUN_AS_NODE`, `TERM_PROGRAM`,
`TERM_PROGRAM_VERSION`, `VSCODE_INJECTION`, `VSCODE_SHELL_INTEGRATION`
from `os.Environ()` before invoking the multiplexer, and pin a clean
`TERM=xterm-256color` / `COLORTERM=truecolor`. The tmux backend also
clears any cached `VSCODE_*` keys from a running tmux server via
`set-environment -gu` so previously-leaked vars don't poison fresh panes.

## 🌀 Backend-Specific Quirks

### Zellij

- Session names starting with `-` (e.g. `.hermes-...`) are passed after
  `--` so zellij does not parse them as flags.
- `--simplified-ui` is **not** added by the CLI — the user's native
  terminal is assumed to have Nerd Font glyphs. The extension still adds
  it for the integrated VS Code terminal.
- Attempting `open` from inside an existing zellij session (with
  `ZELLIJ` env set) fails fast with a clear error; zellij has no
  switch-client equivalent.
- `ZELLIJ_SOCKET_DIR` is pinned to the configured socket dir + `/zellij`.

### Tmux

- Inside tmux (`TMUX` env set) the CLI uses `switch-client -t <name>`
  and exits cleanly. The session is created in detached mode first if
  it didn't already exist.
- Outside tmux the CLI uses `syscall.Exec` with `tmux new-session -A`,
  letting tmux take over the terminal directly.
- `TMUX_TMPDIR` is pinned to the configured socket dir.

## 🛠 Tech Stack

- **Language**: Go
- **TUI**: [Bubble Tea](https://github.com/charmbracelet/bubbletea)
- **Git**: `os/exec` with `git worktree list --porcelain`
- **Config**: JSON in `~/.config/tmux-worktree-tui/config.json` (TUI
  search paths only); VS Code settings drive multiplexer/socketDir.

## 🚀 Features

1. **Project Discovery**: Scan user-defined directories for git repos
   (TUI).
2. **Worktree List**: Parse porcelain output, filter prunable (TUI).
3. **`open` subcommand**: Resolve session identity for the current
   directory and attach via the multiplexer the VS Code extension is
   configured to use.
4. **Multiplexer Integration**:
   - Check if session exists (exact name match).
   - Create session if missing (with correct workdir + env scrub).
   - Attach to session (switch-client when nested in tmux, syscall.Exec
     otherwise).
