import { exec as execCallback } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(execCallback);

export interface ExecOptions {
  cwd?: string;
}

export async function exec(command: string, options?: ExecOptions): Promise<string> {
  const { stdout } = await execPromise(command, { cwd: options?.cwd });
  return stdout.trim();
}
