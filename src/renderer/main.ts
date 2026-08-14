import { App } from './app.js';

const app = new App();
void app.start().catch((error) => {
  console.error('[main] failed to start', error);
});
