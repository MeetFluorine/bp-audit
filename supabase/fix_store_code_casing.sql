-- Run in Supabase Dashboard → SQL Editor
-- Fixes the store-code casing mismatch causing:
--   "insert or update on table base_serials violates foreign key
--    constraint base_serials_store_code_fkey"
-- Root cause: the real inventory export uses inconsistent casing for
-- LocationCode (e.g. "SFXVadodara" vs "SFXVADODARA" even within the
-- same file), while our stores table only had one fixed casing per
-- store. This makes UPPERCASE the canonical form everywhere, and lets
-- store codes be corrected safely in future without breaking existing
-- linked data.

-- 1. Allow store_code corrections to cascade automatically to
--    everything that references it, instead of being blocked.
alter table base_serials drop constraint if exists base_serials_store_code_fkey;
alter table base_serials add constraint base_serials_store_code_fkey
  foreign key (store_code) references stores(store_code) on update cascade;

alter table scans drop constraint if exists scans_store_code_fkey;
alter table scans add constraint scans_store_code_fkey
  foreign key (store_code) references stores(store_code) on update cascade;

alter table user_stores drop constraint if exists user_stores_store_code_fkey;
alter table user_stores add constraint user_stores_store_code_fkey
  foreign key (store_code) references stores(store_code) on delete cascade on update cascade;

-- 2. Normalize every existing store code to uppercase. This cascades
--    automatically to base_serials, scans, and user_stores thanks to
--    step 1 — nothing else needs to be touched manually.
update stores set store_code = upper(store_code);
