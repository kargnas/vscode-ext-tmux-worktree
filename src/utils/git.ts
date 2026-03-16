import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';
import { exec } from './exec';
import { buildSessionName, sanitizeSessionName } from './tmux';
import { toCanonicalPath } from './path';
import { shellQuote } from './shell';

export interface Worktree {
  path: string;
  branch: string;
  isMain: boolean;
}

export function validateBranchName(branchName: string): string | undefined {
  const trimmedBranch = branchName.trim();

  if (!trimmedBranch) {
    return 'Branch name is required.';
  }
  if (/\s/.test(trimmedBranch)) {
    return 'Branch names cannot contain whitespace.';
  }
  if (trimmedBranch === '@') {
    return 'Branch name "@" is not allowed.';
  }
  if (trimmedBranch.startsWith('-')) {
    return 'Branch names cannot start with "-".';
  }
  if (trimmedBranch.startsWith('/') || trimmedBranch.endsWith('/')) {
    return 'Branch names cannot start or end with "/".';
  }
  if (trimmedBranch.endsWith('.')) {
    return 'Branch names cannot end with ".".';
  }
  if (trimmedBranch.endsWith('.lock')) {
    return 'Branch names cannot end with ".lock".';
  }
  if (trimmedBranch.includes('..')) {
    return 'Branch names cannot contain "..".';
  }
  if (trimmedBranch.includes('//')) {
    return 'Branch names cannot contain "//".';
  }
  if (trimmedBranch.includes('@{')) {
    return 'Branch names cannot contain "@{".';
  }
  if (/[~^:?*\\]/.test(trimmedBranch) || trimmedBranch.includes('[')) {
    return 'Branch names contain invalid characters.';
  }
  if (Array.from(trimmedBranch).some(char => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  })) {
    return 'Branch names cannot contain control characters.';
  }

  return undefined;
}

export function branchNameToSlug(branchName: string): string {
  return sanitizeSessionName(branchName.trim());
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
    const activePath = toCanonicalPath(activeUri.fsPath) || path.resolve(activeUri.fsPath);
    const matchingFolder = workspaceFolders.find(f => {
      const folderPath = toCanonicalPath(f.uri.fsPath) || path.resolve(f.uri.fsPath);
      return activePath === folderPath || activePath.startsWith(`${folderPath}${path.sep}`);
    });
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

export function getRepoSessionNamespace(repoRoot: string): string {
  const canonicalRoot = toCanonicalPath(repoRoot) || path.resolve(repoRoot);
  const repoName = sanitizeSessionName(path.basename(canonicalRoot) || 'repo');
  const rootHash = createHash('sha1').update(canonicalRoot).digest('hex').slice(0, 8);
  return `${repoName}-${rootHash}`;
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

export async function localBranchExists(repoRoot: string, branchName: string): Promise<boolean> {
  try {
    const output = await exec("git for-each-ref --format='%(refname:short)' refs/heads", { cwd: repoRoot });
    return output.split('\n').some(line => line.trim() === branchName);
  } catch {
    return false;
  }
}
export function getManagedWorktreesRoot(): string {
  return path.join(os.homedir(), '.tmux-worktrees');
}

export function getManagedRepoWorktreesDir(repoRoot: string): string {
  return path.join(getManagedWorktreesRoot(), getRepoSessionNamespace(repoRoot));
}

export function isManagedWorktreePath(repoRoot: string, worktreePath: string): boolean {
  const managedDir = toCanonicalPath(getManagedRepoWorktreesDir(repoRoot));
  const candidatePath = toCanonicalPath(worktreePath);
  if (!managedDir || !candidatePath) return false;
  return candidatePath === managedDir || candidatePath.startsWith(`${managedDir}${path.sep}`);
}

// Ensure the managed worktree directory exists.
export async function ensureWorktreesDir(repoRoot: string): Promise<string> {
  const worktreesDir = getManagedRepoWorktreesDir(repoRoot);
  if (!fs.existsSync(worktreesDir)) {
    await fs.promises.mkdir(worktreesDir, { recursive: true });
  }
  return worktreesDir;
}

async function getMainWorktreePath(repoRoot: string): Promise<string> {
  try {
    // Use the shared git dir to find the primary worktree, not the current one.
    const commonDirRaw = await exec('git rev-parse --git-common-dir', { cwd: repoRoot });
    const commonDir = commonDirRaw.trim();
    if (!commonDir) return repoRoot;

    const resolvedCommonDir = path.isAbsolute(commonDir)
      ? commonDir
      : path.resolve(repoRoot, commonDir);

    return path.dirname(resolvedCommonDir);
  } catch {
    return repoRoot;
  }
}

// worktree 목록 조회 (prunable 제외)
export async function listWorktrees(repoRoot: string): Promise<Worktree[]> {
  try {
    const output = await exec('git worktree list --porcelain', { cwd: repoRoot });
    const worktrees: Worktree[] = [];
    const blocks = output.split('\n\n').filter(b => b.trim());
    const mainWorktreePath = await getMainWorktreePath(repoRoot);
    const normalizedMainWorktreePath = toCanonicalPath(mainWorktreePath) || path.resolve(mainWorktreePath);
    
    for (const block of blocks) {
      const lines = block.split('\n');
      let wtPath = '';
      let branch = '';
      let isPrunable = false;
      
      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          wtPath = line.substring(9);
        } else if (line.startsWith('branch ')) {
          const ref = line.substring(7);
          if (ref.startsWith('refs/heads/')) {
            branch = ref.substring('refs/heads/'.length);
          } else if (ref.startsWith('refs/remotes/')) {
            branch = ref.substring('refs/remotes/'.length);
          } else {
            branch = ref;
          }
        } else if (line === 'prunable') {
          isPrunable = true;
        }
      }
      
      if (wtPath && !isPrunable) {
        const normalizedPath = toCanonicalPath(wtPath) || path.resolve(wtPath);
        worktrees.push({
          path: wtPath,
          branch,
          // Root worktree is defined by path equality, not branch naming.
          // External worktrees (e.g. Codex) often reuse repo names or branches.
          isMain: normalizedPath === normalizedMainWorktreePath
        });
      }
    }
    
    return worktrees;
  } catch {
    return [];
  }
}

export async function getWorktreeBranch(repoRoot: string, worktreePath: string): Promise<string | undefined> {
  const normalizedCandidatePath = toCanonicalPath(worktreePath) || path.resolve(worktreePath);
  const worktrees = await listWorktrees(repoRoot);
  return worktrees.find(worktree => {
    const normalizedPath = toCanonicalPath(worktree.path) || path.resolve(worktree.path);
    return normalizedPath === normalizedCandidatePath;
  })?.branch;
}

// slug 충돌 확인 (extension-managed worktree path + tmux session)
export async function isSlugTaken(slug: string, repoSessionNamespace: string, repoRoot: string): Promise<boolean> {
  const worktreesDir = await ensureWorktreesDir(repoRoot);
  const candidatePath = path.join(worktreesDir, slug);
  const normalizedCandidatePath = toCanonicalPath(candidatePath) || path.resolve(candidatePath);

  // 1. Existing worktree path, reserved primary slug, or leftover directory
  const worktrees = await listWorktrees(repoRoot);
  const worktreePathExists = worktrees.some(worktree => {
    const normalizedPath = toCanonicalPath(worktree.path) || path.resolve(worktree.path);
    return normalizedPath === normalizedCandidatePath;
  });
  const reservedPrimarySlug = sanitizeSessionName(slug) === sanitizeSessionName('main') &&
    worktrees.some(worktree => worktree.isMain);
  if (worktreePathExists || reservedPrimarySlug || fs.existsSync(candidatePath)) return true;

  // 2. tmux 세션에서 확인
  try {
    const sessions = await exec("tmux list-sessions -F '#{session_name}'");
    const sessionName = buildSessionName(repoSessionNamespace, slug);
    return sessions.split('\n').some(s => s.trim() === sessionName);
  } catch {
    // tmux 서버 없으면 세션 충돌 없음
    return false;
  }
}

// worktree 생성
export async function addWorktree(
  repoRoot: string,
  branchName: string,
  slug: string,
  baseBranch: string
): Promise<string> {
  const worktreesDir = await ensureWorktreesDir(repoRoot);
  const worktreePath = path.join(worktreesDir, slug);

  await exec(
    `git worktree add ${shellQuote(worktreePath)} -b ${shellQuote(branchName)} ${shellQuote(baseBranch)}`,
    { cwd: repoRoot }
  );

  // 원격에 브랜치가 없어도 upstream 설정 (push 시 자동으로 같은 이름 브랜치로 push되도록)
  await exec(`git config ${shellQuote(`branch.${branchName}.remote`)} origin`, { cwd: repoRoot });
  await exec(
    `git config ${shellQuote(`branch.${branchName}.merge`)} ${shellQuote(`refs/heads/${branchName}`)}`,
    { cwd: repoRoot }
  );

  return worktreePath;
}

// worktree 삭제
export async function removeWorktree(repoRoot: string, worktreePath: string): Promise<void> {
  await exec(`git worktree remove "${worktreePath}" --force`, { cwd: repoRoot });
}
