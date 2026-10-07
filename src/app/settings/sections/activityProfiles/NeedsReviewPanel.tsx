'use client';

import { useState } from 'react';
import { Check, X, Loader2, RefreshCw } from 'lucide-react';
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

interface ReviewReasonCopy {
  /** Short, bold lead-in shown above the description — only reasons that need one set it. */
  title?: string;
  description: string;
}

const STATIC_REVIEW_REASON_LABEL: Record<Exclude<NonNullable<NeedsReviewItem['reviewReason']>, 'unclassified'>, ReviewReasonCopy> = {
  ambiguous_profile: { description: 'Could match more than one Activity Profile.' },
  ambiguous_member: { description: "Can't tell which family member this is for." },
  ambiguous_both: { description: "Can't tell which profile or family member this is for." },
  ambiguous_category: { description: 'This event’s identifiers point to more than one category (e.g. Hockey and Soccer) — fix the category on one of them.' },
  category_unresolved: {
    title: 'Activity type not recognized',
    description: "Prism found a possible activity but doesn't know what type it is yet. Choose the correct Activity Profile below, or mark it as Not an Activity.",
  },
};

/**
 * `unclassified` means: an identifier matched this title, so Prism is
 * confident it's a real activity, but no Activity Profile's keywords
 * matched it. Whether that identifier also resolved to exactly one family
 * member is a second, independent fact worth saying out loud, rather than
 * leaving a parent to guess from a profile dropdown why the event got here
 * at all. `memberName` is the resolved member's display name, or null when
 * the matched identifier(s) didn't resolve to exactly one person.
 */
function unclassifiedCopy(memberName: string | null): ReviewReasonCopy {
  if (memberName) {
    return {
      title: 'No matching Activity Profile',
      description: `Prism knows this is ${memberName}'s activity, but there isn't a matching Activity Profile yet. Choose one below, create a new profile, or mark it as Not an Activity.`,
    };
  }
  return {
    title: 'No matching Activity Profile',
    description:
      "Prism recognized this as a scheduled activity, but there isn't a matching Activity Profile yet and it isn't sure which family member it's for. Choose the correct profile and family member below, or mark it as Not an Activity.",
  };
}

function reviewReasonCopy(reason: NonNullable<NeedsReviewItem['reviewReason']>, memberName: string | null): ReviewReasonCopy {
  return reason === 'unclassified' ? unclassifiedCopy(memberName) : STATIC_REVIEW_REASON_LABEL[reason];
}

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
  onReevaluate,
}: {
  item: NeedsReviewItem;
  profiles: { id: string; name: string }[];
  members: { id: string; name: string }[];
  onConfirm: (id: string, activityProfileId: string | null, assignedMemberId: string | null) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onReevaluate: (id: string) => Promise<void>;
}) {
  const [profileId, setProfileId] = useState(item.activityProfileId);
  const [memberId, setMemberId] = useState(item.assignedMemberId);
  const [working, setWorking] = useState<'confirm' | 'reject' | 'reevaluate' | null>(null);

  // The member the matcher actually resolved for this event (independent of
  // whatever the dropdown below is currently set to) — this is what
  // "Prism knows this is {member}'s activity" refers to.
  const resolvedMemberName = item.assignedMemberId
    ? members.find((m) => m.id === item.assignedMemberId)?.name ?? null
    : null;

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

  const handleReevaluate = async () => {
    setWorking('reevaluate');
    try {
      await onReevaluate(item.id);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Failed to re-evaluate activity match', variant: 'destructive' });
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="rounded-md border border-border bg-card p-3 space-y-2.5">
      <div>
        <div className="font-medium truncate">{item.eventTitle}</div>
        <div className="text-xs text-muted-foreground">{formatEventTime(item.eventStartTime)}</div>
        {item.reviewReason && (() => {
          const copy = reviewReasonCopy(item.reviewReason, resolvedMemberName);
          return (
            <div className="text-xs text-muted-foreground mt-0.5">
              {copy.title && <div className="font-medium text-foreground">{copy.title}</div>}
              <div className="italic">{copy.description}</div>
            </div>
          );
        })()}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={profileId ?? 'none'} onValueChange={(v) => setProfileId(v === 'none' ? null : v)}>
          <SelectTrigger className="w-52" aria-label="Activity profile">
            <SelectValue placeholder="Select a profile" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Choose Activity Profile…</SelectItem>
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
          <Button type="button" variant="outline" size="sm" onClick={handleReevaluate} disabled={working !== null}>
            {working === 'reevaluate' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
            Re-evaluate Match
          </Button>
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
  const { items, confirm, reject, reevaluate } = useActivityMatchingNeedsReview();

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
            onReevaluate={reevaluate}
          />
        ))}
      </div>
    </div>
  );
}
