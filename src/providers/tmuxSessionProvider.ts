import * as vscode from 'vscode';

export class TmuxSessionProvider implements vscode.TreeDataProvider<TmuxItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TmuxItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TmuxItem): vscode.TreeItem {
    return element;
  }

  async getChildren(_element?: TmuxItem): Promise<TmuxItem[]> {
    // TODO: 실제 tmux 세션 목록 반환
    return [];
  }
}

export class TmuxItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly repoName?: string,
    public readonly sessionName?: string
  ) {
    super(label, collapsibleState);
    if (sessionName) {
      this.contextValue = 'tmuxSession';
    }
  }
}
