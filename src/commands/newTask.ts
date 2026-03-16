import * as vscode from 'vscode';
import {
  addWorktree,
  branchNameToSlug,
  getBaseBranch,
  getRepoRoot,
  getRepoSessionNamespace,
  isSlugTaken,
  localBranchExists,
  validateBranchName
} from '../utils/git';
import { isTmuxInstalled, createSession, setSessionWorkdir, attachSession, buildSessionName } from '../utils/tmux';

export async function newTask(): Promise<void> {
  // 0. tmux 설치 확인
  if (!await isTmuxInstalled()) {
    vscode.window.showErrorMessage('tmux not found. Install: `brew install tmux`');
    return;
  }

  let repoRoot: string;
  let repoSessionNamespace: string;
  try {
    repoRoot = getRepoRoot();
    repoSessionNamespace = getRepoSessionNamespace(repoRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to create task: ${message}`);
    return;
  }

  // 1. branch name 입력 받기
  const branchInput = await vscode.window.showInputBox({
    prompt: 'Enter branch name (e.g., "feat/auth", "task/my-task")',
    placeHolder: 'feat/my-task',
    validateInput: (value) => {
      return validateBranchName(value);
    }
  });

  if (!branchInput) return; // 취소됨

  // 2. branch name 정규화
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

    // 3. 기준 브랜치 결정
    const baseBranch = await getBaseBranch(repoRoot);

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

    // 6. tmux session 생성
    const sessionName = buildSessionName(repoSessionNamespace, finalSlug);
    await createSession(sessionName, worktreePath);
    await setSessionWorkdir(sessionName, worktreePath);

    // 7. attach
    attachSession(sessionName, worktreePath);

    // 8. 성공 메시지
    vscode.window.showInformationMessage(`Created task: ${branchName}`);

    // 9. TreeView 갱신 (refresh 명령 호출)
    vscode.commands.executeCommand('tmux.refresh');

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to create task: ${message}`);
  }
}
