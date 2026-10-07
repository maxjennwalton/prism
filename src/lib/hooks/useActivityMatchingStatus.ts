'use client';

import { useCallback, useEffect, useState } from 'react';

export interface ActivityMatchingStatus {
  enabled: boolean;
  enabledAt: string | null;
}

export interface ActivateSummary {
  total: number;
  autoMatched: number;
  needsReview: number;
  ignored: number;
}

const SETTING_KEY = 'activityMatchingEnabled';

function normalize(value: unknown): ActivityMatchingStatus {
  const v = (value ?? {}) as Partial<ActivityMatchingStatus>;
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : false,
    enabledAt: typeof v.enabledAt === 'string' ? v.enabledAt : null,
  };
}

/**
 * Whether Activity Matching is on, plus the activate/disable actions.
 * Activation (POST /api/activity-matching/activate) runs the initial
 * backfill and flips the flag atomically on the server — see that route
 * for why. Disabling is a plain write through the generic settings route;
 * there's nothing else to undo, since matching only ever creates rows, and
 * disabling just stops it from creating more.
 */
export function useActivityMatchingStatus() {
  const [status, setStatus] = useState<ActivityMatchingStatus>({ enabled: false, enabledAt: null });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setStatus(normalize(data?.settings?.[SETTING_KEY]));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const activate = useCallback(async (): Promise<ActivateSummary> => {
    const res = await fetch('/api/activity-matching/activate', { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error ?? 'Failed to enable activity matching');
    }
    const data = (await res.json()) as ActivateSummary;
    await refresh();
    return data;
  }, [refresh]);

  const disable = useCallback(async () => {
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: SETTING_KEY, value: { ...status, enabled: false } }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error ?? 'Failed to disable activity matching');
    }
    await refresh();
  }, [refresh, status]);

  return { status, loading, refresh, activate, disable };
}
