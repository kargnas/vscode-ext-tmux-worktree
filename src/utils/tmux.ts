import * as vscode from 'vscode';
import { exec } from './exec';
import { toCanonicalPath } from './path';

export interface TmuxSession {
  name: string;
  windows: number;
  attached: boolean;
  workdir?: string;
}

export async function isTmuxInstalled(): Promise<boolean> {
  try {
    await exec('which tmux');
    return true;
  } catch {
    return false;
  }
}

export async function listSessions(): Promise<TmuxSession[]> {
  try {
    // VS Code Extension Host 환경에서 탭 문자가 변환되는 문제 (tmux 3.5a+)
    const output = await exec("tmux list-sessions -F '#{session_name}|||#{session_windows}|||#{session_attached}'");
    return output.split('\n').filter(l => l.trim()).map(line => {
      const [name, windows, attached] = line.split('|||');
      return {
        name,
        windows: parseInt(windows, 10) || 1,
        attached: attached === '1'
      };
    });
  } catch {
    return [];
  }
}

export async function getSessionWorkdir(sessionName: string): Promise<string | undefined> {
  try {
    const output = await exec(`tmux show-options -t "${sessionName}" @workdir`);
    const parts = output.split(' ');
    if (parts.length >= 2) {
      const rawPath = parts.slice(1).join(' ').trim();
      return toCanonicalPath(rawPath) || rawPath;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function createSession(sessionName: string, cwd: string): Promise<void> {
  await exec(`tmux new-session -d -s "${sessionName}" -c "${cwd}"`);
}

export async function setSessionWorkdir(sessionName: string, workdir: string): Promise<void> {
  await exec(`tmux set-option -t "${sessionName}" @workdir "${workdir}"`);
}

function getShortName(sessionName: string): string {
    const parts = sessionName.split('_');
    if (parts.length > 1) {
        return parts.slice(1).join('_');
    }
    return sessionName;
}

export function sanitizeSessionName(name: string): string {
    // tmux session names should stay flat even when git branches use "/" paths.
    return name.replace(/[/\\\s.:]/g, '-');
}

export function buildSessionName(repoName: string, slug: string): string {
    return `${sanitizeSessionName(repoName)}_${sanitizeSessionName(slug)}`;
}

export function attachSession(sessionName: string, cwd?: string, location: vscode.TerminalLocation = vscode.TerminalLocation.Editor): vscode.Terminal {
  const shortName = getShortName(sessionName);
  const terminalName = shortName; 
  
  // 기존 터미널 찾기 (새 이름 또는 구 이름 모두 확인)
  const oldName = `tmux: ${sessionName}`;
  const existing = vscode.window.terminals.find(t => t.name === terminalName || t.name === oldName);
  
  if (existing) {
    // resize-window can leave window-size as manual; force latest on reuse
    // so the tmux window follows the current VS Code terminal dimensions.
    void exec(`tmux set-window-option -t "${sessionName}":. window-size latest`).catch(() => {});

    const options = existing.creationOptions as vscode.TerminalOptions;
    // 원하는 위치에 이미 있으면 show(), 아니면 닫고 새로 생성
    if (options && options.location === location) {
        existing.show();
        return existing;
    }
    
    existing.dispose();
  }
  
  // /bin/sh -c 'exec tmux attach ...' 방식으로 셸의 표준 PTY 환경에서 tmux를 실행.
  // shellPath: 'tmux' 방식은 VS Code가 비표준 셸로 인식하여 PTY 설정이 달라지고,
  // 마우스 드래그 이벤트(tmux pane 리사이즈 등)가 정상 전달되지 않는 문제가 있었음.
  // exec으로 셸을 tmux로 교체하므로 추가 프로세스 없음.
  // -c 옵션으로 즉시 실행하므로 다른 확장(Python 등)과의 sendText 경합 문제 없음.
  // 원격/VS Code 터미널에서 tmux copy-mode 복사가 로컬 클립보드(OSC52)까지 전달되도록
  // attach 직전에 clipboard capability를 조용히 보강한다.
  const escapedName = sessionName.replace(/'/g, "'\\''");
  const attachCommand = [
    "tmux set-option -gq set-clipboard on >/dev/null 2>&1 || true",
    "tmux set-option -agq terminal-features ',xterm-256color:clipboard' >/dev/null 2>&1 || true",
    "tmux set-option -agq terminal-overrides ',*:clipboard' >/dev/null 2>&1 || true",
    "tmux set-option -gwq allow-passthrough on >/dev/null 2>&1 || true",
    "rows=''; cols=''",
    "for _ in 1 2 3 4 5; do",
    "size=$(stty size 2>/dev/null || true)",
    "candidate_rows=${size%% *}",
    "candidate_cols=${size##* }",
    "if [ -n \"$candidate_rows\" ] && [ -n \"$candidate_cols\" ] && [ \"$candidate_rows\" -gt 0 ] && [ \"$candidate_cols\" -gt 0 ]; then rows=\"$candidate_rows\"; cols=\"$candidate_cols\"; fi",
    "if [ -n \"$rows\" ] && [ \"$rows\" -ge 30 ] && [ \"$cols\" -ge 100 ]; then break; fi",
    "sleep 0.04",
    "done",
    "if [ -n \"$rows\" ] && [ -n \"$cols\" ]; then tmux set-option -t '" + escapedName + "' default-size \"${cols}x${rows}\" >/dev/null 2>&1 || true; fi",
    "if [ -n \"$rows\" ] && [ -n \"$cols\" ]; then tmux resize-window -t '" + escapedName + "':. -x \"$cols\" -y \"$rows\" >/dev/null 2>&1 || true; fi",
    "tmux set-window-option -t '" + escapedName + "':. window-size latest >/dev/null 2>&1 || true",
    "sleep 0.08",
    `exec tmux attach -t '${escapedName}'`
  ].join('\n');
  const terminal = vscode.window.createTerminal({
    name: terminalName,
    shellPath: '/bin/sh',
    shellArgs: ['-c', attachCommand],
    cwd: cwd,
    env: {
      'TERM': 'xterm-256color',
      // VS Code shell integration 환경변수가 tmux 내부 쉘(zsh/bash)에 상속되면,
      // 내부 쉘이 OSC 633 시퀀스를 보내 VS Code가 command decoration을 추가하고
      // interactive shell이 있는 pane에서 마우스 드래그(텍스트 선택)가 안 되는 문제 발생.
      'VSCODE_SHELL_INTEGRATION': null,
      'VSCODE_INJECTION': null,
    },
    location,
    iconPath: new vscode.ThemeIcon('server')
  });
  terminal.show();
  return terminal;
}

export async function killSession(sessionName: string): Promise<void> {
  await exec(`tmux kill-session -t "${sessionName}"`);
}
