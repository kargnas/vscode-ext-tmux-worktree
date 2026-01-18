# CLI Overhaul: twt TUI Redesign

## Context

### Original Request
사용자가 `twt` CLI TUI 앱의 디자인이 "졸라 구리다"고 피드백. 정렬, 검색, git status, worktree 개수, 최근 수정순 정렬, 활성 세션 필터 등 기능 요청.

### Interview Summary
**Key Discussions**:
- **Layout Style**: Style C 선택 - `● gigs-api  [3] M:2  2h ago`
- **Tab Navigation**: "All Projects" | "Active Sessions" 두 탭 (Tab 키 + 마우스)
- **Sorting**: Name, Recent (mtime + OpenCode), Active
- **Filtering**: Spacebar로 체크박스 토글
- **Async Loading**: Git status는 비동기 로드 (Option A)
- **Scope**: Project List + Worktree List 둘 다 적용

**Research Findings**:
- OpenCode sessions: `~/.local/share/opencode/storage/session/[ID]/ses_*.json`
- Go-git gitignore: `github.com/go-git/go-git/v5/plumbing/format/gitignore`
- Bubble Tea: Custom ItemDelegate, tea.Cmd for async, activeTab pattern

### Metis Review
**Identified Gaps** (addressed):
- **프로젝트 수 87개**: 캐싱/최적화 적용 예정
- **mtime 깊이**: 상위 폴더만 스캔 (src/, lib/ 등 1레벨)
- **Active 정의**: tmux session 존재 = active
- **필터 상태**: 앱 재시작 시 초기화
- **로딩 표시**: `...` 사용
- **에러 처리**: `--` 표시

---

## Critical Definitions (명확한 기준)

### Active 판별 로직
**Project가 Active인 조건**: 해당 프로젝트의 어떤 worktree에 대해 tmux 세션이 존재하면 Active.

**매칭 알고리즘**:
1. `tmux.ListSessions()` 호출 → 모든 tmux 세션 목록 획득
2. 각 프로젝트의 각 worktree에 대해:
   - `sessionName = naming.GetSessionName(repoName, slug)` 계산
   - `sessionName`이 tmux 세션 목록에 존재하면 Active
3. 참조 파일:
   - `cli/pkg/tmux/tmux.go:18-51` - `ListSessions()` 함수
   - `cli/pkg/naming/naming.go` - `GetSessionName()`, `GetSlugFromWorktree()` 함수

**Worktree가 Active인 조건**: 해당 worktree의 정확한 세션명이 tmux에 존재.
- `sessionName = naming.GetSessionName(repoName, slug)`
- slug는 `naming.GetSlugFromWorktree(wtPath, repoName, isMain)`으로 계산

### Recent 시간 계산 규칙
**결합 공식**: `recentTime = max(mtime, opencodeTime)`

- `mtime`: gitignore-aware 파일 스캔 결과 중 가장 최근 수정 시간
- `opencodeTime`: OpenCode 세션 JSON의 `time.updated` 값 (Unix ms → time.Time)
- 둘 중 더 최근 시간을 사용
- 둘 다 없으면 `time.Time{}` (zero value) → UI에서 "N/A" 표시

### 정렬 옵션 (확정)
| 키 | 정렬 기준 | 순서 |
|---|---------|-----|
| `s` 1회 | **Name** | A-Z (오름차순) |
| `s` 2회 | **Recent** | 최신순 (내림차순, recentTime 기준) |
| `s` 3회 | **Active** | Active 먼저, 그 다음 Name 순 |
| `s` 4회 | (순환) Name으로 복귀 |

**기본 정렬**: Recent (앱 시작 시)

### 필터 옵션 (확정)
| 필터 | Spacebar 토글 | 기본값 |
|-----|-------------|-------|
| **Dirty Only** | 체크 시 git dirty 프로젝트만 표시 | OFF |

**필터 UI 위치**: 리스트 상단에 `[ ] Dirty only` 형태로 표시
**필터 상태 지속**: 앱 재시작 시 OFF로 초기화

### 상대 시간 포맷 규칙
| 경과 시간 | 표시 형식 |
|----------|----------|
| < 1분 | `just now` |
| 1-59분 | `Nm ago` (예: `5m ago`) |
| 1-23시간 | `Nh ago` (예: `2h ago`) |
| 1-6일 | `Nd ago` (예: `3d ago`) |
| 7-29일 | `Nw ago` (예: `2w ago`) |
| 30일+ | `Nmo ago` (예: `2mo ago`) |
| zero time | `N/A` |

**구현 참조**: Go 표준 `time.Since()` + 커스텀 포맷터 (별도 라이브러리 불필요)

### Async Git Status 구현 패턴
**파싱 규칙 (`git status --porcelain` 기준)**:
| 상태 코드 (XY) | 카운트 대상 |
|--------------|------------|
| `??` | Untracked |
| `A ` or ` A` | Added |
| `M ` or ` M` | Modified |
| `D ` or ` D` | Deleted |
| `R ` | Modified (단순화) |
| `UU` | Modified (Conflict) |

**표시 규칙**:
- UI에는 `M:{Modified} A:{Added+Untracked} D:{Deleted}` 형태로 표시 (VS Code Ext와 유사하게 합산)
- 로딩 중: `...`
- 에러/타임아웃: `--`

**메시지 타입 정의**:
```go
// cli/internal/ui/messages.go (또는 model.go에 추가)
type gitStatusMsg struct {
    RepoPath string
    Status   *git.GitStatus  // nil이면 에러
    Error    error
}
```

**상태 저장 위치**: `Model.gitStatuses map[string]*git.GitStatus`
- Key: repo path
- Value: GitStatus 또는 nil (로딩 중/에러)

**갱신 플로우**:
1. `Init()` 또는 프로젝트 목록 로드 시: 각 프로젝트에 대해 `tea.Cmd` 반환
2. `tea.Cmd`가 `git.GetStatus(path)` 호출 → `gitStatusMsg` 반환
3. `Update()`에서 `gitStatusMsg` 수신 → `m.gitStatuses[msg.RepoPath] = msg.Status`
4. `View()`에서 `m.gitStatuses[path]`가 nil이면 `...`, 있으면 `M:N` 표시

**참조 패턴**: `cli/internal/ui/model.go:276-286` (기존 `worktreesMsg` async 패턴)

### OpenCode 세션 경로/매칭 규칙
**매칭 알고리즘**:
1. `filepath.Clean(repoPath)`로 정규화
2. 세션 JSON의 `directory` 필드도 `filepath.Clean()` 후 비교
3. **Exact Match Only**: 경로가 정확히 일치하는 세션만 해당 프로젝트의 세션으로 인정
4. **Worktree 제외**: Worktree 경로는 별도 프로젝트가 아닌 이상, 메인 repo의 recent time에 영향을 주지 않음 (단순화)
5. **다중 세션**: 동일 프로젝트에 여러 세션이 있을 경우, 가장 최근 `time.updated` 사용

**실패 정책**:
- 위 경로들이 존재하지 않거나 읽기 권한이 없으면 OpenCode 통합 기능을 **조용히 Skip** (로그만 남김).
- 결과: `opencodeTime`은 zero value(`time.Time{}`)가 됨.

### mtime 스캔 범위/대상 규칙 (단일 표준)
**스캔 깊이**: **Depth 2 제한**
- Level 0: Repo Root의 파일들 (검사)
- Level 1: Repo Root의 직계 디렉토리들 (내부 파일 검사)
- Level 2+: 더 깊은 하위 디렉토리는 **SkipDir**

**스캔 알고리즘**:
1. `filepath.WalkDir` 사용
2. `.gitignore` 로딩 (go-git 라이브러리 활용)
3. **Skip 조건 (우선순위 순)**:
   - Level 2 이상(깊이 > 1)인 디렉토리: **SkipDir**
   - 표준 제외 폴더 (`.git`, `node_modules`, `dist`, `build`, `vendor`, `.sisyphus`): **SkipDir**
   - `.gitignore`에 매칭되는 디렉토리: **SkipDir**
   - `.gitignore`에 매칭되는 파일: 무시
4. **타임아웃**: 프로젝트당 2초 (넘으면 현재까지 찾은 최신 시간 반환)
5. **실패 정책**: 스캔 실패 시 `N/A` (zero time)

### 에러/타임아웃 및 필터 표시 규칙 (확정)
| 데이터 상태 | UI 표시 | Dirty 필터 동작 |
|-----------|--------|---------------|
| Dirty (M/A/D > 0) | `M:1` 등 | **Show** |
| Clean (All 0) | (공백) | **Hide** |
| Loading | `...` | **Show** (상태 미확인) |
| Error/Timeout | `--` | **Show** (상태 미확인) |

**UI 위치**:
- Git Status 영역은 고정 너비(예: 12 chars) 확보
- Clean일 때는 공백으로 비워둠 (깔끔함 유지)

### Deduplication 규칙 (TUI 적용)
**VS Code Extension AGENTS.md 규칙 예외 명시**:
- `AGENTS.md`의 "Two-line Layout"은 터미널 환경(80x24)에 부적합하므로 **TUI는 예외적으로 Style C(Compact Single Line) 적용**.
- 단, **Naming 규칙(`pkg/naming`)**과 **Prunable 필터링**은 엄격히 준수.

**TUI에서의 Dedup 적용**:
1. **Project List**: 중복 없음 (각 프로젝트는 고유 경로)

**TUI에서의 Dedup 적용**:
1. **Project List**: 중복 없음 (각 프로젝트는 고유 경로)
2. **Worktree List**: `git worktree list`에서 `prunable` 자동 필터링 (기존 `git.ListWorktrees()` 로직 유지)
3. **Active Sessions 탭**: tmux 세션 있는 프로젝트만 표시 (중복 경로 발생 불가)

---

## Work Objectives

### Core Objective
`twt` CLI TUI를 현대적인 디자인과 풍부한 기능(탭, 정렬, 필터, async git status, recent sorting)으로 전면 개편.

### Concrete Deliverables
- `cli/internal/ui/model.go` - Tab 기반 새 UI 아키텍처
- `cli/internal/ui/styles.go` - Lipgloss 스타일 정의
- `cli/internal/ui/delegate.go` - Custom list item delegate
- `cli/pkg/git/status.go` - Git status 파싱
- `cli/pkg/recent/recent.go` - mtime + OpenCode 세션 스캔

### Definition of Done
- [x] `twt` 실행 시 Tab UI로 "All Projects" | "Active Sessions" 표시
- [x] 각 프로젝트가 `● name [wt] M:N time` 형식으로 표시
- [x] Git status가 비동기로 로드되며 `...` → `M:N` 으로 전환
- [x] Tab 키로 탭 전환, Spacebar로 필터 토글 동작
- [x] Worktree 화면도 동일 스타일 적용
- [x] `bun run compile && npx vsce package --no-dependencies && antigravity --install-extension vscode-tmux-worktree-0.0.13.vsix --force` 성공

### Must Have
- Tab UI ("All Projects" | "Active Sessions")
- Compact layout: `● name [count] M:N time`
- Async git status loading with `...` placeholder
- Sorting: Name / Recent / Active
- Filter: Spacebar checkbox toggle
- VS Code extension naming 호환 (`pkg/naming` 유지)

### Must NOT Have (Guardrails)
- ❌ `config.json` 스키마 변경 (하위호환 유지)
- ❌ tmux 세션 자동 생성/삭제 기능
- ❌ OpenCode 세션 파일 수정
- ❌ Custom list widget 처음부터 구현 (bubbles 활용)
- ❌ 테마/색상 설정 기능
- ❌ 캐시 파일 생성
- ❌ fuzzy search 커스텀 구현 (기존 bubbles/list 사용)

---

## Verification Strategy (MANDATORY)

### Test Decision
- **Infrastructure exists**: NO (Go 프로젝트에 테스트 없음)
- **User wants tests**: Manual-only (TUI 특성상 자동 테스트 어려움)
- **QA approach**: Manual verification via interactive_bash (tmux)

### Manual QA Procedures
각 TODO 완료 후:
1. `cd cli && go build -o twt . && ./twt` 실행
2. 기능별 수동 검증 (키 입력, 화면 확인)
3. `bun run compile && npx vsce package --no-dependencies && antigravity --install-extension vscode-tmux-worktree-0.0.13.vsix --force`

---

## Task Flow

```
1 (Styles) ──┬── 2 (Git Status) ──┬── 5 (Tab UI) ── 6 (Project List) ── 7 (Worktree List) ── 8 (Integration)
             │                    │
             └── 3 (Recent)  ─────┘
                    │
                    └── 4 (OpenCode) ─┘
```

## Parallelization

| Group | Tasks | Reason |
|-------|-------|--------|
| A | 2, 3, 4 | 독립적인 데이터 레이어 |

| Task | Depends On | Reason |
|------|------------|--------|
| 5 | 1 | 스타일 정의 필요 |
| 6 | 2, 3, 4, 5 | 모든 데이터 + UI 인프라 |
| 7 | 6 | Project List 패턴 재사용 |
| 8 | 7 | 전체 통합 |

---

## TODOs

- [x] 1. Lipgloss 스타일 시스템 구축

  **What to do**:
  - `cli/internal/ui/styles.go` 파일 생성
  - 색상 팔레트 정의 (Active: cyan, Inactive: gray, Dirty: yellow, etc.)
  - Tab 스타일 (active/inactive border)
  - List item 스타일 (selected/normal)
  - Status indicator 스타일 (●, ○, ...)

  **Must NOT do**:
  - 테마 시스템 구현
  - 설정 파일에서 색상 읽기

  **Parallelizable**: YES (독립 작업)

  **References**:
  - `cli/internal/ui/model.go:80-115` - 기존 스타일 정의 (이동 대상)
  - Bubble Tea tabs example: `github.com/charmbracelet/bubbletea/examples/tabs`

  **Acceptance Criteria**:
  - [ ] `cli/internal/ui/styles.go` 파일 존재
  - [ ] `go build` 성공
  - [ ] 기존 `model.go`의 인라인 스타일들이 `styles.go`로 이동

  **Commit**: YES
  - Message: `refactor(cli): extract lipgloss styles to dedicated file`
  - Files: `cli/internal/ui/styles.go`, `cli/internal/ui/model.go`

---

- [x] 2. Git Status 파싱 모듈 구현

  **What to do**:
  - `cli/pkg/git/status.go` 파일 생성
  - `GitStatus` struct: `Modified`, `Added`, `Deleted`, `Untracked` int 필드
  - `GetStatus(repoPath string) (*GitStatus, error)` 함수
  - `git status --porcelain` 파싱
  - 타임아웃 2초 설정

  **Must NOT do**:
  - staged/unstaged 구분 (단순 카운트만)
  - 파일 목록 반환

  **Parallelizable**: YES (with 3, 4)

  **References**:
  - `cli/pkg/git/git.go:21-59` - 기존 CLI 파싱 패턴 (`git worktree list --porcelain` 파싱 예시)

  **Acceptance Criteria**:
  - [ ] `cli/pkg/git/status.go` 존재
  - [ ] `go build` 성공
  - [ ] 테스트: `go run ./cli` 후 git dirty repo에서 status 표시

  **Commit**: YES
  - Message: `feat(cli): add git status parsing module`
  - Files: `cli/pkg/git/status.go`

---

- [x] 3. Recent (mtime) 스캔 모듈 구현

  **What to do**:
  - `cli/pkg/recent/recent.go` 파일 생성
  - `GetRecentTime(repoPath string) (time.Time, error)` 함수
  - gitignore-aware 파일 스캔 (go-git 사용)
  - 스캔 깊이: 상위 폴더만 (src/, lib/, app/, pkg/ 등 1레벨)
  - 타임아웃 2초 per project
  - `GetCombinedRecentTime(repoPath string) time.Time` 함수 추가:
    - `mtime := GetRecentTime(repoPath)`
    - `ocTime := GetOpenCodeLastUsed(repoPath)` (Task 4)
    - `return max(mtime, ocTime)` - 둘 중 더 최근 시간 반환

  **Must NOT do**:
  - 전체 프로젝트 재귀 스캔
  - 캐시 파일 생성

  **Parallelizable**: YES (with 2, 4)

  **References**:
  - `github.com/go-git/go-git/v5/plumbing/format/gitignore` - gitignore 파싱
  - `cli/pkg/discovery/discovery.go:17-31` - goroutine 패턴

  **Acceptance Criteria**:
  - [ ] `cli/pkg/recent/recent.go` 존재
  - [ ] `go.mod`에 `go-git` 의존성 추가
  - [ ] `go build` 성공

  **Commit**: YES
  - Message: `feat(cli): add gitignore-aware mtime scanner`
  - Files: `cli/pkg/recent/recent.go`, `cli/go.mod`, `cli/go.sum`

---

- [x] 4. OpenCode 세션 통합

  **What to do**:
  - `cli/pkg/recent/opencode.go` 파일 생성
  - `GetOpenCodeLastUsed(repoPath string) (time.Time, error)` 함수
  - `~/.local/share/opencode/storage/session/*/ses_*.json` 스캔
  - JSON의 `directory` 필드로 경로 매칭, `time.updated` 추출

  **Must NOT do**:
  - OpenCode 파일 수정
  - 메시지 내용 읽기

  **Parallelizable**: YES (with 2, 3)

  **References**:
  - OpenCode 세션 구조: `~/.local/share/opencode/storage/session/[ID]/ses_*.json`
  - JSON 구조: `{"directory": "/path", "time": {"updated": 1768711662540}}`

  **Acceptance Criteria**:
  - [ ] `cli/pkg/recent/opencode.go` 존재
  - [ ] `go build` 성공
  - [ ] OpenCode 세션 있는 프로젝트에서 시간 반환

  **Commit**: YES
  - Message: `feat(cli): integrate OpenCode session timestamps`
  - Files: `cli/pkg/recent/opencode.go`

---

- [x] 5. Tab UI 인프라 구축

  **What to do**:
  - `cli/internal/ui/tabs.go` 파일 생성 (또는 model.go 확장)
  - `TabType` enum: `TabAllProjects`, `TabActiveSessions`
  - `activeTab` 상태 추가
  - Tab 키 핸들러 (탭 전환)
  - Tab 헤더 렌더링 (active/inactive 스타일)

  **Must NOT do**:
  - 3개 이상 탭
  - 탭 순서 변경 기능

  **Parallelizable**: NO (depends on 1)

  **References**:
  - `cli/internal/ui/model.go:17-24` - 기존 state enum 패턴
  - Bubble Tea tabs: `github.com/charmbracelet/bubbletea/examples/tabs`
  - `cli/internal/ui/styles.go` (Task 1에서 생성)

  **Acceptance Criteria**:
  - [ ] Tab 키로 "All Projects" ↔ "Active Sessions" 전환
  - [ ] 활성 탭에 다른 스타일 적용
  - [ ] `go build && ./twt` 실행 시 탭 UI 표시

  **Commit**: YES
  - Message: `feat(cli): implement tab navigation UI`
  - Files: `cli/internal/ui/model.go` (또는 tabs.go)

---

- [x] 6. Project List 개편 (Style C + Async)

  **What to do**:
  - Custom `list.ItemDelegate` 구현 (`cli/internal/ui/delegate.go`)
  - Style C 형식: `● gigs-api  [3] M:2  2h ago`
  - Async git status: 초기 `...` → 로드 완료 시 `M:N`
  - Worktree count 표시
  - Recent time 표시 (상대 시간: "2h ago", "3d ago")
  - Active indicator (● = active, ○ = inactive)
  - 정렬: `s` 키로 Name → Recent → Active 순환 (기본: Recent)
  - 필터: Spacebar로 "Dirty Only" 토글 (리스트 상단에 `[ ] Dirty only` 표시)

  **Active 판별 구현**:
  ```go
  // 1. tmux 세션 목록 조회
  sessions, _ := tmux.ListSessions()
  sessionNames := make(map[string]bool)
  for _, s := range sessions {
      sessionNames[s.Name] = true
  }
  
  // 2. 각 프로젝트의 worktree별 세션명 체크
  for _, wt := range worktrees {
      slug := naming.GetSlugFromWorktree(wt.Path, repoName, wt.IsMain)
      sessionName := naming.GetSessionName(repoName, slug)
      if sessionNames[sessionName] {
          project.IsActive = true
          break
      }
  }
  ```

  **Must NOT do**:
  - fuzzy search 커스텀 구현 (기존 bubbles/list 사용)
  - 복잡한 정렬 UI

  **Parallelizable**: NO (depends on 2, 3, 4, 5)

  **References**:
  - `cli/internal/ui/model.go:68-136` - 기존 NewModel 패턴
  - `cli/internal/ui/model.go:276-286` - async 메시지 패턴 (worktreesMsg)
  - `cli/pkg/tmux/tmux.go:18-51` - `ListSessions()` 함수 (Active 판별용)
  - `cli/pkg/naming/naming.go` - `GetSessionName()`, `GetSlugFromWorktree()` (세션명 계산)
  - `cli/pkg/git/status.go` (Task 2)
  - `cli/pkg/recent/recent.go` (Task 3)
  - Bubble Tea list-fancy: `github.com/charmbracelet/bubbletea/examples/list-fancy`

  **Acceptance Criteria**:
  - [ ] 각 프로젝트가 `● name [N] M:N time` 형식으로 표시
  - [ ] Git status가 `...` → `M:N`으로 전환 (async)
  - [ ] `s` 키로 정렬 변경 (Name → Recent → Active 순환, 기본 Recent)
  - [ ] Spacebar로 "Dirty Only" 필터 토글, 상단에 `[ ] Dirty only` 표시
  - [ ] "Active Sessions" 탭에서는 tmux 세션 있는 것만 표시

  **Commit**: YES
  - Message: `feat(cli): redesign project list with Style C and async loading`
  - Files: `cli/internal/ui/delegate.go`, `cli/internal/ui/model.go`

---

- [x] 7. Worktree List 개편

  **What to do**:
  - Worktree List에도 Style C 적용
  - 형식: `● main  [branch] M:N  5m ago`
  - Active indicator: 해당 worktree의 tmux 세션 존재 여부
  - Git status: 해당 worktree 디렉토리 기준
  - Recent time: worktree 디렉토리 mtime

  **Active 판별 구현 (Worktree 단위)**:
  ```go
  // worktree별 세션 존재 여부 체크
  slug := naming.GetSlugFromWorktree(wt.Path, repoName, wt.IsMain)
  sessionName := naming.GetSessionName(repoName, slug)
  wt.IsActive = sessionNames[sessionName]
  ```

  **Must NOT do**:
  - Tab UI (worktree에서는 불필요)
  - 정렬/필터 (worktree 수가 적으므로)

  **Parallelizable**: NO (depends on 6)

  **References**:
  - `cli/internal/ui/model.go:227-243` - 기존 worktreesMsg 핸들러
  - `cli/internal/ui/delegate.go` (Task 6에서 생성) - 재사용
  - `cli/pkg/tmux/tmux.go:18-51` - `ListSessions()` (Active 판별)
  - `cli/pkg/naming/naming.go` - `GetSessionName()`, `GetSlugFromWorktree()`

  **Acceptance Criteria**:
  - [ ] Worktree 선택 시 `● slug [branch] M:N time` 형식 표시
  - [ ] 해당 worktree에 tmux 세션 있으면 ● 표시, 없으면 ○ 표시
  - [ ] ESC로 Project List 복귀 시 UI 유지

  **Commit**: YES
  - Message: `feat(cli): apply Style C to worktree list`
  - Files: `cli/internal/ui/model.go`

---

- [x] 8. 통합 테스트 및 마무리

  **What to do**:
  - 전체 플로우 테스트: 앱 실행 → 탭 전환 → 정렬 → 필터 → 프로젝트 선택 → Worktree 선택 → tmux attach
  - 엣지 케이스 확인:
    - 프로젝트 0개
    - Active Sessions 탭에 세션 0개
    - Git status 로딩 실패
    - 긴 프로젝트명 truncation
  - 최종 빌드 및 설치 검증

  **Must NOT do**:
  - 새 기능 추가

  **Parallelizable**: NO (최종 단계)

  **References**:
  - `AGENTS.md` - 빌드/설치 명령어
  - 모든 이전 Task 결과물

  **Acceptance Criteria**:
  - [ ] `twt` 실행 → Tab 전환 → 정렬 → 필터 → 선택 → attach 전체 플로우 동작
  - [ ] 빈 목록 시 적절한 메시지 표시
  - [ ] 긴 이름 truncation 확인
  - [ ] `bun run compile && npx vsce package --no-dependencies && antigravity --install-extension vscode-tmux-worktree-0.0.13.vsix --force` 성공

  **Commit**: YES
  - Message: `chore(cli): finalize TUI overhaul`
  - Files: (필요시 minor fixes)

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 1 | `refactor(cli): extract lipgloss styles` | styles.go, model.go | `go build` |
| 2 | `feat(cli): add git status parsing` | git/status.go | `go build` |
| 3 | `feat(cli): add mtime scanner` | recent/recent.go | `go build` |
| 4 | `feat(cli): integrate OpenCode sessions` | recent/opencode.go | `go build` |
| 5 | `feat(cli): implement tab navigation` | model.go | `./twt` 실행 |
| 6 | `feat(cli): redesign project list` | delegate.go, model.go | `./twt` 전체 테스트 |
| 7 | `feat(cli): apply Style C to worktree` | model.go | `./twt` worktree 테스트 |
| 8 | `chore(cli): finalize TUI overhaul` | various | 빌드+설치 |

---

## Success Criteria

### Verification Commands
```bash
cd cli && go build -o twt . && ./twt  # TUI 실행
# Tab 키로 탭 전환 확인
# s 키로 정렬 변경 확인
# Spacebar로 필터 토글 확인
# Enter로 프로젝트/worktree 선택 확인

bun run compile && npx vsce package --no-dependencies && antigravity --install-extension vscode-tmux-worktree-0.0.13.vsix --force  # VS Code ext 빌드
```

### Final Checklist
- [x] Tab UI 동작 (All Projects ↔ Active Sessions)
- [x] Style C 형식 표시 (`● name [N] M:N time`)
- [x] Async git status 로딩 (`...` → `M:N`)
- [x] 정렬 동작 (Name / Recent / Active)
- [x] 필터 동작 (Spacebar 토글)
- [x] Worktree List도 동일 스타일
- [x] VS Code extension 빌드 성공
- [x] 기존 `pkg/naming` 호환성 유지
