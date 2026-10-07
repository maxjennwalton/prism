import { NextResponse } from 'next/server';
import { getDisplayAuth } from '@/lib/auth';
import { listNeedsReviewLinks } from '@/lib/services/activityMatching';
import { logError } from '@/lib/utils/logError';

/**
 * GET /api/activity-matching/needs-review
 * Links the matcher couldn't resolve on its own — ambiguous profile/member,
 * or a title that looked like an activity but matched no profile.
 */
export async function GET() {
  const auth = await getDisplayAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const items = await listNeedsReviewLinks();
    return NextResponse.json({ items });
  } catch (error) {
    logError('Error listing activity matches needing review:', error);
    return NextResponse.json({ error: 'Failed to list activity matches needing review' }, { status: 500 });
  }
}
