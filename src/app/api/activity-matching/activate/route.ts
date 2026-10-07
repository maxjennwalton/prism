import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { withAuth } from '@/lib/api/withAuth';
import { db } from '@/lib/db/client';
import { settings } from '@/lib/db/schema';
import { matchEventsInRange, activityMatchingWindow } from '@/lib/services/activityMatching';
import { logActivity } from '@/lib/services/auditLog';
import { logError } from '@/lib/utils/logError';

export const ACTIVITY_MATCHING_ENABLED_SETTING_KEY = 'activityMatchingEnabled';

/**
 * POST /api/activity-matching/activate
 *
 * Turns Activity Matching on and runs its initial backfill over the fixed
 * 60-day window as one atomic unit: either both the backfill's
 * activity_event_links rows and the enabled flag get written, or neither
 * does. A failed insert partway through rolls back everything already
 * written in this call, so a failed activation can never leave matching
 * enabled with a half-done backfill, nor leave stray links behind with
 * matching still off.
 */
export async function POST() {
  return withAuth(async (auth) => {
    try {
      const { from, to } = activityMatchingWindow();

      const summary = await db.transaction(async (tx) => {
        const result = await matchEventsInRange(from, to, { persist: true, executor: tx });

        const value = { enabled: true, enabledAt: new Date().toISOString() };
        const [existing] = await tx.select().from(settings).where(eq(settings.key, ACTIVITY_MATCHING_ENABLED_SETTING_KEY));
        if (existing) {
          await tx.update(settings).set({ value, updatedAt: new Date() }).where(eq(settings.key, ACTIVITY_MATCHING_ENABLED_SETTING_KEY));
        } else {
          await tx.insert(settings).values({ key: ACTIVITY_MATCHING_ENABLED_SETTING_KEY, value });
        }

        return result;
      });

      logActivity({
        userId: auth.userId,
        action: 'update',
        entityType: 'setting',
        summary: `Enabled Activity Matching (${summary.autoMatched} auto-matched, ${summary.needsReview} need review)`,
      });

      return NextResponse.json({
        enabled: true,
        total: summary.total,
        autoMatched: summary.autoMatched,
        needsReview: summary.needsReview,
        ignored: summary.ignored,
      });
    } catch (error) {
      logError('Error activating activity matching:', error);
      return NextResponse.json({ error: 'Failed to activate activity matching' }, { status: 500 });
    }
  }, { permission: 'canModifySettings' });
}
