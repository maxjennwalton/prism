/**
 * Server-side calendar sync cron.
 *
 * Lives in its own file so the Edge runtime bundle of instrumentation.ts
 * does NOT try to pull in node-ical, redis client, and node:crypto chains.
 * instrumentation.ts dynamically imports this module only inside the
 * `NEXT_RUNTIME === 'nodejs'` branch, so webpack dead-code eliminates the
 * import from the edge bundle entirely.
 *
 * Why: calendar sync was previously client-driven. If nobody had Prism's
 * dashboard or calendar page open, no syncs ran. After docker restarts or
 * extended quiet periods, events silently went stale.
 */

import { syncAllGoogleCalendars, syncAllIcalCalendars, syncAllCalDAVCalendars } from '@/lib/services/calendar-sync';
import { syncCardDAVBirthdays } from '@/lib/services/carddav-birthday-sync';
import { detectBirthdaysFromEvents } from '@/lib/services/birthday-detect';
import { runActivityMatchingTick } from '@/lib/services/activityMatching';
import { recomputeActivityTravelForUpcoming } from '@/lib/services/activityTravel';
import { invalidateEntity } from '@/lib/cache/cacheKeys';

const INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const INITIAL_DELAY_MS = 60 * 1000;  // wait 1 min after boot

async function runOnce() {
  try {
    const [google, ical, caldav, carddav] = await Promise.all([
      syncAllGoogleCalendars(),
      syncAllIcalCalendars(),
      syncAllCalDAVCalendars(),
      syncCardDAVBirthdays(),
    ]);
    // Detection reads the events those syncs just wrote, so it has to run
    // after them rather than alongside. Calendar-sourced birthdays were
    // previously never picked up by the cron at all — only the CardDAV
    // contact path was — so they refreshed only when someone happened to open
    // Manage Calendars and hit sync.
    const detected = await detectBirthdaysFromEvents();

    // Same reasoning: activity matching looks at events sync just wrote, and
    // only ever runs at all once a household has explicitly turned it on
    // (see runActivityMatchingTick). A disabled household pays nothing extra
    // here — not even the "no activity" rows this sometimes creates.
    const matched = await runActivityMatchingTick();

    // Phase 4B: recompute driving-time estimates for settled, upcoming
    // activities. This is the only place routing requests originate from —
    // never the dashboard's countdown tick — so provider usage stays on a
    // bounded, server-side schedule. computeActivityTravel's own staleness
    // check means most ticks do little real work (a fresh, unchanged result
    // is reused rather than re-requested).
    const travel = await recomputeActivityTravelForUpcoming();

    const total = google.total + ical.total + caldav.total + carddav.synced;
    const errors = [
      ...google.errors, ...ical.errors, ...caldav.errors,
      ...carddav.errors, ...detected.errors,
    ];

    await invalidateEntity('events');
    // CalDAV sources also sync VTODO into the tasks table; invalidate that
    // cache too so the Tasks page picks up new / updated reminders.
    await invalidateEntity('tasks');
    if (carddav.synced > 0 || detected.added + detected.updated > 0) {
      await invalidateEntity('birthdays');
    }

    const matchedSuffix = matched
      ? ` (activity matching: ${matched.autoMatched} auto-matched, ${matched.needsReview} need review)`
      : '';
    const travelSuffix =
      travel.scanned > 0
        ? ` (travel: ${travel.calculated} calculated, ${travel.reused} reused, ${travel.failed} unavailable)`
        : '';

    if (errors.length > 0) {
      console.warn(
        `[calendar-cron] synced ${total} events/tasks with ${errors.length} errors:`,
        errors.slice(0, 3),
      );
    } else {
      console.log(`[calendar-cron] synced ${total} events/tasks${matchedSuffix}${travelSuffix}`);
    }
  } catch (err) {
    // Never let a transient sync failure crash the cron loop.
    console.error('[calendar-cron] tick failed:', err);
  }
}

export function startCalendarSyncCron(): void {
  if (process.env.PRISM_DISABLE_CALENDAR_CRON === 'true') {
    console.log('[calendar-cron] disabled via PRISM_DISABLE_CALENDAR_CRON');
    return;
  }
  if (process.env.NODE_ENV === 'test') return;

  setTimeout(() => {
    void runOnce();
    setInterval(() => void runOnce(), INTERVAL_MS);
  }, INITIAL_DELAY_MS);

  console.log(
    `[calendar-cron] scheduled every ${INTERVAL_MS / 1000}s (first run in ${INITIAL_DELAY_MS / 1000}s)`,
  );
}
