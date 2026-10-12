-- 0031_activity_venues.sql
--
-- Sports & Activity Assistant — shared venue directory.
--
-- A new, standalone table (not an alteration of an existing one). Once any
-- activity's destination is resolved with real confidence — auto-resolved
-- past the confidence gate in activityVenues.ts, or a parent's explicit
-- correction via /api/activity-matching/links/[id]/destination — it is
-- saved here so every future event at the same place (a recurring weekly
-- practice, a different sibling's game, a different season) resolves
-- instantly with no geocoding call at all.
--
-- normalized_name is deliberately NOT unique: two different towns can each
-- have their own "Community Arena", and lookup disambiguates by proximity
-- to the searching household's own Home, not by uniqueness of the name.

CREATE TABLE IF NOT EXISTS activity_venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  normalized_name varchar(255) NOT NULL,
  display_name varchar(255) NOT NULL,
  aliases jsonb DEFAULT '[]'::jsonb NOT NULL,
  formatted_address text,
  latitude decimal(9, 6) NOT NULL,
  longitude decimal(10, 6) NOT NULL,
  source varchar(20) NOT NULL,
  verified boolean DEFAULT false NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL,
  CONSTRAINT activity_venues_source_check
    CHECK (source IN ('nominatim', 'google_places', 'parent_confirmed'))
);

CREATE INDEX IF NOT EXISTS activity_venues_normalized_name_idx ON activity_venues (normalized_name);
