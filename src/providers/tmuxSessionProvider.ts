import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from '../utils/exec';
import { getRepoRoot, getRepoName, listWorktrees, Worktree } from '../utils/git';
import { listSessions, getSessionWorkdir, TmuxSession } from '../utils/tmux';

// ============================================
// Type Definitions
// ============================================

export type Classification = 'attached' | 'alive' | 'idle' | 'orphan';
export type FilterType = 'all' | 'attached' | 'alive' | 'idle' | 'orphans';

export interface SessionStatus {
  attached: boolean;
  panes: number;
  lastActive: number;  // UNIX epoch seconds
  gitDirty: boolean;
  classification: Classification;
}

export interface OrphanCheck {
  tmuxOnly: TmuxSession[];     // tmux 세션은 있지만 worktree 없음
  worktreeOnly: string[];       // worktree는 있지만 tmux 세션 없음
}

interface SessionWithStatus extends TmuxSession {
  status: SessionStatus;
  worktreePath?: string;
  slug: string;
}

// ============================================
// Helper Functions
// ============================================

/**
 * 세션의 마지막 활성 시간을 사람이 읽기 좋은 형식으로 변환
 * now / Xm ago / Xh ago / 날짜
 */
export function formatLastActive(sessionActivity: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diffSec = now - sessionActivity;
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  return new Date(sessionActivity * 1000).toLocaleDateString();
}

/**
 * 세션의 상태 정보를 조회
 */
async function getSessionStatus(sessionName: string, worktreePath?: string): Promise<SessionStatus> {
  let attached = false;
  let lastActive = 0;
  let panes = 1;
  let gitDirty = false;

  // tmux에서 attached와 lastActive 조회
  try {
    const output = await exec(`tmux display-message -p -t "${sessionName}" '#{session_attached}\t#{session_activity}'`);
    const [attachedStr, activityStr] = output.split('\t');
    attached = attachedStr === '1';
    lastActive = parseInt(activityStr, 10) || 0;
  } catch {
    // 세션이 없거나 조회 실패
  }

  // pane 개수 조회
  try {
    const panesOutput = await exec(`tmux list-panes -t "${sessionName}"`);
    panes = panesOutput.split('\n').filter(l => l.trim()).length || 1;
  } catch {
    // 조회 실패시 기본값 1
  }

  // git dirty 상태 조회
  if (worktreePath && fs.existsSync(worktreePath)) {
    try {
      const gitStatus = await exec(`git -C "${worktreePath}" status --porcelain`);
      gitDirty = gitStatus.length > 0;
    } catch {
      // git 조회 실패
    }
  }

  // Classification 결정
  // alive 판단 기준: 10분 = 600초
  const now = Math.floor(Date.now() / 1000);
  let classification: Classification;
  
  if (attached) {
    classification = 'attached';
  } else if (now - lastActive < 600) {
    classification = 'alive';
  } else {
    classification = 'idle';
  }
  // orphan은 detectOrphans에서 별도 처리

  return { attached, panes, lastActive, gitDirty, classification };
}

/**
 * Orphan 세션 및 worktree 탐지
 * - tmuxOnly: @workdir 경로가 존재하지 않는 세션
 * - worktreeOnly: .worktrees/ 하위인데 매칭 세션 없음
 */
async function detectOrphans(
  sessions: TmuxSession[],
  worktrees: Worktree[],
  repoName: string
): Promise<OrphanCheck> {
  const tmuxOnly: TmuxSession[] = [];
  const worktreeOnly: string[] = [];

  // 1. tmuxOnly: @workdir 경로가 존재하지 않는 세션
  for (const session of sessions) {
    if (session.workdir && !fs.existsSync(session.workdir)) {
      tmuxOnly.push(session);
    }
  }

  // 2. worktreeOnly: .worktrees/ 하위인데 매칭 세션 없음
  // worktree의 경로에서 slug 추출하여 세션 매칭 확인
  const sessionNames = new Set(sessions.map(s => s.name));
  
  for (const wt of worktrees) {
    // .worktrees/ 하위인지 확인
    if (wt.path.includes('/.worktrees/')) {
      const slug = path.basename(wt.path);
      const expectedSessionName = `${repoName}_${slug}`;
      if (!sessionNames.has(expectedSessionName)) {
        worktreeOnly.push(wt.path);
      }
    }
  }

  return { tmuxOnly, worktreeOnly };
}

/**
 * Classification에 따른 정렬 우선순위 반환
 * Attached(1) → Alive(2) → Idle(3) → Orphan(4)
 */
function getClassificationOrder(classification: Classification): number {
  switch (classification) {
    case 'attached': return 1;
    case 'alive': return 2;
    case 'idle': return 3;
    case 'orphan': return 4;
    default: return 5;
  }
}

// ============================================
// TreeItem Classes
// ============================================

export class TmuxItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly repoName?: string,
    public readonly sessionName?: string
  ) {
    super(label, collapsibleState);
  }
}

export class RepoGroupItem extends TmuxItem {
  constructor(
    public readonly repoName: string,
    public readonly repoRoot: string
  ) {
    super(repoName, vscode.TreeItemCollapsibleState.Expanded, repoName);
    this.contextValue = 'repoGroup';
    this.iconPath = new vscode.ThemeIcon('repo');
  }
}

export class TmuxSessionItem extends TmuxItem {
  constructor(
    public readonly session: SessionWithStatus,
    public readonly repoName: string
  ) {
    super(session.slug, vscode.TreeItemCollapsibleState.None, repoName, session.name);
    this.contextValue = 'tmuxSession';

    // 아이콘 설정
    this.iconPath = this.getIcon();

    // Description: panes, lastActive, dirty, orphan 표시
    const parts: string[] = [];
    parts.push(`${session.status.panes}p`);
    parts.push(formatLastActive(session.status.lastActive));
    if (session.status.gitDirty) {
      parts.push('●');  // dirty 표시
    }
    if (session.status.classification === 'orphan') {
      parts.push('⚠ orphan');
    }
    this.description = parts.join(' ');

    // Tooltip: Markdown으로 상세 정보
    const tooltipMd = new vscode.MarkdownString();
    tooltipMd.appendMarkdown(`### ${session.name}\n\n`);
    tooltipMd.appendMarkdown(`- **Status**: ${session.status.classification}\n`);
    tooltipMd.appendMarkdown(`- **Attached**: ${session.status.attached ? 'Yes' : 'No'}\n`);
    tooltipMd.appendMarkdown(`- **Panes**: ${session.status.panes}\n`);
    tooltipMd.appendMarkdown(`- **Last Active**: ${formatLastActive(session.status.lastActive)}\n`);
    tooltipMd.appendMarkdown(`- **Git Dirty**: ${session.status.gitDirty ? 'Yes' : 'No'}\n`);
    if (session.worktreePath) {
      tooltipMd.appendMarkdown(`- **Path**: \`${session.worktreePath}\`\n`);
    }
    this.tooltip = tooltipMd;
  }

  private getIcon(): vscode.ThemeIcon {
    switch (this.session.status.classification) {
      case 'orphan':
        return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
      case 'attached':
        return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'));
      case 'alive':
        return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.blue'));
      case 'idle':
      default:
        return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('descriptionForeground'));
    }
  }
}

export class OrphanWorktreeItem extends TmuxItem {
  constructor(
    public readonly worktreePath: string,
    public readonly repoName: string
  ) {
    const slug = path.basename(worktreePath);
    super(`[No Session] ${slug}`, vscode.TreeItemCollapsibleState.None, repoName);
    this.contextValue = 'orphanWorktree';
    this.description = '⚠ worktree only';
    this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.orange'));

    // Tooltip
    const tooltipMd = new vscode.MarkdownString();
    tooltipMd.appendMarkdown(`### Orphan Worktree\n\n`);
    tooltipMd.appendMarkdown(`No tmux session found for this worktree.\n\n`);
    tooltipMd.appendMarkdown(`- **Path**: \`${worktreePath}\`\n`);
    this.tooltip = tooltipMd;
  }
}

// ============================================
// TreeDataProvider
// ============================================

export class TmuxSessionProvider implements vscode.TreeDataProvider<TmuxItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TmuxItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _filter: FilterType = 'all';

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  setFilter(filter: string): void {
    this._filter = filter as FilterType;
  }

  getFilter(): FilterType {
    return this._filter;
  }

  getTreeItem(element: TmuxItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TmuxItem): Promise<TmuxItem[]> {
    // element가 없으면 → repo 그룹 반환
    if (!element) {
      return this.getRepoGroups();
    }

    // RepoGroupItem이면 → 해당 repo의 세션들 반환
    if (element instanceof RepoGroupItem) {
      return this.getSessionsForRepo(element.repoName, element.repoRoot);
    }

    return [];
  }

  /**
   * 현재 워크스페이스의 repo 그룹 목록 반환
   */
  private async getRepoGroups(): Promise<RepoGroupItem[]> {
    try {
      const repoRoot = getRepoRoot();
      const repoName = getRepoName(repoRoot);
      return [new RepoGroupItem(repoName, repoRoot)];
    } catch {
      // 워크스페이스가 없으면 빈 목록
      return [];
    }
  }

  /**
   * 특정 repo에 속한 세션 목록 반환
   */
  private async getSessionsForRepo(repoName: string, repoRoot: string): Promise<TmuxItem[]> {
    const items: TmuxItem[] = [];

    // 1. 모든 tmux 세션 조회
    const allSessions = await listSessions();

    // 2. 해당 repo에 속한 세션만 필터링 (repoName_ 패턴)
    const repoPrefix = `${repoName}_`;
    const repoSessions = allSessions.filter(s => s.name.startsWith(repoPrefix));

    // 3. 각 세션의 workdir 조회
    for (const session of repoSessions) {
      session.workdir = await getSessionWorkdir(session.name);
    }

    // 4. worktree 목록 조회
    const worktrees = await listWorktrees(repoRoot);

    // 5. Orphan 탐지
    const orphans = await detectOrphans(repoSessions, worktrees, repoName);

    // 6. 세션에 상태 정보 추가
    const sessionsWithStatus: SessionWithStatus[] = [];
    
    for (const session of repoSessions) {
      const slug = session.name.substring(repoPrefix.length);
      const status = await getSessionStatus(session.name, session.workdir);
      
      // orphan 여부 확인 (tmuxOnly에 포함되어 있으면 orphan)
      if (orphans.tmuxOnly.some(o => o.name === session.name)) {
        status.classification = 'orphan';
      }

      sessionsWithStatus.push({
        ...session,
        status,
        worktreePath: session.workdir,
        slug
      });
    }

    // 7. 정렬: Classification 우선, 같은 분류 내 lastActive 최신순
    sessionsWithStatus.sort((a, b) => {
      const orderDiff = getClassificationOrder(a.status.classification) - getClassificationOrder(b.status.classification);
      if (orderDiff !== 0) return orderDiff;
      return b.status.lastActive - a.status.lastActive;
    });

    // 8. 필터 적용
    const filteredSessions = sessionsWithStatus.filter(s => {
      switch (this._filter) {
        case 'attached':
          return s.status.classification === 'attached';
        case 'alive':
          return s.status.classification === 'alive';
        case 'idle':
          return s.status.classification === 'idle';
        case 'orphans':
          return s.status.classification === 'orphan';
        case 'all':
        default:
          return true;
      }
    });

    // 9. TreeItem 생성
    for (const session of filteredSessions) {
      items.push(new TmuxSessionItem(session, repoName));
    }

    // 10. worktreeOnly orphan 추가 (orphans 필터일 때만 또는 all)
    if (this._filter === 'all' || this._filter === 'orphans') {
      for (const wtPath of orphans.worktreeOnly) {
        items.push(new OrphanWorktreeItem(wtPath, repoName));
      }
    }

    return items;
  }
}
