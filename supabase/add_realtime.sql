-- Run in Supabase Dashboard → SQL Editor
-- Enables Realtime so connected users see each other's scans, store
-- locks, and base data uploads instantly instead of waiting for a poll.

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='scans') then
    alter publication supabase_realtime add table scans;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='store_locks') then
    alter publication supabase_realtime add table store_locks;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='base_serials') then
    alter publication supabase_realtime add table base_serials;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='audit_cycles') then
    alter publication supabase_realtime add table audit_cycles;
  end if;
end $$;
