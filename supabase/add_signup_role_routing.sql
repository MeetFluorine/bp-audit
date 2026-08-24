-- ============================================================
-- Adds role selection at sign-up, with approval routed to the
-- right reviewer per role:
--   Admin    -> admin approves (unchanged; visible in Admin > Users)
--   Client   -> admin approves (unchanged; visible in Admin > Users)
--   Circle Head -> picks the circle(s) they want; admin approves
--                  (the requested circles are pre-assigned in
--                  user_circles immediately, so approval alone
--                  grants full access)
--   Auditor  -> picks the one store they'll audit; approval is
--               routed straight to THAT store's circle head (if
--               one exists) instead of admin. Admin still sees
--               and can act on every request either way — this
--               only adds a reviewer, it never removes admin's.
--
-- Run this once, after schema.sql (and after
-- add_roles_circles_approval.sql if you ran that separately).
-- Safe to re-run.
-- ============================================================

-- 1. New columns on profiles to remember what was requested at
--    sign-up and who an auditor's request is routed to.
alter table profiles add column if not exists requested_store text;
alter table profiles add column if not exists requested_circles text[];
alter table profiles add column if not exists target_circle_head_id uuid references profiles(id) on delete set null;

-- 2. Replace the sign-up trigger so it reads the role/store/circles
--    the person picked on the sign-up form (passed as auth metadata)
--    instead of always defaulting to 'user' with no assignment.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
  v_store text;
  v_circle text;
  v_target_head uuid;
  v_circles jsonb;
begin
  v_role := new.raw_user_meta_data->>'requested_role';
  if v_role is null or v_role not in ('admin','user','circle_head','client') then
    v_role := 'user';
  end if;

  v_store := nullif(trim(new.raw_user_meta_data->>'requested_store'), '');
  -- IMPORTANT: '->' returns the JSON *value* for the key, and when the
  -- client sends `requested_circles: null` (every non-circle-head signup,
  -- including every auditor) that value is a JSON null literal — which is
  -- NOT the same as SQL NULL. Left unguarded, `v_circles is not null` would
  -- still be true for it, and jsonb_array_elements_text() on a JSON null
  -- throws ("cannot extract elements from a scalar"), which is exactly what
  -- was breaking every auditor sign-up ("Database error saving new user").
  -- nullif(...,'null'::jsonb) collapses that JSON null down to a real SQL
  -- NULL so every check below behaves correctly.
  v_circles := nullif(new.raw_user_meta_data->'requested_circles', 'null'::jsonb);

  -- Auditor sign-up: find that store's circle, then that circle's
  -- circle head (if any) to route the approval to.
  if v_role = 'user' and v_store is not null then
    select circle into v_circle from stores where store_code = v_store;
    if v_circle is not null then
      select uc.user_id into v_target_head
        from user_circles uc
        join profiles p on p.id = uc.user_id
        where uc.circle = v_circle and p.role = 'circle_head'
        limit 1;
    end if;
  end if;

  insert into public.profiles (id, email, full_name, role, requested_store, requested_circles, target_circle_head_id)
  values (
    new.id, new.email, new.raw_user_meta_data->>'full_name', v_role,
    v_store,
    case when v_circles is not null then (select array_agg(x) from jsonb_array_elements_text(v_circles) x) else null end,
    v_target_head
  )
  on conflict (id) do nothing;

  -- Pre-provision the requested access now, so approval (flipping
  -- `approved` to true) is the only remaining step — no separate
  -- manual store/circle assignment needed afterward.
  --
  -- Guarded with an existence check: user_stores.store_code has a foreign
  -- key to stores(store_code), so if the live `stores` table is ever out of
  -- sync with the store list the sign-up form shows (e.g. config.js was
  -- updated with new stores but this table's seed insert wasn't re-run),
  -- inserting an unrecognized code throws a foreign-key violation and
  -- silently fails the WHOLE sign-up ("Database error saving new user") —
  -- for every auditor, regardless of which store they picked. The account
  -- itself should never be blocked by that; worst case here is just that
  -- the store isn't auto-assigned, and whoever approves the request can
  -- assign it manually from Admin -> Users & Stores.
  if v_role = 'user' and v_store is not null and exists (select 1 from stores where store_code = v_store) then
    insert into user_stores (user_id, store_code) values (new.id, v_store)
      on conflict do nothing;
  elsif v_role = 'circle_head' and v_circles is not null then
    insert into user_circles (user_id, circle)
      select new.id, x from jsonb_array_elements_text(v_circles) x
      on conflict do nothing;
  end if;

  return new;
end;
$$;

-- 3. RLS: let a circle head see and act on JUST the auditor sign-up
--    requests routed to them — everything else (their own profile,
--    every other role's request) stays admin-only, unchanged.
drop policy if exists "read own profile" on profiles;
create policy "read own profile" on profiles for select
  using (id = auth.uid() or is_admin() or (is_circle_head() and target_circle_head_id = auth.uid()));

drop policy if exists "circle heads approve their auditor signups" on profiles;
create policy "circle heads approve their auditor signups" on profiles for update
  using (is_circle_head() and target_circle_head_id = auth.uid() and role = 'user')
  with check (is_circle_head() and target_circle_head_id = auth.uid() and role = 'user');

drop policy if exists "circle heads reject their auditor signups" on profiles;
create policy "circle heads reject their auditor signups" on profiles for delete
  using (is_circle_head() and target_circle_head_id = auth.uid() and role = 'user' and approved = false);

-- Done. Existing users are unaffected — requested_store/requested_circles/
-- target_circle_head_id are simply null for every profile that already
-- existed before this migration ran.
