-- Run in Supabase Dashboard → SQL Editor
-- Adds the pre-aggregated view used by the new Compare Cycles page.

create or replace view cycle_store_summary as
with base_matched as (
  select b.cycle_id, b.store_code,
    count(*) as expected_count,
    count(*) filter (where s.id is not null) as matched_count
  from base_serials b
  left join scans s
    on s.cycle_id = b.cycle_id and s.store_code = b.store_code and s.serial_no = b.serial_no
  group by b.cycle_id, b.store_code
),
excess as (
  select s.cycle_id, s.store_code, count(*) as excess_count
  from scans s
  left join base_serials b
    on b.cycle_id = s.cycle_id and b.store_code = s.store_code and b.serial_no = s.serial_no
  where b.id is null
  group by s.cycle_id, s.store_code
)
select
  bm.cycle_id, bm.store_code, bm.expected_count, bm.matched_count,
  (bm.expected_count - bm.matched_count) as short_count,
  coalesce(ex.excess_count, 0) as excess_count
from base_matched bm
left join excess ex on ex.cycle_id = bm.cycle_id and ex.store_code = bm.store_code;
