CREATE EXTENSION IF NOT EXISTS vector;

-- ── SUPPLIERS ──────────────────────────────────────────────────────
CREATE TABLE suppliers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  slug              TEXT UNIQUE NOT NULL,
  logo_url          TEXT,
  contact_email     TEXT,
  description_short TEXT,
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── SERVICES ───────────────────────────────────────────────────────
-- Each row = one pricing tier / variant. Multiple rows with the same
-- service_name under the same supplier are intentional and correct.
CREATE TABLE services (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id         UUID REFERENCES suppliers(id) ON DELETE CASCADE,
  service_name        TEXT NOT NULL,
  category_primary    TEXT NOT NULL,
  category_secondary  TEXT,
  description_short   TEXT,
  tags                TEXT[],
  embedding           VECTOR(1536),
  duration_minutes    INT,
  location_type       TEXT DEFAULT 'onsite'
                      CHECK (location_type IN ('onsite','remote','both')),
  language            TEXT DEFAULT 'he',
  min_participants    INT,
  max_participants    INT,
  price               NUMERIC(10,2),
  pricing_unit        TEXT,
  notes               TEXT,
  is_active           BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── CATEGORIES ─────────────────────────────────────────────────────
CREATE TABLE categories (
  slug        TEXT PRIMARY KEY,
  name_he     TEXT NOT NULL,
  icon        TEXT NOT NULL,
  color_bg    TEXT NOT NULL,
  color_text  TEXT NOT NULL,
  color_dot   TEXT NOT NULL,
  sort_order  INT DEFAULT 0
);

INSERT INTO categories VALUES
  ('wellbeing',   'וולנס ובריאות', 'Heart',           'bg-emerald-100','text-emerald-700','bg-emerald-500',1),
  ('teambuilding','גיבוש וחברה',   'Users',           'bg-blue-100',   'text-blue-700',   'bg-blue-500',   2),
  ('learning',    'למידה והעשרה',  'BookOpen',        'bg-violet-100', 'text-violet-700', 'bg-violet-500', 3),
  ('food',        'אוכל ואירוח',   'UtensilsCrossed', 'bg-orange-100', 'text-orange-700', 'bg-orange-500', 4),
  ('culture',     'תרבות ויצירה',  'Palette',         'bg-pink-100',   'text-pink-700',   'bg-pink-500',   5),
  ('travel',      'טיולים ואתגר',  'MapPin',          'bg-teal-100',   'text-teal-700',   'bg-teal-500',   6),
  ('sport',       'ספורט ופעילות', 'Dumbbell',        'bg-red-100',    'text-red-700',    'bg-red-500',    7),
  ('tech',        'טכנולוגיה ו-AI','Cpu',             'bg-cyan-100',   'text-cyan-700',   'bg-cyan-500',   8),
  ('consulting',  'ייעוץ ופיתוח',  'TrendingUp',      'bg-amber-100',  'text-amber-700',  'bg-amber-500',  9);

-- ── INDEXES ────────────────────────────────────────────────────────
CREATE INDEX idx_services_category   ON services(category_primary);
CREATE INDEX idx_services_supplier   ON services(supplier_id);
CREATE INDEX idx_services_price      ON services(price) WHERE price IS NOT NULL;
CREATE INDEX idx_services_fulltext   ON services
  USING gin(to_tsvector('simple', service_name || ' ' || COALESCE(category_secondary,'')));

-- ── SEARCH RPC (smart budget math + word-level Hebrew search) ────
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
  -- Split query into individual words (filter out short words < 2 chars)
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
    -- CATEGORY FILTER
    AND (p_categories IS NULL OR s.category_primary = ANY(p_categories))
    -- SMART BUDGET FILTER (accounts for pricing unit)
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
    -- PARTICIPANTS FILTER
    AND (
      p_participants IS NULL
      OR (
        (s.min_participants IS NULL OR s.min_participants <= p_participants)
        AND
        (s.max_participants IS NULL OR s.max_participants >= p_participants)
      )
    )
    -- LOCATION FILTER
    AND (
      p_location IS NULL
      OR s.location_type = p_location
      OR s.location_type = 'both'
    )
    -- WORD-LEVEL TEXT SEARCH: ANY word matches ANY field (OR logic)
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
    -- Rank by number of matching words (more matches = higher rank)
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

-- ── RLS (open read, no auth) ───────────────────────────────────────
ALTER TABLE suppliers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE services   ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON suppliers  FOR SELECT USING (true);
CREATE POLICY "public_read" ON services   FOR SELECT USING (true);
CREATE POLICY "public_read" ON categories FOR SELECT USING (true);
