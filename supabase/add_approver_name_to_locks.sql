-- ============================================================
-- Adds a real display-name column for who approved/rejected a store,
-- so reports can show "Chandan" instead of "chandangee77@gmail.com".
--
-- Run this once. Safe to re-run.
-- ============================================================

alter table store_locks add column if not exists approved_by_name text;

-- Existing rows approved before this migration have no name on file —
-- that's fine, the app falls back to deriving one from the email for
-- those. Nothing to backfill.
