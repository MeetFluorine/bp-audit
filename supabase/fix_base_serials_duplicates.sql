-- ============================================================
-- base_serials duplicate protection + a few more perf indexes.
-- Run in the Supabase SQL editor, after fix_rls_timeout.sql.
-- ============================================================

-- scans already has this kind of protection at the DB level
-- (unique (cycle_id, store_code, serial_no)) — base_serials never did.
-- The app now also prevents duplicates client-side before upload, but a
-- real DB constraint is the backstop against two admins/circle heads
-- uploading overlapping files at the same moment (a race the client-side
-- check alone can't catch), same as scans is already protected today.
--
-- Scoped per source_type: the same physical serial can legitimately
-- appear once as 'inventory' and once as 'grn' (already-in-stock vs.
-- pending-inward), so the constraint includes source_type rather than
-- blocking that.
-- If this cycle/store/serial/source combo already has duplicates sitting
-- in the table from before this fix, the ADD CONSTRAINT below will fail
-- ("could not create unique index — duplicate key"). Run this check first;
-- if it returns 0 rows, skip straight to the ALTER TABLE. If it returns
-- rows, review them, then run the DELETE further down before the ALTER.
select cycle_id, store_code, serial_no, source_type, count(*)
from base_serials
group by cycle_id, store_code, serial_no, source_type
having count(*) > 1;

-- Only run this if the check above returned rows and you're satisfied
-- it's safe — keeps the oldest row (by uploaded_at) of each duplicate
-- group and removes the rest.
-- delete from base_serials a using base_serials b
-- where a.cycle_id = b.cycle_id and a.store_code = b.store_code
--   and a.serial_no = b.serial_no and a.source_type = b.source_type
--   and a.uploaded_at > b.uploaded_at;

alter table base_serials
  add constraint base_serials_cycle_store_serial_source_unique
  unique (cycle_id, store_code, serial_no, source_type);

-- Speeds up the "does this exist already" duplicate check pattern used
-- by both the client-side dedup and this new constraint's own lookups.
create index if not exists idx_base_serials_lookup
  on base_serials(cycle_id, store_code, serial_no, source_type);
