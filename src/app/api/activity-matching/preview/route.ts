import { NextResponse } from 'next/server';
import { getDisplayAuth } from '@/lib/auth';
import { matchEventsInRange, activityMatchingWindow } from '@/lib/services/activityMatching';
import { logError } from '@/lib/utils/logError';

/**
 * GET /api/activity-matching/preview
 *
 * Read-only: runs the exact same matcher Activate would use, over the same
 * fixed 60-day window, but writes nothing. Safe to call as often as the
 * Settings UI likes.
 */
export async function GET() {
  const auth = await getDisplayAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { from, to } = activityMatchingWindow();
    const summary = await matchEventsInRange(from, to, { persist: false });
    return NextResponse.json(summary);
  } catch (error) {
    logError('Error previewing activity matches:', error);
    return NextResponse.json({ error: 'Failed to preview activity matches' }, { status: 500 });
  }
}
