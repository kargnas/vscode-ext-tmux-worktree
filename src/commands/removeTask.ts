import * as vscode from "vscode";
import * as fs from "fs";
import { exec } from "../utils/exec";
import { killSession } from "../utils/tmux";
import { getRepoRoot, getWorktreeBranch } from "../utils/git";
import {
  TmuxItem,
  TmuxSessionItem,
  InactiveWorktreeItem,
  WorktreeItem,
  TmuxDetailItem,
  InactiveDetailItem,
  GitStatusItem,
} from "../providers/tmuxSessionProvider";
import * as path from "path";
import { toCanonicalPath } from "../utils/path";
import { createRepoSessionPrefixConfig, extractRepoSessionSlug } from "../utils/sessionCompatibility";
import { shellQuote } from "../utils/shell";

async function isWorktreePathManagedByRepo(
  repoRoot: string,
  worktreePath: string,
): Promise<boolean> {
  try {
    const output = await exec(`git -C "${repoRoot}" worktree list --porcelain`);
    const worktreePaths = output
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.substring("worktree ".length).trim())
      .filter((p) => p.length > 0);

    const candidate = toCanonicalPath(worktreePath);
    if (!candidate) return false;
    for (const wtPath of worktreePaths) {
      const resolved = toCanonicalPath(wtPath) || path.resolve(wtPath);
      if (resolved === candidate) return true;
    }

    return false;
  } catch {
    return false;
  }
}

function isMainWorktreeItem(item: TmuxItem): boolean {
  if (item instanceof WorktreeItem) return item.isMainWorktree;
  if (item instanceof TmuxDetailItem && item.worktree) return item.worktree.isMain;
  if (item instanceof InactiveDetailItem && item.worktree) return item.worktree.isMain;
  if (item instanceof GitStatusItem) return false;
  return false;
}

function isOrphanItem(item: TmuxItem): boolean {
  if (item instanceof TmuxSessionItem) return item.session.status.classification === 'orphan';
  if (item instanceof TmuxDetailItem && item.session) return item.session.status.classification === 'orphan';
  if (item instanceof WorktreeItem) return !item.hasGit;
  return false;
}

export async function removeTask(item: TmuxItem): Promise<void> {
  if (!item || !item.sessionName) {
    vscode.window.showErrorMessage("No session selected");
    return;
  }

  const sessionName = item.sessionName;
  const isMain = isMainWorktreeItem(item);

  let worktreePath: string | undefined;
  let slug: string | undefined;
  let branchName: string | undefined;

  if (item instanceof TmuxSessionItem) {
    worktreePath = item.session.worktreePath;
    slug = item.session.slug;
  } else if (item instanceof TmuxDetailItem && item.session) {
    worktreePath = item.session.worktreePath;
    slug = item.session.slug;
  } else if (item instanceof InactiveWorktreeItem) {
    worktreePath = item.worktree.path;
  } else if (item instanceof InactiveDetailItem && item.worktree) {
    worktreePath = item.worktree.path;
  } else if (item instanceof WorktreeItem) {
    worktreePath = item.worktreePath;
  } else if (item instanceof GitStatusItem) {
    worktreePath = item.worktreePath;
  }

  try {
    const repoRoot = getRepoRoot();
    branchName = worktreePath ? await getWorktreeBranch(repoRoot, worktreePath) : undefined;
    const sessionPrefixConfig = createRepoSessionPrefixConfig(repoRoot);
    slug = slug || extractRepoSessionSlug(sessionName, sessionPrefixConfig, { allowLegacy: true });
  } catch {
    void 0;
  }
  slug = slug || String(item.label);

  // ── Main worktree: tmux 세션만 종료, 워크트리/브랜치 삭제 불가 ──
  if (isMain) {
    const confirm = await vscode.window.showWarningMessage(
      `Kill tmux session "${sessionName}"?\n(Primary worktree cannot be removed)`,
      { modal: true },
      "Kill Session",
    );
    if (confirm !== "Kill Session") return;

    try {
      await killSession(sessionName);
      vscode.window.showInformationMessage(`Killed session: ${sessionName}`);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to kill session: ${err}`);
    }
    vscode.commands.executeCommand("tmux.refresh");
    return;
  }

  // ── Orphan: worktree 이미 없음, tmux 세션만 종료 ──
  if (isOrphanItem(item)) {
    const confirm = await vscode.window.showWarningMessage(
      `Kill orphan tmux session "${sessionName}"? (Worktree no longer exists)`,
      { modal: true },
      "Kill Session",
    );
    if (confirm !== "Kill Session") return;

    try {
      await killSession(sessionName);
      vscode.window.showInformationMessage(`Killed orphan session: ${sessionName}`);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to kill session: ${err}`);
    }
    vscode.commands.executeCommand("tmux.refresh");
    return;
  }

  // ── 일반 워크트리: 세션 + 워크트리 + 브랜치 모두 삭제 가능 ──

  if (worktreePath) {
    try {
      const repoRoot = getRepoRoot();
      const managed = await isWorktreePathManagedByRepo(repoRoot, worktreePath);
      if (!managed) {
        vscode.window.showErrorMessage(
          "Cannot delete: selected path is not a worktree of the current repo.",
        );
        return;
      }
    } catch {
      void 0;
    }
  }

  const confirm = await vscode.window.showWarningMessage(
    `Delete tmux session "${sessionName}" and its worktree directory? This cannot be undone.`,
    { modal: true },
    "Delete Session & Worktree",
  );
  if (confirm !== "Delete Session & Worktree") return;

  try {
    await killSession(sessionName);
  } catch {
    void 0;
  }

  if (worktreePath && fs.existsSync(worktreePath)) {
    try {
      const repoRoot = getRepoRoot();
      await exec(`git worktree remove "${worktreePath}"`, { cwd: repoRoot });
    } catch {
      const forceConfirm = await vscode.window.showWarningMessage(
        "Worktree has uncommitted changes. Force remove?",
        "Force Remove",
        "Cancel",
      );
      if (forceConfirm === "Force Remove") {
        try {
          const repoRoot = getRepoRoot();
          await exec(`git worktree remove "${worktreePath}" --force`, {
            cwd: repoRoot,
          });
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to remove worktree: ${err}`);
          return;
        }
      } else {
        return;
      }
    }
  }

  try {
    const repoRoot = getRepoRoot();
    if (!branchName) throw new Error("No branch");

    const localBranchesOutput = await exec("git for-each-ref --format='%(refname:short)' refs/heads", {
      cwd: repoRoot,
    });
    const branchExists = localBranchesOutput.split("\n").some((line) => line.trim() === branchName);
    if (!branchExists) throw new Error("Missing branch");

    const deleteBranch = await vscode.window.showWarningMessage(
      `Also delete local branch "${branchName}"?`,
      "Delete Branch",
      "Keep Branch",
    );
    if (deleteBranch === "Delete Branch") {
      await exec(`git branch -d ${shellQuote(branchName)}`, { cwd: repoRoot });
    }
  } catch {
    void 0;
  }

  vscode.window.showInformationMessage(`Removed: ${branchName || slug || sessionName}`);
  vscode.commands.executeCommand("tmux.refresh");
}
