import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/withAuth';
import { updatePrepStep, deletePrepStep } from '@/lib/db/activityProfiles';
import { updateActivityProfilePrepStepSchema, validateRequest } from '@/lib/validations';
import { logError } from '@/lib/utils/logError';

interface RouteParams {
  params: Promise<{ id: string; stepId: string }>;
}

/**
 * PATCH /api/activity-profiles/[id]/prep-steps/[stepId]
 * Updates one preparation step. Parent-only.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(async () => {
    try {
      const { stepId } = await params;
      const body = await request.json();
      const validation = validateRequest(updateActivityProfilePrepStepSchema, body);
      if (!validation.success) {
        return NextResponse.json({ error: validation.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
      }

      const step = await updatePrepStep(stepId, validation.data);
      if (!step) {
        return NextResponse.json({ error: 'Prep step not found' }, { status: 404 });
      }
      return NextResponse.json(step);
    } catch (error) {
      logError('Error updating prep step:', error);
      return NextResponse.json({ error: 'Failed to update prep step' }, { status: 500 });
    }
  }, { permission: 'canModifySettings' });
}

/**
 * DELETE /api/activity-profiles/[id]/prep-steps/[stepId]
 * Removes one preparation step from the profile's template. Parent-only.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withAuth(async () => {
    try {
      const { stepId } = await params;
      await deletePrepStep(stepId);
      return NextResponse.json({ success: true });
    } catch (error) {
      logError('Error deleting prep step:', error);
      return NextResponse.json({ error: 'Failed to delete prep step' }, { status: 500 });
    }
  }, { permission: 'canModifySettings' });
}
