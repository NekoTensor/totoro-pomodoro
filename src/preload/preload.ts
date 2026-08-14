// The entire bridge between the sandboxed renderer and the main process.
//
// Note what is NOT here: no fs, no path, no require, no process, no
// child_process, and no generic ipcRenderer. Every function below maps to one
// specific, validated main-process capability, and none of them accepts a
// filesystem path from the renderer.

import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type ActiveSession,
  type InitialState,
  type LogDestination,
  type LogEntryPayload,
  type LogResult,
  type PendingPrompt,
  type TotoroApi,
} from '../shared/types.js';

const api: TotoroApi = {
  getInitialState: (): Promise<InitialState> => ipcRenderer.invoke(IPC.getInitialState),

  chooseLogDestination: (): Promise<LogDestination | null> =>
    ipcRenderer.invoke(IPC.chooseLogDestination),

  getLogDestination: (): Promise<LogDestination | null> =>
    ipcRenderer.invoke(IPC.getLogDestination),

  openLogFile: (): Promise<boolean> => ipcRenderer.invoke(IPC.openLogFile),

  appendLog: (payload: LogEntryPayload): Promise<LogResult> =>
    ipcRenderer.invoke(IPC.appendLog, payload),

  saveSession: (session: ActiveSession | null): Promise<boolean> =>
    ipcRenderer.invoke(IPC.saveSession, session),

  savePendingPrompt: (prompt: PendingPrompt | null): Promise<boolean> =>
    ipcRenderer.invoke(IPC.savePendingPrompt, prompt),

  // Takes no arguments on purpose: amplitude, duration and position are fixed
  // in the main process so the renderer cannot drive the window around.
  shakeWindow: (): Promise<boolean> => ipcRenderer.invoke(IPC.shakeWindow),

  focusWindow: (): Promise<boolean> => ipcRenderer.invoke(IPC.focusWindow),

  quit: (): Promise<void> => ipcRenderer.invoke(IPC.quit),

  onResumeFromSleep: (callback: () => void): void => {
    // The listener receives no event object, so nothing from the main process
    // leaks into renderer scope.
    ipcRenderer.on(IPC.resumeFromSleep, () => callback());
  },
};

contextBridge.exposeInMainWorld('totoro', api);
