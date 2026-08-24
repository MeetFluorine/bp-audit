-- ============================================================
-- Adds two new roles and the workflow that goes with them.
-- Run this ONCE on an existing Supabase project that already has the
-- base schema (schema.sql) plus add_grn_source_type.sql. New/fresh
-- projects get all of this directly from an updated schema.sql.
--
-- What this adds:
--
-- 1. Two new profile roles, alongside the existing 'admin' / 'user'
--    (renamed in spirit to "Auditor" in the UI, value unchanged):
--      'circle_head' — scoped to one or more circles (a group of
--                       stores). Sees/exports only their circle(s),
--                       and can unlock a store in their own circle.
--      'client'      — read-only, sees every circle, but only the
--                       full match/short/excess breakdown for
--                       *completed* cycles. For a live/in-progress
--                       cycle they only see how many stores have
--                       been submitted so far, not the numbers —
--                       avoids alarming "62% short" reads that are
--                       really just "haven't been counted yet".
--
-- 2. user_circles — which circle(s) a circle_head may see/act on.
--    Mirrors the existing user_stores table for auditors.
--
-- 3. An approval workflow on store_locks: when an auditor submits a
--    store, it starts 'pending'. The store's circle head (if one is
--    assigned to that circle) can Approve or Reject with a remark.
--    Admins always see the same status + remark and can also
--    approve/reject directly (a circle head is not a gate the admin
--    is stuck behind — it's a review layer admins can see through
--    or override at any time).
-- ============================================================

-- ------------------------------------------------------------
-- Roles
-- ------------------------------------------------------------
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin','user','circle_head','client'));

-- ------------------------------------------------------------
-- Circle assignments (which circles a circle_head covers)
-- ------------------------------------------------------------
create table if not exists user_circles (
  user_id uuid references profiles(id) on delete cascade,
  circle text not null,
  primary key (user_id, circle)
);

-- ------------------------------------------------------------
-- Approval workflow on store submissions
-- ------------------------------------------------------------
alter table store_locks add column if not exists approval_status text not null default 'pending'
  check (approval_status in ('pending','approved','rejected'));
alter table store_locks add column if not exists approved_by uuid references auth.users(id) on delete set null;
alter table store_locks add column if not exists approved_by_email text;
alter table store_locks add column if not exists approved_at timestamptz;
alter table store_locks add column if not exists approval_remark text;

-- ------------------------------------------------------------
-- Helper functions
-- ------------------------------------------------------------
create or replace function is_circle_head()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'circle_head');
$$;

create or replace function is_client_role()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'client');
$$;

create or replace function has_circle_access(target_store text)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from stores st
    join user_circles uc on uc.circle = st.circle
    where st.store_code = target_store and uc.user_id = auth.uid()
  );
$$;

-- Single source of truth for "can this logged-in user read this store's
-- audit data for this cycle" — used by base_serials and scans read policies
-- so the four roles' visibility rules live in one place, not four.
create or replace function can_view_store(target_store text, target_cycle uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select
    is_admin()
    or has_store_access(target_store)  -- auditor: own assigned stores, any cycle status
    or (is_circle_head() and has_circle_access(target_store))  -- circle head: own circle, any cycle status
    or (is_client_role() and exists (
      select 1 from audit_cycles c where c.id = target_cycle and c.completed = true
    ))  -- client: any store, but only once the cycle is completed
$$;

-- ------------------------------------------------------------
-- RLS — replace the old admin-or-own-store read rules with can_view_store
-- ------------------------------------------------------------
drop policy if exists "scoped read base_serials" on base_serials;
create policy "scoped read base_serials" on base_serials for select
  using (can_view_store(store_code, cycle_id));

drop policy if exists "scoped read scans" on scans;
create policy "scoped read scans" on scans for select
  using (can_view_store(store_code, cycle_id));
-- insert/delete policies on scans are unchanged — only admins and the
-- assigned auditor can ever write scan rows; circle heads and clients
-- stay read-only on this table by design.

-- store_locks: circle heads can now unlock their own circle's stores
-- (previously admin-only), and can update approval fields on their own
-- circle's rows (admins can update/unlock anything, as before).
drop policy if exists "admins unlock any store" on store_locks;
create policy "admins and circle heads unlock stores" on store_locks for delete
  using (is_admin() or (is_circle_head() and has_circle_access(store_code)));

drop policy if exists "approve store submissions" on store_locks;
create policy "approve store submissions" on store_locks for update
  using (is_admin() or (is_circle_head() and has_circle_access(store_code)))
  with check (is_admin() or (is_circle_head() and has_circle_access(store_code)));

-- USER_CIRCLES: users see their own assignments; admins manage all
alter table user_circles enable row level security;
drop policy if exists "read own circle assignments" on user_circles;
drop policy if exists "admins manage circle assignments" on user_circles;
create policy "read own circle assignments" on user_circles for select using (user_id = auth.uid() or is_admin());
create policy "admins manage circle assignments" on user_circles for all using (is_admin()) with check (is_admin());

-- Let circle heads/clients see it in realtime the same as everyone else —
-- store_locks is already in the realtime publication from add_realtime.sql.
