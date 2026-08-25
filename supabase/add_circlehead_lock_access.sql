-- ============================================================
-- Grants a circle head permission to submit/lock a store's audit
-- (insert into store_locks) for stores in their own circle — completing
-- the fix started in add_circlehead_scan_access.sql.
--
-- That migration fixed the `scans` table (so a circle head could actually
-- record physical serials), but missed that "Submit & lock this store's
-- audit" is a SEPARATE insert into store_locks, gated by its own RLS
-- policy — which, like `scans` before it, only ever checked
-- has_store_access() (an auditor's own store_stores assignment), never
-- has_circle_access() (a circle head's circle). Result: a circle head
-- could scan every serial for their own store just fine, then get
-- "new row violates row-level security policy for table store_locks"
-- the moment they tried to submit it.
--
-- Run this once. Safe to re-run.
-- ============================================================

drop policy if exists "users lock their own assigned stores" on store_locks;
create policy "users lock their own assigned stores" on store_locks for insert
  with check (has_store_access(store_code) or (is_circle_head() and has_circle_access(store_code)));
