import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from '../utils/exec';
import { getRepoRoot, getRepoName, listWorktrees, Worktree } from '../utils/git';
import { listSessions, getSessionWorkdir, TmuxSession, buildSessionName, sanitizeSessionName } from '../utils/tmux';

export type Classification = 'attached' | 'alive' | 'idle' | 'stopped' | 'orphan';
export type FilterType = 'all' | 'attached' | 'alive' | 'idle' | 'stopped' | 'orphans';

export interface SessionStatus {
  attached: boolean;
  panes: number;
  lastActive: number;
  gitDirty: number;
  gitModified: number;
  gitAdded: number;
  gitDeleted: number;
  classification: Classification;
}

interface SessionWithStatus extends TmuxSession {
  status: SessionStatus;
  worktreePath?: string;
  slug: string;
}

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

export function formatLastActive(sessionActivity: number): string {
  if (sessionActivity === 0) return '-';
  const now = Math.floor(Date.now() / 1000);
  const diffSec = now - sessionActivity;
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  return new Date(sessionActivity * 1000).toLocaleDateString();
}

async function getSessionStatus(sessionName: string, worktreePath?: string): Promise<SessionStatus> {
  let attached = false;
  let lastActive = 0;
  let panes = 1;
  let gitDirty = 0;
  let gitModified = 0;
  let gitAdded = 0;
  let gitDeleted = 0;

  try {
    const output = await exec(`tmux display-message -p -t "${sessionName}" '#{session_attached}|||#{session_activity}'`);
    const [attachedStr, activityStr] = output.split('|||');
    attached = attachedStr === '1';
    lastActive = parseInt(activityStr, 10) || 0;
  } catch {
  }

  try {
    const panesOutput = await exec(`tmux list-panes -t "${sessionName}"`);
    panes = panesOutput.split('\n').filter(l => l.trim()).length || 1;
  } catch {
  }

  if (worktreePath && fs.existsSync(worktreePath)) {
    try {
      const gitStatusOutput = await exec(`git -C "${worktreePath}" status --porcelain`);
      const lines = gitStatusOutput.split('\n').filter(line => line.trim().length > 0);
      gitDirty = lines.length;
      
      for (const line of lines) {
        const code = line.substring(0, 2);
        if (code.includes('M')) gitModified++;
        else if (code.includes('A') || code.includes('?')) gitAdded++;
        else if (code.includes('D')) gitDeleted++;
      }
    } catch {
    }
  }

  const now = Math.floor(Date.now() / 1000);
  let classification: Classification;
  
  if (attached) {
    classification = 'attached';
  } else if (now - lastActive < 600) {
    classification = 'alive';
  } else {
    classification = 'idle';
  }

  return { attached, panes, lastActive, gitDirty, gitModified, gitAdded, gitDeleted, classification };
}

// removed TmuxItem definition
export class GitStatusItem extends TmuxItem {
    constructor(status: SessionStatus) {
        const parts: string[] = [];
        if (status.gitModified > 0) parts.push(`M:${status.gitModified}`);
        if (status.gitAdded > 0) parts.push(`A:${status.gitAdded}`);
        if (status.gitDeleted > 0) parts.push(`D:${status.gitDeleted}`);
        
        const label = parts.join(' ');
        super(label, vscode.TreeItemCollapsibleState.None);
        
        this.contextValue = 'gitStatus';
        this.iconPath = new vscode.ThemeIcon('git-merge');
    }
}
function getClassificationOrder(classification: Classification): number {
  switch (classification) {
    case 'attached': return 1;
    case 'alive': return 2;
    case 'idle': return 3;
    case 'stopped': return 4;
    case 'orphan': return 5;
    default: return 6;
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
  public readonly detailItem: TmuxSessionDetailItem;
  public readonly gitStatusItem?: GitStatusItem;
  
  constructor(
    public readonly session: SessionWithStatus,
    public readonly repoName: string,
    public readonly worktree?: Worktree,
    labelOverride?: string 
  ) {
    let label = labelOverride || session.slug;
    let isRoot = false;
    
    if (!label || label === repoName) {
        label = '(root)';
        isRoot = true;
    } else if (session.worktreePath && label === path.basename(session.worktreePath)) {
        if (label === repoName) {
            label = '(root)';
            isRoot = true;
        }
    }
    
    if (worktree?.isMain && !worktree.path.includes('.worktrees')) {
        label = '(root)';
        isRoot = true;
    }
    
    super(label, vscode.TreeItemCollapsibleState.Expanded, repoName, session.name);
    this.contextValue = 'tmuxSessionWrapper';
    this.iconPath = this.getIcon();
    
    this.detailItem = new TmuxSessionDetailItem(session, repoName, worktree, isRoot);
    
    if (session.status.gitDirty > 0) {
        this.gitStatusItem = new GitStatusItem(session.status);
    }
    
    this.tooltip = this.buildTooltip();
  }

  private getIcon(): vscode.ThemeIcon {
    switch (this.session.status.classification) {
      case 'orphan': return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
      case 'attached': return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'));
      case 'alive': return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.blue'));
      case 'idle': 
      default: return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('descriptionForeground'));
    }
  }

  private buildTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`### ${this.session.name}\n\n`);
    md.appendMarkdown(`- **Status**: ${this.session.status.classification}\n`);
    md.appendMarkdown(`- **Git Changes**: ${this.session.status.gitDirty} files\n`);
    if (this.session.worktreePath) md.appendMarkdown(`- **Path**: \`${this.session.worktreePath}\`\n`);
    return md;
  }
}

export class TmuxSessionDetailItem extends TmuxItem {
  constructor(
    public readonly session: SessionWithStatus,
    public readonly repoName: string,
    public readonly worktree?: Worktree,
    isRoot?: boolean
  ) {
    const branch = worktree?.branch || (isRoot ? 'main' : session.slug);
    const parts: string[] = [branch];
    
    if (session.status.classification !== 'orphan') {
        parts.push(`${session.status.panes}p`);
        parts.push(formatLastActive(session.status.lastActive));
    }
    
    if (session.status.classification === 'orphan') parts.push('⚠ orphan');
    
    super(parts.join(' · '), vscode.TreeItemCollapsibleState.None, repoName, session.name);
    this.contextValue = isRoot ? 'tmuxSessionRoot' : 'tmuxSession';
    this.iconPath = new vscode.ThemeIcon('symbol-constant');
    
    this.command = {
        command: 'tmux.attachCreate',
        title: 'Attach Session',
        arguments: [this]
    };
  }
}

export class TmuxWorktreeGroupItem extends TmuxItem {
    public readonly children: TmuxSessionDetailItem[];

    constructor(
        label: string,
        repoName: string,
        sessions: SessionWithStatus[],
        worktree?: Worktree
    ) {
        super(label, vscode.TreeItemCollapsibleState.Expanded, repoName);
        this.contextValue = 'tmuxGroup';
        this.iconPath = new vscode.ThemeIcon('folder-active');
        
        this.children = sessions.map(s => {
            return new TmuxSessionDetailItem(s, repoName, worktree); 
        });

        this.description = `${sessions.length} sessions`;
        
        if (worktree) {
            this.tooltip = new vscode.MarkdownString(`### ${label}\n\nPath: \`${worktree.path}\``);
        }
    }
}

export class InactiveWorktreeItem extends TmuxItem {
  public readonly detailItem: InactiveWorktreeDetailItem;
  
  constructor(
    public readonly worktree: Worktree,
    public readonly repoName: string,
    public readonly targetSessionName: string
  ) {
    let slug = path.basename(worktree.path);
    let isRoot = false;
    
    if (worktree.isMain && !worktree.path.includes('.worktrees')) {
        slug = '(root)';
        isRoot = true;
    } else if (slug === repoName) {
        slug = '(root)';
        isRoot = true;
    }

    super(slug, vscode.TreeItemCollapsibleState.Expanded, repoName, targetSessionName);
    
    this.contextValue = 'tmuxSessionWrapper'; 
    this.iconPath = new vscode.ThemeIcon('primitive-dot', new vscode.ThemeColor('disabledForeground'));
    
    this.detailItem = new InactiveWorktreeDetailItem(worktree, repoName, targetSessionName, isRoot);

    const md = new vscode.MarkdownString();
    md.appendMarkdown(`### ${slug} (Stopped)\n\n`);
    md.appendMarkdown(`Click to launch tmux session.\n\n`);
    md.appendMarkdown(`- **Path**: \`${worktree.path}\`\n`);
    this.tooltip = md;
  }
}

export class InactiveWorktreeDetailItem extends TmuxItem {
  constructor(
    public readonly worktree: Worktree,
    public readonly repoName: string,
    public readonly targetSessionName: string,
    isRoot?: boolean
  ) {
    const branch = worktree.branch || (isRoot ? 'main' : path.basename(worktree.path));
    const label = `${branch} · stopped`;
    
    super(label, vscode.TreeItemCollapsibleState.None, repoName, targetSessionName);
    this.contextValue = isRoot ? 'tmuxSessionRoot' : 'tmuxSession';
    this.iconPath = new vscode.ThemeIcon('symbol-constant');
    
    this.command = {
        command: 'tmux.attachCreate',
        title: 'Launch Session',
        arguments: [this]
    };
  }
}

export class TmuxSessionProvider implements vscode.TreeDataProvider<TmuxItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TmuxItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private _filter: FilterType = 'all';
  private _error: string | undefined;

  refresh(): void { this._onDidChangeTreeData.fire(undefined); }
  setFilter(filter: string): void { this._filter = filter as FilterType; }
  getFilter(): FilterType { return this._filter; }
  getTreeItem(element: TmuxItem): vscode.TreeItem { return element; }

  async getChildren(element?: TmuxItem): Promise<TmuxItem[]> {
    if (!element) {
        if (this._error) {
            const errorItem = new TmuxItem(`Error: ${this._error}`, vscode.TreeItemCollapsibleState.None);
            errorItem.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
            return [errorItem];
        }
        return this.getRepoGroups();
    }
    
    if (element instanceof RepoGroupItem) {
        return this.getSessionsForRepo(element.repoName, element.repoRoot);
    }
    
    if (element instanceof TmuxWorktreeGroupItem) {
        return element.children;
    }
    
    if (element instanceof TmuxSessionItem) {
        const children: TmuxItem[] = [element.detailItem];
        if (element.gitStatusItem) {
            children.push(element.gitStatusItem);
        }
        return children;
    }
    
    if (element instanceof InactiveWorktreeItem) {
        return [element.detailItem];
    }

    return [];
  }

  private async getRepoGroups(): Promise<RepoGroupItem[]> {
    try {
      const repoRoot = getRepoRoot();
      const repoName = getRepoName(repoRoot);
      return [new RepoGroupItem(repoName, repoRoot)];
    } catch { return []; }
  }

  private async getSessionsForRepo(repoName: string, repoRoot: string): Promise<TmuxItem[]> {
    try {
        const [allSessions, worktrees] = await Promise.all([
            listSessions(),
            listWorktrees(repoRoot)
        ]);
        this._error = undefined; // 성공 시 에러 초기화

        const repoPrefix = `${sanitizeSessionName(repoName)}_`;
        const repoSessions = allSessions.filter(s => s.name.startsWith(repoPrefix));

        for (const s of repoSessions) s.workdir = await getSessionWorkdir(s.name);

        const pathMap = new Map<string, { worktree?: Worktree, sessions: SessionWithStatus[] }>();

        for (const wt of worktrees) {
            const normalizedPath = path.normalize(wt.path);
            pathMap.set(normalizedPath, { worktree: wt, sessions: [] });
        }

        for (const session of repoSessions) {
            const workdir = session.workdir ? path.normalize(session.workdir) : undefined;
            
            const status = await getSessionStatus(session.name, workdir);
            
            let entry = workdir ? pathMap.get(workdir) : undefined;
            
            if (!entry) {
                status.classification = 'orphan';
                entry = { sessions: [] };
                pathMap.set(workdir || `orphan:${session.name}`, entry);
            }

            const slug = session.name.substring(repoPrefix.length) || 'main';
            
            entry.sessions.push({
                ...session,
                status,
                worktreePath: workdir,
                slug
            });
        }

        const items: TmuxItem[] = [];

        for (const [pathKey, entry] of pathMap.entries()) {
            const { worktree, sessions } = entry;

            if (sessions.length === 0 && worktree) {
                let slug = path.basename(worktree.path);
                if (worktree.isMain && !worktree.path.includes('.worktrees')) {
                    slug = 'main';
                } else if (slug === repoName) {
                    slug = 'main';
                }
                const sessionName = buildSessionName(repoName, slug);
                items.push(new InactiveWorktreeItem(worktree, repoName, sessionName));
                continue;
            }

            if (sessions.length === 1) {
                items.push(new TmuxSessionItem(sessions[0], repoName, worktree));
                continue;
            }

            if (sessions.length > 1) {
                let label = 'Unknown';
                if (worktree) {
                    label = path.basename(worktree.path);
                    if (worktree.isMain && !worktree.path.includes('.worktrees')) label = '(root)';
                    else if (label === repoName) label = '(root)';
                } else {
                    label = sessions[0].slug; 
                    if (label === 'main') label = '(root)';
                }

                items.push(new TmuxWorktreeGroupItem(label, repoName, sessions, worktree));
            }
        }

        const pathToActiveSession = new Map<string, TmuxItem>();
        const pathToInactive = new Map<string, TmuxItem>();
        const otherItems: TmuxItem[] = [];

        for (const item of items) {
            let itemPath: string | undefined;
            
            if (item instanceof TmuxSessionItem) {
                itemPath = item.session.worktreePath;
            } else if (item instanceof InactiveWorktreeItem) {
                itemPath = item.worktree.path;
            } else if (item instanceof TmuxWorktreeGroupItem) {
                itemPath = item.children[0]?.session.worktreePath;
            }

            if (itemPath) {
                const normalizedPath = path.normalize(itemPath);
                
                if (item instanceof InactiveWorktreeItem) {
                    if (!pathToInactive.has(normalizedPath)) {
                        pathToInactive.set(normalizedPath, item);
                    }
                } else {
                    pathToActiveSession.set(normalizedPath, item);
                }
            } else {
                otherItems.push(item);
            }
        }

        const uniqueItems: TmuxItem[] = [...pathToActiveSession.values()];
        
        for (const [inactivePath, inactiveItem] of pathToInactive.entries()) {
            if (!pathToActiveSession.has(inactivePath)) {
                uniqueItems.push(inactiveItem);
            }
        }
        
        uniqueItems.push(...otherItems);

        return this.sortAndFilter(uniqueItems);
    } catch (err) {
        this._error = err instanceof Error ? err.message : String(err);
        return [];
    }
  }

  private sortAndFilter(items: TmuxItem[]): TmuxItem[] {
      items.sort((a, b) => {
          const scoreA = this.getScore(a);
          const scoreB = this.getScore(b);
          if (scoreA !== scoreB) return scoreA - scoreB;
          return a.label.localeCompare(b.label);
      });

      if (this._filter === 'all') return items;

      return items.filter(item => {
          if (item instanceof InactiveWorktreeItem) return this._filter === 'stopped';
          
          if (item instanceof TmuxSessionItem) {
              if (this._filter === 'orphans') return item.session.status.classification === 'orphan';
              return item.session.status.classification === this._filter;
          }

          if (item instanceof TmuxWorktreeGroupItem) {
              if (this._filter === 'stopped') return false;
              
              if (this._filter === 'orphans') {
                  return item.children.some(c => c.session.status.classification === 'orphan');
              }
              return item.children.some(c => c.session.status.classification === this._filter);
          }

          return true;
      });
  }

  private getScore(item: TmuxItem): number {
      if (item instanceof TmuxSessionItem) {
          return getClassificationOrder(item.session.status.classification);
      }
      if (item instanceof InactiveWorktreeItem) {
          return getClassificationOrder('stopped');
      }
      if (item instanceof TmuxWorktreeGroupItem) {
          const minScore = Math.min(...item.children.map(c => getClassificationOrder(c.session.status.classification)));
          return minScore;
      }
      return 10;
  }
}
