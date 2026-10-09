'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { travelSourceLabel, type ActivityTravelSource } from '@/lib/utils/activityTravelResolution';

interface UpcomingTravelItem {
  linkId: string;
  eventTitle: string;
  eventStart: string;
  memberName: string | null;
  destination: string | null;
  departureLocationOverride: string | null;
  travelMinutesOverride: number | null;
  travelSource: ActivityTravelSource;
  travelMinutes: number | null;
}

function formatEventTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function travelLabel(minutes: number | null, source: ActivityTravelSource): string {
  const base = travelSourceLabel(source);
  if (minutes === null) return base;
  return `${minutes} min · ${base}`;
}

/**
 * Human-facing explanation for a failed calculation — travel_meta's own
 * failureReason is an internal diagnostic code (e.g. "destination_
 * ambiguous_address", "provider_timeout") never meant to be shown to a
 * parent verbatim (see RouteFailureReason's doc comment in routing/types.ts).
 */
function describeFailure(failureReason: string | null): string {
  if (!failureReason) return 'Could not calculate a route.';
  if (failureReason.startsWith('departure_') || failureReason.startsWith('destination_')) {
    const side = failureReason.startsWith('departure_') ? 'departure address' : 'destination address';
    return failureReason.endsWith('ambiguous_address')
      ? `The ${side} is ambiguous — try adding more detail.`
      : `Could not find the ${side}.`;
  }
  switch (failureReason) {
    case 'rate_limited':
      return 'Too many requests right now — try again in a minute.';
    case 'provider_timeout':
      return 'The routing service timed out.';
    case 'not_configured':
      return 'No routing provider is configured.';
    default:
      return 'The routing service could not calculate a route.';
  }
}

/**
 * Phase 4B: the next two weeks of settled activities, each with its
 * effective travel estimate and a per-event departure override a parent
 * can set (e.g. "leaving from Grandma's" for one specific game) — saving
 * one here never changes the household's default Home address (see
 * HomeAddressCard, a separate setting entirely). A manual refresh forces
 * a fresh attempt right away rather than waiting for the next cron tick.
 */
export function ActivityTravelPanel() {
  const [items, setItems] = useState<UpcomingTravelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/activity-matching/links/upcoming');
      const data = await res.json();
      setItems(data.items ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const draftFor = (item: UpcomingTravelItem) => drafts[item.linkId] ?? item.departureLocationOverride ?? '';

  const saveDeparture = async (item: UpcomingTravelItem) => {
    setSavingId(item.linkId);
    try {
      const value = draftFor(item).trim();
      const res = await fetch(`/api/activity-matching/links/${item.linkId}/departure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ departureLocationOverride: value || null }),
      });
      if (!res.ok) throw new Error('Failed to save departure override');
      toast({ title: 'Departure updated' });
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Failed to save departure override', variant: 'destructive' });
    } finally {
      setSavingId(null);
    }
  };

  const refresh = async (item: UpcomingTravelItem) => {
    setRefreshingId(item.linkId);
    try {
      const res = await fetch(`/api/activity-matching/links/${item.linkId}/refresh-travel`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to refresh travel estimate');
      const data = await res.json();
      const travelMeta = data.travelMeta as { status: 'ok' | 'unavailable'; failureReason: string | null } | null;

      // The request itself succeeding (HTTP 200) is not the same as the
      // route calculation succeeding — travelMeta.status carries the real
      // outcome, and a failed attempt must never read as a success toast.
      if (travelMeta?.status === 'unavailable') {
        toast({ title: 'Travel estimate unavailable', description: describeFailure(travelMeta.failureReason), variant: 'destructive' });
      } else {
        toast({ title: 'Travel estimate refreshed' });
      }
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Failed to refresh travel estimate', variant: 'destructive' });
    } finally {
      setRefreshingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming Activity Travel</CardTitle>
        <CardDescription>
          Driving-time estimates for the next two weeks. Set a one-off departure point for a specific activity, or refresh an estimate on demand.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
        {!loading && items.length === 0 && (
          <p className="text-sm text-muted-foreground">No upcoming activities in the next two weeks.</p>
        )}
        {items.map((item) => (
          <div key={item.linkId} className="rounded-md border p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {item.eventTitle}
                  {item.memberName ? ` — ${item.memberName}` : ''}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {formatEventTime(item.eventStart)} · {item.destination ?? 'No destination set'}
                </div>
              </div>
              <div className="text-right text-xs text-muted-foreground shrink-0">
                {travelLabel(item.travelMinutes, item.travelSource)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Input
                placeholder="Departs from Home (default)"
                value={draftFor(item)}
                onChange={(e) => setDrafts((d) => ({ ...d, [item.linkId]: e.target.value }))}
                disabled={item.travelMinutesOverride !== null}
                className="h-8 text-xs"
              />
              <Button size="sm" variant="outline" onClick={() => saveDeparture(item)} disabled={savingId === item.linkId}>
                {savingId === item.linkId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
              </Button>
              <Button size="icon" variant="ghost" onClick={() => refresh(item)} disabled={refreshingId === item.linkId} aria-label="Refresh travel estimate">
                <RefreshCw className={refreshingId === item.linkId ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
