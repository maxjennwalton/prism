/**
 * @jest-environment node
 */
const mockGetDisplayAuth = jest.fn();
jest.mock('@/lib/auth', () => ({
  getDisplayAuth: (...a: unknown[]) => mockGetDisplayAuth(...a),
}));

const mockListTodayActivityWorkflow = jest.fn();
jest.mock('@/lib/services/activityWorkflow', () => ({
  listTodayActivityWorkflow: (...a: unknown[]) => mockListTodayActivityWorkflow(...a),
}));

jest.mock('@/lib/utils/logError', () => ({ logError: jest.fn() }));

import { GET } from '../route';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/activity-matching/workflow', () => {
  it('returns 401 without a display session, and never queries the service', async () => {
    mockGetDisplayAuth.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(mockListTodayActivityWorkflow).not.toHaveBeenCalled();
  });

  it('returns the service result as { items } for an authorized display', async () => {
    mockGetDisplayAuth.mockResolvedValue({ userId: 'display-1' });
    const items = [{ linkId: 'link-1', eventTitle: 'Hockey Practice' }];
    mockListTodayActivityWorkflow.mockResolvedValue(items);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ items });
  });

  it('returns 500 and never throws when the service rejects', async () => {
    mockGetDisplayAuth.mockResolvedValue({ userId: 'display-1' });
    mockListTodayActivityWorkflow.mockRejectedValue(new Error('db exploded'));

    const res = await GET();

    expect(res.status).toBe(500);
  });
});
