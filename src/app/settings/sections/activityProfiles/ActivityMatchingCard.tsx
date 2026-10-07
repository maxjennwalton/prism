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
 * `profilesVersion` is forwarded to PreviewMatchesPanel so it can discard a
 * preview snapshot that was computed before a profile was archived,
 * restored, duplicated, created, or edited — see its own doc comment.
 */
export function ActivityMatchingCard({ profilesVersion }: { profilesVersion: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity Matching</CardTitle>
        <CardDescription>
          Automatically link calendar events to the right Activity Profile and family member.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <TeamIdentifiersEditor />
        <MatchingStatusPanel />
        <PreviewMatchesPanel profilesVersion={profilesVersion} />
        <NeedsReviewPanel />
      </CardContent>
    </Card>
  );
}
