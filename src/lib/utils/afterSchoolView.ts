/**
 * Shared constants/helpers for the dashboard Calendar widget's "After School"
 * view: a Day-view variant with a fixed 3–10 PM window and a fixed household
 * column set (Family, Theo, Beckham, Max, Jenn). Extracted from CalendarWidget
 * so the pure logic (hour-range expansion, group filtering/ordering) is
 * testable without rendering the widget.
 */

export interface HourRange {
  start: number;
  end: number;
}

/** Fixed 3:00 PM–10:00 PM window (hour-of-day, 24h, end exclusive). */
export const AFTER_SCHOOL_HOUR_RANGE: HourRange = { start: 15, end: 22 };

/**
 * Fixed column set and order, by calendar-group name — a household-specific
 * customization (not a generic feature), so these are literal names rather
 * than derived from settings.
 */
export const AFTER_SCHOOL_GROUP_NAMES = ['Family', 'Theo', 'Beckham', 'Max', 'Jenn'] as const;

/** Expands a [start, end) hour range into an array of hour-of-day numbers. */
export function expandHourRange(range: HourRange): number[] {
  return Array.from({ length: range.end - range.start }, (_, i) => range.start + i);
}

/**
 * Filters and sorts calendar groups down to the fixed After School column
 * set, in AFTER_SCHOOL_GROUP_NAMES order. A group not present — not yet
 * created, renamed, or a removed custom group like "Boys" — is simply
 * skipped rather than erroring.
 */
export function orderAfterSchoolGroups<T extends { name: string }>(groups: T[]): T[] {
  const order = new Map<string, number>(
    AFTER_SCHOOL_GROUP_NAMES.map((name, i) => [name, i]),
  );
  return groups
    .filter((g) => order.has(g.name))
    .sort((a, b) => order.get(a.name)! - order.get(b.name)!);
}
