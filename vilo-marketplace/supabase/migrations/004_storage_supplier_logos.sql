-- ── Migration 004 — supplier logo storage bucket ───────────────────────
-- Phase 2d. Suppliers' EditForm previously took a logo URL only; we now
-- want admins to upload directly from the form, so we need a Supabase
-- Storage bucket with the right RLS.
--
-- Bucket name: supplier-logos. Public read (so the marketplace can <img
-- src=...> the logos without a signed URL), admin-only writes via
-- is_admin() — the same predicate the suppliers/services row-level
-- policies already use.
--
-- The actual upload runs from the server with the service-role key so it
-- bypasses RLS — these policies exist as a belt-and-suspenders for any
-- future client-side direct upload via the anon key.

INSERT INTO storage.buckets (id, name, public)
  VALUES ('supplier-logos', 'supplier-logos', true)
  ON CONFLICT (id) DO UPDATE SET public = true;

-- Public can read any object in the bucket.
DROP POLICY IF EXISTS "supplier_logos_public_read" ON storage.objects;
CREATE POLICY "supplier_logos_public_read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'supplier-logos');

-- Only admins can write/update/delete logos.
DROP POLICY IF EXISTS "supplier_logos_admin_insert" ON storage.objects;
CREATE POLICY "supplier_logos_admin_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'supplier-logos' AND is_admin());

DROP POLICY IF EXISTS "supplier_logos_admin_update" ON storage.objects;
CREATE POLICY "supplier_logos_admin_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'supplier-logos' AND is_admin())
  WITH CHECK (bucket_id = 'supplier-logos' AND is_admin());

DROP POLICY IF EXISTS "supplier_logos_admin_delete" ON storage.objects;
CREATE POLICY "supplier_logos_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'supplier-logos' AND is_admin());
