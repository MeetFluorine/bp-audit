-- ============================================================
-- Grants a circle head physical-scan access for stores in their own
-- circle — matching the base-data-upload access they already have.
--
-- When Circle Head base-data upload was added (add_auto_complete_and_
-- circlehead_upload.sql), the RLS policy for base_serials was updated to
-- allow circle heads, but the equivalent policy for `scans` (physical
-- serial scans — the actual audit data) was missed. The Scan/Upload tab
-- in the UI is now visible to circle heads too, but without this
-- migration their scans/uploads would still silently fail RLS.
--
-- Run this once, after add_auto_complete_and_circlehead_upload.sql.
-- Safe to re-run.
-- ============================================================

drop policy if exists "scoped insert scans" on scans;
create policy "scoped insert scans" on scans for insert
  with check (
    is_admin()
    or (has_store_access(store_code) and not is_store_locked(cycle_id, store_code))
    or (is_circle_head() and has_circle_access(store_code) and not is_store_locked(cycle_id, store_code))
  );

-- Deleting a scan (e.g. correcting a mis-scan) already worked for a circle
-- head on rows they personally scanned (scanned_by = auth.uid()), so no
-- change needed there — this migration only adds the missing INSERT path.
