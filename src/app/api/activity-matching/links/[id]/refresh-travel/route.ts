import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/withAuth';
import { recomputeActivityTravelForLink } from '@/lib/services/activityTravel';
import { logError } from '@/lib/utils/logError';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/activity-matching/links/[id]/refresh-travel
 *
 * Phase 4B (Automatic Travel) requirement 17: a parent-accessible way to
 * refresh a travel estimate on demand — e.g. after fixing a typo in a
 * destination, or just because the stored result looks wrong. Always
 * forces a fresh attempt (bypassing the "still fresh" reuse the batch cron
 * applies) since a parent explicitly asking for this wants a new try, not
 * confirmation that the cached one is still within its refresh window.
 *
 * Returns `{ travelMeta: null }` with 200 when the link exists but there's
 * nothing to compute (e.g. a manual override is set, or no destination/
 * departure is configured) — distinct from a 404 when the link itself
 * doesn't exist.
 */
export async function POST(request: Request, { params }: RouteParams) {
  return withAuth(async () => {
    try {
      const { id } = await params;
      const { found, travelMeta } = await recomputeActivityTravelForLink(id);
      if (!found) {
        return NextResponse.json({ error: 'Activity link not found' }, { status: 404 });
      }
      return NextResponse.json({ travelMeta });
    } catch (error) {
      logError('Error refreshing activity travel estimate:', error);
      return NextResponse.json({ error: 'Failed to refresh travel estimate' }, { status: 500 });
    }
  }, { permission: 'canModifySettings' });
}
