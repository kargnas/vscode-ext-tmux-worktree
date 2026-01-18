# TMUX Worktree

Monorepo containing VS Code extension and Go CLI for managing tmux sessions with git worktrees.

## 📁 Project Structure

```
.
├── src/                    # VS Code Extension (TypeScript)
│   ├── extension.ts        # Entry point
│   ├── commands/           # Command handlers
│   ├── providers/          # TreeView providers
│   └── utils/              # tmux, git, exec utilities
├── cli/                    # CLI: tmux-worktree-tui (Go)
│   ├── main.go             # Entry point
│   ├── internal/ui/        # Bubble Tea TUI
│   └── pkg/                # Shared packages (tmux, git, config, etc.)
├── out/                    # Compiled JS output
└── .vscode/                # IDE configuration
```

## 🛠 Tech Stack

| Component | Stack |
|-----------|-------|
| **VS Code Extension** | TypeScript, VS Code API 1.85+ |
| **CLI (tmux-worktree-tui)** | Go 1.25, Bubble Tea, Lipgloss |
| **Package Manager** | npm/bun (ext), go modules (cli) |

## 🚀 Quick Start

### VS Code Extension
```bash
npm install                          # Install deps
bun run compile                      # Compile TypeScript
# Press F5 in VS Code → "Run Extension"
```

### CLI (tmux-worktree-tui)
```bash
cd cli && go install ./...           # Install to ~/go/bin/
tmux-worktree-tui                    # Run TUI
```

### Deploy Extension to Antigravity
```bash
bun run compile && npx vsce package --no-dependencies
antigravity --install-extension vscode-tmux-worktree-0.0.13.vsix --force
```

---

## GIT
- Always commit when you have changes, but compiling should be successful.

## Task Workflow
- After every task, **MUST** compile, package, and install to `antigravity`.
  - Command: `bun run compile && npx vsce package --no-dependencies && antigravity --install-extension vscode-tmux-worktree-0.0.13.vsix --force`

## UI/UX Guidelines (User Preferences)
- **Session Presentation**:
  - **Two-line Layout**: Use a wrapper item + detail item to simulate a multi-line view.
    - **Line 1**: Group/Status (Expandable wrapper)
    - **Line 2**: `Branch/Session Name` · `Pane Count` · `Last Active Time`
    - **Line 3 (Conditional)**: Git Status (`M:1 A:0 D:0`) - *Only show if git is dirty*
  - **Root Labeling**: Always label the repository root worktree as `(root)` to distinguish it from branches named `main` or `master`.
  - **Deduplication**: 
    - Never show two items for the same filesystem path.
    - Priority: **Active Session** > **Inactive Worktree**.
    - Automatically filter out `prunable` (ghost) worktrees from `git worktree list`.

- **Terminal Interaction**:
  - **Default Click Action**: MUST open terminal in **Editor Area (Tabs)**, NOT the bottom panel.
  - **Context Menu**: Provide clear options for both:
    - "Attach in Terminal" (Bottom Panel)
    - "Attach in Editor" (Editor Tab)

## Code Patterns
- **Polymorphism**: Commands (Attach, Remove, etc.) must handle the base `TmuxItem` class and support all variants:
  - `TmuxSessionItem`
  - `TmuxSessionDetailItem` (Child of Session)
  - `InactiveWorktreeItem`
  - `InactiveWorktreeDetailItem` (Child of Inactive)
- **Path Handling**: Always use `getWorktreePath(item)` helper to resolve paths safely across different item types.
