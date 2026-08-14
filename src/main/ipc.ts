// Every renderer-reachable capability, and nothing else. Each handler
// re-validates its payload: the renderer is treated as untrusted input.

import { BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { appendLog, currentDestination, currentLogFile, flushSpool } from './logger.js';
import { getState, patchState } from './persistence.js';
import { focusWindow, getWindow, shake } from './window.js';
import { IPC, type InitialState, type LogDestination, type LogResult } from '../shared/types.js';
import { isActiveSession, isLogEntryPayload, isPendingPrompt } from '../shared/validate.js';

/**
 * Windows cannot present a combined file-or-folder picker, so the choice of
 * *kind* is made first in a tiny native menu. macOS could merge the two, but a
 * single code path keeps behaviour identical everywhere.
 */
async function pickDestinationKind(parent: BrowserWindow): Promise<'file' | 'folder' | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: 'file' | 'folder' | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const menu = Menu.buildFromTemplate([
      { label: 'Choose Markdown file…', click: () => finish('file') },
      { label: 'Choose folder…', click: () => finish('folder') },
    ]);

    menu.popup({ window: parent, callback: () => finish(null) });
  });
}

export async function chooseLogDestination(): Promise<LogDestination | null> {
  const parent = getWindow();
  if (!parent) return null;

  const kind = await pickDestinationKind(parent);
  if (!kind) return null;

  let chosen: string | null = null;

  if (kind === 'file') {
    const result = await dialog.showSaveDialog(parent, {
      title: 'Pomodoro log file',
      defaultPath: currentLogFile(),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    chosen = result.canceled || !result.filePath ? null : result.filePath;
  } else {
    const existing = currentDestination();
    const result = await dialog.showOpenDialog(parent, {
      title: 'Pomodoro log folder',
      defaultPath: existing.type === 'folder' ? existing.path : undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    chosen = result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]!;
  }

  if (!chosen) return null;

  const destination: LogDestination = { type: kind, path: chosen };
  patchState({ logDestination: destination });

  // A new, working path is the natural moment to retry anything queued.
  flushSpool();

  return destination;
}

export function registerIpc(): void {
  ipcMain.handle(IPC.getInitialState, (): InitialState => {
    const state = getState();
    return {
      logDestination: currentDestination(),
      session: state.session,
      pendingPrompt: state.pendingPrompt,
    };
  });

  ipcMain.handle(IPC.chooseLogDestination, () => chooseLogDestination());

  ipcMain.handle(IPC.getLogDestination, () => currentDestination());

  ipcMain.handle(IPC.openLogFile, async (): Promise<boolean> => {
    const file = currentLogFile();
    const error = await shell.openPath(file);
    if (error) {
      // Most often the file doesn't exist yet; reveal the folder instead.
      shell.showItemInFolder(file);
      return false;
    }
    return true;
  });

  ipcMain.handle(IPC.appendLog, (_event, payload: unknown): LogResult => {
    if (!isLogEntryPayload(payload)) {
      // Logged loudly: a rejection here happens before anything is spooled, so
      // without this the failure leaves no trace on disk at all.
      console.error('[ipc] rejected malformed log payload', JSON.stringify(payload));
      return { ok: false, code: 'INVALID_PAYLOAD', message: 'Rejected malformed log payload.' };
    }

    const result = appendLog(payload);
    if (!result.ok) console.error('[ipc] log write failed', result.code, result.message);
    return result;
  });

  ipcMain.handle(IPC.saveSession, (_event, session: unknown): boolean => {
    if (session === null) {
      patchState({ session: null });
      return true;
    }
    if (!isActiveSession(session)) return false;
    patchState({ session });
    return true;
  });

  ipcMain.handle(IPC.savePendingPrompt, (_event, prompt: unknown): boolean => {
    if (prompt === null) {
      patchState({ pendingPrompt: null });
      return true;
    }
    if (!isPendingPrompt(prompt)) return false;
    // A pending prompt means the session is over; clearing both together keeps
    // the two records from ever describing different sessions.
    patchState({ pendingPrompt: prompt, session: null });
    return true;
  });

  ipcMain.handle(IPC.shakeWindow, (): boolean => shake());

  ipcMain.handle(IPC.focusWindow, (): boolean => focusWindow());

  ipcMain.handle(IPC.quit, (): void => {
    const target = getWindow();
    target?.close();
  });
}
