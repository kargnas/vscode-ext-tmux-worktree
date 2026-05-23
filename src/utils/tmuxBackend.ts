import * as vscode from 'vscode';
import { exec } from './exec';
import { toCanonicalPath } from './path';
import { shellQuote } from './shell';
import { MultiplexerBackend, MultiplexerSession, SessionStatusInfo } from './multiplexer';
import { getTmuxTmpDir, ensureSocketDirExists } from './socketDir';

const TMUX_ENV_KEYS_TO_STRIP = [
  'ELECTRON_RUN_AS_NODE',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'VSCODE_INJECTION',
  'VSCODE_SHELL_INTEGRATION',
];

function isTmuxIntegrationEnvKey(key: string): boolean {
  return key.startsWith('VSCODE_') || TMUX_ENV_KEYS_TO_STRIP.includes(key);
}

function getTmuxSanitizedEnvKeys(): string[] {
  return Array.from(new Set([
    ...TMUX_ENV_KEYS_TO_STRIP,
    ...Object.keys(process.env).filter(isTmuxIntegrationEnvKey),
  ]));
}

// tmux only auto-creates the `tmux-<UID>` subdir; the parent (TMUX_TMPDIR) must exist
// or tmux fails with "error connecting". Resolve + mkdir on every command so user
// changes to `tmuxWorktree.socketDir` take effect without an extension restart.
function ensureTmuxTmpDir(): string {
  const dir = getTmuxTmpDir();
  try {
    ensureSocketDirExists(dir);
  } catch {
    // Surface the real error via tmux exit code so caller sees a meaningful message.
  }
  return dir;
}

function buildSanitizedTmuxCommand(command: string): string {
  const tmpDir = ensureTmuxTmpDir();
  const envKeys = getTmuxSanitizedEnvKeys();
  const unsetArgs = envKeys.map((key) => `-u ${shellQuote(key)}`).join(' ');
  const envPrefix = unsetArgs.length > 0 ? `env ${unsetArgs}` : 'env';
  return `${envPrefix} TMUX_TMPDIR=${shellQuote(tmpDir)} tmux ${command}`;
}

// Read-only tmux queries: skip VSCODE_* unset (cheaper) but still pin TMUX_TMPDIR.
function tmuxCmd(command: string): string {
  const tmpDir = ensureTmuxTmpDir();
  return `env TMUX_TMPDIR=${shellQuote(tmpDir)} tmux ${command}`;
}

function buildStoredTmuxEnvScrubCommand(sessionName?: string): string {
  const sessionTarget = sessionName ? ` -t ${shellQuote(sessionName)}` : '';
  const tmpDir = ensureTmuxTmpDir();
  return [
    // Pin TMUX_TMPDIR up-front so every tmux call below targets the configured socket dir,
    // both when this script runs standalone (scrubStoredTmuxEnvironment) and when it is
    // embedded inside the attach `/bin/sh -c` body.
    `export TMUX_TMPDIR=${shellQuote(tmpDir)}`,
    // Extension-host / shell-integration env leaking into tmux makes nested shells
    // emit VS Code prompt markers, which breaks drag selection inside tmux panes.
    'for name in ELECTRON_RUN_AS_NODE TERM_PROGRAM TERM_PROGRAM_VERSION VSCODE_INJECTION VSCODE_SHELL_INTEGRATION; do',
    'tmux set-environment -gu "$name" >/dev/null 2>&1 || true',
    `tmux set-environment${sessionTarget} -u "$name" >/dev/null 2>&1 || true`,
    'done',
    'tmux show-environment -g 2>/dev/null | while IFS= read -r line; do',
    'name=${line%%=*}',
    'case "$name" in',
    'VSCODE_*)',
    'tmux set-environment -gu "$name" >/dev/null 2>&1 || true',
    `tmux set-environment${sessionTarget} -u "$name" >/dev/null 2>&1 || true`,
    ';;',
    'esac',
    'done'
  ].join('\n');
}

async function scrubStoredTmuxEnvironment(sessionName?: string): Promise<void> {
  try {
    await exec(buildStoredTmuxEnvScrubCommand(sessionName));
  } catch {
    // No tmux server yet is fine; createSession will start one with a sanitized env.
  }
}

function getShortName(sessionName: string): string {
  const parts = sessionName.split('_');
  if (parts.length > 1) {
    return parts.slice(1).join('_');
  }
  return sessionName;
}

export class TmuxBackend implements MultiplexerBackend {
  readonly type = 'tmux' as const;
  readonly displayName = 'tmux';
  readonly installHint = 'Install: `brew install tmux`';

  async isInstalled(): Promise<boolean> {
    try {
      await exec('which tmux');
      return true;
    } catch {
      return false;
    }
  }

  async listSessions(): Promise<MultiplexerSession[]> {
    try {
      const output = await exec(tmuxCmd("list-sessions -F '#{session_name}|||#{session_windows}|||#{session_attached}'"));
      return output.split('\n').filter(l => l.trim()).map(line => {
        const [name, windows, attached] = line.split('|||');
        return {
          name,
          windows: parseInt(windows, 10) || 1,
          attached: attached === '1'
        };
      });
    } catch {
      return [];
    }
  }

  async createSession(sessionName: string, cwd: string): Promise<void> {
    await scrubStoredTmuxEnvironment(sessionName);
    await exec(buildSanitizedTmuxCommand(`new-session -d -s "${sessionName}" -c "${cwd}"`));
  }

  async killSession(sessionName: string): Promise<void> {
    await exec(tmuxCmd(`kill-session -t "${sessionName}"`));
  }

  async hasSession(sessionName: string): Promise<boolean> {
    try {
      await exec(tmuxCmd(`has-session -t "${sessionName}"`));
      return true;
    } catch {
      return false;
    }
  }

  async getSessionWorkdir(sessionName: string): Promise<string | undefined> {
    try {
      const output = await exec(tmuxCmd(`show-options -t "${sessionName}" @workdir`));
      const parts = output.split(' ');
      if (parts.length >= 2) {
        const rawPath = parts.slice(1).join(' ').trim();
        return toCanonicalPath(rawPath) || rawPath;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  async setSessionWorkdir(sessionName: string, workdir: string): Promise<void> {
    await exec(tmuxCmd(`set-option -t "${sessionName}" @workdir "${workdir}"`));
  }

  async getSessionInfo(sessionName: string): Promise<SessionStatusInfo> {
    try {
      const output = await exec(tmuxCmd(`display-message -p -t "${sessionName}" '#{session_attached}|||#{session_activity}'`));
      const [attachedStr, activityStr] = output.split('|||');
      return {
        attached: attachedStr === '1',
        lastActive: parseInt(activityStr, 10) || 0,
      };
    } catch {
      return { attached: false, lastActive: 0 };
    }
  }

  async getSessionPaneCount(sessionName: string): Promise<number> {
    try {
      const output = await exec(tmuxCmd(`list-panes -t "${sessionName}"`));
      return output.split('\n').filter(l => l.trim()).length || 1;
    } catch {
      return 1;
    }
  }

  async getSessionPanePids(sessionName: string): Promise<string[]> {
    try {
      const output = await exec(tmuxCmd(`list-panes -t "${sessionName}" -F '#{pane_pid}'`));
      return output.split('\n').filter(l => l.trim());
    } catch {
      return [];
    }
  }

  attachSession(
    sessionName: string,
    cwd?: string,
    location: vscode.TerminalLocation = vscode.TerminalLocation.Editor
  ): vscode.Terminal {
    const shortName = getShortName(sessionName);
    const terminalName = shortName;

    const oldName = `tmux: ${sessionName}`;
    const existing = vscode.window.terminals.find(t => t.name === terminalName || t.name === oldName);

    if (existing) {
      void exec(tmuxCmd(`set-window-option -t "${sessionName}":. window-size latest`)).catch(() => {});
      const options = existing.creationOptions as vscode.TerminalOptions;
      if (options && options.location === location) {
        existing.show();
        return existing;
      }
      existing.dispose();
    }

    // /bin/sh -c 'exec tmux attach ...' 방식으로 셸의 표준 PTY 환경에서 tmux를 실행.
    // shellPath: 'tmux' 방식은 VS Code가 비표준 셸로 인식하여 PTY 설정이 달라지고,
    // 마우스 드래그 이벤트(tmux pane 리사이즈 등)가 정상 전달되지 않는 문제가 있었음.
    const escapedName = sessionName.replace(/'/g, "'\\''");
    const attachCommand = [
      buildStoredTmuxEnvScrubCommand(sessionName),
      "tmux set-option -gq set-clipboard on >/dev/null 2>&1 || true",
      "tmux set-option -agq terminal-features ',xterm-256color:clipboard' >/dev/null 2>&1 || true",
      "tmux set-option -agq terminal-overrides ',*:clipboard' >/dev/null 2>&1 || true",
      "tmux set-option -gwq allow-passthrough on >/dev/null 2>&1 || true",
      "rows=''; cols=''",
      "for _ in 1 2 3 4 5; do",
      "size=$(stty size 2>/dev/null || true)",
      "candidate_rows=${size%% *}",
      "candidate_cols=${size##* }",
      "if [ -n \"$candidate_rows\" ] && [ -n \"$candidate_cols\" ] && [ \"$candidate_rows\" -gt 0 ] && [ \"$candidate_cols\" -gt 0 ]; then rows=\"$candidate_rows\"; cols=\"$candidate_cols\"; fi",
      "if [ -n \"$rows\" ] && [ \"$rows\" -ge 30 ] && [ \"$cols\" -ge 100 ]; then break; fi",
      "sleep 0.04",
      "done",
      "if [ -n \"$rows\" ] && [ -n \"$cols\" ]; then tmux set-option -t '" + escapedName + "' default-size \"${cols}x${rows}\" >/dev/null 2>&1 || true; fi",
      "if [ -n \"$rows\" ] && [ -n \"$cols\" ]; then tmux resize-window -t '" + escapedName + "':. -x \"$cols\" -y \"$rows\" >/dev/null 2>&1 || true; fi",
      "tmux set-window-option -t '" + escapedName + "':. window-size latest >/dev/null 2>&1 || true",
      "sleep 0.08",
      `exec tmux attach -t '${escapedName}'`
    ].join('\n');

    const terminal = vscode.window.createTerminal({
      name: terminalName,
      shellPath: '/bin/sh',
      shellArgs: ['-c', attachCommand],
      cwd: cwd,
      env: {
        'TERM': 'xterm-256color',
        // VS Code shell integration 환경변수가 tmux 내부 쉘에 상속되면,
        // 내부 쉘이 OSC 633 시퀀스를 보내 마우스 드래그가 안 되는 문제 발생.
        'TERM_PROGRAM': null,
        'TERM_PROGRAM_VERSION': null,
        'VSCODE_SHELL_INTEGRATION': null,
        'VSCODE_INJECTION': null,
      },
      location,
      iconPath: new vscode.ThemeIcon('server')
    });
    terminal.show();
    return terminal;
  }

  async splitPane(sessionName: string, cwd?: string): Promise<void> {
    const cwdArg = cwd ? `-c "${cwd}"` : '';
    await exec(tmuxCmd(`split-window -t "${sessionName}" ${cwdArg}`));
  }

  async newWindow(sessionName: string, cwd?: string): Promise<void> {
    const cwdArg = cwd ? `-c "${cwd}"` : '';
    await exec(tmuxCmd(`new-window -t "${sessionName}" ${cwdArg}`));
  }

  buildSessionName(repoName: string, slug: string): string {
    return `${this.sanitizeSessionName(repoName)}_${this.sanitizeSessionName(slug)}`;
  }

  sanitizeSessionName(name: string): string {
    // tmux session names: flatten git branch paths (/) and other problematic chars.
    return name.replace(/[/\\\s.:]/g, '-');
  }
}
