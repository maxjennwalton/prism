/**
 * @jest-environment jsdom
 */
import * as React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ActivityTravelPanel } from '../ActivityTravelPanel';

jest.mock('@/components/ui/use-toast', () => ({ toast: jest.fn() }));
import { toast } from '@/components/ui/use-toast';
const mockToast = toast as jest.Mock;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function item(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    linkId: 'link-1',
    eventTitle: 'Hockey Practice',
    eventStart: '2026-10-10T18:00:00.000Z',
    memberName: 'Beckham',
    destination: 'Community Rink',
    departureLocationOverride: null,
    destinationOverrideCoords: null,
    travelMinutesOverride: null,
    travelSource: 'profile_fallback',
    travelMinutes: 20,
    ...overrides,
  };
}

beforeEach(() => {
  global.fetch = jest.fn();
  mockToast.mockClear();
});

describe('ActivityTravelPanel', () => {
  it('shows "No upcoming activities" when the list is empty', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ json: async () => ({ items: [] }) });
    render(<ActivityTravelPanel />);
    await flush();
    expect(screen.getByText(/No upcoming activities/i)).not.toBeNull();
  });

  it('renders an item with its destination and travel label', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ json: async () => ({ items: [item()] }) });
    render(<ActivityTravelPanel />);
    await flush();
    expect(screen.getByText(/Hockey Practice — Beckham/)).not.toBeNull();
    expect(screen.getByText(/Community Rink/)).not.toBeNull();
    expect(screen.getByText(/20 min · Profile fallback/)).not.toBeNull();
  });

  it('saves a departure override and does not touch the Home address endpoint', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ json: async () => ({ items: [item()] }) }) // initial load
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // save
      .mockResolvedValueOnce({ json: async () => ({ items: [item({ departureLocationOverride: '42 Side St' })] }) }); // reload

    render(<ActivityTravelPanel />);
    await flush();

    const input = screen.getByPlaceholderText(/Departs from Home/i);
    fireEvent.change(input, { target: { value: '42 Side St' } });
    fireEvent.click(screen.getByText('Save'));
    await flush();

    const saveCall = (global.fetch as jest.Mock).mock.calls.find(([url]) => String(url).includes('/departure'));
    expect(saveCall).toBeDefined();
    const [url, init] = saveCall!;
    expect(url).toBe('/api/activity-matching/links/link-1/departure');
    expect(JSON.parse(init.body)).toEqual({ departureLocationOverride: '42 Side St' });
    expect((global.fetch as jest.Mock).mock.calls.some(([u]) => String(u).includes('homeAddress'))).toBe(false);
  });

  it('disables the departure input when a manual travelMinutesOverride is set (would be ignored anyway)', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ json: async () => ({ items: [item({ travelMinutesOverride: 15 })] }) });
    render(<ActivityTravelPanel />);
    await flush();
    const input = screen.getByPlaceholderText(/Departs from Home/i) as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('triggers a manual refresh via the refresh-travel endpoint', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ json: async () => ({ items: [item()] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ travelMeta: { status: 'ok', minutes: 12, failureReason: null } }) })
      .mockResolvedValueOnce({ json: async () => ({ items: [item()] }) });

    render(<ActivityTravelPanel />);
    await flush();

    fireEvent.click(screen.getByLabelText(/refresh travel estimate/i));
    await flush();

    const refreshCall = (global.fetch as jest.Mock).mock.calls.find(([url]) => String(url).includes('/refresh-travel'));
    expect(refreshCall).toBeDefined();
    expect(refreshCall![0]).toBe('/api/activity-matching/links/link-1/refresh-travel');
  });

  it('shows a success toast when the refreshed travel_meta status is ok', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ json: async () => ({ items: [item()] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ travelMeta: { status: 'ok', minutes: 12, failureReason: null } }) })
      .mockResolvedValueOnce({ json: async () => ({ items: [item()] }) });

    render(<ActivityTravelPanel />);
    await flush();
    fireEvent.click(screen.getByLabelText(/refresh travel estimate/i));
    await flush();

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Travel estimate refreshed' }));
  });

  it('shows a success toast when there is nothing to compute (null travelMeta, e.g. manual override)', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ json: async () => ({ items: [item()] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ travelMeta: null }) })
      .mockResolvedValueOnce({ json: async () => ({ items: [item()] }) });

    render(<ActivityTravelPanel />);
    await flush();
    fireEvent.click(screen.getByLabelText(/refresh travel estimate/i));
    await flush();

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Travel estimate refreshed' }));
  });

  it('never shows a success toast when the recomputed travel_meta status is unavailable — surfaces the real failure instead', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ json: async () => ({ items: [item()] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ travelMeta: { status: 'unavailable', minutes: null, failureReason: 'provider_error' } }),
      })
      .mockResolvedValueOnce({ json: async () => ({ items: [item()] }) });

    render(<ActivityTravelPanel />);
    await flush();
    fireEvent.click(screen.getByLabelText(/refresh travel estimate/i));
    await flush();

    expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Travel estimate refreshed' }));
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Travel estimate unavailable',
      variant: 'destructive',
    }));
  });

  it('describes an ambiguous destination address in human terms, not the raw failureReason code', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ json: async () => ({ items: [item()] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ travelMeta: { status: 'unavailable', minutes: null, failureReason: 'destination_ambiguous_address' } }),
      })
      .mockResolvedValueOnce({ json: async () => ({ items: [item()] }) });

    render(<ActivityTravelPanel />);
    await flush();
    fireEvent.click(screen.getByLabelText(/refresh travel estimate/i));
    await flush();

    const call = mockToast.mock.calls.find(([arg]) => arg.title === 'Travel estimate unavailable');
    expect(call?.[0].description).toMatch(/destination address is ambiguous/i);
    expect(call?.[0].description).not.toContain('destination_ambiguous_address');
  });

  it.each([
    ['departure_geocode_failed', /could not find the departure address/i],
    ['provider_timeout', /timed out/i],
    ['rate_limited', /too many requests/i],
    ['not_configured', /no routing provider/i],
  ])('describes failureReason %s in human terms, never the raw code', async (failureReason, expected) => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ json: async () => ({ items: [item()] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ travelMeta: { status: 'unavailable', minutes: null, failureReason } }) })
      .mockResolvedValueOnce({ json: async () => ({ items: [item()] }) });

    render(<ActivityTravelPanel />);
    await flush();
    fireEvent.click(screen.getByLabelText(/refresh travel estimate/i));
    await flush();

    const call = mockToast.mock.calls.find(([arg]) => arg.title === 'Travel estimate unavailable');
    expect(call?.[0].description).toMatch(expected);
    expect(call?.[0].description).not.toContain(failureReason);
  });

  it('describes failureReason implausible_distance in human terms — the exact HTTP 400 "route distance too large" case', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ json: async () => ({ items: [item()] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ travelMeta: { status: 'unavailable', minutes: null, failureReason: 'implausible_distance' } }) })
      .mockResolvedValueOnce({ json: async () => ({ items: [item()] }) });

    render(<ActivityTravelPanel />);
    await flush();
    fireEvent.click(screen.getByLabelText(/refresh travel estimate/i));
    await flush();

    const call = mockToast.mock.calls.find((c) => c[0].title === 'Travel estimate unavailable');
    expect(call?.[0].description).toMatch(/too far away/i);
    expect(call?.[0].description).not.toContain('implausible_distance');
  });
});

describe('ActivityTravelPanel — destination correction (requirement 6: select and save a destination from geocode suggestions)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ legacyFakeTimers: false });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows a search box for the destination when no pin is set', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ json: async () => ({ items: [item()] }) });
    render(<ActivityTravelPanel />);
    await flush();
    expect(screen.getByPlaceholderText(/fix destination/i)).not.toBeNull();
  });

  it('shows the pinned address with a clear control when a destination pin is set, not the search box', async () => {
    const pin = { address: 'All Around Athletics Centre, 91 Sandford Fleming Dr', lat: 40.1, lon: -75.1 };
    (global.fetch as jest.Mock).mockResolvedValueOnce({ json: async () => ({ items: [item({ destinationOverrideCoords: pin })] }) });
    render(<ActivityTravelPanel />);
    await flush();
    expect(screen.getByText(pin.address)).not.toBeNull();
    expect(screen.queryByPlaceholderText(/fix destination/i)).toBeNull();
    expect(screen.getByLabelText(/clear pinned destination/i)).not.toBeNull();
  });

  it('searches via /api/travel/geocode and saves exactly the selected candidate to the destination endpoint', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ json: async () => ({ items: [item()] }) }) // initial load
      .mockResolvedValueOnce({
        json: async () => ({
          results: [{ placeId: 1, displayName: 'All Around', fullName: 'All Around Athletics Centre, 91 Sandford Fleming Dr', latitude: 40.1, longitude: -75.1 }],
        }),
      }); // geocode search

    render(<ActivityTravelPanel />);
    await flush();

    fireEvent.change(screen.getByPlaceholderText(/fix destination/i), { target: { value: 'All Around' } });
    await act(async () => { jest.advanceTimersByTime(400); });
    await flush();

    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/travel/geocode?q='));

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ destination: { address: 'x', lat: 40.1, lon: -75.1 }, travelMeta: null }) })
      .mockResolvedValueOnce({ json: async () => ({ items: [item()] }) }); // reload after save

    fireEvent.click(screen.getByText('All Around Athletics Centre, 91 Sandford Fleming Dr'));
    await flush();

    const saveCall = (global.fetch as jest.Mock).mock.calls.find(([url]) => String(url) === '/api/activity-matching/links/link-1/destination');
    expect(saveCall).toBeDefined();
    const [, init] = saveCall!;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      destination: { address: 'All Around Athletics Centre, 91 Sandford Fleming Dr', lat: 40.1, lon: -75.1 },
    });
  });

  it('clears the pin via the destination endpoint with destination: null, never touching the Home address endpoint', async () => {
    const pin = { address: 'Pinned Place', lat: 40.1, lon: -75.1 };
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ json: async () => ({ items: [item({ destinationOverrideCoords: pin })] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ destination: null, travelMeta: null }) })
      .mockResolvedValueOnce({ json: async () => ({ items: [item()] }) });

    render(<ActivityTravelPanel />);
    await flush();

    fireEvent.click(screen.getByLabelText(/clear pinned destination/i));
    await flush();

    const clearCall = (global.fetch as jest.Mock).mock.calls.find(([url]) => String(url) === '/api/activity-matching/links/link-1/destination');
    expect(clearCall).toBeDefined();
    const [, init] = clearCall!;
    expect(JSON.parse(init.body)).toEqual({ destination: null });
    expect((global.fetch as jest.Mock).mock.calls.some(([u]) => String(u).includes('homeAddress'))).toBe(false);
  });
});
