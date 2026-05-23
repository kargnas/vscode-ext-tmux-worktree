import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CONFIG_SECTION = 'tmuxWorktree';
const SOCKET_DIR_KEY = 'socketDir';
const INITIALIZED_KEY = 'socketDirInitialized';

// /var/tmp is the POSIX persistent-temp directory: survives reboots for a grace period
// (unlike /tmp which is wiped). Tmux/zellij sockets are stateful → /var/tmp suits them
// better. Also avoids macOS' deep $TMPDIR (/var/folders/…/T/) exceeding the 103-byte
// Unix-socket path limit when session names get long.
export const DEFAULT_SOCKET_DIR = '/var/tmp';

function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

export function getConfiguredSocketDir(): string {
  const value = getConfig().get<string>(SOCKET_DIR_KEY);
  if (!value || !value.trim()) {
    return DEFAULT_SOCKET_DIR;
  }
  return expandHome(value.trim());
}

export function isSocketDirInitialized(): boolean {
  return getConfig().get<boolean>(INITIALIZED_KEY, false);
}

export async function setSocketDir(socketDir: string): Promise<void> {
  await getConfig().update(SOCKET_DIR_KEY, socketDir, vscode.ConfigurationTarget.Global);
}

export async function markSocketDirInitialized(): Promise<void> {
  await getConfig().update(INITIALIZED_KEY, true, vscode.ConfigurationTarget.Global);
}

// Zellij stores its IPC socket at `${ZELLIJ_SOCKET_DIR}/<session>`.
export function getZellijSocketDir(): string {
  return path.join(getConfiguredSocketDir(), 'zellij');
}

// Tmux derives its socket path from `${TMUX_TMPDIR}/tmux-${UID}/<socket-name>`. We
// export TMUX_TMPDIR so all tmux invocations land in the configured dir; tmux itself
// creates the `tmux-${UID}` subdir on demand.
export function getTmuxTmpDir(): string {
  return getConfiguredSocketDir();
}

function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function ensureSocketDirExists(socketDir: string): void {
  if (!fs.existsSync(socketDir)) {
    fs.mkdirSync(socketDir, { recursive: true });
  }
}

/**
 * Esc / cancel at any prompt step → no settings change AND no `initialized` flag,
 * so the prompt re-runs on next activation. This avoids permanently silencing the
 * prompt when the user was merely dismissing an interrupting dialog. Empty input
 * (Enter on the input box) falls back to DEFAULT_SOCKET_DIR.
 */
export async function promptForSocketDirIfNeeded(): Promise<void> {
  if (isSocketDirInitialized()) {
    return;
  }

  const inputValue = await vscode.window.showInputBox({
    title: 'TMUX Worktree: Session File Directory',
    prompt: `Where to store tmux/zellij session files? Press Enter to use default.`,
    placeHolder: DEFAULT_SOCKET_DIR,
    value: '',
    ignoreFocusOut: true,
  });

  if (inputValue === undefined) {
    return;
  }

  const chosen = inputValue.trim() || DEFAULT_SOCKET_DIR;
  const resolved = expandHome(chosen);

  if (!fs.existsSync(resolved)) {
    const create = await vscode.window.showInformationMessage(
      `Directory \`${resolved}\` does not exist. Create it?`,
      { modal: true },
      'Create',
      'Cancel'
    );
    if (create !== 'Create') {
      return;
    }
    try {
      ensureSocketDirExists(resolved);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to create directory \`${resolved}\`: ${(err as Error).message}`
      );
      return;
    }
  }

  await setSocketDir(resolved);
  await markSocketDirInitialized();

  const sync = await vscode.window.showInformationMessage(
    `Session dir set to \`${resolved}\`. Also sync to your shell rc so tmux/zellij in other terminals use the same dir?`,
    'Sync to Shell',
    'Skip'
  );
  if (sync === 'Sync to Shell') {
    await vscode.commands.executeCommand('tmux.syncSocketDirToShell');
  }
}

export async function promptToChangeSocketDir(): Promise<void> {
  const current = getConfiguredSocketDir();
  const inputValue = await vscode.window.showInputBox({
    title: 'TMUX Worktree: Change Session File Directory',
    prompt: `Current: ${current}. Enter new path (or leave empty for default).`,
    placeHolder: DEFAULT_SOCKET_DIR,
    value: current,
    ignoreFocusOut: true,
  });

  if (inputValue === undefined) {
    return;
  }

  const chosen = inputValue.trim() || DEFAULT_SOCKET_DIR;
  const resolved = expandHome(chosen);

  if (resolved === current) {
    vscode.window.showInformationMessage('Socket directory unchanged.');
    return;
  }

  if (!fs.existsSync(resolved)) {
    const create = await vscode.window.showInformationMessage(
      `Directory \`${resolved}\` does not exist. Create it?`,
      { modal: true },
      'Create',
      'Cancel'
    );
    if (create !== 'Create') {
      return;
    }
    try {
      ensureSocketDirExists(resolved);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to create directory \`${resolved}\`: ${(err as Error).message}`
      );
      return;
    }
  }

  await setSocketDir(resolved);
  await markSocketDirInitialized();

  vscode.window.showInformationMessage(
    `Session dir changed to \`${resolved}\`. Restart attached sessions for full effect.`
  );
}
