import * as vscode from 'vscode';
import { exec } from './exec';

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
      return parts.slice(1).join(' ').trim();
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
    // tmux 세션 이름에서 허용되지 않는 문자(. : 등)를 -로 치환
    return name.replace(/[.:]/g, '-');
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
    const options = existing.creationOptions as vscode.TerminalOptions;
    // 원하는 위치에 이미 있으면 show(), 아니면 닫고 새로 생성
    if (options && options.location === location) {
        existing.show();
        return existing;
    }
    
    existing.dispose();
  }
  
  const terminal = vscode.window.createTerminal({
    name: terminalName,
    cwd,
    location,
    iconPath: new vscode.ThemeIcon('server')
  });
  // exec로 실행하면 tmux가 종료될 때 쉘도 자동으로 종료됨
  terminal.sendText(`exec tmux attach -t "${sessionName}"`);
  terminal.show();
  return terminal;
}

export async function killSession(sessionName: string): Promise<void> {
  await exec(`tmux kill-session -t "${sessionName}"`);
}
