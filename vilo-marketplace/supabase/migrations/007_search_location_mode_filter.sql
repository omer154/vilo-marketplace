-- ── Migration 007 — search by location_mode array ─────────────────────
-- The sidebar UI shows the rich at_client / at_provider / remote / hybrid
-- modes (migration 006), but the RPC's filter parameter is the legacy
-- single-value p_location string compared against location_type. Add a
-- p_location_modes TEXT[] parameter so the sidebar can pass an array of
-- selected modes and get back rows whose location_mode is in that set.
--
-- Backwards-compat: the old p_location TEXT parameter stays — clients
-- still on the old contract keep working. If a caller passes both, both
-- filters AND together (intersect).

-- Drop the old signature first; CREATE OR REPLACE can't change the
-- parameter list.
DROP FUNCTION IF EXISTS search_services(TEXT, TEXT[], NUMERIC, NUMERIC, INT, TEXT, INT);

CREATE FUNCTION search_services(
  p_query             TEXT     DEFAULT '',
  p_categories        TEXT[]   DEFAULT NULL,
  p_total_budget      NUMERIC  DEFAULT NULL,
  p_budget_per_person NUMERIC  DEFAULT NULL,
  p_participants      INT      DEFAULT NULL,
  p_location          TEXT     DEFAULT NULL,
  p_limit             INT      DEFAULT 60,
  p_location_modes    TEXT[]   DEFAULT NULL
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
    -- Legacy single-value filter on location_type (kept for back-compat).
    AND (
      p_location IS NULL
      OR s.location_type = p_location
      OR s.location_type = 'both'
    )
    -- New filter: caller can pass an array of allowed location_modes.
    -- NULL or empty array => no constraint.
    AND (
      p_location_modes IS NULL
      OR array_length(p_location_modes, 1) IS NULL
      OR s.location_mode = ANY(p_location_modes)
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
