import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/withAuth';
import { updateActivityEventLink } from '@/lib/db/activityProfiles';
import { activityMatchReviewDecisionSchema, validateRequest } from '@/lib/validations';
import { logError } from '@/lib/utils/logError';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/activity-matching/needs-review/[id]
 *
 * Settles one needs_review link: "confirm" (optionally after changing the
 * proposed profile and/or member — there's no separate "change" endpoint,
 * the Settings UI just edits the dropdowns before confirming) or "reject"
 * ("not an activity" — clears any profile/member and tombstones the row so
 * the matcher never reconsiders this event again, same as a human-confirmed
 * auto_match link).
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(async () => {
    try {
      const { id } = await params;
      const body = await request.json();
      const validation = validateRequest(activityMatchReviewDecisionSchema, body);
      if (!validation.success) {
        return NextResponse.json({ error: validation.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
      }

      const input = validation.data.decision === 'reject'
        ? { activityProfileId: null, assignedMemberId: null, matchStatus: 'rejected' as const, matchMeta: null }
        : {
          activityProfileId: validation.data.activityProfileId,
          assignedMemberId: validation.data.assignedMemberId,
          matchStatus: 'confirmed' as const,
          matchMeta: null,
        };

      const updated = await updateActivityEventLink(id, input);
      if (!updated) {
        return NextResponse.json({ error: 'Activity match not found' }, { status: 404 });
      }
      return NextResponse.json(updated);
    } catch (error) {
      logError('Error resolving activity match review:', error);
      return NextResponse.json({ error: 'Failed to resolve activity match review' }, { status: 500 });
    }
  }, { permission: 'canModifySettings' });
}
