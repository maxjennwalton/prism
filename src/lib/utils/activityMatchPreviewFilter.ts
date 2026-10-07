/**
 * Pure, client-side filtering for the Activity Matching Preview table.
 * Takes the array the Preview API already returned and narrows it to one
 * outcome — no fetch, no DB, no mutation of the input. Keeping this as a
 * standalone function (rather than inline in the component) is what makes
 * "selecting a filter never re-runs matching or touches the database" a
 * property of the code rather than something to trust by inspection.
 */
import type { ActivityMatchEventSummary } from '@/lib/hooks/useActivityMatchingPreview';

export const PREVIEW_FILTERS = ['all', 'auto_match', 'needs_review', 'ignore'] as const;
export type PreviewFilter = (typeof PREVIEW_FILTERS)[number];

export const PREVIEW_FILTER_LABEL: Record<PreviewFilter, string> = {
  all: 'All',
  auto_match: 'Auto Match',
  needs_review: 'Review Required',
  ignore: 'Not an Activity',
};

export function filterPreviewResults(
  results: ActivityMatchEventSummary[],
  filter: PreviewFilter,
): ActivityMatchEventSummary[] {
  if (filter === 'all') return results;
  return results.filter((row) => row.result.outcome === filter);
}
