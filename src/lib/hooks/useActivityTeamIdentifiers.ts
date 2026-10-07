'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Settings-backed (not Family Members) mapping of team codes / calendar tags
 * to the family member they belong to — e.g. "U9MD" -> Beckham. Activity
 * matching uses this to resolve who an event is for; it is deliberately
 * independent of which Activity Profile (if any) the event's title matches.
 */
export interface ActivityTeamIdentifier {
  identifier: string;
  memberId: string;
  /**
   * Which sport/activity this identifier belongs to (e.g. "Hockey"), used to
   * narrow which Activity Profiles matching considers for this event. Null
   * means "no category context" — matching falls back to searching every
   * profile, exactly as it did before this field existed.
   */
  category: string | null;
}

const SETTING_KEY = 'activityTeamIdentifiers';

function normalizeIdentifiers(value: unknown): ActivityTeamIdentifier[] {
  if (!Array.isArray(value)) return [];
  const result: ActivityTeamIdentifier[] = [];
  for (const entry of value) {
    if (
      entry &&
      typeof entry === 'object' &&
      typeof (entry as { identifier?: unknown }).identifier === 'string' &&
      typeof (entry as { memberId?: unknown }).memberId === 'string'
    ) {
      const category = (entry as { category?: unknown }).category;
      result.push({
        identifier: (entry as { identifier: string }).identifier,
        memberId: (entry as { memberId: string }).memberId,
        category: typeof category === 'string' && category.trim().length > 0 ? category : null,
      });
    }
  }
  return result;
}

export function useActivityTeamIdentifiers() {
  const [identifiers, setIdentifiers] = useState<ActivityTeamIdentifier[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setIdentifiers(normalizeIdentifiers(data?.settings?.[SETTING_KEY]));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveIdentifiers = useCallback(async (next: ActivityTeamIdentifier[]) => {
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: SETTING_KEY, value: next }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error ?? 'Failed to save identifiers');
    }
    setIdentifiers(next);
  }, []);

  return { identifiers, loading, refresh, saveIdentifiers };
}
