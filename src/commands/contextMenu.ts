import * as vscode from 'vscode';
import { exec } from '../utils/exec';
import { TmuxSessionItem, TmuxSessionDetailItem, InactiveWorktreeItem, InactiveWorktreeDetailItem, TmuxItem } from '../providers/tmuxSessionProvider';
import { attachSession, getSessionWorkdir } from '../utils/tmux';

function getWorktreePath(item: TmuxItem): string | undefined {
  if (item instanceof TmuxSessionItem) {
    return item.session.worktreePath;
  }
  if (item instanceof TmuxSessionDetailItem) {
    return item.session.worktreePath;
  }
  if (item instanceof InactiveWorktreeItem) {
    return item.worktree.path;
  }
  if (item instanceof InactiveWorktreeDetailItem) {
    return item.worktree.path;
  }
  return undefined;
}

export async function attach(item: TmuxItem): Promise<void> {
  if (!item.sessionName) {
    vscode.window.showErrorMessage('No session selected');
    return;
  }
  const workdir = getWorktreePath(item) || await getSessionWorkdir(item.sessionName);
  attachSession(item.sessionName, workdir, vscode.TerminalLocation.Panel);
}

export async function attachInEditor(item: TmuxItem): Promise<void> {
  if (!item.sessionName) {
    vscode.window.showErrorMessage('No session selected');
    return;
  }
  const workdir = getWorktreePath(item) || await getSessionWorkdir(item.sessionName);
  attachSession(item.sessionName, workdir, vscode.TerminalLocation.Editor);
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
  try {
    const cwd = getWorktreePath(item);
    const cwdArg = cwd ? `-c "${cwd}"` : '';
    await exec(`tmux split-window -t "${item.sessionName}" ${cwdArg}`);
    vscode.window.showInformationMessage(`New pane created in ${item.sessionName}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to create pane: ${err}`);
  }
}

export async function newWindow(item: TmuxItem): Promise<void> {
  if (!item.sessionName) {
    vscode.window.showErrorMessage('No session selected');
    return;
  }
  try {
    const cwd = getWorktreePath(item);
    const cwdArg = cwd ? `-c "${cwd}"` : '';
    await exec(`tmux new-window -t "${item.sessionName}" ${cwdArg}`);
    vscode.window.showInformationMessage(`New window created in ${item.sessionName}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to create window: ${err}`);
  }
}

export function runClaude(item: TmuxItem): void {
  runCommand(item, 'claude');
}

export function runOpencode(item: TmuxItem): void {
  runCommand(item, 'opencode');
}

export async function runCustom(item: TmuxItem): Promise<void> {
  const command = await vscode.window.showInputBox({
    prompt: 'Enter command to run',
    placeHolder: 'e.g., npm run dev'
  });
  if (command) {
    runCommand(item, command);
  }
}

function runCommand(item: TmuxItem, command: string): void {
  const cwd = getWorktreePath(item);
  const terminalName = `CLI: ${command.split(' ')[0]}`;
  
  const terminal = vscode.window.createTerminal({
    name: terminalName,
    cwd
  });
  terminal.sendText(command);
  terminal.show();
}
