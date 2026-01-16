import * as vscode from 'vscode';
import { exec } from '../utils/exec';
import { TmuxSessionItem } from '../providers/tmuxSessionProvider';
import { attachSession } from '../utils/tmux';

export async function attach(item: TmuxSessionItem): Promise<void> {
  if (!item.sessionName) {
    vscode.window.showErrorMessage('No session selected');
    return;
  }
  attachSession(item.sessionName, item.session.worktreePath);
}

export async function openWorktree(item: TmuxSessionItem): Promise<void> {
  if (!item.session.worktreePath) {
    vscode.window.showErrorMessage('Worktree path not found');
    return;
  }
  const worktreeUri = vscode.Uri.file(item.session.worktreePath);
  await vscode.commands.executeCommand('vscode.openFolder', worktreeUri, true);
}

export async function copyPath(item: TmuxSessionItem): Promise<void> {
  if (!item.session.worktreePath) {
    vscode.window.showErrorMessage('Worktree path not found');
    return;
  }
  await vscode.env.clipboard.writeText(item.session.worktreePath);
  vscode.window.showInformationMessage(`Copied: ${item.session.worktreePath}`);
}

export async function newPane(item: TmuxSessionItem): Promise<void> {
  if (!item.sessionName) {
    vscode.window.showErrorMessage('No session selected');
    return;
  }
  try {
    const cwd = item.session.worktreePath ? `-c "${item.session.worktreePath}"` : '';
    await exec(`tmux split-window -t "${item.sessionName}" ${cwd}`);
    vscode.window.showInformationMessage(`New pane created in ${item.sessionName}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to create pane: ${err}`);
  }
}

export async function newWindow(item: TmuxSessionItem): Promise<void> {
  if (!item.sessionName) {
    vscode.window.showErrorMessage('No session selected');
    return;
  }
  try {
    const cwd = item.session.worktreePath ? `-c "${item.session.worktreePath}"` : '';
    await exec(`tmux new-window -t "${item.sessionName}" ${cwd}`);
    vscode.window.showInformationMessage(`New window created in ${item.sessionName}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to create window: ${err}`);
  }
}

export function runClaude(item: TmuxSessionItem): void {
  runCommand(item, 'claude');
}

export function runOpencode(item: TmuxSessionItem): void {
  runCommand(item, 'opencode');
}

export async function runCustom(item: TmuxSessionItem): Promise<void> {
  const command = await vscode.window.showInputBox({
    prompt: 'Enter command to run',
    placeHolder: 'e.g., npm run dev'
  });
  if (command) {
    runCommand(item, command);
  }
}

function runCommand(item: TmuxSessionItem, command: string): void {
  const cwd = item.session.worktreePath || undefined;
  const terminalName = `CLI: ${command.split(' ')[0]}`;
  
  const terminal = vscode.window.createTerminal({
    name: terminalName,
    cwd
  });
  terminal.sendText(command);
  terminal.show();
}
