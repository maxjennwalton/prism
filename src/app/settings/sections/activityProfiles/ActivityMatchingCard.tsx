'use client';

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { TeamIdentifiersEditor } from './TeamIdentifiersEditor';
import { MatchingStatusPanel } from './MatchingStatusPanel';
import { PreviewMatchesPanel } from './PreviewMatchesPanel';
import { NeedsReviewPanel } from './NeedsReviewPanel';

/**
 * Activity Matching settings: configuring identifiers, enabling/disabling
 * automatic matching, previewing matches, and reviewing ambiguous ones.
 * Sits above the Activity Profiles list since it configures how calendar
 * events get linked to those profiles in the first place.
 *
 * `reviewQueueVersion` is forwarded to PreviewMatchesPanel (to discard a
 * Test snapshot computed before a profile was archived, restored,
 * duplicated, created, or edited) and to NeedsReviewPanel (to re-fetch the
 * Review Required queue after any of those same mutations, or after
 * `onIdentifiersSaved` fires — see each component's own doc comment).
 * Both of those mutations already trigger the backend's own automatic
 * re-evaluation (see reevaluateAllNeedsReview); this is purely about the
 * two sibling panels here learning that happened, not about causing it.
 */
export function ActivityMatchingCard({
  reviewQueueVersion,
  onIdentifiersSaved,
}: {
  reviewQueueVersion: number;
  onIdentifiersSaved: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity Matching</CardTitle>
        <CardDescription>
          Automatically link calendar events to the right Activity Profile and family member.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <TeamIdentifiersEditor onSaved={onIdentifiersSaved} />
        <MatchingStatusPanel />
        <PreviewMatchesPanel reviewQueueVersion={reviewQueueVersion} />
        <NeedsReviewPanel reviewQueueVersion={reviewQueueVersion} />
      </CardContent>
    </Card>
  );
}
