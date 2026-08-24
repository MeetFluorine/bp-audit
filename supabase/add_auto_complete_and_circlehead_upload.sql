-- ============================================================
-- Two changes:
--
-- 1. AUTOMATIC CYCLE COMPLETION — removes the manual "Complete audit"
--    admin button. A cycle's audit_cycles.completed flag is now kept in
--    sync automatically by a trigger on store_locks: true once every
--    store in the master list is locked AND approved (no pending or
--    rejected submissions left), false again the moment that stops
--    being true (e.g. a circle head rejects a submission, or a store
--    gets unlocked for correction). This runs as a SECURITY DEFINER
--    function so it applies regardless of who triggered the underlying
--    change (admin, auditor, or circle head) — no extra grants needed
--    on audit_cycles for anyone.
--
-- 2. CIRCLE HEAD BASE DATA UPLOAD — a circle head can now upload
--    Inventory/GRN base data for stores in their own circle only.
--    Enforced by RLS, not just hidden in the UI.
-- ============================================================

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
  select count(*) into v_total_stores from stores;
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

drop trigger if exists trg_sync_cycle_completion on store_locks;
create trigger trg_sync_cycle_completion
  after insert or update or delete on store_locks
  for each row execute function sync_cycle_completion();

-- Circle heads can insert base_serials for their own circle's stores.
drop policy if exists "admins insert base_serials" on base_serials;
drop policy if exists "admins and circle heads insert base_serials" on base_serials;
create policy "admins and circle heads insert base_serials" on base_serials for insert
  with check (is_admin() or (is_circle_head() and has_circle_access(store_code)));
