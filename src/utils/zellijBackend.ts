import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec, ExecOptions } from './exec';
import { MultiplexerBackend, MultiplexerSession, SessionStatusInfo } from './multiplexer';
import { shellQuote } from './shell';
import {
  buildZellijBackgroundAttachCommand,
  buildZellijInteractiveAttachCommand,
  buildZellijKillSessionCommand,
} from './zellijCommands';

// Zellij derives its IPC socket path from $TMPDIR + session name.
// macOS's $TMPDIR is deep (/var/folders/…/T/) so the full path easily
// exceeds the Unix socket limit of 103-108 bytes. A short fixed dir avoids this.
const ZELLIJ_SOCKET_DIR = '/tmp/zellij';
const ZELLIJ_ENV_KEYS_TO_STRIP = [
  'ELECTRON_RUN_AS_NODE',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'VSCODE_INJECTION',
  'VSCODE_SHELL_INTEGRATION',
];
const ZELLIJ_BOOTSTRAP_ENV = {
  TERM: 'xterm-256color',
  COLORTERM: 'truecolor',
};

function isZellijIntegrationEnvKey(key: string): boolean {
  return key.startsWith('VSCODE_') || ZELLIJ_ENV_KEYS_TO_STRIP.includes(key);
}

function getSanitizedZellijEnvKeys(): string[] {
  return Array.from(new Set([
    ...ZELLIJ_ENV_KEYS_TO_STRIP,
    ...Object.keys(process.env).filter(isZellijIntegrationEnvKey),
  ]));
}

function buildSanitizedZellijCommand(command: string, extraEnv: Record<string, string> = {}): string {
  const envKeys = getSanitizedZellijEnvKeys();
  const unsetArgs = envKeys.map((key) => `-u ${shellQuote(key)}`).join(' ');
  const envPrefix = unsetArgs.length > 0 ? `env ${unsetArgs}` : 'env';
  const envAssignments = [
    `ZELLIJ_SOCKET_DIR=${shellQuote(ZELLIJ_SOCKET_DIR)}`,
    ...Object.entries(extraEnv).map(([key, value]) => `${key}=${shellQuote(value)}`),
  ].join(' ');
  return `${envPrefix} ${envAssignments} ${command}`;
}

function getSanitizedZellijTerminalEnv(): Record<string, string | null> {
  const env: Record<string, string | null> = {
    ...ZELLIJ_BOOTSTRAP_ENV,
    ZELLIJ_SOCKET_DIR,
  };
  for (const key of getSanitizedZellijEnvKeys()) {
    env[key] = null;
  }
  return env;
}

function zellijExec(command: string, options?: ExecOptions, extraEnv?: Record<string, string>): Promise<string> {
  return exec(buildSanitizedZellijCommand(command, extraEnv), options);
}

// ─── Workdir Metadata Storage ─────────────────────────────
// Zellij has no built-in session metadata like tmux's @workdir.
// We persist session→workdir mappings in a JSON file.

const WORKDIR_STORE_DIR = path.join(os.homedir(), '.config', 'vscode-tmux-worktree');
const WORKDIR_STORE_FILE = path.join(WORKDIR_STORE_DIR, 'zellij-workdirs.json');

function readWorkdirStore(): Record<string, string> {
  try {
    if (fs.existsSync(WORKDIR_STORE_FILE)) {
      return JSON.parse(fs.readFileSync(WORKDIR_STORE_FILE, 'utf-8'));
    }
  } catch {
    // corrupted file – start fresh
  }
  return {};
}

function writeWorkdirStore(store: Record<string, string>): void {
  fs.mkdirSync(WORKDIR_STORE_DIR, { recursive: true });
  fs.writeFileSync(WORKDIR_STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

// ─── Output Parsing ───────────────────────────────────────

interface ZellijSessionInfo {
  name: string;
  isExited: boolean;
  createdAgoSeconds: number;
}

function parseCreatedAgo(text: string): number {
  let totalSeconds = 0;
  const hourMatch = text.match(/(\d+)h/);
  const minMatch = text.match(/(\d+)m/);
  const secMatch = text.match(/(\d+)s/);
  if (hourMatch) totalSeconds += parseInt(hourMatch[1], 10) * 3600;
  if (minMatch) totalSeconds += parseInt(minMatch[1], 10) * 60;
  if (secMatch) totalSeconds += parseInt(secMatch[1], 10);
  return totalSeconds;
}

function parseListSessions(output: string): ZellijSessionInfo[] {
  return output.split('\n').filter(l => l.trim()).map(line => {
    const isExited = line.includes('(EXITED');
    const nameMatch = line.match(/^(\S+)/);
    const name = nameMatch ? nameMatch[1] : line.trim();
    const createdMatch = line.match(/\[Created (.+?) ago\]/);
    const createdAgoSeconds = createdMatch ? parseCreatedAgo(createdMatch[1]) : 0;
    return { name, isExited, createdAgoSeconds };
  });
}

// ─── Backend Implementation ───────────────────────────────

function getShortName(sessionName: string): string {
  const parts = sessionName.split('_');
  if (parts.length > 1) {
    return parts.slice(1).join('_');
  }
  return sessionName;
}

export class ZellijBackend implements MultiplexerBackend {
  readonly type = 'zellij' as const;
  readonly displayName = 'Zellij';
  readonly installHint = 'Install: `cargo install zellij` or `brew install zellij`';

  async isInstalled(): Promise<boolean> {
    try {
      await exec('which zellij');
      return true;
    } catch {
      return false;
    }
  }

  async listSessions(): Promise<MultiplexerSession[]> {
    try {
      const output = await zellijExec('zellij list-sessions --no-formatting');
      const parsed = parseListSessions(output);
      const workdirStore = readWorkdirStore();
      return parsed
        .filter(s => !s.isExited)
        .map(s => ({
          name: s.name,
          windows: 1, // Zellij doesn't expose tab count in list-sessions
          attached: false, // list-sessions from outside cannot determine this reliably
          workdir: workdirStore[s.name],
        }));
    } catch {
      return [];
    }
  }

  async createSession(sessionName: string, cwd: string): Promise<void> {
    // Background-created Zellij sessions inherit TERM from the environment available
    // at creation time. Without an explicit terminal type this can end up as TERM=dumb,
    // which breaks prompt redraw and line editing in the initial shell pane even after
    // a later GUI attach. Seed detached sessions with the same TERM the VS Code terminal uses.
    await zellijExec(
      buildZellijBackgroundAttachCommand(sessionName),
      { cwd },
      ZELLIJ_BOOTSTRAP_ENV
    );
  }

  async killSession(sessionName: string): Promise<void> {
    await zellijExec(buildZellijKillSessionCommand(sessionName));
    const store = readWorkdirStore();
    delete store[sessionName];
    writeWorkdirStore(store);
  }

  async hasSession(sessionName: string): Promise<boolean> {
    try {
      const output = await zellijExec('zellij list-sessions --short');
      return output.split('\n').some(l => l.trim() === sessionName);
    } catch {
      return false;
    }
  }

  async getSessionWorkdir(sessionName: string): Promise<string | undefined> {
    const store = readWorkdirStore();
    return store[sessionName] || undefined;
  }

  async setSessionWorkdir(sessionName: string, workdir: string): Promise<void> {
    const store = readWorkdirStore();
    store[sessionName] = workdir;
    writeWorkdirStore(store);
  }

  async getSessionInfo(sessionName: string): Promise<SessionStatusInfo> {
    try {
      const output = await zellijExec('zellij list-sessions --no-formatting');
      const sessions = parseListSessions(output);
      const found = sessions.find(s => s.name === sessionName);
      if (!found || found.isExited) {
        return { attached: false, lastActive: 0 };
      }
      const now = Math.floor(Date.now() / 1000);
      return {
        attached: false, // cannot determine externally
        lastActive: now - found.createdAgoSeconds,
      };
    } catch {
      return { attached: false, lastActive: 0 };
    }
  }

  async getSessionPaneCount(): Promise<number> {
    // Zellij doesn't expose pane count from outside a session.
    return 1;
  }

  async getSessionPanePids(): Promise<string[]> {
    // Zellij doesn't expose pane PIDs from outside a session.
    return [];
  }

  attachSession(
    sessionName: string,
    cwd?: string,
    location: vscode.TerminalLocation = vscode.TerminalLocation.Editor
  ): vscode.Terminal {
    const shortName = getShortName(sessionName);
    const terminalName = shortName;

    const existing = vscode.window.terminals.find(t => t.name === terminalName);
    if (existing) {
      const options = existing.creationOptions as vscode.TerminalOptions;
      if (options && options.location === location) {
        existing.show();
        return existing;
      }
      existing.dispose();
    }

    // --create: auto-create session if it doesn't exist
    // --force-run-commands: resurrect exited sessions immediately
    const attachCommand = buildZellijInteractiveAttachCommand(sessionName);

    const terminal = vscode.window.createTerminal({
      name: terminalName,
      shellPath: '/bin/sh',
      shellArgs: ['-c', attachCommand],
      cwd: cwd,
      // VS Code shell integration markers can leak through the bootstrap shell and
      // confuse redraw/cursor bookkeeping inside Zellij-backed prompts. Remove the
      // injected env here and when spawning detached sessions so line editing stays stable.
      env: getSanitizedZellijTerminalEnv(),
      location,
      iconPath: new vscode.ThemeIcon('server')
    });
    terminal.show();
    return terminal;
  }

  async splitPane(sessionName: string): Promise<void> {
    // `zellij action` only works from inside a session (ZELLIJ env var).
    // Find the VS Code terminal attached to this session and send the action.
    const shortName = getShortName(sessionName);
    const terminal = vscode.window.terminals.find(t => t.name === shortName);
    if (!terminal) {
      vscode.window.showWarningMessage(
        `Session "${sessionName}" is not attached. Attach first, then use Zellij's built-in split (Ctrl+P → N).`
      );
      return;
    }
    // Pipe through the attached terminal's zellij session
    terminal.sendText('zellij action new-pane --direction down', true);
  }

  async newWindow(sessionName: string): Promise<void> {
    const shortName = getShortName(sessionName);
    const terminal = vscode.window.terminals.find(t => t.name === shortName);
    if (!terminal) {
      vscode.window.showWarningMessage(
        `Session "${sessionName}" is not attached. Attach first, then use Zellij's built-in new tab (Alt+T).`
      );
      return;
    }
    terminal.sendText('zellij action new-tab', true);
  }

  buildSessionName(repoName: string, slug: string): string {
    return `${this.sanitizeSessionName(repoName)}_${this.sanitizeSessionName(slug)}`;
  }

  sanitizeSessionName(name: string): string {
    // Same convention as tmux for consistency across backends.
    return name.replace(/[/\\\s.:]/g, '-');
  }
}
