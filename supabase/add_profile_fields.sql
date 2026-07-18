-- ============================================================
-- Patch: profile name + picture, and safe self-service profile
-- editing. Run this once in SQL Editor on an existing project
-- that was set up before this patch. (Fresh installs: this is
-- already folded into schema.sql — no need to run it again.)
-- ============================================================

-- ------------------------------------------------------------
-- 1. New columns
-- ------------------------------------------------------------
alter table profiles add column if not exists full_name text;
alter table profiles add column if not exists avatar_url text;

-- ------------------------------------------------------------
-- 2. Capture the name typed on the sign-up form (passed as
--    auth metadata) into the profile row automatically.
-- ------------------------------------------------------------
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 3. Let a user update their OWN row (needed so the Profile
--    page can save full_name / avatar_url) — but guard against
--    someone using that same access to self-approve or make
--    themselves admin by editing role/approved/email directly.
-- ------------------------------------------------------------
drop policy if exists "users update own profile" on profiles;
create policy "users update own profile" on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create or replace function prevent_profile_privilege_escalation()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not is_admin() then
    if new.role is distinct from old.role
       or new.approved is distinct from old.approved
       or new.email is distinct from old.email then
      raise exception 'Not permitted to change role, approval status, or email here';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_privilege on profiles;
create trigger guard_profile_privilege
  before update on profiles
  for each row execute function prevent_profile_privilege_escalation();

-- ------------------------------------------------------------
-- 4. Storage bucket for profile photos.
--    Public read (so avatars render without a signed URL);
--    each user may only write inside a folder named after
--    their own user id, e.g. avatars/<user-id>/avatar.jpg
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars','avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "avatar public read" on storage.objects;
create policy "avatar public read" on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "users upload own avatar" on storage.objects;
create policy "users upload own avatar" on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users update own avatar" on storage.objects;
create policy "users update own avatar" on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users delete own avatar" on storage.objects;
create policy "users delete own avatar" on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
