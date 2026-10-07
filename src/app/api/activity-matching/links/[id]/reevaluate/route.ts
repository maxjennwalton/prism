import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/withAuth';
import { reevaluateMatch } from '@/lib/services/activityMatching';
import { logError } from '@/lib/utils/logError';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/activity-matching/links/[id]/reevaluate
 *
 * Explicit, one-off re-run of the matcher against this one existing link —
 * e.g. after editing a profile's keywords or adding a team identifier, to
 * see whether this event would resolve differently now. Unlike every
 * automatic matching path, this intentionally overwrites the link's
 * current profile/member/status with the fresh result.
 */
export async function POST(request: Request, { params }: RouteParams) {
  return withAuth(async () => {
    try {
      const { id } = await params;
      const result = await reevaluateMatch(id);
      if (!result) {
        return NextResponse.json({ error: 'Activity match not found' }, { status: 404 });
      }
      return NextResponse.json(result);
    } catch (error) {
      logError('Error re-evaluating activity match:', error);
      return NextResponse.json({ error: 'Failed to re-evaluate activity match' }, { status: 500 });
    }
  }, { permission: 'canModifySettings' });
}
