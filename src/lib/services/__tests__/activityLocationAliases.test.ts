/**
 * @jest-environment node
 */
const mockSelect = jest.fn();
const mockInsert = jest.fn();
const mockUpdate = jest.fn();

jest.mock('@/lib/db/client', () => ({
  db: {
    select: (...a: unknown[]) => mockSelect(...a),
    insert: (...a: unknown[]) => mockInsert(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
  },
}));

jest.mock('@/lib/db/schema', () => ({
  activityEventLinks: { id: 'id', eventId: 'eventId', destinationOverrideCoords: 'destinationOverrideCoords', matchStatus: 'matchStatus' },
  activityLocationAliases: { id: 'id', normalizedLocation: 'normalizedLocation', venueId: 'venueId' },
  activityVenues: { id: 'id', formattedAddress: 'formattedAddress', displayName: 'displayName', latitude: 'latitude', longitude: 'longitude' },
  events: { id: 'id', location: 'location' },
}));

jest.mock('drizzle-orm', () => ({
  eq: (...a: unknown[]) => ({ op: 'eq', a }),
  and: (...a: unknown[]) => ({ op: 'and', a }),
  ne: (...a: unknown[]) => ({ op: 'ne', a }),
}));

import {
  confirmLocationAlias,
  findLocationAlias,
  findMatchingLinkIds,
  getLinkOriginalLocation,
  normalizeLocationText,
} from '../activityLocationAliases';

/** `.select(...).from(table).innerJoin(...).where(...)` */
function selectJoinWhere(rows: unknown[]) {
  return { from: () => ({ innerJoin: () => ({ where: () => Promise.resolve(rows) }) }) };
}

/** `.select(...).from(table).where(...)` — no join. */
function selectWhere(rows: unknown[]) {
  return { from: () => ({ where: () => Promise.resolve(rows) }) };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('normalizeLocationText', () => {
  it('lowercases, trims, and collapses internal whitespace', () => {
    expect(normalizeLocationText('  Wasaga  ')).toBe('wasaga');
    expect(normalizeLocationText('Eddie   Bush\tArena')).toBe('eddie bush arena');
  });

  it('produces the same key for superficially different casing/whitespace', () => {
    expect(normalizeLocationText('WASAGA')).toBe(normalizeLocationText('wasaga'));
  });
});

describe('findLocationAlias', () => {
  it('returns null when no confirmed alias exists for this exact text', async () => {
    mockSelect.mockReturnValueOnce(selectJoinWhere([]));
    expect(await findLocationAlias('Wasaga')).toBeNull();
  });

  it('resolves to the aliased venue, preferring formattedAddress over displayName', async () => {
    mockSelect.mockReturnValueOnce(selectJoinWhere([
      { venueId: 'venue-1', formattedAddress: 'Wasaga Beach Arena, Wasaga Beach, ON', displayName: 'Wasaga Beach Arena', latitude: '44.520000', longitude: '-80.020000' },
    ]));
    const result = await findLocationAlias('Wasaga');
    expect(result).toEqual({ venueId: 'venue-1', address: 'Wasaga Beach Arena, Wasaga Beach, ON', lat: 44.52, lon: -80.02 });
  });

  it('falls back to displayName when formattedAddress is null', async () => {
    mockSelect.mockReturnValueOnce(selectJoinWhere([
      { venueId: 'venue-1', formattedAddress: null, displayName: 'Wasaga Beach Arena', latitude: '44.52', longitude: '-80.02' },
    ]));
    const result = await findLocationAlias('Wasaga');
    expect(result?.address).toBe('Wasaga Beach Arena');
  });

  it('is case/whitespace insensitive, matching the normalized form', async () => {
    mockSelect.mockReturnValueOnce(selectJoinWhere([
      { venueId: 'venue-1', formattedAddress: 'x', displayName: 'x', latitude: '1', longitude: '2' },
    ]));
    const result = await findLocationAlias('  WASAGA  ');
    expect(result).not.toBeNull();
  });
});

describe('getLinkOriginalLocation', () => {
  it('returns the raw event.location text behind a link', async () => {
    mockSelect.mockReturnValueOnce(selectJoinWhere([{ eventLocation: 'Wasaga' }]));
    expect(await getLinkOriginalLocation('link-1')).toBe('Wasaga');
  });

  it('returns null when the link does not exist', async () => {
    mockSelect.mockReturnValueOnce(selectJoinWhere([]));
    expect(await getLinkOriginalLocation('missing-link')).toBeNull();
  });
});

describe('findMatchingLinkIds', () => {
  function row(overrides: Record<string, unknown> = {}) {
    return { linkId: 'link-x', eventLocation: 'Wasaga', destinationOverrideCoords: null, matchStatus: 'confirmed', ...overrides };
  }

  it('matches other links with the exact same normalized location text', async () => {
    mockSelect.mockReturnValueOnce(selectJoinWhere([
      row({ linkId: 'link-2', eventLocation: 'Wasaga' }),
      row({ linkId: 'link-3', eventLocation: '  WASAGA  ' }),
      row({ linkId: 'link-4', eventLocation: 'Somewhere Else' }),
    ]));
    const ids = await findMatchingLinkIds('Wasaga', 'link-1');
    expect(ids.sort()).toEqual(['link-2', 'link-3']);
  });

  it('never includes a link that already has its own destination pin (preserve event-specific corrections)', async () => {
    mockSelect.mockReturnValueOnce(selectJoinWhere([
      row({ linkId: 'link-2', destinationOverrideCoords: { address: 'Pinned', lat: 1, lon: 2 } }),
    ]));
    const ids = await findMatchingLinkIds('Wasaga', 'link-1');
    expect(ids).toEqual([]);
  });

  it('never includes a link whose own location text is null', async () => {
    mockSelect.mockReturnValueOnce(selectJoinWhere([row({ eventLocation: null })]));
    const ids = await findMatchingLinkIds('Wasaga', 'link-1');
    expect(ids).toEqual([]);
  });

  it('returns [] when nothing else matches', async () => {
    mockSelect.mockReturnValueOnce(selectJoinWhere([row({ eventLocation: 'Totally Different' })]));
    const ids = await findMatchingLinkIds('Wasaga', 'link-1');
    expect(ids).toEqual([]);
  });
});

describe('confirmLocationAlias', () => {
  it('inserts a new alias row when none exists yet for this text', async () => {
    mockSelect.mockReturnValueOnce(selectWhere([]));
    const values = jest.fn().mockReturnValue({ returning: () => [{ id: 'alias-1' }] });
    mockInsert.mockReturnValue({ values });

    const result = await confirmLocationAlias('Wasaga', 'venue-1');

    expect(result).toEqual({ ok: true, aliasId: 'alias-1' });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ normalizedLocation: 'wasaga', venueId: 'venue-1' }));
  });

  it('updates the existing row in place when it already points at the same venue (idempotent re-confirm)', async () => {
    mockSelect.mockReturnValueOnce(selectWhere([{ id: 'alias-1', normalizedLocation: 'wasaga', venueId: 'venue-1' }]));
    const set = jest.fn().mockReturnValue({ where: () => Promise.resolve() });
    mockUpdate.mockReturnValue({ set });

    const result = await confirmLocationAlias('Wasaga', 'venue-1');

    expect(result).toEqual({ ok: true, aliasId: 'alias-1' });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('refuses to silently remap an existing alias to a different venue, reporting the conflict', async () => {
    mockSelect.mockReturnValueOnce(selectWhere([{ id: 'alias-1', normalizedLocation: 'wasaga', venueId: 'venue-OLD' }]));
    mockSelect.mockReturnValueOnce(selectWhere([{ id: 'venue-OLD', formattedAddress: 'Wasaga Sands Arena, Wasaga Beach, ON', displayName: 'Wasaga Sands Arena' }]));

    const result = await confirmLocationAlias('Wasaga', 'venue-NEW');

    expect(result).toEqual({
      ok: false,
      reason: 'conflict',
      existingVenueId: 'venue-OLD',
      existingAddress: 'Wasaga Sands Arena, Wasaga Beach, ON',
    });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('overwrites a conflicting alias when overwriteConflict is explicitly set', async () => {
    mockSelect.mockReturnValueOnce(selectWhere([{ id: 'alias-1', normalizedLocation: 'wasaga', venueId: 'venue-OLD' }]));
    const set = jest.fn().mockReturnValue({ where: () => Promise.resolve() });
    mockUpdate.mockReturnValue({ set });

    const result = await confirmLocationAlias('Wasaga', 'venue-NEW', { overwriteConflict: true });

    expect(result).toEqual({ ok: true, aliasId: 'alias-1' });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ venueId: 'venue-NEW' }));
  });
});
