'use client';

import * as React from 'react';
import { CalendarClock, MapPin, AlertTriangle, Clock, LogOut, PlayCircle } from 'lucide-react';
import { WidgetContainer, WidgetEmpty } from './WidgetContainer';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useTimeFormat } from '@/components/providers';
import { formatDisplayTime } from '@/lib/utils/timeFormat';
import { formatCountdownLabel } from '@/lib/utils/activityWorkflowCountdown';
import { useActivityWorkflow, type ActivityWorkflowActivity, type ActivityWorkflowPrepStep } from '@/lib/hooks/useActivityWorkflow';
import type { ActivityPhase, ActivityWorkflowStatus } from '@/lib/utils/activityWorkflowPriority';

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

/** Below the registry's default width (14) switches milestones/prep rows to a narrower, stacked layout. */
const NARROW_WIDTH_THRESHOLD = 14;

/**
 * Read-only Activity Workflow card (Sports & Activity Assistant, Phase 4A):
 * today's settled matched activities, each with its calculated arrival/
 * leave-home/prep-step timeline and a live countdown to the next actionable
 * deadline. A standalone widget — not a CalendarWidget view — specifically
 * so its countdown ticks (see useActivityWorkflow) never re-render the
 * Calendar widget or anything else on the dashboard. It reads "today" from
 * the household's own timezone regardless of time of day, so it works
 * identically whether placed on a Morning or an After School dashboard —
 * nothing here assumes a particular time window or dashboard name.
 *
 * Completed activities (event already ended) are filtered out of display
 * here, not in the hook/service — the data layer stays a complete,
 * independently-testable "today's matched activities" list; only this
 * widget decides a finished activity no longer belongs on screen.
 */
export const ActivityWorkflowWidget = React.memo(function ActivityWorkflowWidget({ className, gridW }: ActivityWorkflowWidgetProps) {
  const { items, loading, error, now } = useActivityWorkflow();
  const { timeFormat, displayTimezone } = useTimeFormat();
  const fmtTime = React.useCallback(
    (d: Date) => formatDisplayTime(d, timeFormat, {}, displayTimezone),
    [timeFormat, displayTimezone],
  );
  const narrow = typeof gridW === 'number' && gridW < NARROW_WIDTH_THRESHOLD;

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
          {primary && <PrimaryActivityCard activity={primary} fmtTime={fmtTime} now={now} narrow={narrow} />}
          {rest.length > 0 && (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
              {rest.map((activity) => (
                <CompactActivityRow key={activity.linkId} activity={activity} fmtTime={fmtTime} narrow={narrow} />
              ))}
            </div>
          )}
        </div>
      )}
    </WidgetContainer>
  );
});

/**
 * The single strongest visual element on the card: whatever is next
 * actionable, in large bold text with an icon AND a text label (status is
 * never color-only) — never just the phase badge repeated. While overdue,
 * this still points at the soonest still-reachable deadline rather than
 * dead-ending on the missed one; MissedMilestones below carries what was
 * missed separately, so neither fact hides the other.
 *
 * `now` is passed down from useActivityWorkflow's own tick rather than read
 * here via Date.now() — the same instant `activity.status` was computed
 * against on this render, and calling Date.now() fresh inside a render
 * function is an impure read React's rules flag directly.
 */
function Hero({ status, eventEnd, now, fmtTime }: { status: ActivityWorkflowStatus; eventEnd: Date; now: Date; fmtTime: (d: Date) => string }) {
  const nowMs = now.getTime();

  if (status.phase === 'in_progress') {
    return (
      <div className="flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2">
        <PlayCircle className="h-5 w-5 text-muted-foreground shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground leading-none">In progress</div>
          <div className="text-base font-bold leading-tight truncate">Ends {fmtTime(eventEnd)}</div>
        </div>
      </div>
    );
  }

  if (!status.nextMilestone) return null;

  const isOverdue = status.phase === 'overdue';
  const Icon = isOverdue ? AlertTriangle : Clock;

  return (
    <div className={cn('flex items-center gap-2 rounded-md px-3 py-2', isOverdue ? 'bg-destructive/10 text-destructive' : 'bg-primary/10')}>
      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide opacity-70 leading-none">{isOverdue ? 'Next (overdue)' : 'Next'}</div>
        <div className="text-base font-bold leading-tight truncate">
          {status.nextMilestone.label} {formatCountdownLabel(status.nextMilestone.time.getTime(), nowMs)}
        </div>
      </div>
    </div>
  );
}

/** Every pre-event milestone already missed, named explicitly — never silently dropped once a later one is still reachable. */
function MissedMilestones({ status, now }: { status: ActivityWorkflowStatus; now: Date }) {
  if (status.overdueMilestones.length === 0) return null;
  const nowMs = now.getTime();
  return (
    <div className="flex items-start gap-1.5 text-xs text-destructive">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
      <span>
        Missed {status.overdueMilestones
          .map((m) => `${m.label.toLowerCase()} (${formatCountdownLabel(m.time.getTime(), nowMs)})`)
          .join(', ')}
      </span>
    </div>
  );
}

function LocationLine({ location }: { location: string | null }) {
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
      {location ?? 'Location not set'}
    </div>
  );
}

/**
 * Event Start, Arrive, and Leave Home together — Leave Home is visually the
 * heaviest (larger text, an icon, its own tinted chip) since it's the
 * action with the hardest deadline, but Arrive/Starts stay fully visible
 * alongside it, never hidden behind it. Stacks instead of a row once the
 * widget is narrower than its default width, so none of the three clip.
 */
function MilestoneStrip({ activity, fmtTime, narrow }: { activity: ActivityWorkflowActivity; fmtTime: (d: Date) => string; narrow: boolean }) {
  return (
    <div className={cn('rounded-md border border-border/60 bg-background/40 p-2', narrow ? 'space-y-1.5' : 'flex items-center gap-3')}>
      <div className={cn('flex items-center gap-1.5 min-w-0', !narrow && 'flex-1')}>
        <LogOut className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground leading-none">Leave home</div>
          <div className={cn('leading-tight truncate', activity.leaveHomeTime ? 'text-base font-bold' : 'text-sm italic text-muted-foreground font-normal')}>
            {activity.leaveHomeTime ? fmtTime(activity.leaveHomeTime) : 'Not calculated'}
          </div>
        </div>
      </div>
      <div className={cn('flex gap-4 text-xs shrink-0', narrow && 'pl-5')}>
        <MiniMilestone label="Arrive" time={activity.arrivalTime} fmtTime={fmtTime} />
        <MiniMilestone label="Starts" time={activity.eventStart} fmtTime={fmtTime} />
      </div>
    </div>
  );
}

function MiniMilestone({ label, time, fmtTime }: { label: string; time: Date | null; fmtTime: (d: Date) => string }) {
  return (
    <div>
      <div className="text-muted-foreground leading-none">{label}</div>
      <div className={cn('font-medium', time === null && 'italic text-muted-foreground font-normal')}>
        {time ? fmtTime(time) : 'Not calculated'}
      </div>
    </div>
  );
}

type PrepStepVisual = 'missed' | 'next' | 'future' | 'past' | 'unscheduled';

const PREP_DOT_CLASS: Record<PrepStepVisual, string> = {
  missed: 'bg-destructive',
  next: 'bg-primary ring-2 ring-primary/30',
  future: 'bg-border',
  past: 'bg-muted-foreground/40',
  unscheduled: 'bg-transparent border border-dashed border-muted-foreground/50',
};

const PREP_TEXT_CLASS: Record<PrepStepVisual, string> = {
  missed: 'text-destructive font-medium',
  next: 'text-foreground font-semibold',
  future: 'text-muted-foreground',
  past: 'text-muted-foreground',
  unscheduled: 'text-muted-foreground italic',
};

function prepStepVisual(step: ActivityWorkflowPrepStep, status: ActivityWorkflowStatus, nowMs: number): PrepStepVisual {
  if (!step.time) return 'unscheduled';
  if (status.overdueMilestones.some((m) => m.id === step.id)) return 'missed';
  if (status.nextMilestone?.id === step.id) return 'next';
  return step.time.getTime() > nowMs ? 'future' : 'past';
}

/**
 * Compact, readable mini-timeline of prep steps — a status dot (never the
 * only signal: "next"/"missed" are also spelled out in text) plus label and
 * time or unscheduled reason. Capped height with its own scroll so a
 * profile with many steps never clips the rest of the card or the widget.
 */
function PrepStepTimeline({ activity, fmtTime, now }: { activity: ActivityWorkflowActivity; fmtTime: (d: Date) => string; now: Date }) {
  if (activity.prepSteps.length === 0) return null;
  const nowMs = now.getTime();
  return (
    <div className="space-y-1 pt-1 border-t border-border/60 max-h-28 overflow-y-auto pr-1">
      {activity.prepSteps.map((step) => {
        const visual = prepStepVisual(step, activity.status, nowMs);
        return (
          <div key={step.id} className="flex items-center gap-1.5 text-xs">
            <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', PREP_DOT_CLASS[visual])} aria-hidden="true" />
            <span className={cn('truncate flex-1', PREP_TEXT_CLASS[visual], step.kind === 'informational' && 'italic')}>
              {step.label}
              {visual === 'next' && ' (next)'}
              {visual === 'missed' && ' (missed)'}
            </span>
            <span className={cn('shrink-0 ml-2', PREP_TEXT_CLASS[visual])}>
              {step.time ? fmtTime(step.time) : step.unscheduledReason ?? 'Not calculated'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Phase 4A-final: "{Activity Profile name} — {family member name}" is the
 * main heading, e.g. "Soccer Game — Beckham" — never the raw calendar
 * title. Falls back gracefully when either half is missing (settled links
 * can legitimately carry no member, or — rarely, via direct API use — no
 * profile); the original title is always still reachable via the heading's
 * own tooltip, never dropped.
 */
function primaryHeading(activity: ActivityWorkflowActivity): string {
  const base = activity.profileName ?? activity.eventTitle;
  return activity.memberName ? `${base} — ${activity.memberName}` : base;
}

function PrimaryActivityCard({
  activity,
  fmtTime,
  now,
  narrow,
}: {
  activity: ActivityWorkflowActivity;
  fmtTime: (d: Date) => string;
  now: Date;
  narrow: boolean;
}) {
  const badge = PHASE_BADGE[activity.status.phase];
  return (
    <div
      className={cn(
        'rounded-md border p-3 space-y-2 shrink-0',
        activity.status.phase === 'overdue' ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-card/60',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-1.5">
          {activity.memberName && (
            <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: activity.memberColor ?? '#9CA3AF' }} aria-hidden="true" />
          )}
          <div className="font-semibold truncate" title={activity.eventTitle}>{primaryHeading(activity)}</div>
        </div>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>

      <Hero status={activity.status} eventEnd={activity.eventEnd} now={now} fmtTime={fmtTime} />
      <MissedMilestones status={activity.status} now={now} />
      <LocationLine location={activity.location} />
      <MilestoneStrip activity={activity} fmtTime={fmtTime} narrow={narrow} />
      <PrepStepTimeline activity={activity} fmtTime={fmtTime} now={now} />
    </div>
  );
}

function CompactActivityRow({ activity, fmtTime, narrow }: { activity: ActivityWorkflowActivity; fmtTime: (d: Date) => string; narrow: boolean }) {
  const badge = PHASE_BADGE[activity.status.phase];
  return (
    <div
      className="flex items-center gap-2 rounded-md border border-border bg-card/40 px-2 py-1.5 text-xs"
      title={activity.eventTitle}
    >
      {activity.memberName && (
        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: activity.memberColor ?? '#9CA3AF' }} aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <div className="font-medium truncate">{primaryHeading(activity)}</div>
        <div className="text-muted-foreground truncate">
          {fmtTime(activity.eventStart)}
          {!narrow && activity.location ? ` · ${activity.location}` : ''}
        </div>
      </div>
      <Badge variant={badge.variant} className="shrink-0">{badge.label}</Badge>
    </div>
  );
}
