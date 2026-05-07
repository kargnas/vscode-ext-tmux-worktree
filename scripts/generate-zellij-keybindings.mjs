#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonPath = path.join(repoRoot, 'package.json');

const SEND_SEQUENCE_COMMAND = 'workbench.action.terminal.sendSequence';
const ZELLIJ_WHEN = "terminalFocus && config.tmuxWorktree.multiplexer == 'zellij'";

// Add new Zellij passthroughs here. Prefer scan-code key strings so shortcuts
// stay layout-independent across Korean IME and other keyboard layouts.
const ZELLIJ_KEY_PASSTHROUGHS = [
  { key: 'shift+[Enter]', text: '\u001b[13;2u' },
  { key: 'shift+[ArrowLeft]', text: '\u001b[1;2D' },
  { key: 'shift+[ArrowRight]', text: '\u001b[1;2C' },
  { key: 'ctrl+[KeyD]', text: '\u0004' },
  { key: 'ctrl+[KeyQ]', text: '\u0011' },
  { key: 'ctrl+[KeyG]', text: '\u0007' },
  { key: 'alt+[KeyF]', text: '\u001bf' },
  { key: 'alt+[KeyN]', text: '\u001bn' },
  { key: 'alt+[KeyI]', text: '\u001bi' },
  { key: 'alt+[KeyO]', text: '\u001bo' },
  { key: 'alt+[KeyH]', text: '\u001bh' },
  { key: 'alt+[KeyJ]', text: '\u001bj' },
  { key: 'alt+[KeyK]', text: '\u001bk' },
  { key: 'alt+[KeyL]', text: '\u001bl' },
  { key: 'alt+[ArrowLeft]', text: '\u001b[1;3D' },
  { key: 'alt+[ArrowRight]', text: '\u001b[1;3C' },
  { key: 'alt+[ArrowDown]', text: '\u001b[1;3B' },
  { key: 'alt+[ArrowUp]', text: '\u001b[1;3A' },
  { key: 'alt+[Equal]', text: '\u001b=' },
  { key: 'alt+[Minus]', text: '\u001b-' },
  { key: 'alt+[BracketLeft]', text: '\u001b[' },
  { key: 'alt+[BracketRight]', text: '\u001b]' },
  { key: 'alt+[KeyP]', text: '\u001bp' },
  { key: 'alt+shift+[KeyP]', text: '\u001bP' },
];

function isZellijSendSequenceKeybinding(keybinding) {
  return keybinding.command === SEND_SEQUENCE_COMMAND && keybinding.when === ZELLIJ_WHEN;
}

function toKeybinding({ key, text }) {
  return {
    command: SEND_SEQUENCE_COMMAND,
    key,
    when: ZELLIJ_WHEN,
    args: { text },
  };
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const keybindings = packageJson.contributes?.keybindings;
if (!Array.isArray(keybindings)) {
  throw new Error('package.json contributes.keybindings must be an array');
}

const seenKeys = new Set();
for (const passthrough of ZELLIJ_KEY_PASSTHROUGHS) {
  if (seenKeys.has(passthrough.key)) {
    throw new Error(`Duplicate Zellij keybinding: ${passthrough.key}`);
  }
  seenKeys.add(passthrough.key);
}

packageJson.contributes.keybindings = [
  ...keybindings.filter((keybinding) => !isZellijSendSequenceKeybinding(keybinding)),
  ...ZELLIJ_KEY_PASSTHROUGHS.map(toKeybinding),
];

fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
console.log(`Generated ${ZELLIJ_KEY_PASSTHROUGHS.length} Zellij passthrough keybindings.`);
