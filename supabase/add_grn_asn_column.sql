-- ============================================================
-- Adds ASN number tracking for GRN-pending stock.
-- Run this ONCE on an existing Supabase project. New/fresh projects
-- get this directly from an updated schema.sql.
--
-- What this adds:
-- base_serials.asn_no — the ASN (order) number a GRN-pending serial
-- belongs to, e.g. "ASN/2526/832". Populated only for GRN Stock
-- (Pending Inward) uploads, where it comes from the ASN/GRN report's
-- ASNNo column — kept for traceability in the export ("this short/
-- matched serial belongs to ASN X"), so an admin can chase the right
-- delivery instead of just a bare serial number.
-- ============================================================

alter table base_serials add column if not exists asn_no text;
