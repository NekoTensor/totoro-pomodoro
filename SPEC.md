# Totoro Pomodoro — Implementation Specification

## Context

Build a pixel-art Pomodoro widget as an Electron desktop companion. The product thesis: **the character is the UI**. Totoro sits quietly on the desktop; the timer is physically embedded in his belly. No dashboards, panels, title bars, gradients, or conventional chrome.

This is greenfield — new standalone repo at `C:\Amey\My Projects\totoro-pomodoro`, unrelated to the current NekoCortex checkout. Node v24.18.0 / npm 11.16.0 verified.

The brief was refined through a 17-question interview; every decision below is a resolved answer, not an assumption, unless listed under **Remaining Assumptions**.

---

## Decisions from the interview

| # | Area | Decision |
|---|---|---|
| 1 | Stack | Vanilla TypeScript + Vite, electron-builder, Vitest. No UI framework. |
| 2 | Log destination | Silent default, no first-run prompt. Created lazily on first successful LOG. Changeable anytime. |
| 3 | Control surfaces | System tray icon **+** hover-revealed pixel glyphs. **No** right-click context menu. |
| 4 | Recovery | End not passed → resume live TIMER. End passed → LOG_PROMPT as `INTERRUPTED`, elapsed clamped to planned. |
| 5 | Sleep/wake | Overshoot ≤ 2 min → normal ALARM. > 2 min → LOG_PROMPT `INTERRUPTED`. |
| 6 | Alarm reachability | `show()` + `focus()` once on entering ALARM, **plus** click-anywhere to dismiss. |
| 7 | Alarm duration | Beep max 60 s; visual flash continues indefinitely; shake 2 s. |
| 8 | SETUP layout | Minutes + `MIN` inside the dial; task on an underlined baseline across the belly below; `↵ START` beneath. |
| 9 | Breaks | None. Pure single-session timer. |
| 10 | Log structure | `# Pomodoro Log` title, `## YYYY-MM-DD` day headings, one file forever. Folder mode → `pomodoro-log.md` inside it. |
| 11 | Log failure | Durable spool in userData + inverted-belly error with RETRY / NEW PATH / SKIP. Auto-flush later. |
| 12 | Idle animation | 1 px stepped breathing (~4 s) + randomized blink 4–10 s; blinks rarer during TIMER. ~8 fps, paused when hidden. |
| 13 | Accessibility | Respect `prefers-reduced-motion`; full keyboard operability incl. focusable glyphs. No screen-reader live regions, no audio-mute toggle. |
| 14 | Window | Persist position (display-validated); hide from taskbar/Dock. Normal always-on-top level (not above fullscreen). No edge snapping. |
| 15 | Testing | Vitest unit + integration. No Playwright e2e. |
| 16 | Packaging | All 3 platforms configured; Windows actually built and verified here. Unsigned. |
| 17 | Repo | New folder + fresh `git init` with an initial commit. |
| 18 | Error visuals | Belly inverts to `#263238` with cream text. No new palette color. Invalid minutes clamp + 2-frame ±1 px jitter. |
| 19 | Wedge | 60 fixed steps around the dial, independent of session length. |
| 20 | DPI | Fixed 280×340 CSS px + `shape-rendering="crispEdges"` on integer coordinates. |
| 21 | Pending prompt | Persisted the instant it is created; restored on next launch. |

## Remaining assumptions

- Electron latest stable (v3x), TypeScript strict mode, ESM.
- State persisted as JSON at `app.getPath('userData')/state.json`, atomic write (temp file + rename), debounced 250 ms.
- Second instance → focus the existing window, then quit the new process.
- Beep: WebAudio square oscillator, 880 Hz, ~120 ms, gain 0.15, repeating every 500 ms.
- Timestamps logged in local time, `YYYY-MM-DD HH:mm`, 24-hour.
- `INTERRUPTED` logs as an unchecked box `- [ ]` with the `— interrupted` suffix.
- Default log path resolved via `app.getPath('documents')` — on this machine that correctly yields the OneDrive-redirected Documents folder.
- Both `Ctrl+C` and `Cmd+C` abandon on macOS.

---

## 1. Architecture

```
totoro-pomodoro/
├─ package.json  tsconfig.json  vite.config.ts  vitest.config.ts
├─ electron-builder.yml  .gitignore  README.md  SPEC.md
├─ build/            icon.png (512²), icon.ico, tray/ (16/32 px)
├─ src/
│  ├─ shared/                    # pure, imported by main AND renderer
│  │   ├─ types.ts               # Session, PendingPrompt, LogDestination, AppState
│  │   ├─ validate.ts            # isValidMinutes, sanitizeTask, isLogEntryPayload …
│  │   └─ markdown.ts            # formatEntry, formatDayHeading, FILE_HEADER
│  ├─ main/
│  │   ├─ main.ts                # lifecycle, single instance, powerMonitor, wiring
│  │   ├─ window.ts              # BrowserWindow, bounds persistence, shake, focus
│  │   ├─ tray.ts                # tray icon + menu
│  │   ├─ ipc.ts                 # channel handlers, argument validation
│  │   ├─ persistence.ts         # atomic state.json read/write, corruption recovery
│  │   ├─ logger.ts              # markdown append + spool flush
│  │   └─ paths.ts               # default destination resolution
│  ├─ preload/preload.ts         # contextBridge → window.totoro
│  └─ renderer/
│      ├─ index.html  main.ts  app.ts
│      ├─ components/ totoro.ts dial.ts setup.ts timer.ts alarm.ts logprompt.ts glyphs.ts
│      ├─ state/      machine.ts store.ts
│      ├─ services/   timer.ts audio.ts anim.ts ipcClient.ts
│      └─ styles/     pixel.css
└─ tests/  timer.spec.ts machine.spec.ts markdown.spec.ts logger.spec.ts
           persistence.spec.ts validate.spec.ts recovery.spec.ts ipc.spec.ts
```

**Layering rule:** `src/renderer/services/timer.ts` and everything in `src/shared/` import nothing from Electron or the DOM. That is what makes them unit-testable in plain Node.

**Build:** Vite builds the renderer to `dist/renderer`; `tsc` compiles main + preload to `dist/main` and `dist/preload` (CommonJS, since preload requires it). `npm run dev` runs Vite dev server + Electron with hot reload of the renderer.

---

## 2. UI

**Window:** 280×340, frameless, transparent, non-resizable, always-on-top, `visibleOnAllWorkspaces: true`, `skipTaskbar: true`, macOS `LSUIElement: true`, `backgroundThrottling: false`.

**Totoro:** a single inline SVG, `viewBox="0 0 280 340"`, ~238×300 centered. Every shape uses integer coordinates and `shape-rendering="crispEdges"`. Built from rectangle runs (stepped contours) — no `<path>` curves, no filters, no gradients. Palette locked to the 8 specified colors.

Anatomy, top to bottom: two pointed ears (stepped triangles) · rounded gray body with `#566168` shading on the left third and under the arms · two large square eyes with `#171C20` pupils and a 1 px cream catchlight · tiny dark nose · 3 px mouth · three whiskers per side (1 px runs) · cream `#E8E4D4` belly with the characteristic chevron markings in `#D5D0BF` · two small arms · two short feet · `#263238` outline throughout.

**Drag regions:** the body/ears/feet groups get `-webkit-app-region: drag`. The dial, all inputs, buttons and glyphs get `-webkit-app-region: no-drag` explicitly.

**Glyphs:** 9×9 px `⚙` and `×` in the window's top-right, outside the silhouette. Hidden by default; step-fade in over 2 frames on window hover or keyboard focus. Hidden entirely during TIMER and ALARM. `⚙` opens a small native popup menu (`Choose Markdown file…` / `Choose folder…`) then the matching dialog — **required** because Windows cannot present a combined file-or-folder picker; macOS could, but one code path is kept for consistency. `×` quits.

**Typography:** `Menlo, Monaco, "Courier New", monospace`, bold, `letter-spacing: -0.5px`, hard 1 px `#263238` text-shadow, no anti-alias softening. All browser default form styling reset to nothing.

**Tray menu:** Change log destination… · Open log file · Recenter Totoro · Quit.

---

## 3. State machine

Pure reducer in `state/machine.ts` — `(state, event) => state`, no side effects, fully unit-tested.

```
SETUP ──START──▶ TIMER ──ELAPSED──▶ ALARM ──DISMISS──▶ LOG_PROMPT ──LOG|SKIP──▶ SETUP
                   │                                        ▲
                   └──────────── CANCEL (Ctrl+C) ───────────┘
```

`LOG_PROMPT` carries a `logError` flag rather than being its own state, preserving the specified four-state machine.

Entering SETUP: clear task, retain minutes, focus and select the minutes field, reset wedge to 0, restore normal Totoro.

Side effects live in an enter/exit table beside the reducer. Each state's `enter()` returns a `Disposer`; the runner calls the previous disposer before every transition, so intervals, rAF handles, audio nodes and shake timers cannot leak across states.

**Launch routing:** pendingPrompt present → LOG_PROMPT · else active session with `now < end` → TIMER · else active session with `now ≥ end` → LOG_PROMPT `INTERRUPTED` · else SETUP.

---

## 4. Timer engine (`services/timer.ts`, pure)

```ts
elapsedMs(t, now)   = max(0, now - t.startedAt)
remainingMs(t, now) = max(0, t.plannedDurationMs - elapsedMs(t, now))
progress(t, now)    = min(1, elapsedMs(t, now) / t.plannedDurationMs)
wedgeSteps(t, now)  = min(60, floor(progress(t, now) * 60))
overshootMs(t, now) = max(0, now - (t.startedAt + t.plannedDurationMs))
formatMMSS(ms)      = `${floor(ms/60000)}:${pad2(floor(ms/1000) % 60)}`   // up to 180:00
```

Never decremented. Every read recomputes from `Date.now()`, so backgrounding, dropped frames, drags, throttling and sleep are all inherently correct.

**Ticking:** a `setInterval(250 ms)` is the authoritative clock; the rAF loop is animation-only. `backgroundThrottling: false` keeps it running when occluded, and `powerMonitor`'s `resume` event pushes an immediate re-evaluation.

**One unified completion rule**, covering normal expiry, a frozen renderer, and sleep identically: when `remainingMs === 0`, if `overshootMs ≤ 120_000` → ALARM, else → LOG_PROMPT `INTERRUPTED` with `elapsedMs` clamped to `plannedDurationMs`.

---

## 5. Persistence

`userData/state.json`:

```jsonc
{ "version": 1,
  "logDestination": { "type": "file" | "folder", "path": "…" } | null,
  "window": { "x": 0, "y": 0 } | null,
  "session": { "id", "startedAt", "plannedDurationMs", "task", "status": "running" } | null,
  "pendingPrompt": { "id", "startedAt", "endedAt", "plannedDurationMs",
                     "task", "outcome": "completed"|"abandoned"|"interrupted", "elapsedMs" } | null }
```

Written atomically (write `state.json.tmp`, `fsync`, rename), debounced 250 ms, flushed synchronously on `before-quit`. The session record is written **before** the renderer enters TIMER; the pendingPrompt is written the instant ALARM ends or a cancel occurs — so a force-kill at any moment loses at most the current tick.

Every field is re-validated on read. Malformed JSON, wrong version, absurd values (negative `startedAt`, `startedAt` in the future beyond clock skew, duration outside 1–180 min) → the file is renamed to `state.corrupt-<timestamp>.json` and a fresh default state is used. The app never crashes on bad state.

Window bounds are validated against `screen.getAllDisplays()` on restore; an off-screen position (monitor unplugged) is clamped back onto the nearest visible work area.

---

## 6. Logging

Exact formats, produced by `shared/markdown.ts`:

```
- [x] 2026-08-15 14:32 — 25 min planned, 25:00 elapsed — "write spec" — completed
- [ ] 2026-08-15 14:32 — 25 min planned, 08:37 elapsed — "write spec" — abandoned
- [ ] 2026-08-15 14:32 — 25 min planned, 25:00 elapsed — "write spec" — interrupted
- [x] 2026-08-15 14:32 — 25 min planned, 25:00 elapsed — completed          (no task)
```

**Append algorithm:** resolve target file (folder mode → `pomodoro-log.md` inside) → `mkdir -p` the parent → if the file is missing, create it with `# Pomodoro Log\n\n` → read the last 8 KB, find the last `## ` line; if it isn't today's date, append `\n## YYYY-MM-DD\n\n` → append the entry line. Pure append; existing content is never rewritten.

**Sanitization** (`sanitizeTask`): strip all control characters including CR/LF and tabs, collapse whitespace runs, trim, replace `"` with `'` so the quoted segment can't break, then truncate to 24 characters. A task can therefore never inject a newline or a new list item.

**Spool:** on LOG, the payload is appended to `userData/pending-logs.json` *before* the write is attempted, and removed only on success. Pending entries are flushed in order on the next successful write and on every launch. So an entry survives a crash mid-write.

**Security note:** the renderer never supplies a path. It sends only `{ status, plannedMinutes, elapsedMs, task, endedAt }`; the main process resolves the destination from its own persisted state and formats the Markdown itself. There is no IPC path by which the renderer can write to an arbitrary file.

---

## 7. Electron security

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, no remote module. CSP meta: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`. `setWindowOpenHandler` → deny; `will-navigate` → prevented; all permission requests denied.

Preload exposes exactly:

```ts
window.totoro = {
  getInitialState(),                  // destination + session + pendingPrompt
  chooseLogDestination(),             // main opens the menu + dialog; no path from renderer
  openLogFile(),
  appendLog(payload),                 // → { ok: true } | { ok: false, code, message }
  saveSession(session | null),
  savePendingPrompt(prompt | null),
  shakeWindow(),                      // fixed ±7 px / 2000 ms, no parameters
  focusWindow(),
  quit(),
  onResumeFromSleep(cb),
}
```

No `fs`, `path`, `require`, `process`, `child_process`, or generic `ipcRenderer`. Every handler re-validates its payload in main with hand-written type guards (shape, types, ranges, string lengths, enum membership) and rejects anything unexpected — the renderer is treated as untrusted. `shakeWindow` takes no arguments specifically so a compromised renderer cannot drive window position.

---

## 8. Animations

All loops registered with the current state's disposer; nothing survives a transition.

- **Breathing** — body group translates on a stepped 4 s cycle (`0,0,1,1,0` px), never interpolated. Off under reduced-motion.
- **Blink** — eyes swap to a 1 px `#171C20` bar for 90 ms; next blink randomized 4–10 s (9–20 s during TIMER).
- **Wedge** — redrawn only when `wedgeSteps` changes value, so ≤ 60 DOM mutations per session.
- **Alarm flash** — dial fill toggles `#8B9A68` ⇄ `#B4C38A` every 220 ms (≈2.3 flashes/s, inside the WCAG limit). Reduced-motion slows it to 1 Hz.
- **Alarm shake** — main-process only: window offsets ±7 px random X/Y from its base position for 2000 ms, then restores the exact base. Skipped under reduced-motion.
- **Loop budget** — one rAF loop for the whole app, throttled to ~8 fps, cancelled on `visibilitychange`/window hide.

---

## 9. Testing (Vitest)

| File | Covers |
|---|---|
| `timer.spec.ts` | elapsed/remaining/progress/wedge/overshoot with a mocked clock; delayed frames (jump the clock 30 s mid-session); a 3-hour sleep gap; `formatMMSS` at `0:00`, `9:59`, `180:00` |
| `machine.spec.ts` | every legal transition; illegal transitions rejected; no concurrent sessions; SETUP reset semantics; disposer called exactly once per transition |
| `validate.spec.ts` | minutes 1/25/180 valid, 0/181/-1/`NaN`/`"25"`/`1.5` invalid; task truncation at 24; newline, tab and quote stripping; IPC payload guards reject wrong types and out-of-range values |
| `markdown.spec.ts` | completed / abandoned / interrupted / no-task lines byte-exact against the spec; day-heading emission |
| `logger.spec.ts` | append to temp dir: file creation, header, heading only on a new day, never overwrites, folder-mode filename, `EACCES`/`ENOENT` surfaced as codes, spool written before the attempt and cleared after success, flush ordering |
| `persistence.spec.ts` | round-trip; atomic replace; corrupt JSON quarantined; unknown version; out-of-range values rejected; destination persists |
| `recovery.spec.ts` | restart mid-session resumes from the original `startedAt`; restart after the end yields INTERRUPTED clamped; pendingPrompt restored; future `startedAt` discarded |

---

## 10. Packaging

`electron-builder`, appId `com.amey.totoro-pomodoro`, productName `Totoro Pomodoro`.

- **Windows** — NSIS installer + portable `.exe`, `build/icon.ico`. Built and verified on this machine.
- **macOS** — dmg, `arm64` + `x64`, `extendInfo.LSUIElement: true`, category `public.app-category.productivity`.
- **Linux** — AppImage + deb, category `Utility`. Transparency needs a compositor; the window is created after `whenReady` + a short delay with `backgroundColor: '#00000000'`, which is the standard workaround, and the README notes the compositor requirement.

Packaged builds preserve transparency, framelessness, always-on-top, keyboard interaction, the audio alarm, filesystem logging, persistence and recovery. Unsigned — SmartScreen/Gatekeeper warnings on first run are expected and documented.

---

## 11. Edge cases handled

Invalid minutes (clamped 1–180 + jitter) · empty task → `(no label)` in the prompt and the segment omitted in Markdown · log file deleted between sessions (recreated with header) · folder deleted (spool + error state) · permission denied (spool + NEW PATH) · drive unmounted · malformed/corrupt state (quarantined) · clock moved backwards (`elapsed` floored at 0) · `startedAt` in the future (session discarded) · system sleep across the end (grace rule) · quit during TIMER (recovered) · quit during LOG_PROMPT (restored) · second instance (focuses the first) · monitor unplugged (bounds clamped) · WebAudio unavailable or blocked (alarm continues visually, failure logged, never throws) · IPC rejection (renderer surfaces the error state rather than hanging) · alarm dismissed while shake is still running (shake cancelled, base position restored).

---

## Verification

1. `npm test` — full Vitest suite, all green.
2. `npm run dev` — manual pass: 1-minute session end-to-end (start → dial fills in visible steps → alarm flashes/beeps/shakes → Enter → LOG → entry appears in the Markdown file).
3. Ctrl+C mid-session → prompt reads `ABANDONED` with correct elapsed → LOG → `- [ ]` line written.
4. Kill the app mid-session, relaunch → timer resumes at the correct point, not from zero.
5. Kill mid-session, wait past the planned end, relaunch → `INTERRUPTED` prompt.
6. Point the destination at a folder, verify `pomodoro-log.md` is created inside; delete the folder mid-session and confirm the spool + error state, then RETRY to a new path and confirm nothing was lost.
7. Drag Totoro to a corner, quit, relaunch → position restored.
8. `npm run build:win` → launch the packaged exe and re-verify transparency, always-on-top, keyboard, audio and logging.
