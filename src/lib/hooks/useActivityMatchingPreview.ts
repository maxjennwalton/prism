'use client';

import { useCallback, useState } from 'react';

// Mirrors GET /api/activity-matching/preview's response shape exactly (see
// src/lib/services/activityMatching.ts and src/lib/matching/activityMatcher.ts)
// rather than importing those server-only modules into client code.

export interface ActivityMatchResult {
  outcome: 'auto_match' | 'needs_review' | 'ignore';
  profileId: string | null;
  memberId: string | null;
  matchStatus: 'auto_confirmed' | 'needs_review' | null;
  reviewReason: 'unclassified' | 'ambiguous_profile' | 'ambiguous_member' | 'ambiguous_both' | 'ambiguous_category' | null;
  matchedPhrase: string | null;
  profileCandidates: { profileId: string; matchedPhrase: string }[];
  memberCandidates: string[];
  identifiersFound: string[];
  resolvedCategory: string | null;
  categoryCandidates: string[];
}

export interface ActivityMatchEventSummary {
  eventId: string;
  title: string;
  startTime: string;
  result: ActivityMatchResult;
}

export interface ActivityMatchRangeSummary {
  total: number;
  autoMatched: number;
  needsReview: number;
  ignored: number;
  results: ActivityMatchEventSummary[];
}

/**
 * Runs the read-only Activity Matching preview on demand — never on mount,
 * never polled. The endpoint itself writes nothing; this hook additionally
 * never calls it until `runPreview` is invoked, so opening Settings can
 * never trigger a matching pass.
 */
export function useActivityMatchingPreview() {
  const [summary, setSummary] = useState<ActivityMatchRangeSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/activity-matching/preview');
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? 'Failed to preview activity matches');
      }
      const data = (await res.json()) as ActivityMatchRangeSummary;
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to preview activity matches');
    } finally {
      setLoading(false);
    }
  }, []);

  return { summary, loading, error, runPreview };
}
