# Learnings - TMUX Worktree VS Code Extension

## 2026-01-16 Project Complete

### Conventions Discovered
- VS Code Panel View: `viewsContainers.panel` (not `activitybar`) for bottom panel placement
- TreeDataProvider: Standard pattern with `_onDidChangeTreeData` EventEmitter for refresh
- Terminal API: `createTerminal()` + `sendText()` for tmux attach commands
- tmux session metadata: `@workdir` custom option for worktree path storage

### Successful Approaches
1. **Separation of concerns**: Utils (`exec.ts`, `git.ts`, `tmux.ts`) separate from commands
2. **Session naming convention**: `<repo-name>:<slug>` format enables easy filtering
3. **Orphan detection**: Compare tmux sessions vs git worktree list for cleanup
4. **Auto-attach on startup**: Called from `activate()` after checking tmux server availability

### Technical Details
- `tmux show-options -t <session> @workdir` returns `@workdir /path/to/worktree`
- Parse by splitting on first space and joining rest
- `git worktree list --porcelain` for reliable parsing
- Session activity: `tmux display-message -p -t <session> '#{session_activity}'` (UNIX epoch)

### File Structure
```
src/
├── extension.ts              # Entry point, command registration
├── providers/
│   └── tmuxSessionProvider.ts  # TreeDataProvider (395 lines)
├── commands/
│   ├── attachCreate.ts       # Attach/Create command
│   ├── newTask.ts            # New Task command  
│   ├── removeTask.ts         # Remove Task command
│   ├── contextMenu.ts        # Context menu handlers
│   ├── orphanCleanup.ts      # Orphan detection/cleanup
│   └── autoAttach.ts         # Startup auto-attach
└── utils/
    ├── exec.ts               # child_process wrapper
    ├── git.ts                # git/worktree utilities
    └── tmux.ts               # tmux utilities
```

### Commands Implemented
| Command | Title |
|---------|-------|
| tmux.newTask | TMUX: New Task |
| tmux.attachCreate | TMUX: Attach/Create Session |
| tmux.removeTask | Remove Task |
| tmux.refresh | Refresh |
| tmux.filter | Filter Sessions |
| tmux.attach | Attach |
| tmux.openWorktree | Open Worktree in New Window |
| tmux.copyPath | Copy Worktree Path |
| tmux.newPane | New Pane (Split) |
| tmux.newWindow | New Window |
| tmux.runClaude | Run: claude |
| tmux.runOpencode | Run: opencode |
| tmux.runCustom | Run: Custom Command... |
| tmux.cleanupOrphans | Cleanup Orphans |
