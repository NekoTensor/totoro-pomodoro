// The alarm beep: a short 880 Hz square wave every 500 ms.
//
// Audio is best-effort. If the AudioContext cannot be created or resumed the
// alarm simply continues visually — a missing beep must never throw and take
// the state machine down with it.

const FREQUENCY_HZ = 880;
const BEEP_MS = 120;
const INTERVAL_MS = 500;
const GAIN = 0.15;

/** Beeping stops after a minute; the visual flash carries on until dismissed. */
const MAX_AUDIBLE_MS = 60_000;

export class AlarmAudio {
  private context: AudioContext | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  start(): void {
    if (this.running) return;
    this.running = true;

    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new Error('WebAudio unavailable');
      this.context = new Ctor();
      void this.context.resume().catch(() => undefined);
    } catch (error) {
      console.warn('[audio] alarm will be silent', error);
      this.context = null;
    }

    this.beep();
    this.interval = setInterval(() => this.beep(), INTERVAL_MS);
    this.stopTimer = setTimeout(() => this.silence(), MAX_AUDIBLE_MS);
  }

  private beep(): void {
    const context = this.context;
    if (!context) return;

    try {
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'square';
      oscillator.frequency.value = FREQUENCY_HZ;
      gain.gain.value = GAIN;

      oscillator.connect(gain);
      gain.connect(context.destination);

      const now = context.currentTime;
      oscillator.start(now);
      oscillator.stop(now + BEEP_MS / 1000);
      // Release the nodes as soon as the tone finishes so repeated beeps do
      // not accumulate an ever-growing graph.
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    } catch (error) {
      console.warn('[audio] beep failed', error);
    }
  }

  /** Stops the sound but leaves the object usable; called by the 60s cap. */
  private silence(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    if (this.context) {
      void this.context.close().catch(() => undefined);
      this.context = null;
    }
  }

  /** Full teardown. Safe to call repeatedly and from any state. */
  stop(): void {
    this.silence();
    this.running = false;
  }
}
