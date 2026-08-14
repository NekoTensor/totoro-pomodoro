// Generates the README artwork: transparent captures of each UI state, plus a
// composed banner. Run with:  npx electron scripts/gen-docs-images.cjs
//
// Every image is produced from the real renderer, so the docs can never drift
// from what the app actually looks like.

const { app, BrowserWindow } = require('electron');
const { writeFileSync, mkdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const DOCS = join(ROOT, 'docs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function makeWindow() {
  return new BrowserWindow({
    width: 280,
    height: 340,
    frame: false,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
}

async function shoot(win, name) {
  const image = await win.webContents.capturePage();
  const file = join(DOCS, `${name}.png`);
  writeFileSync(file, image.toPNG());
  console.log(`docs/${name}.png`);
  return file;
}

const press = (win, key) =>
  win.webContents.executeJavaScript(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true })); true;`,
  );

/**
 * Runs a snippet inside an IIFE and returns a status string instead of
 * throwing, so a failure names itself rather than surfacing as the opaque
 * "Script failed to execute".
 */
function run(win, body) {
  return win.webContents.executeJavaScript(
    `(() => { try { ${body} return 'ok'; } catch (e) { return 'ERR: ' + e.message; } })()`,
  );
}

const dataUri = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;

const BANNER_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 560px;
    background: #1b1c18;
    font-family: Menlo, Monaco, 'Courier New', monospace;
    color: #ebebb4;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    /* Faint pixel grid, drawn with hard-edged repeating lines. */
    background-image:
      linear-gradient(#23241f 1px, transparent 1px),
      linear-gradient(90deg, #23241f 1px, transparent 1px);
    background-size: 20px 20px;
  }
  h1 { font-size: 34px; letter-spacing: 6px; font-weight: 700; }
  .sub { margin-top: 10px; font-size: 13px; letter-spacing: 2px; color: #8b9a68; }
  .row { display: flex; gap: 28px; margin-top: 34px; align-items: flex-end; }
  .cell { display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .cell img { width: 196px; height: 238px; image-rendering: pixelated; }
  .cap { font-size: 11px; letter-spacing: 2px; color: #7c7c64; }
`;

app.whenReady().then(async () => {
  mkdirSync(DOCS, { recursive: true });
  const win = makeWindow();
  win.webContents.on('console-message', (_e, _l, m) => console.log(`  [renderer] ${m}`));
  await win.loadFile(join(ROOT, 'dist', 'renderer', 'index.html'));
  await wait(1500);

  const setup = await shoot(win, 'state-setup');

  // A 1-minute session gives a visible wedge quickly and reaches the alarm.
  console.log('set minutes:', await run(win, `
    const i = document.getElementById('minutes-input');
    if (!i) throw new Error('minutes-input missing; belly = ' + document.getElementById('belly').innerHTML.slice(0, 120));
    i.value = '1';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  `));
  await press(win, 'Enter');
  await wait(22_000);
  const timer = await shoot(win, 'state-timer');

  await wait(40_000);
  const alarm = await shoot(win, 'state-alarm');

  await press(win, 'Enter');
  await wait(900);
  const prompt = await shoot(win, 'state-logprompt');

  // Compose the banner from the captures just taken.
  const banner = new BrowserWindow({
    width: 1200,
    height: 560,
    frame: false,
    show: false,
    backgroundColor: '#1b1c18',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  const cells = [
    [setup, 'SETUP'],
    [timer, 'TIMER'],
    [alarm, 'ALARM'],
    [prompt, 'LOG'],
  ]
    .map(([file, cap]) => `<div class="cell"><img src="${dataUri(file)}"><div class="cap">${cap}</div></div>`)
    .join('');

  const html = `<!doctype html><meta charset="utf-8"><style>${BANNER_CSS}</style>
    <h1>TOTORO POMODORO</h1>
    <div class="sub">THE CHARACTER IS THE INTERFACE</div>
    <div class="row">${cells}</div>`;

  await banner.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await wait(1200);
  const image = await banner.webContents.capturePage();
  writeFileSync(join(DOCS, 'banner.png'), image.toPNG());
  console.log('docs/banner.png');

  app.quit();
});
