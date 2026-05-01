import * as vscode from 'vscode';
import { TmuxSessionProvider } from './providers/tmuxSessionProvider';
import { getActiveBackend, refreshBackendFromConfig, getConfiguredMultiplexerType, MultiplexerType } from './utils/multiplexer';
import { attachCreate } from './commands/attachCreate';
import { newTask } from './commands/newTask';
import { removeTask } from './commands/removeTask';
import { cleanupOrphans } from './commands/orphanCleanup';
import { autoAttachOnStartup } from './commands/autoAttach';
import {
  attach,
  attachInEditor,
  openWorktree,
  copyPath,
  newPane,
  newWindow
} from './commands/contextMenu';
import { terminalSmartPaste, pasteImageForce, cleanupTempImages } from './commands/pasteImage';
import { createWorktreeFromBranch } from './commands/createWorktreeFromBranch';
import { syncZellijTerminalSettings } from './utils/zellijTerminalSettings';

function updateViewDescription(treeView: vscode.TreeView<unknown>): void {
  const backend = getActiveBackend();
  treeView.description = `[${backend.displayName}]`;
}

function syncZellijTerminalSettingsForCurrentBackend(context: vscode.ExtensionContext): void {
  syncZellijTerminalSettings(context, getConfiguredMultiplexerType()).catch((error) => {
    console.error('Failed to sync Zellij terminal settings', error);
  });
}

export function activate(context: vscode.ExtensionContext) {
  const sessionProvider = new TmuxSessionProvider();
  sessionProvider.setExtensionUri(context.extensionUri);
  syncZellijTerminalSettingsForCurrentBackend(context);
  const treeView = vscode.window.createTreeView('tmuxSessions', {
    treeDataProvider: sessionProvider,
  });
  updateViewDescription(treeView);

  context.subscriptions.push(
    treeView,
    vscode.commands.registerCommand('tmux.attachCreate', attachCreate),
    vscode.commands.registerCommand('tmux.newTask', newTask),
    vscode.commands.registerCommand('tmux.removeTask', (item) => removeTask(item)),
    vscode.commands.registerCommand('tmux.cleanupOrphans', cleanupOrphans),
    vscode.commands.registerCommand('tmux.refresh', () => sessionProvider.refresh()),
    vscode.commands.registerCommand('tmux.filter', async () => {
      const choice = await vscode.window.showQuickPick(
        ['All', 'Attached', 'Alive', 'Idle', 'Orphans'],
        { placeHolder: 'Filter sessions by status' }
      );
      if (choice) {
        sessionProvider.setFilter(choice.toLowerCase());
        sessionProvider.refresh();
      }
    }),
    vscode.commands.registerCommand('tmux.switchBackend', async () => {
      const current = getConfiguredMultiplexerType();
      const options: { label: string; value: MultiplexerType }[] = [
        { label: 'tmux', value: 'tmux' },
        { label: 'Zellij', value: 'zellij' },
      ];
      const picked = await vscode.window.showQuickPick(
        options.map(o => ({
          label: o.label,
          description: o.value === current ? '(current)' : '',
          value: o.value,
        })),
        { placeHolder: `Current: ${current}` }
      );
      if (!picked || (picked as { value: MultiplexerType }).value === current) return;
      await vscode.workspace.getConfiguration('tmuxWorktree')
        .update('multiplexer', (picked as { value: MultiplexerType }).value, vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand('tmux.attach', attach),
    vscode.commands.registerCommand('tmux.attachInEditor', attachInEditor),
    vscode.commands.registerCommand('tmux.openWorktree', openWorktree),
    vscode.commands.registerCommand('tmux.copyPath', copyPath),
    vscode.commands.registerCommand('tmux.newPane', newPane),
    vscode.commands.registerCommand('tmux.newWindow', newWindow),
    vscode.commands.registerCommand('tmux.terminalPaste', terminalSmartPaste),
    vscode.commands.registerCommand('tmux.pasteImage', pasteImageForce),
    vscode.commands.registerCommand('tmux.createWorktreeFromBranch', (item) => createWorktreeFromBranch(item))
  );

  autoAttachOnStartup();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('tmuxWorktree.multiplexer')) {
        refreshBackendFromConfig();
        syncZellijTerminalSettingsForCurrentBackend(context);
        updateViewDescription(treeView);
        sessionProvider.refresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidOpenTerminal(() => sessionProvider.refresh()),
    vscode.window.onDidCloseTerminal(() => sessionProvider.refresh()),
    vscode.window.onDidChangeWindowState((e) => {
        if (e.focused) sessionProvider.refresh();
    })
  );

  const intervalId = setInterval(() => {
      sessionProvider.refresh();
  }, 30000);

  context.subscriptions.push({
      dispose: () => clearInterval(intervalId)
  });
}

export function deactivate() {
  cleanupTempImages();
}
