import * as vscode from 'vscode';
import { getRepoRoot } from '../utils/git';
import { getActiveBackend } from '../utils/multiplexer';
import { InactiveWorktreeItem, InactiveDetailItem, TmuxItem } from '../providers/tmuxSessionProvider';
import { createRepoSessionPrefixConfig, isWorkdirInRepo } from '../utils/sessionCompatibility';

async function findSessionsForWorkspace(repoRoot: string): Promise<string[]> {
  const backend = getActiveBackend();
  const sessions = await backend.listSessions();
  const matchingSessions: string[] = [];
  const sessionPrefixConfig = await createRepoSessionPrefixConfig(repoRoot);
  const repoPrefix = sessionPrefixConfig.primaryPrefix;

  for (const session of sessions) {
    const workdir = session.workdir || await backend.getSessionWorkdir(session.name);
    const inRepo = isWorkdirInRepo(workdir, sessionPrefixConfig.canonicalRepoRoot);
    if (inRepo) {
      matchingSessions.push(session.name);
      continue;
    }

    if (session.name.startsWith(repoPrefix)) {
      matchingSessions.push(session.name);
      continue;
    }
  }

  return matchingSessions;
}

async function handleTreeViewItem(item: TmuxItem): Promise<void> {
    const backend = getActiveBackend();
    const sessionName = item.sessionName || item.label;
    
    const sessions = await backend.listSessions();
    const exists = sessions.some(s => s.name === sessionName);

    if (exists) {
        const workdir = await backend.getSessionWorkdir(sessionName);
        backend.attachSession(sessionName, workdir);
        return;
    }

    if (item instanceof InactiveWorktreeItem) {
        const worktreePath = item.worktree.path;
        
        await backend.createSession(sessionName, worktreePath);
        await backend.setSessionWorkdir(sessionName, worktreePath);
        
        backend.attachSession(sessionName, worktreePath);
        
        vscode.window.showInformationMessage(`Launched session: ${sessionName}`);
        vscode.commands.executeCommand('tmux.refresh');
        return;
    }
    
    if (item instanceof InactiveDetailItem) {
        const worktreePath = item.worktree.path;
        
        await backend.createSession(sessionName, worktreePath);
        await backend.setSessionWorkdir(sessionName, worktreePath);
        
        backend.attachSession(sessionName, worktreePath);
        
        vscode.window.showInformationMessage(`Launched session: ${sessionName}`);
        vscode.commands.executeCommand('tmux.refresh');
        return;
    }
    
    vscode.window.showErrorMessage(`Session '${sessionName}' not found and cannot be created automatically.`);
}

async function handleCommandExecution(): Promise<void> {
    const backend = getActiveBackend();
    const repoRoot = getRepoRoot();
    const matchingSessions = await findSessionsForWorkspace(repoRoot);

    if (matchingSessions.length > 0) {
        for (const session of matchingSessions) {
            const workdir = await backend.getSessionWorkdir(session);
            backend.attachSession(session, workdir);
        }
        vscode.window.showInformationMessage(`Attached to ${matchingSessions.length} session(s)`);
    } else {
        const choice = await vscode.window.showInformationMessage(
            `No existing ${backend.displayName} session found for this workspace. Create a new task?`,
            'Create New Task', 'Cancel'
        );
        if (choice === 'Create New Task') {
            vscode.commands.executeCommand('tmux.newTask');
        }
    }
}

export async function attachCreate(item?: TmuxItem | string): Promise<void> {
  const backend = getActiveBackend();
  if (!await backend.isInstalled()) {
    vscode.window.showErrorMessage(`${backend.displayName} not found. ${backend.installHint}`);
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
