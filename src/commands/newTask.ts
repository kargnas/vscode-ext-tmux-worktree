import * as vscode from 'vscode';
import {
  addWorktree,
  branchNameToSlug,
  getBaseBranch,
  getRepoRoot,
  getRepoSessionNamespace,
  isSlugTaken,
  listLocalBranches,
  localBranchExists,
  validateBranchName
} from '../utils/git';
import { getActiveBackend } from '../utils/multiplexer';

export async function newTask(): Promise<void> {
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
    vscode.window.showErrorMessage(`Failed to create task: ${message}`);
    return;
  }

  // 1. source branch 선택
  const localBranches = await listLocalBranches(repoRoot);
  if (localBranches.length === 0) {
    vscode.window.showErrorMessage('No local branches found in repository');
    return;
  }

  let suggestedBranch: string | undefined;
  try {
    const base = await getBaseBranch(repoRoot);
    suggestedBranch = base.startsWith('origin/') ? base.slice(7) : base;
  } catch {
    // No suggested branch; show all alphabetically
  }

  const branchItems = localBranches.map(b => ({ label: b }));
  if (suggestedBranch && localBranches.includes(suggestedBranch)) {
    const idx = branchItems.findIndex(item => item.label === suggestedBranch);
    if (idx > 0) {
      const item = branchItems.splice(idx, 1)[0];
      branchItems.unshift(item);
    }
  } else {
    branchItems.sort((a, b) => a.label.localeCompare(b.label));
  }

  const selectedSource = await vscode.window.showQuickPick(branchItems, {
    placeHolder: 'Select source branch for the new worktree'
  });
  if (!selectedSource) return;

  // 2. branch name 입력 받기
  const branchInput = await vscode.window.showInputBox({
    prompt: `Create new branch from "${selectedSource.label}"`,
    placeHolder: 'feat/my-task',
    validateInput: (value) => {
      return validateBranchName(value);
    }
  });

  if (!branchInput) return;

  // 3. branch name 정규화
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

    const baseBranch = selectedSource.label;

    // 4. session/worktree slug 충돌 확인 및 해결
    const slug = branchNameToSlug(branchName);
    let finalSlug = slug;
    let suffix = 1;
    while (await isSlugTaken(finalSlug, repoSessionNamespace, repoRoot)) {
      suffix++;
      finalSlug = `${slug}-${suffix}`;
    }

    // 5. worktree 생성
    const worktreePath = await addWorktree(repoRoot, branchName, finalSlug, baseBranch);

    // 6. session 생성
    const sessionName = backend.buildSessionName(repoSessionNamespace, finalSlug);
    await backend.createSession(sessionName, worktreePath);
    await backend.setSessionWorkdir(sessionName, worktreePath);

    // 7. attach
    backend.attachSession(sessionName, worktreePath);

    // 8. 성공 메시지
    vscode.window.showInformationMessage(`Created task: ${branchName} (from ${baseBranch})`);

    // 9. TreeView 갱신
    vscode.commands.executeCommand('tmux.refresh');

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to create task: ${message}`);
  }
}
