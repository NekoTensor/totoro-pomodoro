import { app } from 'electron';
import { join } from 'node:path';
import type { LogDestination } from '../shared/types.js';

/** File created inside a chosen folder, and the default file's name. */
export const LOG_FILE_NAME = 'pomodoro-log.md';

/**
 * The out-of-the-box log destination. Resolved through Electron's `documents`
 * path rather than string-building `~/Documents`, so Windows Known Folder
 * redirection (OneDrive) and localized folder names are all honoured, and no
 * developer-specific path is ever baked in.
 */
export function defaultLogDestination(): LogDestination {
  return { type: 'file', path: join(app.getPath('documents'), LOG_FILE_NAME) };
}

/** Resolves a destination to the actual Markdown file to append to. */
export function resolveLogFile(destination: LogDestination): string {
  return destination.type === 'folder'
    ? join(destination.path, LOG_FILE_NAME)
    : destination.path;
}

export function statePath(): string {
  return join(app.getPath('userData'), 'state.json');
}

export function spoolPath(): string {
  return join(app.getPath('userData'), 'pending-logs.json');
}
