import { app, powerMonitor } from 'electron';
import { registerIpc } from './ipc.js';
import { flushSpool } from './logger.js';
import { flushState, loadState } from './persistence.js';
import { createTray, destroyTray } from './tray.js';
import { cancelShake, createWindow, focusWindow, getWindow } from './window.js';
import { IPC } from '../shared/types.js';

// A second Totoro would mean two timers writing the same log and state files.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => focusWindow());

  // No Dock icon on macOS: the tray is the app's presence, per the widget
  // design. Windows/Linux use skipTaskbar on the window itself.
  if (process.platform === 'darwin') app.dock?.hide();

  app.whenReady().then(() => {
    loadState();
    registerIpc();
    flushSpool();

    // Linux compositors need a beat before a transparent window is created,
    // otherwise it can come up opaque black.
    const start = () => {
      createWindow();
      createTray();
    };
    if (process.platform === 'linux') setTimeout(start, 100);
    else start();

    // Waking from sleep is the one moment the renderer's own tick cannot be
    // trusted to have run, so it is told to re-evaluate immediately.
    powerMonitor.on('resume', () => {
      getWindow()?.webContents.send(IPC.resumeFromSleep);
    });

    app.on('activate', () => {
      if (!getWindow()) createWindow();
      else focusWindow();
    });
  });

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', () => {
    cancelShake();
    destroyTray();
    // Last chance to get an in-flight session or pending prompt onto disk.
    flushState();
  });
}
