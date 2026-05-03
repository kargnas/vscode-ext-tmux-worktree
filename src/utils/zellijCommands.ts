import { shellQuote } from './shell';

function zellijSessionNameArg(sessionName: string): string {
  const quotedName = shellQuote(sessionName);
  // Zellij parses positional names that start with "-" as flags unless "--" ends option parsing.
  return sessionName.startsWith('-') ? `-- ${quotedName}` : quotedName;
}

export function buildZellijBackgroundAttachCommand(sessionName: string): string {
  const quotedName = shellQuote(sessionName);
  if (sessionName.startsWith('-')) {
    // After "--", clap treats following tokens as positionals, so the trailing "options" subcommand cannot be used here.
    return `zellij attach -b -- ${quotedName}`;
  }
  return `zellij attach -b ${quotedName} options --simplified-ui true`;
}

export function buildZellijInteractiveAttachCommand(sessionName: string): string {
  if (sessionName.startsWith('-')) {
    return `exec zellij attach --create --force-run-commands -- ${shellQuote(sessionName)}`;
  }
  return `exec zellij attach --create --force-run-commands ${shellQuote(sessionName)} options --simplified-ui true`;
}

export function buildZellijKillSessionCommand(sessionName: string): string {
  return `zellij kill-session ${zellijSessionNameArg(sessionName)}`;
}
