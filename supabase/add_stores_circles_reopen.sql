-- ============================================================
-- PV Recon Ledger — Stores & Circles management + Reopen history
-- Run this ONCE in Supabase SQL Editor. Safe to re-run.
--
-- What it adds (nothing existing is dropped or renamed):
--   1. stores gains name / store_type / active columns. A store is
--      "removed from the list" by setting active = false — the row is
--      NEVER deleted, because base_serials, scans, store_locks and
--      user_stores all reference it. History keeps working, and the
--      store simply disappears from dropdowns, readiness and progress.
--   2. circles table (code, name, active) seeded from the circles
--      already used by stores.
--   3. store_reopen_history — one row per reopen, keeping the
--      superseded lock (who locked it, when, review status, remark)
--      next to the reopen reason, so a reopen never erases history.
--   4. sync_cycle_completion now counts ACTIVE stores only, so a
--      deactivated store can never block automatic cycle completion.
--   5. RLS: admins manage stores/circles/history; circle heads may
--      read stores/circles and record reopens for their own circles.
--
-- Until this file is run, the app keeps working exactly as before:
-- the Stores & Circles page reads the existing stores table (new
-- columns default in the client), and add/edit/remove + reopen
-- history show a "run this migration" message instead of failing
-- silently. Reopening itself (deleting the lock row) already works
-- today — the RLS policy "admins and circle heads unlock stores"
-- covers it — so no audit is ever blocked by this migration.
-- ============================================================

-- ------------------------------------------------------------
-- 1. STORES — display name, type, active flag
-- ------------------------------------------------------------
alter table stores add column if not exists name text;
alter table stores add column if not exists store_type text;
alter table stores add column if not exists active boolean not null default true;

-- Backfill: display name defaults to the store code.
update stores set name = store_code where name is null or name = '';

-- ------------------------------------------------------------
-- 2. CIRCLES — the circle master, seeded from stores
-- ------------------------------------------------------------
create table if not exists circles (
  code text primary key,
  name text,
  active boolean not null default true,
  created_at timestamptz default now()
);

insert into circles (code, name)
  select distinct circle, circle from stores
  on conflict (code) do nothing;

-- ------------------------------------------------------------
-- 3. STORE_REOPEN_HISTORY — superseded lock + reason, per reopen
-- ------------------------------------------------------------
create table if not exists store_reopen_history (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid references audit_cycles(id) on delete cascade,
  store_code text references stores(store_code) on update cascade,
  reopened_by uuid references auth.users(id) on delete set null,
  reopened_by_email text,
  reason text not null,
  -- snapshot of the lock row being superseded, so the previous
  -- submission (and its review state) is never lost:
  previous_locked_at timestamptz,
  previous_locked_by_email text,
  previous_approval_status text,
  previous_approval_remark text,
  created_at timestamptz default now()
);
create index if not exists idx_reopen_history_cycle_store
  on store_reopen_history(cycle_id, store_code, created_at desc);

-- ------------------------------------------------------------
-- 4. CYCLE COMPLETION — active stores only
-- ------------------------------------------------------------
create or replace function sync_cycle_completion()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cycle_id uuid;
  v_total_stores int;
  v_approved_stores int;
begin
  v_cycle_id := coalesce(new.cycle_id, old.cycle_id);
  if v_cycle_id is null then
    return null;
  end if;
  -- Only ACTIVE stores count: a store removed from the list must not
  -- hold a cycle open forever. (Before this migration the count was
  -- over all stores; that behaviour is preserved automatically while
  -- every store is still active.)
  select count(*) into v_total_stores from stores where active = true;
  select count(*) into v_approved_stores from store_locks
    where cycle_id = v_cycle_id and approval_status = 'approved';
  if v_total_stores > 0 and v_approved_stores = v_total_stores then
    update audit_cycles set completed = true, completed_at = coalesce(completed_at, now())
      where id = v_cycle_id and completed = false;
  else
    update audit_cycles set completed = false
      where id = v_cycle_id and completed = true;
  end if;
  return null;
end;
$$;

-- ------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- ------------------------------------------------------------
alter table circles enable row level security;
alter table store_reopen_history enable row level security;

drop policy if exists "admins manage stores" on stores;
drop policy if exists "approved users read circles" on circles;
drop policy if exists "admins manage circles" on circles;
drop policy if exists "approved users read reopen history" on store_reopen_history;
drop policy if exists "admins and circle heads record reopens" on store_reopen_history;
drop policy if exists "admins manage reopen history" on store_reopen_history;

-- Stores: reads already allowed to approved users ("approved users
-- read stores" from schema.sql). Writes are admin-only.
create policy "admins manage stores" on stores
  for all using (is_admin()) with check (is_admin());

-- Circles: any approved user can read; admins manage.
create policy "approved users read circles" on circles
  for select using (is_approved());
create policy "admins manage circles" on circles
  for all using (is_admin()) with check (is_admin());

-- Reopen history: approved users read; admins or the store's own
-- circle head record a reopen; admins manage (cleanup).
create policy "approved users read reopen history" on store_reopen_history
  for select using (is_approved());
create policy "admins and circle heads record reopens" on store_reopen_history
  for insert with check (is_admin() or (is_circle_head() and has_circle_access(store_code)));
create policy "admins manage reopen history" on store_reopen_history
  for update using (is_admin()) with check (is_admin());
create policy "admins delete reopen history" on store_reopen_history
  for delete using (is_admin());

-- Realtime: reopen history changes refresh connected clients.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='store_reopen_history') then
    alter publication supabase_realtime add table store_reopen_history;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='circles') then
    alter publication supabase_realtime add table circles;
  end if;
end $$;
