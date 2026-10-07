import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/withAuth';
import {
  getActivityProfile,
  listPrepSteps,
  createActivityProfile,
  createPrepStep,
} from '@/lib/db/activityProfiles';
import { logError } from '@/lib/utils/logError';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/activity-profiles/[id]/duplicate
 * Creates an independent copy of a profile and its prep steps — e.g. "Hockey
 * Game" from "Hockey Practice" when they share most of the same setup but
 * need different timing. The copy gets its own ids throughout; editing one
 * afterward never affects the other. Parent-only.
 */
export async function POST(request: Request, { params }: RouteParams) {
  return withAuth(async (auth) => {
    try {
      const { id } = await params;
      const source = await getActivityProfile(id);
      if (!source) {
        return NextResponse.json({ error: 'Activity profile not found' }, { status: 404 });
      }
      const sourceSteps = await listPrepSteps(id);

      // Gear items carry their own id separate from the DB row (it's what
      // activity_gear_completions keys per-occurrence checked state on), so
      // copying it verbatim would give the duplicate's gear items the exact
      // same ids as the source's — contradicting "the copy gets its own ids
      // throughout" below. Regenerate them here, the same way a freshly
      // added gear item gets one in the editor (GearChecklistEditor).
      const sourceGearItems = source.gearItems as { id: string; label: string; sortOrder: number }[];
      const copiedGearItems = sourceGearItems.map((g) => ({ ...g, id: randomUUID() }));

      const copy = await createActivityProfile({
        name: `${source.name} (copy)`,
        category: source.category,
        color: source.color,
        matchKeywords: source.matchKeywords as string[],
        arrivalBufferMinutes: source.arrivalBufferMinutes,
        travelMinutes: source.travelMinutes,
        defaultLocation: source.defaultLocation,
        gearItems: copiedGearItems,
        createdBy: auth.userId,
      });

      for (const step of sourceSteps) {
        await createPrepStep({
          activityProfileId: copy.id,
          label: step.label,
          sortOrder: step.sortOrder,
          anchor: step.anchor,
          offsetMinutes: step.offsetMinutes,
          isCheckable: step.isCheckable,
          linksGear: step.linksGear,
          assignedMemberId: step.assignedMemberId,
        });
      }

      return NextResponse.json(copy, { status: 201 });
    } catch (error) {
      logError('Error duplicating activity profile:', error);
      return NextResponse.json({ error: 'Failed to duplicate activity profile' }, { status: 500 });
    }
  }, { permission: 'canModifySettings' });
}
