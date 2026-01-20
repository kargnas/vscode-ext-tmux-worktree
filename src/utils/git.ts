import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from './exec';

export interface Worktree {
  path: string;
  branch: string;
  isMain: boolean;
}

// 모든 Task에서 사용하는 repoRoot 선정 규칙
export function getRepoRoot(): string {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error('No workspace folder open.');
  }
  
  // 멀티루트: 현재 활성 편집기의 폴더 사용
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor && workspaceFolders.length > 1) {
    const activeUri = activeEditor.document.uri;
    const matchingFolder = workspaceFolders.find(f => 
      activeUri.fsPath.startsWith(f.uri.fsPath)
    );
    if (matchingFolder) {
      return matchingFolder.uri.fsPath;
    }
  }
  
  // 기본: 첫 번째 폴더
  return workspaceFolders[0].uri.fsPath;
}

export function getRepoName(repoRoot: string): string {
  return path.basename(repoRoot);
}

// origin/main 존재 여부 확인 후 기준 브랜치 결정
export async function getBaseBranch(repoRoot: string): Promise<string> {
  try {
    await exec('git rev-parse --verify origin/main', { cwd: repoRoot });
    return 'origin/main';
  } catch {
    try {
      await exec('git rev-parse --verify main', { cwd: repoRoot });
      return 'main';
    } catch {
      throw new Error('No main branch found (origin/main or main)');
    }
  }
}

// .worktrees 디렉터리 확보
export async function ensureWorktreesDir(repoRoot: string): Promise<string> {
  const worktreesDir = path.join(repoRoot, '.worktrees');
  if (!fs.existsSync(worktreesDir)) {
    await fs.promises.mkdir(worktreesDir, { recursive: true });
  }
  return worktreesDir;
}

// worktree 목록 조회 (prunable 제외)
export async function listWorktrees(repoRoot: string): Promise<Worktree[]> {
  try {
    const output = await exec('git worktree list --porcelain', { cwd: repoRoot });
    const worktrees: Worktree[] = [];
    const blocks = output.split('\n\n').filter(b => b.trim());
    
    for (const block of blocks) {
      const lines = block.split('\n');
      let wtPath = '';
      let branch = '';
      let isPrunable = false;
      
      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          wtPath = line.substring(9);
        } else if (line.startsWith('branch refs/heads/')) {
          branch = line.substring(18);
        } else if (line === 'prunable') {
          isPrunable = true;
        }
      }
      
      if (wtPath && !isPrunable) {
        worktrees.push({
          path: wtPath,
          branch,
          isMain: !branch.startsWith('task/')
        });
      }
    }
    
    return worktrees;
  } catch {
    return [];
  }
}

// slug 충돌 확인 (worktree + tmux 세션 모두 확인)
export async function isSlugTaken(slug: string, repoName: string, repoRoot: string): Promise<boolean> {
  // 1. git worktree에서 branch 확인
  const worktrees = await listWorktrees(repoRoot);
  const branchExists = worktrees.some(w => w.branch === `task/${slug}`);
  if (branchExists) return true;
  
  // 2. tmux 세션에서 확인
  try {
    const sessions = await exec("tmux list-sessions -F '#{session_name}'");
    const sessionName = `${repoName}_${slug}`;
    return sessions.split('\n').some(s => s.trim() === sessionName);
  } catch {
    // tmux 서버 없으면 세션 충돌 없음
    return false;
  }
}

// worktree 생성
export async function addWorktree(repoRoot: string, slug: string, baseBranch: string): Promise<string> {
  const worktreesDir = await ensureWorktreesDir(repoRoot);
  const worktreePath = path.join(worktreesDir, slug);
  const branchName = `task/${slug}`;
  
  await exec(`git worktree add "${worktreePath}" -b ${branchName} ${baseBranch}`, { cwd: repoRoot });
  
  // 원격에 브랜치가 없어도 upstream 설정 (push 시 자동으로 같은 이름 브랜치로 push되도록)
  await exec(`git config branch.${branchName}.remote origin`, { cwd: repoRoot });
  await exec(`git config branch.${branchName}.merge refs/heads/${branchName}`, { cwd: repoRoot });
  
  return worktreePath;
}

// worktree 삭제
export async function removeWorktree(repoRoot: string, worktreePath: string): Promise<void> {
  await exec(`git worktree remove "${worktreePath}" --force`, { cwd: repoRoot });
}
