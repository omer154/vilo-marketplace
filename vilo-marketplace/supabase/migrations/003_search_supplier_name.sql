-- ── Migration 003 — supplier-name search hardening ─────────────────────
-- Two related fixes audited from the search architecture:
--
-- 1. The original `search_services` RPC includes `sup.name` in its WHERE
--    word-match check, but the ORDER BY ranking only counts hits in
--    `service_name`, `category_secondary`, and `description_short`.
--    When a user types a supplier name (e.g. "רות גנאל"), all of that
--    supplier's services match the WHERE clause but score 0 in the
--    ranking, so coincidental substring matches from elsewhere outrank
--    them. The Next route works around this with a Pass-1.5 ILIKE on
--    `suppliers.name`. This migration moves the fix to the RPC so any
--    caller (current route, future RPC users) gets correct ranking.
--
-- 2. Pass 1.5 still uses `.ilike('suppliers.name', '%w%')` for each
--    query word. Without a trigram index, that's a sequential scan of
--    every supplier on every keystroke. Add a GIN trigram index on
--    `suppliers.name` and `services.service_name` so ILIKE searches
--    use the index.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_suppliers_name_trgm
  ON suppliers USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_services_name_trgm
  ON services USING gin (service_name gin_trgm_ops);

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
    s.id, s.supplier_id, sup.name,
    s.service_name, s.category_primary, s.category_secondary,
    s.description_short, s.price, s.pricing_unit,
    s.min_participants, s.max_participants,
    s.duration_minutes, s.location_type, s.notes
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
    -- Supplier-name matches now boost ranking. Weighted 2× because a
    -- typed-out supplier name is a stronger signal than a coincidental
    -- substring match in a service description.
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
