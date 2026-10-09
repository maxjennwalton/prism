const mockRequireAuth = jest.fn();
const mockRequireRole = jest.fn();
jest.mock('@/lib/auth', () => ({
  requireAuth: () => mockRequireAuth(),
  requireRole: (...a: unknown[]) => mockRequireRole(...a),
}));

const mockSetOverride = jest.fn();
const mockRecompute = jest.fn();
jest.mock('@/lib/services/activityTravel', () => ({
  setActivityDestinationOverride: (...a: unknown[]) => mockSetOverride(...a),
  recomputeActivityTravelForLink: (...a: unknown[]) => mockRecompute(...a),
}));

jest.mock('@/lib/utils/logError', () => ({ logError: jest.fn() }));

import { POST } from '../route';

const parentAuth = { userId: 'parent-1', role: 'parent' };
const CANDIDATE = { address: 'All Around Athletics Centre, 91 Sandford Fleming Dr', lat: 40.1, lon: -75.1 };

function call(id: string, body: unknown) {
  return POST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSetOverride.mockResolvedValue(undefined);
});

describe('POST /api/activity-matching/links/[id]/destination', () => {
  it('requires auth', async () => {
    const { NextResponse } = await import('next/server');
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await call('link-1', { destination: CANDIDATE });
    expect(res.status).toBe(401);
    expect(mockSetOverride).not.toHaveBeenCalled();
  });

  it('requires the canModifySettings permission', async () => {
    const { NextResponse } = await import('next/server');
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const res = await call('link-1', { destination: CANDIDATE });
    expect(res.status).toBe(403);
  });

  it.each([
    ['a bare string (free text would need to be geocoded first, this route never does that)', 'All Around Athletics Centre'],
    ['missing lat', { address: 'x', lon: -75.1 }],
    ['missing lon', { address: 'x', lat: 40.1 }],
    ['an empty address', { address: '', lat: 40.1, lon: -75.1 }],
    ['an out-of-range latitude', { address: 'x', lat: 999, lon: -75.1 }],
    ['an out-of-range longitude', { address: 'x', lat: 40.1, lon: 999 }],
    ['a non-finite latitude', { address: 'x', lat: Number.NaN, lon: -75.1 }],
  ])('rejects %s', async (_label, destination) => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(null);
    const res = await call('link-1', { destination });
    expect(res.status).toBe(400);
    expect(mockSetOverride).not.toHaveBeenCalled();
  });

  it('saves exactly the candidate given and forces a recompute, returning the new travelMeta', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(null);
    mockRecompute.mockResolvedValue({ found: true, travelMeta: { status: 'ok', minutes: 7 } });

    const res = await call('link-1', { destination: CANDIDATE });
    const json = await res.json();

    expect(mockSetOverride).toHaveBeenCalledWith('link-1', CANDIDATE);
    expect(mockRecompute).toHaveBeenCalledWith('link-1');
    expect(json).toEqual({ destination: CANDIDATE, travelMeta: { status: 'ok', minutes: 7 } });
  });

  it('trims the address but never alters the coordinates given', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(null);
    mockRecompute.mockResolvedValue({ found: true, travelMeta: null });

    await call('link-1', { destination: { address: '  Padded Address  ', lat: 1.23456, lon: -2.34567 } });

    expect(mockSetOverride).toHaveBeenCalledWith('link-1', { address: 'Padded Address', lat: 1.23456, lon: -2.34567 });
  });

  it('clears the pin when destination is null', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(null);
    mockRecompute.mockResolvedValue({ found: true, travelMeta: null });

    await call('link-1', { destination: null });
    expect(mockSetOverride).toHaveBeenCalledWith('link-1', null);
  });

  it('returns 404 when the link does not exist', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(null);
    mockRecompute.mockResolvedValue({ found: false, travelMeta: null });

    const res = await call('missing-link', { destination: CANDIDATE });
    expect(res.status).toBe(404);
  });

  it('returns 500 when the service throws', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(null);
    mockSetOverride.mockRejectedValue(new Error('boom'));

    const res = await call('link-1', { destination: CANDIDATE });
    expect(res.status).toBe(500);
  });
});
