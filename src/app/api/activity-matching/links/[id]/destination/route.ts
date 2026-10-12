import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/withAuth';
import { setActivityDestinationOverride, recomputeActivityTravelForLink } from '@/lib/services/activityTravel';
import { upsertVenue } from '@/lib/services/activityVenues';
import { findMatchingLinkIds, getLinkOriginalLocation } from '@/lib/services/activityLocationAliases';
import { parseVenueLocation } from '@/lib/utils/activityVenueParsing';
import { logError } from '@/lib/utils/logError';
import type { ActivityDestinationOverride } from '@/lib/db/schema';

interface RouteParams {
  params: Promise<{ id: string }>;
}

function parseDestination(body: unknown): ActivityDestinationOverride | null | 'invalid' {
  const raw = (body as { destination?: unknown } | null)?.destination;
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') return 'invalid';

  const { address, lat, lon } = raw as Record<string, unknown>;
  if (typeof address !== 'string' || address.trim().length === 0) return 'invalid';
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return 'invalid';
  if (typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180) return 'invalid';

  return { address: address.trim(), lat, lon };
}

/**
 * Saves a parent's confirmed pick to the shared venue directory (source:
 * 'parent_confirmed', verified) so every other event at the same place —
 * a recurring practice, a different sibling's game — resolves from the
 * directory from now on instead of repeating whatever geocoding mismatch
 * this correction just fixed. The venue name is parsed from the picked
 * candidate's own address text (it's typically the OSM POI name followed
 * by its address, e.g. "Eddie Bush Arena, 100 First St, Midland, ON,
 * Canada") rather than the raw calendar text, so this needs no extra
 * lookup of the event itself. Best-effort: a failure here must never
 * block the pin save that the parent is actually waiting on. Returns the
 * saved venue's id (null on failure, or when the address had no
 * parseable venue name at all) — the caller uses it to offer applying
 * this same correction to other events sharing the exact original
 * calendar location text (requirement 1), via the separate
 * apply-to-matching route; this route itself never applies anything
 * beyond the one link it was called for.
 */
async function saveAsVerifiedVenue(destination: ActivityDestinationOverride): Promise<string | null> {
  const parsed = parseVenueLocation(destination.address);
  if (!parsed.venueName) return null;

  try {
    const saved = await upsertVenue({
      venueName: parsed.venueName,
      alias: destination.address,
      formattedAddress: destination.address,
      lat: destination.lat,
      lon: destination.lon,
      source: 'parent_confirmed',
      verified: true,
    });
    return saved.id;
  } catch (error) {
    logError('Error saving parent-confirmed venue to the directory:', error);
    return null;
  }
}

/**
 * POST /api/activity-matching/links/[id]/destination
 *
 * Phase 4B requirement 6: lets a parent select and save the correct
 * destination for one activity from geocoding suggestions. Body:
 * `{ destination: { address, lat, lon } | null }` — this route never
 * geocodes free text itself; the caller must pass one exact candidate
 * returned by /api/travel/geocode (null clears the pin, reverting to
 * locationOverride/event.location/profile default resolved as text).
 *
 * Immediately triggers a forced recompute so the UI reflects the
 * correction right away rather than waiting for the next cron tick. A
 * real (non-null) pin is also saved to the shared venue directory — see
 * saveAsVerifiedVenue — satisfying the requirement that a parent's
 * correction benefit every future event at the same venue, not just this
 * one occurrence.
 *
 * Also returns `venueId`, `originalLocation` (this link's own raw
 * calendar location text), and `matchingEventCount` (how many OTHER
 * settled links, excluding ones with their own destination pin, share
 * that exact text) — read-only counting, never applying anything broadly
 * itself. The UI uses this to offer "apply to N other events" (requirement
 * 1), which a parent confirms separately via POST .../apply-to-matching;
 * because a bare/short original string can be geographically ambiguous,
 * nothing here creates a household-wide alias without that explicit step.
 */
export async function POST(request: Request, { params }: RouteParams) {
  return withAuth(async () => {
    try {
      const { id } = await params;
      const body = await request.json();
      const destination = parseDestination(body);

      if (destination === 'invalid') {
        return NextResponse.json(
          { error: 'destination must be null or { address: string, lat: number, lon: number }' },
          { status: 400 },
        );
      }

      await setActivityDestinationOverride(id, destination);

      let venueId: string | null = null;
      let originalLocation: string | null = null;
      let matchingEventCount = 0;
      if (destination) {
        venueId = await saveAsVerifiedVenue(destination);
        if (venueId) {
          originalLocation = await getLinkOriginalLocation(id);
          if (originalLocation) {
            matchingEventCount = (await findMatchingLinkIds(originalLocation, id)).length;
          }
        }
      }

      const { found, travelMeta } = await recomputeActivityTravelForLink(id);
      if (!found) {
        return NextResponse.json({ error: 'Activity link not found' }, { status: 404 });
      }

      return NextResponse.json({ destination, travelMeta, venueId, originalLocation, matchingEventCount });
    } catch (error) {
      logError('Error saving activity destination override:', error);
      return NextResponse.json({ error: 'Failed to save destination override' }, { status: 500 });
    }
  }, { permission: 'canModifySettings' });
}
