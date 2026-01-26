# AI Agent Guidelines

This document serves as the primary rule file for AI Agents working on this project.
**ALWAYS** update this file when you discover new patterns or finish significant tasks.

## Instruction
- After every task and changes, install the compiled extension to `antigravity` (not `code`). The version should be increased by 1 patch.

## Tested VS Code
- `code` (VS Code)
- `antigravity` (Google Antigraity)
- `cursor` (Cursor)

## 1. Codebase Understanding

### Project Structure
```
.
├── src/                    # VS Code Extension Source (TypeScript)
│   ├── extension.ts        # Extension Entry Point
│   ├── commands/           # Command Implementations
│   ├── providers/          # Tree Data Providers (Sidebar)
│   └── utils/              # Utilities (tmux, git, execution)
├── cli/                    # CLI Tool Source (Go)
│   ├── main.go             # CLI Entry Point
│   ├── internal/ui/        # TUI Implementation (Bubble Tea)
│   └── pkg/                # Shared Packages
├── out/                    # Compiled Extension Output
├── .vscode/                # Editor Configuration
└── resources/              # Icons and Assets
```

### Key Components
- **VS Code Extension**: Manages the "TMUX Worktrees" view in the Activity Bar. It interacts with the `tmux` CLI and `git worktree` commands.
- **CLI (`twt`)**: A terminal user interface (TUI) for managing sessions/worktrees outside of VS Code, built with Bubble Tea.

## 2. Coding Patterns & Best Practices

- **Polymorphism**: Commands must handle `TmuxItem` base class and variants (`TmuxSessionItem`, `InactiveWorktreeItem`, etc.).
- **Path Handling**: Use `getWorktreePath(item)` helper.
- **Error Handling**: Use `try-catch` in TS and check `err != nil` in Go. Fail gracefully and notify the user.
- **Async/Await**: Use `async/await` for all I/O operations in TypeScript.

## 3. Documentation & Development

### Frameworks & Libraries
- **VS Code Extension**: TypeScript, VS Code API.
- **CLI**: Go, Bubble Tea, Lipgloss.

### Local Development
- **Prerequisites**: Node.js, Go, `tmux`, `git`.
- **Setup**:
  ```bash
  npm install
  cd cli && go mod download
  ```
- **Run Extension**: Press F5 in VS Code.
- **Run CLI**: `cd cli && go run ./main.go`.

### Testing
- **Extension**: `npm run lint` (ESLint), `npm run compile`.
- **CLI**: `cd cli && go vet ./...`, `staticcheck ./...`.

## 4. Code Quality

### Code Quality: Always look back your git status and make sure build success before commit
- Before you commit to the git, or after you finish a task, you must follow the guidelines below:
- You need to watch the `git status`, and make sure if there is no more unnecessary code, and see if strictly followed my prompts. Change your persona as critical code-reviewer, and blame code if there is some code that doesn't need. Then tell to the user which code is unnecessary and removable at the summary.
- ALWAYS write human-readable code which is easy to understand and maintain even after a year when you look back. You can use any method to achieve this, such as using descriptive variable names, commenting your code, and writing modular code.
- You can easily delete code, functions or files if you are sure that it is not needed anymore. We have git, so you never need to worry about losing code.
- Make sure run and build success
- For javascript or typescript edits, you must ALWAYS run `npm run compile` (or `bun run compile`) to make sure there is no error when build. If you find an error, you must fix it and run build again.
- For tests, you must run `npm run lint` (or relevant test command) to make sure there is no error when test. If you find an error, you must fix it and run test again.
- For smoke tests, you must run the smoke test you edited/added and make sure it's successfully passed. (Fix it if you find an error) But if you don't have any environment variables to run, just STOP working.

## 5. Language & UI/UX
- **Language**: English (Comments, Docs, UI Strings).
- **UI/UX Guidelines**:
  - **Session Presentation**: Two-line layout (Group/Status + Detail).
  - **Terminal Interaction**: Open in Editor Area (Tabs) by default.
  - **Root Labeling**: Label repository root worktree as `(root)`.
  - **Deduplication**: Active Session > Inactive Worktree.

## 6. Maintenance
- **Update this file**: When new rules are established or architecture changes.
- **Commit Rules**: Descriptive messages, conventionally formatted.

