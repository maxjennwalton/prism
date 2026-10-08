/**
 * @jest-environment node
 *
 * Only the DB layer (db.select) is mocked. The pure helpers this service
 * calls — resolveEffectiveTiming/resolveEffectiveLocation/
 * computeActivityTimeline (activityWorkflowTiming.ts) and
 * computeActivityStatus (activityWorkflowPriority.ts) — run for real, so
 * these tests exercise the actual integration between the query shape and
 * the timeline/priority arithmetic, not a stubbed stand-in for it.
 */
const mockSelect = jest.fn();

jest.mock('@/lib/db/client', () => ({
  db: { select: (...a: unknown[]) => mockSelect(...a) },
}));

jest.mock('@/lib/db/schema', () => ({
  activityEventLinks: {
    id: 'activityEventLinks.id',
    eventId: 'activityEventLinks.eventId',
    matchStatus: 'activityEventLinks.matchStatus',
    activityProfileId: 'activityEventLinks.activityProfileId',
    assignedMemberId: 'activityEventLinks.assignedMemberId',
    arrivalBufferMinutesOverride: 'activityEventLinks.arrivalBufferMinutesOverride',
    travelMinutesOverride: 'activityEventLinks.travelMinutesOverride',
    locationOverride: 'activityEventLinks.locationOverride',
  },
  events: {
    id: 'events.id', title: 'events.title', location: 'events.location',
    startTime: 'events.startTime', endTime: 'events.endTime',
  },
  activityProfiles: {
    id: 'activityProfiles.id', name: 'activityProfiles.name', color: 'activityProfiles.color',
    archived: 'activityProfiles.archived', arrivalBufferMinutes: 'activityProfiles.arrivalBufferMinutes',
    travelMinutes: 'activityProfiles.travelMinutes', defaultLocation: 'activityProfiles.defaultLocation',
  },
  activityProfilePrepSteps: {
    id: 'activityProfilePrepSteps.id', activityProfileId: 'activityProfilePrepSteps.activityProfileId',
    label: 'activityProfilePrepSteps.label', anchor: 'activityProfilePrepSteps.anchor',
    offsetMinutes: 'activityProfilePrepSteps.offsetMinutes', isCheckable: 'activityProfilePrepSteps.isCheckable',
    sortOrder: 'activityProfilePrepSteps.sortOrder',
  },
  users: { id: 'users.id', name: 'users.name', color: 'users.color' },
  settings: { key: 'settings.key', value: 'settings.value' },
}));

jest.mock('drizzle-orm', () => ({
  eq: (...a: unknown[]) => ({ op: 'eq', a }),
  and: (...a: unknown[]) => ({ op: 'and', a }),
  gte: (...a: unknown[]) => ({ op: 'gte', a }),
  lt: (...a: unknown[]) => ({ op: 'lt', a }),
  inArray: (...a: unknown[]) => ({ op: 'inArray', a }),
  asc: (col: unknown) => ({ op: 'asc', col }),
}));

import { listTodayActivityWorkflow } from '../activityWorkflow';

function mockTimezoneSelect(timezoneValue: string | null) {
  mockSelect.mockReturnValueOnce({
    from: () => ({ where: () => (timezoneValue !== null ? [{ value: timezoneValue }] : []) }),
  });
}

function mockMainQuery(rows: unknown[]) {
  mockSelect.mockReturnValueOnce({
    from: () => ({
      innerJoin: () => ({
        leftJoin: () => ({
          leftJoin: () => ({
            where: () => ({ orderBy: () => rows }),
          }),
        }),
      }),
    }),
  });
}

function mockPrepStepsQuery(rows: unknown[]) {
  mockSelect.mockReturnValueOnce({
    from: () => ({ where: () => ({ orderBy: () => rows }) }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

function baseRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    linkId: 'link-1',
    arrivalBufferMinutesOverride: null,
    travelMinutesOverride: null,
    locationOverride: null,
    assignedMemberId: 'member-beckham',
    activityProfileId: 'profile-hockey',
    eventId: 'event-1',
    eventTitle: 'U9MD - Hockey Practice',
    eventLocation: null,
    eventStart: new Date('2026-10-08T18:00:00.000Z'),
    eventEnd: new Date('2026-10-08T19:00:00.000Z'),
    memberName: 'Beckham',
    memberColor: '#f00',
    profileName: 'Hockey Practice',
    profileColor: '#00f',
    profileArchived: false,
    profileArrivalBufferMinutes: 30,
    profileTravelMinutes: 20,
    profileDefaultLocation: 'Community Rink',
    ...overrides,
  };
}

describe('listTodayActivityWorkflow — basic shape', () => {
  it('returns an empty array without querying prep steps when there are no settled links today', async () => {
    mockTimezoneSelect('UTC');
    mockMainQuery([]);

    const result = await listTodayActivityWorkflow(new Date('2026-10-08T12:00:00.000Z'));

    expect(result).toEqual([]);
    expect(mockSelect).toHaveBeenCalledTimes(2); // timezone + main query only
  });

  it('defaults to UTC when the timezone setting is unset', async () => {
    mockTimezoneSelect(null);
    mockMainQuery([]);

    await listTodayActivityWorkflow(new Date('2026-10-08T12:00:00.000Z'));
    // No crash, no third call attempted — covered by not throwing.
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });

  it('maps a fully-populated row end to end, including computed timeline and status', async () => {
    mockTimezoneSelect('UTC');
    mockMainQuery([baseRow()]);
    mockPrepStepsQuery([
      { id: 'step-1', activityProfileId: 'profile-hockey', label: 'Get dressed', anchor: 'leave_home', offsetMinutes: 25, isCheckable: true },
    ]);

    const [item] = await listTodayActivityWorkflow(new Date('2026-10-08T16:00:00.000Z'));

    expect(item).toMatchObject({
      linkId: 'link-1',
      eventId: 'event-1',
      eventTitle: 'U9MD - Hockey Practice',
      memberId: 'member-beckham',
      memberName: 'Beckham',
      profileId: 'profile-hockey',
      profileName: 'Hockey Practice',
      profileArchived: false,
      location: 'Community Rink', // no override/event location -> profile default
    });
    // Arrival = 17:30, Leave Home = 17:10 (30 min buffer, 20 min travel).
    expect(item!.arrivalTime?.toISOString()).toBe('2026-10-08T17:30:00.000Z');
    expect(item!.leaveHomeTime?.toISOString()).toBe('2026-10-08T17:10:00.000Z');
    expect(item!.prepSteps).toEqual([
      { id: 'step-1', label: 'Get dressed', kind: 'checkable', time: new Date('2026-10-08T16:45:00.000Z'), unscheduledReason: null },
    ]);
    // now = 16:00, so the next actionable milestone is the prep step at 16:45.
    expect(item!.status.phase).toBe('upcoming');
    expect(item!.status.nextMilestone?.label).toBe('Get dressed');
  });

  it('skips the prep-steps query entirely when no row has a profile id', async () => {
    mockTimezoneSelect('UTC');
    mockMainQuery([baseRow({ activityProfileId: null, profileName: null, profileColor: null, profileArchived: null, profileArrivalBufferMinutes: null, profileTravelMinutes: null, profileDefaultLocation: null })]);

    const [item] = await listTodayActivityWorkflow(new Date('2026-10-08T16:00:00.000Z'));

    expect(mockSelect).toHaveBeenCalledTimes(2); // no third (prep-steps) call
    expect(item!.profileId).toBeNull();
    expect(item!.prepSteps).toEqual([]);
    // No arrival buffer/travel configured anywhere -> only Event Starts is scheduled.
    expect(item!.arrivalTime).toBeNull();
    expect(item!.leaveHomeTime).toBeNull();
  });
});

describe('listTodayActivityWorkflow — location precedence (override -> event -> profile default -> null)', () => {
  it('prefers the occurrence locationOverride over everything else', async () => {
    mockTimezoneSelect('UTC');
    mockMainQuery([baseRow({ locationOverride: 'Rink B', eventLocation: 'Rink A' })]);
    mockPrepStepsQuery([]);
    const [item] = await listTodayActivityWorkflow(new Date('2026-10-08T16:00:00.000Z'));
    expect(item!.location).toBe('Rink B');
  });

  it('falls back to the calendar event location when there is no override', async () => {
    mockTimezoneSelect('UTC');
    mockMainQuery([baseRow({ locationOverride: null, eventLocation: 'Rink A' })]);
    mockPrepStepsQuery([]);
    const [item] = await listTodayActivityWorkflow(new Date('2026-10-08T16:00:00.000Z'));
    expect(item!.location).toBe('Rink A');
  });

  it('never invents a location when override, event location, and profile default are all empty', async () => {
    mockTimezoneSelect('UTC');
    mockMainQuery([baseRow({ locationOverride: null, eventLocation: null, profileDefaultLocation: null })]);
    mockPrepStepsQuery([]);
    const [item] = await listTodayActivityWorkflow(new Date('2026-10-08T16:00:00.000Z'));
    expect(item!.location).toBeNull();
  });
});

describe('listTodayActivityWorkflow — effective timing overrides', () => {
  it('occurrence overrides win over the profile defaults, including an explicit 0', async () => {
    mockTimezoneSelect('UTC');
    mockMainQuery([baseRow({ arrivalBufferMinutesOverride: 0, travelMinutesOverride: 5, profileArrivalBufferMinutes: 30, profileTravelMinutes: 20 })]);
    mockPrepStepsQuery([]);
    const [item] = await listTodayActivityWorkflow(new Date('2026-10-08T16:00:00.000Z'));
    // Arrival = event start - 0 = 18:00; Leave Home = 18:00 - 5 = 17:55.
    expect(item!.arrivalTime?.toISOString()).toBe('2026-10-08T18:00:00.000Z');
    expect(item!.leaveHomeTime?.toISOString()).toBe('2026-10-08T17:55:00.000Z');
  });
});

describe('listTodayActivityWorkflow — archived profile and unassigned member stay displayable', () => {
  it('still returns full profile/timeline data when the matched profile has since been archived', async () => {
    mockTimezoneSelect('UTC');
    mockMainQuery([baseRow({ profileArchived: true })]);
    mockPrepStepsQuery([]);
    const [item] = await listTodayActivityWorkflow(new Date('2026-10-08T16:00:00.000Z'));
    expect(item!.profileArchived).toBe(true);
    expect(item!.profileName).toBe('Hockey Practice');
    expect(item!.arrivalTime).not.toBeNull();
  });

  it('handles a settled link with no assigned member (member fields all null, no crash)', async () => {
    mockTimezoneSelect('UTC');
    mockMainQuery([baseRow({ assignedMemberId: null, memberName: null, memberColor: null })]);
    mockPrepStepsQuery([]);
    const [item] = await listTodayActivityWorkflow(new Date('2026-10-08T16:00:00.000Z'));
    expect(item!.memberId).toBeNull();
    expect(item!.memberName).toBeNull();
  });
});

describe('listTodayActivityWorkflow — phases', () => {
  it('reports overdue when a pre-event deadline passed but the event has not started', async () => {
    mockTimezoneSelect('UTC');
    mockMainQuery([baseRow()]); // arrival 17:30, leave-home 17:10, event 18:00
    mockPrepStepsQuery([]);
    const [item] = await listTodayActivityWorkflow(new Date('2026-10-08T17:45:00.000Z'));
    expect(item!.status.phase).toBe('overdue');
    expect(item!.status.overdueMilestones.map((m) => m.label)).toEqual(['Leave home', 'Arrive']);
    expect(item!.status.nextMilestone?.label).toBe('Event starts');
  });

  it('reports overdue for a missed early deadline while a later one is still reachable, surfacing both', async () => {
    mockTimezoneSelect('UTC');
    mockMainQuery([baseRow()]); // arrival 17:30, leave-home 17:10, event 18:00
    mockPrepStepsQuery([]);
    const [item] = await listTodayActivityWorkflow(new Date('2026-10-08T17:20:00.000Z')); // leave-home passed, arrival has not
    expect(item!.status.phase).toBe('overdue');
    expect(item!.status.overdueMilestones.map((m) => m.label)).toEqual(['Leave home']);
    expect(item!.status.nextMilestone?.label).toBe('Arrive');
  });

  it('reports in_progress once the event has started and has not ended', async () => {
    mockTimezoneSelect('UTC');
    mockMainQuery([baseRow()]);
    mockPrepStepsQuery([]);
    const [item] = await listTodayActivityWorkflow(new Date('2026-10-08T18:30:00.000Z'));
    expect(item!.status.phase).toBe('in_progress');
  });

  it('reports completed once the real event end time has passed', async () => {
    mockTimezoneSelect('UTC');
    mockMainQuery([baseRow()]);
    mockPrepStepsQuery([]);
    const [item] = await listTodayActivityWorkflow(new Date('2026-10-08T19:30:00.000Z'));
    expect(item!.status.phase).toBe('completed');
  });
});

describe('listTodayActivityWorkflow — Phase 4A-final acceptance: leave-home never fabricated from unknown travel', () => {
  it('never computes a Leave Home (or a leave-home-anchored prep step) when travel duration is unknown — Event Start and Arrival stay valid', async () => {
    mockTimezoneSelect('UTC');
    mockMainQuery([baseRow({ profileArrivalBufferMinutes: 30, profileTravelMinutes: null })]); // arrival known, travel unknown
    mockPrepStepsQuery([
      { id: 'step-1', activityProfileId: 'profile-hockey', label: 'Get dressed', anchor: 'leave_home', offsetMinutes: 10, isCheckable: true },
    ]);
    const [item] = await listTodayActivityWorkflow(new Date('2026-10-08T16:00:00.000Z'));

    expect(item!.leaveHomeTime).toBeNull();
    expect(item!.arrivalTime?.toISOString()).toBe('2026-10-08T17:30:00.000Z'); // event start - 30min buffer, unaffected by unknown travel
    expect(item!.eventStart.toISOString()).toBe('2026-10-08T18:00:00.000Z');
    // The prep step anchored to Leave Home has no fabricated time either.
    const prepStep = item!.prepSteps.find((s) => s.id === 'step-1');
    expect(prepStep!.time).toBeNull();
    expect(prepStep!.unscheduledReason).toMatch(/leave home/i);
  });

  it('preserves an explicitly configured zero travel time as a real, calculated Leave Home — distinct from unconfigured', async () => {
    mockTimezoneSelect('UTC');
    mockMainQuery([baseRow({ profileArrivalBufferMinutes: 30, profileTravelMinutes: 0 })]); // explicit 0, never "unset"
    mockPrepStepsQuery([]);
    const [item] = await listTodayActivityWorkflow(new Date('2026-10-08T16:00:00.000Z'));

    // Leave Home coincides exactly with Arrival (0 minutes of travel) — a real
    // calculated time, not "Not calculated".
    expect(item!.leaveHomeTime?.toISOString()).toBe('2026-10-08T17:30:00.000Z');
    expect(item!.arrivalTime?.toISOString()).toBe('2026-10-08T17:30:00.000Z');
  });

  it('computes Event Start, Arrival, and Leave Home correctly when every input is configured', async () => {
    mockTimezoneSelect('UTC');
    mockMainQuery([baseRow({ profileArrivalBufferMinutes: 30, profileTravelMinutes: 20 })]);
    mockPrepStepsQuery([]);
    const [item] = await listTodayActivityWorkflow(new Date('2026-10-08T16:00:00.000Z'));

    expect(item!.eventStart.toISOString()).toBe('2026-10-08T18:00:00.000Z');
    expect(item!.arrivalTime?.toISOString()).toBe('2026-10-08T17:30:00.000Z');
    expect(item!.leaveHomeTime?.toISOString()).toBe('2026-10-08T17:10:00.000Z');
  });
});
