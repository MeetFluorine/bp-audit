-- ============================================================
-- PV Recon Ledger — full Supabase schema (consolidated)
-- Run this ONCE, in full, on a fresh Supabase project's
-- SQL Editor → New query. This is the single source of truth —
-- it supersedes every incremental patch file from development.
-- ============================================================

-- ------------------------------------------------------------
-- 1. STORE MASTER
-- ------------------------------------------------------------
create table if not exists stores (
  store_code text primary key,
  circle text not null
);

insert into stores (store_code, circle) values
  ('SFXCUTTACK','ORS'),('SFXKANPUR','UPE'),('SFXMORADABAD','UPW'),('SFXALIGARH','UPW'),
  ('SFXAZAMGARH','UPE'),('SFXNIZAMABAD','APTG'),('SFXNALGONDA','APTG'),('SFXALLAHABAD','UPE'),
  ('SFXCOLONEJGANJ','UPE'),('SFXSAMBHAL','UPW'),('SFXKOTA','RAJ'),('SFXGHAZIABAD','UPW'),
  ('SFXSAHARANPUR','UPW'),('SFXGULBARGA','KK'),('SFXAMALAPURAM','APTG'),('SFXFARIDABAD','HAR'),
  ('SFXGURGAON','HAR'),('SFXPANIPAT','HAR'),('SFXVADODARA','GUJ'),('SFXINDORE','MPCG'),
  ('SFXGWALIOR','MPCG'),('SFXPURNIA','BHJ'),('SFXPATNA','BHJ'),('SFXBEGUSARAI','BHJ'),
  ('SFXSURYAPET','APTG'),('SFXNIRMAL','APTG'),('SFXJHAJJAR','HAR'),('SFXHOOGHLY','WB'),
  ('SFXRASULUGARH','ORS'),('SFXJHANSI','UPE'),('SFXBULANDSHAHR','UPW'),('SFXBARABANKI','UPE'),
  ('SFXMADHUBANI','BHJ'),('SFXDHOLI','BHJ'),('SFXMIDNAPORE','WB'),('SFXFATEPUR','WB')
on conflict (store_code) do update set circle = excluded.circle;

-- ------------------------------------------------------------
-- 2. AUDIT CYCLES
-- ------------------------------------------------------------
create table if not exists audit_cycles (
  id uuid primary key default gen_random_uuid(),
  cycle_name text not null,
  created_at timestamptz default now(),
  completed boolean default false,
  completed_at timestamptz
);

-- ------------------------------------------------------------
-- 3. BASE / SYSTEM DATA — the locked-in "expected" list per cycle
-- ------------------------------------------------------------
create table if not exists base_serials (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid references audit_cycles(id) on delete cascade,
  store_code text references stores(store_code) on update cascade,
  serial_no text not null,
  uploaded_at timestamptz default now()
);
create index if not exists idx_base_serials_cycle_store on base_serials(cycle_id, store_code);
create index if not exists idx_base_serials_serial on base_serials(serial_no);

-- ------------------------------------------------------------
-- 4. SCANS — every physical scan, tagged with store + auditor + time
--    scanned_by uses ON DELETE SET NULL so historical scans survive
--    even if the auditor's account is later removed.
-- ------------------------------------------------------------
create table if not exists scans (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid references audit_cycles(id) on delete cascade,
  store_code text references stores(store_code) on update cascade,
  sku text,
  serial_no text not null,
  scanned_by uuid references auth.users(id) on delete set null,
  scanned_at timestamptz default now()
);
create index if not exists idx_scans_cycle_store on scans(cycle_id, store_code);
create index if not exists idx_scans_serial on scans(serial_no);

-- ------------------------------------------------------------
-- 5. PROFILES — one row per login: role + approval status
--    New sign-ups start as role='user', approved=false.
-- ------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'user' check (role in ('admin','user')),
  approved boolean not null default false,
  created_at timestamptz default now()
);

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ------------------------------------------------------------
-- 6. STORE_LOCKS — once an auditor submits a store's scan work,
--     it locks (no more add/delete/upload) until an admin unlocks it.
-- ------------------------------------------------------------
create table if not exists store_locks (
  cycle_id uuid references audit_cycles(id) on delete cascade,
  store_code text references stores(store_code) on update cascade,
  locked_by uuid references auth.users(id) on delete set null,
  locked_by_email text,
  locked_at timestamptz default now(),
  primary key (cycle_id, store_code)
);

-- ------------------------------------------------------------
-- 7. USER_STORES — which stores each user may audit
-- ------------------------------------------------------------
create table if not exists user_stores (
  user_id uuid references profiles(id) on delete cascade,
  store_code text references stores(store_code) on delete cascade on update cascade,
  primary key (user_id, store_code)
);

-- ------------------------------------------------------------
-- 8. HELPER FUNCTIONS (security definer — safe for RLS to call
--    without recursive policy checks)
-- ------------------------------------------------------------
create or replace function is_admin()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function is_approved()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from profiles where id = auth.uid() and approved = true);
$$;

create or replace function has_store_access(target_store text)
returns boolean language sql security definer set search_path = public stable as $$
  select is_admin() or exists (
    select 1 from user_stores where user_id = auth.uid() and store_code = target_store
  );
$$;

create or replace function is_store_locked(target_cycle uuid, target_store text)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from store_locks where cycle_id = target_cycle and store_code = target_store
  );
$$;

-- ------------------------------------------------------------
-- 9. ROW LEVEL SECURITY — final policy set
-- ------------------------------------------------------------
alter table stores enable row level security;
alter table audit_cycles enable row level security;
alter table base_serials enable row level security;
alter table scans enable row level security;
alter table profiles enable row level security;
alter table user_stores enable row level security;
alter table store_locks enable row level security;

-- Drop-if-exists first so this file is safe to re-run.
drop policy if exists "approved users read stores" on stores;
drop policy if exists "approved users read cycles" on audit_cycles;
drop policy if exists "admins create cycles" on audit_cycles;
drop policy if exists "admins update cycles" on audit_cycles;
drop policy if exists "admins delete cycles" on audit_cycles;
drop policy if exists "scoped read base_serials" on base_serials;
drop policy if exists "admins insert base_serials" on base_serials;
drop policy if exists "scoped read scans" on scans;
drop policy if exists "scoped insert scans" on scans;
drop policy if exists "delete own scans" on scans;
drop policy if exists "read own profile" on profiles;
drop policy if exists "admins manage profiles" on profiles;
drop policy if exists "admins delete any profile" on profiles;
drop policy if exists "users delete own profile" on profiles;
drop policy if exists "users can create own profile" on profiles;
drop policy if exists "read own store assignments" on user_stores;
drop policy if exists "admins manage store assignments" on user_stores;
drop policy if exists "approved users read store locks" on store_locks;
drop policy if exists "users lock their own assigned stores" on store_locks;
drop policy if exists "admins unlock any store" on store_locks;

-- STORES: any approved, logged-in person can read the store master
create policy "approved users read stores" on stores for select using (is_approved());

-- AUDIT_CYCLES: admins fully manage; approved users can only read
create policy "approved users read cycles" on audit_cycles for select using (is_approved());
create policy "admins create cycles" on audit_cycles for insert with check (is_admin());
create policy "admins update cycles" on audit_cycles for update using (is_admin());
create policy "admins delete cycles" on audit_cycles for delete using (is_admin());

-- BASE_SERIALS: admin uploads; users can read only for their assigned stores
create policy "scoped read base_serials" on base_serials for select
  using (is_admin() or has_store_access(store_code));
create policy "admins insert base_serials" on base_serials for insert with check (is_admin());

-- SCANS: users insert/read only within their assigned stores;
-- deletion restricted to rows they personally scanned (admins: anything).
-- A locked store (store_locks) blocks non-admin inserts/deletes entirely —
-- this is real enforcement, not just a UI toggle.
create policy "scoped read scans" on scans for select
  using (is_admin() or has_store_access(store_code));
create policy "scoped insert scans" on scans for insert
  with check (is_admin() or (has_store_access(store_code) and not is_store_locked(cycle_id, store_code)));
create policy "delete own scans" on scans for delete
  using (is_admin() or (scanned_by = auth.uid() and not is_store_locked(cycle_id, store_code)));

-- PROFILES: everyone reads their own; admins read/update/delete all;
-- anyone can (re)create their own profile row (covers re-signup after
-- deleting an account — see README for why this matters)
create policy "read own profile" on profiles for select using (id = auth.uid() or is_admin());
create policy "admins manage profiles" on profiles for update using (is_admin());
create policy "admins delete any profile" on profiles for delete using (is_admin());
create policy "users delete own profile" on profiles for delete using (id = auth.uid());
create policy "users can create own profile" on profiles for insert with check (id = auth.uid());

-- USER_STORES: users see their own assignments; admins manage all
create policy "read own store assignments" on user_stores for select using (user_id = auth.uid() or is_admin());
create policy "admins manage store assignments" on user_stores for all using (is_admin()) with check (is_admin());

-- STORE_LOCKS: everyone approved can see lock status; a user can lock
-- (insert) only a store they're assigned to; only admins can unlock
create policy "approved users read store locks" on store_locks for select using (is_approved());
create policy "users lock their own assigned stores" on store_locks for insert with check (has_store_access(store_code));
create policy "admins unlock any store" on store_locks for delete using (is_admin());

-- ============================================================
-- 10. BOOTSTRAP YOUR FIRST ADMIN
-- Sign up once through the deployed app with your own email/password
-- FIRST, then run the line below (with your real email) to promote
-- yourself. Without this, no one can approve anyone — you must be
-- admin #1. Leave it commented until after you've signed up once.
-- ============================================================
-- update profiles set role = 'admin', approved = true where email = 'you@example.com';
