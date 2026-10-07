'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useFamily } from '@/components/providers';
import { useActivityProfiles } from '@/lib/hooks/useActivityProfiles';
import {
  useActivityMatchingPreview,
  type ActivityMatchEventSummary,
  type ActivityMatchRangeSummary,
} from '@/lib/hooks/useActivityMatchingPreview';
import { PREVIEW_FILTERS, PREVIEW_FILTER_LABEL, filterPreviewResults, type PreviewFilter } from '@/lib/utils/activityMatchPreviewFilter';

function formatEventTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function outcomeBadge(row: ActivityMatchEventSummary) {
  if (row.result.outcome === 'auto_match') {
    return <Badge variant="default">Would auto-match</Badge>;
  }
  if (row.result.outcome === 'needs_review') {
    return <Badge variant="secondary">Review Required</Badge>;
  }
  return <Badge variant="outline">Not an activity</Badge>;
}

/** Fixed per-run totals from the API response — these never change as the filter selection changes. */
function countFor(summary: ActivityMatchRangeSummary, filter: PreviewFilter): number {
  if (filter === 'all') return summary.total;
  if (filter === 'auto_match') return summary.autoMatched;
  if (filter === 'needs_review') return summary.needsReview;
  return summary.ignored;
}

/**
 * Read-only preview of what Activity Matching would do over the next 60
 * days, run on demand against the exact same matcher Activate uses — never
 * on page load, never saving anything. See useActivityMatchingPreview.
 *
 * The filter row below is purely a client-side view over the single
 * preview response already fetched: switching filters narrows which rows
 * are displayed (filterPreviewResults) without a new request, without
 * re-running the matcher, and without touching activity_event_links,
 * events, profiles, or settings. Results are shown in the order the API
 * returned them — ascending by event start time is the service's job
 * (see loadUnlinkedEventsInRange), not something re-sorted here.
 *
 * `profilesVersion` is bumped by ActivityProfilesSection every time a
 * profile is archived, restored, duplicated, created, or edited. Preview
 * is a point-in-time snapshot fetched only on demand (see
 * useActivityMatchingPreview) — if a profile's archived state changes
 * after that snapshot was taken, the snapshot no longer reflects what
 * matching would currently do, so it's discarded rather than left on
 * screen looking current. The matcher call behind Preview has always
 * excluded archived profiles (see matchEventsInRange/listActivityProfiles);
 * what was stale was this component continuing to display a result
 * computed before the archive action.
 */
export function PreviewMatchesPanel({ profilesVersion }: { profilesVersion: number }) {
  const { members } = useFamily();
  const { profiles } = useActivityProfiles({ includeArchived: true });
  const { summary, loading, error, runPreview, clearSummary } = useActivityMatchingPreview();
  const [filter, setFilter] = useState<PreviewFilter>('all');
  const ranAtProfilesVersionRef = useRef<number | null>(null);

  useEffect(() => {
    if (ranAtProfilesVersionRef.current !== null && ranAtProfilesVersionRef.current !== profilesVersion) {
      clearSummary();
      ranAtProfilesVersionRef.current = null;
    }
  }, [profilesVersion, clearSummary]);

  const profileNames = useMemo(() => new Map(profiles.map((p) => [p.id, p.name])), [profiles]);
  const memberNames = useMemo(() => new Map(members.filter((m) => m.id).map((m) => [m.id, m.name])), [members]);

  const nameOf = (id: string | null, names: Map<string, string>) => (id ? names.get(id) ?? 'Unknown' : '—');

  /**
   * No profile was assigned (profileId is null — the review needs a human),
   * but a specific profile is why this row needs review at all (e.g.
   * category_unresolved's excluded-but-keyword-matching profile). Shows it
   * with a "?" so it reads as "this is what triggered the review", never
   * as an assigned match.
   */
  const profileLabel = (row: ActivityMatchEventSummary): string => {
    if (row.result.profileId) return nameOf(row.result.profileId, profileNames);
    const candidateIds = Array.from(new Set(row.result.profileCandidates.map((c) => c.profileId)));
    if (candidateIds.length === 0) return '—';
    return `${candidateIds.map((id) => profileNames.get(id) ?? 'Unknown').join(', ')}?`;
  };

  const visibleResults = useMemo(
    () => (summary ? filterPreviewResults(summary.results, filter) : []),
    [summary, filter],
  );

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Preview Matches</h3>
        <p className="text-sm text-muted-foreground">
          See what matching would do over the next 60 days before turning it on. This never saves anything.
        </p>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setFilter('all');
          ranAtProfilesVersionRef.current = profilesVersion;
          runPreview();
        }}
        disabled={loading}
      >
        {loading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Eye className="h-4 w-4 mr-1.5" />}
        {loading ? 'Checking…' : 'Preview Matches'}
      </Button>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {summary && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter preview results">
            {PREVIEW_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  'text-xs px-2.5 py-1 rounded-full border transition-colors',
                  filter === f
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:bg-muted',
                )}
              >
                {PREVIEW_FILTER_LABEL[f]} ({countFor(summary, f)})
              </button>
            ))}
          </div>

          {summary.total === 0 && (
            <p className="text-xs text-muted-foreground">No unmatched events in the next 60 days.</p>
          )}

          {summary.total > 0 && (
            <>
              <p className="text-xs text-muted-foreground">Preview only — nothing saved.</p>

              {visibleResults.length > 0 ? (
                <div className="rounded-md border border-border divide-y divide-border overflow-hidden max-h-80 overflow-y-auto">
                  {visibleResults.map((row) => (
                    <div key={row.eventId} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{row.title}</div>
                        <div className="text-xs text-muted-foreground">{formatEventTime(row.startTime)}</div>
                      </div>
                      <div className="text-xs text-muted-foreground text-right shrink-0">
                        {row.result.outcome !== 'ignore' && (
                          <div>
                            {profileLabel(row)} · {nameOf(row.result.memberId, memberNames)}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0">{outcomeBadge(row)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No events match this filter.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
