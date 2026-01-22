import * as vscode from 'vscode';
import { getRepoRoot, getRepoName, getBaseBranch, isSlugTaken, addWorktree } from '../utils/git';
import { isTmuxInstalled, createSession, setSessionWorkdir, attachSession, buildSessionName } from '../utils/tmux';

export async function newTask(): Promise<void> {
  // 0. tmux 설치 확인
  if (!await isTmuxInstalled()) {
    vscode.window.showErrorMessage('tmux not found. Install: `brew install tmux`');
    return;
  }

  // 1. slug 입력 받기
  const slugInput = await vscode.window.showInputBox({
    prompt: 'Enter task slug (e.g., "feature-auth", "fix-login")',
    placeHolder: 'my-task-name',
    validateInput: (value) => {
      if (!value || value.trim() === '') {
        return 'Slug is required.';
      }
      // 소문자/숫자/`-`만 허용
      if (!/^[a-z0-9-]+$/.test(value)) {
        return 'Slug must contain only lowercase letters, numbers, and hyphens.';
      }
      if (value.length > 32) {
        return 'Slug must be 32 characters or less.';
      }
      return null;
    }
  });

  if (!slugInput) return; // 취소됨

  // 2. slug 정규화
  const slug = slugInput.trim().toLowerCase().replace(/\s+/g, '-');

  try {
    // 3. repoRoot 결정
    const repoRoot = getRepoRoot();
    const repoName = getRepoName(repoRoot);

    // 4. 기준 브랜치 결정
    const baseBranch = await getBaseBranch(repoRoot);

    // 5. slug 충돌 확인 및 해결
    let finalSlug = slug;
    let suffix = 1;
    while (await isSlugTaken(finalSlug, repoName, repoRoot)) {
      suffix++;
      finalSlug = `${slug}-${suffix}`;
    }

    // 6. worktree 생성
    const worktreePath = await addWorktree(repoRoot, finalSlug, baseBranch);

    // 7. tmux session 생성
    const sessionName = buildSessionName(repoName, finalSlug);
    await createSession(sessionName, worktreePath);
    await setSessionWorkdir(sessionName, worktreePath);

    // 8. attach
    attachSession(sessionName, worktreePath);

    // 9. 성공 메시지
    vscode.window.showInformationMessage(`Created task: ${finalSlug}`);

    // 10. TreeView 갱신 (refresh 명령 호출)
    vscode.commands.executeCommand('tmux.refresh');

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to create task: ${message}`);
  }
}
