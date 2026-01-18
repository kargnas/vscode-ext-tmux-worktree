# Draft: TUI 버그 수정

## Requirements (confirmed)
- 사용자가 스크린샷으로 제시한 3가지 문제 수정 필요

## 문제 분석

### 1. 세션 attach 에러 (`Error attaching to session: exit status 1`)
- **원인**: tmux 외부에서 실행해도 에러 발생
- **원인**: `AttachSession()` 함수가 stdin/stdout 연결 없이 `cmd.Run()` 호출
- **원인**: Bubble Tea가 AltScreen 모드로 터미널을 점유 중인데 `cmd.Run()` 호출
- **해결 방향**: 
  - TUI 종료 후 main.go에서 `syscall.Exec`으로 프로세스 교체
  - 또는 `os/exec`에서 `Stdin`, `Stdout`, `Stderr`를 `os.Stdin/Stdout/Stderr`에 연결

### 2. 탭 UI 깨짐 (텍스트 없이 빈 박스)
- **원인**: 방향키로 리스트 스크롤하면 바로 발생
- **추정**: bubbles/list 컴포넌트가 화면 전체를 다시 그리면서 탭 영역까지 덮어씀
- **해결 방향**: 
  - 리스트의 SetSize()에서 올바른 높이 계산
  - 또는 View()에서 탭 영역을 리스트 영역과 분리하여 렌더링

### 3. 이상한 gap (필터 영역과 리스트 사이)
- **원인**: `renderFilterLine()` 마지막에 `"\n\n"` (2줄 공백)
- **원인**: `headerHeight := 4`가 실제 헤더(탭 1줄 + 필터 1줄 = 2줄)보다 큼
- **해결 방향**: 
  - `"\n\n"` → `"\n"` 변경
  - `headerHeight` 조정

## Technical Decisions
- (대기 중)

## Research Findings
- `tmux.go:107-111`: `isInsideTmux()` 함수가 하드코딩된 `return false`
- `tmux.go:101-104`: `AttachSession()`에서 stdin 연결 없이 `cmd.Run()` 호출
- `model.go:187`: `headerHeight := 4` (과다)
- `model.go:497`: `"\n\n"` (불필요한 공백)

## Open Questions
- (모두 해결됨)

## Scope Boundaries
- INCLUDE: 3가지 버그 수정
- EXCLUDE: 새 기능 추가, UI 디자인 변경
