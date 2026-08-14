// Dev-only visual check: renders the built UI in a real Electron window and
// writes PNGs, so the pixel art can be reviewed without a display.
//
//   npm run build && npx electron scripts/shot.cjs
//
// Not part of the app: it never loads the preload, so the renderer falls back
// to its inert bridge and nothing is persisted or logged. It runs a real
// one-minute session so the wedge and the alarm can be seen for real rather
// than mocked.

const { app, BrowserWindow } = require('electron');
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const outDir = join(__dirname, '..', 'shots');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function capture(win, name) {
  const image = await win.webContents.capturePage();
  writeFileSync(join(outDir, `${name}.png`), image.toPNG());
  console.log(`wrote shots/${name}.png`);
}

async function press(win, key) {
  await win.webContents.executeJavaScript(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`,
  );
}

app.whenReady().then(async () => {
  mkdirSync(outDir, { recursive: true });

  const win = new BrowserWindow({
    width: 280,
    height: 340,
    frame: false,
    show: false,
    // Opaque mid-grey so the silhouette's edges are visible in the capture.
    backgroundColor: '#3a3a3a',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  await win.loadFile(join(__dirname, '..', 'dist', 'renderer', 'index.html'));
  await wait(1200);
  await capture(win, 'setup');

  // Run a real 1-minute session so the wedge fills at 1 step per second.
  await win.webContents.executeJavaScript(`
    const input = document.getElementById('minutes-input');
    input.value = '1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await press(win, 'Enter');
  await wait(1000);
  await capture(win, 'timer');

  await wait(20_000);
  await capture(win, 'wedge');

  // Past the one-minute mark the machine enters ALARM.
  await wait(42_000);
  await capture(win, 'alarm');

  await press(win, 'Enter');
  await wait(800);
  await capture(win, 'logprompt');

  app.quit();
});
