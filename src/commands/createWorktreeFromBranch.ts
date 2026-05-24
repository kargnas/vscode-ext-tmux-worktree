import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  addWorktree,
  branchNameToSlug,
  getRepoRoot,
  getRepoSessionNamespace,
  isSlugTaken,
  localBranchExists,
  validateBranchName
} from '../utils/git';
import { exec } from '../utils/exec';
import { getActiveBackend } from '../utils/multiplexer';
import { WorktreeItem } from '../providers/tmuxSessionProvider';

function formatFileStatusCounts(nameStatusOutput: string): string {
  const lines = nameStatusOutput.trim().split('\n').filter(l => l.length > 0);
  let added = 0, modified = 0, deleted = 0, renamed = 0;
  for (const line of lines) {
    const status = line.charAt(0);
    if (status === 'A') added++;
    else if (status === 'M') modified++;
    else if (status === 'D') deleted++;
    else if (status === 'R') renamed++;
    else modified++;
  }
  const parts: string[] = [];
  if (modified) parts.push(`${modified} modified`);
  if (added) parts.push(`${added} new`);
  if (deleted) parts.push(`${deleted} deleted`);
  if (renamed) parts.push(`${renamed} renamed`);
  return parts.length > 0 ? `(${parts.join(', ')})` : '';
}

export async function createWorktreeFromBranch(item: WorktreeItem | undefined): Promise<void> {
  if (!item) {
    // Called from Command Palette without tree context — no source branch available
    vscode.window.showWarningMessage('Right-click a branch in the TMUX panel to create a worktree from it.');
    return;
  }

  const backend = getActiveBackend();
  if (!await backend.isInstalled()) {
    vscode.window.showErrorMessage(`${backend.displayName} not found. ${backend.installHint}`);
    return;
  }

  let repoRoot: string;
  let repoSessionNamespace: string;
  try {
    repoRoot = getRepoRoot();
    repoSessionNamespace = await getRepoSessionNamespace(repoRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed: ${message}`);
    return;
  }

  const sourceBranch = item.label;
  if (!sourceBranch) {
    vscode.window.showErrorMessage('Cannot determine source branch');
    return;
  }

  const branchInput = await vscode.window.showInputBox({
    prompt: `Create new branch from "${sourceBranch}"`,
    placeHolder: 'feat/my-task',
    validateInput: validateBranchName
  });
  if (!branchInput) return;

  const branchName = branchInput.trim();
  const branchValidationError = validateBranchName(branchName);
  if (branchValidationError) {
    vscode.window.showErrorMessage(branchValidationError);
    return;
  }

  try {
    if (await localBranchExists(repoRoot, branchName)) {
      throw new Error(`Branch "${branchName}" already exists.`);
    }

    const [stagedDiff, unstagedDiff, stagedStatus, unstagedStatus] = await Promise.all([
      exec('git diff --cached', { cwd: repoRoot }).catch(() => ''),
      exec('git diff', { cwd: repoRoot }).catch(() => ''),
      exec('git diff --cached --name-status', { cwd: repoRoot }).catch(() => ''),
      exec('git diff --name-status', { cwd: repoRoot }).catch(() => '')
    ]);
    const hasStaged = stagedDiff.trim().length > 0;
    const hasUnstaged = unstagedDiff.trim().length > 0;

    let carryStaged = false;
    let carryUnstaged = false;

    if (hasStaged || hasUnstaged) {
      const options: vscode.QuickPickItem[] = [];
      if (hasStaged) options.push({ label: 'Carry staged changes', description: formatFileStatusCounts(stagedStatus) });
      if (hasUnstaged) options.push({ label: 'Carry unstaged changes', description: formatFileStatusCounts(unstagedStatus) });

      const selected = await vscode.window.showQuickPick(options, {
        canPickMany: true,
        placeHolder: 'Select changes to carry over (Enter to skip)'
      });
      if (selected === undefined) return;

      carryStaged = selected.some(s => s.label === 'Carry staged changes');
      carryUnstaged = selected.some(s => s.label === 'Carry unstaged changes');
    }

    const slug = branchNameToSlug(branchName);
    let finalSlug = slug;
    let suffix = 1;
    while (await isSlugTaken(finalSlug, repoSessionNamespace, repoRoot)) {
      suffix++;
      finalSlug = `${slug}-${suffix}`;
    }

    const worktreePath = await addWorktree(repoRoot, branchName, finalSlug, sourceBranch);

    // Apply carried changes: staged first (then git add), unstaged second (stays unstaged)
    if (carryStaged && stagedDiff.trim()) {
      const tmpFile = path.join(os.tmpdir(), `tmux-wt-staged-${Date.now()}.patch`);
      fs.writeFileSync(tmpFile, stagedDiff);
      try {
        await exec(`git apply "${tmpFile}"`, { cwd: worktreePath });
        await exec('git add -A', { cwd: worktreePath });
      } catch (err) {
        vscode.window.showWarningMessage(`Staged changes could not be applied cleanly: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    }
    if (carryUnstaged && unstagedDiff.trim()) {
      const tmpFile = path.join(os.tmpdir(), `tmux-wt-unstaged-${Date.now()}.patch`);
      fs.writeFileSync(tmpFile, unstagedDiff);
      try {
        await exec(`git apply "${tmpFile}"`, { cwd: worktreePath });
      } catch (err) {
        vscode.window.showWarningMessage(`Unstaged changes could not be applied cleanly: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    }

    const sessionName = backend.buildSessionName(repoSessionNamespace, finalSlug);
    await backend.createSession(sessionName, worktreePath);
    await backend.setSessionWorkdir(sessionName, worktreePath);
    backend.attachSession(sessionName, worktreePath);

    vscode.window.showInformationMessage(`Created worktree: ${branchName} (from ${sourceBranch})`);
    vscode.commands.executeCommand('tmux.refresh');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to create worktree: ${message}`);
  }
}
