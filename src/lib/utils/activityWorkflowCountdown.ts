/**
 * Pure, presentation-only duration/countdown text for the Activity Workflow
 * widget. Minute-granularity by design — the widget's local tick runs every
 * 15s (see useActivityWorkflow), well under a minute, so there's no benefit
 * to showing seconds and it would just make the display busier.
 */

/** "12 min" / "1h" / "1h 5m" — always the magnitude, never signed. */
export function formatDurationMinutes(ms: number): string {
  const totalMinutes = Math.round(Math.abs(ms) / 60_000);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/**
 * "in 12 min" / "15 min ago" / "now" — `targetMs` relative to `nowMs`.
 * Rounds to the nearest minute before deciding the branch, so anything
 * within 30 seconds of the target reads as "now" rather than "in 0 min".
 */
export function formatCountdownLabel(targetMs: number, nowMs: number): string {
  const deltaMs = targetMs - nowMs;
  const totalMinutes = Math.round(Math.abs(deltaMs) / 60_000);
  if (totalMinutes === 0) return 'now';
  const duration = formatDurationMinutes(deltaMs);
  return deltaMs > 0 ? `in ${duration}` : `${duration} ago`;
}
