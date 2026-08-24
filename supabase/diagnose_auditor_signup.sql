-- ============================================================
-- DIAGNOSTIC — run this in the Supabase SQL editor to check whether
-- your `stores` table is missing any store code that js/config.js's
-- STORE_MASTER expects. A missing code here is the #1 cause of
-- "Database error saving new user" specifically for auditor sign-ups
-- (every other role signs up fine because they never touch this table).
--
-- If this returns 0 rows, your stores table is fine and the auditor
-- sign-up issue is something else — see the troubleshooting guide.
-- ============================================================

with expected(store_code, circle) as (
  values
    ('SFXCUTTACK','ORS'), ('SFXKANPUR','UPE'), ('SFXMORADABAD','UPW'), ('SFXALIGARH','UPW'),
    ('SFXAZAMGARH','UPE'), ('SFXNIZAMABAD','APTG'), ('SFXNALGONDA','APTG'), ('SFXALLAHABAD','UPE'),
    ('SFXCOLONEJGANJ','UPE'), ('SFXSAMBHAL','UPW'), ('SFXKOTA','RAJ'), ('SFXGHAZIABAD','UPW'),
    ('SFXSAHARANPUR','UPW'), ('SFXGULBARGA','KK'), ('SFXAMALAPURAM','APTG'), ('SFXFARIDABAD','HAR'),
    ('SFXGURGAON','HAR'), ('SFXPANIPAT','HAR'), ('SFXVADODARA','GUJ'), ('SFXINDORE','MPCG'),
    ('SFXGWALIOR','MPCG'), ('SFXPURNIA','BHJ'), ('SFXPATNA','BHJ'), ('SFXBEGUSARAI','BHJ'),
    ('SFXSURYAPET','APTG'), ('SFXNIRMAL','APTG'), ('SFXJHAJJAR','HAR'), ('SFXHOOGHLY','WB'),
    ('SFXRASULUGARH','ORS'), ('SFXJHANSI','UPE'), ('SFXBULANDSHAHR','UPW'), ('SFXBARABANKI','UPE'),
    ('SFXMADHUBANI','BHJ'), ('SFXDHOLI','BHJ'), ('SFXMIDNAPORE','WB'), ('SFXFATEPUR','WB')
)
select e.store_code, e.circle as expected_circle, s.circle as actual_circle,
  case when s.store_code is null then 'MISSING FROM stores TABLE'
       when s.circle is distinct from e.circle then 'CIRCLE MISMATCH'
       else 'ok' end as issue
from expected e
left join stores s on s.store_code = e.store_code
where s.store_code is null or s.circle is distinct from e.circle;

-- Also worth a quick look: confirm the trigger itself is actually wired
-- up to auth.users (a signup can't run a function that isn't attached
-- to anything).
select tgname, tgrelid::regclass, tgenabled
from pg_trigger
where tgname = 'on_auth_user_created';

-- And confirm the function Postgres is actually running matches what
-- you expect (paste the output and compare against
-- supabase/add_signup_role_routing.sql — an old cached definition here
-- means that migration never actually got applied).
select prosrc from pg_proc where proname = 'handle_new_user';
