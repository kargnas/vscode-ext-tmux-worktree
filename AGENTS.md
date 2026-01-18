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
