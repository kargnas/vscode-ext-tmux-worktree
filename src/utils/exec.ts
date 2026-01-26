import { exec as execCallback } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(execCallback);

export interface ExecOptions {
  cwd?: string;
}

// VS Code는 GUI 앱이라 쉘 환경(PATH)을 상속받지 않음
// Homebrew 등 일반적인 바이너리 경로를 PATH에 추가
function getEnhancedPath(): string {
  const currentPath = process.env.PATH || '';
  const additionalPaths = [
    '/opt/homebrew/bin',      // Apple Silicon Homebrew
    '/usr/local/bin',         // Intel Mac Homebrew / 일반적인 위치
    '/opt/homebrew/sbin',
    '/usr/local/sbin',
  ];
  
  // 이미 있는 경로는 추가하지 않음
  const pathSet = new Set(currentPath.split(':'));
  const newPaths = additionalPaths.filter(p => !pathSet.has(p));
  
  return newPaths.length > 0 
    ? `${newPaths.join(':')}:${currentPath}`
    : currentPath;
}

export async function exec(command: string, options?: ExecOptions): Promise<string> {
  const { stdout } = await execPromise(command, { 
    cwd: options?.cwd,
    env: {
      ...process.env,
      PATH: getEnhancedPath(),
    }
  });
  return stdout.trim();
}
