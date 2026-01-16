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
    vscode.commands.registerCommand('tmux.filter', () => {
      // TODO: 필터 기능 구현
      vscode.window.showInformationMessage('Filter not implemented yet');
    })
  );
}

export function deactivate() {}
