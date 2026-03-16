import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from '../utils/exec';
import { killSession, listSessions, getSessionWorkdir, TmuxSession } from '../utils/tmux';
import { getRepoRoot, isManagedWorktreePath, listWorktrees } from '../utils/git';
import { toCanonicalPath } from '../utils/path';
import { createRepoSessionPrefixConfig, isWorkdirInRepo } from '../utils/sessionCompatibility';

export async function cleanupOrphans(): Promise<void> {
  try {
    const repoRoot = getRepoRoot();
    const sessionPrefixConfig = createRepoSessionPrefixConfig(repoRoot);
    
    const allSessions = await listSessions();
    const repoPrefix = sessionPrefixConfig.primaryPrefix;
    const repoSessions: TmuxSession[] = [];
    for (const session of allSessions) {
      const workdir = await getSessionWorkdir(session.name);
      const inRepo = isWorkdirInRepo(workdir, sessionPrefixConfig.canonicalRepoRoot);
      if (inRepo || session.name.startsWith(repoPrefix)) {
        repoSessions.push({ ...session, workdir });
      }
    }
    
    const tmuxOnly: (TmuxSession & { workdir?: string })[] = [];
    for (const session of repoSessions) {
      const workdir = session.workdir || await getSessionWorkdir(session.name);
      if (!workdir || !fs.existsSync(workdir)) {
        tmuxOnly.push({ ...session, workdir });
      }
    }
    
    const worktrees = await listWorktrees(repoRoot);
    const sessionWorkdirs = new Set<string>();
    for (const session of repoSessions) {
      const workdir = session.workdir || await getSessionWorkdir(session.name);
      if (!workdir) continue;
      const normalizedWorkdir = toCanonicalPath(workdir) || path.resolve(workdir);
      sessionWorkdirs.add(normalizedWorkdir);
    }
    
    const worktreeOnly: string[] = [];
    for (const wt of worktrees) {
      const normalizedWorktreePath = toCanonicalPath(wt.path) || path.resolve(wt.path);
      if (isManagedWorktreePath(repoRoot, wt.path) && !sessionWorkdirs.has(normalizedWorktreePath)) {
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
      } catch {
        hasChanges = false;
      }

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
