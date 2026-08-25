# AI Agent Guidelines

This document serves as the primary rule file for AI Agents working on this project.
**ALWAYS** update this file when you discover new patterns or finish significant tasks.

## Instruction
- After every task and changes, install the compiled extension to `code`, `code-insiders`, `antigravity`. DO NOT INCREASE version. (It will be automatically increased when publish, and we don't want to increase it for testing)

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
- **Canonical Path Matching**: For path equality/deduplication/current-workspace checks, normalize to absolute paths with `~` expansion before comparison (do not collapse symlink aliases via `realpath`).
- **Managed Worktree Location**: Create extension-managed worktrees under `~/.tmux-worktrees/<repo-name-hash>/` by default. Reuse shared helpers for path checks and orphan cleanup instead of hardcoding repo-local `.worktrees` path fragments.
- **Session Namespace**: Build tmux session prefixes from primary-worktree identity (basename + short path hash), not the current VS Code workspace folder or display repo name alone, to avoid collisions and linked-worktree drift. Use the shared async identity helpers instead of calling `getRepoRoot()` directly for namespace or managed-dir names.
- **Zellij Leading-Dash Session Names**: Repo basenames such as `.hermes` can produce session names beginning with `-`. When passing those names to Zellij as positional arguments, insert `--`; shell quoting alone does not stop Zellij from parsing them as CLI flags.
- **Legacy Session Compatibility Isolation**: Keep legacy session-prefix compatibility logic centralized in `src/utils/sessionCompatibility.ts`; call helpers from commands/providers instead of duplicating fallback checks.
- **Root Detection**: Determine the primary worktree by comparing worktree path to the primary worktree path derived from `git rev-parse --git-common-dir`, not by branch naming, folder basename, or the current workspace folder.
- **Current Workspace Indicator**: Highlight the active VS Code workspace by comparing worktree/session paths against the current workspace folder (not the primary worktree path). Current items should sort to the top and display a `👆` marker in the label.
- **External Worktrees**: If the worktree folder name matches the repo name, derive a unique slug/label from the parent directory.
- **Slug Collision Handling**: Worktree session slugs must be unique by sanitized tmux name. Start with basename-based slug, then disambiguate with parent directory, and finally append a short path hash when collisions remain.
- **Free-Form Task Branches**: `TMUX: New Task` accepts arbitrary valid git branch names, including `/`. Sanitize `/` to `-` for tmux/worktree slugs, and never infer main-vs-task state from a `task/` prefix.
- **Unpublished Task Branches**: When creating a new task branch, do not preconfigure `branch.<name>.remote` / `branch.<name>.merge` before the first push. VS Code SCM treats that as an upstream and may try to sync against a remote branch that does not exist yet. Store only `branch.<name>.vscode-merge-base` with the chosen base branch so SCM diffs stay anchored while **Publish Branch** remains available.
- **Primary Worktree Slug Follows Its Current Branch**: The primary worktree's slug is its current branch name (e.g. `master`, `develop`), falling back to `main` only when no branch can be resolved (detached HEAD / empty repo). Reserve that slug during slug collision resolution so no non-primary worktree or task branch can reuse the primary session name. The default branch for base-branch detection (`getBaseBranch`) is likewise the primary worktree's current branch (checked before origin/HEAD symref).
- **Tree Context Menu**: Use a single TreeItem `contextValue` (`tmuxItem`) for levels 2/3/4 so the same context menu always appears.
- **Error Handling**: Use `try-catch` in TS and check `err != nil` in Go. Fail gracefully and notify the user.
- **Async/Await**: Use `async/await` for all I/O operations in TypeScript.
- **Terminal Creation**: Use `/bin/sh -c 'exec tmux attach ...'` instead of `shellPath: 'tmux'`. Direct `shellPath: 'tmux'` causes VS Code to treat it as a non-standard shell, breaking mouse drag events (pane resize). The `exec` replaces sh with tmux (no extra process), and `-c` avoids sendText race conditions with other extensions.
- **Zellij Keybindings**: Manage Zellij passthrough shortcuts from `scripts/generate-zellij-keybindings.mjs`; do not hand-edit the generated `workbench.action.terminal.sendSequence` entries in `package.json`. Add new passthroughs to the script's `ZELLIJ_KEY_PASSTHROUGHS` list, prefer VS Code scan-code key strings for layout independence, then run `npm run generate:zellij-keybindings`. Keep all generated entries scoped to `terminalFocus && config.tmuxWorktree.multiplexer == 'zellij'`. Apply VS Code terminal setting overrides from `src/utils/zellijTerminalSettings.ts` only while the Zellij backend is active, then restore extension-applied global values when switching away.
- **Zellij Control-Key Passthroughs**: Use literal control/escape sequences in `ZELLIJ_KEY_PASSTHROUGHS` so VS Code forwards the intended byte to the terminal. Prefer scan-code key strings for control and Alt shortcuts so Korean IME/layout variants map to the intended physical key without duplicate Hangul-specific bindings.
- **No-Git Workspace Labeling**: If the workspace is not a git worktree, the tree must still show one primary item labeled `current project (no git)` mapped to the current workspace path.
- **Package Hygiene**: Keep local orchestration/runtime state such as `.omx/` out of VSIX packages via `.vscodeignore`; git excludes alone do not affect packaging.
- **Marketplace Publishing**: `publish.yml` owns version bump, VSIX packaging, VS Code Marketplace publishing, and GitHub releases. Open VSX publishing lives in `publish-open-vsx.yml` and consumes the uploaded VSIX artifact from the successful marketplace workflow so both registries receive the same package. The `workflow_run` job has no checkout, so `gh run download` must pass `--repo "$GITHUB_REPOSITORY"`; without it gh tries to infer the repo from a local clone and dies with "not a git repository".

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

### Documentation Sync
- Whenever adding or changing user-visible features (commands, keybindings, tree labels, attach behavior), update `README.md` and `docs/README.ko.md` in the same task.

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
  - **Root Labeling**: Do not show a `(root)` label; show the branch/HEAD label for the primary worktree like any other.
  - **Tree Levels**: Level 2 is branch/HEAD with a green circle status (filled = tmux active, outline = stopped, warning = git missing). Level 3 shows tmux usage with `resources/tmux.svg` (inactive uses a grey variant). Level 4 shows git summary (↑ commits, `M/U/D` counts) only when there is something to show.
  - **Deduplication**: Active Session > Inactive Worktree.

## 6. Maintenance
- **Update this file**: When new rules are established or architecture changes.
- **Commit Rules**: Descriptive messages, conventionally formatted.

<!-- opencode:reflection:start -->
### Terminal Creation with Tmux
- **PTY Configuration Issue**: Using `shellPath: 'tmux'` causes VS Code to treat tmux as a non-standard shell, resulting in different PTY settings and broken mouse drag events (pane resize fails)
- **Race Condition with Other Extensions**: Using `terminal.sendText('exec tmux attach ...')` causes race conditions with other extensions (e.g., VS Code Python extension) that send commands first, swallowing the `exec` command
- **Shell Integration Interference**: VS Code shell integration environment variables (`VSCODE_SHELL_INTEGRATION`, `VSCODE_INJECTION`) inherited by tmux internal shell cause OSC 633 sequences that add command decorations, blocking mouse drag text selection in interactive panes
- **Tmux Server Environment Pollution**: `tmux show-environment -g` can retain `VSCODE_*` and `ELECTRON_RUN_AS_NODE` from the VS Code extension host. Even if the attach client env is clean, new panes/windows can still inherit those stored values and re-enable shell integration markers intermittently.
- **Zellij Session Environment Pollution**: Detached `zellij attach -b` launched from the extension host can also inherit `VSCODE_*`, `TERM_PROGRAM*`, and `ELECTRON_RUN_AS_NODE`. Strip those vars both when spawning Zellij commands and when creating the bootstrap `/bin/sh` terminal, or prompt redraw/backspace editing can leave stale characters in the integrated terminal.
- **Zellij Detached Session TERM Trap**: A background-created Zellij session (`zellij attach -b`) can start its first shell pane with `TERM=dumb` if no terminal type is seeded during creation. That stale pane environment survives later GUI attaches and causes broken prompt redraw/backspace editing. Always create detached Zellij sessions with an explicit terminal type (eg. `TERM=xterm-256color`) and prefer `simplified-ui true` for VS Code terminals that may not have Nerd Font glyph coverage.
- **Solution**: Use `/bin/sh -c 'exec tmux attach -t ...'` with environment variables set to `null` for shell integration
  - `exec` replaces sh with tmux (no extra process)
  - `-c` executes immediately, avoiding sendText race conditions
  - Setting `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`, `VSCODE_SHELL_INTEGRATION`, and `VSCODE_INJECTION` to `null` prevents shell integration from interfering with tmux internal shells
  - Scrub stored `VSCODE_*` / `ELECTRON_RUN_AS_NODE` from tmux before `new-session` and right before `attach`, otherwise long-lived tmux servers can keep poisoning later panes
- **Clipboard = pure OSC 52 (NOT pbcopy). Do NOT re-add OS-clipboard-tool detection.**: tmux/zellij copy must reach the user's clipboard via the OSC 52 terminal escape, which VS Code's xterm renders. **Never** route copy through a remote OS clipboard tool (`copy-command pbcopy`, zellij `copy_command "pbcopy"`, etc.): on Remote-SSH the tmux/zellij server runs on the REMOTE host, so a remote `pbcopy` writes the REMOTE machine's clipboard and the copy never reaches the user's local machine (symptom: "drag selects but nothing ever copies locally"). OSC 52 is the only channel that crosses SSH back to the local UI. tmux setup at attach: `set-clipboard on` (forced unconditionally so this global option can't oscillate between attaches), `terminal-features ',xterm-256color:clipboard'` (macOS terminfo for xterm-256color lacks the `Ms`/clipboard cap, so tmux otherwise refuses to emit OSC 52 for its own copy), `allow-passthrough on` (TUI DCS-wrapped OSC 52), and `set-option -gu copy-command` (clears any stale pbcopy binding a prior extension version left on a long-lived server). zellij needs zero injection — its default `copy_clipboard "system"` already emits OSC 52; just keep `copy_command` out of `~/.config/zellij/config.kdl`.
- **Historical mojibake was a VS Code regression, now fixed — do not reintroduce the pbcopy workaround**: Korean/CJK/emoji copied via OSC 52 was garbled (`한글`→`íê¸`, `→`→`â`) only in **VS Code 1.123–1.124**: `@xterm/addon-clipboard` switched to raw `atob`/`btoa` (Latin-1) in xterm.js `c8dddddb` (removed `js-base64`). Fixed upstream in **1.125** (xterm.js PR #6002, now decodes via `TextDecoder`; addon ≥ `0.3.0-beta.285`). A v1.2.19 commit (`4332240`) worked around the 1.123/1.124 bug by piping copies to `pbcopy`/`set-clipboard off`, which silently broke all Remote-SSH copy (remote clipboard) and made the global `set-clipboard` oscillate between attaches. That workaround was removed in favor of pure OSC 52. If multi-byte copy ever mojibakes again, it is a VS Code/xterm.js bug to fix upstream (or a custom-PTY OSC 52 intercept), **never** a reason to re-add remote OS clipboard tools.
- **OpenCode Clipboard in tmux**: OpenCode TUI emits OSC52 via tmux passthrough wrapper (`ESC Ptmux; ... ESC \\`). Ensure `allow-passthrough on` (window option) is enabled, or OpenCode may show "Copied to clipboard" while local clipboard remains unchanged.
- **Startup Size Race Mitigation**: When auto-attaching on extension startup, delay initial attach briefly (for workbench layout stabilization) and stagger multiple attaches. Right before `exec tmux attach`, sync session `default-size` from current PTY (`stty size`) and add a short sleep to avoid initial 80x24-sized clients that only fix after a manual VS Code window resize.
- **Current Window Size Enforcement**: `default-size` alone may not resize an already-existing current window. Before attach, also run `tmux resize-window -t <session>:. -x <cols> -y <rows>` after a short PTY-size retry loop so full-screen TUIs (e.g. OpenCode) do not render in a small centered area until a manual resize.
- **Avoid Persistent Manual Window Size**: `tmux resize-window` flips that window to `window-size manual`, which can leave later attaches clipped even with one client. After forced resize, always restore `window-size latest` (and when reusing an existing terminal, also restore it defensively).
- **Shell Script Assembly Safety**: When composing `/bin/sh -c` scripts that include control structures (`for/do/done`, `if/then/fi`), join command fragments with newlines instead of `; ` to avoid generating invalid tokens like `do;` and causing immediate attach launch failures.
<!-- opencode:reflection:end -->
