import * as vscode from 'vscode';
import { getRepoRoot, getRepoName } from '../utils/git';
import { isTmuxInstalled, listSessions, getSessionWorkdir, attachSession, createSession, setSessionWorkdir } from '../utils/tmux';
import { InactiveWorktreeItem, InactiveWorktreeDetailItem, TmuxItem } from '../providers/tmuxSessionProvider';

async function findSessionsForWorkspace(repoRoot: string): Promise<string[]> {
  const sessions = await listSessions();
  const matchingSessions: string[] = [];
  const repoName = getRepoName(repoRoot);
  const repoPrefix = `${repoName}_`;

  for (const session of sessions) {
    if (!session.name.startsWith(repoPrefix)) continue;

    const workdir = await getSessionWorkdir(session.name);
    if (workdir && workdir.startsWith(repoRoot)) {
      matchingSessions.push(session.name);
    }
  }

  return matchingSessions;
}

async function handleTreeViewItem(item: TmuxItem): Promise<void> {
    const sessionName = item.sessionName || item.label;
    
    const sessions = await listSessions();
    const exists = sessions.some(s => s.name === sessionName);

    if (exists) {
        const workdir = await getSessionWorkdir(sessionName);
        attachSession(sessionName, workdir);
        return;
    }

    if (item instanceof InactiveWorktreeItem) {
        const worktreePath = item.worktree.path;
        
        await createSession(sessionName, worktreePath);
        await setSessionWorkdir(sessionName, worktreePath);
        
        attachSession(sessionName, worktreePath);
        
        vscode.window.showInformationMessage(`Launched session: ${sessionName}`);
        vscode.commands.executeCommand('tmux.refresh');
        return;
    }
    
    if (item instanceof InactiveWorktreeDetailItem) {
        const worktreePath = item.worktree.path;
        
        await createSession(sessionName, worktreePath);
        await setSessionWorkdir(sessionName, worktreePath);
        
        attachSession(sessionName, worktreePath);
        
        vscode.window.showInformationMessage(`Launched session: ${sessionName}`);
        vscode.commands.executeCommand('tmux.refresh');
        return;
    }
    
    vscode.window.showErrorMessage(`Session '${sessionName}' not found and cannot be created automatically.`);
}

async function handleCommandExecution(): Promise<void> {
    const repoRoot = getRepoRoot();
    const matchingSessions = await findSessionsForWorkspace(repoRoot);

    if (matchingSessions.length > 0) {
        for (const session of matchingSessions) {
            const workdir = await getSessionWorkdir(session);
            attachSession(session, workdir);
        }
        vscode.window.showInformationMessage(`Attached to ${matchingSessions.length} session(s)`);
    } else {
        const choice = await vscode.window.showInformationMessage(
            'No existing tmux session found for this workspace. Create a new task?',
            'Create New Task', 'Cancel'
        );
        if (choice === 'Create New Task') {
            vscode.commands.executeCommand('tmux.newTask');
        }
    }
}

export async function attachCreate(item?: TmuxItem | string): Promise<void> {
  if (!await isTmuxInstalled()) {
    vscode.window.showErrorMessage('tmux not found. Install: `brew install tmux`');
    return;
  }

  try {
    if (item instanceof TmuxItem) {
        await handleTreeViewItem(item);
    } else {
        await handleCommandExecution();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to attach/create: ${message}`);
  }
}
