'use client';

import { useCallback, useEffect, useState } from 'react';

// Mirrors GET /api/activity-matching/needs-review's response shape (see
// src/lib/services/activityMatching.ts's NeedsReviewRow).
export interface NeedsReviewItem {
  id: string;
  eventId: string;
  eventTitle: string;
  eventStartTime: string;
  activityProfileId: string | null;
  assignedMemberId: string | null;
  reviewReason:
    | 'unclassified'
    | 'ambiguous_profile'
    | 'ambiguous_member'
    | 'ambiguous_both'
    | 'ambiguous_category'
    | 'category_unresolved'
    | null;
  profileCandidates: { profileId: string; matchedPhrase: string }[];
  memberCandidates: string[];
  identifiersFound: string[];
  resolvedCategory: string | null;
  categoryCandidates: string[];
}

async function parseOrThrow(res: Response, fallback: string): Promise<void> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || fallback);
  }
}

/**
 * Links Activity Matching couldn't resolve on its own, plus the two ways a
 * household settles one: confirm (optionally after changing the proposed
 * profile/member) or reject ("not an activity").
 */
export function useActivityMatchingNeedsReview() {
  const [items, setItems] = useState<NeedsReviewItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/activity-matching/needs-review');
      if (res.ok) {
        const data = await res.json();
        setItems(Array.isArray(data?.items) ? data.items : []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const confirm = useCallback(async (id: string, activityProfileId: string | null, assignedMemberId: string | null) => {
    const res = await fetch(`/api/activity-matching/needs-review/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'confirm', activityProfileId, assignedMemberId }),
    });
    await parseOrThrow(res, 'Failed to confirm activity match');
    await refresh();
  }, [refresh]);

  const reject = useCallback(async (id: string) => {
    const res = await fetch(`/api/activity-matching/needs-review/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'reject' }),
    });
    await parseOrThrow(res, 'Failed to reject activity match');
    await refresh();
  }, [refresh]);

  return { items, loading, refresh, confirm, reject };
}
