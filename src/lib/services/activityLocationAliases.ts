/**
 * Household-wide raw-location-text aliases — see activity_location_aliases
 * in schema.ts for the full rationale. This is the piece that lets a
 * parent's confirmation of one event's destination ("Wasaga" -> Wasaga
 * Beach Arena) *optionally* apply to every OTHER event whose calendar
 * location is the exact same literal text, after an explicit confirmation
 * step — never automatically — because a bare/short/generic original
 * string is exactly the kind of text that can mean different real places,
 * so broad reuse needs a human to say yes first.
 *
 * Deliberately separate from activityVenues.ts's own venue-name-based
 * aliasing (findVenueByName/upsertVenue), which is keyed by the venue's
 * own parsed name and is always written automatically on a confident
 * match — that mechanism already safely handles "the same venue, phrased
 * slightly differently." This one instead handles "the exact same bare
 * text, which could mean more than one real place."
 *
 * No function here ever imports activityTravel.ts or activityVenues.ts —
 * callers (the destination API routes) own triggering a recompute after
 * confirmLocationAlias, keeping this module free of the import cycle that
 * would otherwise result (activityVenues.ts -> here -> activityTravel.ts
 * -> activityVenues.ts).
 */
import { and, eq, ne } from 'drizzle-orm';
import { db, type DbExecutor } from '@/lib/db/client';
import { activityEventLinks, activityLocationAliases, activityVenues, events } from '@/lib/db/schema';

/** Lowercased, whitespace-collapsed form of a raw calendar location string — the literal original text, never the parsed venue name. */
export function normalizeLocationText(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface LocationAliasVenue {
  venueId: string;
  address: string;
  lat: number;
  lon: number;
}

/**
 * Looks up a confirmed household-wide alias for the exact raw calendar
 * location text, if one exists. Zero network calls — this is checked
 * before any geocoding attempt (see resolveVenueDestination).
 */
export async function findLocationAlias(rawLocation: string, executor: DbExecutor = db): Promise<LocationAliasVenue | null> {
  const normalized = normalizeLocationText(rawLocation);
  const [row] = await executor
    .select({
      venueId: activityVenues.id,
      formattedAddress: activityVenues.formattedAddress,
      displayName: activityVenues.displayName,
      latitude: activityVenues.latitude,
      longitude: activityVenues.longitude,
    })
    .from(activityLocationAliases)
    .innerJoin(activityVenues, eq(activityLocationAliases.venueId, activityVenues.id))
    .where(eq(activityLocationAliases.normalizedLocation, normalized));

  if (!row) return null;
  return {
    venueId: row.venueId,
    address: row.formattedAddress ?? row.displayName,
    lat: parseFloat(row.latitude as unknown as string),
    lon: parseFloat(row.longitude as unknown as string),
  };
}

/** The raw calendar `location` text behind one activity link, for alias matching/confirmation. */
export async function getLinkOriginalLocation(linkId: string, executor: DbExecutor = db): Promise<string | null> {
  const [row] = await executor
    .select({ eventLocation: events.location })
    .from(activityEventLinks)
    .innerJoin(events, eq(activityEventLinks.eventId, events.id))
    .where(eq(activityEventLinks.id, linkId));
  return row?.eventLocation ?? null;
}

/**
 * Every OTHER settled activity link (any calendar, any family member)
 * whose raw calendar location text exactly matches (normalized), that a
 * broad alias confirmation would actually affect. Deliberately excludes:
 *  - the link that triggered this lookup (`excludeLinkId`)
 *  - a rejected link ("not an activity" — same rule every other Activity
 *    Matching surface follows)
 *  - any link that already has its own destinationOverrideCoords pin —
 *    an event-specific correction always wins and is never silently
 *    replaced by a broader alias (requirement: preserve manual overrides).
 */
export async function findMatchingLinkIds(
  rawLocation: string,
  excludeLinkId: string,
  executor: DbExecutor = db,
): Promise<string[]> {
  const normalized = normalizeLocationText(rawLocation);

  const rows = await executor
    .select({
      linkId: activityEventLinks.id,
      eventLocation: events.location,
      destinationOverrideCoords: activityEventLinks.destinationOverrideCoords,
      matchStatus: activityEventLinks.matchStatus,
    })
    .from(activityEventLinks)
    .innerJoin(events, eq(activityEventLinks.eventId, events.id))
    .where(and(ne(activityEventLinks.id, excludeLinkId), ne(activityEventLinks.matchStatus, 'rejected')));

  return rows
    .filter(
      (r) =>
        !r.destinationOverrideCoords &&
        r.eventLocation !== null &&
        normalizeLocationText(r.eventLocation) === normalized,
    )
    .map((r) => r.linkId);
}

export type ConfirmLocationAliasResult =
  | { ok: true; aliasId: string }
  | { ok: false; reason: 'conflict'; existingVenueId: string; existingAddress: string };

/**
 * Writes (or, with `overwriteConflict`, replaces) the confirmed household-
 * wide mapping from `rawLocation`'s normalized text to `venueId`. Never
 * silently remaps a location already confirmed to a DIFFERENT venue —
 * that requires `overwriteConflict: true`, the same explicit-confirmation
 * principle this whole mechanism exists for. Does not itself recompute or
 * touch any activity link; callers combine this with findMatchingLinkIds
 * and a recompute pass (see the apply-to-matching API route).
 */
export async function confirmLocationAlias(
  rawLocation: string,
  venueId: string,
  options: { overwriteConflict?: boolean } = {},
  executor: DbExecutor = db,
): Promise<ConfirmLocationAliasResult> {
  const normalized = normalizeLocationText(rawLocation);

  const [existing] = await executor
    .select()
    .from(activityLocationAliases)
    .where(eq(activityLocationAliases.normalizedLocation, normalized));

  if (existing && existing.venueId !== venueId && !options.overwriteConflict) {
    const [venueRow] = await executor.select().from(activityVenues).where(eq(activityVenues.id, existing.venueId));
    return {
      ok: false,
      reason: 'conflict',
      existingVenueId: existing.venueId,
      existingAddress: venueRow?.formattedAddress ?? venueRow?.displayName ?? 'a different venue',
    };
  }

  if (existing) {
    await executor
      .update(activityLocationAliases)
      .set({ venueId, updatedAt: new Date() })
      .where(eq(activityLocationAliases.id, existing.id));
    return { ok: true, aliasId: existing.id };
  }

  const [inserted] = await executor
    .insert(activityLocationAliases)
    .values({ normalizedLocation: normalized, venueId })
    .returning();

  return { ok: true, aliasId: (inserted as { id: string }).id };
}
