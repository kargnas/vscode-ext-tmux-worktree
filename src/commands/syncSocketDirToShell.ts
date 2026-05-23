import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getConfiguredSocketDir } from '../utils/socketDir';

interface ShellTarget {
  shellPath: string;
  shellName: 'zsh' | 'bash' | 'fish';
  rcFile: string;
  rcDisplayName: string;
}

// Marker bracket used to make the inserted block re-detectable and idempotent across
// re-runs. We rewrite the marker block in-place instead of appending duplicate lines.
const MARKER_BEGIN = '# >>> vscode-tmux-worktree socket dir (managed) >>>';
const MARKER_END = '# <<< vscode-tmux-worktree socket dir (managed) <<<';

function detectShellTarget(): ShellTarget | null {
  const shellEnv = process.env.SHELL || '';
  const home = os.homedir();

  if (shellEnv.endsWith('/zsh') || shellEnv.endsWith('zsh')) {
    return {
      shellPath: shellEnv,
      shellName: 'zsh',
      rcFile: path.join(home, '.zshrc'),
      rcDisplayName: '~/.zshrc',
    };
  }
  if (shellEnv.endsWith('/bash') || shellEnv.endsWith('bash')) {
    // macOS GUI logins read ~/.bash_profile; Linux interactive shells read ~/.bashrc.
    // Prefer the file that already exists, fall back to ~/.bashrc.
    const bashProfile = path.join(home, '.bash_profile');
    const bashrc = path.join(home, '.bashrc');
    if (process.platform === 'darwin' && fs.existsSync(bashProfile)) {
      return { shellPath: shellEnv, shellName: 'bash', rcFile: bashProfile, rcDisplayName: '~/.bash_profile' };
    }
    return { shellPath: shellEnv, shellName: 'bash', rcFile: bashrc, rcDisplayName: '~/.bashrc' };
  }
  if (shellEnv.endsWith('/fish') || shellEnv.endsWith('fish')) {
    return {
      shellPath: shellEnv,
      shellName: 'fish',
      rcFile: path.join(home, '.config', 'fish', 'config.fish'),
      rcDisplayName: '~/.config/fish/config.fish',
    };
  }
  return null;
}

function buildManagedBlock(socketDir: string, shellName: ShellTarget['shellName']): string {
  if (shellName === 'fish') {
    return [
      MARKER_BEGIN,
      `set -gx TMUX_TMPDIR ${shellEscapeFish(socketDir)}`,
      `set -gx ZELLIJ_SOCKET_DIR ${shellEscapeFish(path.join(socketDir, 'zellij'))}`,
      MARKER_END,
    ].join('\n');
  }
  return [
    MARKER_BEGIN,
    `export TMUX_TMPDIR=${shellEscapePosix(socketDir)}`,
    `export ZELLIJ_SOCKET_DIR=${shellEscapePosix(path.join(socketDir, 'zellij'))}`,
    MARKER_END,
  ].join('\n');
}

function shellEscapePosix(value: string): string {
  // POSIX single-quoting: wrap in single quotes, replace embedded ' with '\''
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function shellEscapeFish(value: string): string {
  // Fish single-quoting: backslash-escape ' and \ inside single quotes.
  return `'${value.replace(/\\/g, `\\\\`).replace(/'/g, `\\'`)}'`;
}

function replaceOrAppendBlock(existing: string, newBlock: string): string {
  const beginIdx = existing.indexOf(MARKER_BEGIN);
  const endIdx = existing.indexOf(MARKER_END);
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    const before = existing.slice(0, beginIdx).replace(/[\r\n]+$/, '');
    const after = existing.slice(endIdx + MARKER_END.length).replace(/^[\r\n]+/, '');
    const segments = [before, newBlock, after].filter((s) => s.length > 0);
    return segments.join('\n') + (existing.endsWith('\n') ? '\n' : '');
  }
  const trimmed = existing.replace(/[\r\n]+$/, '');
  if (!trimmed) {
    return newBlock + '\n';
  }
  return `${trimmed}\n\n${newBlock}\n`;
}

export async function syncSocketDirToShell(): Promise<void> {
  const target = detectShellTarget();
  if (!target) {
    vscode.window.showErrorMessage(
      `Unsupported shell (${process.env.SHELL || 'unknown'}). Supported: zsh, bash, fish.`
    );
    return;
  }

  const socketDir = getConfiguredSocketDir();
  const block = buildManagedBlock(socketDir, target.shellName);

  let existing = '';
  if (fs.existsSync(target.rcFile)) {
    existing = fs.readFileSync(target.rcFile, 'utf-8');
  }
  const updated = replaceOrAppendBlock(existing, block);

  if (updated === existing) {
    vscode.window.showInformationMessage(
      `${target.rcDisplayName} already has the matching socket dir block. Nothing to update.`
    );
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Will write the following block to ${target.rcDisplayName}:\n\n${block}\n\nProceed?`,
    { modal: true },
    'Write',
    'Cancel'
  );
  if (confirm !== 'Write') {
    return;
  }

  if (fs.existsSync(target.rcFile)) {
    // One-shot timestamped backup. Users can diff/restore manually if the change breaks
    // their rc — extension never auto-restores to avoid silent surprises.
    const backupPath = `${target.rcFile}.bak.${Date.now()}`;
    fs.copyFileSync(target.rcFile, backupPath);
  } else {
    fs.mkdirSync(path.dirname(target.rcFile), { recursive: true });
  }
  fs.writeFileSync(target.rcFile, updated, 'utf-8');

  vscode.window.showInformationMessage(
    `Updated ${target.rcDisplayName}. Open a new terminal (or source the file) for the change to take effect.`
  );
}
