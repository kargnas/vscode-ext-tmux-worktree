import * as vscode from 'vscode';
import {
  TmuxItem,
  TmuxSessionItem,
  InactiveWorktreeItem,
  WorktreeItem,
  TmuxDetailItem,
  InactiveDetailItem,
  TmuxWindowItem,
  TmuxPaneItem,
  GitStatusItem
} from '../providers/tmuxSessionProvider';
import { getActiveBackend } from '../utils/multiplexer';

function getWorktreePath(item: TmuxItem): string | undefined {
  if (item instanceof TmuxSessionItem) return item.session.worktreePath;
  if (item instanceof InactiveWorktreeItem) return item.worktree.path;
  if (item instanceof TmuxDetailItem) return item.worktreePath;
  if (item instanceof InactiveDetailItem) return item.worktree?.path;
  if (item instanceof WorktreeItem) return item.worktreePath;
  if (item instanceof GitStatusItem) return item.worktreePath;
  if (item instanceof TmuxWindowItem) return item.worktreePath;
  if (item instanceof TmuxPaneItem) return item.worktreePath;
  return undefined;
}

async function ensureSessionExists(sessionName: string, worktreePath?: string): Promise<void> {
  const backend = getActiveBackend();
  if (await backend.hasSession(sessionName)) {
    return;
  }

  if (!worktreePath) {
    throw new Error('Worktree path not found (cannot create session).');
  }

  await backend.createSession(sessionName, worktreePath);
  await backend.setSessionWorkdir(sessionName, worktreePath);
}

function getWindowIndex(item: TmuxItem): number | undefined {
  if (item instanceof TmuxWindowItem) return item.window.index;
  return undefined;
}

export async function attach(item: TmuxItem): Promise<void> {
  if (!item.sessionName) {
    vscode.window.showErrorMessage('No session selected');
    return;
  }
  const backend = getActiveBackend();
  if (!await backend.isInstalled()) {
    vscode.window.showErrorMessage(`${backend.displayName} not found. ${backend.installHint}`);
    return;
  }

  try {
    const worktreePath = getWorktreePath(item);
    await ensureSessionExists(item.sessionName, worktreePath);

    const workdir = worktreePath || await backend.getSessionWorkdir(item.sessionName);
    backend.attachSession(item.sessionName, workdir, vscode.TerminalLocation.Panel, getWindowIndex(item));
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to attach: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function attachInEditor(item: TmuxItem): Promise<void> {
  if (!item.sessionName) {
    vscode.window.showErrorMessage('No session selected');
    return;
  }
  const backend = getActiveBackend();
  if (!await backend.isInstalled()) {
    vscode.window.showErrorMessage(`${backend.displayName} not found. ${backend.installHint}`);
    return;
  }

  try {
    const worktreePath = getWorktreePath(item);
    await ensureSessionExists(item.sessionName, worktreePath);

    const workdir = worktreePath || await backend.getSessionWorkdir(item.sessionName);
    backend.attachSession(item.sessionName, workdir, vscode.TerminalLocation.Editor, getWindowIndex(item));
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to attach: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function openWorktree(item: TmuxItem): Promise<void> {
  const worktreePath = getWorktreePath(item);
  if (!worktreePath) {
    vscode.window.showErrorMessage('Worktree path not found');
    return;
  }
  const worktreeUri = vscode.Uri.file(worktreePath);
  await vscode.commands.executeCommand('vscode.openFolder', worktreeUri, true);
}

export async function copyPath(item: TmuxItem): Promise<void> {
  const worktreePath = getWorktreePath(item);
  if (!worktreePath) {
    vscode.window.showErrorMessage('Worktree path not found');
    return;
  }
  await vscode.env.clipboard.writeText(worktreePath);
  vscode.window.showInformationMessage(`Copied: ${worktreePath}`);
}

export async function newPane(item: TmuxItem): Promise<void> {
  if (!item.sessionName) {
    vscode.window.showErrorMessage('No session selected');
    return;
  }
  const backend = getActiveBackend();
  try {
    if (!await backend.isInstalled()) {
      vscode.window.showErrorMessage(`${backend.displayName} not found. ${backend.installHint}`);
      return;
    }

    const cwd = getWorktreePath(item);
    await ensureSessionExists(item.sessionName, cwd);
    await backend.splitPane(item.sessionName, cwd, 'vertical');
    vscode.window.showInformationMessage(`New pane created in ${item.sessionName}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to create pane: ${err}`);
  }
}

export async function newPaneHorizontal(item: TmuxItem): Promise<void> {
  if (!item.sessionName) {
    vscode.window.showErrorMessage('No session selected');
    return;
  }
  const backend = getActiveBackend();
  try {
    if (!await backend.isInstalled()) {
      vscode.window.showErrorMessage(`${backend.displayName} not found. ${backend.installHint}`);
      return;
    }

    const cwd = getWorktreePath(item);
    await ensureSessionExists(item.sessionName, cwd);
    await backend.splitPane(item.sessionName, cwd, 'horizontal');
    vscode.window.showInformationMessage(`New horizontal pane created in ${item.sessionName}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to create pane: ${err}`);
  }
}

export async function newWindow(item: TmuxItem): Promise<void> {
  if (!item.sessionName) {
    vscode.window.showErrorMessage('No session selected');
    return;
  }
  const backend = getActiveBackend();
  try {
    if (!await backend.isInstalled()) {
      vscode.window.showErrorMessage(`${backend.displayName} not found. ${backend.installHint}`);
      return;
    }

    const cwd = getWorktreePath(item);
    await ensureSessionExists(item.sessionName, cwd);
    await backend.newWindow(item.sessionName, cwd);
    vscode.window.showInformationMessage(`New window created in ${item.sessionName}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to create window: ${err}`);
  }
}
