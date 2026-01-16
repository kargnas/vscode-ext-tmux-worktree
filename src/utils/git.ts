export interface Worktree {
  path: string;
  branch: string;
  isMain: boolean;
}

export async function listWorktrees(_repoPath: string): Promise<Worktree[]> {
  // TODO: git worktree list 실행
  return [];
}

export async function addWorktree(_repoPath: string, _branch: string, _path: string): Promise<void> {
  // TODO: git worktree add 실행
}

export async function removeWorktree(_repoPath: string, _path: string): Promise<void> {
  // TODO: git worktree remove 실행
}

export function getRepoName(_path: string): string {
  // TODO: 경로에서 repo 이름 추출
  return '';
}
