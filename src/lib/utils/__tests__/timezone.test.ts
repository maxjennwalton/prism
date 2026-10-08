import { zonedParts, isValidTimezone, zonedTimeToUtc, todayBoundsInZone } from '../timezone';

describe('zonedParts', () => {
  it('converts an absolute instant into the household zone (the meal-time bug)', () => {
    // Tandoor stored 6pm Central as 23:00 UTC (via a -04:00 Eastern offset).
    const { date, time } = zonedParts('2026-07-25T19:00:00-04:00', 'America/Chicago');
    expect(time).toBe('18:00'); // 6pm Central, not 7pm Eastern / 11pm UTC
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(6); // July (0-indexed)
    expect(date.getDate()).toBe(25);
  });

  it('same instant lands on the previous day in an earlier zone (day bucketing)', () => {
    // 00:30 UTC on the 26th is still 7:30pm on the 25th in Chicago.
    const { date, time } = zonedParts('2026-07-26T00:30:00Z', 'America/Chicago');
    expect(date.getDate()).toBe(25);
    expect(time).toBe('19:30');
  });

  it('UTC passthrough', () => {
    const { time } = zonedParts('2026-07-25T23:00:00Z', 'UTC');
    expect(time).toBe('23:00');
  });

  it('falls back to the authored wall-clock for an invalid zone', () => {
    const { time } = zonedParts('2026-07-25T18:00:00-05:00', 'Not/AZone');
    expect(time).toBe('18:00');
  });
});

describe('isValidTimezone', () => {
  it('accepts real zones and rejects junk', () => {
    expect(isValidTimezone('America/Chicago')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Not/AZone')).toBe(false);
  });
});

describe('zonedTimeToUtc — the reverse of zonedParts', () => {
  it('round-trips with zonedParts for a plain zone/instant', () => {
    const utc = zonedTimeToUtc('2026-07-25T18:00:00', 'America/Chicago');
    const { time } = zonedParts(utc, 'America/Chicago');
    expect(time).toBe('18:00');
  });

  it('UTC passthrough', () => {
    const utc = zonedTimeToUtc('2026-07-25T23:00:00', 'UTC');
    expect(utc.toISOString()).toBe('2026-07-25T23:00:00.000Z');
  });
});

describe('todayBoundsInZone — local midnight through (exclusive) local midnight the next day', () => {
  it('returns the correct UTC instants for a zone behind UTC (America/Chicago, -05:00 in July)', () => {
    // 2026-07-25 15:00 UTC is 10:00 local in Chicago — still "today" there.
    const { start, end } = todayBoundsInZone(new Date('2026-07-25T15:00:00Z'), 'America/Chicago');
    expect(start.toISOString()).toBe('2026-07-25T05:00:00.000Z'); // local midnight the 25th
    expect(end.toISOString()).toBe('2026-07-26T05:00:00.000Z'); // local midnight the 26th
  });

  it('returns the correct UTC instants for a zone ahead of UTC (Asia/Tokyo, +09:00)', () => {
    // 2026-07-25 01:00 UTC is already 10:00 local on the 25th in Tokyo.
    const { start, end } = todayBoundsInZone(new Date('2026-07-25T01:00:00Z'), 'Asia/Tokyo');
    expect(start.toISOString()).toBe('2026-07-24T15:00:00.000Z'); // local midnight the 25th, in UTC
    expect(end.toISOString()).toBe('2026-07-25T15:00:00.000Z'); // local midnight the 26th, in UTC
  });

  it('lands on the previous UTC day near midnight in an earlier zone (the day-bucketing edge case)', () => {
    // 00:30 UTC on the 26th is still 19:30 on the 25th in Chicago — "today" must be the 25th.
    const { start, end } = todayBoundsInZone(new Date('2026-07-26T00:30:00Z'), 'America/Chicago');
    expect(start.toISOString()).toBe('2026-07-25T05:00:00.000Z');
    expect(end.toISOString()).toBe('2026-07-26T05:00:00.000Z');
  });

  it('produces a 23-hour window across a spring-forward DST transition', () => {
    // America/Chicago springs forward on 2026-03-08 (2am -> 3am CST->CDT).
    const { start, end } = todayBoundsInZone(new Date('2026-03-08T12:00:00Z'), 'America/Chicago');
    expect(end.getTime() - start.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it('produces a 25-hour window across a fall-back DST transition', () => {
    // America/Chicago falls back on 2026-11-01.
    const { start, end } = todayBoundsInZone(new Date('2026-11-01T12:00:00Z'), 'America/Chicago');
    expect(end.getTime() - start.getTime()).toBe(25 * 60 * 60 * 1000);
  });
});
