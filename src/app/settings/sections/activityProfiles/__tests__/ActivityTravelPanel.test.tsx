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
    profileName: null,
    destination: 'Community Rink',
    departureLocationOverride: null,
    destinationOverrideCoords: null,
    travelMinutesOverride: null,
    travelSource: 'profile_fallback',
    travelMinutes: 20,
    travelMeta: null,
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

  it('shows "{Activity Profile name} — {member}" as the primary title when a profile is matched, with the raw calendar title as secondary text and a tooltip', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      json: async () => ({ items: [item({ profileName: 'Soccer Game', eventTitle: 'U10 Soccer @ All Around Athletics' })] }),
    });
    render(<ActivityTravelPanel />);
    await flush();

    const title = screen.getByText('Soccer Game — Beckham');
    expect(title).not.toBeNull();
    expect(title.getAttribute('title')).toBe('U10 Soccer @ All Around Athletics');
    expect(screen.getByText('U10 Soccer @ All Around Athletics')).not.toBeNull();
  });

  it('falls back to the raw calendar event title alone when no Activity Profile is matched', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      json: async () => ({ items: [item({ profileName: null, eventTitle: 'Unmatched Event' })] }),
    });
    render(<ActivityTravelPanel />);
    await flush();
    expect(screen.getByText('Unmatched Event — Beckham')).not.toBeNull();
    // Not duplicated as secondary text when it's already the primary title.
    expect(screen.getAllByText('Unmatched Event', { exact: false }).length).toBe(1);
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

describe('ActivityTravelPanel — inline failure diagnostics (requirement: distinguish address lookup failure, ambiguous results, and routing failure without needing a manual refresh)', () => {
  it('shows a human-readable address-lookup-failure reason inline next to Profile fallback, matching the "Osprey Community Arena" example', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      json: async () => ({
        items: [item({
          destination: 'Osprey Community Arena',
          travelSource: 'profile_fallback',
          travelMinutes: 15,
          travelMeta: { status: 'unavailable', failureReason: 'destination_geocode_failed' },
        })],
      }),
    });
    render(<ActivityTravelPanel />);
    await flush();

    expect(screen.getByText(/15 min · Profile fallback/)).not.toBeNull();
    expect(screen.getByText(/Could not find the destination address/i)).not.toBeNull();
  });

  it('distinguishes an ambiguous-results failure from an address-lookup failure inline', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      json: async () => ({
        items: [item({ travelMeta: { status: 'unavailable', failureReason: 'destination_ambiguous_address' } })],
      }),
    });
    render(<ActivityTravelPanel />);
    await flush();
    expect(screen.getByText(/destination address is ambiguous/i)).not.toBeNull();
  });

  it('distinguishes a routing-provider failure from either address-side failure inline', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      json: async () => ({
        items: [item({ travelMeta: { status: 'unavailable', failureReason: 'provider_timeout' } })],
      }),
    });
    render(<ActivityTravelPanel />);
    await flush();
    expect(screen.getByText(/routing service timed out/i)).not.toBeNull();
  });

  it('shows no inline diagnostic at all when the last attempt succeeded', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      json: async () => ({
        items: [item({ travelSource: 'calculated', travelMeta: { status: 'ok', failureReason: null } })],
      }),
    });
    render(<ActivityTravelPanel />);
    await flush();
    expect(screen.queryByText(/could not find|ambiguous|timed out|too far away/i)).toBeNull();
  });

  it('shows no inline diagnostic when there has never been an attempt at all (travelMeta null)', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      json: async () => ({ items: [item({ travelMeta: null })] }),
    });
    render(<ActivityTravelPanel />);
    await flush();
    expect(screen.queryByText(/could not find|ambiguous|timed out|too far away/i)).toBeNull();
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

  it('pre-fills the search box with the venue name parsed from the unresolved destination text (requirement 9: Fix Destination)', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      json: async () => ({ items: [item({ destination: 'Eddie Bush Arena - 100 First St, Midland ON' })] }),
    });
    render(<ActivityTravelPanel />);
    await flush();
    expect((screen.getByPlaceholderText(/fix destination/i) as HTMLInputElement).value).toBe('Eddie Bush Arena');
  });

  it('leaves the search box empty when the destination has no parseable venue name', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      json: async () => ({ items: [item({ destination: '123 Main Street, Collingwood ON' })] }),
    });
    render(<ActivityTravelPanel />);
    await flush();
    expect((screen.getByPlaceholderText(/fix destination/i) as HTMLInputElement).value).toBe('');
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

const GEOCODE_RESULT = { placeId: 1, displayName: 'All Around', fullName: 'All Around Athletics Centre, 91 Sandford Fleming Dr', latitude: 40.1, longitude: -75.1 };

describe('ActivityTravelPanel — dropdown UX (requirement 4: closing, positioning, keyboard, mobile)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ legacyFakeTimers: false });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function openResults(itemOverrides: Partial<Record<string, unknown>> = {}) {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ json: async () => ({ items: [item(itemOverrides)] }) });
    render(<ActivityTravelPanel />);
    await flush();

    fireEvent.change(screen.getByPlaceholderText(/fix destination/i), { target: { value: 'All Around' } });
    (global.fetch as jest.Mock).mockResolvedValueOnce({ json: async () => ({ results: [GEOCODE_RESULT] }) });
    await act(async () => { jest.advanceTimersByTime(400); });
    await flush();
  }

  it('closes the dropdown immediately after selecting a result, before the save request even resolves', async () => {
    await openResults();
    expect(screen.getByText(GEOCODE_RESULT.fullName)).not.toBeNull();

    // Never resolves during this test — proves the dropdown closes
    // synchronously on click, not as a side effect of the save finishing.
    (global.fetch as jest.Mock).mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByText(GEOCODE_RESULT.fullName));

    expect(screen.queryByText(GEOCODE_RESULT.fullName)).toBeNull();
  });

  it('closes the dropdown on a click outside the search field', async () => {
    await openResults();
    expect(screen.getByText(GEOCODE_RESULT.fullName)).not.toBeNull();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByText(GEOCODE_RESULT.fullName)).toBeNull();
  });

  it('never closes the dropdown when clicking inside the search input itself', async () => {
    await openResults();
    fireEvent.pointerDown(screen.getByPlaceholderText(/fix destination/i));
    expect(screen.getByText(GEOCODE_RESULT.fullName)).not.toBeNull();
  });

  it('closes the dropdown on Escape', async () => {
    await openResults();
    expect(screen.getByText(GEOCODE_RESULT.fullName)).not.toBeNull();

    fireEvent.keyDown(screen.getByPlaceholderText(/fix destination/i), { key: 'Escape' });

    expect(screen.queryByText(GEOCODE_RESULT.fullName)).toBeNull();
  });

  it('clears a previous activity\'s open dropdown when the parent interacts with a different activity\'s search field', async () => {
    // item-2's destination has no parseable venue name (a bare street
    // address), so its search box pre-fills empty and never auto-searches
    // on mount — isolating this test to item-1's own dropdown behavior.
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      json: async () => ({
        items: [
          item({ linkId: 'link-1', eventTitle: 'Hockey' }),
          item({ linkId: 'link-2', eventTitle: 'Soccer', destination: '123 Main Street, Collingwood ON' }),
        ],
      }),
    });
    render(<ActivityTravelPanel />);
    await flush();

    const [firstInput, secondInput] = screen.getAllByPlaceholderText(/fix destination/i);
    fireEvent.change(firstInput!, { target: { value: 'All Around' } });
    (global.fetch as jest.Mock).mockResolvedValueOnce({ json: async () => ({ results: [GEOCODE_RESULT] }) });
    await act(async () => { jest.advanceTimersByTime(400); });
    await flush();
    expect(screen.getByText(GEOCODE_RESULT.fullName)).not.toBeNull();

    fireEvent.pointerDown(secondInput!);

    expect(screen.queryByText(GEOCODE_RESULT.fullName)).toBeNull();
  });

  it('navigates results with ArrowDown/ArrowUp and selects the highlighted one with Enter', async () => {
    const second = { placeId: 2, displayName: 'Second', fullName: 'Second Place, ON', latitude: 1, longitude: 2 };
    (global.fetch as jest.Mock).mockResolvedValueOnce({ json: async () => ({ items: [item()] }) });
    render(<ActivityTravelPanel />);
    await flush();

    const input = screen.getByPlaceholderText(/fix destination/i);
    fireEvent.change(input, { target: { value: 'Place' } });
    (global.fetch as jest.Mock).mockResolvedValueOnce({ json: async () => ({ results: [GEOCODE_RESULT, second] }) });
    await act(async () => { jest.advanceTimersByTime(400); });
    await flush();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ destination: second, travelMeta: null, venueId: null, matchingEventCount: 0 }) })
      .mockResolvedValueOnce({ json: async () => ({ items: [item()] }) });

    fireEvent.keyDown(input, { key: 'Enter' });
    await flush();

    const saveCall = (global.fetch as jest.Mock).mock.calls.find(([url]) => String(url) === '/api/activity-matching/links/link-1/destination');
    expect(JSON.parse(saveCall![1].body)).toEqual({ destination: { address: second.fullName, lat: second.latitude, lon: second.longitude } });
  });

  it('exposes combobox/listbox ARIA roles for keyboard and screen-reader navigation', async () => {
    await openResults();
    const input = screen.getByPlaceholderText(/fix destination/i);
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('listbox')).not.toBeNull();
    expect(screen.getByRole('option', { name: GEOCODE_RESULT.fullName })).not.toBeNull();
  });

  it('shows a "Change" action alongside the pinned venue, which reopens the search box without clearing the pin', async () => {
    const pin = { address: 'All Around Athletics Centre, 91 Sandford Fleming Dr', lat: 40.1, lon: -75.1 };
    (global.fetch as jest.Mock).mockResolvedValueOnce({ json: async () => ({ items: [item({ destinationOverrideCoords: pin })] }) });
    render(<ActivityTravelPanel />);
    await flush();

    fireEvent.click(screen.getByLabelText(/change destination/i));

    expect(screen.getByPlaceholderText(/fix destination/i)).not.toBeNull();
    expect(screen.queryByText(pin.address)).toBeNull();
  });

  it('cancelling a "Change" in progress restores the pinned venue display without saving anything', async () => {
    const pin = { address: 'All Around Athletics Centre, 91 Sandford Fleming Dr', lat: 40.1, lon: -75.1 };
    (global.fetch as jest.Mock).mockResolvedValueOnce({ json: async () => ({ items: [item({ destinationOverrideCoords: pin })] }) });
    render(<ActivityTravelPanel />);
    await flush();

    fireEvent.click(screen.getByLabelText(/change destination/i));
    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.getByText(pin.address)).not.toBeNull();
    expect(screen.queryByPlaceholderText(/fix destination/i)).toBeNull();
    const saveCall = (global.fetch as jest.Mock).mock.calls.find(([url]) => String(url) === '/api/activity-matching/links/link-1/destination');
    expect(saveCall).toBeUndefined();
  });
});

describe('ActivityTravelPanel — reusing a correction across matching activities (requirement 1/5)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ legacyFakeTimers: false });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function saveDestinationWithMatches(matchingEventCount: number) {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ json: async () => ({ items: [item()] }) });
    render(<ActivityTravelPanel />);
    await flush();

    fireEvent.change(screen.getByPlaceholderText(/fix destination/i), { target: { value: 'Wasaga' } });
    (global.fetch as jest.Mock).mockResolvedValueOnce({ json: async () => ({ results: [GEOCODE_RESULT] }) });
    await act(async () => { jest.advanceTimersByTime(400); });
    await flush();

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ destination: GEOCODE_RESULT, travelMeta: null, venueId: 'venue-wasaga', matchingEventCount }),
      })
      .mockResolvedValueOnce({ json: async () => ({ items: [item({ destinationOverrideCoords: GEOCODE_RESULT })] }) });

    fireEvent.click(screen.getByText(GEOCODE_RESULT.fullName));
    await flush();
  }

  it('shows the matching-event count before applying anything broadly, with no apply-to-matching call yet', async () => {
    await saveDestinationWithMatches(4);
    expect(screen.getByText(/4 matching activities also use this exact location text/i)).not.toBeNull();
    expect((global.fetch as jest.Mock).mock.calls.some(([u]) => String(u).includes('apply-to-matching'))).toBe(false);
  });

  it('shows no broad-apply prompt at all when nothing else matches', async () => {
    await saveDestinationWithMatches(0);
    expect(screen.queryByText(/matching activit/i)).toBeNull();
  });

  it('singularizes the count for exactly one other matching event', async () => {
    await saveDestinationWithMatches(1);
    expect(screen.getByText(/1 matching activity also use this exact location text/i)).not.toBeNull();
  });

  it('applies the correction to matching activities on confirm and shows "Venue saved. Updated N matching activities."', async () => {
    await saveDestinationWithMatches(4);

    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ updatedCount: 4 }) });
    (global.fetch as jest.Mock).mockResolvedValueOnce({ json: async () => ({ items: [item({ destinationOverrideCoords: GEOCODE_RESULT })] }) });

    fireEvent.click(screen.getByText(/apply to 4 matching activities/i));
    await flush();

    const applyCall = (global.fetch as jest.Mock).mock.calls.find(([url]) => String(url) === '/api/activity-matching/links/link-1/destination/apply-to-matching');
    expect(applyCall).toBeDefined();
    expect(JSON.parse(applyCall![1].body)).toEqual({ venueId: 'venue-wasaga' });
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Venue saved. Updated 4 matching activities.' }));
    expect(screen.queryByText(/matching activit/i)).toBeNull();
  });

  it('dismisses the prompt with "Just this one" and never calls apply-to-matching', async () => {
    await saveDestinationWithMatches(4);

    fireEvent.click(screen.getByText('Just this one'));

    expect(screen.queryByText(/matching activit/i)).toBeNull();
    expect((global.fetch as jest.Mock).mock.calls.some(([u]) => String(u).includes('apply-to-matching'))).toBe(false);
  });
});
