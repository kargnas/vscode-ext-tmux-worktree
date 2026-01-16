import * as vscode from 'vscode';
import { TmuxSessionProvider } from './providers/tmuxSessionProvider';
import { attachCreate } from './commands/attachCreate';
import { newTask } from './commands/newTask';
import { removeTask } from './commands/removeTask';

export function activate(context: vscode.ExtensionContext) {
  const sessionProvider = new TmuxSessionProvider();
  vscode.window.registerTreeDataProvider('tmuxSessions', sessionProvider);

  context.subscriptions.push(
    vscode.commands.registerCommand('tmux.attachCreate', attachCreate),
    vscode.commands.registerCommand('tmux.newTask', newTask),
    vscode.commands.registerCommand('tmux.removeTask', removeTask),
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
    })
  );
}

export function deactivate() {}
