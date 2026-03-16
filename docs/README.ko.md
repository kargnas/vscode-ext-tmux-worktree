# TMUX Worktree

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/kargnas.vscode-tmux-worktree?label=VS%20Marketplace&color=blue)](https://marketplace.visualstudio.com/items?itemName=kargnas.vscode-tmux-worktree) [![Blog](https://img.shields.io/badge/Blog-kargn.as-green)](https://kargn.as)
**VS Code에서 tmux 세션과 git worktree를 함께 관리하세요.**

🌏 **다른 언어로 읽기:** [English](../README.md) | **한국어** | [简体中文](README.zh-CN.md) | [繁體中文 (台灣)](README.zh-TW.md) | [繁體中文 (香港)](README.zh-HK.md) | [日本語](README.ja.md)

![TMUX Worktree 스크린샷](https://raw.githubusercontent.com/kargnas/vscode-ext-tmux-worktree/main/docs/screenshot.png)

## 왜 더 완성도 있게 느껴지나

- **이미지 인식 터미널 붙여넣기**: `Cmd+V` / `Ctrl+Shift+V`에서 텍스트는 일반 붙여넣기, 이미지는 파일 경로 입력으로 자동 분기됩니다.
- **Remote-SSH 클립보드 브리지**: 로컬 클립보드 이미지를 원격 터미널로 별도 업로드 없이 바로 전달합니다.
- **충돌 방지 세션 식별자**: `repo-name + path hash` 네임스페이스와 슬러그 충돌 해소 로직으로 같은 이름 저장소도 안전하게 구분합니다.
- **레거시 호환 마이그레이션**: `@workdir` 기준으로 기존 세션 prefix도 계속 인식합니다.
- **No-git 폴백 가시성**: git이 없는 폴더도 `current project (no git)`로 트리에 표시됩니다.

## 왜 만들었나요?

여러 브랜치를 동시에 작업하면서 `git worktree`와 `tmux`를 쓰시나요? 그럼 매번 둘을 따로 관리하는 게 얼마나 귀찮은지 아실 겁니다. 이 확장 프로그램이 그 간극을 메워줍니다:

- **원클릭으로** worktree와 tmux 세션을 한 번에 생성
- **트리 뷰**에서 모든 worktree와 tmux 상태를 한눈에 확인
- worktree 폴더를 열면 **자동으로** 해당 tmux 세션에 연결
- VS Code를 껐다 켜도 **작업 컨텍스트를 잃지 않음** — 세션은 계속 살아있어요

### AI 코딩 에이전트와 찰떡궁합

Claude Code, Codex, OpenCode, Gemini CLI 같은 AI 코딩 에이전트를 tmux 세션 안에서 돌리세요. 에이전트는 백그라운드에서 계속 작업하고, 여러분은 언제든 재접속할 수 있습니다. 심지어 폰에서 Termux로도요.

## 주요 기능

### 🌳 탐색기 뷰
사이드바에 git worktree와 연결된 tmux 세션들이 한눈에 보입니다. 세션 상태, 패널 개수, 마지막 활동 시간까지 다 표시됩니다.

### ⚡ 원클릭 태스크 생성
새 git 브랜치 + worktree + tmux 세션을 한 번에 만들 수 있어요. 새 기능 작업을 바로 시작하세요.
기본 생성 위치는 `~/.tmux-worktrees/<repo-name-hash>/`라서 저장소 루트가 지저분해지지 않고, 여러 저장소 사이 경로 충돌도 피할 수 있습니다.

### 🔗 스마트 연결
- **터미널에서 연결** — VS Code 통합 터미널에서 tmux 세션 열기
- **에디터에서 연결** — tmux 세션을 에디터 탭으로 띄우기
- **자동 연결** — worktree 폴더 열면 자동으로 세션 연결
- **크기 안정화 연결** — attach 직전에 PTY 크기를 재시도 측정하고 대상 tmux 윈도우를 강제로 resize한 뒤 `window-size latest`를 복구해, 풀스크린 TUI의 80x24 초기 렌더링과 지속적인 화면 잘림을 함께 줄입니다

### 🧹 고아 세션 정리
worktree가 삭제된 후 남아있는 tmux 세션을 찾아서 정리합니다. 환경을 깔끔하게 유지하세요.

### 🖥️ 세션 관리
- 컨텍스트 메뉴에서 패널 분할과 새 윈도우 생성
- worktree 경로를 클립보드에 복사
- worktree를 새 VS Code 창으로 열기
- 이름으로 세션 필터링

### 📋 스마트 붙여넣기 (이미지 인식)
- 터미널에서 `Cmd+V`(macOS) / `Ctrl+Shift+V`(Linux) 입력 시 클립보드 내용을 먼저 확인합니다
- 텍스트가 있으면 기존 붙여넣기 동작을 그대로 사용합니다
- 이미지가 있으면 임시 `.png` 파일로 저장한 뒤, 해당 경로를 터미널에 입력합니다
- 로컬 환경뿐 아니라 Remote-SSH에서도 동작합니다 (webview 브리지로 로컬 클립보드 이미지를 원격으로 전달)
- 명령 팔레트에서 강제 이미지 붙여넣기: `TMUX: Paste Image from Clipboard`

### 🧭 세션 매핑 안정성 강화
- 같은 저장소 이름이 여러 경로에 있어도 충돌하지 않도록 `repo-name + path hash` 네임스페이스를 사용합니다
- `@workdir`가 현재 저장소 안을 가리키면 레거시 세션 이름도 호환 인식합니다
- worktree 슬러그가 충돌하면 부모 폴더명, 이후 경로 해시로 자동 구분합니다
- git 저장소가 아닌 폴더도 트리에 `current project (no git)`로 표시합니다

## 실제 활용 사례

### 🤖 AI 에이전트로 여러 브랜치 동시 개발
```
프로젝트/
├── main              → tmux: "myapp/main" (Claude Code가 리팩토링 중)
├── feature/oauth     → tmux: "myapp/feature-oauth" (직접 코딩)
└── fix/memory-leak   → tmux: "myapp/fix-memory-leak" (Codex가 분석 중)
```

각 브랜치에서 AI 에이전트를 독립적으로 돌리고, VS Code로 결과를 확인하세요. 세션은 백그라운드에서 계속 작업합니다.

### 🌐 원격 서버에서 작업
SSH로 개발 서버에 접속한 상태에서:
- VS Code Remote-SSH로 서버 접속
- TMUX Worktree로 각 브랜치별 세션 관리
- SSH 연결이 끊겨도 tmux 세션은 살아있음
- 집에서도, 카페에서도, 폰에서도 재접속

### 📱 모바일에서 코드 확인
Termux + SSH로 폰에서 접속해서:
```bash
ssh dev-server
tmux attach -t myapp/feature-oauth
```
통근길에 AI 에이전트가 작성한 코드 리뷰도 가능합니다.

## 명령어

| 명령어 | 설명 |
|--------|------|
| `TMUX: Attach/Create Session` | 현재 worktree의 tmux 세션에 연결하거나 새로 만들기 |
| `TMUX: New Task` | 새 브랜치 + worktree + tmux 세션 한 번에 생성 |
| `TMUX: Remove Task` | worktree와 tmux 세션 삭제 |
| `TMUX: Cleanup Orphans` | 고아 tmux 세션 정리 |
| `TMUX: Smart Paste (Image Support)` | 스마트 터미널 붙여넣기: 텍스트는 일반 paste, 이미지는 임시 파일 경로 입력 |
| `TMUX: Paste Image from Clipboard` | 클립보드 이미지를 강제로 저장하고 현재 터미널에 경로 입력 |

## 최근 업데이트 (v1.1.2 - v1.1.6)

- **v1.1.6**: AI CLI 워크플로우를 위한 이미지 인식 터미널 붙여넣기(`Cmd+V` / `Ctrl+Shift+V`)와 강제 이미지 붙여넣기 명령 추가. 또한 시작 시 auto-attach 타이밍을 보정해, 가끔 터미널이 작게 렌더링되었다가 창 크기 조절 후 정상화되던 문제를 완화했고, 강제 resize 이후 `window-size latest`를 복구해 지속적인 화면 잘림을 줄였으며, 일부 환경에서 attach 실행이 실패하던 셸 스크립트 파싱 회귀도 수정했습니다.
- **v1.1.4 - v1.1.5**: tmux attach 시 클립보드/패스스루 옵션을 자동 설정해 원격 환경 클립보드 신뢰성 개선.
- **v1.1.3**: 레거시 세션 prefix 호환 로직 정리로 마이그레이션 안정성 개선.
- **v1.1.2**: 슬러그 충돌 처리와 no-git 워크스페이스 라벨(`current project (no git)`) 추가.

## 설치 요구사항

- **tmux** — 설치되어 있어야 하고 PATH에 있어야 합니다
- **git** — 설치되어 있어야 하고 PATH에 있어야 합니다
- **VS Code** 1.85.0 이상

## 시작하기

1. 확장 프로그램 설치
2. VS Code에서 git 저장소 열기
3. 액티비티 바(사이드바)에서 **TMUX** 아이콘 클릭
4. 기존 worktree와 tmux 세션이 자동으로 표시됩니다

새 태스크 만들기: TMUX 패널 헤더의 **+** 버튼 클릭, 브랜치 이름 입력하면 끝!

## 작동 원리

```
저장소 (루트)
├── main              → tmux 세션: "project-a1b2c3d4_main"
├── feature/login     → tmux 세션: "project-a1b2c3d4_feature-login"
└── fix/bug-123       → tmux 세션: "project-a1b2c3d4_fix-bug-123"
```

각 worktree마다 전용 tmux 세션이 생깁니다. 세션 이름은 `repo-name + path hash` 네임스페이스와 슬러그를 함께 써서, 같은 저장소 이름이 다른 경로에 있어도 충돌을 피합니다.
새 태스크용 worktree는 기본적으로 저장소 바깥의 `~/.tmux-worktrees/<repo-name-hash>/` 아래에 생성됩니다.

## 더 알아보기

- [마켓플레이스](https://marketplace.visualstudio.com/items?itemName=kargnas.vscode-tmux-worktree)
- [GitHub 저장소](https://github.com/kargnas/vscode-ext-tmux-worktree)
- [이슈 제보](https://github.com/kargnas/vscode-ext-tmux-worktree/issues)

## 라이선스

[MIT](../LICENSE.md)
