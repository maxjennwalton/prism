-- 0027_activity_profiles.sql
--
-- Sports & Activity Assistant — Phase 1: Activity Profile data model only.
-- No matching, no derived-time display, no UI, no gear-completion UI yet —
-- see docs/planning.md for the phased plan.
--
-- Four new, purely additive tables. None of them touch `events`, and none of
-- them are read by any sync code path — the same one-directional pattern
-- already used by calendar_notes and dismissed_events: Prism-only data keyed
-- to its own local events.id, invisible to sync, cascade-deleted with the
-- event it annotates.
--
-- No timing is seeded anywhere in this migration. A freshly created activity
-- profile has arrival_buffer_minutes = NULL and travel_minutes = NULL — never
-- an assumed number — until a household configures them.
--
-- activity_profiles       — reusable templates ("Hockey Practice"), shared
--                            across whichever family members do that activity.
-- activity_profile_prep_steps
--                          — ordered, reusable prep steps per profile. Each
--                            step's time is an offset from one of three
--                            system-calculated milestones (event_start,
--                            arrival, leave_home) — those milestones are never
--                            stored rows, always computed from the event's own
--                            start time plus the profile/override buffers.
-- activity_event_links     — one row per matched event OCCURRENCE (every
--                            instance of a recurring series already gets its
--                            own row in `events`, so this naturally never
--                            shares state across occurrences). NULL
--                            activity_profile_id means a human confirmed
--                            "not an activity" — the row's existence is the
--                            tombstone, no separate dismissal table needed.
-- activity_gear_completions
--                          — per-occurrence checked state for a profile's
--                            gear_items (jsonb template on the profile), so
--                            checking "helmet" for Tuesday's practice never
--                            checks it for Thursday's.

CREATE TABLE IF NOT EXISTS activity_profiles (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    varchar(255) NOT NULL,
  category                varchar(100),
  color                   varchar(7),
  match_keywords          jsonb NOT NULL DEFAULT '[]'::jsonb,
  arrival_buffer_minutes  integer,
  travel_minutes          integer,
  default_location        text,
  gear_items              jsonb NOT NULL DEFAULT '[]'::jsonb,
  archived                boolean NOT NULL DEFAULT false,
  created_by              uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at              timestamp NOT NULL DEFAULT now(),
  updated_at              timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_profiles_archived_idx
  ON activity_profiles (archived);

CREATE TABLE IF NOT EXISTS activity_profile_prep_steps (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_profile_id  uuid NOT NULL REFERENCES activity_profiles(id) ON DELETE CASCADE,
  label                varchar(255) NOT NULL,
  sort_order           integer NOT NULL DEFAULT 0,
  anchor               varchar(20) NOT NULL,
  offset_minutes       integer NOT NULL,
  is_checkable         boolean NOT NULL DEFAULT true,
  links_gear           boolean NOT NULL DEFAULT false,
  assigned_member_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamp NOT NULL DEFAULT now(),
  updated_at           timestamp NOT NULL DEFAULT now(),
  CONSTRAINT activity_profile_prep_steps_anchor_check
    CHECK (anchor IN ('event_start', 'arrival', 'leave_home'))
);

CREATE INDEX IF NOT EXISTS activity_profile_prep_steps_profile_idx
  ON activity_profile_prep_steps (activity_profile_id, sort_order);

CREATE TABLE IF NOT EXISTS activity_event_links (
  id                               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                         uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  activity_profile_id              uuid REFERENCES activity_profiles(id) ON DELETE SET NULL,
  assigned_member_id               uuid REFERENCES users(id) ON DELETE SET NULL,
  responsible_adult_id             uuid REFERENCES users(id) ON DELETE SET NULL,
  arrival_buffer_minutes_override  integer,
  travel_minutes_override          integer,
  location_override                text,
  auto_matched                     boolean NOT NULL DEFAULT true,
  created_at                       timestamp NOT NULL DEFAULT now(),
  updated_at                       timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS activity_event_links_event_id_idx
  ON activity_event_links (event_id);

CREATE INDEX IF NOT EXISTS activity_event_links_profile_idx
  ON activity_event_links (activity_profile_id);

CREATE TABLE IF NOT EXISTS activity_gear_completions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_event_link_id  uuid NOT NULL REFERENCES activity_event_links(id) ON DELETE CASCADE,
  gear_item_id            varchar(100) NOT NULL,
  checked                 boolean NOT NULL DEFAULT false,
  checked_by              uuid REFERENCES users(id) ON DELETE SET NULL,
  checked_at              timestamp,
  created_at              timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS activity_gear_completions_link_item_unique
  ON activity_gear_completions (activity_event_link_id, gear_item_id);
