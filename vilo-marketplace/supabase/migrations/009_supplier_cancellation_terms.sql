-- 009_supplier_cancellation_terms.sql
-- Per-supplier "תנאי ביטול ושינוי הזמנה" (cancellation & order-change terms) link.
-- Set by an admin on the supplier's edit page; surfaced on the supplier header
-- and on every one of that supplier's service detail views.
alter table public.suppliers
  add column if not exists cancellation_terms_url text;
