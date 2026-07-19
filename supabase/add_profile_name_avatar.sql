-- Run in Supabase Dashboard → SQL Editor
-- Adds full name + profile picture support to existing accounts.

alter table profiles add column if not exists full_name text;
alter table profiles add column if not exists avatar_url text;

-- Update the signup trigger so future sign-ups capture the name
-- entered on the sign-up form.
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

-- Avatar storage bucket (public read, write restricted to the owner's
-- own folder — path convention {user_id}/avatar.<ext>).
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

drop policy if exists "avatar images are publicly accessible" on storage.objects;
drop policy if exists "users can upload their own avatar" on storage.objects;
drop policy if exists "users can update their own avatar" on storage.objects;
drop policy if exists "users can delete their own avatar" on storage.objects;

create policy "avatar images are publicly accessible" on storage.objects
  for select using (bucket_id = 'avatars');
create policy "users can upload their own avatar" on storage.objects
  for insert with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users can update their own avatar" on storage.objects
  for update using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users can delete their own avatar" on storage.objects
  for delete using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
