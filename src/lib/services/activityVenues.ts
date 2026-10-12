/**
 * Phase 4B (Automatic Travel) — shared venue directory + progressive
 * destination search. This is the piece that actually resolves a messy
 * calendar `location` string ("Eddie Bush Arena - 100 First St, Midland
 * ON") into coordinates without a parent ever pasting a Google Maps
 * address, per the venue-directory/progressive-search requirements.
 *
 * Progressive search order, each stage only tried if the previous one
 * didn't produce a confident match (see evaluateVenueCandidates):
 *   1. A saved venue (src/lib/db/schema.ts activity_venues) matching the
 *      parsed venue name — zero network calls, the whole point of the
 *      directory.
 *   2. Exact street address + city/province.
 *   3. Street address alone.
 *   4. Cleaned venue name + city/province.
 *   5. Venue name alone.
 *   6. The raw original text, as a last resort.
 * (see buildSearchQueries for the exact ordering/dedup logic.) Each of
 * these is itself tried narrow-then-wide (see searchNominatim) before
 * moving to the next stage — a venue-name-only query (no address/city to
 * narrow it with) benefits the most from this, since it's the one stage
 * with no other lever to pull if Nominatim's own top 3 by raw relevance
 * doesn't happen to include the right, merely-obscure place.
 *
 * A confident resolution from stage 2-6 is saved back to the venue
 * directory (source: 'nominatim') so every future event at the same place
 * resolves instantly from stage 1 with no further geocoding at all —
 * recurring practices, a different sibling's game, a different season.
 *
 * A 7th stage, Google Places Text Search (see googlePlaces.ts), is tried
 * only when GOOGLE_PLACES_API_KEY is configured and every stage above has
 * failed — disabled entirely by default, so this never becomes a required
 * dependency for the free lookup path to work.
 *
 * This module only resolves *destinations*. Departure-location resolution
 * (resolveLocationText in activityTravel.ts) and its importance-based
 * isAmbiguousGeocodeMatch heuristic are untouched by this module.
 */
import { eq } from 'drizzle-orm';
import { db, type DbExecutor } from '@/lib/db/client';
import { activityVenues, type ActivityVenueSource } from '@/lib/db/schema';
import { geocodeAddress, type GeocodeBias, type GeocodeResult } from '@/lib/integrations/geocode';
import { isGooglePlacesConfigured, searchGooglePlaces } from '@/lib/integrations/googlePlaces';
import { evaluateVenueCandidates } from '@/lib/utils/activityVenueConfidence';
import { haversineDistanceMeters, type GeoPoint } from '@/lib/utils/activityTravelResolution';
import { buildSearchQueries, normalizeVenueName, parseVenueLocation, type ParsedVenueLocation } from '@/lib/utils/activityVenueParsing';

export interface VenueRecord {
  id: string;
  normalizedName: string;
  displayName: string;
  aliases: string[];
  formattedAddress: string | null;
  lat: number;
  lon: number;
  source: ActivityVenueSource;
  verified: boolean;
}

type VenueRow = typeof activityVenues.$inferSelect;

function toVenueRecord(row: VenueRow): VenueRecord {
  return {
    id: row.id,
    normalizedName: row.normalizedName,
    displayName: row.displayName,
    aliases: row.aliases ?? [],
    formattedAddress: row.formattedAddress,
    lat: parseFloat(row.latitude as unknown as string),
    lon: parseFloat(row.longitude as unknown as string),
    source: row.source as ActivityVenueSource,
    verified: row.verified,
  };
}

function distanceTo(point: GeoPoint, record: VenueRecord): number {
  return haversineDistanceMeters(point, { lat: record.lat, lon: record.lon });
}

/**
 * Looks up a saved venue by name — exact normalized-name match first, then
 * (only if that finds nothing) a scan of every venue's aliases, since a
 * previously-matched raw calendar string can differ from the venue's own
 * display name. When several rows share the name (two different towns'
 * "Community Arena"), disambiguates by proximity to `bias` (typically the
 * household's own Home); with no bias, returns the first match rather than
 * guessing which town.
 */
export async function findVenueByName(
  venueName: string,
  bias: GeoPoint | undefined,
  executor: DbExecutor = db,
): Promise<VenueRecord | null> {
  const normalized = normalizeVenueName(venueName);
  const exact = await executor.select().from(activityVenues).where(eq(activityVenues.normalizedName, normalized));

  let rows = exact;
  if (rows.length === 0) {
    const all = await executor.select().from(activityVenues);
    rows = all.filter((row) => (row.aliases ?? []).some((alias) => normalizeVenueName(alias) === normalized));
  }
  if (rows.length === 0) return null;

  const records = rows.map(toVenueRecord);
  if (records.length === 1) return records[0] as VenueRecord;
  if (!bias) return records[0] as VenueRecord;

  return [...records].sort((a, b) => distanceTo(bias, a) - distanceTo(bias, b))[0] as VenueRecord;
}

/**
 * A new venue match is folded into an existing row, rather than creating a
 * duplicate, when it shares the same normalized name AND its coordinates
 * land within this radius of an existing row's — i.e. it's almost
 * certainly the same physical place, not a same-named venue in another
 * town (which the normalized-name-sharing design above explicitly allows).
 */
const VENUE_DUPLICATE_RADIUS_METERS = 1000;

export interface UpsertVenueInput {
  venueName: string;
  /** The raw calendar-location text this match came from, if different from venueName — recorded as an alias. */
  alias?: string | null;
  formattedAddress: string | null;
  lat: number;
  lon: number;
  source: ActivityVenueSource;
  /** True for a parent-confirmed pick; always wins over an existing non-verified row's coordinates. */
  verified?: boolean;
}

/**
 * Saves (or updates) a venue-directory row for a confidently-resolved
 * match. A parent_confirmed input always upgrades a matched row's
 * coordinates/source/verified flag, even over an existing nominatim-sourced
 * row for the same place — a human's explicit correction outranks an
 * automated lookup. An alias is appended, never deduplicating away
 * previously recorded aliases.
 */
export async function upsertVenue(input: UpsertVenueInput, executor: DbExecutor = db): Promise<VenueRecord> {
  const normalized = normalizeVenueName(input.venueName);
  const existingRows = await executor.select().from(activityVenues).where(eq(activityVenues.normalizedName, normalized));
  const candidates = existingRows.map(toVenueRecord);
  const matched = candidates.find(
    (record) => haversineDistanceMeters({ lat: input.lat, lon: input.lon }, { lat: record.lat, lon: record.lon }) <= VENUE_DUPLICATE_RADIUS_METERS,
  );

  const aliasToAdd = input.alias?.trim() || null;

  if (matched) {
    const aliases =
      aliasToAdd && aliasToAdd !== matched.displayName && !matched.aliases.includes(aliasToAdd)
        ? [...matched.aliases, aliasToAdd]
        : matched.aliases;

    const upgrading = (input.verified || input.source === 'parent_confirmed') && !matched.verified;
    const updated: VenueRecord = upgrading
      ? { ...matched, aliases, formattedAddress: input.formattedAddress, lat: input.lat, lon: input.lon, source: input.source, verified: true }
      : { ...matched, aliases };

    await executor
      .update(activityVenues)
      .set({
        aliases: updated.aliases,
        formattedAddress: updated.formattedAddress,
        latitude: updated.lat.toString(),
        longitude: updated.lon.toString(),
        source: updated.source,
        verified: updated.verified,
        updatedAt: new Date(),
      })
      .where(eq(activityVenues.id, matched.id));

    return updated;
  }

  const [inserted] = await executor
    .insert(activityVenues)
    .values({
      normalizedName: normalized,
      displayName: input.venueName,
      aliases: aliasToAdd && aliasToAdd !== input.venueName ? [aliasToAdd] : [],
      formattedAddress: input.formattedAddress,
      latitude: input.lat.toString(),
      longitude: input.lon.toString(),
      source: input.source,
      verified: !!input.verified,
    })
    .returning();

  return toVenueRecord(inserted as VenueRow);
}

export interface ResolvedVenueLocation {
  address: string;
  lat: number;
  lon: number;
}

export type VenueDestinationResolution =
  | { ok: true; location: ResolvedVenueLocation; venueId: string | null }
  | { ok: false; failureReason: 'geocode_failed' | 'ambiguous_address' };

async function acceptAndSave(
  parsed: ParsedVenueLocation,
  rawLocation: string,
  address: string,
  accepted: GeocodeResult,
  source: ActivityVenueSource,
  executor: DbExecutor,
): Promise<VenueDestinationResolution> {
  const location: ResolvedVenueLocation = { address, lat: accepted.latitude, lon: accepted.longitude };

  let venueId: string | null = null;
  if (parsed.venueName) {
    const saved = await upsertVenue(
      {
        venueName: parsed.venueName,
        alias: rawLocation.trim(),
        formattedAddress: accepted.fullName,
        lat: location.lat,
        lon: location.lon,
        source,
      },
      executor,
    );
    venueId = saved.id;
  }

  return { ok: true, location, venueId };
}

/**
 * Nominatim candidate limits for one query string: start narrow (cheap,
 * fast, usually sufficient), and only widen when the narrow attempt came
 * back with nothing confidently acceptable AND a bias point exists to
 * disambiguate a bigger pool with. A venue that's real but ranks outside
 * Nominatim's own top 3 by raw relevance — the common case for a small,
 * locally-known venue competing against unrelated same-named businesses —
 * may still be well within its top 8, and the wider pool still goes
 * through the exact same confidence gate, never a license to guess.
 */
const NARROW_CANDIDATE_LIMIT = 3;
const WIDE_CANDIDATE_LIMIT = 8;

async function searchNominatim(query: string, bias: GeocodeBias | undefined): Promise<GeocodeResult[]> {
  const narrow = await geocodeAddress(query, NARROW_CANDIDATE_LIMIT, bias);
  if (!bias) return narrow;
  if (evaluateVenueCandidates(narrow, bias).accepted) return narrow;

  const wide = await geocodeAddress(query, WIDE_CANDIDATE_LIMIT, bias);
  // Prefer the wider result set only when it actually found something the
  // narrow one didn't — an empty/identical wide response is just wasted
  // work, not a reason to discard the narrow candidates entirely.
  return wide.length > narrow.length ? wide : narrow;
}

/**
 * Resolves a raw calendar `location` string to a destination, trying the
 * venue directory before ever making a network call, then working through
 * buildSearchQueries' progressively broader queries — each one itself
 * tried at a narrow Nominatim candidate limit first, widened once if that
 * comes back inconclusive (see searchNominatim). Stops at the first stage
 * evaluateVenueCandidates can confidently accept. Never invents a location
 * when nothing can be confidently resolved — returns `ok: false` instead,
 * same as the existing departure-side resolveLocationText.
 */
export async function resolveVenueDestination(
  rawLocation: string,
  bias: GeocodeBias | undefined,
  executor: DbExecutor = db,
): Promise<VenueDestinationResolution> {
  const parsed = parseVenueLocation(rawLocation);

  if (parsed.venueName) {
    const saved = await findVenueByName(parsed.venueName, bias, executor);
    if (saved) {
      return {
        ok: true,
        venueId: saved.id,
        location: { address: saved.formattedAddress ?? saved.displayName, lat: saved.lat, lon: saved.lon },
      };
    }
  }

  const queries = buildSearchQueries(parsed, rawLocation);
  let sawAnyCandidates = false;

  for (const query of queries) {
    const candidates = await searchNominatim(query, bias);
    if (candidates.length > 0) sawAnyCandidates = true;

    const evaluation = evaluateVenueCandidates(candidates, bias);
    if (!evaluation.accepted) continue;

    return acceptAndSave(parsed, rawLocation, query, evaluation.accepted, 'nominatim', executor);
  }

  // Last resort, and only when a server-side API key is configured — see
  // googlePlaces.ts. Tried with the original raw text (not the cleaned-up
  // queries above): Google's own parsing is the whole reason this stage
  // exists, for venues OpenStreetMap simply doesn't have mapped.
  if (isGooglePlacesConfigured()) {
    const candidates = await searchGooglePlaces(rawLocation, bias);
    if (candidates.length > 0) sawAnyCandidates = true;

    const evaluation = evaluateVenueCandidates(candidates, bias);
    if (evaluation.accepted) {
      return acceptAndSave(parsed, rawLocation, rawLocation.trim(), evaluation.accepted, 'google_places', executor);
    }
  }

  return { ok: false, failureReason: sawAnyCandidates ? 'ambiguous_address' : 'geocode_failed' };
}
