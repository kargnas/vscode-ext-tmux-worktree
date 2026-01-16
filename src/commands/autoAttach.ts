import * as vscode from 'vscode';
import { exec } from '../utils/exec';

export async function autoAttachOnStartup(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) return;

  let sessions: string[];
  try {
    const output = await exec("tmux list-sessions -F '#{session_name}'");
    sessions = output.split('\n').filter(Boolean);
  } catch { return; }

  if (sessions.length === 0) return;

  const matching: string[] = [];
  for (const session of sessions) {
    try {
      const output = await exec(`tmux show-options -t "${session}" @workdir`);
      const workdir = output.split(' ').slice(1).join(' ').trim();
      if (workspaceFolders.some(f => workdir.startsWith(f.uri.fsPath))) {
        matching.push(session);
      }
    } catch { }
  }

  for (const session of matching) {
    const existing = vscode.window.terminals.find(t => t.name === `tmux: ${session}`);
    if (existing) {
      existing.show();
    } else {
      const terminal = vscode.window.createTerminal({ name: `tmux: ${session}` });
      terminal.sendText(`tmux attach -t "${session}"`);
      terminal.show();
    }
  }
}
