'use client';

import { useMemo, useState } from 'react';
import { Square, Info } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { computeTimelinePreview, type TimelinePreviewPrepStep } from '@/lib/utils/activityTimelinePreview';

function formatClock(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function toTimeInputValue(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Live, adjustable preview of an Activity Profile's calculated timing.
 * The sample event time is UI-only state — it is never read from or written
 * to the saved profile.
 */
export function TimelinePreview({
  arrivalBufferMinutes,
  travelMinutes,
  prepSteps,
}: {
  arrivalBufferMinutes: number | null;
  travelMinutes: number | null;
  prepSteps: TimelinePreviewPrepStep[];
}) {
  const [sampleTime, setSampleTime] = useState(() => {
    const d = new Date();
    d.setHours(18, 0, 0, 0);
    return d;
  });

  const rows = useMemo(
    () => computeTimelinePreview(sampleTime, { arrivalBufferMinutes, travelMinutes, prepSteps }),
    [sampleTime, arrivalBufferMinutes, travelMinutes, prepSteps],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Label htmlFor="activity-preview-sample-time" className="text-sm text-muted-foreground shrink-0">
          Example event time
        </Label>
        <input
          id="activity-preview-sample-time"
          type="time"
          value={toTimeInputValue(sampleTime)}
          onChange={(e) => {
            const [h, m] = e.target.value.split(':').map(Number);
            if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return;
            const d = new Date(sampleTime);
            d.setHours(h, m, 0, 0);
            setSampleTime(d);
          }}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        />
        <span className="text-xs text-muted-foreground">(preview only — never saved)</span>
      </div>

      <div className="rounded-md border border-border divide-y divide-border overflow-hidden">
        {rows.map((row) => {
          if (row.kind === 'milestone') {
            return (
              <div
                key={row.id}
                className="flex items-center gap-3 px-3 py-2 bg-muted/60"
              >
                <span className="w-16 shrink-0 text-sm font-semibold tabular-nums">{formatClock(row.time)}</span>
                <span className="text-sm font-bold uppercase tracking-wide">{row.label}</span>
              </div>
            );
          }

          const isCheckable = row.kind === 'checkable';
          return (
            <div
              key={row.id}
              className={cn('flex items-center gap-3 px-3 py-2', !isCheckable && 'bg-background/50')}
            >
              <span className="w-16 shrink-0 text-sm tabular-nums text-muted-foreground">{formatClock(row.time)}</span>
              {isCheckable ? (
                <Square className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              ) : (
                <Info className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
              )}
              <span className={cn('text-sm', !isCheckable && 'italic text-muted-foreground')}>{row.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
