import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/withAuth';
import { createPrepStep } from '@/lib/db/activityProfiles';
import { createActivityProfilePrepStepSchema, validateRequest } from '@/lib/validations';
import { logError } from '@/lib/utils/logError';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/activity-profiles/[id]/prep-steps
 * Adds a preparation step to a profile. Parent-only.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  return withAuth(async () => {
    try {
      const { id } = await params;
      const body = await request.json();
      // activityProfileId comes from the URL, not the client — whatever the
      // body sends for it is ignored.
      const validation = validateRequest(createActivityProfilePrepStepSchema, { ...body, activityProfileId: id });
      if (!validation.success) {
        return NextResponse.json({ error: validation.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
      }

      const step = await createPrepStep(validation.data);
      return NextResponse.json(step, { status: 201 });
    } catch (error) {
      logError('Error creating prep step:', error);
      return NextResponse.json({ error: 'Failed to create prep step' }, { status: 500 });
    }
  }, { permission: 'canModifySettings' });
}
