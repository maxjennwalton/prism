'use client';

import { useCallback } from 'react';
import { useFetch } from './useFetch';
import type { ActivityGearItem } from '@/types';
import type { PrepStepAnchor } from '@/lib/constants/activityProfiles';

// These mirror exactly what the API routes return (plain id/string fields,
// not expanded relation objects) — see src/lib/db/activityProfiles.ts.

export interface ActivityProfileListItem {
  id: string;
  name: string;
  category: string | null;
  color: string | null;
  matchKeywords: string[];
  arrivalBufferMinutes: number | null;
  travelMinutes: number | null;
  defaultLocation: string | null;
  gearItems: ActivityGearItem[];
  archived: boolean;
  prepStepCount: number;
  gearItemCount: number;
  matchKeywordCount: number;
}

export interface ActivityProfilePrepStepRow {
  id: string;
  activityProfileId: string;
  label: string;
  sortOrder: number;
  anchor: PrepStepAnchor;
  offsetMinutes: number;
  isCheckable: boolean;
  linksGear: boolean;
  assignedMemberId: string | null;
}

export interface ActivityProfileDetail extends Omit<ActivityProfileListItem, 'prepStepCount' | 'gearItemCount' | 'matchKeywordCount'> {
  prepSteps: ActivityProfilePrepStepRow[];
}

export interface ActivityProfileFormInput {
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

function transformList(json: unknown): ActivityProfileListItem[] {
  return ((json as { profiles: ActivityProfileListItem[] }).profiles) ?? [];
}

async function parseOrThrow(res: Response, fallback: string): Promise<unknown> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || fallback);
  }
  return res.json();
}

/**
 * List + top-level mutations for Activity Profiles (Phase 2 — management UI
 * only; no matching, derived times, or dashboard integration yet).
 */
export function useActivityProfiles(opts: { includeArchived?: boolean } = {}) {
  const url = `/api/activity-profiles${opts.includeArchived ? '?includeArchived=true' : ''}`;
  const { data: profiles, loading, error, refresh } = useFetch<ActivityProfileListItem[]>({
    url,
    initialData: [],
    transform: transformList,
    label: 'activity profiles',
  });

  const createProfile = useCallback(async (input: ActivityProfileFormInput) => {
    const res = await fetch('/api/activity-profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await parseOrThrow(res, 'Failed to create activity profile');
    await refresh();
    return data as ActivityProfileListItem;
  }, [refresh]);

  const updateProfile = useCallback(async (id: string, input: ActivityProfileFormInput) => {
    const res = await fetch(`/api/activity-profiles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await parseOrThrow(res, 'Failed to update activity profile');
    await refresh();
    return data as ActivityProfileListItem;
  }, [refresh]);

  const archiveProfile = useCallback((id: string) => updateProfile(id, { archived: true }), [updateProfile]);
  const restoreProfile = useCallback((id: string) => updateProfile(id, { archived: false }), [updateProfile]);

  const duplicateProfile = useCallback(async (id: string) => {
    const res = await fetch(`/api/activity-profiles/${id}/duplicate`, { method: 'POST' });
    const data = await parseOrThrow(res, 'Failed to duplicate activity profile');
    await refresh();
    return data as ActivityProfileListItem;
  }, [refresh]);

  return { profiles, loading, error, refresh, createProfile, updateProfile, archiveProfile, restoreProfile, duplicateProfile };
}

/** One-off detail fetch for opening the editor — not a live-polling hook. */
export async function fetchActivityProfileDetail(id: string): Promise<ActivityProfileDetail> {
  const res = await fetch(`/api/activity-profiles/${id}`);
  return parseOrThrow(res, 'Failed to load activity profile') as Promise<ActivityProfileDetail>;
}

export interface PrepStepInput {
  label: string;
  sortOrder?: number;
  anchor: PrepStepAnchor;
  offsetMinutes: number;
  isCheckable?: boolean;
  linksGear?: boolean;
  assignedMemberId?: string | null;
}

export async function createPrepStepRequest(profileId: string, input: PrepStepInput): Promise<ActivityProfilePrepStepRow> {
  const res = await fetch(`/api/activity-profiles/${profileId}/prep-steps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseOrThrow(res, 'Failed to add preparation step') as Promise<ActivityProfilePrepStepRow>;
}

export async function updatePrepStepRequest(profileId: string, stepId: string, input: Partial<PrepStepInput>): Promise<ActivityProfilePrepStepRow> {
  const res = await fetch(`/api/activity-profiles/${profileId}/prep-steps/${stepId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseOrThrow(res, 'Failed to update preparation step') as Promise<ActivityProfilePrepStepRow>;
}

export async function deletePrepStepRequest(profileId: string, stepId: string): Promise<void> {
  const res = await fetch(`/api/activity-profiles/${profileId}/prep-steps/${stepId}`, { method: 'DELETE' });
  await parseOrThrow(res, 'Failed to remove preparation step');
}
