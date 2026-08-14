// Dev runner: boots the Vite dev server in-process, then launches Electron
// pointed at it. Avoids concurrently/wait-on/cross-env entirely so the dev
// flow behaves identically on Windows, macOS and Linux.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');

const server = await createServer();
await server.listen();

const url = server.resolvedUrls?.local?.[0];
if (!url) {
  console.error('Vite did not report a local URL.');
  await server.close();
  process.exit(1);
}

console.log(`[dev] vite ready at ${url}`);

const child = spawn(electronBinary, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});

const shutdown = async (code) => {
  await server.close().catch(() => {});
  process.exit(code ?? 0);
};

child.on('close', shutdown);
process.on('SIGINT', () => {
  child.kill();
  shutdown(0);
});
