import { formatDurationMinutes, formatCountdownLabel } from '../activityWorkflowCountdown';

describe('formatDurationMinutes', () => {
  it('formats under an hour as plain minutes', () => {
    expect(formatDurationMinutes(12 * 60_000)).toBe('12 min');
  });

  it('formats exactly an hour with no leftover minutes', () => {
    expect(formatDurationMinutes(60 * 60_000)).toBe('1h');
  });

  it('formats over an hour with leftover minutes', () => {
    expect(formatDurationMinutes(65 * 60_000)).toBe('1h 5m');
  });

  it('always reports a magnitude, never a sign, for a negative input', () => {
    expect(formatDurationMinutes(-12 * 60_000)).toBe('12 min');
  });

  it('rounds to the nearest minute', () => {
    expect(formatDurationMinutes(89_000)).toBe('1 min'); // 1m 29s rounds down
    expect(formatDurationMinutes(91_000)).toBe('2 min'); // 1m 31s rounds up
  });
});

describe('formatCountdownLabel', () => {
  const now = new Date('2026-10-08T17:00:00.000Z').getTime();

  it('a future target reads "in <duration>"', () => {
    expect(formatCountdownLabel(now + 12 * 60_000, now)).toBe('in 12 min');
  });

  it('a past target reads "<duration> ago"', () => {
    expect(formatCountdownLabel(now - 15 * 60_000, now)).toBe('15 min ago');
  });

  it('exactly now reads "now"', () => {
    expect(formatCountdownLabel(now, now)).toBe('now');
  });

  it('within 30 seconds of now (either direction) reads "now", not "in 0 min"', () => {
    expect(formatCountdownLabel(now + 20_000, now)).toBe('now');
    expect(formatCountdownLabel(now - 20_000, now)).toBe('now');
  });
});
