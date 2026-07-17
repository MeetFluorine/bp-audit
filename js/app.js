let currentCycleId = null;
let currentCycleName = '';

let baseData = [];
let scanData = [];
let detailResults = [];
let auditCompleted = false;
let storeChartInstance = null, varianceChartInstance = null;

// ---------------- AUTH & ROLES ----------------
let currentUser = null;      // { id, email }
let currentProfile = null;   // { role, approved }
let myAssignedStores = [];   // store codes this user can access (empty for admin = all)
let authMode = 'signin';

function togglePasswordVisibility(inputId, btn){
  const input = document.getElementById(inputId);
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.querySelector('.eye-open').style.display = showing ? '' : 'none';
  btn.querySelector('.eye-closed').style.display = showing ? 'none' : '';
  btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  btn.setAttribute('title', showing ? 'Show password' : 'Hide password');
}

function switchAuthMode(mode){
  authMode = mode;
  document.getElementById('authTabSignin').classList.toggle('active', mode==='signin');
  document.getElementById('authTabSignup').classList.toggle('active', mode==='signup');
  document.getElementById('authSubmitBtn').textContent = mode==='signin' ? 'Sign in' : 'Create account';
  document.getElementById('authMessage').textContent = '';
}

function setAuthMessage(text, isError){
  const el = document.getElementById('authMessage');
  el.textContent = text;
  el.className = 'auth-message ' + (isError ? 'error' : 'ok');
}

async function handleAuthSubmit(){
  if(!sb){ setAuthMessage('Supabase library failed to load — check your connection and reload.', true); return; }
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  if(!email || !password){ setAuthMessage('Enter both email and password.', true); return; }

  setAuthMessage(authMode==='signin' ? 'Signing in…' : 'Creating account…', false);
  try{
    if(authMode === 'signup'){
      const { data, error } = await sb.auth.signUp({ email, password });
      if(error) throw error;
      setAuthMessage('Account created. Waiting for admin approval — you can sign in once approved.', false);
    } else {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if(error) throw error;
      if(!data || !data.user){ throw new Error('Sign-in succeeded but no user was returned — please try again.'); }
      await onLoginSuccess(data.user);
    }
  }catch(e){
    setAuthMessage(errMsg(e), true);
  }
}

async function handleSignOut(){
  if(sb) await sb.auth.signOut();
  currentUser = null; currentProfile = null; myAssignedStores = [];
  document.body.className = '';
  document.getElementById('appRoot').style.display = 'none';
  document.getElementById('pendingScreen').style.display = 'none';
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('authEmail').value = '';
  document.getElementById('authPassword').value = '';
  setAuthMessage('', false);
}

async function checkApprovalAgain(){
  await onLoginSuccess();
}

async function onLoginSuccess(knownUser){
  let user = knownUser;
  if(!user){
    const { data, error: getUserErr } = await sb.auth.getUser();
    user = data ? data.user : null;
    if(getUserErr || !user){
      setAuthMessage('Could not confirm your session — please sign in again.', true);
      document.getElementById('loadingScreen') && (document.getElementById('loadingScreen').style.display = 'none');
      document.getElementById('authScreen').style.display = 'flex';
      return;
    }
  }
  currentUser = { id: user.id, email: user.email };

  try{
    const { data: profile, error } = await sb.from('profiles').select('*').eq('id', user.id).single();
    if(error || !profile){
      // No profile — either a brand-new signup (trigger race) or someone
      // who previously deleted their own account and is signing back in.
      // Recreate a fresh pending profile so they show up for admin approval.
      const { data: recreated, error: recreateErr } = await sb.from('profiles')
        .insert({ id: user.id, email: user.email }).select().single();
      if(recreateErr || !recreated){
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('pendingScreen').style.display = 'flex';
        document.getElementById('pendingEmail').textContent = user.email;
        return;
      }
      document.getElementById('authScreen').style.display = 'none';
      document.getElementById('pendingScreen').style.display = 'flex';
      document.getElementById('pendingEmail').textContent = user.email;
      return;
    }
    currentProfile = profile;

    if(!profile.approved){
      document.getElementById('authScreen').style.display = 'none';
      document.getElementById('pendingScreen').style.display = 'flex';
      document.getElementById('pendingEmail').textContent = user.email;
      return;
    }

    // Approved — load into the app
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('pendingScreen').style.display = 'none';
    document.getElementById('appRoot').style.display = 'block';
    document.body.className = profile.role === 'admin' ? 'role-admin' : 'role-user';
    document.getElementById('whoAmI').textContent = `${user.email} · ${profile.role}`;

    if(profile.role !== 'admin'){
      const { data: assigned } = await sb.from('user_stores').select('store_code').eq('user_id', user.id);
      myAssignedStores = (assigned || []).map(r => r.store_code);
      showStep('scan');
    } else {
      myAssignedStores = [];
    }

    if(profile.role === 'admin') renderAdminPanel();
  }catch(e){
    console.error(e);
    document.getElementById('appRoot').style.display = 'none';
    document.getElementById('pendingScreen').style.display = 'none';
    document.getElementById('authScreen').style.display = 'flex';
    setAuthMessage('Something went wrong loading your account: ' + errMsg(e) + ' — please try signing in again.', true);
  }
}

// ---------------- ADMIN PANEL ----------------
async function renderAdminPanel(){
  if(!sb || !currentProfile || currentProfile.role !== 'admin') return;
  try{
    const { data: pending, error: pendErr } = await sb.from('profiles').select('*').eq('approved', false).order('created_at', {ascending:true});
    if(pendErr) throw pendErr;
    const pendBody = document.getElementById('pendingUsersBody');
    pendBody.innerHTML = (pending && pending.length) ? pending.map(p => `
      <tr><td>${p.email}</td><td>${new Date(p.created_at).toLocaleDateString()}</td>
      <td><div class="btn-row"><button class="btn btn-primary" onclick="approveUser('${p.id}')">Approve</button><button class="btn btn-danger" onclick="adminDeleteUser('${p.id}','${p.email.replace(/'/g,"\\'")}')">Reject</button></div></td></tr>`).join('')
      : '<tr><td colspan="3" class="empty-note">No pending sign-ups.</td></tr>';

    const { data: approvedUsers, error: apprErr } = await sb.from('profiles').select('*').eq('approved', true).order('email');
    if(apprErr) throw apprErr;
    const { data: allAssignments, error: assignErr } = await sb.from('user_stores').select('*');
    if(assignErr) throw assignErr;

    const storeCodes = Object.keys(STORE_MASTER).sort();
    const listEl = document.getElementById('approvedUsersList');
    listEl.innerHTML = (approvedUsers || []).map(u => {
      const myStores = new Set((allAssignments||[]).filter(a=>a.user_id===u.id).map(a=>a.store_code));
      const chips = storeCodes.map(sc => `<span class="store-chip ${myStores.has(sc)?'active':''}" onclick="toggleStoreAssignment('${u.id}','${sc}',${myStores.has(sc)})">${sc}</span>`).join('');
      return `<div class="user-row">
        <div class="user-row-email">${u.email} <span class="role-pill ${u.role}">${u.role}</span></div>
        <div class="user-row-stores">${chips}</div>
        <div class="btn-row">
          ${u.role!=='admin' ? `<button class="btn" onclick="promoteToAdmin('${u.id}')">Make admin</button>` : ''}
          ${u.id !== (currentUser?currentUser.id:null) ? `<button class="btn btn-danger" onclick="adminDeleteUser('${u.id}','${u.email.replace(/'/g,"\\'")}')">Delete user</button>` : ''}
        </div>
      </div>`;
    }).join('') || '<div class="empty-note">No approved users yet.</div>';
  }catch(e){
    console.error(e);
    showMessage('Could not load admin panel: ' + errMsg(e), true);
  }
}

async function approveUser(userId){
  try{
    const { error } = await sb.from('profiles').update({approved:true}).eq('id', userId);
    if(error) throw error;
    showMessage('User approved.');
    renderAdminPanel();
  }catch(e){
    console.error(e);
    showMessage('Could not approve user: ' + errMsg(e), true);
  }
}

async function promoteToAdmin(userId){
  confirmAction('promote-'+userId, 'This gives full admin rights to this user', async () => {
    try{
      const { error } = await sb.from('profiles').update({role:'admin'}).eq('id', userId);
      if(error) throw error;
      showMessage('User promoted to admin.');
      renderAdminPanel();
    }catch(e){
      console.error(e);
      showMessage('Could not promote user: ' + errMsg(e), true);
    }
  });
}

async function toggleStoreAssignment(userId, storeCode, currentlyAssigned){
  try{
    if(currentlyAssigned){
      const { error } = await sb.from('user_stores').delete().eq('user_id', userId).eq('store_code', storeCode);
      if(error) throw error;
    } else {
      const { error } = await sb.from('user_stores').insert({user_id:userId, store_code:storeCode});
      if(error) throw error;
    }
    renderAdminPanel();
  }catch(e){
    console.error(e);
    showMessage('Could not update store assignment: ' + errMsg(e), true);
  }
}

async function adminDeleteUser(userId, email){
  confirmAction('admin-delete-'+userId, `This immediately revokes all access for ${email}`, async () => {
    try{
      const { error } = await sb.from('profiles').delete().eq('id', userId);
      if(error) throw error;
      showMessage(`Removed ${email}. Their login still exists in Supabase Auth but has no access until re-approved.`);
      renderAdminPanel();
    }catch(e){
      console.error(e);
      showMessage('Could not delete user: ' + errMsg(e), true);
    }
  });
}

// ---------------- PROFILE ----------------
async function renderProfilePanel(){
  if(!currentUser || !currentProfile) return;
  const storesLine = currentProfile.role === 'admin'
    ? 'All stores (admin)'
    : (myAssignedStores.length ? myAssignedStores.join(', ') : 'None assigned yet — contact your admin');
  document.getElementById('profileInfo').innerHTML = `
    Email: ${currentUser.email}<br>
    Role: ${currentProfile.role}<br>
    Approved: ${currentProfile.approved ? 'Yes' : 'No'}<br>
    Assigned stores: ${storesLine}`;
}

async function handleChangePassword(){
  const pw = document.getElementById('newPassword').value;
  const confirm = document.getElementById('confirmPassword').value;
  if(!pw || pw.length < 6){ showMessage('Password must be at least 6 characters.', true); return; }
  if(pw !== confirm){ showMessage('Passwords do not match.', true); return; }
  try{
    const { error } = await sb.auth.updateUser({ password: pw });
    if(error) throw error;
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
    showMessage('Password updated.');
  }catch(e){
    console.error(e);
    showMessage('Could not update password: ' + errMsg(e), true);
  }
}

function handleDeleteOwnAccount(){
  if(!currentUser) return;
  confirmAction('delete-own-account', 'This permanently deletes your profile, role, and store assignments', async () => {
    try{
      const { error } = await sb.from('profiles').delete().eq('id', currentUser.id);
      if(error) throw error;
      showMessage('Account deleted.');
      await handleSignOut();
    }catch(e){
      console.error(e);
      showMessage('Could not delete your account: ' + errMsg(e), true);
    }
  });
}

const STORE_ALIASES = ['store','store name','storename','store id','storeid','locationcode','location code'];
const SKU_ALIASES = ['sku','item','item code','itemcode','material','material code','materialcode','itemno','item no','no2'];
const SERIAL_ALIASES = ['serial','serial no','serial number','serialno','serial#','sr no','sr. no.'];
const IMEI_ALIASES = ['imei'];
const DESC_ALIASES = ['description','desc'];

function errMsg(e){
  if(!e) return 'Unknown error';
  if(typeof e === 'string') return e;
  return e.message || e.error_description || e.hint || e.details || JSON.stringify(e);
}

function normHeader(h){ return String(h).trim().toLowerCase(); }
function findVal(row, aliases){
  for(const key in row){
    if(aliases.includes(normHeader(key))) return String(row[key]).trim();
  }
  return '';
}
function normalizeSerial(s){
  if(!s) return '';
  let v = String(s).trim();
  if(/^\d+$/.test(v)) v = v.replace(/^0+(?=\d)/, ''); // strip leading zeros on purely-numeric serials only
  return v;
}
function normalizeStoreCode(s){
  // Source system exports inconsistent casing for the same store
  // (e.g. "SFXVadodara" vs "SFXVADODARA" even within one file).
  // Uppercase is the canonical form throughout this app.
  return s ? String(s).trim().toUpperCase() : '';
}
function findStore(row){
  return normalizeStoreCode(findVal(row, STORE_ALIASES));
}
function findSerial(row){
  const s = findVal(row, SERIAL_ALIASES);
  const val = s || findVal(row, IMEI_ALIASES);
  return normalizeSerial(val);
}

function setSaveIndicator(status, extra){
  const el = document.getElementById('saveIndicator');
  if(!el) return;
  if(status==='saving'){ el.textContent = 'Connecting…'; el.style.color = 'var(--text-faint)'; }
  else if(status==='saved'){ el.textContent = extra || 'Synced'; el.style.color = 'var(--green)'; }
  else if(status==='session'){ el.textContent = 'Not connected — Load existing or create a new cycle'; el.style.color = 'var(--text-faint)'; }
  else if(status==='error'){ el.textContent = extra || 'Connection error — check console'; el.style.color = 'var(--red)'; }
  else { el.textContent = ''; }
}

async function connectToCycle(cycle){
  currentCycleId = cycle.id;
  currentCycleName = cycle.cycle_name;
  auditCompleted = !!cycle.completed;
  await fetchCycleData();
  renderBaseTable();
  populateStoreSelect();
  if(auditCompleted) reconcile();
  renderDashboard();
}

async function handleLoadCycle(){
  const name = document.getElementById('cycleName').value.trim();
  if(!name){ showMessage('Type a cycle name first, e.g. PV-2026-Q3.', true); return; }
  if(!sb){ showMessage('Supabase library failed to load — check your internet connection and reload the page.', true); return; }
  setSaveIndicator('saving');
  try{
    const { data: existing, error: findErr } = await sb.from('audit_cycles')
      .select('*').eq('cycle_name', name).order('created_at', {ascending:false}).limit(1);
    if(findErr) throw findErr;

    if(!existing || !existing.length){
      setSaveIndicator('session');
      showMessage(`No existing cycle named "${name}" — click "+ New cycle" to create it instead.`, true);
      return;
    }

    await connectToCycle(existing[0]);
    setSaveIndicator('saved', `Connected to "${name}"`);
    showMessage(`Loaded cycle "${name}" — ${baseData.length} base rows, ${scanData.length} scans so far.`);
  }catch(e){
    console.error(e);
    setSaveIndicator('error', 'Failed: ' + errMsg(e));
  }
}

async function handleCreateCycle(){
  const name = document.getElementById('cycleName').value.trim();
  if(!name){ showMessage('Type a cycle name first, e.g. PV-2026-Q3.', true); return; }
  if(!sb){ showMessage('Supabase library failed to load — check your internet connection and reload the page.', true); return; }
  setSaveIndicator('saving');
  try{
    const { data: existing, error: findErr } = await sb.from('audit_cycles')
      .select('id').eq('cycle_name', name).limit(1);
    if(findErr) throw findErr;

    if(existing && existing.length){
      setSaveIndicator('session');
      showMessage(`A cycle named "${name}" already exists — click "Load existing" instead, or pick a different name.`, true);
      return;
    }

    const { data: created, error: createErr } = await sb.from('audit_cycles')
      .insert({cycle_name: name}).select().single();
    if(createErr) throw createErr;

    await connectToCycle(created);
    setSaveIndicator('saved', `Created "${name}"`);
    showMessage(`Created a new cycle "${name}". Upload base data in step 1 to get started.`);
  }catch(e){
    console.error(e);
    setSaveIndicator('error', 'Failed: ' + errMsg(e));
  }
}

async function handleDeleteCycle(){
  if(!sb){ showMessage('Supabase library failed to load — check your internet connection and reload the page.', true); return; }
  const name = document.getElementById('cycleName').value.trim();
  if(!name){ showMessage('Type the exact cycle name you want to delete, then click Delete cycle.', true); return; }

  confirmAction('delete-cycle', `This permanently deletes "${name}" and all its base data + scans — cannot be undone`, async () => {
    setSaveIndicator('saving');
    try{
      const { data: existing, error: findErr } = await sb.from('audit_cycles')
        .select('id').eq('cycle_name', name).limit(1);
      if(findErr) throw findErr;
      if(!existing || !existing.length){
        setSaveIndicator('session');
        showMessage(`No cycle named "${name}" found — nothing to delete.`, true);
        return;
      }

      const { error: delErr } = await sb.from('audit_cycles').delete().eq('id', existing[0].id);
      if(delErr) throw delErr;

      if(currentCycleId === existing[0].id){
        currentCycleId = null; currentCycleName = '';
        baseData = []; scanData = []; detailResults = []; auditCompleted = false;
        document.getElementById('cycleName').value = '';
        renderBaseTable();
        populateStoreSelect();
        document.getElementById('baseUploadStatus').textContent = '';
        showStep('setup');
      }

      setSaveIndicator('session');
      showMessage(`Deleted cycle "${name}" and everything under it.`);
      renderDashboard();
    }catch(e){
      console.error(e);
      setSaveIndicator('error', 'Failed: ' + errMsg(e));
    }
  });
}

async function fetchCycleData(){
  if(!currentCycleId) return;
  const { data: baseRows, error: baseErr } = await sb.from('base_serials').select('*').eq('cycle_id', currentCycleId);
  if(baseErr) throw baseErr;
  baseData = (baseRows||[]).map(r => ({store:r.store_code, sku:r.sku, desc:r.description, serial:r.serial_no}));

  const { data: scanRows, error: scanErr } = await sb.from('scans').select('*').eq('cycle_id', currentCycleId);
  if(scanErr) throw scanErr;
  scanData = (scanRows||[]).map(r => ({id:r.id, store:r.store_code, sku:r.sku, serial:r.serial_no, ts: new Date(r.scanned_at).toLocaleString(), scannedBy:r.scanned_by}));
}

function requireCycle(){
  if(!sb){ showMessage('Supabase library failed to load — check your internet connection and reload the page.', true); return false; }
  if(!currentCycleId){ showMessage('Load or create a cycle first using the buttons up top.', true); return false; }
  return true;
}

function showMessage(text, isWarning){
  const el = document.getElementById('globalMessage');
  el.textContent = text;
  el.style.display = 'block';
  el.style.borderColor = isWarning ? 'var(--amber)' : 'var(--steel)';
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => { el.style.display = 'none'; }, 4500);
}

const pendingConfirms = {};
function confirmAction(key, label, fn){
  if(pendingConfirms[key]){
    clearTimeout(pendingConfirms[key]);
    delete pendingConfirms[key];
    fn();
    return;
  }
  showMessage(`${label} — click the button again within 4 seconds to confirm.`, true);
  pendingConfirms[key] = setTimeout(() => { delete pendingConfirms[key]; }, 4000);
}

function showStep(step){
  ['setup','scan','dashboard','admin','profile'].forEach(s => {
    document.getElementById('view-'+s).classList.toggle('active', s===step);
    document.getElementById('tab-'+s).classList.toggle('active', s===step);
  });
  const pageTitles = {setup:'Setup base data', scan:'Scan / upload physical count', dashboard:'Dashboard & export', admin:'Users & stores', profile:'My account'};
  const titleEl = document.querySelector('.content-title');
  if(titleEl && pageTitles[step]) titleEl.textContent = pageTitles[step];
  if(step==='scan') renderScanView();
  if(step==='dashboard') renderDashboard();
  if(step==='admin') renderAdminPanel();
  if(step==='profile') renderProfilePanel();
}

function parseWorkbook(file, callback){
  const reader = new FileReader();
  reader.onload = (e) => {
    const wb = XLSX.read(new Uint8Array(e.target.result), {type:'array'});
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, {defval:''});
    callback(rows);
  };
  reader.readAsArrayBuffer(file);
}

function handleBaseUpload(event){
  const file = event.target.files[0];
  if(!file) return;
  if(!requireCycle()){ event.target.value=''; return; }
  parseWorkbook(file, async (rows) => {
    const parsed = rows.map(r => ({
      store: findStore(r),
      sku: findVal(r, SKU_ALIASES),
      desc: findVal(r, DESC_ALIASES),
      serial: findSerial(r)
    })).filter(r => r.store && r.serial);

    document.getElementById('baseUploadStatus').textContent = `Uploading ${parsed.length} rows to Supabase…`;
    try{
      const payload = parsed.map(r => ({
        cycle_id: currentCycleId, store_code: r.store, sku: r.sku, description: r.desc, serial_no: r.serial
      }));
      const chunkSize = 500;
      for(let i=0; i<payload.length; i+=chunkSize){
        const { error } = await sb.from('base_serials').insert(payload.slice(i, i+chunkSize));
        if(error) throw error;
      }
      await fetchCycleData();
      document.getElementById('baseUploadStatus').textContent = `Loaded ${baseData.length} rows from ${file.name} (saved to cycle "${currentCycleName}")`;
      renderBaseTable();
      populateStoreSelect();
    }catch(e){
      console.error(e);
      document.getElementById('baseUploadStatus').textContent = '';
      showMessage('Could not save base data to Supabase: ' + errMsg(e), true);
    }
  });
}

function handleScanUpload(event){
  const file = event.target.files[0];
  if(!file) return;
  if(!requireCycle()){ event.target.value=''; return; }
  const selectedStore = document.getElementById('scanStoreSelect').value;
  parseWorkbook(file, async (rows) => {
    const parsed = [];
    rows.forEach(r => {
      const storeFromFile = findStore(r);
      const serial = findSerial(r);
      const sku = findVal(r, SKU_ALIASES);
      if(!serial) return;
      parsed.push({store: storeFromFile || selectedStore, sku, serial});
    });
    try{
      const payload = parsed.map(r => ({cycle_id: currentCycleId, store_code: r.store, sku: r.sku, serial_no: r.serial, scanned_by: currentUser ? currentUser.id : null}));
      const chunkSize = 500;
      for(let i=0; i<payload.length; i+=chunkSize){
        const { error } = await sb.from('scans').insert(payload.slice(i, i+chunkSize));
        if(error) throw error;
      }
      await fetchCycleData();
      showMessage(`Uploaded ${parsed.length} scanned serials.`);
      renderScanView();
    }catch(e){
      console.error(e);
      showMessage('Could not save scanned serials to Supabase: ' + errMsg(e), true);
    }
  });
  event.target.value = '';
}

async function loadSampleBaseData(){
  if(!requireCycle()) return;
  const sample = [
    {store:'SFXCUTTACK', sku:'STB-HD200', desc:'Set-top box HD', serial:'SN-1002841'},
    {store:'SFXCUTTACK', sku:'ONT-GX10', desc:'Optical network terminal', serial:'SN-1002855'},
    {store:'SFXCUTTACK', sku:'RTR-AX5', desc:'Wireless router', serial:'SN-1002860'},
    {store:'SFXKANPUR', sku:'STB-HD200', desc:'Set-top box HD', serial:'SN-1002901'},
    {store:'SFXKANPUR', sku:'RTR-AX5', desc:'Wireless router', serial:'SN-1003002'},
    {store:'SFXKANPUR', sku:'ONT-GX10', desc:'Optical network terminal', serial:'SN-1003010'},
    {store:'SFXMORADABAD', sku:'ONT-GX10', desc:'Optical network terminal', serial:'SN-1003140'},
    {store:'SFXMORADABAD', sku:'STB-HD200', desc:'Set-top box HD', serial:'SN-1003155'},
    {store:'SFXGURGAON', sku:'RTR-AX5', desc:'Wireless router', serial:'SN-1003210'},
    {store:'SFXGURGAON', sku:'STB-HD200', desc:'Set-top box HD', serial:'SN-1003225'},
    {store:'SFXVADODARA', sku:'ONT-GX10', desc:'Optical network terminal', serial:'SN-1003310'}
  ];
  try{
    const payload = sample.map(r => ({cycle_id: currentCycleId, store_code: r.store, sku: r.sku, description: r.desc, serial_no: r.serial}));
    const { error } = await sb.from('base_serials').insert(payload);
    if(error) throw error;
    await fetchCycleData();
    document.getElementById('baseUploadStatus').textContent = `Loaded ${sample.length} sample rows (saved to cycle "${currentCycleName}")`;
    renderBaseTable();
    populateStoreSelect();
  }catch(e){
    console.error(e);
    showMessage('Could not save sample data to Supabase: ' + errMsg(e), true);
  }
}

function clearBaseData(){
  showMessage('Base data is locked once saved to a cycle, by design — it keeps the audit trail honest. Use "Start a new audit cycle" instead if you need a clean slate.', true);
}

function renderBaseTable(){
  document.getElementById('baseCount').textContent = baseData.length ? `(${baseData.length} serials)` : '';
  const tbody = document.getElementById('baseTableBody');
  if(!baseData.length){ tbody.innerHTML = '<tr><td colspan="3" class="empty-note">No base data loaded yet.</td></tr>'; return; }
  tbody.innerHTML = baseData.map(r => `<tr><td>${r.store}</td><td>${circleFor(r.store)}</td><td>${r.sku}</td><td>${r.serial}</td></tr>`).join('');
}

function populateStoreSelect(){
  let stores = [...new Set([...baseData.map(r=>r.store), ...scanData.map(r=>r.store)])].filter(Boolean).sort();
  if(currentProfile && currentProfile.role !== 'admin'){
    stores = myAssignedStores.slice().sort();
  }
  const sel = document.getElementById('scanStoreSelect');
  const prev = sel.value;
  sel.innerHTML = stores.length ? stores.map(s => `<option value="${s}">${s}</option>`).join('') : '<option value="">No stores assigned — contact your admin</option>';
  if(stores.includes(prev)) sel.value = prev;
}

async function addScan(){
  const input = document.getElementById('scanInput');
  const serial = normalizeSerial(input.value.trim());
  const store = document.getElementById('scanStoreSelect').value;
  if(!serial){ return; }
  if(!store){ showMessage('Select a store first.', true); return; }
  if(!requireCycle()) return;
  const baseMatch = baseData.find(b => b.store === store && b.serial === serial);
  try{
    const { error } = await sb.from('scans').insert({
      cycle_id: currentCycleId, store_code: store, sku: baseMatch ? baseMatch.sku : '', serial_no: serial, scanned_by: currentUser ? currentUser.id : null
    });
    if(error) throw error;
    input.value = '';
    await fetchCycleData();
    renderScanView();
  }catch(e){
    console.error(e);
    showMessage('Could not save this scan to Supabase: ' + errMsg(e), true);
  }
}

async function removeScan(id){
  try{
    const { error } = await sb.from('scans').delete().eq('id', id);
    if(error) throw error;
    await fetchCycleData();
    renderScanView();
  }catch(e){
    console.error(e);
    showMessage('Could not delete this scan from Supabase: ' + errMsg(e), true);
  }
}

function renderScanView(){
  populateStoreSelect();
  const store = document.getElementById('scanStoreSelect').value;
  const baseForStore = baseData.filter(b => b.store === store);
  const scansForStore = scanData.filter(r => r.store === store);

  document.getElementById('scanProgress').innerHTML = `
    <span>Expected here: <b>${baseForStore.length}</b></span>
    <span>Scanned here: <b>${scansForStore.length}</b></span>
    <span>Remaining: <b>${Math.max(baseForStore.length - scansForStore.length,0)}</b></span>`;

  const tbody = document.getElementById('scanTableBody');
  if(!scansForStore.length){ tbody.innerHTML = '<tr><td colspan="4" class="empty-note">No serials scanned for this store yet.</td></tr>'; return; }
  const canDeleteAny = currentProfile && currentProfile.role === 'admin';
  tbody.innerHTML = scansForStore.slice().reverse().map(r => {
    const isMine = currentUser && r.scannedBy === currentUser.id;
    const delIcon = (canDeleteAny || isMine) ? `<span style="color:var(--text-faint);cursor:pointer;" onclick="removeScan('${r.id}')">✕</span>` : '<span style="color:var(--text-faint);">—</span>';
    return `<tr><td>${r.serial}</td><td>${r.sku||'—'}</td><td>${r.ts}</td><td>${delIcon}</td></tr>`;
  }).join('');
}

function completeAudit(){
  if(!requireCycle()) return;
  if(!baseData.length){ showMessage('Upload base data in step 1 before completing the audit.', true); return; }

  const isAdmin = currentProfile && currentProfile.role === 'admin';

  if(!isAdmin){
    confirmAction('user-complete', 'This marks your scanning as done for this cycle', () => {
      showMessage('Your scans have been recorded. Your admin will finalize this audit cycle once every store is done.');
    });
    return;
  }

  confirmAction('complete-audit', 'This will lock in results for the dashboard', async () => {
    try{
      const { error } = await sb.from('audit_cycles').update({completed:true, completed_at:new Date().toISOString()}).eq('id', currentCycleId);
      if(error) throw error;
      auditCompleted = true;
      showMessage('Audit marked complete. Dashboard is ready below.');
      showStep('dashboard');
    }catch(e){
      console.error(e);
      showMessage('Could not mark the cycle complete in Supabase: ' + errMsg(e), true);
    }
  });
}

function reconcile(){
  detailResults = [];
  const auditedStores = [...new Set(scanData.map(r=>r.store))].filter(Boolean).sort();
  auditedStores.forEach(store => {
    const baseRows = baseData.filter(r => r.store === store);
    const scanRows = scanData.filter(r => r.store === store);
    const scanSerials = new Set(scanRows.map(r => normalizeSerial(r.serial)));
    const baseSerials = new Set(baseRows.map(r => normalizeSerial(r.serial)));
    baseRows.forEach(r => {
      const matched = scanSerials.has(normalizeSerial(r.serial));
      detailResults.push({store, sku:r.sku, systemSerial:r.serial, physicalSerial: matched ? r.serial : '', status: matched ? 'match' : 'short'});
    });
    scanRows.forEach(r => {
      if(!baseSerials.has(normalizeSerial(r.serial))) detailResults.push({store, sku:r.sku, systemSerial:'', physicalSerial:r.serial, status:'excess'});
    });
  });
}

function renderDashboard(){
  reconcile(); // always show live results — "completed" only locks the cycle, it doesn't gate visibility

  const strip = document.getElementById('auditStatusStrip');
  const auditedCount = [...new Set(scanData.map(r=>r.store))].filter(Boolean).length;
  if(!auditCompleted){
    strip.textContent = `Live — showing current results for ${auditedCount} store${auditedCount===1?'':'s'} scanned so far. Click "Complete audit" once every store is done to lock this cycle.`;
    strip.classList.remove('locked');
  } else {
    strip.textContent = `Audit "${document.getElementById('cycleName').value || 'Untitled cycle'}" completed — showing final results for ${auditedCount} store${auditedCount===1?'':'s'} scanned.`;
    strip.classList.add('locked');
  }

  const totalBaseStores = [...new Set(baseData.map(r=>r.store))].filter(Boolean);
  const auditedStores = [...new Set(scanData.map(r=>r.store))].filter(Boolean);
  const storesRecorded = auditedStores.length;
  const storesPending = totalBaseStores.filter(s => !auditedStores.includes(s)).length;
  const totalScanned = scanData.length;

  const total = detailResults.length;
  const match = detailResults.filter(r=>r.status==='match').length;
  const short = detailResults.filter(r=>r.status==='short').length;
  const excess = detailResults.filter(r=>r.status==='excess').length;
  const matchPct = total ? Math.round((match/total)*100) : 0;

  const kpis = [
    {cls:'k-recorded', label:'Store audit recorded', value: storesRecorded, sub:'Stores with at least 1 scan'},
    {cls:'k-pending', label:'Store audit pending', value: storesPending, sub:'Stores with base data, not yet scanned'},
    {cls:'k-total', label:'Stock scanned (physical)', value: totalScanned, sub:'Raw physical scan count'},
    {cls:'k-match', label:'Match rate', value: matchPct+'%', sub:`${match} matched`},
    {cls:'k-variance', label:'Total variance', value: short+excess, sub:'Short + excess'},
    {cls:'k-missing', label:'Short (missing)', value: short, sub:'In system, not found'},
    {cls:'k-excess', label:'Excess (unlisted)', value: excess, sub:'Found, not in system'}
  ];
  document.getElementById('kpiStrip').innerHTML = kpis.map(k => `
    <div class="kpi ${k.cls}"><p class="kpi-label">${k.label}</p><p class="kpi-value">${k.value}</p><p class="kpi-sub">${k.sub}</p></div>`).join('');

  const stores = [...new Set(detailResults.map(r=>r.store))].sort();
  document.getElementById('storeGrid').innerHTML = stores.length ? stores.map(store => {
    const rows = detailResults.filter(r=>r.store===store);
    const m = rows.filter(r=>r.status==='match').length;
    const sh = rows.filter(r=>r.status==='short').length;
    const ex = rows.filter(r=>r.status==='excess').length;
    const t = rows.length;
    const pct = t ? Math.round((m/t)*100) : 0;
    let stamp = sh>0 ? '<span class="stamp stamp-critical">Missing units</span>' : (ex>0 || pct<100 ? '<span class="stamp stamp-variance">Variance</span>' : '<span class="stamp stamp-match">Matched</span>');
    return `<div class="store-tag">
      <div class="store-tag-hole"></div>
      <span class="store-download" onclick="downloadStoreExcel('${store.replace(/'/g,"\\'")}')" title="Download this store's report">↓ Export</span>
      <div class="store-tag-body">
      <p class="store-tag-name">${store}</p>
      <p class="store-tag-meta">Circle ${circleFor(store)} · Expected ${t-ex} · Found ${t-sh}</p>
      <div class="store-tag-stats"><span>Match <b>${pct}%</b></span><span>Short <b>${sh}</b></span><span>Excess <b>${ex}</b></span></div>
      ${stamp}</div></div>`;
  }).join('') : '<div class="empty-note">No stores scanned yet — complete at least one store in step 2 to see results here.</div>';

  const detailBody = document.getElementById('detailTableBody');
  detailBody.innerHTML = detailResults.length ? detailResults.map(r => `
    <tr><td>${r.store}</td><td>${circleFor(r.store)}</td><td>${r.sku||'—'}</td><td>${r.physicalSerial||'—'}</td><td>${r.systemSerial||'—'}</td>
    <td><span class="badge badge-${r.status}">${r.status.charAt(0).toUpperCase()+r.status.slice(1)}</span></td></tr>`).join('')
    : '<tr><td colspan="6" class="empty-note">No reconciliation data yet.</td></tr>';

  renderCharts(stores);
}

function renderCharts(stores){
  const matchData = stores.map(s => detailResults.filter(r=>r.store===s && r.status==='match').length);
  const varianceData = stores.map(s => detailResults.filter(r=>r.store===s && r.status!=='match').length);

  if(storeChartInstance) storeChartInstance.destroy();
  storeChartInstance = new Chart(document.getElementById('storeChart'), {
    type:'bar',
    data:{labels:stores, datasets:[
      {label:'Matched', data:matchData, backgroundColor:'#3DDC84', borderRadius:6, maxBarThickness:26},
      {label:'Variance', data:varianceData, backgroundColor:'#E2635C', borderRadius:6, maxBarThickness:26}
    ]},
    options:{responsive:true, maintainAspectRatio:false,
      scales:{x:{stacked:true, grid:{display:false}, ticks:{color:'#96A69B', font:{size:11}}},
              y:{stacked:true, beginAtZero:true, ticks:{color:'#96A69B', font:{size:11}, precision:0}, grid:{color:'#1E2822'}}},
      plugins:{legend:{display:false}}}
  });

  const counts = {match:0, short:0, excess:0};
  detailResults.forEach(r => counts[r.status]++);
  const colors = {match:'#3DDC84', short:'#E2635C', excess:'#E3A63E'};
  const labels = {match:'Match', short:'Short', excess:'Excess'};
  const keys = Object.keys(counts);

  if(varianceChartInstance) varianceChartInstance.destroy();
  varianceChartInstance = new Chart(document.getElementById('varianceChart'), {
    type:'doughnut',
    data:{labels:keys.map(k=>labels[k]), datasets:[{data:keys.map(k=>counts[k]), backgroundColor:keys.map(k=>colors[k]), borderColor:'#131A16', borderWidth:2}]},
    options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}}
  });

  const total = detailResults.length || 1;
  document.getElementById('varLegend').innerHTML = keys.map(k => `
    <span style="display:flex;align-items:center;gap:5px;"><span style="width:9px;height:9px;border-radius:2px;background:${colors[k]};display:inline-block;"></span>${labels[k]} ${Math.round((counts[k]/total)*100)}%</span>`).join('');
}

function buildDetailRowsForExcel(rows){
  return rows.map((r,i) => ({
    'Sr. No.': i+1,
    'System scan serial number': r.systemSerial || '',
    'SKU': r.sku || '',
    'Physical scan serial number': r.physicalSerial || '',
    'Match': r.status==='match' ? 'Match' : '',
    'Excess': r.status==='excess' ? 'Excess' : '',
    'Short': r.status==='short' ? 'Short' : ''
  }));
}

function downloadExcel(){
  if(!detailResults.length){ showMessage('Complete the audit first to generate results.', true); return; }
  const cycle = document.getElementById('cycleName').value || 'Untitled_Cycle';
  const stores = [...new Set(detailResults.map(r=>r.store))].sort();

  const summaryRows = stores.map(store => {
    const rows = detailResults.filter(r=>r.store===store);
    const m = rows.filter(r=>r.status==='match').length;
    const sh = rows.filter(r=>r.status==='short').length;
    const ex = rows.filter(r=>r.status==='excess').length;
    return {Store:store, Circle:circleFor(store), 'Total Expected':m+sh, 'Total Found':m+ex, Matched:m, Short:sh, Excess:ex, 'Match %': m+sh ? Math.round((m/(m+sh))*100) : 0};
  });

  const detailRows = detailResults.map((r,i) => ({
    'Sr. No.': i+1, Store:r.store, Circle:circleFor(r.store),
    'System scan serial number': r.systemSerial || '', SKU: r.sku || '', 'Physical scan serial number': r.physicalSerial || '',
    'Match': r.status==='match' ? 'Match' : '', 'Excess': r.status==='excess' ? 'Excess' : '', 'Short': r.status==='short' ? 'Short' : ''
  }));
  const scanLogRows = scanData.map(r => ({Store:r.store, Circle:circleFor(r.store), SKU:r.sku, 'Serial Number':r.serial, 'Scanned at':r.ts}));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), 'Detail');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(scanLogRows), 'Scan Log');
  XLSX.writeFile(wb, `PV_Recon_${cycle.replace(/[^a-z0-9]/gi,'_')}.xlsx`);
}

function downloadStoreExcel(store){
  const rows = detailResults.filter(r => r.store === store);
  if(!rows.length){ showMessage('No results for this store yet.', true); return; }
  const cycle = document.getElementById('cycleName').value || 'Untitled_Cycle';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildDetailRowsForExcel(rows)), 'Audit Report');
  const safeStore = store.replace(/[^a-z0-9]/gi,'_');
  XLSX.writeFile(wb, `PV_Recon_${safeStore}_${cycle.replace(/[^a-z0-9]/gi,'_')}.xlsx`);
}

function resetEverything(){
  confirmAction('reset-new-cycle', 'This disconnects from the current cycle so you can start a new one', () => {
    currentCycleId = null; currentCycleName = '';
    baseData = []; scanData = []; detailResults = []; auditCompleted = false;
    document.getElementById('cycleName').value = '';
    setSaveIndicator('session');
    renderBaseTable();
    populateStoreSelect();
    document.getElementById('baseUploadStatus').textContent = '';
    showMessage('Type a new cycle name above and click "+ New cycle" (or "Load existing" for a past one). Your previous cycle\'s data is untouched in Supabase.');
    showStep(currentProfile && currentProfile.role === 'admin' ? 'setup' : 'scan');
  });
}

setSaveIndicator('session');
renderBaseTable();
populateStoreSelect();
renderDashboard();

(async function initAuth(){
  if(!sb){
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('authScreen').style.display = 'flex';
    setAuthMessage('Supabase library failed to load — check your connection and reload.', true);
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  if(session && session.user){
    await onLoginSuccess();
  } else {
    document.getElementById('authScreen').style.display = 'flex';
  }
  document.getElementById('loadingScreen').style.display = 'none';

  sb.auth.onAuthStateChange((event) => {
    if(event === 'SIGNED_OUT'){
      currentUser = null; currentProfile = null; myAssignedStores = [];
      document.body.className = '';
      document.getElementById('appRoot').style.display = 'none';
      document.getElementById('pendingScreen').style.display = 'none';
      document.getElementById('loadingScreen').style.display = 'none';
      document.getElementById('authScreen').style.display = 'flex';
    }
  });
})();
