const mockRequireAuth = jest.fn();
const mockRequireRole = jest.fn();
jest.mock('@/lib/auth', () => ({
  requireAuth: () => mockRequireAuth(),
  requireRole: (...a: unknown[]) => mockRequireRole(...a),
}));

const mockList = jest.fn();
jest.mock('@/lib/services/activityTravel', () => ({
  listUpcomingActivityTravel: (...a: unknown[]) => mockList(...a),
}));

jest.mock('@/lib/utils/logError', () => ({ logError: jest.fn() }));

import { GET } from '../route';

const parentAuth = { userId: 'parent-1', role: 'parent' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/activity-matching/links/upcoming', () => {
  it('requires auth', async () => {
    const { NextResponse } = await import('next/server');
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('requires the canModifySettings permission', async () => {
    const { NextResponse } = await import('next/server');
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('returns the listed items', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(null);
    const items = [{ linkId: 'link-1' }];
    mockList.mockResolvedValue(items);

    const res = await GET();
    const json = await res.json();
    expect(json).toEqual({ items });
  });

  it('returns 500 when the service throws', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(null);
    mockList.mockRejectedValue(new Error('boom'));

    const res = await GET();
    expect(res.status).toBe(500);
  });
});
