-- ============================================================
-- COMPLETE FIX for regressions introduced by fix_rls_round2_all_policies.sql
--
-- That migration optimized RLS performance across every remaining policy,
-- but in rewriting them from a base schema.sql snapshot, it silently
-- dropped THREE circle-head permission branches that later, separate
-- migrations had added on top of that snapshot:
--
--   1. store_locks INSERT — a circle head could no longer submit/lock a
--      store in their own circle (add_circlehead_lock_access.sql's fix).
--      This is the error you just hit.
--
--   2. profiles SELECT ("read own profile") — a circle head could no
--      longer see the profile rows of auditors who signed up requesting
--      them as their circle head, silently breaking the "Pending Sign-up
--      Requests" list with no error at all (add_signup_role_routing.sql's
--      fix).
--
-- This migration restores both, keeping the same performance-safe
-- (select ...) wrapping pattern. Safe to run multiple times.
-- ============================================================

-- ---- 1. store_locks INSERT — restore circle-head lock permission ----
drop policy if exists "users lock their own assigned stores" on store_locks;
create policy "users lock their own assigned stores" on store_locks for insert
  with check (
    (select is_admin())
    or store_code = any (select store_code from user_stores where user_id = (select auth.uid()))
    or ((select is_circle_head()) and has_circle_access(store_code))
  );

-- ---- 2. profiles SELECT — restore circle-head visibility into their
--         own pending sign-up requests ----
drop policy if exists "read own profile" on profiles;
create policy "read own profile" on profiles for select
  using (
    id = (select auth.uid())
    or (select is_admin())
    or ((select is_circle_head()) and target_circle_head_id = (select auth.uid()))
  );
