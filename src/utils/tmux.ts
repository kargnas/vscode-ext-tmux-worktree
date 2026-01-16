export interface TmuxSession {
  name: string;
  windows: number;
  attached: boolean;
  path?: string;
}

export async function listSessions(): Promise<TmuxSession[]> {
  // TODO: tmux list-sessions 실행
  return [];
}

export async function createSession(_name: string, _path: string): Promise<void> {
  // TODO: tmux new-session 실행
}

export async function attachSession(_name: string): Promise<void> {
  // TODO: tmux attach-session 실행
}

export async function killSession(_name: string): Promise<void> {
  // TODO: tmux kill-session 실행
}
