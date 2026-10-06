import { computeTimelinePreview } from '../activityTimelinePreview';

function at(hh: number, mm: number): Date {
  return new Date(2026, 9, 7, hh, mm, 0, 0);
}

describe('computeTimelinePreview', () => {
  it('matches the approved worked example exactly', () => {
    const { scheduled, unscheduled } = computeTimelinePreview(at(18, 0), {
      arrivalBufferMinutes: 30,
      travelMinutes: 20,
      prepSteps: [
        { id: 's1', label: 'Get dressed', anchor: 'leave_home', offsetMinutes: 25, isCheckable: true },
      ],
    });

    expect(unscheduled).toEqual([]);
    expect(scheduled.map((r) => [r.label, r.time.getHours(), r.time.getMinutes()])).toEqual([
      ['Get dressed', 16, 45],
      ['Leave home', 17, 10],
      ['Arrive', 17, 30],
      ['Event starts', 18, 0],
    ]);
  });

  it('marks the three system milestones distinctly from prep steps', () => {
    const { scheduled } = computeTimelinePreview(at(18, 0), {
      arrivalBufferMinutes: 30,
      travelMinutes: 20,
      prepSteps: [
        { id: 's1', label: 'Get dressed', anchor: 'leave_home', offsetMinutes: 25, isCheckable: true },
      ],
    });

    const kinds = Object.fromEntries(scheduled.map((r) => [r.label, r.kind]));
    expect(kinds['Leave home']).toBe('milestone');
    expect(kinds['Arrive']).toBe('milestone');
    expect(kinds['Event starts']).toBe('milestone');
    expect(kinds['Get dressed']).toBe('checkable');
  });

  it('distinguishes checkable actions from informational steps', () => {
    const { scheduled } = computeTimelinePreview(at(18, 0), {
      arrivalBufferMinutes: 0,
      prepSteps: [
        { id: 's1', label: 'Get dressed', anchor: 'event_start', offsetMinutes: 60, isCheckable: true },
        { id: 's2', label: 'Carpool with the Smiths today', anchor: 'event_start', offsetMinutes: 60, isCheckable: false },
      ],
    });
    const byId = Object.fromEntries(scheduled.map((r) => [r.id, r.kind]));
    expect(byId.s1).toBe('checkable');
    expect(byId.s2).toBe('informational');
  });

  describe('blank vs. explicit-zero timing (NULL must never read as 0)', () => {
    it('with no arrival buffer or travel time configured: only Event Start is scheduled; Arrive and Leave Home are unscheduled, not shown at event time', () => {
      const { scheduled, unscheduled } = computeTimelinePreview(at(18, 0), { prepSteps: [] });

      expect(scheduled).toHaveLength(1);
      expect(scheduled[0]!.label).toBe('Event starts');
      expect(scheduled[0]!.time.getTime()).toBe(at(18, 0).getTime());

      const reasons = Object.fromEntries(unscheduled.map((r) => [r.label, r.reason]));
      expect(Object.keys(reasons)).toEqual(expect.arrayContaining(['Arrive', 'Leave home']));
      expect(reasons['Arrive']).toMatch(/arrival buffer/i);
      expect(reasons['Leave home']).toMatch(/arrival buffer/i); // leave home is blocked transitively by the missing arrival buffer
    });

    it('an explicit 0-minute arrival buffer IS a real, calculated Arrival — not treated as unconfigured', () => {
      const { scheduled, unscheduled } = computeTimelinePreview(at(18, 0), {
        arrivalBufferMinutes: 0,
        prepSteps: [],
      });

      const arrive = scheduled.find((r) => r.label === 'Arrive');
      expect(arrive).toBeDefined();
      expect(arrive!.time.getTime()).toBe(at(18, 0).getTime());
      expect(unscheduled.some((r) => r.label === 'Arrive')).toBe(false);
    });

    it('arrival configured but travel time still blank: Arrive is scheduled, Leave Home is unscheduled (needs travel time specifically)', () => {
      const { scheduled, unscheduled } = computeTimelinePreview(at(18, 0), {
        arrivalBufferMinutes: 30,
        prepSteps: [],
      });

      expect(scheduled.some((r) => r.label === 'Arrive')).toBe(true);
      expect(scheduled.some((r) => r.label === 'Leave home')).toBe(false);
      const leaveHomeRow = unscheduled.find((r) => r.label === 'Leave home');
      expect(leaveHomeRow?.reason).toMatch(/travel time/i);
    });

    it('explicit 0-minute travel time with a configured arrival buffer: Leave Home IS calculated (coincides with Arrival)', () => {
      const { scheduled, unscheduled } = computeTimelinePreview(at(18, 0), {
        arrivalBufferMinutes: 30,
        travelMinutes: 0,
        prepSteps: [],
      });

      const leaveHome = scheduled.find((r) => r.label === 'Leave home');
      const arrive = scheduled.find((r) => r.label === 'Arrive');
      expect(leaveHome).toBeDefined();
      expect(leaveHome!.time.getTime()).toBe(arrive!.time.getTime());
      expect(unscheduled).toEqual([]);
    });

    it('a prep step anchored to an unresolved milestone is unscheduled, not shown at a misleading time', () => {
      const { scheduled, unscheduled } = computeTimelinePreview(at(18, 0), {
        prepSteps: [
          { id: 's1', label: 'Get dressed', anchor: 'leave_home', offsetMinutes: 25, isCheckable: true },
        ],
      });

      expect(scheduled.some((r) => r.id === 's1')).toBe(false);
      const step = unscheduled.find((r) => r.id === 's1');
      expect(step).toBeDefined();
      expect(step!.reason).toMatch(/leave home/i);
    });

    it('a prep step anchored to Event Start is always schedulable, even with no other timing configured', () => {
      const { scheduled, unscheduled } = computeTimelinePreview(at(18, 0), {
        prepSteps: [
          { id: 's1', label: 'Pack bag', anchor: 'event_start', offsetMinutes: 60, isCheckable: true },
        ],
      });
      expect(unscheduled.some((r) => r.id === 's1')).toBe(false);
      const step = scheduled.find((r) => r.id === 's1');
      expect(step!.time.getHours()).toBe(17);
      expect(step!.time.getMinutes()).toBe(0);
    });
  });

  it('supports a step anchored to Arrival, not just Leave Home or Event Start', () => {
    const { scheduled } = computeTimelinePreview(at(18, 0), {
      arrivalBufferMinutes: 30,
      prepSteps: [
        { id: 's1', label: 'Check in at the desk', anchor: 'arrival', offsetMinutes: 0, isCheckable: true },
      ],
    });
    const step = scheduled.find((r) => r.id === 's1')!;
    expect(step.time.getHours()).toBe(17);
    expect(step.time.getMinutes()).toBe(30);
  });

  it('sorts a same-time milestone tie with milestones in Leave Home -> Arrive -> Event order', () => {
    const { scheduled, unscheduled } = computeTimelinePreview(at(18, 0), {
      arrivalBufferMinutes: 0,
      travelMinutes: 0,
      prepSteps: [],
    });
    expect(unscheduled).toEqual([]);
    expect(scheduled.map((r) => r.label)).toEqual(['Leave home', 'Arrive', 'Event starts']);
  });
});
