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
 * Handles the two separator conventions seen in real calendar exports:
 *   - dash-separated:  "Eddie Bush Arena - 100 First St, Midland ON"
 *   - comma-separated: "All Around Athletics Centre, 123 Main St, Collingwood, ON"
 *   - bare venue name: "Osprey Community Arena"
 *   - bare address:    "123 Main Street, Collingwood ON"
 */

export interface ParsedVenueLocation {
  venueName: string | null;
  streetAddress: string | null;
  cityProvince: string | null;
}

const DASH_SPLIT = /\s+-\s+/;
const STARTS_WITH_NUMBER = /^\d/;

function splitParts(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Pulls a leading street-address segment and trailing city/province out of
 * a list of comma-separated parts, given that no venue name is already
 * known. The first part is treated as the venue name only when it doesn't
 * look like an address (i.e. doesn't start with a house number).
 */
function parseCommaParts(parts: string[]): ParsedVenueLocation {
  if (parts.length === 0) return { venueName: null, streetAddress: null, cityProvince: null };

  const first = parts[0] as string;
  const rest = parts.slice(1);
  if (STARTS_WITH_NUMBER.test(first)) {
    return {
      venueName: null,
      streetAddress: first,
      cityProvince: rest.length > 0 ? rest.join(', ') : null,
    };
  }

  if (rest.length === 0) {
    return { venueName: first, streetAddress: null, cityProvince: null };
  }

  const second = rest[0] as string;
  const cityParts = rest.slice(1);
  if (STARTS_WITH_NUMBER.test(second)) {
    return {
      venueName: first,
      streetAddress: second,
      cityProvince: cityParts.length > 0 ? cityParts.join(', ') : null,
    };
  }

  return { venueName: first, streetAddress: null, cityProvince: rest.join(', ') };
}

/**
 * Parses a raw calendar location string into venue name / street address /
 * city-province parts. Any part that isn't present in the input is null —
 * callers must not substitute guessed values for a null part.
 */
export function parseVenueLocation(raw: string | null | undefined): ParsedVenueLocation {
  const text = (raw ?? '').trim();
  if (!text) return { venueName: null, streetAddress: null, cityProvince: null };

  const dashMatch = text.split(DASH_SPLIT);
  if (dashMatch.length >= 2) {
    const venueName = (dashMatch[0] as string).trim();
    const remainder = dashMatch.slice(1).join(' - ').trim();
    const remainderParts = splitParts(remainder);

    if (remainderParts.length === 0) {
      return { venueName: venueName || null, streetAddress: null, cityProvince: null };
    }

    const first = remainderParts[0] as string;
    const rest = remainderParts.slice(1);
    if (STARTS_WITH_NUMBER.test(first)) {
      return {
        venueName: venueName || null,
        streetAddress: first,
        cityProvince: rest.length > 0 ? rest.join(', ') : null,
      };
    }

    return { venueName: venueName || null, streetAddress: null, cityProvince: remainderParts.join(', ') };
  }

  return parseCommaParts(splitParts(text));
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
