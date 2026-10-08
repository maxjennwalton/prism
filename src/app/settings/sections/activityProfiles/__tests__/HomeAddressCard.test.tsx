/**
 * @jest-environment jsdom
 *
 * Covers: loads the current Home address on mount, searches via the
 * existing /api/travel/geocode proxy, saves exactly the selected
 * candidate (never free-typed text), and can clear the saved address.
 */
import * as React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { HomeAddressCard } from '../HomeAddressCard';

jest.mock('@/components/ui/use-toast', () => ({ toast: jest.fn() }));

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers({ legacyFakeTimers: false });
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('HomeAddressCard', () => {
  it('loads and displays the currently saved Home address, with no search box shown', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      json: async () => ({ homeAddress: { address: '123 Main St, Springfield', lat: 40, lon: -75 } }),
    });
    render(<HomeAddressCard />);
    await flush();
    expect(screen.getByText('123 Main St, Springfield')).not.toBeNull();
    expect(screen.queryByPlaceholderText(/search for your home address/i)).toBeNull();
  });

  it('shows the search box when no Home address is configured yet', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ json: async () => ({ homeAddress: null }) });
    render(<HomeAddressCard />);
    await flush();
    expect(screen.getByPlaceholderText(/search for your home address/i)).not.toBeNull();
  });

  it('searches via /api/travel/geocode and saves exactly the selected candidate', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ json: async () => ({ homeAddress: null }) }) // initial GET
      .mockResolvedValueOnce({
        json: async () => ({
          results: [{ placeId: 1, displayName: '123 Main St', fullName: '123 Main St, Springfield, IL, USA', latitude: 40.1, longitude: -75.2 }],
        }),
      }); // geocode search

    render(<HomeAddressCard />);
    await flush();

    fireEvent.change(screen.getByPlaceholderText(/search for your home address/i), { target: { value: '123 Main St' } });
    await act(async () => { jest.advanceTimersByTime(400); });
    await flush();

    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/travel/geocode?q='));

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ homeAddress: { address: '123 Main St, Springfield, IL, USA', lat: 40.1, lon: -75.2 } }),
    });

    fireEvent.click(screen.getByText('123 Main St, Springfield, IL, USA'));
    await flush();

    const saveCall = (global.fetch as jest.Mock).mock.calls.find(
      ([url, init]) => url === '/api/settings/homeAddress' && init?.method === 'POST',
    );
    expect(saveCall).toBeDefined();
    const [, init] = saveCall!;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ address: '123 Main St, Springfield, IL, USA', lat: 40.1, lon: -75.2 });

    expect(await screen.findByText('123 Main St, Springfield, IL, USA')).not.toBeNull();
  });

  it('clears the saved Home address and shows the search box again', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      json: async () => ({ homeAddress: { address: '123 Main St, Springfield', lat: 40, lon: -75 } }),
    });
    render(<HomeAddressCard />);
    await flush();

    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    fireEvent.click(screen.getByLabelText(/clear home address/i));
    await flush();

    expect(screen.getByPlaceholderText(/search for your home address/i)).not.toBeNull();
  });
});
