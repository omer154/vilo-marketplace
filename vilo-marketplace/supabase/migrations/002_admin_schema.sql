-- ════════════════════════════════════════════════════════════════════
-- 002_admin_schema.sql
--
-- Phase 0 of v2 roadmap:
--   1. Add missing catalog columns to suppliers + services
--   2. Add audit columns (updated_at / updated_by / version) for admin edits
--   3. Add richer location field (location_mode) alongside legacy location_type
--   4. Add unique constraint on services so seed-db can upsert without duping
--   5. Create admins table + RLS policies for authenticated writes
--
-- IMPORTANT: keep location_type for backwards compat — drop in a later
-- migration once every UI consumer has switched to location_mode.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. New columns on suppliers ─────────────────────────────────────
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS name_en      TEXT,
  ADD COLUMN IF NOT EXISTS website      TEXT,
  ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_by   UUID,
  ADD COLUMN IF NOT EXISTS version      INT DEFAULT 1;

-- ── 2. New columns on services ──────────────────────────────────────
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS service_description    TEXT,
  ADD COLUMN IF NOT EXISTS price_type             TEXT
    CHECK (price_type IN ('fixed','on_request','range') OR price_type IS NULL),
  ADD COLUMN IF NOT EXISTS price_min              NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS price_max              NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS delivery_locations     JSONB,
  ADD COLUMN IF NOT EXISTS can_travel_to_client   BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS location_mode          TEXT,
  ADD COLUMN IF NOT EXISTS updated_at             TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_by             UUID,
  ADD COLUMN IF NOT EXISTS version                INT DEFAULT 1;

ALTER TABLE services
  DROP CONSTRAINT IF EXISTS services_location_mode_check;
ALTER TABLE services
  ADD CONSTRAINT services_location_mode_check
  CHECK (location_mode IN ('at_client','at_provider','remote','hybrid') OR location_mode IS NULL);

-- Backfill location_mode from existing location_type
UPDATE services SET location_mode =
  CASE location_type
    WHEN 'onsite' THEN 'at_client'
    WHEN 'remote' THEN 'remote'
    WHEN 'both'   THEN 'hybrid'
    ELSE NULL
  END
WHERE location_mode IS NULL;

-- ── 3. Unique constraint so seed-db can upsert pricing tiers cleanly ─
-- Each (supplier, service_name, min_participants, max_participants) row is
-- one pricing tier; the existing 688-row JSON relies on multiple rows per
-- service_name being distinct only by capacity range.
CREATE UNIQUE INDEX IF NOT EXISTS services_tier_unique
  ON services (
    supplier_id,
    service_name,
    COALESCE(min_participants, -1),
    COALESCE(max_participants, -1)
  );

-- ── 4. Auto-bump updated_at + version on UPDATE ─────────────────────
CREATE OR REPLACE FUNCTION bump_audit_cols() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  NEW.version   := COALESCE(OLD.version, 1) + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS suppliers_audit ON suppliers;
CREATE TRIGGER suppliers_audit
  BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION bump_audit_cols();

DROP TRIGGER IF EXISTS services_audit ON services;
CREATE TRIGGER services_audit
  BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION bump_audit_cols();

-- ── 5. Admins table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE admins ENABLE ROW LEVEL SECURITY;

-- Only authenticated users can check whether they themselves are admins.
DROP POLICY IF EXISTS "admins_self_read" ON admins;
CREATE POLICY "admins_self_read" ON admins
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Helper predicate used in service/supplier write policies.
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid());
$$;

-- ── 6. RLS write policies for suppliers + services ──────────────────
DROP POLICY IF EXISTS "admin_write_suppliers" ON suppliers;
CREATE POLICY "admin_write_suppliers" ON suppliers
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS "admin_write_services" ON services;
CREATE POLICY "admin_write_services" ON services
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Public read remains as 001 set it: USING (true) on SELECT.

-- ── 7. Staging-row tracking (for Sheets → DB sync in Phase 1) ───────
-- Each service row remembers the staging-sheet row it came from, so the
-- sync route can mark Sheet rows as _status=synced after upsert.
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS staging_row_id TEXT;

CREATE INDEX IF NOT EXISTS idx_services_staging ON services(staging_row_id)
  WHERE staging_row_id IS NOT NULL;
