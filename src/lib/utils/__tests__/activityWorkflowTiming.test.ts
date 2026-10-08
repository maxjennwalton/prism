import {
  resolveEffectiveMinutes,
  resolveEffectiveLocation,
  resolveEffectiveTiming,
  computeActivityTimeline,
} from '../activityWorkflowTiming';
import { computeTimelinePreview } from '../activityTimelinePreview';

function at(hh: number, mm: number): Date {
  return new Date(2026, 9, 7, hh, mm, 0, 0);
}

describe('resolveEffectiveMinutes — occurrence override wins, profile default is the fallback', () => {
  it('uses the override when set, even to 0 (never confused with "unset")', () => {
    expect(resolveEffectiveMinutes(0, 30)).toBe(0);
  });

  it('falls back to the profile default when the override is null', () => {
    expect(resolveEffectiveMinutes(null, 30)).toBe(30);
  });

  it('falls back to the profile default when the override is undefined', () => {
    expect(resolveEffectiveMinutes(undefined, 15)).toBe(15);
  });

  it('a profile default of 0 is preserved, not treated as unset', () => {
    expect(resolveEffectiveMinutes(null, 0)).toBe(0);
  });

  it('returns null when neither override nor profile default is configured', () => {
    expect(resolveEffectiveMinutes(null, null)).toBeNull();
    expect(resolveEffectiveMinutes(undefined, undefined)).toBeNull();
  });
});

describe('resolveEffectiveLocation — override -> event location -> profile default -> null', () => {
  it('prefers the occurrence override over everything else', () => {
    expect(resolveEffectiveLocation('Rink B', 'Rink A', 'Default Rink')).toBe('Rink B');
  });

  it('falls back to the calendar event location when there is no override', () => {
    expect(resolveEffectiveLocation(null, 'Rink A', 'Default Rink')).toBe('Rink A');
  });

  it('falls back to the profile default when neither override nor event location is set', () => {
    expect(resolveEffectiveLocation(null, null, 'Default Rink')).toBe('Default Rink');
  });

  it('returns null rather than inventing a location when all three are empty', () => {
    expect(resolveEffectiveLocation(null, null, null)).toBeNull();
    expect(resolveEffectiveLocation(undefined, undefined, undefined)).toBeNull();
  });

  it('treats a blank/whitespace-only string the same as unset at every precedence level', () => {
    expect(resolveEffectiveLocation('   ', 'Rink A', 'Default Rink')).toBe('Rink A');
    expect(resolveEffectiveLocation(null, '  ', 'Default Rink')).toBe('Default Rink');
    expect(resolveEffectiveLocation(null, null, '   ')).toBeNull();
  });
});

describe('resolveEffectiveTiming — combines both fields in one call', () => {
  it('resolves arrival and travel independently', () => {
    const result = resolveEffectiveTiming(
      { arrivalBufferMinutesOverride: null, travelMinutesOverride: 0 },
      { arrivalBufferMinutes: 30, travelMinutes: 20 },
    );
    expect(result).toEqual({ arrivalBufferMinutes: 30, travelMinutes: 0 });
  });
});

describe('computeActivityTimeline — delegates to computeTimelinePreview, never re-derives it', () => {
  it('produces the exact same result as calling computeTimelinePreview directly with the resolved values', () => {
    const prepSteps = [{ id: 's1', label: 'Get dressed', anchor: 'leave_home' as const, offsetMinutes: 25, isCheckable: true }];
    const effective = { arrivalBufferMinutes: 30, travelMinutes: 20 };

    const viaWrapper = computeActivityTimeline(at(18, 0), effective, prepSteps);
    const direct = computeTimelinePreview(at(18, 0), { ...effective, prepSteps });

    expect(viaWrapper).toEqual(direct);
  });

  it('propagates null timing straight through (unscheduled Arrive/Leave Home), matching the editor preview exactly', () => {
    const { scheduled, unscheduled } = computeActivityTimeline(
      at(18, 0),
      { arrivalBufferMinutes: null, travelMinutes: null },
      [],
    );
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.label).toBe('Event starts');
    expect(unscheduled.map((r) => r.label).sort()).toEqual(['Arrive', 'Leave home']);
  });
});
