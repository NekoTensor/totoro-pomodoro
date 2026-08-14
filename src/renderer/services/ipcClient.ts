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
      return { ok: false, code: 'UNKNOWN', message: 'Bridge unavailable' };
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

const injected = typeof window !== 'undefined' ? window.totoro : undefined;

export const bridge: TotoroApi = injected ?? inertBridge();
