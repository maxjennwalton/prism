/**
 * @jest-environment jsdom
 *
 * Covers the manual "Re-evaluate Match" fallback added alongside automatic
 * re-evaluation: confirm/reject already had this shape (POST/PATCH, then
 * refresh), and `reevaluate` follows the same contract against the
 * existing /reevaluate route.
 */
import { renderHook, waitFor, act } from '@testing-library/react';
import { useActivityMatchingNeedsReview } from '../useActivityMatchingNeedsReview';

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ items: [] }),
  }) as unknown as typeof fetch;
});

describe('useActivityMatchingNeedsReview — reevaluate', () => {
  it('POSTs to the reevaluate route for the given id and refreshes the queue afterward', async () => {
    const { result } = renderHook(() => useActivityMatchingNeedsReview());
    await waitFor(() => expect(result.current.loading).toBe(false));

    (global.fetch as jest.Mock).mockClear();
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ link: { id: 'link-1' }, changed: true } ) }) // the reevaluate POST
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) }); // the refresh GET

    await act(async () => {
      await result.current.reevaluate('link-1');
    });

    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/activity-matching/links/link-1/reevaluate', { method: 'POST' });
    expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/activity-matching/needs-review');
  });

  it('throws when the reevaluate request fails, and does not silently swallow the error', async () => {
    const { result } = renderHook(() => useActivityMatchingNeedsReview());
    await waitFor(() => expect(result.current.loading).toBe(false));

    (global.fetch as jest.Mock).mockClear();
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'nope' }) });

    await expect(
      act(async () => {
        await result.current.reevaluate('link-1');
      }),
    ).rejects.toThrow('nope');
  });
});
