-- Run in Supabase Dashboard → SQL Editor
-- Adds a database-level guarantee that the same serial can't be scanned
-- twice for the same store within the same cycle — this is the backstop
-- for the case the app's own duplicate check can't catch: two devices
-- scanning the exact same serial at the exact same moment.

-- Step 1: clean up any duplicates that may already exist, keeping only
-- the earliest scan of each (cycle, store, serial) combination.
delete from scans a using scans b
where a.cycle_id = b.cycle_id
  and a.store_code = b.store_code
  and a.serial_no = b.serial_no
  and a.scanned_at > b.scanned_at;

-- Step 2: add the constraint now that the data is clean.
alter table scans drop constraint if exists scans_cycle_id_store_code_serial_no_key;
alter table scans add constraint scans_cycle_id_store_code_serial_no_key
  unique (cycle_id, store_code, serial_no);
