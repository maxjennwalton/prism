import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/withAuth';
import { setActivityDepartureOverride, recomputeActivityTravelForLink } from '@/lib/services/activityTravel';
import { logError } from '@/lib/utils/logError';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/activity-matching/links/[id]/departure
 *
 * Phase 4B requirement 2: a per-event departure override, distinct from
 * the household's default Home address. Saving one here never writes to
 * the Home setting — it only sets this one link's own column. Body:
 * `{ departureLocationOverride: string | null }` (null clears the
 * override, reverting to Home).
 *
 * Immediately triggers a forced recompute so the UI reflects the new
 * departure point right away rather than waiting for the next cron tick;
 * the recompute's own geocoding is what validates the text — this route
 * never geocodes or guesses on its own.
 */
export async function POST(request: Request, { params }: RouteParams) {
  return withAuth(async () => {
    try {
      const { id } = await params;
      const body = await request.json();
      const raw = body?.departureLocationOverride;
      if (raw !== null && typeof raw !== 'string') {
        return NextResponse.json({ error: 'departureLocationOverride must be a string or null' }, { status: 400 });
      }
      const departureLocationOverride = typeof raw === 'string' ? (raw.trim() || null) : null;

      await setActivityDepartureOverride(id, departureLocationOverride);
      const { found, travelMeta } = await recomputeActivityTravelForLink(id);
      if (!found) {
        return NextResponse.json({ error: 'Activity link not found' }, { status: 404 });
      }

      return NextResponse.json({ departureLocationOverride, travelMeta });
    } catch (error) {
      logError('Error saving activity departure override:', error);
      return NextResponse.json({ error: 'Failed to save departure override' }, { status: 500 });
    }
  }, { permission: 'canModifySettings' });
}
