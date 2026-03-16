import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { exec } from '../utils/exec';
import { getRepoRoot, getRepoName, listWorktrees, Worktree } from '../utils/git';
import { listSessions, getSessionWorkdir, TmuxSession, buildSessionName, sanitizeSessionName } from '../utils/tmux';
import { toCanonicalPath } from '../utils/path';
import { createRepoSessionPrefixConfig, matchRepoSessionName } from '../utils/sessionCompatibility';

export type Classification = 'attached' | 'alive' | 'idle' | 'stopped' | 'orphan';
export type FilterType = 'all' | 'attached' | 'alive' | 'idle' | 'stopped' | 'orphans';
const NO_GIT_BRANCH_LABEL = 'current project (no git)';

export interface SessionStatus {
  attached: boolean;
  panes: number;
  lastActive: number;
  gitDirty: number;
  gitModified: number;
  gitAdded: number;
  gitDeleted: number;
  gitUntracked: number;
  classification: Classification;
  commitsAhead: number;
  cpuUsage: number;
}

interface SessionWithStatus extends TmuxSession {
  status: SessionStatus;
  worktreePath?: string;
  slug: string;
}

function isCurrentWorkspacePath(targetPath: string | undefined, activeWorkspacePath: string): boolean {
  const normalizedTarget = toCanonicalPath(targetPath);
  return Boolean(normalizedTarget && normalizedTarget === activeWorkspacePath);
}

function getDefaultWorktreeSlug(worktree: Worktree, repoName: string): string {
  if (worktree.isMain) return 'main';

  const baseName = path.basename(worktree.path);
  if (baseName !== repoName) return baseName;

  const parentName = path.basename(path.dirname(worktree.path));
  const grandParentName = path.basename(path.dirname(path.dirname(worktree.path)));
  if (parentName === '.worktrees' || grandParentName === '.tmux-worktrees') {
    return baseName;
  }

  // Keep session names unique when external worktrees reuse the repo directory name.
  if (parentName && parentName !== baseName) {
    return `${baseName}-${parentName}`;
  }

  return baseName;
}

function shortPathHash(targetPath: string): string {
  const canonicalPath = toCanonicalPath(targetPath) || path.resolve(targetPath);
  return createHash('sha1').update(canonicalPath).digest('hex').slice(0, 8);
}

function buildWorktreeSlugMap(worktrees: Worktree[], repoName: string): Map<string, string> {
  const slugByPath = new Map<string, string>();
  const usedSanitizedSlugs = new Set<string>();
  type Candidate = { worktree: Worktree; slug: string };
  const pending: Candidate[] = [];

  const rememberSlug = (slug: string): void => {
    usedSanitizedSlugs.add(sanitizeSessionName(slug));
  };

  for (const worktree of worktrees) {
    const normalizedPath = toCanonicalPath(worktree.path);
    if (!normalizedPath) continue;
    if (worktree.isMain) {
      slugByPath.set(normalizedPath, 'main');
      rememberSlug('main');
      continue;
    }
    pending.push({ worktree, slug: getDefaultWorktreeSlug(worktree, repoName) });
  }

  const applyCollisionResolver = (
    candidates: Candidate[],
    resolver: (candidate: Candidate) => string
  ): Candidate[] => {
    const groups = new Map<string, Candidate[]>();
    for (const candidate of candidates) {
      const key = sanitizeSessionName(candidate.slug);
      const grouped = groups.get(key);
      if (grouped) {
        grouped.push(candidate);
      } else {
        groups.set(key, [candidate]);
      }
    }

    const unresolved: Candidate[] = [];
    for (const [key, group] of groups.entries()) {
      if (group.length === 1 && !usedSanitizedSlugs.has(key)) {
        const only = group[0];
        const onlyPath = toCanonicalPath(only.worktree.path);
        if (onlyPath) {
          slugByPath.set(onlyPath, only.slug);
          rememberSlug(only.slug);
        }
        continue;
      }

      for (const candidate of group) {
        unresolved.push({
          worktree: candidate.worktree,
          slug: resolver(candidate)
        });
      }
    }

    return unresolved;
  };

  let unresolved = applyCollisionResolver(pending, (candidate) => {
    const parentName = path.basename(path.dirname(candidate.worktree.path));
    const parentSuffix = parentName || 'parent';
    return `${candidate.slug}-${parentSuffix}`;
  });

  unresolved = applyCollisionResolver(unresolved, (candidate) => {
    return `${candidate.slug}-${shortPathHash(candidate.worktree.path)}`;
  });

  // Extra safety for extremely unlikely hash collisions.
  for (let i = 0; i < unresolved.length; i++) {
    const candidate = unresolved[i];
    const normalizedPath = toCanonicalPath(candidate.worktree.path);
    if (!normalizedPath) continue;
    const strongHash = createHash('sha1')
      .update(normalizedPath)
      .digest('hex')
      .slice(0, 16);
    slugByPath.set(normalizedPath, `${candidate.slug}-${strongHash}-${i + 1}`);
  }

  return slugByPath;
}

// ─── Utility ──────────────────────────────────────────────

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

// ─── Status Gathering ─────────────────────────────────────

function parseGitPorcelainStatus(lines: string[]): Pick<
  SessionStatus,
  'gitDirty' | 'gitModified' | 'gitAdded' | 'gitDeleted' | 'gitUntracked'
> {
  let gitDirty = 0;
  let gitModified = 0;
  let gitAdded = 0;
  let gitDeleted = 0;
  let gitUntracked = 0;

  const trimmedLines = lines.map(l => l.trimEnd()).filter(l => l.trim().length > 0);
  gitDirty = trimmedLines.length;

  for (const line of trimmedLines) {
    if (line.startsWith('??')) {
      gitUntracked++;
      continue;
    }

    // Porcelain v1: XY <path>
    const x = line[0] ?? ' ';
    const y = line[1] ?? ' ';
    const code = `${x}${y}`;

    // Count each path once with a simple precedence.
    if (code.includes('D')) {
      gitDeleted++;
      continue;
    }
    if (code.includes('M') || code.includes('R')) {
      gitModified++;
      continue;
    }
    if (code.includes('A') || code.includes('C')) {
      gitAdded++;
      continue;
    }
  }

  return { gitDirty, gitModified, gitAdded, gitDeleted, gitUntracked };
}

async function getWorktreeBranchLabel(worktreePath: string, fallbackLabel: string): Promise<string> {
  try {
    const branch = (await exec(`git -C "${worktreePath}" symbolic-ref --short HEAD`)).trim();
    if (branch) return branch;
  } catch {
    void 0;
  }

  try {
    const head = (await exec(`git -C "${worktreePath}" rev-parse --short HEAD`)).trim();
    if (head) return head;
  } catch {
    void 0;
  }

  return fallbackLabel;
}

async function getWorktreeGitStatus(worktreePath: string): Promise<Pick<
  SessionStatus,
  'gitDirty' | 'gitModified' | 'gitAdded' | 'gitDeleted' | 'gitUntracked' | 'commitsAhead'
>> {
  let commitsAhead = 0;
  let parsed = { gitDirty: 0, gitModified: 0, gitAdded: 0, gitDeleted: 0, gitUntracked: 0 };

  if (!fs.existsSync(worktreePath)) {
    return { ...parsed, commitsAhead };
  }

  try {
    const gitStatusOutput = await exec(`git -C "${worktreePath}" status --porcelain`);
    const lines = gitStatusOutput.split('\n');
    parsed = parseGitPorcelainStatus(lines);
  } catch {
    void 0;
  }

  try {
    const aheadOutput = await exec(`git -C "${worktreePath}" rev-list --count @{upstream}..HEAD`);
    commitsAhead = parseInt(aheadOutput.trim(), 10) || 0;
  } catch {
    void 0;
  }

  return { ...parsed, commitsAhead };
}

async function getSessionStatus(sessionName: string, worktreePath?: string): Promise<SessionStatus> {
  let attached = false;
  let lastActive = 0;
  let panes = 1;
  let gitDirty = 0;
  let gitModified = 0;
  let gitAdded = 0;
  let gitDeleted = 0;
  let gitUntracked = 0;
  let commitsAhead = 0;
  let cpuUsage = 0;

  try {
    const output = await exec(`tmux display-message -p -t "${sessionName}" '#{session_attached}|||#{session_activity}'`);
    const [attachedStr, activityStr] = output.split('|||');
    attached = attachedStr === '1';
    lastActive = parseInt(activityStr, 10) || 0;
  } catch {
    void 0;
  }

  try {
    const panesOutput = await exec(`tmux list-panes -t "${sessionName}"`);
    panes = panesOutput.split('\n').filter(l => l.trim()).length || 1;
  } catch {
    void 0;
  }

  try {
    const pidsOutput = await exec(`tmux list-panes -t "${sessionName}" -F '#{pane_pid}'`);
    const pids = pidsOutput.split('\n').filter(l => l.trim());
    if (pids.length > 0) {
      const pidList = pids.join(',');
      const cpuOutput = await exec(`ps -o %cpu= -p ${pidList}`);
      const cpuValues = cpuOutput.split('\n').filter(l => l.trim()).map(v => parseFloat(v.trim()) || 0);
      cpuUsage = cpuValues.reduce((a, b) => a + b, 0);
    }
  } catch {
    void 0;
  }

  if (worktreePath && fs.existsSync(worktreePath)) {
    try {
      const gitStatusOutput = await exec(`git -C "${worktreePath}" status --porcelain`);
      const parsed = parseGitPorcelainStatus(gitStatusOutput.split('\n'));
      gitDirty = parsed.gitDirty;
      gitModified = parsed.gitModified;
      gitAdded = parsed.gitAdded;
      gitDeleted = parsed.gitDeleted;
      gitUntracked = parsed.gitUntracked;
    } catch {
      void 0;
    }

    try {
      const aheadOutput = await exec(`git -C "${worktreePath}" rev-list --count @{upstream}..HEAD`);
      commitsAhead = parseInt(aheadOutput.trim(), 10) || 0;
    } catch {
      void 0;
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

  return { attached, panes, lastActive, gitDirty, gitModified, gitAdded, gitDeleted, gitUntracked, commitsAhead, cpuUsage, classification };
}

async function isGitInitialized(dirPath: string): Promise<boolean> {
  try {
    await exec(`git -C "${dirPath}" rev-parse --git-dir`);
    return true;
  } catch {
    return false;
  }
}

// ─── Tree Item Classes ────────────────────────────────────

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

/**
 * Level 2 – Icon rules from requirements:
 *   ● filled green  = git ✓ + tmux active
 *   ○ outline green = git ✓ + tmux stopped
 *   ⚠️ warning      = git not initialized
 */
export class WorktreeItem extends TmuxItem {
  public readonly isCurrentWorkspace: boolean;
  public readonly worktreePath?: string;
  public readonly hasGit: boolean;
  public readonly hasTmux: boolean;
  public readonly isMainWorktree: boolean;

  constructor(opts: {
    branchLabel: string;
    repoName: string;
    sessionName: string;
    worktreePath?: string;
    isCurrentWorkspace: boolean;
    hasGit: boolean;
    hasTmux: boolean;
    isMainWorktree?: boolean;
  }) {
    const displayLabel = opts.branchLabel;
    const description = opts.isCurrentWorkspace ? 'This project' : undefined;
    super(displayLabel, vscode.TreeItemCollapsibleState.Expanded, opts.repoName, opts.sessionName);

    this.isCurrentWorkspace = opts.isCurrentWorkspace;
    this.worktreePath = opts.worktreePath;
    this.hasGit = opts.hasGit;
    this.hasTmux = opts.hasTmux;
    this.isMainWorktree = Boolean(opts.isMainWorktree);
    this.description = description;

    this.contextValue = 'tmuxItem';

    if (!opts.hasGit) {
      this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
    } else if (opts.hasTmux) {
      this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'));
    } else {
      this.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.green'));
    }
  }
}

export class TmuxDetailItem extends TmuxItem {
  constructor(
    public readonly session: SessionWithStatus,
    public readonly repoName: string,
    public readonly worktree?: Worktree,
    extensionUri?: vscode.Uri
  ) {
    const parts: string[] = [];

    if (session.status.classification === 'stopped') {
      parts.push('stopped');
    } else {
      parts.push(`${session.status.panes}p`);
      parts.push(formatLastActive(session.status.lastActive));
      if (session.status.cpuUsage > 0) {
        parts.push(`CPU ${session.status.cpuUsage.toFixed(0)}%`);
      }
    }

    if (session.status.classification === 'orphan') {
      parts.push('orphan');
    }

    const label = parts.join(' · ');
    super(label, vscode.TreeItemCollapsibleState.None, repoName, session.name);

    this.contextValue = 'tmuxItem';

    if (extensionUri) {
      const iconPath = vscode.Uri.joinPath(
        extensionUri,
        'resources',
        session.status.classification === 'stopped' ? 'tmux-inactive.svg' : 'tmux.svg'
      );
      this.iconPath = { light: iconPath, dark: iconPath };
    } else {
      this.iconPath = new vscode.ThemeIcon('terminal-tmux');
    }

    this.command = {
      command: 'tmux.attachCreate',
      title: 'Attach Session',
      arguments: [this]
    };
  }
}

export class InactiveDetailItem extends TmuxItem {
  constructor(
    public readonly worktree: Worktree,
    public readonly repoName: string,
    public readonly targetSessionName: string,
    extensionUri?: vscode.Uri
  ) {
    super('0p · stopped', vscode.TreeItemCollapsibleState.None, repoName, targetSessionName);

    this.contextValue = 'tmuxItem';

    if (extensionUri) {
      const iconPath = vscode.Uri.joinPath(extensionUri, 'resources', 'tmux-inactive.svg');
      this.iconPath = { light: iconPath, dark: iconPath };
    } else {
      this.iconPath = new vscode.ThemeIcon('terminal-tmux');
    }

    this.command = {
      command: 'tmux.attachCreate',
      title: 'Launch Session',
      arguments: [this]
    };
  }
}

export class GitStatusItem extends TmuxItem {
  public readonly worktreePath?: string;

  constructor(
    status: SessionStatus,
    repoName: string,
    sessionName?: string,
    worktreePath?: string
  ) {
    const parts: string[] = [];

    const newCount = status.gitAdded + status.gitUntracked;

    if (status.commitsAhead > 0) parts.push(`↑${status.commitsAhead}`);
    if (status.gitModified > 0) parts.push(`M:${status.gitModified}`);
    if (newCount > 0) parts.push(`U:${newCount}`);
    if (status.gitDeleted > 0) parts.push(`D:${status.gitDeleted}`);

    const label = parts.join(' · ');
    super(label, vscode.TreeItemCollapsibleState.None, repoName, sessionName);

    this.contextValue = 'tmuxItem';
    this.iconPath = new vscode.ThemeIcon('git-commit', new vscode.ThemeColor('charts.green'));
    this.worktreePath = worktreePath;
  }
}

// ─── Legacy compatibility ─────────────────────────────────

/** @deprecated use WorktreeItem */
export class TmuxSessionItem extends WorktreeItem {
  public readonly session: SessionWithStatus;
  public readonly detailItem: TmuxDetailItem;
  public readonly gitStatusItem?: GitStatusItem;

  constructor(
    session: SessionWithStatus,
    repoName: string,
    worktree: Worktree | undefined,
    isCurrentWorkspace: boolean,
    hasGit: boolean,
    extensionUri?: vscode.Uri,
    branchLabelOverride?: string
  ) {
    const isRoot = Boolean(worktree?.isMain);
    const branchLabel = branchLabelOverride || worktree?.branch || (isRoot ? 'main' : session.slug);

    super({
      branchLabel,
      repoName,
      sessionName: session.name,
      worktreePath: session.worktreePath,
      isCurrentWorkspace,
      hasGit,
      hasTmux: session.status.classification !== 'stopped',
      isMainWorktree: isRoot
    });

    this.session = session;
    this.detailItem = new TmuxDetailItem(session, repoName, worktree, extensionUri);

    const hasGitChanges = session.status.commitsAhead > 0 || session.status.gitModified > 0 ||
      session.status.gitDeleted > 0 || session.status.gitAdded > 0 || session.status.gitUntracked > 0;
    if (hasGitChanges) {
      this.gitStatusItem = new GitStatusItem(session.status, repoName, session.name, session.worktreePath);
    }
  }
}

/** @deprecated use WorktreeItem */
export class InactiveWorktreeItem extends WorktreeItem {
  public readonly detailItem: InactiveDetailItem;
  public readonly gitStatusItem?: GitStatusItem;
  public readonly worktree: Worktree;
  public readonly targetSessionName: string;

  constructor(
    worktree: Worktree,
    repoName: string,
    targetSessionName: string,
    isCurrentWorkspace: boolean,
    hasGit: boolean,
    extensionUri?: vscode.Uri,
    branchLabelOverride?: string,
    gitStatusOverride?: SessionStatus
  ) {
    const branchLabel = branchLabelOverride || worktree.branch || (worktree.isMain ? 'main' : path.basename(worktree.path));

    super({
      branchLabel,
      repoName,
      sessionName: targetSessionName,
      worktreePath: worktree.path,
      isCurrentWorkspace,
      hasGit,
      hasTmux: false,
      isMainWorktree: worktree.isMain
    });

    this.worktree = worktree;
    this.targetSessionName = targetSessionName;
    this.detailItem = new InactiveDetailItem(worktree, repoName, targetSessionName, extensionUri);

    if (gitStatusOverride) {
      const hasGitChanges = gitStatusOverride.commitsAhead > 0 || gitStatusOverride.gitModified > 0 ||
        (gitStatusOverride.gitAdded + gitStatusOverride.gitUntracked) > 0 || gitStatusOverride.gitDeleted > 0;
      if (hasGitChanges) {
        this.gitStatusItem = new GitStatusItem(gitStatusOverride, repoName, targetSessionName, worktree.path);
      }
    }
  }
}

export class TmuxSessionDetailItem extends TmuxDetailItem {
  constructor(
    session: SessionWithStatus,
    repoName: string,
    worktree?: Worktree,
    extensionUri?: vscode.Uri
  ) {
    super(session, repoName, worktree, extensionUri);
  }
}

export class InactiveWorktreeDetailItem extends InactiveDetailItem {
  constructor(
    worktree: Worktree,
    repoName: string,
    targetSessionName: string,
    extensionUri?: vscode.Uri
  ) {
    super(worktree, repoName, targetSessionName, extensionUri);
  }
}

// ─── Provider ─────────────────────────────────────────────

export class TmuxSessionProvider implements vscode.TreeDataProvider<TmuxItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TmuxItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private _filter: FilterType = 'all';
  private _error: string | undefined;
  private _extensionUri: vscode.Uri | undefined;

  setExtensionUri(uri: vscode.Uri): void { this._extensionUri = uri; }
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
      return this.getWorktreeItems(element.repoName, element.repoRoot);
    }

    if (element instanceof TmuxSessionItem) {
      const children: TmuxItem[] = [element.detailItem];
      if (element.gitStatusItem) children.push(element.gitStatusItem);
      return children;
    }

    if (element instanceof InactiveWorktreeItem) {
      const children: TmuxItem[] = [element.detailItem];
      if (element.gitStatusItem) children.push(element.gitStatusItem);
      return children;
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

  private async getWorktreeItems(repoName: string, repoRoot: string): Promise<TmuxItem[]> {
    try {
      const [allSessions, listedWorktrees, repoHasGit] = await Promise.all([
        listSessions(),
        listWorktrees(repoRoot),
        isGitInitialized(repoRoot)
      ]);
      const worktrees: Worktree[] = listedWorktrees.length > 0
        ? listedWorktrees
        : (!repoHasGit ? [{ path: repoRoot, branch: '', isMain: true }] : []);
      const worktreeSlugByPath = buildWorktreeSlugMap(worktrees, repoName);
      this._error = undefined;
      const activeWorkspacePath = toCanonicalPath(repoRoot) || path.resolve(repoRoot);
      const sessionPrefixConfig = createRepoSessionPrefixConfig(repoRoot);

      const pathMap = new Map<string, { worktree?: Worktree, sessions: SessionWithStatus[], hasGit: boolean }>();
      const normalizedRepoRoot = sessionPrefixConfig.canonicalRepoRoot;
      const gitChecks = await Promise.all(worktrees.map(wt => {
        const normalizedWtPath = toCanonicalPath(wt.path) || path.resolve(wt.path);
        if (!repoHasGit && normalizedWtPath === normalizedRepoRoot) return Promise.resolve(false);
        return isGitInitialized(wt.path);
      }));
      const branchLabels = await Promise.all(worktrees.map((wt, i) => {
        const normalizedWtPath = toCanonicalPath(wt.path) || path.resolve(wt.path);
        if (!repoHasGit && normalizedWtPath === normalizedRepoRoot) {
          return Promise.resolve(NO_GIT_BRANCH_LABEL);
        }
        const fallback = wt.branch || (wt.isMain ? 'main' : path.basename(wt.path));
        return gitChecks[i] ? getWorktreeBranchLabel(wt.path, fallback) : Promise.resolve(fallback);
      }));
      const branchLabelByPath = new Map<string, string>();

      for (let i = 0; i < worktrees.length; i++) {
        const wt = worktrees[i];
        const normalizedPath = toCanonicalPath(wt.path);
        if (!normalizedPath) continue;
        pathMap.set(normalizedPath, { worktree: wt, sessions: [], hasGit: gitChecks[i] });
        branchLabelByPath.set(normalizedPath, branchLabels[i]);
      }

      for (const session of allSessions) {
        session.workdir = await getSessionWorkdir(session.name);
        const workdir = toCanonicalPath(session.workdir);
        const matchedSession = matchRepoSessionName(
          session.name,
          workdir,
          sessionPrefixConfig,
          { allowLegacy: true }
        );
        if (!matchedSession) {
          continue;
        }

        const status = await getSessionStatus(session.name, workdir);
        let entry = workdir ? pathMap.get(workdir) : undefined;

        if (!entry) {
          status.classification = 'orphan';
          entry = { sessions: [], hasGit: false };
          pathMap.set(workdir || `orphan:${session.name}`, entry);
        }

        const slug = matchedSession.slug || 'main';

        entry.sessions.push({
          ...session,
          status,
          worktreePath: workdir,
          slug
        });
      }

      const items: TmuxItem[] = [];

      for (const [, entry] of pathMap.entries()) {
        const { worktree, sessions, hasGit } = entry;

        if (sessions.length === 0 && worktree) {
          const normalizedPath = toCanonicalPath(worktree.path);
          if (!normalizedPath) continue;
          const slug = worktreeSlugByPath.get(normalizedPath) || getDefaultWorktreeSlug(worktree, repoName);
          const sessionName = buildSessionName(sessionPrefixConfig.repoSessionNamespace, slug);
          const isCurrentWorkspace = isCurrentWorkspacePath(worktree.path, activeWorkspacePath);
          const branchLabel = branchLabelByPath.get(normalizedPath) ||
            worktree.branch || (worktree.isMain ? 'main' : path.basename(worktree.path));

          const gitOnly = hasGit ? await getWorktreeGitStatus(worktree.path) : undefined;
          const stoppedStatus: SessionStatus | undefined = gitOnly ? {
            attached: false,
            panes: 0,
            lastActive: 0,
            classification: 'stopped',
            cpuUsage: 0,
            ...gitOnly
          } : undefined;

          items.push(new InactiveWorktreeItem(
            worktree,
            repoName,
            sessionName,
            isCurrentWorkspace,
            hasGit,
            this._extensionUri,
            branchLabel,
            stoppedStatus
          ));
          continue;
        }

        if (sessions.length >= 1) {
          const sessionPath = worktree?.path || sessions[0].worktreePath;
          const isCurrentWorkspace = isCurrentWorkspacePath(sessionPath, activeWorkspacePath);
          let branchLabel: string | undefined;
          if (worktree) {
            const normalizedPath = toCanonicalPath(worktree.path);
            if (normalizedPath) {
              branchLabel = branchLabelByPath.get(normalizedPath);
            }
          } else if (sessionPath) {
            branchLabel = await getWorktreeBranchLabel(sessionPath, sessions[0].slug);
          }

          items.push(new TmuxSessionItem(
            sessions[0],
            repoName,
            worktree,
            isCurrentWorkspace,
            hasGit,
            this._extensionUri,
            branchLabel
          ));
        }
      }

      const pathToActive = new Map<string, TmuxItem>();
      const pathToInactive = new Map<string, TmuxItem>();
      const otherItems: TmuxItem[] = [];

      for (const item of items) {
        let itemPath: string | undefined;

        if (item instanceof TmuxSessionItem) {
          itemPath = item.session.worktreePath;
        } else if (item instanceof InactiveWorktreeItem) {
          itemPath = item.worktree.path;
        }

        if (itemPath) {
          const normalized = toCanonicalPath(itemPath);
          if (!normalized) {
            otherItems.push(item);
            continue;
          }
          if (item instanceof InactiveWorktreeItem) {
            if (!pathToInactive.has(normalized)) pathToInactive.set(normalized, item);
          } else {
            pathToActive.set(normalized, item);
          }
        } else {
          otherItems.push(item);
        }
      }

      const uniqueItems: TmuxItem[] = [...pathToActive.values()];
      for (const [inactivePath, inactiveItem] of pathToInactive.entries()) {
        if (!pathToActive.has(inactivePath)) uniqueItems.push(inactiveItem);
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
      const currentA = this.isCurrentWorkspaceItem(a);
      const currentB = this.isCurrentWorkspaceItem(b);
      if (currentA !== currentB) return currentA ? -1 : 1;

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
    return 10;
  }

  private isCurrentWorkspaceItem(item: TmuxItem): boolean {
    if (item instanceof WorktreeItem) return item.isCurrentWorkspace;
    return false;
  }
}
