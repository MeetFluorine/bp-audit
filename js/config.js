const SUPABASE_URL = 'https://kaorzlsgifsrumrpezmn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imthb3J6bHNnaWZzcnVtcnBlem1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwMjM4MTEsImV4cCI6MjA5OTU5OTgxMX0.n2uXwOjDr01y2zoFN4-YAGdRKTniDJbi59nUD_y28TM';
let sb = null;
if(window.supabase && typeof window.supabase.createClient === 'function'){
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
  console.error('Supabase client library failed to load from CDN — check network/ad-blocker and reload.');
}
const STORE_MASTER = {
  'SFXCUTTACK':'ORS','SFXKanpur':'UPE','SFXMORADABAD':'UPW','SFXAligarh':'UPW','SFXAzamgarh':'UPE',
  'SFXNizamabad':'APTG','SFXNalgonda':'APTG','SFXAllahabad':'UPE','SFXColonejganj':'UPE','SFXSambhal':'UPW',
  'SFXKOTA':'RAJ','SFXGhaziabad':'UPW','SFXSaharanpur':'UPW','SFXGulbarga':'KK','SFXAmalapuram':'APTG',
  'SFXFaridabad':'HAR','SFXGurgaon':'HAR','SFXPanipat':'HAR','SFXVadodara':'GUJ','SFXIndore':'MPCG',
  'SFXGwalior':'MPCG','SFXPurnia':'BHJ','SFXPatna':'BHJ','SFXBegusarai':'BHJ','SFXSuryapet':'APTG',
  'SFXNirmal':'APTG','SFXJhajjar':'HAR','SFXHooghly':'WB','SFXRasulugarh':'ORS','SFXJhansi':'UPE',
  'SFXBulandshahr':'UPW','SFXBarabanki':'UPE','SFXMadhubani':'BHJ','SFXDholi':'BHJ','SFXMidnapore':'WB',
  'SFXFatepur':'WB'
};
function circleFor(store){ return STORE_MASTER[store] || '—'; }