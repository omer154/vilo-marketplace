-- ── Migration 006 — return location_mode from search + backfill ────────
-- Phase 5 of the original 6-part roadmap: surface the richer location
-- distinction (at_client / at_provider / remote / hybrid) on the
-- marketplace, not just the legacy onsite / remote / both. Adding it to
-- the RPC return so cards + modal can render the new label without an
-- extra round-trip.
--
-- Migration 002 added the location_mode column with an intended
-- backfill, but in some Supabase instances the UPDATE didn't apply (it
-- runs once at migration time and stops there). Re-run the backfill
-- idempotently here so any row still NULL after 002 picks up a value.

UPDATE services SET location_mode =
  CASE location_type
    WHEN 'onsite' THEN 'at_client'
    WHEN 'remote' THEN 'remote'
    WHEN 'both'   THEN 'hybrid'
    ELSE NULL
  END
WHERE location_mode IS NULL;

CREATE OR REPLACE FUNCTION search_services(
  p_query            TEXT     DEFAULT '',
  p_categories       TEXT[]   DEFAULT NULL,
  p_total_budget     NUMERIC  DEFAULT NULL,
  p_budget_per_person NUMERIC DEFAULT NULL,
  p_participants     INT      DEFAULT NULL,
  p_location         TEXT     DEFAULT NULL,
  p_limit            INT      DEFAULT 60
)
RETURNS TABLE (
  id                 UUID,
  supplier_id        UUID,
  supplier_name      TEXT,
  supplier_logo_url  TEXT,
  service_name       TEXT,
  category_primary   TEXT,
  category_secondary TEXT,
  description_short  TEXT,
  price              NUMERIC,
  pricing_unit       TEXT,
  min_participants   INT,
  max_participants   INT,
  duration_minutes   INT,
  location_type      TEXT,
  location_mode      TEXT,
  notes              TEXT
)
LANGUAGE plpgsql AS $$
DECLARE
  query_words TEXT[];
BEGIN
  IF p_query IS NOT NULL AND p_query != '' THEN
    SELECT array_agg(w) INTO query_words
    FROM (
      SELECT unnest(string_to_array(trim(p_query), ' ')) AS w
    ) sub
    WHERE length(w) >= 2;
  END IF;

  RETURN QUERY
  SELECT
    s.id, s.supplier_id, sup.name, sup.logo_url,
    s.service_name, s.category_primary, s.category_secondary,
    s.description_short, s.price, s.pricing_unit,
    s.min_participants, s.max_participants,
    s.duration_minutes, s.location_type, s.location_mode, s.notes
  FROM services s
  JOIN suppliers sup ON sup.id = s.supplier_id
  WHERE
    s.is_active = true AND sup.is_active = true
    AND (p_categories IS NULL OR s.category_primary = ANY(p_categories))
    AND (
      p_total_budget IS NULL
      OR s.price IS NULL
      OR (
        CASE s.pricing_unit
          WHEN 'person' THEN
            (p_budget_per_person IS NULL OR s.price <= p_budget_per_person)
          WHEN 'group' THEN
            s.price <= p_total_budget
          WHEN 'hour' THEN
            s.price * 2 <= p_total_budget
          ELSE
            s.price <= p_total_budget
        END
      )
    )
    AND (
      p_participants IS NULL
      OR (
        (s.min_participants IS NULL OR s.min_participants <= p_participants)
        AND
        (s.max_participants IS NULL OR s.max_participants >= p_participants)
      )
    )
    AND (
      p_location IS NULL
      OR s.location_type = p_location
      OR s.location_type = 'both'
    )
    AND (
      query_words IS NULL OR array_length(query_words, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(query_words) AS qw
        WHERE s.service_name       ILIKE '%' || qw || '%'
           OR s.category_secondary ILIKE '%' || qw || '%'
           OR sup.name             ILIKE '%' || qw || '%'
           OR COALESCE(s.notes,'') ILIKE '%' || qw || '%'
           OR COALESCE(s.description_short,'') ILIKE '%' || qw || '%'
      )
    )
  ORDER BY
    (SELECT COUNT(*) * 2 FROM unnest(COALESCE(query_words, '{}')) AS qw
     WHERE sup.name ILIKE '%' || qw || '%'
    ) DESC,
    (SELECT COUNT(*) FROM unnest(COALESCE(query_words, '{}')) AS qw
     WHERE s.service_name ILIKE '%' || qw || '%'
        OR s.category_secondary ILIKE '%' || qw || '%'
        OR COALESCE(s.description_short,'') ILIKE '%' || qw || '%'
    ) DESC,
    s.category_primary,
    s.service_name
  LIMIT p_limit;
END;
$$;
