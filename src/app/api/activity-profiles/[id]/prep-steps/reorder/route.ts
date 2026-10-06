import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/withAuth';
import { updatePrepStep } from '@/lib/db/activityProfiles';
import { logError } from '@/lib/utils/logError';

/**
 * PUT /api/activity-profiles/[id]/prep-steps/reorder
 * Reorders a profile's preparation steps. Accepts { order: { id, sortOrder }[] }.
 * Same shape as the existing /api/family/reorder. Parent-only.
 */
export async function PUT(request: NextRequest) {
  return withAuth(async () => {
    try {
      const { order } = await request.json() as { order: { id: string; sortOrder: number }[] };

      if (!Array.isArray(order) || order.length === 0) {
        return NextResponse.json({ error: 'Order array required' }, { status: 400 });
      }

      for (const item of order) {
        await updatePrepStep(item.id, { sortOrder: item.sortOrder });
      }

      return NextResponse.json({ success: true });
    } catch (error) {
      logError('Error reordering prep steps:', error);
      return NextResponse.json({ error: 'Failed to reorder prep steps' }, { status: 500 });
    }
  }, { permission: 'canModifySettings' });
}
