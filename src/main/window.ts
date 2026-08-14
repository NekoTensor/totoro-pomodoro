// The one window: frameless, transparent, always-on-top, non-resizable.

import { BrowserWindow, screen, shell } from 'electron';
import { join } from 'node:path';
import { getState, patchState } from './persistence.js';

export const WINDOW_WIDTH = 280;
export const WINDOW_HEIGHT = 340;

const SHAKE_AMPLITUDE = 7;
const SHAKE_DURATION_MS = 2000;
const SHAKE_FRAME_MS = 16;

let win: BrowserWindow | null = null;
let shakeTimer: NodeJS.Timeout | null = null;
let shakeStop: NodeJS.Timeout | null = null;

/**
 * Keeps a remembered position usable: if the monitor it lived on is gone, the
 * window is pulled back onto the nearest display's work area instead of
 * opening off-screen where it can't be reached.
 */
function clampToDisplay(x: number, y: number): { x: number; y: number } {
  const { workArea } = screen.getDisplayNearestPoint({ x, y });
  const maxX = workArea.x + workArea.width - WINDOW_WIDTH;
  const maxY = workArea.y + workArea.height - WINDOW_HEIGHT;
  return {
    x: Math.round(Math.min(Math.max(x, workArea.x), Math.max(maxX, workArea.x))),
    y: Math.round(Math.min(Math.max(y, workArea.y), Math.max(maxY, workArea.y))),
  };
}

export function createWindow(): BrowserWindow {
  const saved = getState().window;
  const position = saved ? clampToDisplay(saved.x, saved.y) : null;

  win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    ...(position ?? {}),
    center: position === null,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    title: 'Totoro Pomodoro',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // The countdown must keep ticking while Totoro sits behind other
      // windows; without this Chromium throttles timers when occluded.
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  win.setMenuBarVisibility(false);

  // Nothing in this app should ever navigate or open a window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  const remember = () => {
    if (!win || win.isDestroyed() || shakeTimer) return;
    const [x, y] = win.getPosition();
    patchState({ window: { x, y } });
  };
  win.on('moved', remember);

  win.once('ready-to-show', () => win?.show());

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  win.on('closed', () => {
    win = null;
  });

  return win;
}

export function getWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

export function focusWindow(): boolean {
  const target = getWindow();
  if (!target) return false;
  if (target.isMinimized()) target.restore();
  target.show();
  target.focus();
  return true;
}

export function recenter(): boolean {
  const target = getWindow();
  if (!target) return false;
  target.center();
  const [x, y] = target.getPosition();
  patchState({ window: { x, y } });
  return true;
}

/**
 * Jitters the window around its current position for two seconds, then puts it
 * back exactly where it was. Amplitude and duration are fixed here rather than
 * taken from the renderer, so a compromised renderer cannot drive the window.
 */
export function shake(): boolean {
  const target = getWindow();
  if (!target) return false;

  cancelShake();
  const [baseX, baseY] = target.getPosition();

  const restore = () => {
    cancelShake();
    const current = getWindow();
    if (current) current.setPosition(baseX, baseY);
  };

  shakeTimer = setInterval(() => {
    const current = getWindow();
    if (!current) {
      cancelShake();
      return;
    }
    const dx = Math.round((Math.random() * 2 - 1) * SHAKE_AMPLITUDE);
    const dy = Math.round((Math.random() * 2 - 1) * SHAKE_AMPLITUDE);
    current.setPosition(baseX + dx, baseY + dy);
  }, SHAKE_FRAME_MS);

  shakeStop = setTimeout(restore, SHAKE_DURATION_MS);
  return true;
}

/** Stops any running shake. Called when leaving ALARM and on quit. */
export function cancelShake(): void {
  if (shakeTimer) {
    clearInterval(shakeTimer);
    shakeTimer = null;
  }
  if (shakeStop) {
    clearTimeout(shakeStop);
    shakeStop = null;
  }
}
