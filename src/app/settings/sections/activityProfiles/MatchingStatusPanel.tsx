'use client';

import { useState } from 'react';
import { Power, PowerOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
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
 *
 * The OFF state is deliberately its own visually distinct block (a tinted,
 * bordered container) rather than a small badge next to a button — real
 * households testing this read a "Disabled" pill + "Enable" button as
 * ambiguous about whether matching was already running. The container
 * tint is neutral (muted), never destructive/red: being off isn't an
 * error, just a state.
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

  if (loading) {
    return (
      <div className="space-y-2">
        <Badge variant="outline">Checking…</Badge>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-md border p-4 space-y-3',
        status.enabled ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/40',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn('h-2.5 w-2.5 rounded-full shrink-0', status.enabled ? 'bg-primary' : 'bg-muted-foreground/50')}
          aria-hidden="true"
        />
        <h3 className="text-base font-semibold">Activity Matching is {status.enabled ? 'ON' : 'OFF'}</h3>
      </div>

      {status.enabled && status.enabledAt && (
        <p className="text-xs text-muted-foreground">Since {formatEnabledSince(status.enabledAt)}</p>
      )}

      <p className="text-sm text-muted-foreground">
        {status.enabled
          ? 'New calendar events are automatically checked against your Activity Profiles.'
          : 'Calendar events are not currently being matched automatically.'}
      </p>

      {status.enabled ? (
        <Button type="button" variant="outline" size="sm" onClick={handleDisable} disabled={working}>
          {working ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <PowerOff className="h-4 w-4 mr-1.5" />}
          Turn Off Activity Matching
        </Button>
      ) : (
        <Button type="button" size="sm" onClick={handleEnable} disabled={working}>
          {working ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Power className="h-4 w-4 mr-1.5" />}
          Turn On Activity Matching
        </Button>
      )}

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
