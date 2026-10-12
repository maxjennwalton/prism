import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/withAuth';
import { recomputeActivityTravelForLink } from '@/lib/services/activityTravel';
import { confirmLocationAlias, findMatchingLinkIds, getLinkOriginalLocation } from '@/lib/services/activityLocationAliases';
import { logError } from '@/lib/utils/logError';

interface RouteParams {
  params: Promise<{ id: string }>;
}

function parseBody(body: unknown): { venueId: string; overwriteConflict: boolean } | 'invalid' {
  const { venueId, overwriteConflict } = (body as Record<string, unknown>) ?? {};
  if (typeof venueId !== 'string' || venueId.trim().length === 0) return 'invalid';
  if (overwriteConflict !== undefined && typeof overwriteConflict !== 'boolean') return 'invalid';
  return { venueId, overwriteConflict: overwriteConflict === true };
}

/**
 * POST /api/activity-matching/links/[id]/destination/apply-to-matching
 *
 * Requirement 1/2: after confirming a destination for one event (via the
 * sibling .../destination route, which returns `venueId` and
 * `matchingEventCount`), a parent can explicitly apply that same
 * correction to every OTHER settled event whose raw calendar location
 * text is the exact same literal string — e.g. every other event whose
 * location is just "Wasaga". This is a deliberately SEPARATE, explicit
 * action: a bare/short/generic original string can be geographically
 * ambiguous, so broad reuse never happens without this confirmation step.
 *
 * Body: `{ venueId: string, overwriteConflict?: boolean }` — venueId is
 * whatever the .../destination route's response just reported for this
 * same link. Writes a household-wide activity_location_aliases row (see
 * confirmLocationAlias), then immediately recomputes travel for every
 * matching link so the Activity Travel panel reflects the correction
 * without waiting for the next calendar sync — each of those recomputes
 * resolves straight from the alias just written, with zero geocoding
 * calls (see resolveVenueDestination's stage 0).
 *
 * A location already confirmed to a DIFFERENT venue is never silently
 * remapped — that returns 409 with the existing venue's address so the
 * UI can warn the parent, who can retry with `overwriteConflict: true`.
 */
export async function POST(request: Request, { params }: RouteParams) {
  return withAuth(async () => {
    try {
      const { id } = await params;
      const body = await request.json();
      const parsed = parseBody(body);

      if (parsed === 'invalid') {
        return NextResponse.json({ error: 'venueId (string) is required; overwriteConflict, if given, must be a boolean' }, { status: 400 });
      }

      const originalLocation = await getLinkOriginalLocation(id);
      if (!originalLocation) {
        return NextResponse.json({ error: 'Activity link not found or has no calendar location text' }, { status: 404 });
      }

      const aliasResult = await confirmLocationAlias(originalLocation, parsed.venueId, { overwriteConflict: parsed.overwriteConflict });
      if (!aliasResult.ok) {
        return NextResponse.json(
          { error: 'This location is already mapped to a different venue', existingVenueId: aliasResult.existingVenueId, existingAddress: aliasResult.existingAddress },
          { status: 409 },
        );
      }

      const matchingLinkIds = await findMatchingLinkIds(originalLocation, id);
      for (const linkId of matchingLinkIds) {
        await recomputeActivityTravelForLink(linkId);
      }

      return NextResponse.json({ updatedCount: matchingLinkIds.length });
    } catch (error) {
      logError('Error applying destination correction to matching activities:', error);
      return NextResponse.json({ error: 'Failed to apply the correction to matching activities' }, { status: 500 });
    }
  }, { permission: 'canModifySettings' });
}
