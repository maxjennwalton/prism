/**
 * Timezone helpers usable on both the server and client (no DOM / no DB deps).
 *
 * Prism historically rendered all times in the browser's local zone. Server-side
 * code (sync, crons) has no browser, so it anchors to the household `timezone`
 * setting via these helpers.
 */

/**
 * Convert an absolute instant (ISO string or Date) into the wall-clock date +
 * time in a given IANA timezone, using the built-in Intl database (no libs).
 * Returns a date-only Date (local midnight, for day/week bucketing) and an
 * "HH:mm" string. Falls back to a naive parse if the zone is invalid.
 */
export function zonedParts(input: string | Date, timeZone: string): { date: Date; time: string } {
  const d = input instanceof Date ? input : new Date(input);
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(d)) parts[p.type] = p.value;
    const year = Number(parts.year);
    const month = Number(parts.month);
    const day = Number(parts.day);
    const hour = parts.hour === '24' ? '00' : parts.hour;
    if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
      return { date: new Date(year, month - 1, day), time: `${hour}:${parts.minute}` };
    }
  } catch {
    /* invalid timeZone → fall through */
  }
  // Fallback: pull the authored wall-clock straight from an ISO string.
  const s = typeof input === 'string' ? input : d.toISOString();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (m) {
    const [, y, mo, da, hh, mm] = m;
    return { date: new Date(Number(y), Number(mo) - 1, Number(da)), time: `${hh}:${mm}` };
  }
  return { date: d, time: '00:00' };
}

/**
 * Convert a "wall-clock" ISO string ("2026-05-19T05:42", no offset) interpreted
 * in the given IANA timezone into a UTC `Date`. Originally written for
 * Open-Meteo's `timezone=auto` responses (sunrise/sunset/hourly.time come back
 * in this shape) and promoted here so any other caller needing the reverse of
 * `zonedParts` — a household wall-clock time back to a real UTC instant —
 * reuses the same DST-aware arithmetic instead of re-deriving it.
 *
 * Approach: format the localIso (treated as UTC) in the target zone to read
 * back its longOffset like "GMT-05:00", then subtract that offset from the
 * UTC interpretation. DST transitions are handled implicitly because the
 * offset is recomputed against the actual date.
 */
export function zonedTimeToUtc(localIso: string, timeZone: string): Date {
  // Treat the wall-clock as UTC for the moment — wrong by the timezone offset.
  const asUtc = new Date(`${localIso}Z`);
  // Ask Intl what UTC offset the target zone has at that moment.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
    hour12: false,
  }).formatToParts(asUtc);
  const offsetName = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  // "GMT-05:00" → ±HH:MM
  const m = /([+-])(\d{2}):?(\d{2})/.exec(offsetName);
  if (!m) return asUtc;
  const sign = m[1] === '+' ? 1 : -1;
  const offsetMinutes = sign * (parseInt(m[2]!, 10) * 60 + parseInt(m[3]!, 10));
  // Subtract the offset to get the real UTC instant for that wall-clock time.
  return new Date(asUtc.getTime() - offsetMinutes * 60_000);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * The [start, end) UTC instants for "today" as a wall clock in `timeZone` —
 * local midnight through (exclusive) local midnight the next day. Used by
 * the Activity Workflow widget (Phase 4A) to scope "today's matched
 * activities" to the household's configured zone rather than the server
 * process's own (which runs as UTC in our containers and would silently
 * shift the boundary by hours for every non-UTC household).
 */
export function todayBoundsInZone(now: Date, timeZone: string): { start: Date; end: Date } {
  const { date } = zonedParts(now, timeZone);
  const y = date.getFullYear();
  const mo = date.getMonth(); // 0-indexed
  const d = date.getDate();
  const start = zonedTimeToUtc(`${y}-${pad2(mo + 1)}-${pad2(d)}T00:00:00`, timeZone);
  // Add a day to the LOCAL date components (not to the UTC instant) before
  // re-converting, so a DST transition inside the day changes the elapsed
  // real time between start/end rather than silently shifting which local
  // day "end" lands on.
  const nextDay = new Date(y, mo, d + 1);
  const end = zonedTimeToUtc(
    `${nextDay.getFullYear()}-${pad2(nextDay.getMonth() + 1)}-${pad2(nextDay.getDate())}T00:00:00`,
    timeZone,
  );
  return { start, end };
}

/** Whether a string is a valid IANA timezone the runtime understands. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The full IANA zone list when the runtime supports it (Node 18+/modern
 * browsers), else a curated common set. Used to populate the settings dropdown.
 */
export function listTimezones(): string[] {
  const sof = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  if (typeof sof === 'function') {
    try {
      return sof('timeZone');
    } catch {
      /* fall through */
    }
  }
  return COMMON_TIMEZONES;
}

export const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
];
