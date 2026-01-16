import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from '../utils/exec';
import { killSession, listSessions, getSessionWorkdir, TmuxSession } from '../utils/tmux';
import { getRepoRoot, getRepoName, listWorktrees } from '../utils/git';

export async function cleanupOrphans(): Promise<void> {
  try {
    const repoRoot = getRepoRoot();
    const repoName = getRepoName(repoRoot);
    
    const allSessions = await listSessions();
    const repoPrefix = `${repoName}:`;
    const repoSessions = allSessions.filter(s => s.name.startsWith(repoPrefix));
    
    const tmuxOnly: (TmuxSession & { workdir?: string })[] = [];
    for (const session of repoSessions) {
      const workdir = await getSessionWorkdir(session.name);
      if (!workdir || !fs.existsSync(workdir)) {
        tmuxOnly.push({ ...session, workdir });
      }
    }
    
    const worktrees = await listWorktrees(repoRoot);
    const sessionWorkdirs = new Set<string>();
    for (const session of repoSessions) {
      const workdir = await getSessionWorkdir(session.name);
      if (workdir) sessionWorkdirs.add(workdir);
    }
    
    const worktreeOnly: string[] = [];
    for (const wt of worktrees) {
      if (wt.path.includes('/.worktrees/') && !sessionWorkdirs.has(wt.path)) {
        worktreeOnly.push(wt.path);
      }
    }

    if (tmuxOnly.length === 0 && worktreeOnly.length === 0) {
      vscode.window.showInformationMessage('No orphans found.');
      return;
    }

    for (const session of tmuxOnly) {
      const choice = await vscode.window.showWarningMessage(
        `Session "${session.name}" has no worktree. Remove?`, 'Remove', 'Skip'
      );
      if (choice === 'Remove') {
        await killSession(session.name);
      }
    }

    for (const wtPath of worktreeOnly) {
      let hasChanges = false;
      try {
        const status = await exec(`git -C "${wtPath}" status --porcelain`);
        hasChanges = status.trim().length > 0;
      } catch { }

      const slug = path.basename(wtPath);
      const msg = hasChanges
        ? `Worktree "${slug}" has uncommitted changes. Force remove?`
        : `Worktree "${slug}" has no session. Remove?`;

      const choice = await vscode.window.showWarningMessage(msg, 'Remove', 'Skip');
      if (choice === 'Remove') {
        const force = hasChanges ? '--force' : '';
        await exec(`git worktree remove ${force} "${wtPath}"`, { cwd: repoRoot });
      }
    }

    vscode.window.showInformationMessage('Orphan cleanup complete.');
    vscode.commands.executeCommand('tmux.refresh');
  } catch (err) {
    vscode.window.showErrorMessage(`Cleanup failed: ${err}`);
  }
}
