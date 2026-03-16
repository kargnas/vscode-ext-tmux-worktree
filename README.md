# TMUX Worktree

**Seamlessly manage tmux sessions alongside git worktrees — right from VS Code.**

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/kargnas.vscode-tmux-worktree?label=VS%20Marketplace&color=blue)](https://marketplace.visualstudio.com/items?itemName=kargnas.vscode-tmux-worktree) [![Blog](https://img.shields.io/badge/Blog-kargn.as-green)](https://kargn.as)

🌏 **Read this in other languages:** **English** | [한국어](docs/README.ko.md) | [简体中文](docs/README.zh-CN.md) | [繁體中文 (台灣)](docs/README.zh-TW.md) | [繁體中文 (香港)](docs/README.zh-HK.md) | [日本語](docs/README.ja.md)

**[Install from VS Marketplace](https://marketplace.visualstudio.com/items?itemName=kargnas.vscode-tmux-worktree)**

![TMUX Worktree Screenshot](https://raw.githubusercontent.com/kargnas/vscode-ext-tmux-worktree/main/docs/screenshot.png)

## Why It Feels Polished

- **Image-aware terminal paste**: `Cmd+V` / `Ctrl+Shift+V` keeps normal text paste, but auto-inserts an image file path when clipboard has an image.
- **Remote-SSH clipboard bridge**: local clipboard images can be pasted into remote terminals without manual upload steps.
- **Collision-safe session identity**: sessions use `repo-name + path hash` namespace and slug disambiguation for same-name repos and similar paths.
- **Legacy-compatible migration**: previous session prefixes are still detected when `@workdir` belongs to the repo.
- **No-git fallback visibility**: even non-git folders still appear as `current project (no git)` instead of disappearing from the tree.

## Why?

If you use `git worktree` for parallel development and `tmux` for persistent terminal sessions, you know the pain of manually juggling both. This extension bridges the gap:

- **One click** to create a worktree + tmux session together
- **Tree view** showing all worktrees with their tmux status
- **Auto-attach** to the right tmux session when you open a worktree
- **Never lose context** — sessions persist even if VS Code closes

### Perfect for AI Coding Agents

Run AI coding agents (Claude Code, Codex, OpenCode, Gemini CLI) inside tmux sessions. Your agent keeps running in the background — reconnect from anywhere, even from a phone via Termux.

### Real-World Use Cases

**🤖 Parallel Development with AI Agents**
```
project/
├── main              → tmux: "myapp/main" (Claude Code refactoring)
├── feature/oauth     → tmux: "myapp/feature-oauth" (manual coding)
└── fix/memory-leak   → tmux: "myapp/fix-memory-leak" (Codex analyzing)
```
Run independent AI agents on each branch, check results in VS Code. Sessions keep working in the background.

**🌐 Remote Server Development**
Connected to a dev server via SSH:
- Use VS Code Remote-SSH to connect
- Manage branch sessions with TMUX Worktree
- SSH disconnect? tmux sessions persist
- Reconnect from home, café, or phone

**📱 Mobile Code Review**
Access from phone via Termux + SSH:
```bash
ssh dev-server
tmux attach -t myapp/feature-oauth
```
Review AI-written code during your commute.

## Features

### 🌳 Explorer View
A dedicated sidebar showing all your git worktrees and their associated tmux sessions at a glance. See session status, pane count, and last activity time.

### ⚡ One-Click Task Creation
Create a new git branch + worktree + tmux session in one step. Start working on a new feature instantly.
Managed worktrees are created under `~/.tmux-worktrees/<repo-name-hash>/` by default, which keeps repository roots clean and avoids cross-repo path collisions.
Enter any valid branch name such as `feat/auth` or `task/my-task`; tmux session/worktree slugs safely flatten `/` into `-`.
If a task slug would collide with the primary worktree slug like `main`, the extension auto-suffixes it to keep sessions unique.

### 🔗 Smart Attach
- **Attach in Terminal** — open tmux session in VS Code's integrated terminal
- **Attach in Editor** — embed tmux session as an editor tab
- **Auto-attach** — automatically connect when opening a worktree folder
- **Size-stable attach** — retries PTY size sampling, force-resizes before attach, then restores `window-size latest` so full-screen TUIs avoid both 80x24 first paint and persistent clipping

### 🧹 Orphan Cleanup
Detect and clean up tmux sessions that no longer have matching worktrees. Keep your environment tidy.

### 🖥️ Session Management
- Split panes and create new windows from the context menu
- Copy worktree paths to clipboard
- Open worktrees in new VS Code windows
- Filter sessions by name

### 📋 Smart Paste (Image-Aware Terminal Paste)
- `Cmd+V` (macOS) / `Ctrl+Shift+V` (Linux) in terminal first checks clipboard content
- If clipboard has text, it keeps the default paste behavior
- If clipboard has an image, it saves a temporary `.png` and inserts the file path into terminal
- Works with local sessions and Remote-SSH (webview bridge uploads local clipboard image to remote host)
- Force image-only mode from Command Palette: `TMUX: Paste Image from Clipboard`

### 🧭 Robust Session Mapping
- Session namespace uses `repo-name + path hash` to avoid collisions between same-name repositories in different directories
- Legacy session names are still detected for compatibility when `@workdir` points inside the current repo
- Worktrees with colliding slugs are auto-disambiguated (parent folder, then path hash)
- Non-git folders are still shown in the tree as `current project (no git)`

## Commands

| Command | Description |
|---------|-------------|
| `TMUX: Attach/Create Session` | Attach to or create a tmux session for the current worktree |
| `TMUX: New Task` | Create a new branch + worktree + tmux session |
| `TMUX: Remove Task` | Remove a worktree and its tmux session |
| `TMUX: Cleanup Orphans` | Remove orphaned tmux sessions |
| `TMUX: Smart Paste (Image Support)` | Smart terminal paste: text uses normal paste, image inserts temporary file path |
| `TMUX: Paste Image from Clipboard` | Force image paste and insert the saved image path into the active terminal |

## Recent Updates (v1.1.2 - v1.1.6)

- **v1.1.6**: Added image-aware terminal paste for AI CLI workflows (`Cmd+V` / `Ctrl+Shift+V`) and a force image paste command. Also improved startup auto-attach sizing stability to reduce occasional small terminal rendering until a manual window resize, fixed persistent clipping by restoring `window-size latest` after forced pre-attach resize, and fixed a shell-script parsing regression that could fail attach launch in some environments.
- **v1.1.4 - v1.1.5**: Improved tmux clipboard reliability by enabling clipboard capabilities and passthrough options during attach.
- **v1.1.3**: Refactored legacy session-prefix compatibility logic for safer migration.
- **v1.1.2**: Added slug collision handling and explicit no-git workspace labeling (`current project (no git)`).

## Requirements

- **tmux** — must be installed and available in PATH
- **git** — must be installed and available in PATH
- **VS Code** 1.85.0+

## Getting Started

1. Install the extension
2. Open a git repository in VS Code
3. Click the **TMUX** icon in the Activity Bar (sidebar)
4. Your existing worktrees and tmux sessions will appear automatically

To create a new task: click the **+** button in the TMUX panel header, enter a branch name, and you're ready to go.

## How It Works

```
Repository (root)
├── main              → tmux session: "project-a1b2c3d4_main"
├── feature/login     → tmux session: "project-a1b2c3d4_feature-login"
└── fix/bug-123       → tmux session: "project-a1b2c3d4_fix-bug-123"
```

Each worktree gets a dedicated tmux session. Session names use a repo namespace (`repo-name + path hash`) plus a slug, which avoids collisions across same-name repositories in different directories.
New tasks are stored outside the repository by default at `~/.tmux-worktrees/<repo-name-hash>/`.

## Learn More

- [Marketplace](https://marketplace.visualstudio.com/items?itemName=kargnas.vscode-tmux-worktree)
- [GitHub Repository](https://github.com/kargnas/vscode-ext-tmux-worktree)
- [Report Issues](https://github.com/kargnas/vscode-ext-tmux-worktree/issues)

## License

[MIT](LICENSE.md)
