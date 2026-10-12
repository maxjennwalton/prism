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
  activityVenues: {
    id: 'id',
    normalizedName: 'normalizedName',
    displayName: 'displayName',
    aliases: 'aliases',
    formattedAddress: 'formattedAddress',
    latitude: 'latitude',
    longitude: 'longitude',
    source: 'source',
    verified: 'verified',
  },
}));

jest.mock('drizzle-orm', () => ({ eq: (...a: unknown[]) => ({ op: 'eq', a }) }));

const mockGeocodeAddress = jest.fn();
jest.mock('@/lib/integrations/geocode', () => ({ geocodeAddress: (...a: unknown[]) => mockGeocodeAddress(...a) }));

import { findVenueByName, resolveVenueDestination, upsertVenue } from '../activityVenues';

function dbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'venue-1',
    normalizedName: 'eddie bush arena',
    displayName: 'Eddie Bush Arena',
    aliases: [],
    formattedAddress: '100 First St, Midland, ON',
    latitude: '44.750000',
    longitude: '-79.880000',
    source: 'nominatim',
    verified: false,
    ...overrides,
  };
}

/** `.select().from(table).where(...)` — awaited after a .where() call. */
function selectWhere(rows: unknown[]) {
  return { from: () => ({ where: () => Promise.resolve(rows) }) };
}

/** `.select().from(table)` alone — awaited directly, no .where(). */
function selectAll(rows: unknown[]) {
  return { from: () => Promise.resolve(rows) };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('findVenueByName', () => {
  it('returns null when no row matches by name or alias', async () => {
    mockSelect.mockReturnValueOnce(selectWhere([]));
    mockSelect.mockReturnValueOnce(selectAll([]));
    expect(await findVenueByName('Unknown Rink', undefined)).toBeNull();
  });

  it('matches on exact normalized name with no network call needed', async () => {
    mockSelect.mockReturnValueOnce(selectWhere([dbRow()]));
    const result = await findVenueByName('Eddie Bush Arena', undefined);
    expect(result).toMatchObject({ id: 'venue-1', displayName: 'Eddie Bush Arena', lat: 44.75, lon: -79.88 });
  });

  it('falls back to scanning aliases when no exact normalized-name match exists', async () => {
    mockSelect.mockReturnValueOnce(selectWhere([]));
    mockSelect.mockReturnValueOnce(selectAll([dbRow({ normalizedName: 'eddie bush memorial arena', aliases: ['Eddie Bush Arena'] })]));
    const result = await findVenueByName('Eddie Bush Arena', undefined);
    expect(result?.id).toBe('venue-1');
  });

  it('disambiguates same-named venues in different towns by proximity to bias', async () => {
    const near = dbRow({ id: 'near', latitude: '44.500000', longitude: '-80.200000' });
    const far = dbRow({ id: 'far', latitude: '51.500000', longitude: '-0.100000' });
    mockSelect.mockReturnValueOnce(selectWhere([far, near]));
    const result = await findVenueByName('Community Arena', { lat: 44.5, lon: -80.2 });
    expect(result?.id).toBe('near');
  });

  it('returns the first match without a bias rather than guessing which town', async () => {
    const a = dbRow({ id: 'a' });
    const b = dbRow({ id: 'b', latitude: '51.0', longitude: '0.0' });
    mockSelect.mockReturnValueOnce(selectWhere([a, b]));
    const result = await findVenueByName('Community Arena', undefined);
    expect(result?.id).toBe('a');
  });
});

describe('upsertVenue', () => {
  it('inserts a new venue row when nothing matches, recording the raw text as an alias', async () => {
    mockSelect.mockReturnValueOnce(selectWhere([]));
    const values = jest.fn().mockReturnValue({ returning: () => [dbRow({ aliases: ['Eddie Bush Arena - 100 First St'] })] });
    mockInsert.mockReturnValue({ values });

    await upsertVenue({
      venueName: 'Eddie Bush Arena',
      alias: 'Eddie Bush Arena - 100 First St',
      formattedAddress: '100 First St, Midland, ON',
      lat: 44.75,
      lon: -79.88,
      source: 'nominatim',
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedName: 'eddie bush arena',
        displayName: 'Eddie Bush Arena',
        aliases: ['Eddie Bush Arena - 100 First St'],
        source: 'nominatim',
        verified: false,
      }),
    );
  });

  it('does not record an alias identical to the venue name itself', async () => {
    mockSelect.mockReturnValueOnce(selectWhere([]));
    const values = jest.fn().mockReturnValue({ returning: () => [dbRow()] });
    mockInsert.mockReturnValue({ values });

    await upsertVenue({
      venueName: 'Eddie Bush Arena',
      alias: 'Eddie Bush Arena',
      formattedAddress: null,
      lat: 44.75,
      lon: -79.88,
      source: 'nominatim',
    });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ aliases: [] }));
  });

  it('folds a new match into an existing row at the same physical location, appending the alias', async () => {
    const existing = dbRow({ aliases: ['Eddie Bush Memorial Arena'] });
    mockSelect.mockReturnValueOnce(selectWhere([existing]));
    const set = jest.fn().mockReturnValue({ where: () => Promise.resolve() });
    mockUpdate.mockReturnValue({ set });

    await upsertVenue({
      venueName: 'Eddie Bush Arena',
      alias: 'Eddie Bush Arena Rink 1',
      formattedAddress: '100 First St, Midland, ON',
      lat: 44.750001,
      lon: -79.880001,
      source: 'nominatim',
    });

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ aliases: ['Eddie Bush Memorial Arena', 'Eddie Bush Arena Rink 1'] }),
    );
  });

  it('never downgrades an already-verified row back to an unverified nominatim match', async () => {
    const existing = dbRow({ verified: true, source: 'parent_confirmed', latitude: '44.750000', longitude: '-79.880000' });
    mockSelect.mockReturnValueOnce(selectWhere([existing]));
    const set = jest.fn().mockReturnValue({ where: () => Promise.resolve() });
    mockUpdate.mockReturnValue({ set });

    await upsertVenue({
      venueName: 'Eddie Bush Arena',
      formattedAddress: 'some other nominatim text',
      lat: 44.7505,
      lon: -79.8805,
      source: 'nominatim',
    });

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'parent_confirmed', verified: true, latitude: '44.75', longitude: '-79.88' }),
    );
  });

  it('upgrades an existing nominatim row to parent_confirmed, overwriting its coordinates', async () => {
    const existing = dbRow({ verified: false, source: 'nominatim' });
    mockSelect.mockReturnValueOnce(selectWhere([existing]));
    const set = jest.fn().mockReturnValue({ where: () => Promise.resolve() });
    mockUpdate.mockReturnValue({ set });

    await upsertVenue({
      venueName: 'Eddie Bush Arena',
      formattedAddress: '100 First St, Midland, ON, Canada',
      lat: 44.751,
      lon: -79.881,
      source: 'parent_confirmed',
      verified: true,
    });

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'parent_confirmed', verified: true, latitude: '44.751', longitude: '-79.881' }),
    );
  });

  it('creates a separate row for a same-named venue far away rather than merging into an unrelated one', async () => {
    const distantSameNameVenue = dbRow({ latitude: '51.000000', longitude: '0.000000' });
    mockSelect.mockReturnValueOnce(selectWhere([distantSameNameVenue]));
    const values = jest.fn().mockReturnValue({ returning: () => [dbRow({ id: 'venue-2' })] });
    mockInsert.mockReturnValue({ values });

    await upsertVenue({
      venueName: 'Eddie Bush Arena',
      formattedAddress: null,
      lat: 44.75,
      lon: -79.88,
      source: 'nominatim',
    });

    expect(mockInsert).toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('resolveVenueDestination', () => {
  it('resolves instantly from a saved venue with no geocoding call at all', async () => {
    mockSelect.mockReturnValueOnce(selectWhere([dbRow()]));

    const result = await resolveVenueDestination('Eddie Bush Arena', undefined);

    expect(result).toEqual({
      ok: true,
      venueId: 'venue-1',
      location: { address: '100 First St, Midland, ON', lat: 44.75, lon: -79.88 },
    });
    expect(mockGeocodeAddress).not.toHaveBeenCalled();
  });

  it('falls through progressive search stages and saves the confident match as a new venue', async () => {
    // no saved venue (exact name, then alias-scan fallback)
    mockSelect.mockReturnValueOnce(selectWhere([]));
    mockSelect.mockReturnValueOnce(selectAll([]));
    // stage 1 (street+city) — ambiguous: two close-importance candidates
    mockGeocodeAddress.mockResolvedValueOnce([
      { placeId: 1, displayName: 'A', fullName: 'A', latitude: 1, longitude: 1, importance: 0.2 },
      { placeId: 2, displayName: 'B', fullName: 'B', latitude: 2, longitude: 2, importance: 0.19 },
    ]);
    // stage 2 (street alone) — no results
    mockGeocodeAddress.mockResolvedValueOnce([]);
    // stage 3 (venue+city) — single confident candidate
    mockGeocodeAddress.mockResolvedValueOnce([
      { placeId: 3, displayName: 'Eddie Bush Arena', fullName: 'Eddie Bush Arena, Midland, ON, Canada', latitude: 44.75, longitude: -79.88, importance: 0.05 },
    ]);
    // upsertVenue's own lookup (no existing match) + insert
    mockSelect.mockReturnValueOnce(selectWhere([]));
    const values = jest.fn().mockReturnValue({ returning: () => [dbRow({ id: 'venue-new' })] });
    mockInsert.mockReturnValue({ values });

    const result = await resolveVenueDestination('Eddie Bush Arena - 100 First St, Midland ON', undefined);

    expect(result).toEqual({
      ok: true,
      venueId: 'venue-new',
      location: { address: 'Eddie Bush Arena, Midland ON', lat: 44.75, lon: -79.88 },
    });
    expect(mockInsert).toHaveBeenCalled();
  });

  it('reports geocode_failed when every progressive-search stage returns zero candidates', async () => {
    mockSelect.mockReturnValueOnce(selectWhere([]));
    mockSelect.mockReturnValueOnce(selectAll([]));
    mockGeocodeAddress.mockResolvedValue([]);

    const result = await resolveVenueDestination('Totally Unknown Place', undefined);
    expect(result).toEqual({ ok: false, failureReason: 'geocode_failed' });
  });

  it('reports ambiguous_address when candidates exist but none can be confidently accepted', async () => {
    mockSelect.mockReturnValueOnce(selectWhere([]));
    mockSelect.mockReturnValueOnce(selectAll([]));
    mockGeocodeAddress.mockResolvedValue([
      { placeId: 1, displayName: 'A', fullName: 'A', latitude: 1, longitude: 1, importance: 0.1 },
      { placeId: 2, displayName: 'B', fullName: 'B', latitude: 1.0001, longitude: 1.0001, importance: 0.09 },
    ]);

    const result = await resolveVenueDestination('Ambiguous Rink', undefined);
    expect(result).toEqual({ ok: false, failureReason: 'ambiguous_address' });
  });

  it('never saves a venue-directory row for a pure street address with no venue name', async () => {
    mockGeocodeAddress.mockResolvedValueOnce([
      { placeId: 1, displayName: 'Addr', fullName: '123 Main Street, Collingwood, ON', latitude: 44.5, longitude: -80.2, importance: 0.3 },
    ]);

    const result = await resolveVenueDestination('123 Main Street, Collingwood ON', undefined);

    expect(result.ok).toBe(true);
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
