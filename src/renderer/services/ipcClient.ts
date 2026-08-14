// Single access point for the preload bridge.
//
// If the preload failed to load, or the page is opened outside Electron, the
// bridge is replaced by an inert stub. Totoro still draws and the timer still
// runs; only persistence and logging are unavailable. That is much better than
// an uncaught TypeError blanking the window.

import type {
  ActiveSession,
  InitialState,
  LogDestination,
  LogResult,
  PendingPrompt,
  TotoroApi,
} from '../../shared/types.js';

declare global {
  interface Window {
    totoro?: TotoroApi;
  }
}

function inertBridge(): TotoroApi {
  let warned = false;
  const warn = () => {
    if (warned) return;
    warned = true;
    console.warn('[bridge] preload unavailable: running without persistence or logging');
  };

  return {
    getInitialState: async (): Promise<InitialState> => {
      warn();
      return { logDestination: null, session: null, pendingPrompt: null };
    },
    chooseLogDestination: async (): Promise<LogDestination | null> => {
      warn();
      return null;
    },
    getLogDestination: async (): Promise<LogDestination | null> => {
      warn();
      return null;
    },
    openLogFile: async () => {
      warn();
      return false;
    },
    appendLog: async (): Promise<LogResult> => {
      warn();
      return { ok: false, code: 'BRIDGE_UNAVAILABLE', message: 'Preload bridge unavailable' };
    },
    saveSession: async (_session: ActiveSession | null) => {
      warn();
      return false;
    },
    savePendingPrompt: async (_prompt: PendingPrompt | null) => {
      warn();
      return false;
    },
    shakeWindow: async () => {
      warn();
      return false;
    },
    focusWindow: async () => {
      warn();
      return false;
    },
    quit: async () => {
      warn();
    },
    onResumeFromSleep: () => {
      warn();
    },
  };
}

const fallback = inertBridge();

/**
 * Resolved on every call rather than captured once at module load. Capturing
 * it up front bakes in whatever `window.totoro` happened to be at import time,
 * so any ordering hiccup would permanently pin the app to the inert stub and
 * silently break saving for the rest of the session.
 */
function api(): TotoroApi {
  if (typeof window === 'undefined') return fallback;
  return window.totoro ?? fallback;
}

export const bridge: TotoroApi = {
  getInitialState: () => api().getInitialState(),
  chooseLogDestination: () => api().chooseLogDestination(),
  getLogDestination: () => api().getLogDestination(),
  openLogFile: () => api().openLogFile(),
  appendLog: (payload) => api().appendLog(payload),
  saveSession: (session) => api().saveSession(session),
  savePendingPrompt: (prompt) => api().savePendingPrompt(prompt),
  shakeWindow: () => api().shakeWindow(),
  focusWindow: () => api().focusWindow(),
  quit: () => api().quit(),
  onResumeFromSleep: (callback) => api().onResumeFromSleep(callback),
};

/** True when the real preload bridge is present. */
export function bridgeAvailable(): boolean {
  return typeof window !== 'undefined' && window.totoro != null;
}
