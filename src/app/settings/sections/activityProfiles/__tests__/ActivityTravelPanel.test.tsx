/**
 * @jest-environment jsdom
 */
import * as React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ActivityTravelPanel } from '../ActivityTravelPanel';

jest.mock('@/components/ui/use-toast', () => ({ toast: jest.fn() }));

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
    travelMinutesOverride: null,
    travelSource: 'profile_fallback',
    travelMinutes: 20,
    ...overrides,
  };
}

beforeEach(() => {
  global.fetch = jest.fn();
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
      .mockResolvedValueOnce({ ok: true, json: async () => ({ travelMeta: null }) })
      .mockResolvedValueOnce({ json: async () => ({ items: [item()] }) });

    render(<ActivityTravelPanel />);
    await flush();

    fireEvent.click(screen.getByLabelText(/refresh travel estimate/i));
    await flush();

    const refreshCall = (global.fetch as jest.Mock).mock.calls.find(([url]) => String(url).includes('/refresh-travel'));
    expect(refreshCall).toBeDefined();
    expect(refreshCall![0]).toBe('/api/activity-matching/links/link-1/refresh-travel');
  });
});
