import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/withAuth';
import { listUpcomingActivityTravel } from '@/lib/services/activityTravel';
import { logError } from '@/lib/utils/logError';

/**
 * GET /api/activity-matching/links/upcoming
 *
 * Settled activities over the next two weeks with their travel
 * configuration — backs the Activity Profiles settings panel where a
 * parent sets a per-event departure override or manually refreshes an
 * estimate. Parent-gated (unlike the dashboard's /workflow endpoint):
 * this is a settings surface, not a kiosk display.
 */
export async function GET() {
  return withAuth(async () => {
    try {
      const items = await listUpcomingActivityTravel();
      return NextResponse.json({ items });
    } catch (error) {
      logError('Error listing upcoming activity travel:', error);
      return NextResponse.json({ error: 'Failed to list upcoming activities' }, { status: 500 });
    }
  }, { permission: 'canModifySettings' });
}
