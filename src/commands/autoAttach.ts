import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from '../utils/exec';
import { attachSession } from '../utils/tmux';

export async function autoAttachOnStartup(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) return;

  const repoRoot = workspaceFolders[0].uri.fsPath;
  const repoName = path.basename(repoRoot);
  const repoPrefix = `${repoName}_`;

  interface SessionInfo {
    name: string;
    attached: boolean;
  }

  let sessions: SessionInfo[] = [];
  try {
    const output = await exec("tmux list-sessions -F '#{session_name}\t#{session_attached}'");
    sessions = output.split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => {
        const [name, attachedStr] = line.split('\t');
        return {
          name,
          attached: attachedStr === '1'
        };
      });
  } catch { return; }

  if (sessions.length === 0) return;

  const matching: string[] = [];
  for (const session of sessions) {
    if (!session.name.startsWith(repoPrefix)) {
        continue;
    }

    if (session.attached) {
        continue;
    }

    try {
      const output = await exec(`tmux show-options -t "${session.name}" @workdir`);
      const workdir = output.split(' ').slice(1).join(' ').trim();
      if (workdir && workdir.startsWith(repoRoot)) {
        matching.push(session.name);
      }
    } catch { }
  }

  for (const sessionName of matching) {
    attachSession(sessionName);
  }
}
