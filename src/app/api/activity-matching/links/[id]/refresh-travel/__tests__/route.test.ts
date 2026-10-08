/**
 * Tests for POST /api/activity-matching/links/[id]/refresh-travel
 *
 * Covers: requires canModifySettings, 404s when the link doesn't exist,
 * returns the recomputed (or null) travelMeta otherwise, and always
 * forces a fresh attempt (delegated to the service — verified here only
 * by confirming the service is called, not by re-testing its internals).
 */
const mockRequireAuth = jest.fn();
const mockRequireRole = jest.fn();
jest.mock('@/lib/auth', () => ({
  requireAuth: () => mockRequireAuth(),
  requireRole: (...a: unknown[]) => mockRequireRole(...a),
}));

const mockRecompute = jest.fn();
jest.mock('@/lib/services/activityTravel', () => ({
  recomputeActivityTravelForLink: (...a: unknown[]) => mockRecompute(...a),
}));

jest.mock('@/lib/utils/logError', () => ({ logError: jest.fn() }));

import { NextResponse } from 'next/server';
import { POST } from '../route';

const parentAuth = { userId: 'parent-1', role: 'parent' };

function call(id: string) {
  return POST(new Request('http://localhost/api/activity-matching/links/x/refresh-travel', { method: 'POST' }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/activity-matching/links/[id]/refresh-travel', () => {
  it('requires auth', async () => {
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await call('link-1');
    expect(res.status).toBe(401);
    expect(mockRecompute).not.toHaveBeenCalled();
  });

  it('requires the canModifySettings permission', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const res = await call('link-1');
    expect(res.status).toBe(403);
    expect(mockRecompute).not.toHaveBeenCalled();
  });

  it('returns 404 when the link does not exist', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(null);
    mockRecompute.mockResolvedValue({ found: false, travelMeta: null });

    const res = await call('missing-link');
    expect(res.status).toBe(404);
  });

  it('returns the recomputed travelMeta for an existing link', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(null);
    const travelMeta = { status: 'ok', minutes: 12 };
    mockRecompute.mockResolvedValue({ found: true, travelMeta });

    const res = await call('link-1');
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ travelMeta });
    expect(mockRecompute).toHaveBeenCalledWith('link-1');
  });

  it('returns a null travelMeta (200, not an error) when the link exists but there is nothing to compute', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(null);
    mockRecompute.mockResolvedValue({ found: true, travelMeta: null });

    const res = await call('link-1');
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ travelMeta: null });
  });

  it('returns 500 when the service throws', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(null);
    mockRecompute.mockRejectedValue(new Error('boom'));

    const res = await call('link-1');
    expect(res.status).toBe(500);
  });
});
