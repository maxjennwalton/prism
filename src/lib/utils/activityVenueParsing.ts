/**
 * Pure, DB-free parsing of messy calendar `location` strings into their
 * component parts — a venue name, a street address, and a city/province —
 * so the venue directory and progressive geocoding search (see
 * src/lib/services/activityVenues.ts) have something more useful to work
 * with than one opaque string.
 *
 * Deliberately conservative: a part is only ever extracted when the input
 * text actually contains it. Nothing here invents a city, province, or
 * street number that wasn't in the original string.
 *
 * Handles the separator conventions seen in real calendar exports:
 *   - dash-separated:   "Eddie Bush Arena - 100 First St, Midland ON"
 *   - comma-separated:  "All Around Athletics Centre, 123 Main St, Collingwood, ON"
 *   - pipe-separated:   "All Around Athletics Centre - Full Facility | 91 Sandford Fleming Dr, Peterborough, ON"
 *                        (dash introduces a facility/room descriptor —
 *                        "Full Facility" — before the pipe hands off to the
 *                        actual address; see below)
 *   - bare venue name:  "Osprey Community Arena"
 *   - bare address:     "123 Main Street, Collingwood ON"
 */

export interface ParsedVenueLocation {
  venueName: string | null;
  streetAddress: string | null;
  cityProvince: string | null;
}

const DASH_SPLIT = /\s+-\s+/;
const STARTS_WITH_NUMBER = /^\d/;

/** Comma AND pipe both separate parts — a calendar export may use either (or both at once) between a venue/facility descriptor and its address. */
const PART_SPLIT = /[,|]/;

function splitParts(text: string): string[] {
  return text
    .split(PART_SPLIT)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Parses a raw calendar location string into venue name / street address /
 * city-province parts. Any part that isn't present in the input is null —
 * callers must not substitute guessed values for a null part.
 *
 * Algorithm: an optional leading " - "-separated venue name is pulled off
 * first; everything after that (or the whole string, if there was no dash)
 * is split into comma/pipe-delimited parts, and scanned for the first part
 * that looks like a street address (starts with a house number). Any part
 * between the venue name and that address — e.g. a facility/room
 * descriptor like "Full Facility" — is discarded as noise rather than
 * merged into the city/province, since it was never geocodable in the
 * first place. When no dash was found and the address isn't the very
 * first part, the part immediately before the address is treated as the
 * venue name instead.
 */
export function parseVenueLocation(raw: string | null | undefined): ParsedVenueLocation {
  const text = (raw ?? '').trim();
  if (!text) return { venueName: null, streetAddress: null, cityProvince: null };

  const dashMatch = text.split(DASH_SPLIT);
  let venueName: string | null = null;
  let remainderText = text;
  if (dashMatch.length >= 2) {
    venueName = (dashMatch[0] as string).trim() || null;
    remainderText = dashMatch.slice(1).join(' - ').trim();
  }

  const parts = splitParts(remainderText);
  const addressIndex = parts.findIndex((part) => STARTS_WITH_NUMBER.test(part));

  if (addressIndex === -1) {
    if (venueName) {
      return { venueName, streetAddress: null, cityProvince: parts.length > 0 ? parts.join(', ') : null };
    }
    if (parts.length === 0) return { venueName: null, streetAddress: null, cityProvince: null };
    const [first, ...rest] = parts;
    return { venueName: first as string, streetAddress: null, cityProvince: rest.length > 0 ? rest.join(', ') : null };
  }

  const streetAddress = parts[addressIndex] as string;
  const cityProvince = parts.length > addressIndex + 1 ? parts.slice(addressIndex + 1).join(', ') : null;

  if (venueName) return { venueName, streetAddress, cityProvince };
  if (addressIndex === 0) return { venueName: null, streetAddress, cityProvince };

  // No dash was found, but there's a part before the address — the first
  // one is the venue name; anything between it and the address (a
  // facility/room descriptor) is discarded as noise, same as the dash case.
  return { venueName: parts[0] as string, streetAddress, cityProvince };
}

/**
 * Normalizes a venue's own name for use as a venue-directory lookup key:
 * lowercased, punctuation stripped, whitespace collapsed. Descriptor words
 * like "Arena" or "Community" are kept — they're part of the venue's
 * identity, not noise to strip (unlike street-suffix normalization for
 * addresses elsewhere in the codebase).
 */
export function normalizeVenueName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Builds an ordered list of search query strings for progressive geocoding,
 * most specific/reliable first, with no duplicates. The raw original text
 * is always included last as a final fallback. Callers apply locality bias
 * (see GeocodeBias) uniformly across every query here rather than baking a
 * location into the query text itself.
 */
export function buildSearchQueries(parsed: ParsedVenueLocation, raw: string): string[] {
  const candidates: (string | null)[] = [
    parsed.streetAddress && parsed.cityProvince ? `${parsed.streetAddress}, ${parsed.cityProvince}` : null,
    parsed.streetAddress,
    parsed.venueName && parsed.cityProvince ? `${parsed.venueName}, ${parsed.cityProvince}` : null,
    parsed.venueName,
    raw.trim(),
  ];

  const seen = new Set<string>();
  const queries: string[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const trimmed = candidate.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    queries.push(trimmed);
  }
  return queries;
}
