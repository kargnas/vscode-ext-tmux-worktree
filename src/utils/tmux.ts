import * as vscode from 'vscode';
import { exec } from './exec';

export interface TmuxSession {
  name: string;
  windows: number;
  attached: boolean;
  workdir?: string;
}

// tmux 설치 확인
export async function isTmuxInstalled(): Promise<boolean> {
  try {
    await exec('which tmux');
    return true;
  } catch {
    return false;
  }
}

// 세션 목록 조회
export async function listSessions(): Promise<TmuxSession[]> {
  try {
    // 탭 구분자 사용 (세션 이름에 탭이 들어갈 수 없음)
    const output = await exec("tmux list-sessions -F '#{session_name}\t#{session_windows}\t#{session_attached}'");
    return output.split('\n').filter(l => l.trim()).map(line => {
      const [name, windows, attached] = line.split('\t');
      return {
        name,
        windows: parseInt(windows, 10) || 1,
        attached: attached === '1'
      };
    });
  } catch {
    // tmux 서버 없음
    return [];
  }
}

// 세션의 @workdir 조회
export async function getSessionWorkdir(sessionName: string): Promise<string | undefined> {
  try {
    const output = await exec(`tmux show-options -t "${sessionName}" @workdir`);
    // 출력 형식: "@workdir /abs/path"
    const parts = output.split(' ');
    if (parts.length >= 2) {
      return parts.slice(1).join(' ').trim();
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// 세션 생성
export async function createSession(sessionName: string, cwd: string): Promise<void> {
  await exec(`tmux new-session -d -s "${sessionName}" -c "${cwd}"`);
}

// @workdir 설정
export async function setSessionWorkdir(sessionName: string, workdir: string): Promise<void> {
  await exec(`tmux set-option -t "${sessionName}" @workdir "${workdir}"`);
}

// 세션 attach (VS Code 터미널에서)
export function attachSession(sessionName: string, cwd?: string): vscode.Terminal {
  const terminalName = `tmux: ${sessionName}`;
  
  // 기존 터미널 재사용
  const existing = vscode.window.terminals.find(t => t.name === terminalName);
  if (existing) {
    existing.show();
    return existing;
  }
  
  // 새 터미널 생성
  const terminal = vscode.window.createTerminal({
    name: terminalName,
    cwd
  });
  terminal.sendText(`tmux attach -t "${sessionName}"`);
  terminal.show();
  return terminal;
}

// 세션 종료
export async function killSession(sessionName: string): Promise<void> {
  await exec(`tmux kill-session -t "${sessionName}"`);
}
