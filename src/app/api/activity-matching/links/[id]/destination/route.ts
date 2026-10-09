import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/withAuth';
import { setActivityDestinationOverride, recomputeActivityTravelForLink } from '@/lib/services/activityTravel';
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
 * correction right away rather than waiting for the next cron tick.
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
      const { found, travelMeta } = await recomputeActivityTravelForLink(id);
      if (!found) {
        return NextResponse.json({ error: 'Activity link not found' }, { status: 404 });
      }

      return NextResponse.json({ destination, travelMeta });
    } catch (error) {
      logError('Error saving activity destination override:', error);
      return NextResponse.json({ error: 'Failed to save destination override' }, { status: 500 });
    }
  }, { permission: 'canModifySettings' });
}
