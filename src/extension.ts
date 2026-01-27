import * as vscode from 'vscode';
import { TmuxSessionProvider } from './providers/tmuxSessionProvider';
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

export function activate(context: vscode.ExtensionContext) {
  const sessionProvider = new TmuxSessionProvider();
  vscode.window.registerTreeDataProvider('tmuxSessions', sessionProvider);

  context.subscriptions.push(
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
    vscode.commands.registerCommand('tmux.attach', attach),
    vscode.commands.registerCommand('tmux.attachInEditor', attachInEditor),
    vscode.commands.registerCommand('tmux.openWorktree', openWorktree),
    vscode.commands.registerCommand('tmux.copyPath', copyPath),
    vscode.commands.registerCommand('tmux.newPane', newPane),
    vscode.commands.registerCommand('tmux.newWindow', newWindow)
  );

  autoAttachOnStartup();

  // 이벤트 기반 갱신
  context.subscriptions.push(
    vscode.window.onDidOpenTerminal(() => sessionProvider.refresh()),
    vscode.window.onDidCloseTerminal(() => sessionProvider.refresh()),
    vscode.window.onDidChangeWindowState((e) => {
        if (e.focused) sessionProvider.refresh();
    })
  );

  // 폴링 기반 갱신 (30초)
  const intervalId = setInterval(() => {
      sessionProvider.refresh();
  }, 30000);

  context.subscriptions.push({
      dispose: () => clearInterval(intervalId)
  });
}

export function deactivate() {}
