'use client';

import { useMemo } from 'react';
import { Eye, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useFamily } from '@/components/providers';
import { useActivityProfiles } from '@/lib/hooks/useActivityProfiles';
import { useActivityMatchingPreview, type ActivityMatchEventSummary } from '@/lib/hooks/useActivityMatchingPreview';

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
    return <Badge variant="secondary">Would need review</Badge>;
  }
  return <Badge variant="outline">Not an activity</Badge>;
}

/**
 * Read-only preview of what Activity Matching would do over the next 60
 * days, run on demand against the exact same matcher Activate uses — never
 * on page load, never saving anything. See useActivityMatchingPreview.
 */
export function PreviewMatchesPanel() {
  const { members } = useFamily();
  const { profiles } = useActivityProfiles({ includeArchived: true });
  const { summary, loading, error, runPreview } = useActivityMatchingPreview();

  const profileNames = useMemo(() => new Map(profiles.map((p) => [p.id, p.name])), [profiles]);
  const memberNames = useMemo(() => new Map(members.filter((m) => m.id).map((m) => [m.id, m.name])), [members]);

  const nameOf = (id: string | null, names: Map<string, string>) => (id ? names.get(id) ?? 'Unknown' : '—');

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Preview Matches</h3>
        <p className="text-sm text-muted-foreground">
          See what matching would do over the next 60 days before turning it on. This never saves anything.
        </p>
      </div>

      <Button type="button" variant="outline" size="sm" onClick={runPreview} disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Eye className="h-4 w-4 mr-1.5" />}
        {loading ? 'Checking…' : 'Preview Matches'}
      </Button>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {summary && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {summary.total === 0
              ? 'No unmatched events in the next 60 days.'
              : `${summary.autoMatched} would auto-match · ${summary.needsReview} would need review · ${summary.ignored} not activities — preview only, nothing saved.`}
          </p>

          {summary.results.length > 0 && (
            <div className="rounded-md border border-border divide-y divide-border overflow-hidden max-h-80 overflow-y-auto">
              {summary.results.map((row) => (
                <div key={row.eventId} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{row.title}</div>
                    <div className="text-xs text-muted-foreground">{formatEventTime(row.startTime)}</div>
                  </div>
                  <div className="text-xs text-muted-foreground text-right shrink-0">
                    {row.result.outcome !== 'ignore' && (
                      <div>
                        {nameOf(row.result.profileId, profileNames)} · {nameOf(row.result.memberId, memberNames)}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0">{outcomeBadge(row)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
