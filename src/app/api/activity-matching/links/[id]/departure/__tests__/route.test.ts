const mockRequireAuth = jest.fn();
const mockRequireRole = jest.fn();
jest.mock('@/lib/auth', () => ({
  requireAuth: () => mockRequireAuth(),
  requireRole: (...a: unknown[]) => mockRequireRole(...a),
}));

const mockSetOverride = jest.fn();
const mockRecompute = jest.fn();
jest.mock('@/lib/services/activityTravel', () => ({
  setActivityDepartureOverride: (...a: unknown[]) => mockSetOverride(...a),
  recomputeActivityTravelForLink: (...a: unknown[]) => mockRecompute(...a),
}));

jest.mock('@/lib/utils/logError', () => ({ logError: jest.fn() }));

import { POST } from '../route';

const parentAuth = { userId: 'parent-1', role: 'parent' };

function call(id: string, body: unknown) {
  return POST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSetOverride.mockResolvedValue(undefined);
});

describe('POST /api/activity-matching/links/[id]/departure', () => {
  it('requires auth', async () => {
    const { NextResponse } = await import('next/server');
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await call('link-1', { departureLocationOverride: '42 Side St' });
    expect(res.status).toBe(401);
    expect(mockSetOverride).not.toHaveBeenCalled();
  });

  it('requires the canModifySettings permission', async () => {
    const { NextResponse } = await import('next/server');
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const res = await call('link-1', { departureLocationOverride: '42 Side St' });
    expect(res.status).toBe(403);
  });

  it('rejects a non-string, non-null departureLocationOverride', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(null);
    const res = await call('link-1', { departureLocationOverride: 42 });
    expect(res.status).toBe(400);
    expect(mockSetOverride).not.toHaveBeenCalled();
  });

  it('saves a trimmed override and forces a recompute, returning the new travelMeta', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(null);
    mockRecompute.mockResolvedValue({ found: true, travelMeta: { status: 'ok', minutes: 9 } });

    const res = await call('link-1', { departureLocationOverride: '  42 Side St  ' });
    const json = await res.json();

    expect(mockSetOverride).toHaveBeenCalledWith('link-1', '42 Side St');
    expect(mockRecompute).toHaveBeenCalledWith('link-1');
    expect(json).toEqual({ departureLocationOverride: '42 Side St', travelMeta: { status: 'ok', minutes: 9 } });
  });

  it('treats an empty/whitespace string as clearing the override (null)', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(null);
    mockRecompute.mockResolvedValue({ found: true, travelMeta: null });

    await call('link-1', { departureLocationOverride: '   ' });
    expect(mockSetOverride).toHaveBeenCalledWith('link-1', null);
  });

  it('clears the override when given null explicitly', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(null);
    mockRecompute.mockResolvedValue({ found: true, travelMeta: null });

    await call('link-1', { departureLocationOverride: null });
    expect(mockSetOverride).toHaveBeenCalledWith('link-1', null);
  });

  it('returns 404 when the link does not exist', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(null);
    mockRecompute.mockResolvedValue({ found: false, travelMeta: null });

    const res = await call('missing-link', { departureLocationOverride: '42 Side St' });
    expect(res.status).toBe(404);
  });

  it('returns 500 when the service throws', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(null);
    mockSetOverride.mockRejectedValue(new Error('boom'));

    const res = await call('link-1', { departureLocationOverride: '42 Side St' });
    expect(res.status).toBe(500);
  });
});
