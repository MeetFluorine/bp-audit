-- Run in Supabase Dashboard → SQL Editor
-- Adds per-store audit locking: once an auditor submits a store's
-- scan work, it locks (no more add/delete/upload for that store)
-- until an admin explicitly unlocks it.

create table if not exists store_locks (
  cycle_id uuid references audit_cycles(id) on delete cascade,
  store_code text references stores(store_code) on update cascade,
  locked_by uuid references auth.users(id) on delete set null,
  locked_by_email text,
  locked_at timestamptz default now(),
  primary key (cycle_id, store_code)
);

alter table store_locks enable row level security;

drop policy if exists "approved users read store locks" on store_locks;
drop policy if exists "users lock their own assigned stores" on store_locks;
drop policy if exists "admins unlock any store" on store_locks;

create policy "approved users read store locks" on store_locks for select using (is_approved());
create policy "users lock their own assigned stores" on store_locks for insert with check (has_store_access(store_code));
create policy "admins unlock any store" on store_locks for delete using (is_admin());

-- Helper to check lock status
create or replace function is_store_locked(target_cycle uuid, target_store text)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from store_locks where cycle_id = target_cycle and store_code = target_store
  );
$$;

-- Strengthen the existing scans policies so a locked store is enforced
-- at the database level, not just hidden in the UI.
drop policy if exists "scoped insert scans" on scans;
drop policy if exists "delete own scans" on scans;

create policy "scoped insert scans" on scans for insert
  with check (is_admin() or (has_store_access(store_code) and not is_store_locked(cycle_id, store_code)));
create policy "delete own scans" on scans for delete
  using (is_admin() or (scanned_by = auth.uid() and not is_store_locked(cycle_id, store_code)));
