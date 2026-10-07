import { NextRequest, NextResponse } from 'next/server';
import { getDisplayAuth } from '@/lib/auth';
import { withAuth } from '@/lib/api/withAuth';
import { db } from '@/lib/db/client';
import { activityProfilePrepSteps } from '@/lib/db/schema';
import {
  listActivityProfiles,
  createActivityProfile,
} from '@/lib/db/activityProfiles';
import { reevaluateAllNeedsReview } from '@/lib/services/activityMatching';
import { createActivityProfileSchema, validateRequest } from '@/lib/validations';
import { logError } from '@/lib/utils/logError';

/**
 * GET /api/activity-profiles?includeArchived=true
 * Lists Activity Profiles, with prep-step counts for the summary list view.
 */
export async function GET(request: NextRequest) {
  const auth = await getDisplayAuth();
  if (!auth) {
    return NextResponse.json({ profiles: [] });
  }

  try {
    const includeArchived = new URL(request.url).searchParams.get('includeArchived') === 'true';
    const profiles = await listActivityProfiles({ includeArchived });

    // Prep-step counts for the list view. A plain fetch + in-memory count is
    // simplest here — household profile counts are small (dozens, not
    // thousands), so a GROUP BY isn't worth the extra query shape.
    const steps = await db
      .select({ activityProfileId: activityProfilePrepSteps.activityProfileId })
      .from(activityProfilePrepSteps);
    const stepCounts = new Map<string, number>();
    for (const s of steps) {
      stepCounts.set(s.activityProfileId, (stepCounts.get(s.activityProfileId) ?? 0) + 1);
    }

    const result = profiles.map((p) => ({
      ...p,
      prepStepCount: stepCounts.get(p.id) ?? 0,
      gearItemCount: (p.gearItems as unknown[]).length,
      matchKeywordCount: (p.matchKeywords as unknown[]).length,
    }));

    return NextResponse.json({ profiles: result });
  } catch (error) {
    logError('Error fetching activity profiles:', error);
    return NextResponse.json({ error: 'Failed to fetch activity profiles' }, { status: 500 });
  }
}

/**
 * POST /api/activity-profiles
 * Creates a new Activity Profile. Parent-only. No timing defaults are ever
 * injected — a field left out of the request body stays NULL.
 *
 * A new profile may be exactly what an existing Review Required event was
 * waiting on (e.g. "U9MD - Hockey Mill" had no matching profile until one
 * named "Hockey Mill" existed) — so the create and the automatic
 * re-evaluation of every open needs_review link run as one transaction:
 * either both the profile and any resulting match updates are saved, or
 * neither is. reevaluateAllNeedsReview never touches a confirmed, rejected,
 * or auto_confirmed link, and is a no-op entirely when matching is off.
 */
export async function POST(request: NextRequest) {
  return withAuth(async (auth) => {
    try {
      const body = await request.json();
      const validation = validateRequest(createActivityProfileSchema, body);
      if (!validation.success) {
        return NextResponse.json({ error: validation.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
      }

      const profile = await db.transaction(async (tx) => {
        const created = await createActivityProfile({ ...validation.data, createdBy: auth.userId }, tx);
        await reevaluateAllNeedsReview(tx);
        return created;
      });

      return NextResponse.json(profile, { status: 201 });
    } catch (error) {
      logError('Error creating activity profile:', error);
      return NextResponse.json({ error: 'Failed to create activity profile' }, { status: 500 });
    }
  }, { permission: 'canModifySettings' });
}
