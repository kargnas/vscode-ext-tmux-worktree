import * as vscode from 'vscode';
import * as fs from 'fs';
import { exec } from '../utils/exec';
import { killSession } from '../utils/tmux';
import { getRepoRoot } from '../utils/git';
import { TmuxSessionItem } from '../providers/tmuxSessionProvider';

export async function removeTask(item: TmuxSessionItem): Promise<void> {
  if (!item || !item.sessionName) {
    vscode.window.showErrorMessage('No session selected');
    return;
  }

  const sessionName = item.sessionName;
  const worktreePath = item.session.worktreePath;
  const slug = item.session.slug;
  
  if (worktreePath) {
    try {
      const repoRoot = getRepoRoot();
      const realPath = fs.realpathSync(worktreePath);
      if (!realPath.startsWith(repoRoot)) {
        vscode.window.showErrorMessage('Cannot delete outside repo root.');
        return;
      }
    } catch { }
  }
  
  const confirm = await vscode.window.showWarningMessage(
    `Delete session "${sessionName}" and worktree? This cannot be undone.`,
    { modal: true },
    'Delete'
  );
  if (confirm !== 'Delete') return;
  
  try {
    await killSession(sessionName);
  } catch { }
  
  if (worktreePath && fs.existsSync(worktreePath)) {
    try {
      const repoRoot = getRepoRoot();
      await exec(`git worktree remove "${worktreePath}"`, { cwd: repoRoot });
    } catch {
      const forceConfirm = await vscode.window.showWarningMessage(
        'Worktree has uncommitted changes. Force remove?',
        'Force Remove', 'Cancel'
      );
      if (forceConfirm === 'Force Remove') {
        try {
          const repoRoot = getRepoRoot();
          await exec(`git worktree remove "${worktreePath}" --force`, { cwd: repoRoot });
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to remove worktree: ${err}`);
          return;
        }
      } else {
        return;
      }
    }
  }
  
  const branchName = `task/${slug}`;
  try {
    const repoRoot = getRepoRoot();
    await exec(`git rev-parse --verify "${branchName}"`, { cwd: repoRoot });
    
    const deleteBranch = await vscode.window.showWarningMessage(
      `Also delete local branch "${branchName}"?`,
      'Delete Branch', 'Keep Branch'
    );
    if (deleteBranch === 'Delete Branch') {
      await exec(`git branch -d "${branchName}"`, { cwd: repoRoot });
    }
  } catch { }
  
  vscode.window.showInformationMessage(`Removed task: ${slug}`);
  vscode.commands.executeCommand('tmux.refresh');
}
