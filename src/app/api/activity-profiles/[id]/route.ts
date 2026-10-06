import { NextRequest, NextResponse } from 'next/server';
import { getDisplayAuth } from '@/lib/auth';
import { withAuth } from '@/lib/api/withAuth';
import {
  getActivityProfile,
  listPrepSteps,
  updateActivityProfile,
} from '@/lib/db/activityProfiles';
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

      const updated = await updateActivityProfile(id, validation.data);
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
