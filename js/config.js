const SUPABASE_URL = 'https://kaorzlsgifsrumrpezmn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imthb3J6bHNnaWZzcnVtcnBlem1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwMjM4MTEsImV4cCI6MjA5OTU5OTgxMX0.n2uXwOjDr01y2zoFN4-YAGdRKTniDJbi59nUD_y28TM';
let sb = null;
if(window.supabase && typeof window.supabase.createClient === 'function'){
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
  console.error('Supabase client library failed to load from CDN — check network/ad-blocker and reload.');
}
const STORE_MASTER = {
  'SFXCUTTACK':'ORS','SFXKANPUR':'UPE','SFXMORADABAD':'UPW','SFXALIGARH':'UPW','SFXAZAMGARH':'UPE',
  'SFXNIZAMABAD':'APTG','SFXNALGONDA':'APTG','SFXALLAHABAD':'UPE','SFXCOLONEJGANJ':'UPE','SFXSAMBHAL':'UPW',
  'SFXKOTA':'RAJ','SFXGHAZIABAD':'UPW','SFXSAHARANPUR':'UPW','SFXGULBARGA':'KK','SFXAMALAPURAM':'APTG',
  'SFXFARIDABAD':'HAR','SFXGURGAON':'HAR','SFXPANIPAT':'HAR','SFXVADODARA':'GUJ','SFXINDORE':'MPCG',
  'SFXGWALIOR':'MPCG','SFXPURNIA':'BHJ','SFXPATNA':'BHJ','SFXBEGUSARAI':'BHJ','SFXSURYAPET':'APTG',
  'SFXNIRMAL':'APTG','SFXJHAJJAR':'HAR','SFXHOOGHLY':'WB','SFXRASULUGARH':'ORS','SFXJHANSI':'UPE',
  'SFXBULANDSHAHR':'UPW','SFXBARABANKI':'UPE','SFXMADHUBANI':'BHJ','SFXDHOLI':'BHJ','SFXMIDNAPORE':'WB',
  'SFXFATEPUR':'WB'
};
function circleFor(store){ return STORE_MASTER[String(store).toUpperCase()] || '—'; }