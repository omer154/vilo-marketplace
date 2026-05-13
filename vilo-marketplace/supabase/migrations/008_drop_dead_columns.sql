-- ── Migration 008 — drop dead columns on services ─────────────────────
-- The architecture audit (2026-05-13) flagged two columns added in
-- migration 002 that no code ever read or wrote:
--
--   - can_travel_to_client  BOOLEAN DEFAULT FALSE
--   - delivery_locations    JSONB
--
-- Their job was subsumed by `location_mode` (at_client / at_provider /
-- remote / hybrid) which captures the same semantics in one column.
-- Keeping them around is just confusion debt — `list_tables` shows
-- them on every schema introspection.
--
-- Idempotent: IF EXISTS handles repeated runs.

ALTER TABLE services
  DROP COLUMN IF EXISTS can_travel_to_client,
  DROP COLUMN IF EXISTS delivery_locations;
