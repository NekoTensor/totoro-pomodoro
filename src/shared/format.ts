// Time and number formatting shared by the timer display and the Markdown
// logger, so the numbers you see on Totoro's belly and the numbers written to
// your log can never disagree.

export function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * Renders a duration as MM:SS with at least two minute digits. Minutes are not
 * capped at 99, so the longest allowed session reads exactly `180:00`.
 */
export function formatMMSS(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${pad2(minutes)}:${pad2(seconds)}`;
}

/** Local calendar date as YYYY-MM-DD (never UTC — the log follows your day). */
export function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Local wall-clock time as HH:mm, 24-hour. */
export function formatLocalTime(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}
