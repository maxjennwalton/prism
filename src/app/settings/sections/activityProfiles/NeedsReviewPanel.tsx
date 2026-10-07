'use client';

import { useState } from 'react';
import { Check, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { toast } from '@/components/ui/use-toast';
import { useFamily } from '@/components/providers';
import { useActivityProfiles } from '@/lib/hooks/useActivityProfiles';
import { useActivityMatchingStatus } from '@/lib/hooks/useActivityMatchingStatus';
import {
  useActivityMatchingNeedsReview,
  type NeedsReviewItem,
} from '@/lib/hooks/useActivityMatchingNeedsReview';

const REVIEW_REASON_LABEL: Record<NonNullable<NeedsReviewItem['reviewReason']>, string> = {
  unclassified: "Looks like an activity, but doesn't match any profile yet.",
  ambiguous_profile: 'Could match more than one Activity Profile.',
  ambiguous_member: "Can't tell which family member this is for.",
  ambiguous_both: "Can't tell which profile or family member this is for.",
};

function formatEventTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function NeedsReviewRow({
  item,
  profiles,
  members,
  onConfirm,
  onReject,
}: {
  item: NeedsReviewItem;
  profiles: { id: string; name: string }[];
  members: { id: string; name: string }[];
  onConfirm: (id: string, activityProfileId: string | null, assignedMemberId: string | null) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}) {
  const [profileId, setProfileId] = useState(item.activityProfileId);
  const [memberId, setMemberId] = useState(item.assignedMemberId);
  const [working, setWorking] = useState<'confirm' | 'reject' | null>(null);

  const handleConfirm = async () => {
    setWorking('confirm');
    try {
      await onConfirm(item.id, profileId, memberId);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Failed to confirm activity match', variant: 'destructive' });
    } finally {
      setWorking(null);
    }
  };

  const handleReject = async () => {
    setWorking('reject');
    try {
      await onReject(item.id);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Failed to reject activity match', variant: 'destructive' });
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="rounded-md border border-border bg-card p-3 space-y-2.5">
      <div>
        <div className="font-medium truncate">{item.eventTitle}</div>
        <div className="text-xs text-muted-foreground">{formatEventTime(item.eventStartTime)}</div>
        {item.reviewReason && (
          <div className="text-xs text-muted-foreground italic mt-0.5">{REVIEW_REASON_LABEL[item.reviewReason]}</div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={profileId ?? 'none'} onValueChange={(v) => setProfileId(v === 'none' ? null : v)}>
          <SelectTrigger className="w-52" aria-label="Activity profile">
            <SelectValue placeholder="Select a profile" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No profile</SelectItem>
            {profiles.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={memberId ?? 'none'} onValueChange={(v) => setMemberId(v === 'none' ? null : v)}>
          <SelectTrigger className="w-52" aria-label="Family member">
            <SelectValue placeholder="Select a member" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Not assigned</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1.5 ml-auto">
          <Button type="button" variant="outline" size="sm" onClick={handleReject} disabled={working !== null}>
            {working === 'reject' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <X className="h-4 w-4 mr-1.5" />}
            Not an activity
          </Button>
          <Button type="button" size="sm" onClick={handleConfirm} disabled={working !== null || !profileId}>
            {working === 'confirm' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Check className="h-4 w-4 mr-1.5" />}
            Confirm
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Activity Matching's human-in-the-loop queue: links the matcher flagged as
 * ambiguous (profile, member, or both) or that looked like an activity but
 * matched no profile. Only shown once matching is enabled and there's
 * something to review — see the Activity Matching card's layout.
 */
export function NeedsReviewPanel() {
  const { status } = useActivityMatchingStatus();
  const { members } = useFamily();
  const { profiles } = useActivityProfiles();
  const { items, confirm, reject } = useActivityMatchingNeedsReview();

  if (!status.enabled || items.length === 0) return null;

  const memberOptions = members.filter((m) => m.id).map((m) => ({ id: m.id, name: m.name }));
  const profileOptions = profiles.map((p) => ({ id: p.id, name: p.name }));

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Review Required ({items.length})</h3>
        <p className="text-sm text-muted-foreground">
          These events couldn&apos;t be matched automatically. Confirm the right profile and member, or mark them as not an activity.
        </p>
      </div>

      <div className="space-y-2">
        {items.map((item) => (
          <NeedsReviewRow
            key={item.id}
            item={item}
            profiles={profileOptions}
            members={memberOptions}
            onConfirm={confirm}
            onReject={reject}
          />
        ))}
      </div>
    </div>
  );
}
