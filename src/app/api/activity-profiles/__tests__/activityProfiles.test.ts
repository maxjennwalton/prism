/**
 * @jest-environment node
 */
import { NextRequest, NextResponse } from 'next/server';

const mockRequireAuth = jest.fn();
const mockRequireRole = jest.fn();

jest.mock('@/lib/auth', () => ({
  requireAuth: (...a: unknown[]) => mockRequireAuth(...a),
  requireRole: (...a: unknown[]) => mockRequireRole(...a),
  getDisplayAuth: jest.fn().mockResolvedValue({ userId: 'u1', role: 'parent' }),
}));

const mockListActivityProfiles = jest.fn();
const mockCreateActivityProfile = jest.fn();
const mockGetActivityProfile = jest.fn();
const mockListPrepSteps = jest.fn();
const mockCreatePrepStep = jest.fn();
const mockUpdateActivityProfile = jest.fn();
const mockUpdatePrepStep = jest.fn();
const mockDeletePrepStep = jest.fn();

jest.mock('@/lib/db/activityProfiles', () => ({
  listActivityProfiles: (...a: unknown[]) => mockListActivityProfiles(...a),
  createActivityProfile: (...a: unknown[]) => mockCreateActivityProfile(...a),
  getActivityProfile: (...a: unknown[]) => mockGetActivityProfile(...a),
  listPrepSteps: (...a: unknown[]) => mockListPrepSteps(...a),
  createPrepStep: (...a: unknown[]) => mockCreatePrepStep(...a),
  updateActivityProfile: (...a: unknown[]) => mockUpdateActivityProfile(...a),
  updatePrepStep: (...a: unknown[]) => mockUpdatePrepStep(...a),
  deletePrepStep: (...a: unknown[]) => mockDeletePrepStep(...a),
}));

jest.mock('@/lib/db/client', () => ({ db: { select: jest.fn(() => ({ from: () => [] })) } }));
jest.mock('@/lib/db/schema', () => ({ activityProfilePrepSteps: { activityProfileId: 'activityProfileId' } }));
jest.mock('@/lib/utils/logError', () => ({ logError: jest.fn() }));

import { POST as createProfile, GET as listProfiles } from '../route';
import { PATCH as patchProfile } from '../[id]/route';
import { POST as duplicateProfile } from '../[id]/duplicate/route';
import { PUT as reorderSteps } from '../[id]/prep-steps/reorder/route';

function req(url: string, body?: object, method = 'POST') {
  return new NextRequest(url, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/activity-profiles — parent-only, no invented timing', () => {
  it('blocks a child (403)', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'c1', role: 'child' });
    mockRequireRole.mockReturnValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );

    const res = await createProfile(req('http://localhost/api/activity-profiles', { name: 'Hockey Practice' }));
    expect(res.status).toBe(403);
    expect(mockCreateActivityProfile).not.toHaveBeenCalled();
  });

  it('allows a parent and never injects a timing default', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'p1', role: 'parent' });
    mockRequireRole.mockReturnValue(null);
    mockCreateActivityProfile.mockResolvedValue({ id: 'ap1', name: 'Hockey Practice' });

    const res = await createProfile(req('http://localhost/api/activity-profiles', { name: 'Hockey Practice' }));
    expect(res.status).toBe(201);
    expect(mockCreateActivityProfile).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Hockey Practice', createdBy: 'p1' }),
    );
    // arrivalBufferMinutes/travelMinutes simply weren't in the call args at all.
    const callArg = mockCreateActivityProfile.mock.calls[0][0];
    expect('arrivalBufferMinutes' in callArg).toBe(false);
    expect('travelMinutes' in callArg).toBe(false);
  });

  it('rejects a request with no name (validation, before auth-gated work runs)', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'p1', role: 'parent' });
    mockRequireRole.mockReturnValue(null);

    const res = await createProfile(req('http://localhost/api/activity-profiles', {}));
    expect(res.status).toBe(400);
    expect(mockCreateActivityProfile).not.toHaveBeenCalled();
  });
});

describe('GET /api/activity-profiles — summary counts', () => {
  it('includes prep step / gear / keyword counts for the list view', async () => {
    mockListActivityProfiles.mockResolvedValue([
      { id: 'ap1', name: 'Hockey Practice', gearItems: [{ id: 'g1', label: 'Helmet', sortOrder: 0 }], matchKeywords: ['hockey'] },
    ]);

    const res = await listProfiles(req('http://localhost/api/activity-profiles', undefined, 'GET'));
    const body = await res.json();
    expect(body.profiles[0]).toMatchObject({ gearItemCount: 1, matchKeywordCount: 1, prepStepCount: 0 });
  });
});

describe('PATCH /api/activity-profiles/[id] — archive is the only "removal" path', () => {
  const params = { params: Promise.resolve({ id: 'ap1' }) };

  it('archives via a normal field update, never a delete', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'p1', role: 'parent' });
    mockRequireRole.mockReturnValue(null);
    mockUpdateActivityProfile.mockResolvedValue({ id: 'ap1', archived: true });

    const res = await patchProfile(req('http://localhost/api/activity-profiles/ap1', { archived: true }, 'PATCH'), params);
    expect(res.status).toBe(200);
    expect(mockUpdateActivityProfile).toHaveBeenCalledWith('ap1', expect.objectContaining({ archived: true }));
  });

  it('blocks a child from archiving/restoring', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'c1', role: 'child' });
    mockRequireRole.mockReturnValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );

    const res = await patchProfile(req('http://localhost/api/activity-profiles/ap1', { archived: true }, 'PATCH'), params);
    expect(res.status).toBe(403);
    expect(mockUpdateActivityProfile).not.toHaveBeenCalled();
  });
});

describe('POST /api/activity-profiles/[id]/duplicate — independent copy', () => {
  const params = { params: Promise.resolve({ id: 'ap1' }) };

  it('copies the profile and its prep steps under new ids, independent of the source', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'p1', role: 'parent' });
    mockRequireRole.mockReturnValue(null);
    mockGetActivityProfile.mockResolvedValue({
      id: 'ap1', name: 'Hockey Practice', category: 'Hockey', color: '#3B82F6',
      matchKeywords: ['hockey practice'], arrivalBufferMinutes: 30, travelMinutes: 20,
      defaultLocation: 'Rink', gearItems: [{ id: 'g1', label: 'Helmet', sortOrder: 0 }],
    });
    mockListPrepSteps.mockResolvedValue([
      { id: 's1', label: 'Get dressed', sortOrder: 0, anchor: 'leave_home', offsetMinutes: 25, isCheckable: true, linksGear: false, assignedMemberId: null },
    ]);
    mockCreateActivityProfile.mockResolvedValue({ id: 'ap2', name: 'Hockey Practice (copy)' });
    mockCreatePrepStep.mockResolvedValue({ id: 's2' });

    const res = await duplicateProfile(req('http://localhost/api/activity-profiles/ap1/duplicate', undefined, 'POST'), params);
    expect(res.status).toBe(201);

    expect(mockCreateActivityProfile).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Hockey Practice (copy)', arrivalBufferMinutes: 30, travelMinutes: 20 }),
    );
    // The new step was created against the NEW profile id, not the source's.
    expect(mockCreatePrepStep).toHaveBeenCalledWith(
      expect.objectContaining({ activityProfileId: 'ap2', label: 'Get dressed' }),
    );
    // Gear items get fresh ids too — activity_gear_completions keys per-
    // occurrence checked state on this id, and the doc comment above this
    // route promises "its own ids throughout" for the whole copy. Reusing
    // the source's id ('g1') here would violate that for gear specifically.
    const gearItemsArg = mockCreateActivityProfile.mock.calls[0]![0].gearItems;
    expect(gearItemsArg).toEqual([expect.objectContaining({ label: 'Helmet', sortOrder: 0 })]);
    expect(gearItemsArg[0].id).not.toBe('g1');
    expect(typeof gearItemsArg[0].id).toBe('string');
    expect(gearItemsArg[0].id.length).toBeGreaterThan(0);
  });

  it('404s when the source profile does not exist', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'p1', role: 'parent' });
    mockRequireRole.mockReturnValue(null);
    mockGetActivityProfile.mockResolvedValue(null);

    const res = await duplicateProfile(req('http://localhost/api/activity-profiles/missing/duplicate', undefined, 'POST'), params);
    expect(res.status).toBe(404);
    expect(mockCreateActivityProfile).not.toHaveBeenCalled();
  });
});

describe('PUT /api/activity-profiles/[id]/prep-steps/reorder', () => {
  it('updates sortOrder for every step in the given order', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'p1', role: 'parent' });
    mockRequireRole.mockReturnValue(null);
    mockUpdatePrepStep.mockResolvedValue({});

    const res = await reorderSteps(req('http://localhost/api/activity-profiles/ap1/prep-steps/reorder', {
      order: [{ id: 's2', sortOrder: 0 }, { id: 's1', sortOrder: 1 }],
    }, 'PUT'));

    expect(res.status).toBe(200);
    expect(mockUpdatePrepStep).toHaveBeenCalledWith('s2', { sortOrder: 0 });
    expect(mockUpdatePrepStep).toHaveBeenCalledWith('s1', { sortOrder: 1 });
  });
});
