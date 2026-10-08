import { NextResponse } from 'next/server';
import { getDisplayAuth } from '@/lib/auth';
import { listTodayActivityWorkflow } from '@/lib/services/activityWorkflow';
import { logError } from '@/lib/utils/logError';

/**
 * GET /api/activity-matching/workflow
 *
 * Read-only: today's settled (auto_confirmed/confirmed) matched activities,
 * each with its effective location and calculated arrival/leave-home/prep-
 * step timeline. Same display-level authorization as every other Activity
 * Matching read endpoint (/needs-review, /preview) — any signed-in household
 * display can read this, no parent-only gate, since it never writes
 * anything.
 */
export async function GET() {
  const auth = await getDisplayAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const items = await listTodayActivityWorkflow();
    return NextResponse.json({ items });
  } catch (error) {
    logError('Error listing activity workflow:', error);
    return NextResponse.json({ error: 'Failed to list activity workflow' }, { status: 500 });
  }
}
