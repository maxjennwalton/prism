import { NextRequest, NextResponse } from 'next/server';
import { getDisplayAuth } from '@/lib/auth';
import { withAuth } from '@/lib/api/withAuth';
import { db } from '@/lib/db/client';
import {
  getActivityProfile,
  listPrepSteps,
  updateActivityProfile,
} from '@/lib/db/activityProfiles';
import { reevaluateAllNeedsReview } from '@/lib/services/activityMatching';
import { updateActivityProfileSchema, validateRequest } from '@/lib/validations';
import { logError } from '@/lib/utils/logError';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/activity-profiles/[id]
 * Full detail for the editor: the profile plus its ordered prep steps.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await getDisplayAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const profile = await getActivityProfile(id);
    if (!profile) {
      return NextResponse.json({ error: 'Activity profile not found' }, { status: 404 });
    }
    const prepSteps = await listPrepSteps(id);
    return NextResponse.json({ ...profile, prepSteps });
  } catch (error) {
    logError('Error fetching activity profile:', error);
    return NextResponse.json({ error: 'Failed to fetch activity profile' }, { status: 500 });
  }
}

/**
 * PATCH /api/activity-profiles/[id]
 * Updates basic fields, timing, gear template, and/or archived status.
 * Parent-only. Absent key = leave alone; explicit null clears an optional
 * field (e.g. arrivalBufferMinutes back to "not configured").
 *
 * An ordinary edit or a restore (`archived: false`) can be exactly what an
 * existing Review Required event was waiting on (new keywords, a changed
 * category, a profile coming back from the archive) — so either of those
 * re-evaluates every open needs_review link, atomically with the write
 * that triggered it. Archiving (`archived: true`) never does: narrowing
 * future candidates can't newly resolve anything. reevaluateAllNeedsReview
 * never touches a confirmed, rejected, or auto_confirmed link, and is a
 * no-op entirely when matching is off.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(async () => {
    try {
      const { id } = await params;
      const body = await request.json();
      const validation = validateRequest(updateActivityProfileSchema, body);
      if (!validation.success) {
        return NextResponse.json({ error: validation.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
      }

      const isArchiving = validation.data.archived === true;

      const updated = await db.transaction(async (tx) => {
        const result = await updateActivityProfile(id, validation.data, tx);
        if (result && !isArchiving) {
          await reevaluateAllNeedsReview(tx);
        }
        return result;
      });

      if (!updated) {
        return NextResponse.json({ error: 'Activity profile not found' }, { status: 404 });
      }
      return NextResponse.json(updated);
    } catch (error) {
      logError('Error updating activity profile:', error);
      return NextResponse.json({ error: 'Failed to update activity profile' }, { status: 500 });
    }
  }, { permission: 'canModifySettings' });
}
