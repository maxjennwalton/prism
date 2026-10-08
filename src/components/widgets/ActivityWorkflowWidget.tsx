'use client';

import * as React from 'react';
import { CalendarClock, MapPin, AlertTriangle } from 'lucide-react';
import { WidgetContainer, WidgetEmpty } from './WidgetContainer';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useTimeFormat } from '@/components/providers';
import { formatDisplayTime } from '@/lib/utils/timeFormat';
import { formatCountdownLabel } from '@/lib/utils/activityWorkflowCountdown';
import { useActivityWorkflow, type ActivityWorkflowActivity, type ActivityWorkflowPrepStep } from '@/lib/hooks/useActivityWorkflow';
import type { ActivityPhase } from '@/lib/utils/activityWorkflowPriority';

export interface ActivityWorkflowWidgetProps {
  className?: string;
  gridW?: number;
  gridH?: number;
}

const PHASE_BADGE: Record<ActivityPhase, { label: string; variant: 'destructive' | 'default' | 'secondary' | 'outline' }> = {
  overdue: { label: 'Overdue', variant: 'destructive' },
  upcoming: { label: 'Upcoming', variant: 'default' },
  in_progress: { label: 'In progress', variant: 'secondary' },
  completed: { label: 'Done', variant: 'outline' },
};

/**
 * Read-only Activity Workflow card (Sports & Activity Assistant, Phase 4A):
 * today's settled matched activities, each with its calculated arrival/
 * leave-home/prep-step timeline and a live countdown to the next actionable
 * deadline. A standalone widget — not a CalendarWidget view — specifically
 * so its countdown ticks (see useActivityWorkflow) never re-render the
 * Calendar widget or anything else on the dashboard.
 *
 * Completed activities (event already ended) are filtered out of display
 * here, not in the hook/service — the data layer stays a complete,
 * independently-testable "today's matched activities" list; only this
 * widget decides a finished activity no longer belongs on screen.
 */
export const ActivityWorkflowWidget = React.memo(function ActivityWorkflowWidget({ className }: ActivityWorkflowWidgetProps) {
  const { items, loading, error, now } = useActivityWorkflow();
  const { timeFormat, displayTimezone } = useTimeFormat();
  const fmtTime = React.useCallback(
    (d: Date) => formatDisplayTime(d, timeFormat, {}, displayTimezone),
    [timeFormat, displayTimezone],
  );

  const visible = items.filter((a) => a.status.phase !== 'completed');
  const [primary, ...rest] = visible;

  return (
    <WidgetContainer
      title="Activity Workflow"
      icon={<CalendarClock className="h-4 w-4" />}
      loading={loading}
      error={error}
      className={className}
    >
      {visible.length === 0 ? (
        <WidgetEmpty icon={<CalendarClock className="h-8 w-8" />} message="No activities scheduled for today." />
      ) : (
        <div className="flex flex-col h-full gap-2 overflow-hidden p-2">
          {primary && <PrimaryActivityCard activity={primary} fmtTime={fmtTime} now={now} />}
          {rest.length > 0 && (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
              {rest.map((activity) => (
                <CompactActivityRow key={activity.linkId} activity={activity} fmtTime={fmtTime} />
              ))}
            </div>
          )}
        </div>
      )}
    </WidgetContainer>
  );
});

/**
 * `now` is passed down from useActivityWorkflow's own tick rather than read
 * here via Date.now() — the same instant `activity.status` was computed
 * against on this render, and calling Date.now() fresh inside a render
 * function is an impure read React's rules flag directly (it can produce a
 * different value on a re-render triggered by something else entirely).
 */
function CountdownLine({ activity, fmtTime, now }: { activity: ActivityWorkflowActivity; fmtTime: (d: Date) => string; now: Date }) {
  const nowMs = now.getTime();
  if (activity.status.phase === 'overdue' && activity.status.overdueMilestone) {
    return (
      <span className="inline-flex items-center gap-1 text-destructive font-medium">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        Missed {activity.status.overdueMilestone.label.toLowerCase()} — {formatCountdownLabel(activity.status.overdueMilestone.time.getTime(), nowMs)}
      </span>
    );
  }
  if (activity.status.phase === 'upcoming' && activity.status.nextMilestone) {
    return (
      <span className="font-medium">
        {activity.status.nextMilestone.label} {formatCountdownLabel(activity.status.nextMilestone.time.getTime(), nowMs)}
      </span>
    );
  }
  if (activity.status.phase === 'in_progress') {
    // Nothing pre-event is actionable anymore — show when it wraps up
    // instead of repeating the "In progress" badge verbatim.
    return <span className="text-muted-foreground">Ends {fmtTime(activity.eventEnd)}</span>;
  }
  return null;
}

function LocationLine({ location }: { location: string | null }) {
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <MapPin className="h-3 w-3 shrink-0" />
      {location ?? 'Location not set'}
    </div>
  );
}

/** A real calculated time, or a clearly-labeled "not calculated" note — never a guess. */
function MilestoneTimeLine({ label, time, fmtTime }: { label: string; time: Date | null; fmtTime: (d: Date) => string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-medium', time === null && 'text-muted-foreground italic font-normal')}>
        {time ? fmtTime(time) : 'Not calculated'}
      </span>
    </div>
  );
}

function PrepStepRow({ step, fmtTime }: { step: ActivityWorkflowPrepStep; fmtTime: (d: Date) => string }) {
  return (
    <div className="flex items-center justify-between text-xs pl-2 border-l-2 border-border">
      <span className={cn('truncate', step.kind === 'informational' && 'italic text-muted-foreground')}>{step.label}</span>
      <span className={cn('shrink-0 ml-2', step.time ? 'font-medium' : 'text-muted-foreground italic')}>
        {step.time ? fmtTime(step.time) : step.unscheduledReason ?? 'Not calculated'}
      </span>
    </div>
  );
}

function PrimaryActivityCard({ activity, fmtTime, now }: { activity: ActivityWorkflowActivity; fmtTime: (d: Date) => string; now: Date }) {
  const badge = PHASE_BADGE[activity.status.phase];
  return (
    <div
      className={cn(
        'rounded-md border p-3 space-y-2 shrink-0',
        activity.status.phase === 'overdue' ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-card/60',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold truncate">{activity.eventTitle}</div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {activity.memberName && (
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: activity.memberColor ?? '#9CA3AF' }} />
                {activity.memberName}
              </span>
            )}
            {activity.profileName && <span>· {activity.profileName}</span>}
          </div>
        </div>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>

      <LocationLine location={activity.location} />

      <div className="text-sm">
        <CountdownLine activity={activity} fmtTime={fmtTime} now={now} />
      </div>

      <div className="space-y-1 pt-1 border-t border-border/60">
        <MilestoneTimeLine label="Leave home" time={activity.leaveHomeTime} fmtTime={fmtTime} />
        <MilestoneTimeLine label="Arrive" time={activity.arrivalTime} fmtTime={fmtTime} />
        <MilestoneTimeLine label="Starts" time={activity.eventStart} fmtTime={fmtTime} />
      </div>

      {activity.prepSteps.length > 0 && (
        <div className="space-y-1 pt-1">
          {activity.prepSteps.map((step) => (
            <PrepStepRow key={step.id} step={step} fmtTime={fmtTime} />
          ))}
        </div>
      )}
    </div>
  );
}

function CompactActivityRow({ activity, fmtTime }: { activity: ActivityWorkflowActivity; fmtTime: (d: Date) => string }) {
  const badge = PHASE_BADGE[activity.status.phase];
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card/40 px-2 py-1.5 text-xs">
      {activity.memberName && (
        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: activity.memberColor ?? '#9CA3AF' }} />
      )}
      <div className="min-w-0 flex-1">
        <div className="font-medium truncate">{activity.eventTitle}</div>
        <div className="text-muted-foreground truncate">{fmtTime(activity.eventStart)}{activity.location ? ` · ${activity.location}` : ''}</div>
      </div>
      <Badge variant={badge.variant} className="shrink-0">{badge.label}</Badge>
    </div>
  );
}
