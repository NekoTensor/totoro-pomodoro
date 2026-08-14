// Types shared by main, preload and renderer. This module must stay free of
// any Electron, Node or DOM imports so every consumer can use it.

export const MIN_MINUTES = 1;
export const MAX_MINUTES = 180;
export const MAX_TASK_LENGTH = 24;
export const DEFAULT_MINUTES = 25;

/** Wedge granularity: 60 fixed steps around the dial regardless of duration. */
export const WEDGE_STEPS = 60;

/**
 * How far past the planned end we still treat a session as "just finished"
 * and fire the alarm. Beyond this the machine was asleep or frozen, and the
 * session is reported as interrupted instead of blaring hours later.
 */
export const ALARM_GRACE_MS = 2 * 60 * 1000;

export type SessionOutcome = 'completed' | 'abandoned' | 'interrupted';

export interface LogDestination {
  type: 'file' | 'folder';
  path: string;
}

/** A session currently running. Persisted so a crash can resume it. */
export interface ActiveSession {
  id: string;
  startedAt: number;
  plannedDurationMs: number;
  task: string;
  status: 'running';
}

/**
 * A finished session awaiting the user's LOG/SKIP decision. Persisted the
 * moment it is created so an unanswered prompt survives a shutdown.
 */
export interface PendingPrompt {
  id: string;
  startedAt: number;
  endedAt: number;
  plannedDurationMs: number;
  task: string;
  outcome: SessionOutcome;
  elapsedMs: number;
}

export interface PersistedWindowPosition {
  x: number;
  y: number;
}

export interface AppState {
  version: 1;
  logDestination: LogDestination | null;
  window: PersistedWindowPosition | null;
  session: ActiveSession | null;
  pendingPrompt: PendingPrompt | null;
}

/**
 * The only log payload the renderer may send. Note the absence of any path:
 * the main process resolves the destination from its own persisted state, so
 * the renderer cannot direct a write anywhere.
 */
export interface LogEntryPayload {
  outcome: SessionOutcome;
  plannedMinutes: number;
  elapsedMs: number;
  task: string;
  endedAt: number;
}

export type LogErrorCode =
  | 'NO_DESTINATION'
  | 'PERMISSION_DENIED'
  | 'PATH_NOT_FOUND'
  | 'NOT_A_DIRECTORY'
  | 'DISK_FULL'
  | 'INVALID_PAYLOAD'
  | 'UNKNOWN';

export type LogResult =
  | { ok: true; path: string; flushed: number }
  | { ok: false; code: LogErrorCode; message: string };

export interface InitialState {
  logDestination: LogDestination | null;
  session: ActiveSession | null;
  pendingPrompt: PendingPrompt | null;
}

/** The narrow surface exposed on `window.totoro` by the preload script. */
export interface TotoroApi {
  getInitialState(): Promise<InitialState>;
  chooseLogDestination(): Promise<LogDestination | null>;
  getLogDestination(): Promise<LogDestination | null>;
  openLogFile(): Promise<boolean>;
  appendLog(payload: LogEntryPayload): Promise<LogResult>;
  saveSession(session: ActiveSession | null): Promise<boolean>;
  savePendingPrompt(prompt: PendingPrompt | null): Promise<boolean>;
  shakeWindow(): Promise<boolean>;
  focusWindow(): Promise<boolean>;
  quit(): Promise<void>;
  onResumeFromSleep(callback: () => void): void;
}

export const IPC = {
  getInitialState: 'totoro:get-initial-state',
  chooseLogDestination: 'totoro:choose-log-destination',
  getLogDestination: 'totoro:get-log-destination',
  openLogFile: 'totoro:open-log-file',
  appendLog: 'totoro:append-log',
  saveSession: 'totoro:save-session',
  savePendingPrompt: 'totoro:save-pending-prompt',
  shakeWindow: 'totoro:shake-window',
  focusWindow: 'totoro:focus-window',
  quit: 'totoro:quit',
  resumeFromSleep: 'totoro:resume-from-sleep',
} as const;
