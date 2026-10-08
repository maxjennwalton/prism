/**
 * Tests for GET/POST/DELETE /api/settings/homeAddress
 *
 * Covers:
 * - GET requires auth (not just display auth) and returns the stored value or null
 * - POST requires the canModifySettings role and rejects an address with no/invalid coordinates
 * - POST never geocodes itself — it only persists the exact candidate it's given
 * - DELETE requires the canModifySettings role
 */
import { NextRequest, NextResponse } from 'next/server';

const mockSelect = jest.fn();
const mockInsert = jest.fn();
const mockDeleteFn = jest.fn();

jest.mock('@/lib/db/client', () => ({
  db: {
    select: (...a: unknown[]) => mockSelect(...a),
    insert: (...a: unknown[]) => mockInsert(...a),
    delete: (...a: unknown[]) => mockDeleteFn(...a),
  },
}));

jest.mock('@/lib/db/schema', () => ({ settings: { key: 'key', value: 'value' } }));
jest.mock('drizzle-orm', () => ({ eq: jest.fn() }));

const mockRequireAuth = jest.fn();
const mockRequireRole = jest.fn();
jest.mock('@/lib/auth', () => ({
  requireAuth: () => mockRequireAuth(),
  requireRole: (...a: unknown[]) => mockRequireRole(...a),
}));

const mockLogActivity = jest.fn();
jest.mock('@/lib/services/auditLog', () => ({ logActivity: (...a: unknown[]) => mockLogActivity(...a) }));
jest.mock('@/lib/utils/logError', () => ({ logError: jest.fn() }));

import { GET, POST, DELETE } from '../route';

const parentAuth = { userId: 'parent-1', role: 'parent' };

function postRequest(body: unknown) {
  return new NextRequest('http://localhost:3000/api/settings/homeAddress', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/settings/homeAddress', () => {
  it('requires auth (not open display auth)', async () => {
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns null when nothing is configured', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockSelect.mockReturnValue({ from: () => ({ where: async () => [] }) });
    const res = await GET();
    const json = await res.json();
    expect(json).toEqual({ homeAddress: null });
  });

  it('returns the stored home address', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    const stored = { address: '123 Main St, Springfield', lat: 40.0, lon: -75.0 };
    mockSelect.mockReturnValue({ from: () => ({ where: async () => [{ value: stored }] }) });
    const res = await GET();
    const json = await res.json();
    expect(json).toEqual({ homeAddress: stored });
  });
});

describe('POST /api/settings/homeAddress', () => {
  it('requires auth', async () => {
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await POST(postRequest({ address: '123 Main St', lat: 40, lon: -75 }));
    expect(res.status).toBe(401);
  });

  it('requires the canModifySettings role', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const res = await POST(postRequest({ address: '123 Main St', lat: 40, lon: -75 }));
    expect(res.status).toBe(403);
  });

  it('rejects a missing address', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(null);
    const res = await POST(postRequest({ lat: 40, lon: -75 }));
    expect(res.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects missing/non-numeric coordinates — never geocodes on its own', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(null);
    const res = await POST(postRequest({ address: '123 Main St' }));
    expect(res.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects out-of-range coordinates', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(null);
    const res = await POST(postRequest({ address: '123 Main St', lat: 999, lon: -75 }));
    expect(res.status).toBe(400);
  });

  it('persists exactly the candidate given (address + lat + lon), no transformation', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(null);
    const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn().mockReturnValue({ onConflictDoUpdate });
    mockInsert.mockReturnValue({ values });

    const res = await POST(postRequest({ address: '  123 Main St, Springfield  ', lat: 40.123456, lon: -75.654321 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(values).toHaveBeenCalledWith({
      key: 'homeAddress',
      value: { address: '123 Main St, Springfield', lat: 40.123456, lon: -75.654321 },
    });
    expect(json.homeAddress).toEqual({ address: '123 Main St, Springfield', lat: 40.123456, lon: -75.654321 });
    expect(mockLogActivity).toHaveBeenCalled();
  });
});

describe('DELETE /api/settings/homeAddress', () => {
  it('requires the canModifySettings role', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const res = await DELETE();
    expect(res.status).toBe(403);
    expect(mockDeleteFn).not.toHaveBeenCalled();
  });

  it('clears the stored home address', async () => {
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockRequireRole.mockReturnValue(null);
    const where = jest.fn().mockResolvedValue(undefined);
    mockDeleteFn.mockReturnValue({ where });

    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(where).toHaveBeenCalled();
  });
});
