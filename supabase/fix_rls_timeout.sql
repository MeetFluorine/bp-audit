-- ============================================================
-- FIX: statement timeout on cycle load / any operation
-- ROOT CAUSE: can_view_store()/has_store_access()/has_circle_access()
-- are SECURITY DEFINER functions — Postgres cannot inline these, so
-- they re-run their internal EXISTS subqueries ONCE PER ROW on every
-- SELECT against base_serials/scans. On a store with thousands of
-- serials, this multiplies out and blows past statement_timeout.
--
-- FIX: rewrite the SELECT policies on base_serials/scans to use
-- set-membership (`= any(select ...)`) instead of a per-row function
-- call, and wrap auth.uid() so Postgres caches it once per query
-- (an "InitPlan") instead of re-evaluating it per row. This lets the
-- planner use your existing indexes as a hash semi-join instead of
-- running a correlated subquery per row.
--
-- Safe to run multiple times — each policy is dropped and recreated.
-- Run this in the Supabase SQL editor.
-- ============================================================

drop policy if exists "scoped read base_serials" on base_serials;
create policy "scoped read base_serials" on base_serials for select
using (
  (select is_admin())
  or store_code = any (
    select store_code from user_stores where user_id = (select auth.uid())
  )
  or (
    (select is_circle_head())
    and store_code = any (
      select st.store_code from stores st
      join user_circles uc on uc.circle = st.circle
      where uc.user_id = (select auth.uid())
    )
  )
  or (
    (select is_client_role())
    and exists (
      select 1 from audit_cycles c where c.id = cycle_id and c.completed = true
    )
  )
);

drop policy if exists "scoped read scans" on scans;
create policy "scoped read scans" on scans for select
using (
  (select is_admin())
  or store_code = any (
    select store_code from user_stores where user_id = (select auth.uid())
  )
  or (
    (select is_circle_head())
    and store_code = any (
      select st.store_code from stores st
      join user_circles uc on uc.circle = st.circle
      where uc.user_id = (select auth.uid())
    )
  )
  or (
    (select is_client_role())
    and exists (
      select 1 from audit_cycles c where c.id = cycle_id and c.completed = true
    )
  )
);

-- Same pattern applied to the insert policy on scans (has_store_access
-- call happens once per insert row too, cheap normally since inserts
-- are one row — but fixing it costs nothing and keeps things consistent
-- for bulk chunked inserts of 500 rows at a time).
drop policy if exists "scoped insert scans" on scans;
create policy "scoped insert scans" on scans for insert
with check (
  (select is_admin())
  or (
    store_code = any (
      select store_code from user_stores where user_id = (select auth.uid())
    )
    and not is_store_locked(cycle_id, store_code)
  )
);

-- ------------------------------------------------------------
-- IMMEDIATE STOPGAP while the above rolls out / if you still see
-- timeouts on a very large cycle: raise the statement timeout for
-- the authenticated role. Default on Supabase is short. Adjust the
-- number (milliseconds) if needed — don't set this absurdly high,
-- it just masks the real cost.
-- ------------------------------------------------------------
alter role authenticated set statement_timeout = '30s';
