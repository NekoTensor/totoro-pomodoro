// Wires the pure state machine to the DOM, the shared animation loop and the
// preload bridge. All side effects live here; machine.ts stays pure.

import { buildTotoroMarkup } from './components/totoro.js';
import { onFrame, onTick, prefersReducedMotion } from './services/anim.js';
import { AlarmAudio } from './services/audio.js';
import { bridge } from './services/ipcClient.js';
import { formatMMSS, remainingMs, wedgeSteps } from './services/timer.js';
import { hydrate, initialState, reduce, type Event, type MachineState, type Phase } from './state/machine.js';
import { DEFAULT_MINUTES, WEDGE_STEPS, type LogEntryPayload } from '../shared/types.js';
import { clampMinutes, sanitizeTask } from '../shared/validate.js';

/** Spelled out rather than shown as caret notation, which reads as noise. */
const ABANDON_HINT = navigator.userAgent.includes('Mac')
  ? '&#8984;C = ABANDON'
  : 'CTRL+C = ABANDON';

/** Human-readable reasons for a failed write, so the belly can say why. */
const LOG_ERROR_TEXT: Record<string, string> = {
  PERMISSION_DENIED: 'NO PERMISSION',
  PATH_NOT_FOUND: 'PATH MISSING',
  NOT_A_DIRECTORY: 'BAD PATH',
  DISK_FULL: 'DISK FULL',
  INVALID_PAYLOAD: 'BAD DATA',
  IPC: 'APP ERROR',
  BRIDGE_UNAVAILABLE: 'NO CONNECTION',
  UNKNOWN: 'WRITE FAILED',
};

const FLASH_MS = 220;
const REDUCED_FLASH_MS = 1000;
const BLINK_MS = 90;
const BREATH_PERIOD_MS = 4000;

type Disposer = () => void;

export class App {
  private state: MachineState = initialState();
  private readonly character = document.getElementById('character')!;
  private readonly belly = document.getElementById('belly')!;
  private readonly glyphs = document.getElementById('glyphs')!;

  private wedge: SVGRectElement[] = [];
  /** Each wedge cell's step, cached so painting never re-parses the DOM. */
  private wedgeCellSteps: number[] = [];
  private dial!: SVGGElement;
  private bodyGroup!: SVGGElement;
  private eyelids: SVGRectElement[] = [];

  private readonly audio = new AlarmAudio();
  private phaseDisposers: Disposer[] = [];
  private frameDisposer: Disposer | null = null;
  private tickDisposer: Disposer | null = null;
  /** False until the first transition, so the initial phase runs its effects. */
  private entered = false;
  /** True when SETUP was reached from a finished session rather than a launch. */
  private returningToSetup = false;

  private litSteps = -1;
  private lastReadout = '';
  private nextBlinkAt = 0;
  private blinkUntil = 0;
  private breathOffset = -1;
  private reduced = prefersReducedMotion();

  async start(): Promise<void> {
    this.character.innerHTML = buildTotoroMarkup();
    this.dial = this.character.querySelector<SVGGElement>('#dial')!;
    this.bodyGroup = this.character.querySelector<SVGGElement>('#totoro-body')!;
    this.wedge = Array.from(this.character.querySelectorAll<SVGRectElement>('.wedge-step'));
    this.wedgeCellSteps = this.wedge.map((cell) => Number(cell.dataset.step ?? 0));
    this.eyelids = Array.from(this.character.querySelectorAll<SVGRectElement>('.eyelid'));

    this.bindGlobalKeys();
    this.bindGlyphs();

    const initial = await bridge.getInitialState().catch((error) => {
      console.error('[app] could not read initial state', error);
      return null;
    });

    const next = initial
      ? hydrate(initial.session, initial.pendingPrompt, Date.now())
      : initialState();

    // Two loops with different jobs: the tick drives the state machine and
    // keeps running while hidden; the frame loop only animates.
    this.tickDisposer = onTick((now) => this.onTick(now));
    this.frameDisposer = onFrame((now) => this.onFrame(now));
    bridge.onResumeFromSleep(() => this.onTick(Date.now()));

    this.transition(next, 'SETUP');
  }

  // ---------------------------------------------------------------- dispatch

  private dispatch(event: Event): void {
    const previous = this.state.phase;
    const next = reduce(this.state, event);
    if (next === this.state) return;
    this.transition(next, previous);
  }

  private transition(next: MachineState, previousPhase: Phase): void {
    const phaseChanged = !this.entered || next.phase !== previousPhase;
    if (phaseChanged && next.phase === 'SETUP' && this.entered) this.returningToSetup = true;
    this.state = next;

    if (phaseChanged) {
      this.disposePhase();
      this.entered = true;
      this.litSteps = -1;
      this.lastReadout = '';
      this.enterPhase(next.phase);
    }

    this.render();
  }

  private disposePhase(): void {
    for (const dispose of this.phaseDisposers.splice(0)) {
      try {
        dispose();
      } catch (error) {
        console.error('[app] cleanup failed', error);
      }
    }
  }

  /** Per-phase side effects. Everything registered here is torn down on exit. */
  private enterPhase(phase: Phase): void {
    switch (phase) {
      case 'TIMER': {
        const session = this.state.session;
        if (session) void bridge.saveSession(session).catch(() => undefined);
        break;
      }

      case 'ALARM': {
        // One deliberate interruption so Enter reaches Totoro; clicking
        // anywhere works too, in case focus could not be taken.
        void bridge.focusWindow().catch(() => undefined);
        if (!this.reduced) void bridge.shakeWindow().catch(() => undefined);

        this.audio.start();
        this.phaseDisposers.push(() => this.audio.stop());

        const period = this.reduced ? REDUCED_FLASH_MS : FLASH_MS;
        const flash = setInterval(() => this.dial.classList.toggle('flash'), period);
        this.phaseDisposers.push(() => {
          clearInterval(flash);
          this.dial.classList.remove('flash');
        });

        const dismiss = () => this.dispatch({ type: 'DISMISS_ALARM' });
        window.addEventListener('mousedown', dismiss);
        this.phaseDisposers.push(() => window.removeEventListener('mousedown', dismiss));
        break;
      }

      case 'LOG_PROMPT': {
        const prompt = this.state.prompt;
        if (prompt) void bridge.savePendingPrompt(prompt).catch(() => undefined);
        break;
      }

      case 'SETUP': {
        void bridge.saveSession(null).catch(() => undefined);
        void bridge.savePendingPrompt(null).catch(() => undefined);
        break;
      }
    }
  }

  // ------------------------------------------------------------------ frames

  /** Authoritative clock: advances the machine, and repaints the numbers. */
  private onTick(now: number): void {
    if (this.state.phase === 'TIMER') this.dispatch({ type: 'TICK', now });
    this.paintDial(now);
    this.paintReadout(now);
  }

  /** Animation only — safe to stop whenever the window is hidden. */
  private onFrame(now: number): void {
    this.animateIdle(now);
  }

  private animateIdle(now: number): void {
    // Breathing: a single stepped pixel, never interpolated.
    if (!this.reduced) {
      const phase = (now % BREATH_PERIOD_MS) / BREATH_PERIOD_MS;
      const offset = phase < 0.5 ? 0 : 1;
      if (offset !== this.breathOffset) {
        this.breathOffset = offset;
        this.bodyGroup.setAttribute('transform', `translate(0 ${offset})`);
      }
    }

    // Blinking survives reduced-motion: it is character, not movement.
    if (now >= this.blinkUntil && this.blinkUntil !== 0) {
      for (const lid of this.eyelids) lid.classList.remove('blink');
      this.blinkUntil = 0;
    }

    if (now >= this.nextBlinkAt) {
      if (this.nextBlinkAt !== 0) {
        for (const lid of this.eyelids) lid.classList.add('blink');
        this.blinkUntil = now + BLINK_MS;
      }
      // Totoro blinks less while concentrating on a session.
      const [min, max] = this.state.phase === 'TIMER' ? [9000, 20000] : [4000, 10000];
      this.nextBlinkAt = now + min + Math.random() * (max - min);
    }
  }

  private paintDial(now: number): void {
    let lit = 0;

    if (this.state.phase === 'TIMER' && this.state.session) {
      lit = wedgeSteps(this.state.session, now);
    } else if (this.state.phase === 'ALARM') {
      lit = WEDGE_STEPS;
    } else if (this.state.phase === 'LOG_PROMPT' && this.state.prompt) {
      const prompt = this.state.prompt;
      lit = wedgeSteps({ startedAt: 0, plannedDurationMs: prompt.plannedDurationMs }, prompt.elapsedMs);
    }

    if (lit === this.litSteps) return;
    this.litSteps = lit;

    // Repainted only when the step count actually changes — at most 60 times
    // across a whole session, whatever its length.
    this.wedge.forEach((cell, index) => {
      cell.classList.toggle('on', this.wedgeCellSteps[index]! < lit);
    });
  }

  private paintReadout(now: number): void {
    const element = this.belly.querySelector<HTMLElement>('#readout');
    if (!element) return;

    let text = this.lastReadout;
    if (this.state.phase === 'TIMER' && this.state.session) {
      text = formatMMSS(remainingMs(this.state.session, now));
    } else if (this.state.phase === 'ALARM') {
      text = formatMMSS(0);
    }

    if (text !== this.lastReadout) {
      this.lastReadout = text;
      element.textContent = text;
    }
  }

  // ------------------------------------------------------------------ render

  private render(): void {
    const { phase } = this.state;
    this.glyphs.classList.toggle('hidden', phase === 'TIMER' || phase === 'ALARM');

    switch (phase) {
      case 'SETUP':
        this.renderSetup();
        break;
      case 'TIMER':
      case 'ALARM':
        this.renderTimer();
        break;
      case 'LOG_PROMPT':
        this.renderLogPrompt();
        break;
    }
  }

  private renderSetup(): void {
    const minutes = this.state.minutes > 0 ? String(this.state.minutes) : '';

    this.belly.innerHTML = `
      <input id="minutes-input" style="top:201px" type="text" inputmode="numeric"
             maxlength="3" value="${minutes}" aria-label="Minutes" />
      <div class="centered label label-inverse" style="top:240px">MIN</div>
      <input id="task-input" style="top:278px" type="text" maxlength="24"
             placeholder="(task)" value="${escapeHtml(this.state.task)}" aria-label="Task" />
      <div class="centered hint" style="top:294px">&#8629; START</div>`;

    const minutesInput = this.belly.querySelector<HTMLInputElement>('#minutes-input')!;
    const taskInput = this.belly.querySelector<HTMLInputElement>('#task-input')!;

    minutesInput.addEventListener('input', () => {
      this.state = reduce(this.state, { type: 'SET_MINUTES', value: minutesInput.value });
      const normalized = this.state.minutes > 0 ? String(this.state.minutes) : '';
      if (minutesInput.value !== normalized) minutesInput.value = normalized;
    });

    taskInput.addEventListener('input', () => {
      this.state = reduce(this.state, { type: 'SET_TASK', value: taskInput.value });
      if (taskInput.value !== this.state.task) taskInput.value = this.state.task;
    });

    if (this.state.inputError) {
      minutesInput.classList.add('jitter');
      minutesInput.addEventListener('animationend', () => minutesInput.classList.remove('jitter'), {
        once: true,
      });
    }

    // Returning to SETUP after a session focuses AND selects the duration,
    // ready to retype. On a cold start it is only focused, so the widget rests
    // without a highlight block sitting over the number.
    minutesInput.focus();
    if (this.returningToSetup) {
      minutesInput.select();
      this.returningToSetup = false;
    }
  }

  private renderTimer(): void {
    const session = this.state.session;
    const task = session?.task ?? '';

    this.belly.innerHTML = `
      <div id="readout" class="centered readout" style="top:205px">${escapeHtml(this.lastReadout || '00:00')}</div>
      ${task ? `<div class="centered label" style="top:278px">${escapeHtml(task.toUpperCase())}</div>` : ''}
      ${this.state.phase === 'TIMER' ? `<div class="centered hint" style="top:294px">${ABANDON_HINT}</div>` : ''}`;
  }

  private renderLogPrompt(): void {
    const prompt = this.state.prompt;
    if (!prompt) return;

    const plannedMinutes = Math.round(prompt.plannedDurationMs / 60_000);
    const label = prompt.task || '(no label)';

    if (this.state.logError) {
      this.belly.innerHTML = `
        <div class="centered label label-inverse" style="top:186px">${prompt.outcome.toUpperCase()}</div>
        <div class="centered readout" style="top:200px">${formatMMSS(prompt.elapsedMs)}</div>
        <div class="error-plate" style="top:240px;left:58px;width:164px;text-align:center">
          <div class="label">${LOG_ERROR_TEXT[this.state.logError] ?? 'WRITE FAILED'}</div>
          <div class="label" style="margin-top:2px">SAVED &#183; WILL RETRY</div>
          <div style="display:flex;gap:4px;justify-content:center;margin-top:4px">
            <button id="btn-retry" class="pixel-button" style="width:40px">RETRY</button>
            <button id="btn-path" class="pixel-button" style="width:40px">PATH</button>
            <button id="btn-skip" class="pixel-button" style="width:36px">SKIP</button>
          </div>
        </div>`;

      this.belly.querySelector('#btn-retry')!.addEventListener('click', () => void this.writeLog());
      this.belly.querySelector('#btn-path')!.addEventListener('click', () => void this.changePath());
      this.belly.querySelector('#btn-skip')!.addEventListener('click', () => this.dispatch({ type: 'RESOLVE' }));
      return;
    }

    this.belly.innerHTML = `
      <div class="centered label label-inverse" style="top:186px">${prompt.outcome.toUpperCase()}</div>
      <div class="centered readout" style="top:200px">${formatMMSS(prompt.elapsedMs)}</div>
      <div class="centered label label-inverse" style="top:232px">${plannedMinutes} MIN PLANNED</div>
      <div class="centered label label-inverse" style="top:248px">${escapeHtml(label.toUpperCase())}</div>
      <div style="top:278px;left:102px;display:flex;gap:6px">
        <button id="btn-log" class="pixel-button" style="width:34px">LOG</button>
        <button id="btn-skip" class="pixel-button" style="width:36px">SKIP</button>
      </div>`;

    this.belly.querySelector('#btn-log')!.addEventListener('click', () => void this.writeLog());
    this.belly.querySelector('#btn-skip')!.addEventListener('click', () => this.dispatch({ type: 'RESOLVE' }));
  }

  // ------------------------------------------------------------------ actions

  private async writeLog(): Promise<void> {
    const prompt = this.state.prompt;
    if (!prompt) return;

    // Every field is coerced into the range the main process validates, so a
    // starved tick or an odd duration can never turn a real session into a
    // rejected payload.
    const payload: LogEntryPayload = {
      outcome: prompt.outcome,
      plannedMinutes: clampMinutes(Math.round(prompt.plannedDurationMs / 60_000), DEFAULT_MINUTES),
      elapsedMs: Math.max(0, Math.min(Math.round(prompt.elapsedMs), prompt.plannedDurationMs)),
      task: sanitizeTask(prompt.task),
      endedAt: Math.max(0, Math.round(prompt.endedAt)),
    };

    try {
      const result = await bridge.appendLog(payload);
      if (result.ok) {
        this.dispatch({ type: 'RESOLVE' });
      } else {
        console.error('[app] log rejected', result.code, result.message, payload);
        this.dispatch({ type: 'LOG_FAILED', message: result.code });
      }
    } catch (error) {
      console.error('[app] log IPC failed', error, payload);
      this.dispatch({ type: 'LOG_FAILED', message: 'IPC' });
    }
  }

  private async changePath(): Promise<void> {
    const chosen = await bridge.chooseLogDestination().catch(() => null);
    if (chosen) void this.writeLog();
  }

  // ----------------------------------------------------------------- keyboard

  private bindGlyphs(): void {
    document
      .getElementById('glyph-settings')!
      .addEventListener('click', () => void bridge.chooseLogDestination().catch(() => null));
    document
      .getElementById('glyph-close')!
      .addEventListener('click', () => void bridge.quit().catch(() => undefined));
  }

  private bindGlobalKeys(): void {
    window.addEventListener('keydown', (event) => {
      const { phase } = this.state;

      // Ctrl+C (Cmd+C on macOS) abandons a running session.
      if (phase === 'TIMER' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        this.dispatch({ type: 'CANCEL', now: Date.now() });
        return;
      }

      if (phase === 'SETUP' && event.key === 'Enter') {
        event.preventDefault();
        this.dispatch({ type: 'START', now: Date.now(), id: newSessionId() });
        return;
      }

      if (phase === 'ALARM' && event.key === 'Enter') {
        event.preventDefault();
        this.dispatch({ type: 'DISMISS_ALARM' });
        return;
      }

      if (phase === 'LOG_PROMPT') {
        if (event.key === 'Enter') {
          event.preventDefault();
          void this.writeLog();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          this.dispatch({ type: 'RESOLVE' });
        } else if (this.state.logError && event.key.toLowerCase() === 'n') {
          event.preventDefault();
          void this.changePath();
        }
      }
    });
  }

  /** Only used if the app is ever torn down; keeps the loop honest. */
  destroy(): void {
    this.disposePhase();
    this.frameDisposer?.();
    this.tickDisposer?.();
  }
}

function newSessionId(): string {
  return crypto.randomUUID();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
