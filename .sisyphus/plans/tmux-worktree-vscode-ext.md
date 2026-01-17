# VS Code TMUX Worktree Extension Plan

## Context

### Original Request
VS Code 하단 패널에 TMUX 탭을 추가하고, worktree + tmux 자동 생성/전환을 지원하는 확장. Phase 1~3 전체 범위 포함.

### Interview Summary
**Key Discussions**:
- TMUX 탭은 커스텀 View(TreeView)로 구현
- 작업 1개 = worktree 1개, tmux session 단위 매핑
- tmux session metadata `@workdir`로 현재 디렉토리 매칭
- New Task 시 worktree+branch+tmux+attach+(옵션) CLI 실행
- Remove Task 기본: tmux + worktree 삭제, 브랜치 삭제는 로컬만
- macOS 전용, UI 말투는 간결체 영어
- 상태 고도화 필드: attached, panes 수, last active, git dirty
- 충돌 정책: 프로젝트에서 실행 중인 세션 모두 찾아 attach
- 에디터 재시작 시 해당 폴더 tmux 세션 자동 attach

**Research Findings**:
- TreeView 가이드: https://code.visualstudio.com/api/extension-guides/tree-view
- Repo는 초기 상태로 코드/테스트 인프라 없음

**핵심 레퍼런스 코드 스니펫 (인라인)**:

<details>
<summary>TreeDataProvider 패턴</summary>

> **참조 출처**: VS Code 공식 TreeView 가이드 https://code.visualstudio.com/api/extension-guides/tree-view
> 
> 아래 코드는 공식 문서 패턴 기반 자체 구현이며, 외부 샘플 저장소에 의존하지 않음.

```typescript
// TreeDataProvider 기본 구조
export class TmuxSessionProvider implements vscode.TreeDataProvider<TmuxItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TmuxItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TmuxItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TmuxItem): Promise<TmuxItem[]> {
    if (!element) {
      // 루트: repo 그룹 반환
      return this.getRepoGroups();
    }
    // 그룹: 해당 repo의 세션 반환
    return this.getSessionsForRepo(element.repoName);
  }
}

// TreeItem 확장
class TmuxItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly repoName?: string,
    public readonly sessionName?: string
  ) {
    super(label, collapsibleState);
  }
}
```
</details>

<details>
<summary>Terminal API 패턴</summary>

> **참조 출처**: VS Code 공식 Terminal API 문서 https://code.visualstudio.com/api/references/vscode-api#Terminal
> 
> 아래 코드는 자체 구현 패턴이며, 외부 샘플 저장소에 의존하지 않음.

```typescript
// 터미널 생성 및 명령 실행
function createTmuxTerminal(sessionName: string, cwd?: string): vscode.Terminal {
  const terminal = vscode.window.createTerminal({
    name: `tmux: ${sessionName}`,
    cwd: cwd
  });
  terminal.sendText(`tmux attach -t ${sessionName}`);
  terminal.show();
  return terminal;
}

// 기존 터미널 재사용
function findOrCreateTerminal(sessionName: string): vscode.Terminal {
  const terminalName = `tmux: ${sessionName}`;
  const existing = vscode.window.terminals.find(t => t.name === terminalName);
  if (existing) {
    existing.show();
    return existing;
  }
  return createTmuxTerminal(sessionName);
}
```
</details>

<details>
<summary>package.json 기여 포인트 패턴 (하단 Panel)</summary>

```json
{
  "contributes": {
    "viewsContainers": {
      "panel": [
        {
          "id": "tmux-panel",
          "title": "TMUX",
          "icon": "resources/tmux.svg"
        }
      ]
    },
    "views": {
      "tmux-panel": [
        {
          "id": "tmuxSessions",
          "name": "Sessions"
        }
      ]
    },
    "commands": [
      {
        "command": "tmux.attachCreate",
        "title": "TMUX: Attach/Create Session"
      },
      {
        "command": "tmux.newTask",
        "title": "TMUX: New Task"
      },
      {
        "command": "tmux.removeTask",
        "title": "TMUX: Remove Task"
      },
      {
        "command": "tmux.refresh",
        "title": "Refresh",
        "icon": "$(refresh)"
      },
      {
        "command": "tmux.filter",
        "title": "Filter Sessions",
        "icon": "$(filter)"
      }
    ],
    "menus": {
      "view/title": [
        {
          "command": "tmux.refresh",
          "when": "view == tmuxSessions",
          "group": "navigation"
        },
        {
          "command": "tmux.filter",
          "when": "view == tmuxSessions",
          "group": "navigation"
        }
      ],
      "view/item/context": [
        {
          "command": "tmux.attachCreate",
          "when": "view == tmuxSessions && viewItem == tmuxSession"
        },
        {
          "command": "tmux.removeTask",
          "when": "view == tmuxSessions && viewItem == tmuxSession"
        }
      ]
    }
  },
  "activationEvents": [
    "onView:tmuxSessions"
  ]
}
```

**Panel vs Activity Bar 선택 근거**:
- 사용자 요구사항: "VS Code 하단 패널에 TMUX 탭"
- Panel 위치는 Terminal, Problems, Output과 같은 영역에 배치됨
- tmux 세션 관리가 터미널 작업과 밀접하므로 하단 Panel이 자연스러운 UX
</details>

### Metis Review
**Identified Gaps** (addressed):
- 삭제 안전장치/확인 절차 명시
- worktree 기준 브랜치 확정: main (origin/main)
- 상태 고도화 필드 확정
- tmux 충돌 정책 확정
- tmux 미설치/미실행/@workdir 불일치 가이드 제공

---

## Work Objectives

### Core Objective
VS Code에서 tmux + git worktree 기반 세션을 한 화면에서 생성/전환/정리할 수 있는 TMUX 탭을 제공한다.

### Concrete Deliverables
- VS Code 확장 스캐폴딩(TypeScript) 및 TMUX 탭(View Container + TreeView)
- `package.json` 기여 포인트: `viewsContainers`, `views`, `commands`, `activationEvents`
- tmux 세션/워크트리 생성·Attach·삭제 명령
- 세션 리스트 UI(상태/정렬/필터/컨텍스트 메뉴)
- CLI bootstrap 옵션(claude/opencode/custom 실행)
- 상태 고도화 및 orphan 정리 기능

### Naming & Path Rules
| 항목 | 규칙 | 예시 |
|------|------|------|
| worktree 경로 | `<repo-root>/.worktrees/<slug>` | `/project/.worktrees/ads-refresh` |
| 브랜치 이름 | `task/<slug>` | `task/ads-refresh` |
| tmux 세션 이름 | `<repo-name>:<slug>` | `my-project:ads-refresh` |
| repo-name 산출 | `path.basename(repoRoot)` | `/Users/x/my-project` → `my-project` |

### tmux 옵션 파싱 규칙
```typescript
// tmux show-options -t <session> @workdir 출력 예: "@workdir /abs/path"
const output = await exec(`tmux show-options -t ${session} @workdir`);
const workdir = output.split(' ').slice(1).join(' ').trim();
// 비교: workdir === currentWorkspaceRoot
```

### 확장 스캐폴딩 방식
- `yo code` 사용, TypeScript 템플릿 선택
- 생성 후 불필요 파일 정리(README, CHANGELOG 등)
- 디렉터리 구조:
  ```
  src/
    extension.ts       # activate/deactivate
    providers/
      tmuxSessionProvider.ts  # TreeDataProvider
    commands/
      attachCreate.ts
      newTask.ts
      removeTask.ts
    utils/
      tmux.ts          # tmux 명령 래퍼
      git.ts           # git worktree 래퍼
  resources/
    tmux.svg           # Activity Bar 아이콘 (24x24, monochrome SVG)
  package.json
  tsconfig.json
  ```

### 아이콘 리소스 생성
- 위치: `resources/tmux.svg`
- 포맷: 24x24 SVG, 단색(monochrome), VS Code 테마 색상 호환
- **출처**: 직접 제작 (라이선스 문제 없음)
- 생성 방법: 아래 SVG 코드를 `resources/tmux.svg`로 저장
- 예시 SVG (터미널 분할 창 모양):
  ```svg
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
    <rect x="2" y="3" width="20" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
    <line x1="2" y1="9" x2="22" y2="9" stroke="currentColor" stroke-width="2"/>
    <line x1="12" y1="9" x2="12" y2="21" stroke="currentColor" stroke-width="2"/>
  </svg>
  ```

### New Task 입력 UX
```typescript
// New Task 명령 핸들러
vscode.commands.registerCommand('tmux.newTask', async () => {
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
      return null; // valid
    }
  });
  
  if (!slugInput) return; // 취소됨
  
  // 2. slug 정규화: 공백 → `-`, 소문자 변환
  const slug = slugInput.trim().toLowerCase().replace(/\s+/g, '-');
  
  // 3. 이후 New Task 생성 흐름 실행...
});
```

**입력 UX 요약**:
| 항목 | 값 |
|------|-----|
| 입력 방식 | `vscode.window.showInputBox` |
| 프롬프트 | "Enter task slug (e.g., "feature-auth", "fix-login")" |
| 플레이스홀더 | "my-task-name" |
| 검증 실패 메시지 | "Slug is required.", "Slug must contain only lowercase letters, numbers, and hyphens.", "Slug must be 32 characters or less." |

### Attach/Create 분기 규칙
```typescript
// Attach/Create 명령 핸들러
vscode.commands.registerCommand('tmux.attachCreate', async () => {
  const repoRoot = getRepoRoot();
  const matchingSessions = await findSessionsForWorkspace(repoRoot);
  
  if (matchingSessions.length > 0) {
    // 기존 세션 있음 → 각각 attach
    for (const session of matchingSessions) {
      const terminal = findOrCreateTerminal(session);
      terminal.show();
    }
  } else {
    // 기존 세션 없음 → 확인 후 New Task 실행
    const choice = await vscode.window.showInformationMessage(
      'No existing tmux session found for this workspace. Create a new task?',
      'Create New Task', 'Cancel'
    );
    if (choice === 'Create New Task') {
      // New Task 명령 호출
      vscode.commands.executeCommand('tmux.newTask');
    }
  }
});
```

**분기 정책**:
| 상황 | 동작 | 사용자 확인 |
|------|------|------------|
| 매칭 세션 1개 이상 | 모두 attach | 없음 (자동) |
| 매칭 세션 없음 | 확인 팝업 표시 → "Create New Task" 클릭 시 New Task 실행 | 있음 |

### TmuxSessionItem 데이터 모델 (완전 정의)
```typescript
// TreeView에 표시되는 세션 항목
class TmuxSessionItem extends vscode.TreeItem {
  contextValue = 'tmuxSession';
  
  constructor(
    public readonly sessionName: string,     // tmux 세션 이름 (e.g., "my-project:feature-auth")
    public readonly worktreePath: string,    // worktree 절대 경로 (e.g., "/project/.worktrees/feature-auth")
    public readonly slug: string,            // task slug (e.g., "feature-auth")
    public readonly repoName: string,        // repo 이름 (e.g., "my-project")
    public readonly status: SessionStatus,   // 상태 정보
    public readonly isOrphan: boolean = false
  ) {
    super(sessionName, vscode.TreeItemCollapsibleState.None);
    
    // description 및 tooltip 설정 (위 TreeItem 구조 예시 참조)
    this.description = this.buildDescription();
    this.tooltip = this.buildTooltip();
  }
  
  private buildDescription(): string {
    let icon: string;
    if (this.isOrphan) {
      icon = '⚠';
    } else if (this.status.attached) {
      icon = '●';
    } else if (this.status.classification === 'alive') {
      icon = '◐';
    } else {
      icon = '○';
    }
    const dirty = this.status.gitDirty ? '*' : '';
    const orphanLabel = this.isOrphan ? ' [orphan]' : '';
    return `${icon} ${this.status.panes}p ${formatLastActive(this.status.lastActive)}${dirty}${orphanLabel}`;
  }
  
  private buildTooltip(): string {
    return `Session: ${this.sessionName}\nWorktree: ${this.worktreePath}\nStatus: ${this.isOrphan ? 'ORPHAN' : this.status.classification}\nPanes: ${this.status.panes}\nLast active: ${formatLastActive(this.status.lastActive)}\nGit: ${this.status.gitDirty ? 'dirty' : 'clean'}`;
  }
}

// 데이터 수집 흐름
async function buildSessionItem(session: string): Promise<TmuxSessionItem> {
  // 1. @workdir에서 worktreePath 추출
  const workdir = await getSessionWorkdir(session); // tmux show-options 파싱
  
  // 2. sessionName에서 repoName, slug 추출
  // 형식: "<repoName>:<slug>"
  const [repoName, slug] = session.split(':');
  
  // 3. 상태 계산
  const status = await getSessionStatus(session, workdir);
  
  // 4. orphan 여부 확인
  const isOrphan = !workdir || !fs.existsSync(workdir);
  
  return new TmuxSessionItem(session, workdir, slug, repoName, status, isOrphan);
}
```

### 멀티루트 워크스페이스 기준 (전역 규칙)
```typescript
// 모든 Task에서 사용하는 repoRoot 선정 규칙
function getRepoRoot(): string {
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
```
- **모든 Task에서 이 함수를 사용**하여 repoRoot를 결정
- Task 3의 "멀티루트면 활성 폴더" 규칙이 전역으로 적용됨

### .worktrees 디렉터리 생성 규칙
```typescript
// worktree 생성 전 .worktrees 디렉터리 확보
async function ensureWorktreesDir(repoRoot: string): Promise<string> {
  const worktreesDir = path.join(repoRoot, '.worktrees');
  if (!fs.existsSync(worktreesDir)) {
    await fs.promises.mkdir(worktreesDir, { recursive: true });
  }
  return worktreesDir;
}

// .gitignore에 .worktrees 추가 권장 (선택적)
// 사용자에게 안내만 제공, 자동 수정하지 않음
```

### tmux 상태별 가이드 메시지 정책 (일관된 규칙)
| 상황 | 컨텍스트 | 동작 |
|------|----------|------|
| **tmux 미설치** | 모든 명령 | 에러 + 가이드: "tmux not found. Install: `brew install tmux`" |
| **tmux 서버 미실행** | 수동 명령 (New Task, Attach 등) | 에러 + 가이드: "No tmux server running. Start a session first." |
| **tmux 서버 미실행** | 자동 attach (재시작 시) | **조용히 스킵** (가이드 없음, 방해하지 않음) |
| **@workdir 불일치** | Attach 시도 | 경고: "Session workdir mismatch. Resync or remove." |
| **@workdir 없음** | 세션 조회 | 해당 세션 orphan으로 분류 |

**정책 근거**:
- 사용자가 직접 호출한 명령에는 명확한 가이드 제공 (Must Have)
- 자동 실행(재시작 등)에서는 사용자 작업 흐름 방해 금지 (UX 우선)

### Attach 충돌 정책 (터미널 관리)
- 동일 프로젝트 세션 attach 시:
  - 세션별로 **별도 터미널 탭** 생성
  - 터미널 이름: `tmux: <session-name>`
  - 이미 동일 이름 터미널이 열려 있으면 **재사용**(focus만)
  - 탭 개수 제한 없음

### 브랜치 기준 분기 로직
```typescript
// origin/main 존재 여부 확인
async function getBaseBranch(): Promise<string> {
  try {
    // origin/main 존재 확인
    await exec('git rev-parse --verify origin/main');
    return 'origin/main';
  } catch {
    try {
      // fallback: main 로컬 브랜치 확인
      await exec('git rev-parse --verify main');
      return 'main';
    } catch {
      throw new Error('No main branch found (origin/main or main)');
    }
  }
}

// worktree 생성 명령
const baseBranch = await getBaseBranch();
await exec(`git worktree add ${worktreePath} -b task/${slug} ${baseBranch}`);
```

### 필터/정렬 기준 수치 정의
| 분류 | 기준 | 값/계산 방식 |
|------|------|--------------|
| **Attached** | `session_attached == 1` | tmux 직접 제공 |
| **Alive** | attached 또는 activity < 10분 | `now - session_activity < 600` |
| **Idle** | !attached && activity >= 10분 | `now - session_activity >= 600` |
| **Orphan** | tmux만 또는 worktree만 존재 | 아래 Orphan 판정 규칙 참조 |

- `session_activity`: UNIX epoch (초 단위), `tmux display-message -p -t <session> '#{session_activity}'`
- UI 표시: `Xm ago` (분 단위), 60분 이상이면 `Xh ago`, 24시간 이상이면 날짜

```typescript
function formatLastActive(sessionActivity: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diffSec = now - sessionActivity;
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  return new Date(sessionActivity * 1000).toLocaleDateString();
}
```

### Orphan 판정 규칙 (완전 명시)
```typescript
interface OrphanCheck {
  tmuxOnly: TmuxSession[];   // tmux 세션은 있지만 worktree 없음
  worktreeOnly: string[];     // worktree는 있지만 tmux 세션 없음
}

async function detectOrphans(repoRoot: string, repoName: string): Promise<OrphanCheck> {
  // 1. git worktree list 파싱 (--porcelain 형식)
  // 출력: worktree /path/to/worktree\nHEAD abc123\nbranch refs/heads/task/slug\n\n
  const wtOutput = await exec('git worktree list --porcelain');
  const worktrees = parseWorktreeList(wtOutput);
  
  // 2. 해당 repo의 tmux 세션 목록 (repo-name: prefix로 필터)
  const sessions = await exec(`tmux list-sessions -F '#{session_name}'`);
  const repoSessions = sessions
    .split('\n')
    .filter(s => s.startsWith(`${repoName}:`));
  
  // 3. 각 세션의 @workdir 수집
  const sessionWorkdirs = new Map<string, string>();
  for (const session of repoSessions) {
    try {
      const output = await exec(`tmux show-options -t ${session} @workdir`);
      const workdir = output.split(' ').slice(1).join(' ').trim();
      sessionWorkdirs.set(session, workdir);
    } catch {
      // @workdir 없는 경우 빈 문자열
      sessionWorkdirs.set(session, '');
    }
  }
  
  // 4. Orphan 판정
  const tmuxOnly: TmuxSession[] = [];
  const worktreeOnly: string[] = [];
  
  // tmuxOnly: @workdir 경로가 존재하지 않는 세션
  for (const [session, workdir] of sessionWorkdirs) {
    if (!workdir || !fs.existsSync(workdir)) {
      tmuxOnly.push({ name: session, workdir });
    }
  }
  
  // worktreeOnly: .worktrees/ 하위인데 매칭되는 세션 없음
  const worktreesDir = path.join(repoRoot, '.worktrees');
  for (const wt of worktrees) {
    if (wt.path.startsWith(worktreesDir)) {
      const hasSession = Array.from(sessionWorkdirs.values()).includes(wt.path);
      if (!hasSession) {
        worktreeOnly.push(wt.path);
      }
    }
  }
  
  return { tmuxOnly, worktreeOnly };
}

function parseWorktreeList(output: string): { path: string; branch: string }[] {
  const worktrees: { path: string; branch: string }[] = [];
  const blocks = output.trim().split('\n\n');
  
  for (const block of blocks) {
    const lines = block.split('\n');
    let wtPath = '';
    let branch = '';
    for (const line of lines) {
      if (line.startsWith('worktree ')) wtPath = line.slice(9);
      if (line.startsWith('branch ')) branch = line.slice(7);
    }
    if (wtPath) worktrees.push({ path: wtPath, branch });
  }
  
  return worktrees;
}
```

### 자동 Attach 정책 (재시작 시)
```typescript
// activation 시점에 실행
async function autoAttachOnStartup(context: vscode.ExtensionContext) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) return;
  
  // 1. tmux 서버 실행 여부 확인
  try {
    await exec('tmux list-sessions');
  } catch {
    // tmux 서버 없음 → 자동 attach 스킵 (사용자가 수동으로 시작해야 함)
    // 조용히 스킵 (가이드 없음, UX 방해 금지)
    return;
  }
  
  // 2. 모든 workspace 폴더에 대해 매칭 세션 찾기 (멀티루트 지원)
  const sessions = await exec(`tmux list-sessions -F '#{session_name}'`);
  const matchingSessions: string[] = [];
  
  for (const session of sessions.split('\n').filter(Boolean)) {
    try {
      const output = await exec(`tmux show-options -t ${session} @workdir`);
      const workdir = output.split(' ').slice(1).join(' ').trim();
      
      // 어느 workspace 폴더에든 속하면 매칭
      const isMatchingAnyFolder = workspaceFolders.some(
        folder => workdir.startsWith(folder.uri.fsPath)
      );
      if (isMatchingAnyFolder) {
        matchingSessions.push(session);
      }
    } catch {
      // @workdir 없는 세션은 스킵
    }
  }
  
  if (matchingSessions.length === 0) return;
  
  // 3. 다중 세션 처리: 각 세션마다 별도 터미널 탭
  // 사용자 확인 없이 자동 attach (재시작이므로 이미 작업 중이었다고 간주)
  for (const session of matchingSessions) {
    // 이미 열린 터미널 재사용 확인
    const existingTerminal = vscode.window.terminals.find(
      t => t.name === `tmux: ${session}`
    );
    
    if (existingTerminal) {
      existingTerminal.show();
    } else {
      const terminal = vscode.window.createTerminal({
        name: `tmux: ${session}`,
      });
      terminal.sendText(`tmux attach -t ${session}`);
      terminal.show();
    }
  }
}
```

**멀티루트 자동 attach 정책**:
- 모든 workspace 폴더에 대해 매칭 세션 검색 (단일 폴더만 보지 않음)
- 여러 폴더에 걸친 세션이 있어도 각각 attach
- `getRepoRoot()` 함수와 일관성 유지: 멀티루트 환경 완전 지원

**정책 요약:**
| 상황 | 동작 |
|------|------|
| workspace에 매칭 세션 없음 | 아무것도 안 함 |
| 매칭 세션 1개 | 자동 attach (터미널 탭 1개) |
| 매칭 세션 N개 | 각각 별도 터미널 탭으로 attach (N개) |
| 이미 열린 터미널 있음 | 해당 터미널 focus (새로 만들지 않음) |
| tmux 서버 미실행 | 스킵 (가이드 메시지 없음, 수동으로 시작 필요) |

### Definition of Done
- [x] 확장 실행 시 **하단 Panel에** TMUX 탭이 표시됨 (Terminal/Problems 영역)
- [x] New Task로 worktree+tmux 세션 생성/attach가 성공
- [x] 세션 클릭으로 attach/전환 가능
- [x] Remove Task로 tmux+worktree 삭제 성공
- [x] 재시작 시 해당 폴더 tmux 세션 자동 attach
- [x] 상태 필드(표준) 표시 및 정렬 동작

### Must Have
- tmux session metadata `@workdir` 저장/조회
  - set: `tmux set-option -t <session> @workdir <abs-path>`
  - get: `tmux show-options -t <session> @workdir`
- macOS 환경 동작 보장
- Remove Task 안전장치(확인 + repo 루트 하위만)

### Must NOT Have (Guardrails)
- repo 루트 밖 삭제 금지
- tmux 미설치/미실행 시 가이드 없이 실패 금지
- slug/세션 충돌 처리 없이 덮어쓰기 금지

---

## Verification Strategy (MANDATORY)

### Test Decision
- **Infrastructure exists**: NO
- **User wants tests**: Manual-only
- **Framework**: none

### Runtime Preconditions
- tmux 설치됨 (`tmux -V` 가능)
- git 사용 가능
- workspace는 git repo 루트로 열림

### Terminal API 사용 패턴 (attach/execute)
tmux attach 및 CLI 실행은 VS Code Terminal API를 통해 구현:
```typescript
// attach 패턴
const terminal = vscode.window.createTerminal({ name: `tmux: ${sessionName}`, cwd: worktreePath });
terminal.sendText(`tmux attach -t ${sessionName}`);
terminal.show();

// attach 실패(세션 없음) 시 → New Task 흐름으로 분기
// tmux 미실행/미설치 시 → 가이드 메시지 표시
```

### TreeView 데이터 모델
- TreeDataProvider 구현: `TmuxSessionProvider`
- TreeItem 구조:
  - Repo 그룹: `collapsibleState: TreeItemCollapsibleState.Expanded`
  - 세션 항목: `contextValue: 'tmuxSession'`, description에 상태 표시
- refresh 트리거: 수동 Refresh 버튼, 세션 생성/삭제 후 즉시

### 상태 계산/정렬/필터 갱신 타이밍
- **Refresh 버튼 클릭 시**: 전체 상태 재계산
- **세션 생성/삭제 후**: 즉시 refresh
- **자동 갱신**: 없음 (수동만)
- 정렬 기준: attached(1) → recent activity(2) → idle(3) → orphan(4)

### UI 메시지 템플릿 (간결체 영어)
| 상황 | 메시지 |
|------|--------|
| tmux 미설치 | "tmux not found. Install: `brew install tmux`" |
| tmux 미실행 | "No tmux server running. Start a session first." |
| @workdir 불일치 | "Session workdir mismatch. Resync or remove." |
| 삭제 확인 | "Delete session and worktree? This cannot be undone." |
| 브랜치 삭제 확인 | "Also delete local branch `task/{slug}`?" |

### Manual QA Only
각 TODO에 구체적 수동 검증 절차를 포함한다. UI/명령형 작업은 VS Code 내 확인 및 터미널 출력 확인을 포함한다.

---

## Task Flow

```
Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6
```

## TODOs

- [x] 1. 확장 스캐폴딩 및 기본 구조 구성

  **What to do**:
  - VS Code 확장 기본 구조(TypeScript) 생성
  - `package.json`에 `viewsContainers`, `views`, `commands`, `activationEvents` 등록
  - View Container + TreeView 기초 등록
  - 기본 명령 등록(Attach/Create, New Task, Remove Task, Refresh, Filter)
  - 디렉터리 구조 (위 "확장 스캐폴딩 방식" 참조)

  **Must NOT do**:
  - 외부 CLI 설치/업데이트 로직 추가

  **Parallelizable**: NO (초기 기반)

  **References**:
  - VS Code TreeView 공식 가이드: https://code.visualstudio.com/api/extension-guides/tree-view
  - "TreeDataProvider 패턴" 인라인 코드 스니펫 (Context 섹션)
  - "Terminal API 패턴" 인라인 코드 스니펫 (Context 섹션)
  - "package.json 기여 포인트 패턴" 인라인 코드 스니펫 (Context 섹션)
  - "확장 스캐폴딩 방식" 섹션 (디렉터리 구조)

  **Acceptance Criteria**:
  - [ ] 확장 활성화 시 **하단 Panel에** TMUX 탭 표시 (Terminal, Problems와 같은 영역)
  - [ ] 명령 5개(attachCreate, newTask, removeTask, refresh, filter)가 Command Palette에 노출됨
  - [ ] VS Code 재시작 후 탭 유지
  - [ ] activationEvents에 `onView:tmuxSessions` 등록
  - [ ] `viewsContainers.panel`로 등록되어 있음 (Activity Bar 아님)

  **Manual Verification**:
  - VS Code에서 확장 실행 후 **하단 Panel 영역**에 TMUX 탭 확인 (Terminal 탭 옆)
  - TMUX 탭 클릭 → 빈 TreeView 표시 (세션 없는 경우)
  - Command Palette (Cmd+Shift+P)에서 "TMUX" 검색 → 5개 명령 노출 확인
  - 패널이 닫혀있으면 View → Panel (Cmd+J)로 열고 TMUX 탭 확인

- [x] 2. tmux 세션/워크트리 생성 흐름 구현 (New Task)

  **What to do**:
  - slug 규칙: 소문자/숫자/`-`만 허용, 공백은 `-`로 치환, 길이 32자 제한
  - slug 충돌 확인: 
    1. `git worktree list --porcelain`에서 `branch refs/heads/task/<slug>` 존재 여부
    2. `tmux list-sessions -F '#{session_name}'`에서 `<repo-name>:<slug>` 존재 여부
    3. 충돌 시 숫자 suffix 증가 (`slug-2`, `slug-3`)
  - 기준 브랜치 결정 (위 "브랜치 기준 분기 로직" 참조):
    1. `git rev-parse --verify origin/main` 성공 → `origin/main`
    2. 실패 시 `git rev-parse --verify main` 성공 → `main`
    3. 둘 다 실패 → 에러 메시지 표시
  - 명령 실행:
    ```bash
    git worktree add <worktreePath> -b task/<slug> <baseBranch>
    tmux new-session -d -s <repo-name>:<slug> -c <worktreePath>
    tmux set-option -t <repo-name>:<slug> @workdir <worktreePath>
    ```
  - 생성 직후 attach

  **Must NOT do**:
  - 원격 브랜치 삭제/생성 자동화

  **Parallelizable**: NO (Task 1 필요)

  **References**:
  - "브랜치 기준 분기 로직" 섹션의 `getBaseBranch()` 함수
  - "멀티루트 워크스페이스 기준" 섹션의 `getRepoRoot()` 함수
  - ".worktrees 디렉터리 생성 규칙" 섹션의 `ensureWorktreesDir()` 함수
  - "Terminal API 패턴" 인라인 코드 스니펫
  - tmux `-c` 사용법: 세션 생성 시 시작 디렉토리 지정

  **Terminal 실행 흐름**:
  ```typescript
  // 0. repoRoot 결정 (멀티루트 지원)
  const repoRoot = getRepoRoot(); // 위 "멀티루트 워크스페이스 기준" 참조
  const repoName = path.basename(repoRoot);
  
  // 1. 브랜치 기준 결정
  const baseBranch = await getBaseBranch(); // 'origin/main' 또는 'main'
  
  // 2. slug 충돌 확인 및 해결
  let finalSlug = slug;
  let suffix = 1;
  while (await isSlugTaken(finalSlug, repoName)) {
    suffix++;
    finalSlug = `${slug}-${suffix}`;
  }
  
  // 3. .worktrees 디렉터리 확보 (없으면 생성)
  const worktreesDir = await ensureWorktreesDir(repoRoot); // 위 ".worktrees 디렉터리 생성 규칙" 참조
  
  // 4. worktree 생성
  const worktreePath = path.join(worktreesDir, finalSlug);
  await exec(`git worktree add ${worktreePath} -b task/${finalSlug} ${baseBranch}`);
  
  // 5. tmux session 생성
  const sessionName = `${repoName}:${finalSlug}`;
  await exec(`tmux new-session -d -s ${sessionName} -c ${worktreePath}`);
  await exec(`tmux set-option -t ${sessionName} @workdir ${worktreePath}`);
  
  // 6. attach
  const terminal = vscode.window.createTerminal({ name: `tmux: ${sessionName}`, cwd: worktreePath });
  terminal.sendText(`tmux attach -t ${sessionName}`);
  terminal.show();
  
  // 7. TreeView 갱신
  tmuxProvider.refresh();
  ```

  **Acceptance Criteria**:
  - [ ] New Task 실행 시 worktree 생성됨
  - [ ] tmux session 이름이 `<repo-name>:<slug>` 형식
  - [ ] `@workdir`가 worktree 경로로 설정됨
  - [ ] slug 충돌 시 suffix 증가
  - [ ] origin/main 없을 때 main으로 fallback

  **Manual Verification**:
  - `git worktree list`로 worktree 생성 확인
  - `tmux list-sessions`로 세션 생성 확인
  - `tmux show-options -t <session> @workdir`로 메타 확인
  - origin/main 없는 repo에서 테스트 → main 사용 확인

- [x] 3. Attach/Create (current dir) 로직 구현

  **What to do**:
  - current dir 정의: 워크스페이스 루트(멀티루트면 활성 폴더)
  - `tmux list-sessions -F`로 세션 목록 수집
  - `tmux show-options -t <session> @workdir`로 매칭
  - 현재 폴더의 `@workdir` 일치 세션 attach
  - 없으면 New Task 흐름으로 생성
  - 충돌 정책: 동일 프로젝트 세션 전부 attach

  **Must NOT do**:
  - 다른 repo 세션 attach

  **Parallelizable**: NO (Task 2 필요)

  **References**:
  - "tmux 옵션 파싱 규칙" 섹션 (@workdir 조회 방법)
  - "Terminal API 패턴" 인라인 코드 스니펫
  - "Attach 충돌 정책" 섹션

  **Attach 실행 흐름**:
  ```typescript
  // 1. 세션 목록 수집
  const sessions = await exec(`tmux list-sessions -F '#{session_name}'`);
  // 2. 각 세션의 @workdir 확인
  for (const session of sessions) {
    const workdir = await exec(`tmux show-options -t ${session} @workdir`);
    if (workdir === currentWorkspaceRoot) {
      // 3. attach
      const terminal = vscode.window.createTerminal({ name: `tmux: ${session}` });
      terminal.sendText(`tmux attach -t ${session}`);
      terminal.show();
    }
  }
  // 4. 없으면 New Task 흐름으로 분기
  ```

  **Acceptance Criteria**:
  - [ ] 현재 폴더 기준으로 세션을 찾거나 생성
  - [ ] 동일 프로젝트 세션은 모두 attach

  **Manual Verification**:
  - 현재 폴더에서 command 실행 → tmux attach
  - 다른 폴더에서 실행 → 새 세션 생성

- [x] 4. 세션 리스트 TreeView 구성 및 상태/정렬/필터

  **What to do**:
  - Repo 그룹 → 세션 항목 계층 구조
  - 상태 필드 산출 (위 "필터/정렬 기준 수치 정의" 참조):
    - attached: `tmux list-sessions -F '#{session_name}:#{session_attached}'` → `1`이면 attached
    - panes 수: `tmux list-panes -t <session> | wc -l`
    - last active: `tmux display-message -p -t <session> '#{session_activity}'` (UNIX epoch 초)
    - git dirty: worktree에서 `git -C <worktreePath> status --porcelain` (출력 있으면 dirty)
  - 분류 기준:
    - **Attached**: `session_attached == 1`
    - **Alive**: `session_attached == 0` AND `now - session_activity < 600` (10분 미만)
    - **Idle**: `session_attached == 0` AND `now - session_activity >= 600` (10분 이상)
    - **Orphan**: 위 "Orphan 판정 규칙" 참조
  - 정렬 우선순위: Attached(1) → Alive(2) → Idle(3) → Orphan(4), 같은 분류 내에서는 session_activity 최신순
  - Filter UI: View Title Menu의 dropdown (vscode.window.showQuickPick)
    - 옵션: "All", "Attached", "Alive", "Idle", "Orphans"
    - 기본값: "All"
  - last active UI 표시: `formatLastActive()` 함수 사용 (위 인라인 코드 참조)
  - tooltip/description 채우기

  **Must NOT do**:
  - 복잡한 Webview UI로 확장

  **Parallelizable**: NO (Task 3 필요)

  **References**:
  - "TreeDataProvider 패턴" 인라인 코드 스니펫
  - "필터/정렬 기준 수치 정의" 섹션
  - "Orphan 판정 규칙" 섹션

  **상태 계산 코드**:
  ```typescript
  interface SessionStatus {
    attached: boolean;
    panes: number;
    lastActive: number;  // UNIX epoch
    gitDirty: boolean;
    classification: 'attached' | 'alive' | 'idle' | 'orphan';
  }

  async function getSessionStatus(session: string, worktreePath: string): Promise<SessionStatus> {
    const now = Math.floor(Date.now() / 1000);
    
    // attached 여부
    const attachedOutput = await exec(`tmux display-message -p -t ${session} '#{session_attached}'`);
    const attached = attachedOutput.trim() === '1';
    
    // panes 수
    const panesOutput = await exec(`tmux list-panes -t ${session}`);
    const panes = panesOutput.trim().split('\n').length;
    
    // last active
    const activityOutput = await exec(`tmux display-message -p -t ${session} '#{session_activity}'`);
    const lastActive = parseInt(activityOutput.trim(), 10);
    
    // git dirty
    let gitDirty = false;
    if (worktreePath && fs.existsSync(worktreePath)) {
      const gitStatus = await exec(`git -C ${worktreePath} status --porcelain`);
      gitDirty = gitStatus.trim().length > 0;
    }
    
    // classification
    let classification: 'attached' | 'alive' | 'idle' | 'orphan';
    if (attached) {
      classification = 'attached';
    } else if (now - lastActive < 600) {
      classification = 'alive';
    } else {
      classification = 'idle';
    }
    // orphan은 별도 detectOrphans()에서 처리
    
    return { attached, panes, lastActive, gitDirty, classification };
  }
  ```

  **Filter UI 구현**:
  ```typescript
  vscode.commands.registerCommand('tmux.filter', async () => {
    const choice = await vscode.window.showQuickPick(
      ['All', 'Attached', 'Alive', 'Idle', 'Orphans'],
      { placeHolder: 'Filter sessions by status' }
    );
    if (choice) {
      tmuxProvider.setFilter(choice.toLowerCase());
      tmuxProvider.refresh();
    }
  });
  ```

  **TreeItem 구조 예시**:
  ```typescript
  class TmuxSessionItem extends vscode.TreeItem {
    contextValue = 'tmuxSession';
    constructor(sessionName: string, status: SessionStatus, isOrphan: boolean = false) {
      super(sessionName, vscode.TreeItemCollapsibleState.None);
      
      // 아이콘 결정: orphan은 별도 표시
      let icon: string;
      if (isOrphan) {
        icon = '⚠';  // orphan 경고 아이콘
      } else if (status.attached) {
        icon = '●';  // attached (녹색 점)
      } else if (status.classification === 'alive') {
        icon = '◐';  // alive (반원)
      } else {
        icon = '○';  // idle (빈 원)
      }
      
      const dirty = status.gitDirty ? '*' : '';
      const orphanLabel = isOrphan ? ' [orphan]' : '';
      
      this.description = `${icon} ${status.panes}p ${formatLastActive(status.lastActive)}${dirty}${orphanLabel}`;
      this.tooltip = `Session: ${sessionName}\nStatus: ${isOrphan ? 'ORPHAN' : status.classification}\nPanes: ${status.panes}\nLast active: ${formatLastActive(status.lastActive)}\nGit: ${status.gitDirty ? 'dirty' : 'clean'}`;
    }
  }
  
  // Orphan 전용 TreeItem (worktreeOnly의 경우)
  class OrphanWorktreeItem extends vscode.TreeItem {
    contextValue = 'orphanWorktree';
    constructor(worktreePath: string) {
      const slug = path.basename(worktreePath);
      super(`[No Session] ${slug}`, vscode.TreeItemCollapsibleState.None);
      this.description = '⚠ worktree only';
      this.tooltip = `Path: ${worktreePath}\nNo matching tmux session found.\nRight-click to clean up.`;
    }
  }
  ```

  **Orphan 표시 규칙**:
  | 유형 | TreeView 표시 | description | tooltip |
  |------|---------------|-------------|---------|
  | tmuxOnly (세션만 남음) | 세션 이름 | `⚠ 0p [orphan]` | "ORPHAN - worktree not found" |
  | worktreeOnly (worktree만 남음) | `[No Session] slug` | `⚠ worktree only` | 경로 + 정리 안내 |

  **Acceptance Criteria**:
  - [ ] TreeView에 repo 그룹과 세션 표시
  - [ ] 상태 필드(attached 아이콘, panes 수, last active, git dirty) 노출
  - [ ] 정렬이 attached → alive → idle → orphan 순서
  - [ ] Filter QuickPick에서 선택 시 해당 분류만 표시

  **Manual Verification**:
  - 세션 attach/detach 후 Refresh → 아이콘 변화 확인
  - 10분 이상 방치된 세션 → "Xm ago" 또는 "Xh ago" 표시 확인
  - git 변경 후 Refresh → dirty 마크(*) 표시 확인
  - Filter에서 "Attached" 선택 → attached 세션만 표시

- [x] 5. 컨텍스트 메뉴 및 CLI bootstrap 옵션 구현

  **What to do**:
  - 컨텍스트 메뉴: Attach, Open Worktree, Copy Path, Run(claude/opencode/custom)
  - New Pane split 및 New Window 옵션 (tmux 명령으로 구현)
  - CLI 실행은 확장 내부 `Terminal` API로 실행
  - custom 실행 입력 방식: 입력 박스에 명령 입력 후 실행

  **Must NOT do**:
  - 외부 바이너리 설치/업데이트 로직

  **Parallelizable**: NO (Task 4 필요)

  **References**:
  - "Terminal API 패턴" 인라인 코드 스니펫 (createTerminal/sendText)
  - "package.json 기여 포인트 패턴" 인라인 코드 스니펫 (menus 섹션)

  **컨텍스트 메뉴 package.json 등록**:
  ```json
  {
    "contributes": {
      "menus": {
        "view/item/context": [
          { "command": "tmux.attach", "when": "view == tmuxSessions && viewItem == tmuxSession" },
          { "command": "tmux.openWorktree", "when": "view == tmuxSessions && viewItem == tmuxSession" },
          { "command": "tmux.copyPath", "when": "view == tmuxSessions && viewItem == tmuxSession" },
          { "command": "tmux.newPane", "when": "view == tmuxSessions && viewItem == tmuxSession" },
          { "command": "tmux.newWindow", "when": "view == tmuxSessions && viewItem == tmuxSession" },
          { "command": "tmux.runClaude", "when": "view == tmuxSessions && viewItem == tmuxSession" },
          { "command": "tmux.runOpencode", "when": "view == tmuxSessions && viewItem == tmuxSession" },
          { "command": "tmux.runCustom", "when": "view == tmuxSessions && viewItem == tmuxSession" },
          { "command": "tmux.removeTask", "when": "view == tmuxSessions && viewItem == tmuxSession" }
        ]
      },
      "commands": [
        { "command": "tmux.attach", "title": "Attach" },
        { "command": "tmux.openWorktree", "title": "Open Worktree in New Window" },
        { "command": "tmux.copyPath", "title": "Copy Worktree Path" },
        { "command": "tmux.newPane", "title": "New Pane (Split)" },
        { "command": "tmux.newWindow", "title": "New Window" },
        { "command": "tmux.runClaude", "title": "Run: claude" },
        { "command": "tmux.runOpencode", "title": "Run: opencode" },
        { "command": "tmux.runCustom", "title": "Run: Custom Command..." }
      ]
    }
  }
  ```

  **각 명령 구현 상세**:
  
  ```typescript
  // 1. Open Worktree in New Window
  vscode.commands.registerCommand('tmux.openWorktree', (item: TmuxSessionItem) => {
    const worktreeUri = vscode.Uri.file(item.worktreePath);
    // 두 번째 인자 true = 새 창에서 열기
    vscode.commands.executeCommand('vscode.openFolder', worktreeUri, true);
  });

  // 2. Copy Worktree Path
  vscode.commands.registerCommand('tmux.copyPath', (item: TmuxSessionItem) => {
    vscode.env.clipboard.writeText(item.worktreePath);
    vscode.window.showInformationMessage(`Copied: ${item.worktreePath}`);
  });

  // 3. New Pane (Split) - tmux split-pane 명령 사용
  vscode.commands.registerCommand('tmux.newPane', async (item: TmuxSessionItem) => {
    await exec(`tmux split-window -t ${item.sessionName} -c ${item.worktreePath}`);
    // 터미널에서 해당 세션 attach (이미 attach 중이면 자동 반영)
    const terminal = findOrCreateTerminal(item.sessionName);
    terminal.show();
  });

  // 4. New Window - tmux new-window 명령 사용
  vscode.commands.registerCommand('tmux.newWindow', async (item: TmuxSessionItem) => {
    await exec(`tmux new-window -t ${item.sessionName} -c ${item.worktreePath}`);
    const terminal = findOrCreateTerminal(item.sessionName);
    terminal.show();
  });

  // 5. Run: claude
  vscode.commands.registerCommand('tmux.runClaude', (item: TmuxSessionItem) => {
    const terminal = vscode.window.createTerminal({ 
      name: `CLI: claude`, 
      cwd: item.worktreePath 
    });
    terminal.sendText('claude');
    terminal.show();
  });

  // 6. Run: opencode
  vscode.commands.registerCommand('tmux.runOpencode', (item: TmuxSessionItem) => {
    const terminal = vscode.window.createTerminal({ 
      name: `CLI: opencode`, 
      cwd: item.worktreePath 
    });
    terminal.sendText('opencode');
    terminal.show();
  });

  // 7. Run: Custom Command
  vscode.commands.registerCommand('tmux.runCustom', async (item: TmuxSessionItem) => {
    const command = await vscode.window.showInputBox({ 
      prompt: 'Enter command to run',
      placeHolder: 'e.g., npm run dev'
    });
    if (command) {
      const terminal = vscode.window.createTerminal({ 
        name: `CLI: ${command.split(' ')[0]}`, 
        cwd: item.worktreePath 
      });
      terminal.sendText(command);
      terminal.show();
    }
  });
  ```

  **Acceptance Criteria**:
  - [ ] Attach 메뉴 클릭 → 터미널에서 tmux attach
  - [ ] Open Worktree 클릭 → 새 VS Code 창에서 해당 폴더 열림
  - [ ] Copy Path 클릭 → 클립보드에 경로 복사, 알림 표시
  - [ ] New Pane 클릭 → tmux 세션에 새 pane 추가됨
  - [ ] New Window 클릭 → tmux 세션에 새 window 추가됨
  - [ ] Run claude/opencode 클릭 → 해당 CLI 실행
  - [ ] Run Custom 클릭 → 입력창 표시 → 입력한 명령 실행

  **Manual Verification**:
  - TreeView에서 세션 우클릭 → 컨텍스트 메뉴 9개 항목 표시
  - "Open Worktree in New Window" 클릭 → 새 창 열림 확인
  - "Copy Worktree Path" 클릭 → 붙여넣기로 경로 확인
  - "New Pane" 클릭 → `tmux list-panes -t <session>` 수 증가 확인
  - "Run: Custom Command..." → 입력창에 `ls -la` 입력 → 터미널에서 실행

- [x] 6. Remove Task + orphan cleanup + 재시작 자동 attach

  **What to do**:
  - Remove Task: tmux session kill + worktree 삭제
  - 로컬 브랜치만 삭제 옵션 제공 (확인 다이얼로그)
  - orphan 감지 (위 "Orphan 판정 규칙" 참조):
    - **tmuxOnly**: @workdir 경로가 fs.existsSync() 실패
    - **worktreeOnly**: `.worktrees/` 하위 경로인데 매칭 tmux 세션 없음
  - orphan 정리:
    - tmuxOnly: `tmux kill-session -t <session>`
    - worktreeOnly: `git worktree remove <path>` (강제 삭제는 --force 옵션 확인 후)
  - `git worktree remove` 실패 케이스 처리:
    - 현재 cwd가 해당 worktree → 에러 메시지: "Close files in this worktree first."
    - uncommitted 변경 → 확인 다이얼로그: "Worktree has uncommitted changes. Force remove?"
  - VS Code 재시작 자동 attach (위 "자동 Attach 정책" 참조):
    - `activate()` 함수에서 `autoAttachOnStartup()` 호출
    - 다중 세션은 각각 별도 터미널 탭으로 attach
    - 이미 열린 터미널은 재사용 (focus만)
  - tmux 미설치/미실행/@workdir 불일치 시 가이드 제공
  - 삭제 확인 메시지 및 루트 하위 경로 확인

  **Must NOT do**:
  - repo 루트 밖 삭제
  - symlink 경로 삭제 (실제 경로 확인 필요)

  **Parallelizable**: NO (Task 5 필요)

  **References**:
  - "Orphan 판정 규칙" 섹션의 `detectOrphans()` 함수
  - "자동 Attach 정책" 섹션의 `autoAttachOnStartup()` 함수
  - "UI 메시지 템플릿" 섹션

  **Orphan 감지 및 정리 흐름**:
  ```typescript
  async function handleOrphanCleanup(repoRoot: string, repoName: string) {
    const orphans = await detectOrphans(repoRoot, repoName);
    
    // tmuxOnly: 세션만 남은 경우
    for (const session of orphans.tmuxOnly) {
      const choice = await vscode.window.showWarningMessage(
        `Session "${session.name}" has no worktree. Remove session?`,
        'Remove', 'Keep'
      );
      if (choice === 'Remove') {
        await exec(`tmux kill-session -t ${session.name}`);
      }
    }
    
    // worktreeOnly: worktree만 남은 경우
    for (const wtPath of orphans.worktreeOnly) {
      // uncommitted 변경 확인
      const gitStatus = await exec(`git -C ${wtPath} status --porcelain`);
      const hasChanges = gitStatus.trim().length > 0;
      
      let message = `Worktree at "${wtPath}" has no session. Remove worktree?`;
      if (hasChanges) {
        message = `Worktree at "${wtPath}" has uncommitted changes. Force remove?`;
      }
      
      const choice = await vscode.window.showWarningMessage(message, 'Remove', 'Keep');
      if (choice === 'Remove') {
        const forceFlag = hasChanges ? '--force' : '';
        try {
          await exec(`git worktree remove ${forceFlag} ${wtPath}`);
        } catch (e) {
          vscode.window.showErrorMessage(`Failed to remove worktree: ${e.message}`);
        }
      }
    }
  }
  ```

  **삭제 안전장치**:
  ```typescript
  async function removeTask(session: TmuxSessionItem) {
    const worktreePath = session.worktreePath;
    const repoRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    
    // 1. 경로 검증: repo 루트 하위인지 확인
    const realPath = fs.realpathSync(worktreePath);  // symlink 해결
    if (!realPath.startsWith(repoRoot)) {
      vscode.window.showErrorMessage('Cannot delete outside repo root.');
      return;
    }
    
    // 2. 현재 cwd가 해당 worktree인지 확인
    const activeTerminal = vscode.window.activeTerminal;
    // (터미널의 cwd 확인은 제한적이므로 경고만 표시)
    
    // 3. 확인 메시지
    const confirm = await vscode.window.showWarningMessage(
      'Delete session and worktree? This cannot be undone.',
      { modal: true },
      'Delete'
    );
    if (confirm !== 'Delete') return;
    
    // 4. 삭제 실행
    await exec(`tmux kill-session -t ${session.sessionName}`);
    await exec(`git worktree remove ${worktreePath}`);
    
    // 5. 브랜치 삭제 옵션
    const branchName = `task/${session.slug}`;
    const deleteBranch = await vscode.window.showWarningMessage(
      `Also delete local branch "${branchName}"?`,
      'Delete Branch', 'Keep Branch'
    );
    if (deleteBranch === 'Delete Branch') {
      await exec(`git branch -d ${branchName}`);
    }
    
    // 6. TreeView 갱신
    tmuxProvider.refresh();
  }
  ```

  **재시작 자동 attach 트리거**:
  ```typescript
  export async function activate(context: vscode.ExtensionContext) {
    // ... 기타 초기화 ...
    
    // 재시작 시 자동 attach
    await autoAttachOnStartup(context);
  }
  ```

  **Acceptance Criteria**:
  - [ ] Remove Task 실행 시 세션 + worktree 삭제
  - [ ] repo 루트 밖 삭제 시도 → 에러 메시지 표시, 삭제 안 됨
  - [ ] symlink 경로도 실제 경로로 해결 후 검증
  - [ ] orphan 항목(tmuxOnly, worktreeOnly) TreeView에 표시
  - [ ] orphan 정리 시 확인 다이얼로그 표시
  - [ ] uncommitted 변경 있는 worktree 삭제 시 force 확인
  - [ ] 재시작 후 세션 자동 attach (터미널 탭에 표시)
  - [ ] 이미 열린 터미널은 재사용 (새 탭 안 만듦)

  **Manual Verification**:
  - Remove Task 후 `tmux list-sessions`와 `git worktree list`로 삭제 확인
  - repo 루트 밖 경로로 시도 → 에러 메시지 확인
  - orphan 세션/worktree 생성 후 Refresh → orphan 표시 확인
  - orphan 정리 실행 → 다이얼로그 후 삭제 확인
  - VS Code 재시작 후 → 자동으로 터미널 탭 열리고 tmux attach 실행 확인
  - 같은 세션 터미널이 이미 열려있을 때 재시작 → 새 탭 안 만들어지고 기존 탭 focus

---

## Commit Strategy
- 모든 작업 완료 후 단일 커밋
- 메시지: `feat: add tmux worktree session manager`
- 테스트 없음 → 수동 검증 결과 기록

---

## Success Criteria
- TMUX 탭 제공 및 worktree+tmux 자동화 기능 작동
- 상태/정렬/필터/컨텍스트 메뉴 동작
- 재시작 자동 attach 및 orphan 정리 동작
