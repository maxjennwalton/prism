'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useVisibilityPolling } from './useVisibilityPolling';
import {
  computeActivityStatus,
  buildScheduledMilestones,
  sortByUrgency,
  type ActivityWorkflowStatus,
} from '@/lib/utils/activityWorkflowPriority';

export interface ActivityWorkflowPrepStep {
  id: string;
  label: string;
  kind: 'checkable' | 'informational';
  time: Date | null;
  unscheduledReason: string | null;
}

export interface ActivityWorkflowActivity {
  linkId: string;
  eventId: string;
  eventTitle: string;
  eventStart: Date;
  eventEnd: Date;
  memberId: string | null;
  memberName: string | null;
  memberColor: string | null;
  profileId: string | null;
  profileName: string | null;
  profileColor: string | null;
  profileArchived: boolean;
  location: string | null;
  arrivalTime: Date | null;
  leaveHomeTime: Date | null;
  prepSteps: ActivityWorkflowPrepStep[];
  /** Recomputed locally on every countdown tick against the current time — never a stale server snapshot. */
  status: ActivityWorkflowStatus;
}

interface RawPrepStep {
  id: string;
  label: string;
  kind: 'checkable' | 'informational';
  time: string | null;
  unscheduledReason: string | null;
}

interface RawActivityItem {
  linkId: string;
  eventId: string;
  eventTitle: string;
  eventStart: string;
  eventEnd: string;
  memberId: string | null;
  memberName: string | null;
  memberColor: string | null;
  profileId: string | null;
  profileName: string | null;
  profileColor: string | null;
  profileArchived: boolean;
  location: string | null;
  arrivalTime: string | null;
  leaveHomeTime: string | null;
  prepSteps: RawPrepStep[];
}

type ParsedActivity = Omit<ActivityWorkflowActivity, 'status'>;

function isRawActivityItem(v: unknown): v is RawActivityItem {
  return Boolean(v) && typeof v === 'object' && typeof (v as { linkId?: unknown }).linkId === 'string';
}

function parseItem(raw: RawActivityItem): ParsedActivity {
  return {
    linkId: raw.linkId,
    eventId: raw.eventId,
    eventTitle: raw.eventTitle,
    eventStart: new Date(raw.eventStart),
    eventEnd: new Date(raw.eventEnd),
    memberId: raw.memberId,
    memberName: raw.memberName,
    memberColor: raw.memberColor,
    profileId: raw.profileId,
    profileName: raw.profileName,
    profileColor: raw.profileColor,
    profileArchived: raw.profileArchived,
    location: raw.location,
    arrivalTime: raw.arrivalTime ? new Date(raw.arrivalTime) : null,
    leaveHomeTime: raw.leaveHomeTime ? new Date(raw.leaveHomeTime) : null,
    prepSteps: (raw.prepSteps ?? []).map((s) => ({ ...s, time: s.time ? new Date(s.time) : null })),
  };
}

/**
 * Coarse network refresh — the underlying data only changes when a parent
 * confirms/rejects a Review Required item, or a cron tick auto-matches a
 * newly-synced event; nothing on this widget needs second-by-second data
 * freshness. The countdown itself (see COUNTDOWN_TICK_MS) is a separate,
 * much cheaper local-only clock that never refetches.
 */
const DATA_POLL_INTERVAL_MS = 3 * 60 * 1000;

/** Local-only re-render tick for the countdown/phase display — no network call. */
const COUNTDOWN_TICK_MS = 15 * 1000;

/**
 * Data + live countdown for the Activity Workflow widget. Two independent
 * clocks, both routed through useVisibilityPolling so both pause while the
 * tab is hidden or the screensaver is up and catch up exactly once on
 * resume, same as every other dashboard widget's polling:
 *  - a coarse network refetch of today's matched activities
 *  - a cheap local tick that only recomputes status (phase + next/overdue
 *    milestone + urgency order) against the current time — it re-derives
 *    from data already in memory via buildScheduledMilestones +
 *    computeActivityStatus, the same pure functions the server used to
 *    build the response, rather than trusting a status snapshot that goes
 *    stale the moment time passes.
 *
 * Returned `items` are already sorted by urgency (see sortByUrgency) — most
 * actionable first.
 */
export function useActivityWorkflow() {
  const [rawItems, setRawItems] = useState<ParsedActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch('/api/activity-matching/workflow');
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Failed to load activity workflow');
      }
      const data = await res.json();
      const items = Array.isArray(data?.items) ? data.items.filter(isRawActivityItem).map(parseItem) : [];
      setRawItems(items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity workflow');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useVisibilityPolling(fetchItems, DATA_POLL_INTERVAL_MS);
  useVisibilityPolling(useCallback(() => setNow(new Date()), []), COUNTDOWN_TICK_MS);

  const items = useMemo(() => {
    const withStatus: ActivityWorkflowActivity[] = rawItems.map((item) => ({
      ...item,
      status: computeActivityStatus(now, item.eventStart, item.eventEnd, buildScheduledMilestones(item)),
    }));
    return sortByUrgency(withStatus);
  }, [rawItems, now]);

  const refresh = useCallback(() => fetchItems(), [fetchItems]);

  // Exposed so callers computing their own display text (e.g. a countdown
  // label) use this same tick rather than calling Date.now() fresh during
  // render — React's purity rule flags that as an impure render, and it
  // would drift from the instant `items[].status` was actually computed
  // against on this exact render.
  return { items, loading, error, refresh, now };
}
