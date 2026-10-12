-- 0032_activity_location_aliases.sql
--
-- Sports & Activity Assistant — household-wide raw-location-text aliases.
--
-- Maps a literal, raw calendar-location string (e.g. "Wasaga" — not the
-- parsed venue name, not a specific address) to one verified venue. Kept
-- separate from activity_venues.aliases (which is keyed by the venue's own
-- parsed name and written automatically on every confident match): this
-- table is written ONLY after a parent explicitly confirms applying a
-- correction broadly, because a bare/short/generic original string is
-- exactly the case that can be geographically ambiguous ("Wasaga" could be
-- several real places) and must never auto-apply to every event sharing
-- that text without a human okaying it first.
--
-- normalized_location is unique: one raw string maps to exactly one venue
-- at a time. Remapping it to a different venue is an explicit overwrite,
-- never a second silent row.

CREATE TABLE IF NOT EXISTS activity_location_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  normalized_location varchar(500) NOT NULL,
  venue_id uuid NOT NULL REFERENCES activity_venues(id) ON DELETE CASCADE,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS activity_location_aliases_normalized_location_unique ON activity_location_aliases (normalized_location);
