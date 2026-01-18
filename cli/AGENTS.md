# tmux-worktree-tui

This project is a TUI application to manage tmux sessions for Git Worktrees.
It **MUST** follow the exact same naming conventions as the `vscode-tmux-worktree` extension to ensure compatibility.

## 📏 Naming Conventions (STRICT)

We must replicate the logic from the VS Code extension exactly.

### 1. Repo Name
- Derived from the **basename** of the repository root directory.
- `repoName = basename(repoRoot)`

### 2. Slug
- **From Session Name**:
  - `sessionName` - `{repoName}_` prefix = `slug`
  - If empty, `slug` = `main`
- **From Worktree Path**:
  - `slug = basename(worktreePath)`
  - **Exceptions (Force `main`)**:
    1. If `isMain` branch AND path does NOT contain `.worktrees`
    2. If `slug` == `repoName`

### 3. Session Name
- Format: `{repoName}_{slug}`
- Examples:
  - `my-project_main`
  - `my-project_feature-login`

### 4. Root/Main Identification
- **UI Label**: `(root)`
- **Conditions**:
  - If `slug` == `main`
  - If `slug` == `repoName`
  - If worktree is main branch and not in `.worktrees` folder

### 5. `isMain` Branch Logic
- A branch is considered "main" if it does **NOT** start with `task/`.
- `isMain = !branch.startsWith('task/')`

## 🛠 Tech Stack
- **Language**: Go
- **TUI**: [Bubble Tea](https://github.com/charmbracelet/bubbletea)
- **Git**: `os/exec` with `git worktree list --porcelain`
- **Config**: JSON or YAML in `~/.config/tmux-worktree-tui/config.json`

## 🚀 Features
1. **Project Discovery**: Scan user-defined directories for git repos.
2. **Worktree List**: Parse porcelain output, filter prunable.
3. **Tmux Integration**:
   - Check if session exists (exact name match).
   - Create session if missing (with correct workdir).
   - Attach to session (switch client if in tmux, attach if outside).
