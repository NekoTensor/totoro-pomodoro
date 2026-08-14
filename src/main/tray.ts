// Tray icon: the app's persistent presence, since the window has no frame and
// is hidden from the taskbar/Dock.

import { app, Menu, nativeImage, Tray } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chooseLogDestination } from './ipc.js';
import { currentLogFile } from './logger.js';
import { focusWindow, recenter } from './window.js';
import { shell } from 'electron';

let tray: Tray | null = null;

function iconPath(): string {
  // Packaged builds carry build/ as an extra resource; dev reads it from source.
  const packaged = join(process.resourcesPath ?? '', 'build', 'tray.png');
  if (existsSync(packaged)) return packaged;
  return join(__dirname, '../../build/tray.png');
}

export function createTray(): Tray | null {
  const image = nativeImage.createFromPath(iconPath());
  if (image.isEmpty()) {
    console.warn('[tray] icon missing; continuing without a tray');
    return null;
  }

  // macOS menu-bar icons must be template images to follow light/dark mode.
  if (process.platform === 'darwin') image.setTemplateImage(true);

  tray = new Tray(image);
  tray.setToolTip('Totoro Pomodoro');

  const menu = Menu.buildFromTemplate([
    { label: 'Show Totoro', click: () => focusWindow() },
    { type: 'separator' },
    { label: 'Change log destination…', click: () => void chooseLogDestination() },
    {
      label: 'Open log file',
      click: () => {
        const file = currentLogFile();
        void shell.openPath(file).then((error) => {
          if (error) shell.showItemInFolder(file);
        });
      },
    },
    { label: 'Recenter Totoro', click: () => recenter() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setContextMenu(menu);
  tray.on('click', () => focusWindow());

  return tray;
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
