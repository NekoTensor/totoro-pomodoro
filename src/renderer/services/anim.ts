// One requestAnimationFrame loop for the whole app, throttled to ~8fps.
//
// This is the app's only continuous background cost, so it is deliberately
// coarse and it stops entirely whenever the window is hidden.

const FRAME_MS = 125;

type Subscriber = (now: number) => void;

const subscribers = new Set<Subscriber>();
let handle: number | null = null;
let lastFrame = 0;

function loop(timestamp: number): void {
  handle = requestAnimationFrame(loop);
  if (timestamp - lastFrame < FRAME_MS) return;
  lastFrame = timestamp;

  const now = Date.now();
  for (const subscriber of subscribers) {
    try {
      subscriber(now);
    } catch (error) {
      console.error('[anim] subscriber failed', error);
    }
  }
}

function ensureRunning(): void {
  if (handle === null && subscribers.size > 0 && !document.hidden) {
    handle = requestAnimationFrame(loop);
  }
}

function stop(): void {
  if (handle !== null) {
    cancelAnimationFrame(handle);
    handle = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop();
  else ensureRunning();
});

/** Subscribes to the shared loop. The returned disposer must be called. */
export function onFrame(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  ensureRunning();

  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) stop();
  };
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** How often the authoritative clock re-evaluates the session. */
const TICK_MS = 250;

/**
 * The authoritative tick, deliberately separate from the animation loop.
 *
 * requestAnimationFrame stops when the window is hidden or occluded, so it
 * must never be the only thing driving the state machine — a hidden session
 * would simply stop advancing and sail past its own end. setInterval keeps
 * running (the window is created with backgroundThrottling disabled), so the
 * alarm still fires while Totoro is behind another window.
 */
export function onTick(subscriber: (now: number) => void): () => void {
  const handle = setInterval(() => {
    try {
      subscriber(Date.now());
    } catch (error) {
      console.error('[anim] tick subscriber failed', error);
    }
  }, TICK_MS);

  return () => clearInterval(handle);
}
