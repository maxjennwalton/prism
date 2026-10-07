'use client';

import { useState } from 'react';
import { Power, PowerOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useConfirmDialog } from '@/lib/hooks/useConfirmDialog';
import { useActivityMatchingStatus } from '@/lib/hooks/useActivityMatchingStatus';

function formatEnabledSince(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Explicit on/off switch for Activity Matching. Turning it on runs the
 * initial backfill over the next 60 days immediately (see
 * /api/activity-matching/activate) — nothing happens automatically before
 * this is clicked.
 */
export function MatchingStatusPanel() {
  const { status, loading, activate, disable } = useActivityMatchingStatus();
  const [working, setWorking] = useState(false);
  const { confirm, dialogProps } = useConfirmDialog();

  const handleEnable = async () => {
    setWorking(true);
    try {
      const summary = await activate();
      toast({
        title: 'Activity Matching enabled',
        description: `${summary.autoMatched} event${summary.autoMatched === 1 ? '' : 's'} auto-matched, ${summary.needsReview} need${summary.needsReview === 1 ? 's' : ''} review.`,
      });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Failed to enable activity matching', variant: 'destructive' });
    } finally {
      setWorking(false);
    }
  };

  const handleDisable = async () => {
    const ok = await confirm(
      'Turn off Activity Matching?',
      'Existing matches are kept — this only stops new events from being matched automatically.',
    );
    if (!ok) return;
    setWorking(true);
    try {
      await disable();
      toast({ title: 'Activity Matching disabled' });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Failed to disable activity matching', variant: 'destructive' });
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">Matching Status</h3>
        <p className="text-sm text-muted-foreground">
          When enabled, new calendar events are automatically checked against your Activity Profiles and identifiers over the next 60 days.
        </p>
      </div>

      <div className="flex items-center gap-3">
        {loading ? (
          <Badge variant="outline">Checking…</Badge>
        ) : status.enabled ? (
          <Badge variant="default">Enabled{status.enabledAt ? ` since ${formatEnabledSince(status.enabledAt)}` : ''}</Badge>
        ) : (
          <Badge variant="outline">Disabled</Badge>
        )}

        {!loading &&
          (status.enabled ? (
            <Button type="button" variant="outline" size="sm" onClick={handleDisable} disabled={working}>
              {working ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <PowerOff className="h-4 w-4 mr-1.5" />}
              Disable
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={handleEnable} disabled={working}>
              {working ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Power className="h-4 w-4 mr-1.5" />}
              Enable
            </Button>
          ))}
      </div>

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
