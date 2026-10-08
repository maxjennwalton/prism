-- 0029_activity_travel.sql
--
-- Sports & Activity Assistant — Phase 4B: Automatic Travel.
--
-- Adds two nullable columns to the existing activity_event_links table.
-- Same "never invent a value" rule as Phases 1 and 3: both columns default
-- to NULL, not a guessed value.
--
-- departure_location_override — a per-event departure address that
-- overrides the household's default Home address (stored separately, in
-- settings) for this one event only. NULL means "depart from Home".
-- Saving this column never writes to the Home setting.
--
-- travel_meta carries the last calculated route's result: minutes,
-- provider, timestamp, distance/duration, and input-hash fingerprints used
-- to detect when Home/departure/destination have since changed (making the
-- stored result stale). It is only ever read back for display and
-- staleness checks, never queried on, so it stays jsonb rather than
-- normalized columns — the same shape Phase 3's match_meta already uses.
-- NULL means no calculated route exists yet.

ALTER TABLE activity_event_links ADD COLUMN IF NOT EXISTS departure_location_override text;
ALTER TABLE activity_event_links ADD COLUMN IF NOT EXISTS travel_meta jsonb;
