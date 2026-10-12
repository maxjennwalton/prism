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

const mockGetLinkOriginalLocation = jest.fn();
const mockFindMatchingLinkIds = jest.fn();
const mockConfirmLocationAlias = jest.fn();
jest.mock('@/lib/services/activityLocationAliases', () => ({
  getLinkOriginalLocation: (...a: unknown[]) => mockGetLinkOriginalLocation(...a),
  findMatchingLinkIds: (...a: unknown[]) => mockFindMatchingLinkIds(...a),
  confirmLocationAlias: (...a: unknown[]) => mockConfirmLocationAlias(...a),
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
  mockRequireAuth.mockResolvedValue(parentAuth);
  mockRequireRole.mockReturnValue(null);
  mockGetLinkOriginalLocation.mockResolvedValue('Wasaga');
  mockConfirmLocationAlias.mockResolvedValue({ ok: true, aliasId: 'alias-1' });
  mockFindMatchingLinkIds.mockResolvedValue([]);
  mockRecompute.mockResolvedValue({ found: true, travelMeta: { status: 'ok', minutes: 10 } });
});

describe('POST .../destination/apply-to-matching', () => {
  it('requires auth', async () => {
    const { NextResponse } = await import('next/server');
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await call('link-1', { venueId: 'venue-1' });
    expect(res.status).toBe(401);
    expect(mockConfirmLocationAlias).not.toHaveBeenCalled();
  });

  it('requires the canModifySettings permission', async () => {
    const { NextResponse } = await import('next/server');
    mockRequireRole.mockReturnValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const res = await call('link-1', { venueId: 'venue-1' });
    expect(res.status).toBe(403);
  });

  it.each([
    ['missing venueId', {}],
    ['a non-string venueId', { venueId: 123 }],
    ['an empty venueId', { venueId: '' }],
    ['a non-boolean overwriteConflict', { venueId: 'venue-1', overwriteConflict: 'yes' }],
  ])('rejects %s', async (_label, body) => {
    const res = await call('link-1', body);
    expect(res.status).toBe(400);
    expect(mockConfirmLocationAlias).not.toHaveBeenCalled();
  });

  it('returns 404 when the link has no calendar location text to key the alias on', async () => {
    mockGetLinkOriginalLocation.mockResolvedValue(null);
    const res = await call('missing-link', { venueId: 'venue-1' });
    expect(res.status).toBe(404);
    expect(mockConfirmLocationAlias).not.toHaveBeenCalled();
  });

  it('confirms the alias using this link\'s own raw location text and the given venueId', async () => {
    await call('link-1', { venueId: 'venue-1' });
    expect(mockConfirmLocationAlias).toHaveBeenCalledWith('Wasaga', 'venue-1', { overwriteConflict: false });
  });

  it('passes overwriteConflict through when explicitly set', async () => {
    await call('link-1', { venueId: 'venue-1', overwriteConflict: true });
    expect(mockConfirmLocationAlias).toHaveBeenCalledWith('Wasaga', 'venue-1', { overwriteConflict: true });
  });

  it('returns 409 with the existing venue info when the alias conflicts, without recomputing anything', async () => {
    mockConfirmLocationAlias.mockResolvedValue({
      ok: false,
      reason: 'conflict',
      existingVenueId: 'venue-OLD',
      existingAddress: 'Wasaga Sands Arena, Wasaga Beach, ON',
    });

    const res = await call('link-1', { venueId: 'venue-NEW' });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.existingVenueId).toBe('venue-OLD');
    expect(json.existingAddress).toBe('Wasaga Sands Arena, Wasaga Beach, ON');
    expect(mockRecompute).not.toHaveBeenCalled();
  });

  it('recomputes every matching link immediately and reports the updated count', async () => {
    mockFindMatchingLinkIds.mockResolvedValue(['link-2', 'link-3', 'link-4']);

    const res = await call('link-1', { venueId: 'venue-1' });
    const json = await res.json();

    expect(mockRecompute).toHaveBeenCalledTimes(3);
    expect(mockRecompute).toHaveBeenCalledWith('link-2');
    expect(mockRecompute).toHaveBeenCalledWith('link-3');
    expect(mockRecompute).toHaveBeenCalledWith('link-4');
    expect(json).toEqual({ updatedCount: 3 });
  });

  it('never recomputes the originating link itself a second time', async () => {
    mockFindMatchingLinkIds.mockResolvedValue(['link-2']);
    await call('link-1', { venueId: 'venue-1' });
    expect(mockRecompute).not.toHaveBeenCalledWith('link-1');
  });

  it('reports updatedCount: 0 when nothing else matches, without error', async () => {
    const res = await call('link-1', { venueId: 'venue-1' });
    const json = await res.json();
    expect(json).toEqual({ updatedCount: 0 });
    expect(mockRecompute).not.toHaveBeenCalled();
  });

  it('returns 500 when the service throws', async () => {
    mockConfirmLocationAlias.mockRejectedValue(new Error('boom'));
    const res = await call('link-1', { venueId: 'venue-1' });
    expect(res.status).toBe(500);
  });
});
