-- ============================================================
-- Adds GRN-pending stock support.
-- Run this ONCE on an existing Supabase project that already has the
-- base schema from schema.sql. New/fresh projects get this column
-- directly from an updated schema.sql and don't need this file.
--
-- What this does:
-- Base ("expected") data can now be uploaded as one of two source
-- types per row:
--   'inventory' — stock already inward in the system (the old, only,
--                 behaviour — every existing row is backfilled to this).
--   'grn'       — stock that is physically present at the store but
--                 still pending GRN / inward (e.g. an ASN serial report
--                 like MultiUOMSerialReport where GRNNo is not yet
--                 raised). This is "GRN pending" stock.
-- Both types are stored in the same base_serials table and both count
-- toward the store's total expected/complete system quantity — a scan
-- is reconciled against inventory + GRN combined. The source_type
-- column lets the UI and the Excel export break the totals back out
-- by source (Inventory vs GRN pending).
-- ============================================================

alter table base_serials add column if not exists source_type text not null default 'inventory';

-- Defensive: some existing databases had sku/description added outside of
-- version control. Harmless no-op if they're already there.
alter table base_serials add column if not exists sku text;
alter table base_serials add column if not exists description text;

alter table base_serials drop constraint if exists base_serials_source_type_check;
alter table base_serials add constraint base_serials_source_type_check
  check (source_type in ('inventory','grn'));

create index if not exists idx_base_serials_cycle_store_source
  on base_serials(cycle_id, store_code, source_type);
