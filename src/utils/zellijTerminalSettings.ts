import * as vscode from 'vscode';
import { MultiplexerType } from './multiplexer';

const SECTION = 'terminal.integrated';
const STATE_KEY = 'zellijTerminalSettingOverrides';

const ZELLIJ_TERMINAL_SETTINGS = [
  { key: 'sendKeybindingsToShell', value: false },
  { key: 'macOptionIsMeta', value: true },
] as const;

interface StoredOverride {
  hadGlobalValue: boolean;
  previousGlobalValue?: boolean;
  appliedValue: boolean;
}

type StoredOverrides = Record<string, StoredOverride>;

async function applyZellijTerminalSettings(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration(SECTION);
  const stored = { ...(context.globalState.get<StoredOverrides>(STATE_KEY) || {}) };
  let changedStoredOverrides = false;

  for (const setting of ZELLIJ_TERMINAL_SETTINGS) {
    if (config.get<boolean>(setting.key) === setting.value) {
      continue;
    }

    const inspected = config.inspect<boolean>(setting.key);
    if (!stored[setting.key]) {
      stored[setting.key] = {
        hadGlobalValue: inspected?.globalValue !== undefined,
        previousGlobalValue: inspected?.globalValue,
        appliedValue: setting.value,
      };
      changedStoredOverrides = true;
    }

    await config.update(setting.key, setting.value, vscode.ConfigurationTarget.Global);
  }

  if (changedStoredOverrides) {
    await context.globalState.update(STATE_KEY, stored);
  }
}

async function restoreZellijTerminalSettings(context: vscode.ExtensionContext): Promise<void> {
  const stored = context.globalState.get<StoredOverrides>(STATE_KEY);
  if (!stored) {
    return;
  }

  const config = vscode.workspace.getConfiguration(SECTION);
  for (const [key, override] of Object.entries(stored)) {
    const inspected = config.inspect<boolean>(key);
    if (inspected?.globalValue !== override.appliedValue) {
      continue;
    }

    await config.update(
      key,
      override.hadGlobalValue ? override.previousGlobalValue : undefined,
      vscode.ConfigurationTarget.Global
    );
  }

  await context.globalState.update(STATE_KEY, undefined);
}

export async function syncZellijTerminalSettings(
  context: vscode.ExtensionContext,
  multiplexer: MultiplexerType
): Promise<void> {
  if (multiplexer === 'zellij') {
    await applyZellijTerminalSettings(context);
    return;
  }

  await restoreZellijTerminalSettings(context);
}
