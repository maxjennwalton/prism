-- 0028_activity_matching.sql
--
-- Sports & Activity Assistant — Phase 3: Activity Event Matching.
--
-- Adds two nullable columns to the existing activity_event_links table
-- (created empty in Phase 1 — no rows exist in production yet, so there is
-- nothing to backfill here). Same "never invent a value" rule as Phase 1:
-- both columns default to NULL, not a guessed status.
--
-- match_status records how a link came to exist / its review state:
--   auto_confirmed — matched deterministically, no ambiguity, never reviewed
--   needs_review   — matched (or partially matched) but ambiguous, or the
--                     event looked like an activity but matched no profile
--   confirmed      — a human reviewed a needs_review row and approved it
--   rejected       — a human reviewed a candidate and said "not an activity"
--                     (the row's existence stops future matching from
--                     reconsidering the event again, same tombstone pattern
--                     Phase 1 already uses for activity_profile_id = NULL)
-- NULL match_status means the row predates Phase 3 matching (manually
-- created) and carries no matching metadata.
--
-- match_meta carries the matcher's reasoning for a needs_review row (review
-- reason, candidate profiles/members, identifiers found) — detail that would
-- be awkward to normalize into columns and is only ever read back for display,
-- never queried on.

ALTER TABLE activity_event_links ADD COLUMN IF NOT EXISTS match_status varchar(20);
ALTER TABLE activity_event_links ADD COLUMN IF NOT EXISTS match_meta jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'activity_event_links' AND constraint_name = 'activity_event_links_match_status_check'
  ) THEN
    ALTER TABLE activity_event_links
      ADD CONSTRAINT activity_event_links_match_status_check
      CHECK (match_status IS NULL OR match_status IN ('auto_confirmed', 'needs_review', 'confirmed', 'rejected'));
  END IF;
END$$;

-- Needs Review reads filter on this directly.
CREATE INDEX IF NOT EXISTS activity_event_links_match_status_idx
  ON activity_event_links (match_status);
