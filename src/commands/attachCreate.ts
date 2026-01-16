import * as vscode from 'vscode';
import { getRepoRoot } from '../utils/git';
import { isTmuxInstalled, listSessions, getSessionWorkdir, attachSession } from '../utils/tmux';

// 현재 워크스페이스와 매칭되는 세션 찾기
async function findSessionsForWorkspace(repoRoot: string): Promise<string[]> {
  const sessions = await listSessions();
  const matchingSessions: string[] = [];

  for (const session of sessions) {
    const workdir = await getSessionWorkdir(session.name);
    // @workdir가 현재 워크스페이스 루트 하위인지 확인
    // (worktree는 .worktrees/<slug> 아래에 있음)
    if (workdir && workdir.startsWith(repoRoot)) {
      matchingSessions.push(session.name);
    }
  }

  return matchingSessions;
}

export async function attachCreate(): Promise<void> {
  // 0. tmux 설치 확인
  if (!await isTmuxInstalled()) {
    vscode.window.showErrorMessage('tmux not found. Install: `brew install tmux`');
    return;
  }

  try {
    // 1. repoRoot 결정
    const repoRoot = getRepoRoot();

    // 2. 매칭되는 세션 찾기
    const matchingSessions = await findSessionsForWorkspace(repoRoot);

    if (matchingSessions.length > 0) {
      // 3. 기존 세션 있음 → 각각 attach
      for (const session of matchingSessions) {
        const workdir = await getSessionWorkdir(session);
        attachSession(session, workdir);
      }
      vscode.window.showInformationMessage(`Attached to ${matchingSessions.length} session(s)`);
    } else {
      // 4. 기존 세션 없음 → 확인 후 New Task 실행
      const choice = await vscode.window.showInformationMessage(
        'No existing tmux session found for this workspace. Create a new task?',
        'Create New Task', 'Cancel'
      );
      if (choice === 'Create New Task') {
        vscode.commands.executeCommand('tmux.newTask');
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to attach/create: ${message}`);
  }
}
