/**
 * @jest-environment node
 */
const mockSelect = jest.fn();
const mockInsert = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();

jest.mock('../client', () => ({
  db: {
    select: (...a: unknown[]) => mockSelect(...a),
    insert: (...a: unknown[]) => mockInsert(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
    delete: (...a: unknown[]) => mockDelete(...a),
  },
}));

jest.mock('../schema', () => ({
  activityProfiles: { id: 'id', name: 'name', archived: 'archived' },
  activityProfilePrepSteps: { id: 'id', activityProfileId: 'activityProfileId', sortOrder: 'sortOrder' },
  activityEventLinks: { id: 'id', eventId: 'eventId' },
  activityGearCompletions: {
    id: 'id',
    activityEventLinkId: 'activityEventLinkId',
    gearItemId: 'gearItemId',
  },
}));

jest.mock('drizzle-orm', () => ({ eq: jest.fn(), asc: jest.fn(), and: jest.fn() }));

import {
  listActivityProfiles,
  getActivityProfile,
  createActivityProfile,
  updateActivityProfile,
  createPrepStep,
  createActivityEventLinkIfAbsent,
  updateActivityEventLink,
  setGearItemChecked,
} from '../activityProfiles';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createActivityProfile — no invented timing defaults', () => {
  it('inserts NULL for arrivalBufferMinutes/travelMinutes when not supplied', async () => {
    const values = jest.fn().mockReturnValue({ returning: () => [{ id: 'p1', name: 'Hockey Practice' }] });
    mockInsert.mockReturnValue({ values });

    await createActivityProfile({ name: 'Hockey Practice' });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Hockey Practice',
        arrivalBufferMinutes: null,
        travelMinutes: null,
        matchKeywords: [],
        gearItems: [],
      }),
    );
  });

  it('passes through explicitly configured timing values unchanged', async () => {
    const values = jest.fn().mockReturnValue({ returning: () => [{ id: 'p2' }] });
    mockInsert.mockReturnValue({ values });

    await createActivityProfile({ name: 'Hockey Game', arrivalBufferMinutes: 30, travelMinutes: 20 });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ arrivalBufferMinutes: 30, travelMinutes: 20 }),
    );
  });
});

describe('listActivityProfiles', () => {
  it('filters out archived profiles by default', async () => {
    mockSelect.mockReturnValue({
      from: () => ({
        orderBy: () => [
          { id: 'p1', name: 'Hockey Practice', archived: false },
          { id: 'p2', name: 'Retired Thing', archived: true },
        ],
      }),
    });

    const result = await listActivityProfiles();
    expect(result.map((p) => p.id)).toEqual(['p1']);
  });

  it('includes archived profiles when asked', async () => {
    mockSelect.mockReturnValue({
      from: () => ({
        orderBy: () => [
          { id: 'p1', name: 'Hockey Practice', archived: false },
          { id: 'p2', name: 'Retired Thing', archived: true },
        ],
      }),
    });

    const result = await listActivityProfiles({ includeArchived: true });
    expect(result.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});

describe('getActivityProfile', () => {
  it('returns null when no row matches', async () => {
    mockSelect.mockReturnValue({ from: () => ({ where: () => [] }) });
    expect(await getActivityProfile('missing')).toBeNull();
  });
});

describe('updateActivityProfile', () => {
  it('allows clearing a configured buffer back to null', async () => {
    const set = jest.fn().mockReturnValue({
      where: () => ({ returning: () => [{ id: 'p1', arrivalBufferMinutes: null }] }),
    });
    mockUpdate.mockReturnValue({ set });

    await updateActivityProfile('p1', { arrivalBufferMinutes: null });

    expect(set).toHaveBeenCalledWith(expect.objectContaining({ arrivalBufferMinutes: null }));
  });
});

describe('createPrepStep', () => {
  it('defaults isCheckable=true and linksGear=false, and stores the given anchor', async () => {
    const values = jest.fn().mockReturnValue({ returning: () => [{ id: 's1' }] });
    mockInsert.mockReturnValue({ values });

    await createPrepStep({
      activityProfileId: 'p1',
      label: 'Pack hockey bag',
      anchor: 'leave_home',
      offsetMinutes: 30,
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        anchor: 'leave_home',
        offsetMinutes: 30,
        isCheckable: true,
        linksGear: false,
      }),
    );
  });
});

describe('createActivityEventLinkIfAbsent', () => {
  it('does not insert when a link already exists for the event', async () => {
    mockSelect.mockReturnValue({
      from: () => ({ where: () => [{ id: 'link1', eventId: 'e1', activityProfileId: 'p1' }] }),
    });

    const result = await createActivityEventLinkIfAbsent({ eventId: 'e1', activityProfileId: 'p2' });

    expect(result).toEqual({ id: 'link1', eventId: 'e1', activityProfileId: 'p1' });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('inserts a new link when none exists yet', async () => {
    mockSelect.mockReturnValue({ from: () => ({ where: () => [] }) });
    const values = jest.fn().mockReturnValue({
      returning: () => [{ id: 'link2', eventId: 'e2', activityProfileId: 'p1', autoMatched: true }],
    });
    mockInsert.mockReturnValue({ values });

    const result = await createActivityEventLinkIfAbsent({ eventId: 'e2', activityProfileId: 'p1' });

    expect(mockInsert).toHaveBeenCalled();
    expect(result.id).toBe('link2');
  });
});

describe('updateActivityEventLink', () => {
  it('always clears autoMatched, marking the row as human-edited', async () => {
    const set = jest.fn().mockReturnValue({
      where: () => ({ returning: () => [{ id: 'link1', autoMatched: false }] }),
    });
    mockUpdate.mockReturnValue({ set });

    await updateActivityEventLink('link1', { travelMinutesOverride: 25 });

    expect(set).toHaveBeenCalledWith(expect.objectContaining({ autoMatched: false, travelMinutesOverride: 25 }));
  });
});

describe('setGearItemChecked — per-occurrence, not per-profile', () => {
  it('inserts a new completion row when none exists for this occurrence+item', async () => {
    mockSelect.mockReturnValue({ from: () => ({ where: () => [] }) });
    const values = jest.fn().mockReturnValue({
      returning: () => [{ id: 'gc1', activityEventLinkId: 'link1', gearItemId: 'helmet', checked: true }],
    });
    mockInsert.mockReturnValue({ values });

    const result = await setGearItemChecked('link1', 'helmet', true, 'user1');

    expect(mockInsert).toHaveBeenCalled();
    expect(result.checked).toBe(true);
  });

  it('updates the existing row for this occurrence+item rather than inserting a duplicate', async () => {
    mockSelect.mockReturnValue({
      from: () => ({ where: () => [{ id: 'gc1', activityEventLinkId: 'link1', gearItemId: 'helmet', checked: false }] }),
    });
    const set = jest.fn().mockReturnValue({
      where: () => ({ returning: () => [{ id: 'gc1', checked: true }] }),
    });
    mockUpdate.mockReturnValue({ set });

    const result = await setGearItemChecked('link1', 'helmet', true, 'user1');

    expect(mockUpdate).toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(result.checked).toBe(true);
  });

  it('checking an item for one occurrence does not touch another occurrence (different link id)', async () => {
    // Occurrence A (link1) has helmet checked; occurrence B (link2) has no row yet.
    mockSelect.mockReturnValueOnce({ from: () => ({ where: () => [] }) });
    const values = jest.fn().mockReturnValue({
      returning: () => [{ id: 'gc2', activityEventLinkId: 'link2', gearItemId: 'helmet', checked: false }],
    });
    mockInsert.mockReturnValue({ values });

    const result = await setGearItemChecked('link2', 'helmet', false, null);

    expect(result.activityEventLinkId).toBe('link2');
  });
});
