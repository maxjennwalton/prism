/**
 * Data-access foundations for Activity Profiles (Sports & Activity Assistant,
 * Phase 1). Plain CRUD only — no event matching, no derived-time calculation,
 * no API routes, no UI. Those are later phases.
 *
 * Nothing here ever touches `events` or any sync code path. activity_event_links
 * rows are additive annotations keyed to Prism's own local events.id, exactly
 * like calendar_notes and dismissed_events.
 */
import { and, asc, eq } from 'drizzle-orm';
import { db, type DbExecutor } from './client';
import {
  activityProfiles,
  activityProfilePrepSteps,
  activityEventLinks,
  activityGearCompletions,
  type ActivityGearItem,
  type ActivityMatchMeta,
} from './schema';
import type { PrepStepAnchor } from '@/lib/constants/activityProfiles';

type ActivityMatchStatus = 'auto_confirmed' | 'needs_review' | 'confirmed' | 'rejected';

// ACTIVITY PROFILES

export interface CreateActivityProfileInput {
  name: string;
  category?: string | null;
  color?: string | null;
  matchKeywords?: string[];
  /** Minutes to arrive before the event starts. Omit or pass null — never guess a value. */
  arrivalBufferMinutes?: number | null;
  /** Manual v1 travel-time estimate in minutes. Omit or pass null — never guess a value. */
  travelMinutes?: number | null;
  defaultLocation?: string | null;
  gearItems?: ActivityGearItem[];
  createdBy?: string | null;
}

export async function listActivityProfiles(opts: { includeArchived?: boolean } = {}, executor: DbExecutor = db) {
  const rows = await executor.select().from(activityProfiles).orderBy(asc(activityProfiles.name));
  return opts.includeArchived ? rows : rows.filter((p) => !p.archived);
}

export async function getActivityProfile(id: string) {
  const [row] = await db.select().from(activityProfiles).where(eq(activityProfiles.id, id));
  return row ?? null;
}

/**
 * Inserts a new profile. Any buffer/travel field not supplied stays NULL —
 * never defaulted to a guessed number. Accepts an optional transaction
 * executor so the API route can keep this write and the automatic
 * needs_review re-evaluation it triggers atomic — see
 * reevaluateAllNeedsReview.
 */
export async function createActivityProfile(input: CreateActivityProfileInput, executor: DbExecutor = db) {
  const [row] = await executor
    .insert(activityProfiles)
    .values({
      name: input.name,
      category: input.category ?? null,
      color: input.color ?? null,
      matchKeywords: input.matchKeywords ?? [],
      arrivalBufferMinutes: input.arrivalBufferMinutes ?? null,
      travelMinutes: input.travelMinutes ?? null,
      defaultLocation: input.defaultLocation ?? null,
      gearItems: input.gearItems ?? [],
      createdBy: input.createdBy ?? null,
    })
    .returning();
  return row!;
}

export interface UpdateActivityProfileInput {
  name?: string;
  category?: string | null;
  color?: string | null;
  matchKeywords?: string[];
  arrivalBufferMinutes?: number | null;
  travelMinutes?: number | null;
  defaultLocation?: string | null;
  gearItems?: ActivityGearItem[];
  archived?: boolean;
}

/** Accepts an optional transaction executor for the same reason createActivityProfile does. */
export async function updateActivityProfile(id: string, input: UpdateActivityProfileInput, executor: DbExecutor = db) {
  const [row] = await executor
    .update(activityProfiles)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(activityProfiles.id, id))
    .returning();
  return row ?? null;
}

// PREP STEPS

export interface CreatePrepStepInput {
  activityProfileId: string;
  label: string;
  sortOrder?: number;
  anchor: PrepStepAnchor;
  offsetMinutes: number;
  isCheckable?: boolean;
  linksGear?: boolean;
  assignedMemberId?: string | null;
}

export async function listPrepSteps(activityProfileId: string) {
  return db
    .select()
    .from(activityProfilePrepSteps)
    .where(eq(activityProfilePrepSteps.activityProfileId, activityProfileId))
    .orderBy(asc(activityProfilePrepSteps.sortOrder));
}

export async function createPrepStep(input: CreatePrepStepInput) {
  const [row] = await db
    .insert(activityProfilePrepSteps)
    .values({
      activityProfileId: input.activityProfileId,
      label: input.label,
      sortOrder: input.sortOrder ?? 0,
      anchor: input.anchor,
      offsetMinutes: input.offsetMinutes,
      isCheckable: input.isCheckable ?? true,
      linksGear: input.linksGear ?? false,
      assignedMemberId: input.assignedMemberId ?? null,
    })
    .returning();
  return row!;
}

export interface UpdatePrepStepInput {
  label?: string;
  sortOrder?: number;
  anchor?: PrepStepAnchor;
  offsetMinutes?: number;
  isCheckable?: boolean;
  linksGear?: boolean;
  assignedMemberId?: string | null;
}

export async function updatePrepStep(id: string, input: UpdatePrepStepInput) {
  const [row] = await db
    .update(activityProfilePrepSteps)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(activityProfilePrepSteps.id, id))
    .returning();
  return row ?? null;
}

export async function deletePrepStep(id: string) {
  await db.delete(activityProfilePrepSteps).where(eq(activityProfilePrepSteps.id, id));
}

// EVENT LINKS

export async function getActivityEventLink(eventId: string, executor: DbExecutor = db) {
  const [row] = await executor.select().from(activityEventLinks).where(eq(activityEventLinks.eventId, eventId));
  return row ?? null;
}

export interface CreateActivityEventLinkInput {
  eventId: string;
  activityProfileId?: string | null;
  assignedMemberId?: string | null;
  responsibleAdultId?: string | null;
  arrivalBufferMinutesOverride?: number | null;
  travelMinutesOverride?: number | null;
  locationOverride?: string | null;
  autoMatched?: boolean;
  /** Phase 3 (Activity Event Matching). Omit for a manually created link. */
  matchStatus?: ActivityMatchStatus | null;
  matchMeta?: ActivityMatchMeta | null;
}

/**
 * Creates the link for an event if one doesn't exist yet; never overwrites an
 * existing row. This is the "don't reconsider a row a human already touched"
 * convention the matcher relies on — mirrors how birthday detection treats an
 * existing/dismissed row as settled.
 *
 * Accepts an optional transaction executor (the `tx` passed into a
 * `db.transaction(async (tx) => ...)` callback) so the activation flow can
 * run its backfill and its settings write as one atomic unit — a failed
 * insert rolls back every link already written in the same call.
 */
export async function createActivityEventLinkIfAbsent(input: CreateActivityEventLinkInput, executor: DbExecutor = db) {
  const existing = await getActivityEventLink(input.eventId, executor);
  if (existing) return existing;

  const [row] = await executor
    .insert(activityEventLinks)
    .values({
      eventId: input.eventId,
      activityProfileId: input.activityProfileId ?? null,
      assignedMemberId: input.assignedMemberId ?? null,
      responsibleAdultId: input.responsibleAdultId ?? null,
      arrivalBufferMinutesOverride: input.arrivalBufferMinutesOverride ?? null,
      travelMinutesOverride: input.travelMinutesOverride ?? null,
      locationOverride: input.locationOverride ?? null,
      autoMatched: input.autoMatched ?? true,
      matchStatus: input.matchStatus ?? null,
      matchMeta: input.matchMeta ?? null,
    })
    .returning();
  return row!;
}

export interface UpdateActivityEventLinkInput {
  activityProfileId?: string | null;
  assignedMemberId?: string | null;
  responsibleAdultId?: string | null;
  arrivalBufferMinutesOverride?: number | null;
  travelMinutesOverride?: number | null;
  locationOverride?: string | null;
  /** Phase 3 review actions (Confirm / Change Profile / Change Member / Not an Activity). */
  matchStatus?: ActivityMatchStatus | null;
  matchMeta?: ActivityMatchMeta | null;
}

/** A human edit. Always clears autoMatched so the matcher leaves this row alone from now on. */
export async function updateActivityEventLink(id: string, input: UpdateActivityEventLinkInput, executor: DbExecutor = db) {
  const [row] = await executor
    .update(activityEventLinks)
    .set({ ...input, autoMatched: false, updatedAt: new Date() })
    .where(eq(activityEventLinks.id, id))
    .returning();
  return row ?? null;
}

// GEAR COMPLETIONS

export async function listGearCompletions(activityEventLinkId: string) {
  return db
    .select()
    .from(activityGearCompletions)
    .where(eq(activityGearCompletions.activityEventLinkId, activityEventLinkId));
}

/** Sets one gear item's checked state for one occurrence — never affects any other occurrence of the same activity. */
export async function setGearItemChecked(
  activityEventLinkId: string,
  gearItemId: string,
  checked: boolean,
  checkedBy: string | null,
) {
  const [existing] = await db
    .select()
    .from(activityGearCompletions)
    .where(and(
      eq(activityGearCompletions.activityEventLinkId, activityEventLinkId),
      eq(activityGearCompletions.gearItemId, gearItemId),
    ));

  const checkedAt = checked ? new Date() : null;

  if (existing) {
    const [row] = await db
      .update(activityGearCompletions)
      .set({ checked, checkedBy, checkedAt })
      .where(eq(activityGearCompletions.id, existing.id))
      .returning();
    return row!;
  }

  const [row] = await db
    .insert(activityGearCompletions)
    .values({ activityEventLinkId, gearItemId, checked, checkedBy, checkedAt })
    .returning();
  return row!;
}
