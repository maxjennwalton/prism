import { computeTimelinePreview } from '../activityTimelinePreview';

function at(hh: number, mm: number): Date {
  return new Date(2026, 9, 7, hh, mm, 0, 0);
}

describe('computeTimelinePreview', () => {
  it('matches the approved worked example exactly', () => {
    const rows = computeTimelinePreview(at(18, 0), {
      arrivalBufferMinutes: 30,
      travelMinutes: 20,
      prepSteps: [
        { id: 's1', label: 'Get dressed', anchor: 'leave_home', offsetMinutes: 25, isCheckable: true },
      ],
    });

    expect(rows.map((r) => [r.label, r.time.getHours(), r.time.getMinutes()])).toEqual([
      ['Get dressed', 16, 45],
      ['Leave home', 17, 10],
      ['Arrive', 17, 30],
      ['Event starts', 18, 0],
    ]);
  });

  it('marks the three system milestones distinctly from prep steps', () => {
    const rows = computeTimelinePreview(at(18, 0), {
      arrivalBufferMinutes: 30,
      travelMinutes: 20,
      prepSteps: [
        { id: 's1', label: 'Get dressed', anchor: 'leave_home', offsetMinutes: 25, isCheckable: true },
      ],
    });

    const kinds = Object.fromEntries(rows.map((r) => [r.label, r.kind]));
    expect(kinds['Leave home']).toBe('milestone');
    expect(kinds['Arrive']).toBe('milestone');
    expect(kinds['Event starts']).toBe('milestone');
    expect(kinds['Get dressed']).toBe('checkable');
  });

  it('distinguishes checkable actions from informational steps', () => {
    const rows = computeTimelinePreview(at(18, 0), {
      prepSteps: [
        { id: 's1', label: 'Get dressed', anchor: 'event_start', offsetMinutes: 60, isCheckable: true },
        { id: 's2', label: 'Carpool with the Smiths today', anchor: 'event_start', offsetMinutes: 60, isCheckable: false },
      ],
    });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.kind]));
    expect(byId.s1).toBe('checkable');
    expect(byId.s2).toBe('informational');
  });

  it('treats unset arrival buffer / travel time as 0, never an invented number', () => {
    const rows = computeTimelinePreview(at(18, 0), { prepSteps: [] });
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.time]));
    expect(byLabel['Arrive']!.getTime()).toBe(at(18, 0).getTime());
    expect(byLabel['Leave home']!.getTime()).toBe(at(18, 0).getTime());
  });

  it('supports a step anchored to Arrival, not just Leave Home or Event Start', () => {
    const rows = computeTimelinePreview(at(18, 0), {
      arrivalBufferMinutes: 30,
      prepSteps: [
        { id: 's1', label: 'Check in at the desk', anchor: 'arrival', offsetMinutes: 0, isCheckable: true },
      ],
    });
    const step = rows.find((r) => r.id === 's1')!;
    expect(step.time.getHours()).toBe(17);
    expect(step.time.getMinutes()).toBe(30);
  });

  it('always returns all three milestones even with zero prep steps', () => {
    const rows = computeTimelinePreview(at(18, 0), { prepSteps: [] });
    expect(rows.map((r) => r.kind)).toEqual(['milestone', 'milestone', 'milestone']);
  });

  it('sorts a same-time milestone/step tie with milestones in Leave Home -> Arrive -> Event order', () => {
    const rows = computeTimelinePreview(at(18, 0), {
      arrivalBufferMinutes: 0,
      travelMinutes: 0,
      prepSteps: [],
    });
    expect(rows.map((r) => r.label)).toEqual(['Leave home', 'Arrive', 'Event starts']);
  });
});
