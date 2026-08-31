let currentCycleId = null;
let currentCycleName = '';
let currentCycleCreatedAt = null;

let baseData = [];
let scanData = [];
let storeLocks = [];
let allStoreAssignments = [];
let detailResults = [];
let reconciledStores = []; // every store that counts as "audited" for this cycle — scanned, locked, or declared zero-stock — even when it has 0 rows in detailResults
let auditCompleted = false;
let dashboardStoreFilter = null;

// Admin's "Circle Head Summary" drill state: null = showing all circle
// heads; set = showing that one person's whole territory (their circles'
// stores), with a "back" banner. circleHeadsCache is the list of circle_head
// profiles + their circle assignments — null until first loaded (lazily, on
// an admin's first dashboard render), then cached so realtime refreshes
// don't re-fetch it every time.
let adminViewingCircleHead = null;
let circleHeadsCache = null;
// {uid: {email, full_name}} for every profile — admin-only (Audit Report
// page), used to resolve a reviewer's actual current name instead of
// whatever was snapshotted into store_locks at approval time.
let allProfilesCache = null;

function setDashboardStoreFilter(store){
  dashboardStoreFilter = (dashboardStoreFilter === store) ? null : store;
  renderDashboard();
}
let dashboardCircleFilter = null;
function setDashboardCircleFilter(circle){
  dashboardCircleFilter = circle || null;
  renderDashboard();
}
function togglePendingStoresPanel(){
  const panel = document.getElementById('pendingStoresPanel');
  const btn = document.getElementById('pendingStoresToggleBtn');
  if(!panel) return;
  const willShow = panel.style.display === 'none' || !panel.style.display;
  panel.style.display = willShow ? 'block' : 'none';
  if(btn) btn.classList.toggle('btn-primary', willShow);
  if(willShow) panel.scrollIntoView({behavior:'smooth', block:'nearest'});
}
function showPendingStoresPanel(){
  const panel = document.getElementById('pendingStoresPanel');
  if(!panel) return;
  panel.style.display = 'block';
  const btn = document.getElementById('pendingStoresToggleBtn');
  if(btn) btn.classList.add('btn-primary');
  panel.scrollIntoView({behavior:'smooth', block:'nearest'});
}
let storeChartInstance = null, varianceChartInstance = null;

// ---------------- THEME (light / dark) ----------------
function applyTheme(theme){
  document.body.classList.toggle('theme-dark', theme === 'dark');
  const sun = document.getElementById('themeIconSun');
  const moon = document.getElementById('themeIconMoon');
  if(sun && moon){ sun.style.display = theme === 'dark' ? 'none' : 'block'; moon.style.display = theme === 'dark' ? 'block' : 'none'; }
  // Chart colors are read from CSS variables at draw time, so redraw any live charts to pick up the new palette.
  if(currentCycleId) renderDashboard();
}
function setTheme(theme){
  try{ localStorage.setItem('pvrecon-theme', theme); }catch(e){}
  applyTheme(theme);
}
function toggleTheme(){
  setTheme(document.body.classList.contains('theme-dark') ? 'light' : 'dark');
}
(function initTheme(){
  let saved = 'light';
  try{ saved = localStorage.getItem('pvrecon-theme') || 'light'; }catch(e){}
  applyTheme(saved);
})();

function themeColor(varName){
  return getComputedStyle(document.body).getPropertyValue(varName).trim() || '#1E9E5A';
}

// ---------------- SMALL DISPLAY HELPERS ----------------
function initialsFor(email, fullName){
  if(fullName && fullName.trim()){
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    if(parts.length === 1) return parts[0].slice(0,2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  if(!email) return '?';
  const namePart = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
  const parts = namePart.split(' ').filter(Boolean);
  if(!parts.length) return email[0].toUpperCase();
  if(parts.length === 1) return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
function displayNameFor(email, fullName){
  if(fullName && fullName.trim()) return fullName.trim();
  if(!email) return 'there';
  const namePart = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
  return namePart.split(' ').filter(Boolean).map(w => w[0].toUpperCase()+w.slice(1)).join(' ') || email;
}
function greetingWord(){
  const h = new Date().getHours();
  if(h < 12) return 'Good morning';
  if(h < 17) return 'Good afternoon';
  return 'Good evening';
}
function updateTopbarUser(){
  if(!currentUser) return;
  const email = currentUser.email;
  const fullName = currentProfile ? currentProfile.full_name : null;
  const avatarUrl = currentProfile ? currentProfile.avatar_url : null;
  const role = currentProfile ? currentProfile.role : '';
  const initials = initialsFor(email, fullName);
  const name = displayNameFor(email, fullName);
  ['sidebarAvatar','topbarAvatar'].forEach(id => {
    const el = document.getElementById(id);
    if(!el) return;
    if(avatarUrl){ el.innerHTML = `<img src="${avatarUrl}" alt="${name}" class="avatar-img">`; }
    else { el.textContent = initials; }
  });
  const tName = document.getElementById('topbarAvatarName'); if(tName) tName.textContent = name;
  const tRole = document.getElementById('topbarAvatarRole'); if(tRole) tRole.textContent = roleLabel(role);
  const greetEl = document.getElementById('greetTitle');
  if(greetEl) greetEl.textContent = `${greetingWord()}, ${name} \ud83d\udc4b`;
}
function updateCycleLabels(){
  const label = currentCycleId ? (currentCycleName || 'Untitled cycle') : 'Not connected';
  const t = document.getElementById('topbarCycleName'); if(t) t.textContent = label;
  const c = document.getElementById('cycleControlName'); if(c) c.textContent = label;
}
function fmtRelativeTime(iso){
  if(!iso) return '';
  const d = new Date(iso);
  if(isNaN(d)) return '';
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs/60000);
  if(mins < 1) return 'just now';
  if(mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins/60);
  if(hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs/24);
  if(days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}
function fmtClock(iso){
  if(!iso) return '';
  const d = new Date(iso);
  if(isNaN(d)) return '';
  return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
}
function handleTopbarSearch(value){
  const term = value.trim();
  if(document.getElementById('view-dashboard') && !document.getElementById('view-dashboard').classList.contains('active')){
    if(!term) return;
    showStep('dashboard');
  }
  if(!term){
    dashboardStoreFilter = null;
    const detailSearch = document.getElementById('detailSearch');
    if(detailSearch) detailSearch.value = '';
    renderDashboard();
    return;
  }
  // If the typed text uniquely identifies a store (by code or by circle), scope the whole
  // Overview page to it — hero cards, health donut and live activity, not just the table.
  const knownStores = [...new Set([...baseData.map(r=>r.store), ...scanData.map(r=>r.store)])].filter(Boolean);
  const lower = term.toLowerCase();
  const matches = knownStores.filter(s => s.toLowerCase().includes(lower));
  if(matches.length === 1) dashboardStoreFilter = matches[0];
  // If it doesn't uniquely match a store, leave any existing store filter (e.g. from a store-card click) alone —
  // the text still narrows the detail table below via the normal serial/SKU/store search.

  const detailSearch = document.getElementById('detailSearch');
  if(detailSearch){ detailSearch.value = term; }
  renderDashboard();
}

// ---------------- SPARKLINES (inline SVG, driven by real data) ----------------
function sparklineBarsSVG(values, color, dashedIfFlat){
  const w = 240, h = 44;
  if(!values.length){
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><line x1="0" y1="${h-6}" x2="${w}" y2="${h-6}" stroke="${color}" stroke-width="2" stroke-dasharray="4 4" opacity="0.5"/></svg>`;
  }
  const max = Math.max(...values, 1);
  const allZero = max === 0 || values.every(v => v === 0);
  if(allZero && dashedIfFlat){
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><line x1="0" y1="${h-6}" x2="${w}" y2="${h-6}" stroke="${color}" stroke-width="2" stroke-dasharray="4 4" opacity="0.6"/></svg>`;
  }
  const gap = 3;
  const barW = Math.max((w - gap*(values.length-1)) / values.length, 2);
  let bars = '';
  values.forEach((v,i) => {
    const bh = Math.max((v/max) * (h-8), 2);
    const x = i * (barW+gap);
    const y = h - bh;
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" fill="${color}" opacity="0.85"/>`;
  });
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${bars}</svg>`;
}
function sparklineLineSVG(values, color){
  const w = 240, h = 44, pad = 4;
  if(values.length < 2){
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><line x1="0" y1="${h/2}" x2="${w}" y2="${h/2}" stroke="${color}" stroke-width="2" opacity="0.4"/></svg>`;
  }
  const max = Math.max(...values), min = Math.min(...values);
  const range = (max - min) || 1;
  const stepX = (w - pad*2) / (values.length - 1);
  const pts = values.map((v,i) => {
    const x = pad + i*stepX;
    const y = pad + (1 - (v-min)/range) * (h - pad*2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const areaPts = `${pad},${h} ${pts.join(' ')} ${(pad+stepX*(values.length-1)).toFixed(1)},${h}`;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polygon points="${areaPts}" fill="${color}" opacity="0.12"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

// ---------------- AUTH & ROLES ----------------
let currentUser = null;      // { id, email }
let currentProfile = null;   // { role, approved }
let myAssignedStores = [];   // store codes this user can access (empty for admin = all)
let myAssignedCircles = [];  // circles this circle_head can access (empty for non-circle_head)

// ---- Role helpers (client-side convenience only — RLS is the real
// enforcement boundary; these just drive what the UI shows). ----
function isAppAdmin(){ return !!(currentProfile && currentProfile.role === 'admin'); }
function isCircleHeadUser(){ return !!(currentProfile && currentProfile.role === 'circle_head'); }
function isClientUser(){ return !!(currentProfile && currentProfile.role === 'client'); }
function isAuditorUser(){ return !!(currentProfile && currentProfile.role === 'user'); }
function roleLabel(role){
  return role === 'admin' ? 'Administrator' : role === 'circle_head' ? 'Circle Head' : role === 'client' ? 'Client' : 'Auditor';
}
function bodyClassesForRole(role){
  const classes = ['role-' + (role === 'circle_head' ? 'circlehead' : role)];
  if(role === 'admin' || role === 'circle_head' || role === 'client') classes.push('cap-dashboard');
  if(role === 'admin' || role === 'circle_head') classes.push('cap-setup');
  if(role === 'admin' || role === 'circle_head') classes.push('cap-ops'); // operational tools: pending-stores panel, circle/circle-head rollup — not shown to a client
  if(role === 'circle_head') classes.push('cap-approve'); // approvals are circle-head-only now — admin reviews via export, not a dashboard panel
  if(role === 'admin' || role === 'user' || role === 'circle_head') classes.push('cap-scan'); // scan/upload: admin, auditor, and circle head (who may need to audit/backfill stores directly) — a client never scans
  if(role === 'user') classes.push('cap-mystores');
  if(role === 'client') classes.push('cap-client');
  return classes.join(' ');
}
// Whether the current user is allowed to unlock/approve this particular store
// (admin: any store; circle head: only their own circle's stores).
function canModerateStore(store){
  return isAppAdmin() || (isCircleHeadUser() && myAssignedCircles.includes(circleFor(store)));
}
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

let authSelectedCircles = new Set();

function switchAuthMode(mode){
  authMode = mode;
  document.getElementById('authTabSignin').classList.toggle('active', mode==='signin');
  document.getElementById('authTabSignup').classList.toggle('active', mode==='signup');
  document.getElementById('authSubmitBtn').textContent = mode==='signin' ? 'Sign in' : 'Create account';
  document.getElementById('authMessage').textContent = '';
  document.getElementById('authNameField').style.display = mode==='signup' ? '' : 'none';
  const roleField = document.getElementById('authRoleField');
  if(roleField) roleField.style.display = mode==='signup' ? '' : 'none';
  if(mode==='signup'){
    document.getElementById('authRole').value = 'user';
    handleAuthRoleChange();
  } else {
    const storeField = document.getElementById('authStoreField'); if(storeField) storeField.style.display = 'none';
    const circlesField = document.getElementById('authCirclesField'); if(circlesField) circlesField.style.display = 'none';
  }
  const forgotLink = document.getElementById('forgotPasswordLink');
  if(forgotLink) forgotLink.style.display = mode==='signin' ? '' : 'none';
}

// Shows the right extra field for the chosen sign-up role — the store
// picker for an auditor, the circle picker for a circle head. Who actually
// approves the request is explained in the success popup after they submit,
// not cluttered into the form itself.
function handleAuthRoleChange(){
  const role = document.getElementById('authRole').value;
  const storeField = document.getElementById('authStoreField');
  const circlesField = document.getElementById('authCirclesField');
  if(storeField) storeField.style.display = role === 'user' ? '' : 'none';
  if(circlesField) circlesField.style.display = role === 'circle_head' ? '' : 'none';
  if(role === 'user'){
    populateAuthStoreSelect();
  } else if(role === 'circle_head'){
    populateAuthCirclesChips();
  }
}

function populateAuthStoreSelect(){
  const sel = document.getElementById('authStore');
  if(!sel || sel.options.length) return; // populate once
  const stores = Object.keys(STORE_MASTER).sort();
  sel.innerHTML = stores.map(s => `<option value="${s}">${s} (${circleFor(s)})</option>`).join('');
}

function populateAuthCirclesChips(){
  const wrap = document.getElementById('authCirclesChips');
  if(!wrap || wrap.childElementCount) return; // populate once
  const circles = [...new Set(Object.values(STORE_MASTER))].sort();
  wrap.innerHTML = circles.map(c => `<span class="store-chip" onclick="toggleAuthCircle('${c}', this)">${c}</span>`).join('');
}

function toggleAuthCircle(circle, el){
  if(authSelectedCircles.has(circle)){ authSelectedCircles.delete(circle); el.classList.remove('active'); }
  else { authSelectedCircles.add(circle); el.classList.add('active'); }
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
  const fullName = document.getElementById('authFullName').value.trim();
  if(!email || !password){ setAuthMessage('Enter both email and password.', true); return; }
  if(authMode === 'signup' && !fullName){ setAuthMessage('Enter your full name.', true); return; }

  let requestedRole = 'user', requestedStore = null, requestedCircles = null;
  if(authMode === 'signup'){
    requestedRole = document.getElementById('authRole').value;
    if(requestedRole === 'user'){
      requestedStore = document.getElementById('authStore').value;
      if(!requestedStore){ setAuthMessage('Select which store you\'ll be auditing.', true); return; }
    } else if(requestedRole === 'circle_head'){
      requestedCircles = [...authSelectedCircles];
      if(!requestedCircles.length){ setAuthMessage('Select at least one circle.', true); return; }
    }
  }

  setAuthMessage(authMode==='signin' ? 'Signing in…' : 'Creating account…', false);
  try{
    if(authMode === 'signup'){
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: {
        full_name: fullName, requested_role: requestedRole, requested_store: requestedStore, requested_circles: requestedCircles
      } } });
      if(error) throw error;
      // Belt-and-suspenders: also write the name directly in case the
      // signup trigger runs before the session is fully established.
      if(data && data.user){
        await sb.from('profiles').update({ full_name: fullName }).eq('id', data.user.id);
      }
      const approverNote = requestedRole === 'user'
        ? 'Your request has been sent to that store\'s Circle Head for approval — an admin can also approve it if that store doesn\'t have a Circle Head yet. You can sign in once approved.'
        : 'Your request has been sent to an admin for approval. You can sign in once approved.';
      setAuthMessage('', false);
      openSignupSuccessModal(approverNote);
      authSelectedCircles = new Set();
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

// ---------------- SESSION AUTO-LOGOUT (for shared/store devices) ----------------
const IDLE_TIMEOUT_MS = 20 * 60 * 1000; // sign out after 20 minutes of no activity
const IDLE_WARNING_MS = 60 * 1000; // warn 1 minute before it happens
let idleTimer = null;
let idleWarningTimer = null;
let idleWarningShown = false;
const IDLE_ACTIVITY_EVENTS = ['mousemove','keydown','click','touchstart','scroll'];

function startIdleTimer(){
  resetIdleTimer();
  IDLE_ACTIVITY_EVENTS.forEach(evt => window.addEventListener(evt, resetIdleTimer, { passive: true }));
}
function stopIdleTimer(){
  clearTimeout(idleTimer);
  clearTimeout(idleWarningTimer);
  IDLE_ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, resetIdleTimer));
}
function resetIdleTimer(){
  if(!currentUser) return;
  idleWarningShown = false;
  clearTimeout(idleTimer);
  clearTimeout(idleWarningTimer);
  idleWarningTimer = setTimeout(() => {
    idleWarningShown = true;
    showMessage('You\u2019ll be signed out in 1 minute due to inactivity — tap anywhere to stay signed in.', true);
  }, IDLE_TIMEOUT_MS - IDLE_WARNING_MS);
  idleTimer = setTimeout(async () => {
    stopIdleTimer();
    await handleSignOut();
    setAuthMessage('Signed out due to inactivity — sign in again to continue.', true);
  }, IDLE_TIMEOUT_MS);
}

async function handleSignOut(){
  stopIdleTimer();
  unsubscribeRealtime();
  stopDashboardPolling();
  if(sb) await sb.auth.signOut();
  currentUser = null; currentProfile = null; myAssignedStores = []; myAssignedCircles = [];
  circleHeadsCache = null; adminViewingCircleHead = null;
  document.body.className = '';
  document.getElementById('appRoot').style.display = 'none';
  document.getElementById('pendingScreen').style.display = 'none';
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('authEmail').value = '';
  document.getElementById('authPassword').value = '';
  document.getElementById('authFullName').value = '';
  setAuthMessage('', false);
  history.replaceState(null, '', window.location.pathname);
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
    document.body.className = bodyClassesForRole(profile.role) + (document.body.classList.contains('theme-dark') ? ' theme-dark' : '');
    updateNavParentVisibility(); // hide any Reports/Management/Operations header with nothing visible inside for this role
    const whoAmIEl = document.getElementById('whoAmI');
    whoAmIEl.textContent = `${displayNameFor(user.email, profile.full_name)} · ${roleLabel(profile.role)}`;
    whoAmIEl.title = user.email;
    updateTopbarUser();

    const requestedStep = location.hash.replace('#','');
    // Which routes each role is allowed to land on directly (deep link or nav click).
    // Anything outside this list falls back to that role's default page.
    const allowedByRole = {
      admin: ['setup','scan','dashboard','admin','profile','compare','auditreport'],
      circle_head: ['dashboard','setup','scan','approvals','profile'],
      client: ['dashboard','profile'],
      user: ['scan','mystores','profile']
    };
    const defaultByRole = { admin:'dashboard', circle_head:'dashboard', client:'dashboard', user:'scan' };
    const allowed = allowedByRole[profile.role] || allowedByRole.user;

    if(profile.role === 'user'){
      const { data: assigned } = await sb.from('user_stores').select('store_code').eq('user_id', user.id);
      myAssignedStores = (assigned || []).map(r => normalizeStoreCode(r.store_code));
      myAssignedCircles = [];
    } else if(profile.role === 'circle_head'){
      myAssignedStores = [];
      const { data: circles } = await sb.from('user_circles').select('circle').eq('user_id', user.id);
      myAssignedCircles = (circles || []).map(r => r.circle);
    } else {
      myAssignedStores = [];
      myAssignedCircles = [];
    }
    const landing = allowed.includes(requestedStep) ? requestedStep : defaultByRole[profile.role];
    showStep(landing, true);

    if(profile.role === 'admin') renderAdminPanel();
    startIdleTimer();
  }catch(e){
    console.error(e);
    document.getElementById('appRoot').style.display = 'none';
    document.getElementById('pendingScreen').style.display = 'none';
    document.getElementById('authScreen').style.display = 'flex';
    setAuthMessage('Something went wrong loading your account: ' + errMsg(e) + ' — please try signing in again.', true);
  }
}

// ---------------- ADMIN PANEL ----------------
// ---------------- COMPARE CYCLES ----------------
let compareTrendChartInstance = null;

async function loadAllProfilesForAdmin(){
  try{
    const { data, error } = await sb.from('profiles').select('id,email,full_name');
    if(error) throw error;
    allProfilesCache = {};
    (data||[]).forEach(p => { allProfilesCache[p.id] = { email: p.email, full_name: p.full_name }; });
  }catch(e){
    console.error('Could not load profiles for Audit Report', e);
    allProfilesCache = {};
  }
  const activeView = document.querySelector('.panel-view.active');
  if(activeView && activeView.id === 'view-auditreport') renderAuditReportPage();
}

// AUDIT REPORT — every store's numbers plus the reviewer's own remark from
// store_locks (approval_remark), for the admin to see everything a circle
// head wrote at approval time without opening each store individually.
function renderAuditReportPage(){
  if(!currentProfile || currentProfile.role !== 'admin') return;
  reconcile();
  if(circleHeadsCache === null){ loadCircleHeadsForAdmin(); } // async; re-renders this page once loaded
  if(allProfilesCache === null){ loadAllProfilesForAdmin(); } // async; re-renders this page once loaded
  const circleSel = document.getElementById('auditReportCircleFilter');
  if(circleSel && circleSel.options.length <= 1){
    const circles = [...new Set(Object.values(STORE_MASTER))].sort();
    circleSel.innerHTML = '<option value="">All circles</option>' + circles.map(c => `<option value="${c}">${c}</option>`).join('');
  }
  const headSel = document.getElementById('auditReportCircleHeadFilter');
  if(headSel && circleHeadsCache && circleHeadsCache.length && headSel.options.length <= 1){
    headSel.innerHTML = '<option value="">All circle heads</option>' + circleHeadsCache.map(h => `<option value="${h.id}">${h.name}</option>`).join('');
  }
  const search = (document.getElementById('auditReportSearch')?.value || '').trim().toLowerCase();
  const circleFilter = document.getElementById('auditReportCircleFilter')?.value || '';
  const circleHeadFilter = headSel?.value || '';
  const headCircles = circleHeadFilter ? (circleHeadsCache||[]).find(h => h.id === circleHeadFilter)?.circles || [] : null;

  // Scope stores by whichever filters are set — circle head first (a
  // circle head owns one or more whole circles), then the plain circle
  // filter on top of that, same combinable pattern as the dashboard rollup.
  let scopeStores = Object.keys(STORE_MASTER);
  if(headCircles) scopeStores = scopeStores.filter(s => headCircles.includes(circleFor(s)));
  if(circleFilter) scopeStores = scopeStores.filter(s => circleFor(s) === circleFilter);
  scopeStores = scopeStores.sort();

  // "Submitted" = has a store_locks row at all (pending/approved/rejected,
  // doesn't matter) — same definition the sidebar's own progress widget
  // uses, so the two never disagree on what counts as done.
  const completedInScope = scopeStores.filter(s => storeLocks.some(l => l.store === s));
  const pct = scopeStores.length ? Math.round((completedInScope.length / scopeStores.length) * 100) : 0;
  const pctEl = document.getElementById('auditReportProgressPct'); if(pctEl) pctEl.textContent = pct + '%';
  const fillEl = document.getElementById('auditReportProgressFill'); if(fillEl) fillEl.style.width = pct + '%';
  const subEl = document.getElementById('auditReportProgressSub'); if(subEl) subEl.textContent = `${completedInScope.length} / ${scopeStores.length} stores submitted`;

  const rows = scopeStores.map(store => {
    const { invExpected, invMatched, invShort, grnExpected, grnMatched, grnShort, m, sh, ex } = storeSourceSummary(store);
    const approval = storeApprovalInfo(store, allProfilesCache);
    return { store, circle: circleFor(store), invExpected, invMatched, invShort, grnExpected, grnMatched, grnShort, m, sh, ex, approval };
  }).filter(r => {
    if(!search) return true;
    return r.store.toLowerCase().includes(search) || r.circle.toLowerCase().includes(search) || (r.approval.remark||'').toLowerCase().includes(search);
  });
  const body = document.getElementById('auditReportBody');
  if(!body) return;
  body.innerHTML = rows.length ? rows.map(r => {
    const pct = (r.m+r.sh+r.ex) ? ((r.m/(r.m+r.sh+r.ex))*100).toFixed(2) : '100.00';
    const statusCls = r.approval.status === 'approved' ? 'stamp-match' : r.approval.status === 'rejected' ? 'stamp-critical' : r.approval.status === 'pending' ? 'stamp-variance' : 'stamp-zero';
    return `<tr>
      <td>${r.store}</td><td>${r.circle}</td>
      <td>${r.invExpected}</td><td>${r.invMatched}</td><td>${r.invShort}</td>
      <td>${r.grnExpected}</td><td>${r.grnMatched}</td><td>${r.grnShort}</td>
      <td>${r.m+r.sh}</td><td>${r.m+r.ex}</td><td>${r.m}</td><td>${r.sh}</td><td>${r.ex}</td><td>${pct}%</td>
      <td><span class="stamp ${statusCls}">${r.approval.status}</span></td>
      <td>${r.approval.reviewedOn||'—'}</td><td>${r.approval.reviewedBy||'—'}</td>
      <td style="max-width:260px;white-space:pre-wrap;">${r.approval.remark||''}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="18" class="empty-note">No stores match this search/filter.</td></tr>';
}

function downloadAuditReportExcel(){
  if(!currentProfile || currentProfile.role !== 'admin') return;
  reconcile();
  const cycle = document.getElementById('cycleName').value || 'Untitled_Cycle';
  // Export exactly what's currently on screen — same circle/circle-head
  // filter, so a filtered view doesn't quietly download everyone's data.
  const circleFilter = document.getElementById('auditReportCircleFilter')?.value || '';
  const circleHeadFilter = document.getElementById('auditReportCircleHeadFilter')?.value || '';
  const headCircles = circleHeadFilter ? (circleHeadsCache||[]).find(h => h.id === circleHeadFilter)?.circles || [] : null;
  let stores = Object.keys(STORE_MASTER);
  if(headCircles) stores = stores.filter(s => headCircles.includes(circleFor(s)));
  if(circleFilter) stores = stores.filter(s => circleFor(s) === circleFilter);
  stores = stores.sort();
  const rows = stores.map(store => {
    const { invExpected, invMatched, invShort, grnExpected, grnMatched, grnShort, m, sh, ex } = storeSourceSummary(store);
    const approval = storeApprovalInfo(store, allProfilesCache);
    return {
      Store: store, Circle: circleFor(store),
      'Inventory Expected': invExpected, 'Inventory Matched': invMatched, 'Inventory Short': invShort,
      'GRN Pending Expected': grnExpected, 'GRN Pending Matched': grnMatched, 'GRN Pending Short': grnShort,
      'Total Expected': m+sh, 'Total Found': m+ex, Matched: m, Short: sh, Excess: ex,
      'Match %': (m+sh+ex) ? ((m/(m+sh+ex))*100).toFixed(2) : '100.00',
      'Review Status': approval.status,
      'Audited On': approval.reviewedOn || '',
      'Reviewed By': approval.reviewedBy || '',
      Remarks: approval.remark
    };
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  applyAutoFilter(ws, rows.length, 18);
  XLSX.utils.book_append_sheet(wb, ws, 'Audit Report');
  const headName = circleHeadFilter ? (circleHeadsCache||[]).find(h => h.id === circleHeadFilter)?.name : '';
  const suffix = (headName ? `_${headName}` : circleFilter ? `_${circleFilter}` : '').replace(/[^a-z0-9_]/gi,'_');
  XLSX.writeFile(wb, `Audit_Report_${cycle.replace(/[^a-z0-9]/gi,'_')}${suffix}.xlsx`);
}

async function renderCycleComparison(){
  if(!sb || !currentProfile || currentProfile.role !== 'admin') return;
  try{
    const { data: cycles, error: cycErr } = await sb.from('audit_cycles').select('*').order('created_at', {ascending:true});
    if(cycErr) throw cycErr;
    // Paginate: same 1000-row PostgREST default applies here, and this view
    // grows by (cycles x stores), so it's just as likely to get truncated
    // as base_serials/scans once there's enough history.
    let summary = [], sumFrom = 0;
    while(true){
      const { data, error: sumErr } = await sb.from('cycle_store_summary').select('*').range(sumFrom, sumFrom + 999);
      if(sumErr) throw sumErr;
      summary = summary.concat(data || []);
      if(!data || data.length < 1000) break;
      sumFrom += 1000;
    }

    // Populate the store filter dropdown once with whatever stores actually have data.
    const storeSelect = document.getElementById('compareStoreSelect');
    const prevSelected = storeSelect.value;
    const distinctStores = [...new Set((summary||[]).map(r=>normalizeStoreCode(r.store_code)))].sort();
    storeSelect.innerHTML = '<option value="">All stores (average)</option>' + distinctStores.map(s => `<option value="${s}">${s}</option>`).join('');
    if(distinctStores.includes(prevSelected)) storeSelect.value = prevSelected;
    const selectedStore = storeSelect.value;

    const rows = (cycles||[]).map(cycle => {
      const cycleSummaryRows = (summary||[]).filter(r => r.cycle_id === cycle.id && (!selectedStore || normalizeStoreCode(r.store_code) === selectedStore));
      const expected = cycleSummaryRows.reduce((s,r)=>s+r.expected_count, 0);
      const matched = cycleSummaryRows.reduce((s,r)=>s+r.matched_count, 0);
      const short = cycleSummaryRows.reduce((s,r)=>s+r.short_count, 0);
      const excess = cycleSummaryRows.reduce((s,r)=>s+r.excess_count, 0);
      const matchPct = expected ? (matched/expected*100) : null;
      return { cycle, expected, matched, short, excess, matchPct };
    }).filter(r => r.expected > 0 || r.matched > 0); // skip cycles with no data at all for this store

    // Trend chart
    const ctx = document.getElementById('compareTrendChart');
    if(compareTrendChartInstance) compareTrendChartInstance.destroy();
    compareTrendChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: rows.map(r => r.cycle.cycle_name),
        datasets: [{
          label: 'Match rate %',
          data: rows.map(r => r.matchPct === null ? null : Number(r.matchPct.toFixed(2))),
          borderColor: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#16A34A',
          backgroundColor: 'rgba(22,163,74,0.12)',
          tension: 0.3, fill: true, spanGaps: true,
          pointRadius: 4, pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { min: 0, max: 100, ticks: { callback: v => v + '%' } } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.raw === null ? 'No data' : ctx.raw + '% matched' } } }
      }
    });

    // Detail table
    const tbody = document.getElementById('compareTableBody');
    tbody.innerHTML = rows.length ? rows.slice().reverse().map(r => `
      <tr>
        <td>${r.cycle.cycle_name}</td>
        <td><span class="badge ${r.cycle.completed ? 'badge-match' : 'badge-open'}">${r.cycle.completed ? 'Completed' : 'Live'}</span></td>
        <td>${r.expected}</td>
        <td>${r.matched}</td>
        <td>${r.short}</td>
        <td>${r.excess}</td>
        <td>${r.matchPct === null ? '—' : r.matchPct.toFixed(2) + '%'}</td>
      </tr>`).join('')
      : '<tr><td colspan="7" class="empty-note">No cycle data yet for this filter.</td></tr>';
  }catch(e){
    console.error(e);
    showMessage('Could not load cycle comparison: ' + errMsg(e), true);
  }
}

async function renderAdminPanel(){
  if(!sb || !currentProfile || currentProfile.role !== 'admin') return;
  try{
    const { data: pendingRaw, error: pendErr } = await sb.from('profiles').select('*').eq('approved', false).order('created_at', {ascending:true});
    if(pendErr) throw pendErr;
    // An auditor request that already has a Circle Head to review it is
    // routed to them EXCLUSIVELY — it only shows up here as a fallback when
    // that store's circle has no Circle Head yet. Every other pending
    // request (admin/client/circle-head, and any auditor request with no
    // Circle Head to catch it) still shows here as before.
    const pending = (pendingRaw||[]).filter(p => !(p.role === 'user' && p.target_circle_head_id));
    const pendBody = document.getElementById('pendingUsersBody');
    const roleNamesForPending = {user:'Auditor', circle_head:'Circle Head', client:'Client', admin:'Admin'};
    pendBody.innerHTML = (pending && pending.length) ? pending.map(p => {
      const roleNote = p.role === 'user'
        ? `Wants store <b>${p.requested_store||'—'}</b> · no Circle Head assigned to that circle yet, so it's fallen to you`
        : p.role === 'circle_head'
          ? `Wants circle(s) <b>${(p.requested_circles||[]).join(', ')||'—'}</b>`
          : '';
      return `
      <tr><td><input type="checkbox" class="pending-select-box" data-id="${p.id}" ${selectedPendingIds.has(p.id)?'checked':''} onchange="togglePendingSelect('${p.id}', this.checked)"></td>
      <td>${displayNameFor(p.email, p.full_name)}<br><span style="color:var(--text-faint);font-size:11px;">${p.email}</span><br><span class="role-pill ${p.role}" style="margin-top:4px;display:inline-block;">${roleNamesForPending[p.role]||p.role}</span>${roleNote?`<br><span style="color:var(--text-faint);font-size:11px;">${roleNote}</span>`:''}</td><td>${new Date(p.created_at).toLocaleDateString()}</td>
      <td><div class="btn-row"><button class="btn btn-primary" onclick="approveUser('${p.id}')">Approve</button><button class="btn btn-danger" onclick="adminDeleteUser('${p.id}','${p.email.replace(/'/g,"\\'")}')">Reject</button></div></td></tr>`;
    }).join('')
      : '<tr><td colspan="4" class="empty-note">No pending sign-ups.</td></tr>';
    // Drop selections for anyone no longer pending (e.g. already approved elsewhere).
    const pendingIdsNow = new Set((pending||[]).map(p=>p.id));
    [...selectedPendingIds].forEach(id => { if(!pendingIdsNow.has(id)) selectedPendingIds.delete(id); });
    updatePendingBulkBar();

    const { data: approvedUsers, error: apprErr } = await sb.from('profiles').select('*').eq('approved', true).order('email');
    if(apprErr) throw apprErr;
    const { data: allAssignments, error: assignErr } = await sb.from('user_stores').select('*');
    if(assignErr) throw assignErr;
    const { data: allCircleAssignments, error: circleAssignErr } = await sb.from('user_circles').select('*');
    if(circleAssignErr) throw circleAssignErr;

    const storeCodes = Object.keys(STORE_MASTER).sort();
    const circleCodes = [...new Set(Object.values(STORE_MASTER))].sort();
    const roles = ['user','circle_head','client','admin'];
    const roleNames = {user:'Auditor', circle_head:'Circle Head', client:'Client', admin:'Admin'};
    const listEl = document.getElementById('approvedUsersList');
    listEl.innerHTML = (approvedUsers || []).map(u => {
      const myStores = new Set((allAssignments||[]).filter(a=>a.user_id===u.id).map(a=>normalizeStoreCode(a.store_code)));
      const myCircles = new Set((allCircleAssignments||[]).filter(a=>a.user_id===u.id).map(a=>a.circle));
      const storeChips = storeCodes.map(sc => `<span class="store-chip ${myStores.has(sc)?'active':''}" onclick="toggleStoreAssignment('${u.id}','${sc}',${myStores.has(sc)})">${sc}</span>`).join('');
      const circleChips = circleCodes.map(c => `<span class="store-chip ${myCircles.has(c)?'active':''}" onclick="toggleCircleAssignment('${u.id}','${c}',${myCircles.has(c)})">${c}</span>`).join('');
      const assignmentBlock = u.role === 'user'
        ? `<div class="user-row-stores"><span class="user-row-assign-label">Stores:</span>${storeChips}</div>`
        : u.role === 'circle_head'
          ? `<div class="user-row-stores"><span class="user-row-assign-label">Circles:</span>${circleChips}</div>`
          : `<div class="user-row-stores"><span class="user-row-assign-label" style="color:var(--text-faint);">No store/circle assignment needed for this role.</span></div>`;
      const avatarHtml = u.avatar_url ? `<img src="${u.avatar_url}" alt="" class="avatar-img">` : initialsFor(u.email, u.full_name);
      const roleOptions = roles.map(r => `<option value="${r}"${u.role===r?' selected':''}>${roleNames[r]}</option>`).join('');
      return `<div class="user-row">
        <input type="checkbox" class="approved-select-box" data-id="${u.id}" ${selectedApprovedIds.has(u.id)?'checked':''} onchange="toggleApprovedSelect('${u.id}', this.checked)" style="margin-top:4px;">
        <div class="user-row-email"><span class="user-avatar-sm">${avatarHtml}</span> ${displayNameFor(u.email, u.full_name)} <span class="role-pill ${u.role}">${u.role}</span><br><span style="color:var(--text-faint);font-size:11px;margin-left:34px;">${u.email}</span></div>
        ${assignmentBlock}
        <div class="btn-row">
          <select class="role-select" onchange="changeUserRole('${u.id}', this.value, '${roleNames[u.role].replace(/'/g,"\\'")}')" ${u.id === (currentUser?currentUser.id:null) ? 'disabled title="You can\'t change your own role"' : ''}>${roleOptions}</select>
          ${u.id !== (currentUser?currentUser.id:null) ? `<button class="btn btn-danger" onclick="adminDeleteUser('${u.id}','${u.email.replace(/'/g,"\\'")}')">Delete user</button>` : ''}
        </div>
      </div>`;
    }).join('') || '<div class="empty-note">No approved users yet.</div>';
    const approvedIdsNow = new Set((approvedUsers||[]).map(u=>u.id));
    [...selectedApprovedIds].forEach(id => { if(!approvedIdsNow.has(id)) selectedApprovedIds.delete(id); });
    updateApprovedBulkBar();
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

async function changeUserRole(userId, newRole, prevRoleLabel){
  const roleNames = {user:'Auditor', circle_head:'Circle Head', client:'Client', admin:'Admin'};
  confirmAction('role-'+userId+'-'+newRole, `This changes this user's role from ${prevRoleLabel} to ${roleNames[newRole]}`, async () => {
    try{
      const { error } = await sb.from('profiles').update({role:newRole}).eq('id', userId);
      if(error) throw error;
      circleHeadsCache = null; // a role change can add/remove a circle head — force the dashboard rollup to refetch
      showMessage(`Role updated to ${roleNames[newRole]}.`);
      renderAdminPanel();
    }catch(e){
      console.error(e);
      showMessage('Could not update role: ' + errMsg(e), true);
      renderAdminPanel(); // reset the select back to the actual saved role
    }
  }, () => renderAdminPanel()); // also reset the select if the confirm is cancelled
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

async function toggleCircleAssignment(userId, circle, currentlyAssigned){
  try{
    if(currentlyAssigned){
      const { error } = await sb.from('user_circles').delete().eq('user_id', userId).eq('circle', circle);
      if(error) throw error;
    } else {
      const { error } = await sb.from('user_circles').insert({user_id:userId, circle});
      if(error) throw error;
    }
    circleHeadsCache = null; // circle assignments changed — force the dashboard rollup to refetch
    renderAdminPanel();
  }catch(e){
    console.error(e);
    showMessage('Could not update circle assignment: ' + errMsg(e), true);
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

// ---------------- BULK ADMIN ACTIONS ----------------
function togglePendingSelect(id, checked){
  if(checked) selectedPendingIds.add(id); else selectedPendingIds.delete(id);
  updatePendingBulkBar();
}
function togglePendingSelectAll(checked){
  document.querySelectorAll('.pending-select-box').forEach(box => {
    box.checked = checked;
    if(checked) selectedPendingIds.add(box.dataset.id); else selectedPendingIds.delete(box.dataset.id);
  });
  updatePendingBulkBar();
}
function updatePendingBulkBar(){
  const bar = document.getElementById('pendingBulkBar');
  const count = document.getElementById('pendingSelectedCount');
  if(!bar || !count) return;
  bar.style.display = selectedPendingIds.size ? 'flex' : 'none';
  count.textContent = `${selectedPendingIds.size} selected`;
  const selectAllBox = document.getElementById('pendingSelectAll');
  if(selectAllBox){
    const allBoxes = document.querySelectorAll('.pending-select-box');
    selectAllBox.checked = allBoxes.length > 0 && selectedPendingIds.size === allBoxes.length;
  }
}
function bulkApproveSelected(){
  const ids = [...selectedPendingIds];
  if(!ids.length) return;
  confirmAction('bulk-approve', `This approves ${ids.length} user${ids.length===1?'':'s'} at once, giving them access immediately`, async () => {
    try{
      const { error } = await sb.from('profiles').update({approved:true}).in('id', ids);
      if(error) throw error;
      showMessage(`Approved ${ids.length} user${ids.length===1?'':'s'}.`);
      selectedPendingIds.clear();
      renderAdminPanel();
    }catch(e){
      console.error(e);
      showMessage('Could not bulk approve: ' + errMsg(e), true);
    }
  });
}
function bulkRejectSelected(){
  const ids = [...selectedPendingIds];
  if(!ids.length) return;
  confirmAction('bulk-reject', `This permanently rejects ${ids.length} pending sign-up${ids.length===1?'':'s'}`, async () => {
    try{
      const { error } = await sb.from('profiles').delete().in('id', ids);
      if(error) throw error;
      showMessage(`Rejected ${ids.length} sign-up${ids.length===1?'':'s'}.`);
      selectedPendingIds.clear();
      renderAdminPanel();
    }catch(e){
      console.error(e);
      showMessage('Could not bulk reject: ' + errMsg(e), true);
    }
  });
}

function toggleApprovedSelect(id, checked){
  if(checked) selectedApprovedIds.add(id); else selectedApprovedIds.delete(id);
  updateApprovedBulkBar();
}
function toggleApprovedSelectAll(checked){
  document.querySelectorAll('.approved-select-box').forEach(box => {
    box.checked = checked;
    if(checked) selectedApprovedIds.add(box.dataset.id); else selectedApprovedIds.delete(box.dataset.id);
  });
  updateApprovedBulkBar();
}
function updateApprovedBulkBar(){
  const bar = document.getElementById('approvedBulkBar');
  const count = document.getElementById('approvedSelectedCount');
  if(!bar || !count) return;
  bar.style.display = selectedApprovedIds.size ? 'flex' : 'none';
  count.textContent = `${selectedApprovedIds.size} selected`;
  const selectAllBox = document.getElementById('approvedSelectAllInline');
  if(selectAllBox){
    const allBoxes = document.querySelectorAll('.approved-select-box');
    selectAllBox.checked = allBoxes.length > 0 && selectedApprovedIds.size === allBoxes.length;
  }
}
let bulkSelectedStores = new Set();

function toggleBulkStorePicker(){
  const panel = document.getElementById('bulkStorePickerPanel');
  const willOpen = panel.style.display === 'none' || !panel.style.display;
  panel.style.display = willOpen ? 'block' : 'none';
  if(willOpen) renderBulkStorePicker();
}

function renderBulkStorePicker(){
  const byCircle = {};
  Object.entries(STORE_MASTER).forEach(([store, circle]) => {
    (byCircle[circle] = byCircle[circle] || []).push(store);
  });
  const circles = Object.keys(byCircle).sort();

  document.getElementById('circleChipRow').innerHTML = circles.map(c => {
    const allSelected = byCircle[c].every(s => bulkSelectedStores.has(s));
    const someSelected = !allSelected && byCircle[c].some(s => bulkSelectedStores.has(s));
    return `<span class="circle-chip ${allSelected?'active':''} ${someSelected?'partial':''}" onclick="toggleBulkCircle('${c}')" title="Click to ${allSelected?'deselect':'select'} all ${c} stores">${c}</span>`;
  }).join('');

  document.getElementById('storeCheckboxGrid').innerHTML = circles.map(c => `
    <div class="store-checkbox-group">
      <p class="store-checkbox-group-label">${c}</p>
      ${byCircle[c].slice().sort().map(s => `
        <label class="store-checkbox-item">
          <input type="checkbox" ${bulkSelectedStores.has(s)?'checked':''} onchange="toggleBulkStoreCheckbox('${s}', this.checked)">
          ${s}
        </label>`).join('')}
    </div>`).join('');

  updateBulkStoreSummary();
}

function toggleBulkStoreCheckbox(store, checked){
  if(checked) bulkSelectedStores.add(store); else bulkSelectedStores.delete(store);
  renderBulkStorePicker();
}

function toggleBulkCircle(circle){
  const stores = Object.entries(STORE_MASTER).filter(([s,c]) => c===circle).map(([s]) => s);
  const allSelected = stores.every(s => bulkSelectedStores.has(s));
  stores.forEach(s => allSelected ? bulkSelectedStores.delete(s) : bulkSelectedStores.add(s));
  renderBulkStorePicker();
}

function clearBulkStoreSelection(){
  bulkSelectedStores.clear();
  renderBulkStorePicker();
}

function updateBulkStoreSummary(){
  const n = bulkSelectedStores.size;
  const summary = document.getElementById('bulkStoreSelectedSummary');
  if(summary) summary.textContent = `${n} store${n===1?'':'s'} selected`;
  const badge = document.getElementById('bulkStoreCountBadge');
  if(badge) badge.textContent = n ? `(${n})` : '';
}

// After a successful bulk assign/unassign: clear the user checkboxes and the store
// picker's selections and close the picker, so the UI returns to its initial state
// instead of leaving everything still checked.
function resetBulkAssignmentUI(){
  selectedApprovedIds.clear();
  bulkSelectedStores.clear();
  const panel = document.getElementById('bulkStorePickerPanel');
  if(panel) panel.style.display = 'none';
  updateBulkStoreSummary();
}

function bulkAssignStoreToSelected(){
  const userIds = [...selectedApprovedIds];
  const stores = [...bulkSelectedStores];
  if(!userIds.length){ showMessage('Select at least one user first.', true); return; }
  if(!stores.length){ showMessage('Pick at least one store first.', true); return; }
  confirmAction('bulk-assign', `This assigns ${stores.length} store${stores.length===1?'':'s'} to ${userIds.length} user${userIds.length===1?'':'s'}`, async () => {
    try{
      const payload = [];
      userIds.forEach(uid => stores.forEach(sc => payload.push({user_id:uid, store_code:sc})));
      const { error } = await sb.from('user_stores').upsert(payload, { onConflict: 'user_id,store_code', ignoreDuplicates: true });
      if(error) throw error;
      showMessage(`Assigned ${stores.length} store${stores.length===1?'':'s'} to ${userIds.length} user${userIds.length===1?'':'s'}.`);
      resetBulkAssignmentUI();
      renderAdminPanel();
    }catch(e){
      console.error(e);
      showMessage('Could not bulk assign: ' + errMsg(e), true);
    }
  });
}
function bulkUnassignStoreFromSelected(){
  const userIds = [...selectedApprovedIds];
  const stores = [...bulkSelectedStores];
  if(!userIds.length){ showMessage('Select at least one user first.', true); return; }
  if(!stores.length){ showMessage('Pick at least one store first.', true); return; }
  confirmAction('bulk-unassign', `This removes ${stores.length} store${stores.length===1?'':'s'} from ${userIds.length} user${userIds.length===1?'':'s'}`, async () => {
    try{
      const { error } = await sb.from('user_stores').delete().in('user_id', userIds).in('store_code', stores);
      if(error) throw error;
      showMessage(`Removed ${stores.length} store${stores.length===1?'':'s'} from ${userIds.length} user${userIds.length===1?'':'s'}.`);
      resetBulkAssignmentUI();
      renderAdminPanel();
    }catch(e){
      console.error(e);
      showMessage('Could not bulk unassign: ' + errMsg(e), true);
    }
  });
}

// ---------------- PROFILE ----------------
async function renderProfilePanel(){
  if(!currentUser || !currentProfile) return;
  const storesLine = currentProfile.role === 'admin'
    ? 'All stores (admin)'
    : currentProfile.role === 'circle_head'
      ? (myAssignedCircles.length ? 'Circles: ' + myAssignedCircles.join(', ') : 'No circles assigned yet — contact your admin')
      : currentProfile.role === 'client'
        ? 'All circles (read-only — completed cycles only)'
        : (myAssignedStores.length ? myAssignedStores.join(', ') : 'None assigned yet — contact your admin');
  document.getElementById('profileInfo').innerHTML = `
    Name: ${displayNameFor(currentUser.email, currentProfile.full_name)}<br>
    Email: ${currentUser.email}<br>
    Role: ${roleLabel(currentProfile.role)}<br>
    Approved: ${currentProfile.approved ? 'Yes' : 'No'}<br>
    Assigned stores: ${storesLine}`;

  const nameInput = document.getElementById('profileFullName');
  if(nameInput) nameInput.value = currentProfile.full_name || '';
  const preview = document.getElementById('avatarPreview');
  if(preview){
    if(currentProfile.avatar_url) preview.innerHTML = `<img src="${currentProfile.avatar_url}" alt="Avatar" class="avatar-img">`;
    else preview.textContent = initialsFor(currentUser.email, currentProfile.full_name);
  }
  const removeBtn = document.getElementById('removeAvatarBtn');
  if(removeBtn) removeBtn.style.display = currentProfile.avatar_url ? '' : 'none';
}

async function handleSaveProfile(){
  if(!currentUser) return;
  const name = document.getElementById('profileFullName').value.trim();
  if(!name){ showMessage('Enter a name before saving.', true); return; }
  try{
    const { error } = await sb.from('profiles').update({ full_name: name }).eq('id', currentUser.id);
    if(error) throw error;
    currentProfile.full_name = name;
    updateTopbarUser();
    renderProfilePanel();
    showMessage('Profile updated.');
  }catch(e){
    console.error(e);
    showMessage('Could not update profile: ' + errMsg(e), true);
  }
}

// ---------------- AVATAR CROP TOOL ----------------
const CROP_STAGE_SIZE = 260;
const CROP_OUTPUT_SIZE = 320;
let cropState = { natW:0, natH:0, baseScale:1, zoom:1, offsetX:0, offsetY:0 };
let cropDrag = { active:false, startX:0, startY:0, startOffsetX:0, startOffsetY:0 };

function openAvatarCropper(event){
  const file = event.target.files[0];
  if(!file || !currentUser) return;
  if(file.size > 8 * 1024 * 1024){ showMessage('Image must be under 8MB.', true); event.target.value=''; return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = document.getElementById('cropImage');
    img.onload = () => {
      cropState.natW = img.naturalWidth;
      cropState.natH = img.naturalHeight;
      cropState.baseScale = Math.max(CROP_STAGE_SIZE / img.naturalWidth, CROP_STAGE_SIZE / img.naturalHeight);
      cropState.zoom = 1;
      cropState.offsetX = 0;
      cropState.offsetY = 0;
      document.getElementById('cropZoomSlider').value = 1;
      cropApplyTransform();
      document.getElementById('cropModalOverlay').style.display = 'flex';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function closeAvatarCropper(){
  document.getElementById('cropModalOverlay').style.display = 'none';
}

function cropApplyTransform(){
  const img = document.getElementById('cropImage');
  const effectiveScale = cropState.baseScale * cropState.zoom;
  img.style.width = (cropState.natW * effectiveScale) + 'px';
  img.style.height = (cropState.natH * effectiveScale) + 'px';
  img.style.transform = `translate(calc(-50% + ${cropState.offsetX}px), calc(-50% + ${cropState.offsetY}px))`;
}

function cropClampOffsets(){
  const effectiveScale = cropState.baseScale * cropState.zoom;
  const scaledW = cropState.natW * effectiveScale;
  const scaledH = cropState.natH * effectiveScale;
  const maxX = Math.max(0, (scaledW - CROP_STAGE_SIZE) / 2);
  const maxY = Math.max(0, (scaledH - CROP_STAGE_SIZE) / 2);
  cropState.offsetX = Math.min(maxX, Math.max(-maxX, cropState.offsetX));
  cropState.offsetY = Math.min(maxY, Math.max(-maxY, cropState.offsetY));
}

function cropUpdateZoom(val){
  cropState.zoom = parseFloat(val);
  cropClampOffsets();
  cropApplyTransform();
}

function cropDragStart(event){
  event.preventDefault();
  const point = event.touches ? event.touches[0] : event;
  cropDrag.active = true;
  cropDrag.startX = point.clientX;
  cropDrag.startY = point.clientY;
  cropDrag.startOffsetX = cropState.offsetX;
  cropDrag.startOffsetY = cropState.offsetY;
  window.addEventListener('mousemove', cropDragMove);
  window.addEventListener('touchmove', cropDragMove, { passive:false });
  window.addEventListener('mouseup', cropDragEnd);
  window.addEventListener('touchend', cropDragEnd);
}
function cropDragMove(event){
  if(!cropDrag.active) return;
  event.preventDefault();
  const point = event.touches ? event.touches[0] : event;
  cropState.offsetX = cropDrag.startOffsetX + (point.clientX - cropDrag.startX);
  cropState.offsetY = cropDrag.startOffsetY + (point.clientY - cropDrag.startY);
  cropClampOffsets();
  cropApplyTransform();
}
function cropDragEnd(){
  cropDrag.active = false;
  window.removeEventListener('mousemove', cropDragMove);
  window.removeEventListener('touchmove', cropDragMove);
  window.removeEventListener('mouseup', cropDragEnd);
  window.removeEventListener('touchend', cropDragEnd);
}

async function saveCroppedAvatar(){
  if(!currentUser) return;
  const img = document.getElementById('cropImage');
  const effectiveScale = cropState.baseScale * cropState.zoom;
  const cropSizeInImagePx = CROP_STAGE_SIZE / effectiveScale;
  const centerXInImagePx = cropState.natW / 2 - cropState.offsetX / effectiveScale;
  const centerYInImagePx = cropState.natH / 2 - cropState.offsetY / effectiveScale;
  const sx = centerXInImagePx - cropSizeInImagePx / 2;
  const sy = centerYInImagePx - cropSizeInImagePx / 2;

  const canvas = document.createElement('canvas');
  canvas.width = CROP_OUTPUT_SIZE;
  canvas.height = CROP_OUTPUT_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, sx, sy, cropSizeInImagePx, cropSizeInImagePx, 0, 0, CROP_OUTPUT_SIZE, CROP_OUTPUT_SIZE);

  canvas.toBlob(async (blob) => {
    if(!blob){ showMessage('Could not process image.', true); return; }
    closeAvatarCropper();
    showMessage('Uploading photo…');
    try{
      const path = `${currentUser.id}/avatar.png`;
      const { error: uploadErr } = await sb.storage.from('avatars').upload(path, blob, { upsert: true, cacheControl: '3600', contentType: 'image/png' });
      if(uploadErr) throw uploadErr;
      const { data: pub } = sb.storage.from('avatars').getPublicUrl(path);
      const avatarUrl = pub.publicUrl + '?t=' + Date.now(); // cache-bust so the new photo shows immediately
      const { error: updateErr } = await sb.from('profiles').update({ avatar_url: avatarUrl }).eq('id', currentUser.id);
      if(updateErr) throw updateErr;
      currentProfile.avatar_url = avatarUrl;
      updateTopbarUser();
      renderProfilePanel();
      showMessage('Profile photo updated.');
    }catch(e){
      console.error(e);
      showMessage('Could not upload photo: ' + errMsg(e), true);
    }
  }, 'image/png', 0.92);
}

function handleDeleteAvatar(){
  if(!currentUser || !currentProfile || !currentProfile.avatar_url) return;
  confirmAction('delete-avatar', 'This removes your profile photo', async () => {
    try{
      const path = `${currentUser.id}/avatar.png`;
      const { error: removeErr } = await sb.storage.from('avatars').remove([path]);
      if(removeErr) throw removeErr;
      const { error: updateErr } = await sb.from('profiles').update({ avatar_url: null }).eq('id', currentUser.id);
      if(updateErr) throw updateErr;
      currentProfile.avatar_url = null;
      updateTopbarUser();
      renderProfilePanel();
      showMessage('Profile photo removed.');
    }catch(e){
      console.error(e);
      showMessage('Could not remove photo: ' + errMsg(e), true);
    }
  });
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

const STORE_ALIASES = ['store','store name','storename','store id','storeid','locationcode','location code','client'];
const SKU_ALIASES = ['sku','item','item code','itemcode','material','material code','materialcode','itemno','item no','no2'];
const SERIAL_ALIASES = ['serial','serial no','serial number','serialno','serial#','sr no','sr. no.','itemserialno','item serial no','item serial number','boxidserial'];
const IMEI_ALIASES = ['imei','imei1'];
const DESC_ALIASES = ['description','desc'];
// GRN pending source files (e.g. MultiUOMSerialReport) carry a GRN number
// per row — populated once that unit has actually been GRN'd/inward
// (already in Inventory now), blank while it's still genuinely pending.
// When uploading as GRN Stock (Pending Inward), handleBaseUpload keeps only
// the blank-GRNNo rows and drops the rest — see there for why.
const GRN_NO_ALIASES = ['grnno','grn no','grn number'];
// The ASN (order) a GRN-pending serial belongs to — kept purely for
// traceability in the export ("this short/matched serial is on ASN X"),
// not used for any matching logic.
const ASN_ALIASES = ['asnno','asn no','asn number','asn'];

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
  currentCycleCreatedAt = cycle.created_at || null;
  auditCompleted = !!cycle.completed;
  dashboardStoreFilter = null;
  dashboardCircleFilter = null;
  adminViewingCircleHead = null;
  updateCycleLabels();
  await fetchCycleData();
  renderBaseTable();
  populateStoreSelect();
  renderScanView();
  if(auditCompleted) reconcile();
  renderDashboard();
  subscribeToRealtimeUpdates(cycle.id);
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
        currentCycleId = null; currentCycleName = ''; currentCycleCreatedAt = null;
        baseData = []; scanData = []; detailResults = []; reconciledStores = []; auditCompleted = false;
        document.getElementById('cycleName').value = '';
        updateCycleLabels();
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

// Supabase/PostgREST caps any single select() response at 1000 rows by
// default (api.max_rows). A .select('*') with no .range() silently
// truncates once a cycle's total row count crosses that line — it does NOT
// error out, so it's easy to miss. As more stores get uploaded into a
// cycle, base_serials and scans are exactly the tables that grow past 1000,
// so every fetch here must page through with .range() until a page comes
// back short of the page size.
async function fetchAllRows(table, cycleId){
  const pageSize = 1000;
  let from = 0;
  let all = [];
  while(true){
    const { data, error } = await sb.from(table).select('*').eq('cycle_id', cycleId).range(from, from + pageSize - 1);
    if(error) throw error;
    all = all.concat(data || []);
    if(!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function fetchAllUserStoreAssignments(){
  // For admins this is every assignment across every user (used to compute
  // "how many of the stores actually being audited are done"); for a
  // regular user, RLS restricts this to just their own rows anyway.
  // This one isn't scoped to a cycle, so it stays a plain select — but it's
  // paged too in case the org grows past 1000 user/store assignments.
  let assignRows = [], assignFrom = 0;
  while(true){
    const { data, error } = await sb.from('user_stores').select('store_code, user_id').range(assignFrom, assignFrom + 999);
    if(error) break;
    assignRows = assignRows.concat(data || []);
    if(!data || data.length < 1000) break;
    assignFrom += 1000;
  }
  return assignRows;
}

async function fetchCycleData(){
  if(!currentCycleId) return;
  // These four reads are fully independent of each other — running them
  // sequentially (as this used to) meant the total wait was the SUM of all
  // four round trips. Promise.all runs them concurrently instead, so the
  // total wait is roughly just the slowest single one.
  const [baseRows, scanRows, lockRows, assignRows] = await Promise.all([
    fetchAllRows('base_serials', currentCycleId),
    fetchAllRows('scans', currentCycleId),
    fetchAllRows('store_locks', currentCycleId),
    fetchAllUserStoreAssignments()
  ]);

  baseData = (baseRows||[]).map(r => ({store:normalizeStoreCode(r.store_code), sku:r.sku, desc:r.description, serial:r.serial_no, sourceType: r.source_type || 'inventory', asnNo: r.asn_no || null, uploadedAt:r.uploaded_at}));
  scanData = (scanRows||[]).map(r => ({id:r.id, store:normalizeStoreCode(r.store_code), sku:r.sku, serial:r.serial_no, ts: new Date(r.scanned_at).toLocaleString(), rawTs:r.scanned_at, scannedBy:r.scanned_by}));
  storeLocks = (lockRows||[]).map(r => ({
    store:normalizeStoreCode(r.store_code), lockedBy:r.locked_by, lockedByEmail:r.locked_by_email,
    lockedAt:new Date(r.locked_at).toLocaleString(), lockedAtRaw:r.locked_at,
    approvalStatus: r.approval_status || 'pending', approvedBy: r.approved_by || null, approvedByEmail: r.approved_by_email || null, approvedByName: r.approved_by_name || null,
    approvedAt: r.approved_at ? new Date(r.approved_at).toLocaleString() : null, approvedAtRaw: r.approved_at || null, approvalRemark: r.approval_remark || ''
  }));
  allStoreAssignments = assignRows;
}

function getStoreLock(store){
  return storeLocks.find(l => l.store === store) || null;
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

let pendingConfirmFn = null;
let pendingCancelFn = null;
let selectedPendingIds = new Set();
let selectedApprovedIds = new Set();

function confirmAction(key, label, fn, cancelFn){
  pendingConfirmFn = fn;
  pendingCancelFn = cancelFn || null;
  document.getElementById('confirmModalMessage').textContent = label + '. Are you sure you want to continue?';
  document.getElementById('confirmModalOverlay').style.display = 'flex';
}

function confirmModalYes(){
  document.getElementById('confirmModalOverlay').style.display = 'none';
  const fn = pendingConfirmFn;
  pendingConfirmFn = null; pendingCancelFn = null;
  if(fn) fn();
}

function confirmModalNo(){
  document.getElementById('confirmModalOverlay').style.display = 'none';
  const cancelFn = pendingCancelFn;
  pendingConfirmFn = null; pendingCancelFn = null;
  if(cancelFn) cancelFn();
}

function openSignupSuccessModal(message){
  document.getElementById('signupSuccessModalMessage').textContent = message;
  document.getElementById('signupSuccessModalOverlay').style.display = 'flex';
}
function closeSignupSuccessModal(){
  document.getElementById('signupSuccessModalOverlay').style.display = 'none';
  // Land them back on the sign-in tab, ready to wait for approval.
  switchAuthMode('signin');
}

function toggleSidebarNav(){
  const nav = document.getElementById('sidebarNav');
  const hamburger = document.getElementById('sidebarHamburger');
  const backdrop = document.getElementById('navBackdrop');
  if(!nav) return;
  const isOpen = nav.classList.toggle('open');
  if(hamburger) hamburger.classList.toggle('open', isOpen);
  if(backdrop) backdrop.classList.toggle('open', isOpen);
}
function closeSidebarNav(){
  const nav = document.getElementById('sidebarNav'); if(nav) nav.classList.remove('open');
  const hamburger = document.getElementById('sidebarHamburger'); if(hamburger) hamburger.classList.remove('open');
  const backdrop = document.getElementById('navBackdrop'); if(backdrop) backdrop.classList.remove('open');
  // Also collapse any category flyout that was pinned open by a tap
  // (desktop hover-flyouts don't need this — they close on their own
  // when the mouse leaves — this is only for the touch-tap fallback).
  document.querySelectorAll('.nav-parent.pinned-open').forEach(p => p.classList.remove('pinned-open'));
}

// Desktop flyouts open on hover; on a touch screen (no real hover) tapping
// the category label toggles it open/closed instead, so the menu still
// works on tablets/touch laptops at desktop width.
function toggleNavParent(labelEl){
  const parent = labelEl.closest('.nav-parent');
  if(!parent) return;
  const willOpen = !parent.classList.contains('pinned-open');
  document.querySelectorAll('.nav-parent.pinned-open').forEach(p => { if(p !== parent) p.classList.remove('pinned-open'); });
  parent.classList.toggle('pinned-open', willOpen);
}

// A category (Reports/Management/Operations) should disappear entirely for
// a role that can't see anything inside it — e.g. a client has neither
// "Users & Stores" nor "Approvals", so "Management" would otherwise show
// as a header hiding an empty flyout. Runs once per login/role-class
// change; cheap enough not to need re-running on every navigation.
function updateNavParentVisibility(){
  document.querySelectorAll('.nav-parent').forEach(parent => {
    const items = parent.querySelectorAll('.nav-flyout .nav-item');
    const anyVisible = Array.from(items).some(item => getComputedStyle(item).display !== 'none');
    parent.classList.toggle('nav-parent-empty', !anyVisible);
  });
}

function showStep(step, skipHistory){
  ['setup','scan','mystores','dashboard','admin','profile','compare','approvals','auditreport'].forEach(s => {
    document.getElementById('view-'+s).classList.toggle('active', s===step);
    document.getElementById('tab-'+s).classList.toggle('active', s===step);
  });
  // Highlight the category header for whichever flyout the active tab
  // lives in (a standalone item like My Account has no parent — fine,
  // querySelectorAll just finds nothing to touch).
  document.querySelectorAll('.nav-parent').forEach(p => p.classList.remove('active-parent'));
  const activeTabEl = document.getElementById('tab-'+step);
  const activeParent = activeTabEl && activeTabEl.closest('.nav-parent');
  if(activeParent) activeParent.classList.add('active-parent');
  const pageTitles = {setup:'Setup Base Data', scan:'Scan / Upload', mystores:'My Stores', dashboard:'Overview', admin:'Users & Stores', profile:'My Account', compare:'Compare Cycles', approvals:'Approvals', auditreport:'Audit Report'};
  const titleEl = document.getElementById('contentTitle');
  if(titleEl && pageTitles[step]) titleEl.textContent = pageTitles[step];
  const labelEl = document.getElementById('sidebarCurrentPageLabel');
  if(labelEl && pageTitles[step]) labelEl.textContent = pageTitles[step];
  // Selecting a page closes the drawer back down to just the hamburger.
  closeSidebarNav();
  stopDashboardPolling();
  if(step==='scan') renderScanView();
  if(step==='mystores') renderMyStoresView();
  if(step==='setup') renderBaseTable();
  if(step==='approvals') renderApprovalsPage();
  if(step==='dashboard'){ renderDashboard(); if(currentProfile && ['admin','circle_head','client'].includes(currentProfile.role)) startDashboardPolling(); }
  if(step==='admin') renderAdminPanel();
  if(step==='profile') renderProfilePanel();
  if(step==='compare') renderCycleComparison();
  if(step==='auditreport') renderAuditReportPage();

  // Keep the URL in sync so the browser's own Back/Forward buttons work,
  // and a page can be reloaded/bookmarked directly to a specific section.
  if(!skipHistory && location.hash.replace('#','') !== step){
    history.pushState({step}, '', '#'+step);
  }
  const backBtn = document.getElementById('routeBackBtn');
  if(backBtn) backBtn.style.display = history.length > 1 ? '' : 'none';
}

const VALID_ROUTE_STEPS = ['setup','scan','mystores','dashboard','admin','profile','compare','approvals','auditreport'];
window.addEventListener('popstate', () => {
  const step = location.hash.replace('#','');
  if(VALID_ROUTE_STEPS.includes(step) && document.getElementById('appRoot').style.display !== 'none'){
    showStep(step, true);
  }
});
function goBack(){ history.back(); }

// ---------------- REALTIME SYNC ----------------
// Pushes live updates instantly when any auditor scans/locks/uploads,
// instead of waiting for the next poll. A slow fallback poll stays on
// as a safety net in case a websocket connection silently drops.
let realtimeChannel = null;

function subscribeToRealtimeUpdates(cycleId){
  unsubscribeRealtime();
  if(!sb || !cycleId) return;
  realtimeChannel = sb.channel('cycle-' + cycleId)
    .on('postgres_changes', { event:'*', schema:'public', table:'scans', filter:'cycle_id=eq.'+cycleId }, handleRealtimeChange)
    .on('postgres_changes', { event:'*', schema:'public', table:'store_locks', filter:'cycle_id=eq.'+cycleId }, handleRealtimeChange)
    .on('postgres_changes', { event:'*', schema:'public', table:'base_serials', filter:'cycle_id=eq.'+cycleId }, handleRealtimeChange)
    .on('postgres_changes', { event:'UPDATE', schema:'public', table:'audit_cycles', filter:'id=eq.'+cycleId }, handleRealtimeChange)
    .subscribe();
}

function unsubscribeRealtime(){
  if(realtimeChannel && sb){ sb.removeChannel(realtimeChannel); realtimeChannel = null; }
}

let realtimeDebounceTimer = null;
function handleRealtimeChange(){
  // Debounce: a bulk upload or many quick scans fire many events at once —
  // wait for things to settle for a moment before refreshing. The extra
  // random jitter (0-900ms on top of the base 600ms) matters once several
  // auditors are connected to the same cycle: without it, every client
  // reacts to the same broadcast at the exact same millisecond and all
  // fire the same expensive refetch simultaneously, which is what was
  // stacking up into "statement timeout" under real concurrent use. The
  // jitter spreads those refetches out over ~1.5s instead of one spike.
  clearTimeout(realtimeDebounceTimer);
  const jitter = Math.floor(Math.random() * 900);
  realtimeDebounceTimer = setTimeout(async () => {
    if(!currentCycleId) return;
    try{
      await fetchCycleData();
      const activeView = document.querySelector('.panel-view.active');
      const activeId = activeView ? activeView.id : '';
      if(activeId === 'view-dashboard') renderDashboard();
      if(activeId === 'view-scan') renderScanView();
      if(activeId === 'view-mystores') renderMyStoresView();
      if(activeId === 'view-setup') renderBaseTable();
      if(activeId === 'view-approvals') renderApprovalsPage();
      refreshMissingBaseDataNotice(); // bell badge (pending approvals for a circle head) stays live regardless of active page
      // The missing-base-data bell badge depends on storeLocks + baseData,
      // both of which can change from any screen (a store gets submitted
      // while the admin is on Setup, base data gets uploaded while an
      // auditor is scanning) — so it refreshes independent of which view is open.
      refreshMissingBaseDataNotice();
    }catch(e){
      console.error('Realtime refresh failed', e);
      // Don't leave the user stuck needing to sign out/in to recover — if
      // this refresh failed (e.g. a timeout under load), retry once on a
      // short delay instead of silently giving up until their next action.
      clearTimeout(realtimeDebounceTimer);
      realtimeDebounceTimer = setTimeout(() => handleRealtimeChange(), 4000);
    }
  }, 600 + jitter);
}

let dashboardPollTimer = null;
function startDashboardPolling(){
  stopDashboardPolling();
  // Realtime handles instant updates now — this is just a fallback in
  // case a websocket connection silently drops on a flaky network.
  dashboardPollTimer = setInterval(async () => {
    if(!currentCycleId) return;
    try{ await fetchCycleData(); renderDashboard(); }
    catch(e){ console.error('Fallback refresh failed', e); }
  }, 60000);
}
function stopDashboardPolling(){
  if(dashboardPollTimer){ clearInterval(dashboardPollTimer); dashboardPollTimer = null; }
}

async function manualRefreshDashboard(){
  if(!requireCycle()) return;
  try{
    await fetchCycleData();
    renderDashboard();
    showMessage('Dashboard refreshed.');
  }catch(e){
    console.error(e);
    showMessage('Could not refresh: ' + errMsg(e), true);
  }
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

function getSelectedBaseDataType(){
  const checked = document.querySelector('input[name="baseDataType"]:checked');
  return checked ? checked.value : 'inventory'; // default to the original behaviour if the control isn't present
}

function handleBaseUpload(event){
  const file = event.target.files[0];
  if(!file) return;
  if(!requireCycle()){ event.target.value=''; return; }
  const sourceType = getSelectedBaseDataType(); // 'inventory' or 'grn' — which bucket this upload declares itself as
  const sourceLabel = sourceType === 'grn' ? 'GRN pending' : 'Inventory';
  parseWorkbook(file, async (rows) => {
    const parsedRaw = rows.map(r => ({
      store: findStore(r),
      sku: findVal(r, SKU_ALIASES),
      desc: findVal(r, DESC_ALIASES),
      serial: findSerial(r),
      grnNo: findVal(r, GRN_NO_ALIASES),
      asnNo: findVal(r, ASN_ALIASES)
    })).filter(r => r.store); // keep store-only rows too — a blank serial with a store present declares "0 system stock" for that store

    if(!parsedRaw.length && rows.length){
      showMessage(`Couldn't find a store column in this file — none of its headers matched what the app recognizes (LocationCode, Store, Client, etc). Download the upload format below and match your columns to it.`, true);
      event.target.value = '';
      return;
    }

    // Circle heads can only ever upload for their own circle's stores — this
    // mirrors the RLS check on the insert itself, so a mixed file (or the
    // wrong circle entirely) fails loudly here instead of silently at the
    // database with rows just missing. The optional store dropdown adds a
    // second, tighter check on top when they want to be extra sure.
    let outOfScopeCount = 0;
    let parsedScoped = parsedRaw;
    if(isCircleHeadUser()){
      const restrictToStore = document.getElementById('circleHeadUploadStoreSelect');
      const onlyStore = restrictToStore ? restrictToStore.value : '';
      parsedScoped = parsedRaw.filter(r => {
        const inMyCircle = myAssignedCircles.includes(circleFor(r.store));
        const matchesChosenStore = !onlyStore || r.store === onlyStore;
        if(inMyCircle && matchesChosenStore) return true;
        outOfScopeCount++;
        return false;
      });
      if(!parsedScoped.length){
        showMessage(onlyStore
          ? `None of the rows in this file matched ${onlyStore} — nothing uploaded.`
          : `None of the rows in this file are for a store in your circle(s) — nothing uploaded.`, true);
        event.target.value = '';
        return;
      }
    }

    // GRN Stock (Pending Inward) uploads: a filled GRNNo means that serial has
    // already been GRN'd/inward — it's Inventory now, not pending — so only
    // the blank-GRNNo rows are genuinely still pending and get kept here.
    let alreadyInwardCount = 0;
    let parsedForType = parsedScoped;
    if(sourceType === 'grn'){
      parsedForType = parsedScoped.filter(r => {
        if(!r.serial) return true; // zero-stock declaration row, unaffected by GRNNo
        const isAlreadyInward = !!(r.grnNo && String(r.grnNo).trim());
        if(isAlreadyInward) alreadyInwardCount++;
        return !isAlreadyInward;
      });
    }

    // A zero-stock declaration only needs one row per store (per source type); collapse
    // repeats so we don't stack up empty-serial placeholder rows on every re-upload.
    const seenZeroStockStore = new Set();
    const parsed = parsedForType.filter(r => {
      if(r.serial) return true;
      if(seenZeroStockStore.has(r.store)) return false;
      seenZeroStockStore.add(r.store);
      return true;
    });

    if(!parsed.length){
      showMessage(alreadyInwardCount ? `All ${alreadyInwardCount} rows in this file already have a GRN number — they're already inward (Inventory now), so nothing was uploaded as GRN Pending.` : 'No valid rows found in this file.', true);
      event.target.value = '';
      return;
    }

    document.getElementById('baseUploadStatus').textContent = `Uploading ${parsed.length} ${sourceLabel} rows to Supabase…`;
    try{
      const payload = parsed.map(r => ({
        cycle_id: currentCycleId, store_code: r.store, sku: r.sku, description: r.desc, serial_no: r.serial, source_type: sourceType,
        asn_no: sourceType === 'grn' ? (r.asnNo || null) : null
      }));
      const chunkSize = 500;
      for(let i=0; i<payload.length; i+=chunkSize){
        const { error } = await sb.from('base_serials').insert(payload.slice(i, i+chunkSize));
        if(error) throw error;
      }
      await fetchCycleData();
      const invCount = baseData.filter(r=>r.sourceType!=='grn').length;
      const grnCount = baseData.filter(r=>r.sourceType==='grn').length;
      const skippedNote = alreadyInwardCount ? ` (${alreadyInwardCount} row${alreadyInwardCount===1?'':'s'} skipped — already GRN'd/inward, now Inventory.)` : '';
      const outOfScopeNote = outOfScopeCount ? ` (${outOfScopeCount} row${outOfScopeCount===1?'':'s'} outside your circle were skipped.)` : '';
      document.getElementById('baseUploadStatus').textContent = `Loaded ${parsed.length} ${sourceLabel} rows from ${file.name} (saved to cycle "${currentCycleName}").${skippedNote}${outOfScopeNote} Base data now totals ${baseData.length} rows — ${invCount} Inventory, ${grnCount} GRN pending.`;
      renderBaseTable();
      populateStoreSelect();
      event.target.value = '';
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
    const parsedRaw = [];
    rows.forEach(r => {
      const storeFromFile = findStore(r);
      const serial = findSerial(r);
      const sku = findVal(r, SKU_ALIASES);
      if(!serial) return;
      parsedRaw.push({store: storeFromFile || selectedStore, sku, serial});
    });

    // Drop duplicates: against what's already scanned, and repeats within this file itself.
    const existingKeys = new Set(scanData.map(r => r.store + '::' + normalizeSerial(r.serial)));
    const seenInFile = new Set();
    const parsed = [];
    let duplicateCount = 0;
    parsedRaw.forEach(r => {
      const key = r.store + '::' + normalizeSerial(r.serial);
      if(existingKeys.has(key) || seenInFile.has(key)){ duplicateCount++; return; }
      seenInFile.add(key);
      parsed.push(r);
    });

    if(!parsed.length){
      if(!parsedRaw.length && rows.length){
        showMessage(`Couldn't find a serial number column in this file — none of its headers matched what the app recognizes (Serial No, Serial Number, ItemSerialNo, IMEI, etc). Download the upload format below and match your columns to it.`, true);
      } else {
        showMessage(duplicateCount ? `All ${duplicateCount} serials in this file were already scanned — nothing new to add.` : 'No valid serials found in this file.', true);
      }
      return;
    }

    try{
      const payload = parsed.map(r => ({cycle_id: currentCycleId, store_code: r.store, sku: r.sku, serial_no: r.serial, scanned_by: currentUser ? currentUser.id : null}));
      const chunkSize = 500;
      for(let i=0; i<payload.length; i+=chunkSize){
        const { error } = await sb.from('scans').insert(payload.slice(i, i+chunkSize));
        if(error) throw error;
      }
      await fetchCycleData();
      showMessage(`Uploaded ${parsed.length} scanned serials.` + (duplicateCount ? ` Skipped ${duplicateCount} already-scanned duplicate${duplicateCount===1?'':'s'}.` : ''));
      renderScanView();
    }catch(e){
      console.error(e);
      if(e && e.code === '23505'){
        showMessage('Some serials in this file were already scanned by someone else moments ago — please re-upload to pick up just the remaining new ones.', true);
        await fetchCycleData();
        renderScanView();
      } else {
        showMessage('Could not save scanned serials to Supabase: ' + errMsg(e), true);
      }
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
    const payload = sample.map(r => ({cycle_id: currentCycleId, store_code: r.store, sku: r.sku, description: r.desc, serial_no: r.serial, source_type: 'inventory'}));
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
  const invCount = baseData.filter(r => r.sourceType !== 'grn').length;
  const grnCount = baseData.filter(r => r.sourceType === 'grn').length;
  document.getElementById('baseCount').textContent = baseData.length ? `(${baseData.length} serials — ${invCount} Inventory, ${grnCount} GRN pending)` : '';
  const tbody = document.getElementById('baseTableBody');
  if(!baseData.length){ tbody.innerHTML = '<tr><td colspan="5" class="empty-note">No base data loaded yet.</td></tr>'; }
  else{
    tbody.innerHTML = baseData.map(r => `<tr><td>${r.store}</td><td>${circleFor(r.store)}</td><td>${r.sku||'—'}</td><td>${r.serial || '<em>Zero stock declared</em>'}</td><td><span class="badge badge-${r.sourceType==='grn'?'excess':'match'}">${r.sourceType==='grn'?'GRN Pending':'Inventory'}</span></td></tr>`).join('');
  }
  refreshMissingBaseDataNotice();
  renderPreAuditReadiness();
  const chStoreSelect = document.getElementById('circleHeadUploadStoreSelect');
  if(chStoreSelect && isCircleHeadUser()){
    const prev = chStoreSelect.value;
    const myStores = Object.keys(STORE_MASTER).filter(s => myAssignedCircles.includes(circleFor(s))).sort();
    chStoreSelect.innerHTML = '<option value="">— Any store in my circle(s) —</option>' + myStores.map(s => `<option value="${s}">${s} (${circleFor(s)})</option>`).join('');
    if(myStores.includes(prev)) chStoreSelect.value = prev;
  }
}

// Per-store readiness check before scanning starts: does this store have
// Inventory uploaded? GRN Pending uploaded? Neither? Surfaced as a strip of
// counts plus a full table, so a gap shows up before a cycle opens for
// scanning instead of confusing an auditor (or the client) mid-audit.
function renderPreAuditReadiness(){
  const strip = document.getElementById('preAuditReadinessStrip');
  const body = document.getElementById('preAuditReadinessBody');
  const sub = document.getElementById('preAuditReadinessSub');
  if(!strip || !body) return;
  // Circle heads only ever see/manage their own circle's stores here —
  // matches their base-data upload rights, which are circle-scoped too.
  const allStores = isCircleHeadUser()
    ? Object.keys(STORE_MASTER).filter(s => myAssignedCircles.includes(circleFor(s))).sort()
    : Object.keys(STORE_MASTER).sort();
  const hasInv = new Set(baseData.filter(r => r.sourceType !== 'grn').map(r => r.store));
  const hasGrn = new Set(baseData.filter(r => r.sourceType === 'grn').map(r => r.store));
  const invCount = allStores.filter(s => hasInv.has(s)).length;
  const grnCount = allStores.filter(s => hasGrn.has(s)).length;
  const neitherCount = allStores.filter(s => !hasInv.has(s) && !hasGrn.has(s)).length;
  if(sub) sub.textContent = isCircleHeadUser() ? `(${allStores.length} stores in your circle${myAssignedCircles.length===1?'':'s'})` : `(${allStores.length} stores in master list)`;
  strip.innerHTML = `
    <div class="readiness-item"><span class="readiness-item-value">${invCount}/${allStores.length}</span><span class="readiness-item-label">Have Inventory</span></div>
    <div class="readiness-item"><span class="readiness-item-value">${grnCount}/${allStores.length}</span><span class="readiness-item-label">Have GRN Pending</span></div>
    <div class="readiness-item ${neitherCount>0?'readiness-item-warn':''}"><span class="readiness-item-value">${neitherCount}</span><span class="readiness-item-label">Have neither yet</span></div>`;
  body.innerHTML = allStores.length ? allStores.map(s => {
    const inv = hasInv.has(s), grn = hasGrn.has(s);
    const status = inv && grn ? '<span class="badge badge-match">Ready</span>'
      : (inv || grn) ? '<span class="badge badge-excess">Partial</span>'
      : '<span class="badge badge-short">Not set up</span>';
    return `<tr><td>${s}</td><td>${circleFor(s)}</td><td>${inv?'✓':'—'}</td><td>${grn?'✓':'—'}</td><td>${status}</td></tr>`;
  }).join('') : '<tr><td colspan="5" class="empty-note">No circle assigned yet — contact your admin.</td></tr>';
}

// A store can be locked (audit submitted) while base_serials has zero rows
// for it — nobody ever uploaded its Inventory or GRN data, or even declared
// it as zero stock. That's a data-integrity gap, not a normal "0 expected /
// 0 found" store, so it's tracked and surfaced separately from both.
function computeMissingBaseDataStores(){
  const storesWithBase = new Set(baseData.map(r => r.store));
  return [...new Set(storeLocks.map(l => l.store))].filter(s => s && !storesWithBase.has(s)).sort();
}

function sanitizeStoreId(store){ return String(store).replace(/[^a-z0-9]/gi, '_'); }

// Central refresh point for the "submitted but no base data" notification —
// updates the topbar bell badge/dropdown and the Setup-page panel together so
// they never drift out of sync. Safe to call whenever storeLocks or baseData
// change, from any screen (guards on element existence for whichever isn't mounted).
function refreshMissingBaseDataNotice(){
  // Circle heads only see their own circle's missing-base-data rows on Setup —
  // matches the same scoping their base-data upload rights are enforced with.
  const missingAll = computeMissingBaseDataStores();
  const missing = isCircleHeadUser() ? missingAll.filter(s => myAssignedCircles.includes(circleFor(s))) : missingAll;

  // The bell is circle-head-only now (admin's approval UI moved to the
  // dedicated Approvals page) — it's purely a "you have submissions to
  // review" counter, not a missing-base-data indicator.
  const pendingApprovals = isCircleHeadUser()
    ? storeLocks.filter(l => l.approvalStatus === 'pending' && myAssignedCircles.includes(circleFor(l.store)))
    : [];

  const bellBadge = document.getElementById('topbarBellBadge');
  const bellBtn = document.getElementById('topbarBellBtn');
  if(bellBadge){
    if(pendingApprovals.length > 0){ bellBadge.style.display = 'flex'; bellBadge.textContent = pendingApprovals.length > 99 ? '99+' : pendingApprovals.length; }
    else{ bellBadge.style.display = 'none'; }
  }
  if(bellBtn) bellBtn.title = pendingApprovals.length ? `${pendingApprovals.length} submission${pendingApprovals.length===1?'':'s'} awaiting your review` : 'Notifications';

  const dropdownList = document.getElementById('notifDropdownList');
  if(dropdownList){
    dropdownList.innerHTML = pendingApprovals.length
      ? pendingApprovals.map(l => `<div class="notif-item">
          <div class="notif-item-body"><b>${l.store}</b><span>Circle ${circleFor(l.store)} · submitted by ${l.lockedByEmail||'—'}, awaiting your review</span></div>
          <button class="btn" onclick="closeNotifDropdown();showStep('approvals');">Review</button>
        </div>`).join('')
      : '<div class="empty-note">No pending approvals in your circle right now.</div>';
  }

  const panel = document.getElementById('missingBaseDataPanel');
  const list = document.getElementById('missingBaseDataList');
  const countEl = document.getElementById('missingBaseDataCount');
  if(panel && list){
    panel.style.display = missing.length ? 'block' : 'none';
    if(countEl) countEl.textContent = missing.length;
    [...selectedMissingBaseStores].forEach(s => { if(!missing.includes(s)) selectedMissingBaseStores.delete(s); });
    list.innerHTML = missing.map(s => `<div class="missing-base-row" id="missing-base-row-${sanitizeStoreId(s)}">
        <label class="missing-base-row-check"><input type="checkbox" ${selectedMissingBaseStores.has(s)?'checked':''} onchange="toggleMissingBaseSelect('${s.replace(/'/g,"\\'")}', this.checked)"></label>
        <div class="missing-base-row-info"><b>${s}</b><span>Circle ${circleFor(s)} · audit submitted, no Inventory or GRN data on file</span></div>
        <div class="missing-base-row-actions">
          <button class="btn" onclick="declareZeroStock('${s.replace(/'/g,"\\'")}','inventory')">Declare 0 Inventory</button>
          <button class="btn" onclick="declareZeroStock('${s.replace(/'/g,"\\'")}','grn')">Declare 0 GRN Pending</button>
        </div>
      </div>`).join('');
    updateMissingBaseDataBulkBar();
  }
}

let selectedMissingBaseStores = new Set();
function toggleMissingBaseSelect(store, checked){
  if(checked) selectedMissingBaseStores.add(store); else selectedMissingBaseStores.delete(store);
  updateMissingBaseDataBulkBar();
}
function clearMissingBaseDataSelection(){
  selectedMissingBaseStores.clear();
  document.querySelectorAll('#missingBaseDataList input[type="checkbox"]').forEach(cb => cb.checked = false);
  updateMissingBaseDataBulkBar();
}
function updateMissingBaseDataBulkBar(){
  const bar = document.getElementById('missingBaseDataBulkBar');
  const countEl = document.getElementById('missingBaseDataSelectedCount');
  if(!bar) return;
  bar.style.display = selectedMissingBaseStores.size ? 'flex' : 'none';
  if(countEl) countEl.textContent = selectedMissingBaseStores.size;
}
async function bulkDeclareZeroStock(sourceType){
  if(!requireCycle()) return;
  const stores = [...selectedMissingBaseStores];
  if(!stores.length) return;
  try{
    const payload = stores.map(s => ({ cycle_id: currentCycleId, store_code: s, serial_no: '', source_type: sourceType }));
    const { error } = await sb.from('base_serials').insert(payload);
    if(error) throw error;
    selectedMissingBaseStores.clear();
    await fetchCycleData();
    renderBaseTable();
    populateStoreSelect();
    showMessage(`Declared 0 ${sourceType==='grn' ? 'GRN pending' : 'Inventory'} stock for ${stores.length} store${stores.length===1?'':'s'}.`);
  }catch(e){
    console.error(e);
    showMessage('Could not save: ' + errMsg(e), true);
  }
}

function toggleNotifDropdown(){
  const dd = document.getElementById('notifDropdown');
  if(!dd) return;
  dd.style.display = (dd.style.display === 'none' || !dd.style.display) ? 'block' : 'none';
}
function closeNotifDropdown(){
  const dd = document.getElementById('notifDropdown');
  if(dd) dd.style.display = 'none';
}
document.addEventListener('click', (e) => {
  const dd = document.getElementById('notifDropdown');
  const btn = document.getElementById('topbarBellBtn');
  if(!dd || dd.style.display === 'none' || !dd.style.display) return;
  if(dd.contains(e.target) || (btn && btn.contains(e.target))) return;
  dd.style.display = 'none';
});

function goFixMissingBaseData(store){
  closeNotifDropdown();
  showStep('setup');
  setTimeout(() => {
    const panel = document.getElementById('missingBaseDataPanel');
    if(panel) panel.scrollIntoView({behavior:'smooth', block:'start'});
    const row = document.getElementById('missing-base-row-'+sanitizeStoreId(store));
    if(row){ row.classList.add('missing-base-row-flash'); setTimeout(() => row.classList.remove('missing-base-row-flash'), 1800); }
  }, 150);
}

// Lets an admin explicitly state "this store genuinely has 0 Inventory (or 0
// GRN pending) stock" without needing to build a one-row spreadsheet just to
// say so — same zero-declaration row shape handleBaseUpload already writes
// when a file has a store with a blank serial.
async function declareZeroStock(store, sourceType){
  if(!requireCycle()) return;
  try{
    // serial_no is NOT NULL in the schema — a zero-stock row is declared with
    // an empty string, exactly like handleBaseUpload already does for a
    // store-only row with a blank serial cell. Every place that reads this
    // back (renderBaseTable, reconcile, etc.) already treats a falsy serial
    // ('' or null) as "zero stock declared" the same way, so this matches.
    const { error } = await sb.from('base_serials').insert([{ cycle_id: currentCycleId, store_code: store, serial_no: '', source_type: sourceType }]);
    if(error) throw error;
    await fetchCycleData();
    renderBaseTable();
    populateStoreSelect();
    showMessage(`Declared 0 ${sourceType==='grn' ? 'GRN pending' : 'Inventory'} stock for ${store}.`);
  }catch(e){
    console.error(e);
    showMessage('Could not save: ' + errMsg(e), true);
  }
}

function populateStoreSelect(){
  let stores = [...new Set([...baseData.map(r=>r.store), ...scanData.map(r=>r.store)])].filter(Boolean).sort();
  if(currentProfile && currentProfile.role === 'circle_head'){
    // A circle head scanning/uploading directly isn't limited to stores
    // that already have base data loaded — they need every store in their
    // own circle(s) available, same set used everywhere else on their view.
    stores = [...new Set(Object.keys(STORE_MASTER).filter(s => myAssignedCircles.includes(circleFor(s))))].sort();
  } else if(currentProfile && currentProfile.role !== 'admin'){
    stores = myAssignedStores.slice().sort();
  }
  const sel = document.getElementById('scanStoreSelect');
  const prev = sel.value;
  const placeholder = '<option value="">— Please select store —</option>';
  sel.innerHTML = stores.length
    ? placeholder + stores.map(s => `<option value="${s}">${s}</option>`).join('')
    : '<option value="">No stores assigned — contact your admin</option>';
  if(stores.includes(prev)) sel.value = prev;
}

// ---------------- OFFLINE-TOLERANT SCANNING ----------------
// Scoped to manual single-serial scanning — the realistic case of an
// auditor standing in a store with a flaky signal. Bulk Excel upload
// still needs a live connection to read/save the file.
const OFFLINE_QUEUE_KEY = 'pv-recon-offline-queue';

function getOfflineQueue(){
  try{ return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]'); }
  catch(e){ return []; }
}
function saveOfflineQueue(queue){
  try{ localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue)); }catch(e){ console.error('Could not persist offline queue', e); }
  updateOfflineBanner();
}
function queueOfflineScan(payload){
  const queue = getOfflineQueue();
  queue.push({ ...payload, _queuedAt: new Date().toISOString() });
  saveOfflineQueue(queue);
}

let offlineSyncInProgress = false;
async function syncOfflineQueue(){
  if(offlineSyncInProgress || !navigator.onLine || !sb) return;
  const queue = getOfflineQueue();
  if(!queue.length) return;
  offlineSyncInProgress = true;
  updateOfflineBanner();
  const stillQueued = [];
  let syncedCount = 0;
  for(const entry of queue){
    const { _queuedAt, ...payload } = entry;
    try{
      const { error } = await sb.from('scans').insert(payload);
      if(error && error.code !== '23505'){ stillQueued.push(entry); }
      else { syncedCount++; }
    }catch(e){
      stillQueued.push(entry); // still offline or failed — keep it queued, try again next time
    }
  }
  saveOfflineQueue(stillQueued);
  offlineSyncInProgress = false;
  if(syncedCount > 0){
    showMessage(`✅ Synced ${syncedCount} offline scan${syncedCount===1?'':'s'}.`);
    if(currentCycleId){ await fetchCycleData(); renderScanView(); }
  }
  updateOfflineBanner();
}

function updateOfflineBanner(){
  const banner = document.getElementById('offlineBanner');
  if(!banner) return;
  const queue = getOfflineQueue();
  const isOffline = !navigator.onLine;
  if(isOffline){
    banner.style.display = 'flex';
    banner.textContent = `📴 You're offline — scans are being saved on this device${queue.length ? ` (${queue.length} queued)` : ''} and will sync automatically once you're back online.`;
  } else if(queue.length){
    banner.style.display = 'flex';
    banner.textContent = offlineSyncInProgress ? `Syncing ${queue.length} queued scan${queue.length===1?'':'s'}…` : `${queue.length} scan${queue.length===1?'':'s'} waiting to sync…`;
  } else {
    banner.style.display = 'none';
  }
}

window.addEventListener('online', syncOfflineQueue);
window.addEventListener('offline', updateOfflineBanner);

async function addScan(){
  const input = document.getElementById('scanInput');
  const serial = normalizeSerial(input.value.trim());
  const store = document.getElementById('scanStoreSelect').value;
  if(!serial){ return; }
  if(!store){ showMessage('Select a store first.', true); return; }
  if(!requireCycle()) return;

  const queue = getOfflineQueue();
  const isDuplicate = scanData.some(r => r.store === store && normalizeSerial(r.serial) === serial)
    || queue.some(q => q.store_code === store && normalizeSerial(q.serial_no) === serial);
  if(isDuplicate){
    showMessage(`⚠️ "${serial}" was already scanned for ${store} — not added again.`, true);
    input.value = '';
    input.focus();
    return;
  }

  const baseMatch = baseData.find(b => b.store === store && b.serial === serial);
  const scanPayload = {
    cycle_id: currentCycleId, store_code: store, sku: baseMatch ? baseMatch.sku : '', serial_no: serial, scanned_by: currentUser ? currentUser.id : null
  };

  if(!navigator.onLine){
    queueOfflineScan(scanPayload);
    input.value = '';
    input.focus();
    showMessage(`📴 Offline — "${serial}" saved on this device and will sync automatically once you're back online.`, true);
    renderScanView();
    return;
  }

  try{
    const { data: inserted, error } = await sb.from('scans').insert(scanPayload).select().single();
    if(error){
      if(error.code === '23505'){
        showMessage(`⚠️ "${serial}" was already scanned for ${store} — not added again.`, true);
        input.value = '';
        await fetchCycleData();
        renderScanView();
        return;
      }
      throw error;
    }
    input.value = '';
    // Update locally instead of re-fetching the whole cycle — this is
    // what made a single scan feel slow before.
    scanData.push({
      id: inserted.id,
      store: inserted.store_code,
      sku: inserted.sku,
      serial: inserted.serial_no,
      ts: new Date(inserted.scanned_at).toLocaleString(),
      scannedBy: inserted.scanned_by
    });
    renderScanView();
  }catch(e){
    console.error(e);
    // A network-level failure (not a real server error) — queue it
    // instead of losing the scan, so a flaky connection doesn't cost data.
    if(e instanceof TypeError || !navigator.onLine){
      queueOfflineScan(scanPayload);
      input.value = '';
      input.focus();
      showMessage(`📴 Connection issue — "${serial}" saved on this device and will sync automatically once you're back online.`, true);
      renderScanView();
      return;
    }
    showMessage('Could not save this scan to Supabase: ' + errMsg(e), true);
  }
}

async function removeScan(id){
  // Remove locally first so it feels instant, then confirm with the
  // server in the background — roll back only if the delete fails.
  const idx = scanData.findIndex(r => r.id === id);
  if(idx === -1) return;
  const removed = scanData[idx];
  scanData.splice(idx, 1);
  renderScanView();
  try{
    const { error } = await sb.from('scans').delete().eq('id', id);
    if(error) throw error;
  }catch(e){
    console.error(e);
    showMessage('Could not delete this scan from Supabase: ' + errMsg(e), true);
    scanData.splice(idx, 0, removed); // roll back
    renderScanView();
  }
}

// Simplified, read-only status view for auditors — just their own assigned
// stores, not the full admin dashboard (which stays off-limits so an
// auditor never sees another store's "expected" list before scanning it).
// Once a cycle is completed, their own store's match results show up here
// too — safe by then, since the store is already locked and submitted.
// Dedicated review page for a circle head — every pending submission in
// their circle(s), with the full variance (not just a count) so they can
// actually review before signing off, plus a short history of what they've
// already decided. Admin no longer has an approval panel on Overview —
// this page is the only place approvals happen now; admin sees the outcome
// via the store card badges and the exported Remarks column.
async function renderSignupRequestsPanel(){
  const card = document.getElementById('signupRequestsCard');
  if(!card) return;
  // Only a circle head ever has auditor requests routed to them — admins
  // review every request from their own Users & Stores tab instead.
  if(!isCircleHeadUser() || !currentUser){ card.style.display = 'none'; return; }
  card.style.display = '';
  try{
    const { data, error } = await sb.from('profiles').select('*')
      .eq('target_circle_head_id', currentUser.id).eq('approved', false).order('created_at', {ascending:true});
    if(error) throw error;
    const countEl = document.getElementById('signupRequestsCount');
    if(countEl) countEl.textContent = (data||[]).length;
    const listEl = document.getElementById('signupRequestsList');
    if(listEl){
      listEl.innerHTML = (data && data.length) ? data.map(p => `
        <div class="missing-base-row">
          <div class="missing-base-row-info"><b>${displayNameFor(p.email, p.full_name)}</b><span>${p.email} · wants to audit <b>${p.requested_store||'—'}</b> (${circleFor(p.requested_store||'')}) · ${new Date(p.created_at).toLocaleDateString()}</span></div>
          <div class="btn-row">
            <button class="btn btn-primary" onclick="approveSignupRequest('${p.id}')">Approve</button>
            <button class="btn btn-danger" onclick="rejectSignupRequest('${p.id}','${(p.email||'').replace(/'/g,"&apos;")}')">Reject</button>
          </div>
        </div>`).join('') : '<div class="empty-note">No sign-up requests waiting on you right now.</div>';
    }
  }catch(e){
    console.error(e);
  }
}

async function approveSignupRequest(userId){
  try{
    const { error } = await sb.from('profiles').update({approved:true}).eq('id', userId);
    if(error) throw error;
    showMessage('Auditor approved — they can sign in now.');
    renderSignupRequestsPanel();
  }catch(e){
    console.error(e);
    showMessage('Could not approve: ' + errMsg(e), true);
  }
}

function rejectSignupRequest(userId, email){
  confirmAction('signup-reject-'+userId, `This permanently rejects the sign-up request from ${email}`, async () => {
    try{
      const { error } = await sb.from('profiles').delete().eq('id', userId);
      if(error) throw error;
      showMessage(`Rejected ${email}.`);
      renderSignupRequestsPanel();
    }catch(e){
      console.error(e);
      showMessage('Could not reject: ' + errMsg(e), true);
    }
  });
}

function renderApprovalsPage(){
  renderSignupRequestsPanel();
  reconcile(); // make sure detailResults reflects the latest scans before showing variance
  const relevantLocks = isCircleHeadUser()
    ? storeLocks.filter(l => myAssignedCircles.includes(circleFor(l.store)))
    : storeLocks.slice();
  const pending = relevantLocks.filter(l => l.approvalStatus === 'pending');
  const reviewed = relevantLocks.filter(l => l.approvalStatus !== 'pending')
    .sort((a,b) => new Date(b.approvedAt||0) - new Date(a.approvedAt||0));

  const countEl = document.getElementById('approvalsPageCount');
  if(countEl) countEl.textContent = pending.length;

  const listEl = document.getElementById('approvalsPageList');
  if(listEl){
    listEl.innerHTML = pending.length ? pending.map(l => {
      const sid = sanitizeStoreId(l.store);
      const rows = detailResults.filter(r => r.store === l.store);
      const m = rows.filter(r=>r.status==='match').length;
      const sh = rows.filter(r=>r.status==='short').length;
      const ex = rows.filter(r=>r.status==='excess').length;
      const t = rows.length;
      const pct = t ? (m/t*100) : 100;
      const varianceRows = rows.filter(r => r.status !== 'match');
      const varianceTable = varianceRows.length ? `
        <div class="table-wrap" style="margin-top:10px;">
          <table>
            <thead><tr><th>SKU</th><th>Serial</th><th>Source</th><th>ASN</th><th>Status</th></tr></thead>
            <tbody>${varianceRows.map(r => `<tr><td>${r.sku||'—'}</td><td>${r.systemSerial||r.physicalSerial||'—'}</td><td>${sourceLabelFor(r)}</td><td>${r.asn||'—'}</td><td><span class="badge badge-${r.status}">${r.status.charAt(0).toUpperCase()+r.status.slice(1)}</span></td></tr>`).join('')}</tbody>
          </table>
        </div>` : '<p class="hint" style="margin-top:8px;">No variance — every expected serial was matched.</p>';
      return `<div class="approval-row" style="flex-direction:column;align-items:stretch;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;">
          <div class="approval-row-info">
            <b>${l.store}</b><span>Circle ${circleFor(l.store)} · submitted by ${l.lockedByEmail||'—'} · ${l.lockedAt}</span>
            <span>Match <b>${pct.toFixed(1)}%</b> · Short <b>${sh}</b> · Excess <b>${ex}</b> · Expected ${m+sh}</span>
          </div>
          <div class="approval-row-actions">
            <textarea id="approval-remark-${sid}" placeholder="Optional remark (e.g. reason for rejection) — carries through to the exported report"></textarea>
            <div class="btn-row">
              <button class="btn btn-primary" onclick="submitApproval('${l.store.replace(/'/g,"\\'")}','approved')">Approve</button>
              <button class="btn btn-danger" onclick="submitApproval('${l.store.replace(/'/g,"\\'")}','rejected')">Reject</button>
              <button class="btn" onclick="unlockStore('${l.store.replace(/'/g,"\\'")}')" title="Reopen this store for the auditor to edit">Unlock</button>
            </div>
          </div>
        </div>
        ${varianceTable}
      </div>`;
    }).join('') : '<div class="empty-note">No pending approvals right now.</div>';
  }

  const historyEl = document.getElementById('approvalsPageHistory');
  if(historyEl){
    historyEl.innerHTML = reviewed.length ? reviewed.slice(0, 20).map(l => `
      <div class="missing-base-row">
        <div class="missing-base-row-info"><b>${l.store}</b><span>Circle ${circleFor(l.store)} · ${l.approvedByEmail||'—'} · ${l.approvedAt||'—'}${l.approvalRemark ? ' · "'+l.approvalRemark+'"' : ''}</span></div>
        <span class="badge badge-${l.approvalStatus}">${l.approvalStatus.charAt(0).toUpperCase()+l.approvalStatus.slice(1)}</span>
      </div>`).join('') : '<div class="empty-note">Nothing reviewed yet this cycle.</div>';
  }
}

function renderMyStoresView(){
  const grid = document.getElementById('myStoresGrid');
  const countEl = document.getElementById('myStoresCount');
  if(!grid) return;
  const myStores = myAssignedStores.slice().sort();
  if(countEl) countEl.textContent = myStores.length ? `(${myStores.length})` : '';
  if(!myStores.length){ grid.innerHTML = '<div class="empty-note">No stores assigned yet — contact your admin.</div>'; return; }
  grid.innerHTML = myStores.map(store => {
    const lock = getStoreLock(store);
    let statusBadge, statusNote;
    if(!lock){
      const scans = scanData.filter(r => r.store === store).length;
      statusBadge = '<span class="badge badge-excess">Not submitted</span>';
      statusNote = scans ? `${scans} scanned so far — not yet submitted` : 'Not started yet';
    } else if(lock.approvalStatus === 'rejected'){
      statusBadge = '<span class="badge badge-rejected">Rejected</span>';
      statusNote = lock.approvalRemark ? `Remark: ${lock.approvalRemark}` : 'Rejected — awaiting your admin to unlock for correction';
    } else if(lock.approvalStatus === 'approved'){
      statusBadge = '<span class="badge badge-approved">Approved</span>';
      statusNote = `Submitted ${lock.lockedAt}`;
    } else {
      statusBadge = '<span class="badge badge-pending">Submitted — pending review</span>';
      statusNote = `Submitted ${lock.lockedAt}`;
    }
    let resultLine = '';
    if(auditCompleted && lock){
      const rows = detailResults.filter(r => r.store === store);
      const m = rows.filter(r=>r.status==='match').length;
      const t = rows.length;
      const pct = t ? (m/t*100) : 100;
      resultLine = `<div class="store-tag-stats"><span>Match <b>${pct.toFixed(1)}%</b></span><span>Short <b>${rows.filter(r=>r.status==='short').length}</b></span><span>Excess <b>${rows.filter(r=>r.status==='excess').length}</b></span></div>`;
    }
    return `<div class="store-tag" style="cursor:default;">
      <div class="store-tag-body">
      <p class="store-tag-name">${store} ${statusBadge}</p>
      <p class="store-tag-meta">Circle ${circleFor(store)} · ${statusNote}</p>
      ${resultLine}
      </div></div>`;
  }).join('');
}

function renderScanView(){
  populateStoreSelect();
  updateOfflineBanner();
  const store = document.getElementById('scanStoreSelect').value;
  const isAdmin = currentProfile && currentProfile.role === 'admin';
  const lock = store ? getStoreLock(store) : null;
  const locked = !!lock;

  const baseForStore = baseData.filter(b => b.store === store);
  const scansForStore = scanData.filter(r => r.store === store);
  const queuedForStore = getOfflineQueue().filter(q => q.store_code === store);

  document.getElementById('scanProgress').innerHTML = store ? `
    <span>Expected here: <b>${baseForStore.length}</b></span>
    <span>Scanned here: <b>${scansForStore.length + queuedForStore.length}</b></span>
    <span>Remaining: <b>${Math.max(baseForStore.length - scansForStore.length - queuedForStore.length,0)}</b></span>` : '';

  const lockBanner = document.getElementById('lockBanner');
  if(locked){
    lockBanner.innerHTML = `<div class="lock-banner">
      🔒 <b>${store}</b> was submitted and locked on ${lock.lockedAt}${lock.lockedByEmail ? ' by ' + lock.lockedByEmail : ''}.
      ${isAdmin ? `<button class="btn" style="margin-left:10px;" onclick="unlockStore('${store.replace(/'/g,"\\'")}')">Unlock this store</button>` : 'No further scans, uploads, or deletions are allowed until an admin reopens it.'}
    </div>`;
  } else {
    lockBanner.innerHTML = '';
  }

  const inputsDisabled = store ? (locked && !isAdmin) : true;
  document.getElementById('scanInput').disabled = inputsDisabled;
  document.getElementById('scanAddBtn').disabled = inputsDisabled;
  document.getElementById('scanFileInput').disabled = inputsDisabled;
  const scanZone = document.getElementById('scanUploadZone');
  if(scanZone){ scanZone.style.opacity = inputsDisabled ? '0.5' : '1'; scanZone.style.pointerEvents = inputsDisabled ? 'none' : 'auto'; }

  const completeBtn = document.getElementById('completeAuditBtn');
  if(completeBtn){
    completeBtn.textContent = locked ? 'Store already submitted' : 'Submit & lock this store\u2019s audit';
    completeBtn.disabled = !store || locked;
  }

  const tbody = document.getElementById('scanTableBody');
  const queuedRows = queuedForStore.map(q => ({ serial: q.serial_no, sku: q.sku, ts: new Date(q._queuedAt).toLocaleString(), pending: true }));
  const allRows = [...queuedRows, ...scansForStore.slice().reverse()];
  if(!allRows.length){ tbody.innerHTML = '<tr><td colspan="4" class="empty-note">No serials scanned for this store yet.</td></tr>'; return; }
  const canDeleteAny = isAdmin;
  tbody.innerHTML = allRows.map(r => {
    if(r.pending){
      return `<tr style="opacity:0.7;"><td>${r.serial}</td><td>${r.sku||'—'}</td><td>${r.ts}</td><td><span class="badge badge-open" title="Saved on this device, will sync when back online">Pending sync</span></td></tr>`;
    }
    const isMine = currentUser && r.scannedBy === currentUser.id;
    const canDelete = (canDeleteAny || isMine) && !(locked && !isAdmin);
    const delIcon = canDelete ? `<span style="color:var(--text-faint);cursor:pointer;" onclick="removeScan('${r.id}')">✕</span>` : '<span style="color:var(--text-faint);">—</span>';
    return `<tr><td>${r.serial}</td><td>${r.sku||'—'}</td><td>${r.ts}</td><td>${delIcon}</td></tr>`;
  }).join('');
}

async function unlockStore(store){
  confirmAction('unlock-'+store, `This reopens ${store} for editing`, async () => {
    try{
      const { error } = await sb.from('store_locks').delete().eq('cycle_id', currentCycleId).eq('store_code', store);
      if(error) throw error;
      await fetchCycleData();
      showMessage(`${store} has been unlocked.`);
      renderScanView();
      renderDashboard();
      renderApprovalsPage();
      refreshMissingBaseDataNotice();
    }catch(e){
      console.error(e);
      showMessage('Could not unlock store: ' + errMsg(e), true);
    }
  });
}

// A circle head (or admin) approves/rejects a submitted store with an
// optional remark. This is a review layer only — it never blocks the
// submitted scan data from counting in the numbers, and an admin can always
// see/override the same status regardless of what a circle head decided.
async function submitApproval(store, status){
  const sid = sanitizeStoreId(store);
  const remarkEl = document.getElementById('approval-remark-'+sid);
  const remark = remarkEl ? remarkEl.value.trim() : '';
  const baseUpdate = {
    approval_status: status,
    approved_by: currentUser ? currentUser.id : null,
    approved_by_email: currentUser ? currentUser.email : null,
    approved_at: new Date().toISOString(),
    approval_remark: remark || null
  };
  try{
    let { error } = await sb.from('store_locks').update({
      ...baseUpdate,
      approved_by_name: currentUser ? displayNameFor(currentUser.email, currentProfile && currentProfile.full_name) : null
    }).eq('cycle_id', currentCycleId).eq('store_code', store);
    // approved_by_name only exists after supabase/add_approver_name_to_locks.sql
    // has been run — if it hasn't yet, don't let a missing reporting column
    // block the actual approval; fall back to saving without it (the report
    // just won't have a name for this one until the migration runs).
    if(error && /approved_by_name/i.test(error.message || '')){
      ({ error } = await sb.from('store_locks').update(baseUpdate).eq('cycle_id', currentCycleId).eq('store_code', store));
    }
    if(error) throw error;
    await fetchCycleData();
    showMessage(`${store} marked ${status}.`);
    renderApprovalsPage();
    refreshMissingBaseDataNotice();
    const activeView = document.querySelector('.panel-view.active');
    if(activeView && activeView.id === 'view-dashboard') renderDashboard();
  }catch(e){
    console.error(e);
    showMessage('Could not save approval: ' + errMsg(e), true);
  }
}

function submitCurrentStore(){
  if(!requireCycle()) return;
  const store = document.getElementById('scanStoreSelect').value;
  if(!store){ showMessage('Select a store first.', true); return; }
  if(getStoreLock(store)){ showMessage(`${store} is already submitted and locked.`, true); return; }
  confirmAction('user-complete', `This locks ${store} — no further edits until an admin or circle head reopens it`, async () => {
    try{
      const { error } = await sb.from('store_locks').insert({
        cycle_id: currentCycleId, store_code: store, locked_by: currentUser.id, locked_by_email: currentUser.email
      });
      if(error) throw error;
      await fetchCycleData();
      showMessage(`${store} submitted and locked. Its circle head will review it next.`);
      renderScanView();
      refreshMissingBaseDataNotice();
    }catch(e){
      console.error(e);
      showMessage('Could not submit this store: ' + errMsg(e), true);
    }
  });
}

function reconcile(){
  detailResults = [];
  // A store counts as "audited" three ways: it has actual scans, it has been
  // submitted & locked (even with nothing scanned — a genuine zero-stock store),
  // or the base upload declared it with 0 system serials (store present, blank serial).
  const scannedStores = [...new Set(scanData.map(r=>r.store))].filter(Boolean);
  const lockedStores = [...new Set(storeLocks.map(l=>l.store))].filter(Boolean);
  const zeroStockStores = [...new Set(baseData.filter(r => r.store && !r.serial).map(r=>r.store))];
  const auditedStores = [...new Set([...scannedStores, ...lockedStores, ...zeroStockStores])].sort();
  reconciledStores = auditedStores;
  auditedStores.forEach(store => {
    const baseRows = baseData.filter(r => r.store === store && r.serial); // real serials only — blank-serial rows just flag a zero-stock store, not an actual unit
    const scanRows = scanData.filter(r => r.store === store);
    const scanSerials = new Set(scanRows.map(r => normalizeSerial(r.serial)));
    const baseSerials = new Set(baseRows.map(r => normalizeSerial(r.serial)));
    baseRows.forEach(r => {
      const matched = scanSerials.has(normalizeSerial(r.serial));
      // source: which upload this "expected" serial came from — Inventory
      // (already inward) or GRN pending (physically present, pending inward).
      // Scans are compared against inventory + GRN combined either way; this
      // just tags the result so the export/dashboard can break it back out.
      detailResults.push({store, sku:r.sku, systemSerial:r.serial, physicalSerial: matched ? r.serial : '', status: matched ? 'match' : 'short', source: r.sourceType === 'grn' ? 'grn' : 'inventory', asn: r.sourceType === 'grn' ? (r.asnNo || '') : ''});
    });
    scanRows.forEach(r => {
      if(!baseSerials.has(normalizeSerial(r.serial))) detailResults.push({store, sku:r.sku, systemSerial:'', physicalSerial:r.serial, status:'excess', source:'', asn:''});
    });
  });
}

// Circle-level rollup card — shared by both the admin's drilled-in
// territory view and a circle head's own Circle Summary, so the two never
// drift out of sync on what a "circle card" actually shows.
// Same color logic the store-card stamps use (zero/critical/variance/match),
// applied to a circle/circle-head rollup card: not-started stores stay blue
// (informational, not a failure), any short units read red (critical), any
// excess-only/partial variance reads amber, and a clean full match reads green.
function rollupStatusClass(auditedCount, shortCount, excessCount, totalRows){
  if(auditedCount === 0) return 'circle-rollup-card-notstarted';
  if(shortCount > 0) return 'circle-rollup-card-critical';
  if(excessCount > 0 || (totalRows > 0 && shortCount + excessCount > 0)) return 'circle-rollup-card-variance';
  return 'circle-rollup-card-match';
}

function renderCircleCards(circles){
  const cards = circles.slice().sort().map(circle => {
    const circleAllStores = Object.keys(STORE_MASTER).filter(s => circleFor(s) === circle);
    const circleAuditedStores = reconciledStores.filter(s => circleFor(s) === circle);
    const rows = circleAuditedStores.flatMap(s => detailResults.filter(r => r.store === s));
    const m = rows.filter(r=>r.status==='match').length;
    const sh = rows.filter(r=>r.status==='short').length;
    const ex = rows.filter(r=>r.status==='excess').length;
    const pct = (m+sh+ex) ? (m/(m+sh+ex)*100) : 100;
    const selected = dashboardCircleFilter === circle;
    const statsLine = circleAuditedStores.length === 0
      ? `<span class="circle-rollup-not-started">Not submitted / Not audited yet</span>`
      : `<span>Match <b>${pct.toFixed(1)}%</b></span><span>Short <b>${sh}</b></span><span>Excess <b>${ex}</b></span>`;
    const statusCls = rollupStatusClass(circleAuditedStores.length, sh, ex, m+sh+ex);
    return `<div class="circle-rollup-card ${statusCls}${selected?' circle-rollup-card-selected':''}" onclick="setDashboardCircleFilter('${selected?'':circle}');document.getElementById('storeGridSection').scrollIntoView({behavior:'smooth'});">
      <div class="circle-rollup-name">${circle}</div>
      <div class="circle-rollup-meta">${circleAuditedStores.length}/${circleAllStores.length} stores audited</div>
      <div class="circle-rollup-stats">${statsLine}</div>
    </div>`;
  }).join('');
  return cards || '<div class="empty-note">No circles to show.</div>';
}

// Admin-only: one card per Circle Head, aggregated across every circle
// they're assigned to — plus an "Unassigned" card for any circle with no
// circle head at all, so nothing silently disappears from view. Clicking a
// card drills into that person's full territory via renderCircleCards above.
function renderCircleHeadCards(){
  if(!circleHeadsCache || !circleHeadsCache.length){
    const allCircles = [...new Set(Object.values(STORE_MASTER))];
    return `<div class="empty-note">No Circle Heads set up yet — assign the role and circles from Users &amp; Stores. Showing ${allCircles.length} unassigned circle${allCircles.length===1?'':'s'}.</div>` +
      `<div class="circle-rollup-card circle-rollup-card-notstarted" onclick='viewCircleHeadTerritory(null, "Unassigned circles", ${JSON.stringify(allCircles)})'>
        <div class="circle-rollup-name">Unassigned</div>
        <div class="circle-rollup-meta">${allCircles.length} circle${allCircles.length===1?'':'s'} · no Circle Head yet</div>
      </div>`;
  }
  const assignedCircles = new Set(circleHeadsCache.flatMap(h => h.circles));
  const unassigned = [...new Set(Object.values(STORE_MASTER))].filter(c => !assignedCircles.has(c));
  const headCards = circleHeadsCache.map(head => {
    if(!head.circles.length) return '';
    const headStores = Object.keys(STORE_MASTER).filter(s => head.circles.includes(circleFor(s)));
    const headAudited = reconciledStores.filter(s => head.circles.includes(circleFor(s)));
    const rows = headAudited.flatMap(s => detailResults.filter(r => r.store === s));
    const m = rows.filter(r=>r.status==='match').length;
    const sh = rows.filter(r=>r.status==='short').length;
    const ex = rows.filter(r=>r.status==='excess').length;
    const pct = (m+sh+ex) ? (m/(m+sh+ex)*100) : 100;
    // 0 audited stores is "hasn't started/submitted yet" — a very different
    // situation from "100% match", which is what m/sh/ex all being 0 reads
    // as. Say so plainly instead of implying everything's fine.
    const statsLine = headAudited.length === 0
      ? `<span class="circle-rollup-not-started">Not submitted / Not audited yet</span>`
      : `<span>Match <b>${pct.toFixed(1)}%</b></span><span>Short <b>${sh}</b></span><span>Excess <b>${ex}</b></span>`;
    const statusCls = rollupStatusClass(headAudited.length, sh, ex, m+sh+ex);
    return `<div class="circle-rollup-card ${statusCls}" onclick='viewCircleHeadTerritory("${head.id}", ${JSON.stringify(head.name)}, ${JSON.stringify(head.circles)})'>
      <div class="circle-rollup-name">${head.name}</div>
      <div class="circle-rollup-meta">${head.circles.join(', ')} · ${headAudited.length}/${headStores.length} stores audited</div>
      <div class="circle-rollup-stats">${statsLine}</div>
    </div>`;
  }).join('');
  const unassignedCard = unassigned.length ? `<div class="circle-rollup-card circle-rollup-card-notstarted" onclick='viewCircleHeadTerritory(null, "Unassigned circles", ${JSON.stringify(unassigned)})'>
      <div class="circle-rollup-name">Unassigned</div>
      <div class="circle-rollup-meta">${unassigned.join(', ')} · no Circle Head yet</div>
    </div>` : '';
  return (headCards + unassignedCard) || '<div class="empty-note">No circle heads or circles to show.</div>';
}

function viewCircleHeadTerritory(id, name, circles){
  adminViewingCircleHead = { id, name, circles };
  dashboardCircleFilter = null;
  renderDashboard();
  document.getElementById('circleRollupCard').scrollIntoView({behavior:'smooth'});
}
function clearCircleHeadDrill(){
  adminViewingCircleHead = null;
  renderDashboard();
}

async function loadCircleHeadsForAdmin(){
  try{
    const [{ data: heads, error: e1 }, { data: assignments, error: e2 }] = await Promise.all([
      sb.from('profiles').select('id,email,full_name').eq('role','circle_head').eq('approved', true),
      sb.from('user_circles').select('*')
    ]);
    if(e1) throw e1; if(e2) throw e2;
    circleHeadsCache = (heads || []).map(h => ({
      id: h.id,
      name: displayNameFor(h.email, h.full_name),
      circles: (assignments || []).filter(a => a.user_id === h.id).map(a => a.circle)
    }));
  }catch(e){
    console.error('Could not load circle heads', e);
    circleHeadsCache = [];
  }
  // Whichever page asked for this (dashboard's Circle Head Summary, or the
  // Audit Report's Circle Head filter) re-renders once the data is in.
  const activeView = document.querySelector('.panel-view.active');
  if(activeView && activeView.id === 'view-dashboard') renderDashboard();
  if(activeView && activeView.id === 'view-auditreport') renderAuditReportPage();
}

// Which stores the current viewer is scoped to before any manual filter —
// a circle head's own circles, or (for an admin) the Circle Head territory
// they've drilled into from the Circle Head Summary card. null = no
// restriction (full admin/client view). Shared by renderDashboard (so every
// KPI/table on screen agrees) and downloadExcel (so the "Download Excel
// report" button never leaks another circle head's data).
function currentRoleScopedStores(){
  if(isCircleHeadUser()) return new Set(Object.keys(STORE_MASTER).filter(s => myAssignedCircles.includes(circleFor(s))));
  if(isAppAdmin() && adminViewingCircleHead) return new Set(Object.keys(STORE_MASTER).filter(s => adminViewingCircleHead.circles.includes(circleFor(s))));
  return null;
}

function renderDashboard(){
  reconcile(); // always show live results — "completed" only locks the cycle, it doesn't gate visibility

  // "Pending"/"submitted" counts come from store_locks, not scanData — store_locks
  // stays readable regardless of cycle completion status (RLS), while scans/base_serials
  // for an incomplete cycle read back empty for a client by design. Computing this first
  // means every "how many stores so far" message below is accurate for every role.
  const lockedStoreCodes = new Set(storeLocks.map(l => l.store));
  const pendingStoresEarly = Object.keys(STORE_MASTER).filter(s => !lockedStoreCodes.has(s));

  const auditedCount = isClientUser() ? lockedStoreCodes.size : [...new Set(scanData.map(r=>r.store))].filter(Boolean).length;
  const greetTitleEl = document.getElementById('greetTitle');
  const greetSub = document.getElementById('greetSub');
  if(isAppAdmin() && adminViewingCircleHead){
    // Make the drill-in read as a genuinely different page, not just a
    // scroll position on the same one — title, subtitle, and every number
    // below all change together.
    if(greetTitleEl) greetTitleEl.textContent = `📍 ${adminViewingCircleHead.name}'s Territory`;
    if(greetSub) greetSub.textContent = `${adminViewingCircleHead.circles.join(', ')} — viewing this Circle Head's stores only.`;
    const backBanner = document.getElementById('territoryBackBanner');
    if(backBanner) backBanner.innerHTML = `<button class="btn btn-primary" style="margin-bottom:16px;" onclick="clearCircleHeadDrill()">← Back to full Overview</button>`;
  } else {
    if(greetTitleEl) greetTitleEl.textContent = `${greetingWord()}, ${displayNameFor(currentUser.email, currentProfile.full_name)} \ud83d\udc4b`;
    const backBanner = document.getElementById('territoryBackBanner');
    if(backBanner) backBanner.innerHTML = '';
    if(greetSub){
      if(!currentCycleId){
        greetSub.textContent = "Load or create an audit cycle to get started.";
      } else if(!auditCompleted){
        greetSub.textContent = `Live — ${auditedCount} store${auditedCount===1?'':'s'} submitted so far. Updates instantly as auditors submit.`;
      } else {
        greetSub.textContent = `Audit "${document.getElementById('cycleName').value || 'Untitled cycle'}" completed — final results for ${auditedCount} store${auditedCount===1?'':'s'}.`;
      }
    }
  }

  const totalBaseStores = [...new Set(baseData.map(r=>r.store))].filter(Boolean);
  const auditedStores = [...new Set(scanData.map(r=>r.store))].filter(Boolean);
  const storesRecorded = auditedStores.length;

  // Base role/drill scope — which stores this view is even allowed to
  // consider, before any manual filter narrows it further. null = no
  // restriction. This is what makes an admin's drill into one Circle
  // Head's territory (or a circle head's own view) actually change every
  // number on the page, not just the store-card grid below.
  let roleScopedStores = currentRoleScopedStores();

  // "Pending" is measured against the full store master list minus whatever's
  // actually been locked/submitted — not against which stores happen to have
  // base data uploaded, since a store can be legitimately audited (locked)
  // with zero expected/scanned items.
  const pendingStores = roleScopedStores ? pendingStoresEarly.filter(s => roleScopedStores.has(s)) : pendingStoresEarly;
  const storesPending = pendingStores.length;

  // Everything below (hero cards, health donut, live activity) scopes to the
  // role/drill scope above, further narrowed by dashboardStoreFilter or
  // dashboardCircleFilter when one is set — via a store-card click, the
  // circle dropdown, the Filters dropdown, or a store match in the topbar search.
  const manualScopeStores = dashboardStoreFilter ? [dashboardStoreFilter]
    : dashboardCircleFilter ? Object.keys(STORE_MASTER).filter(s => circleFor(s) === dashboardCircleFilter)
    : null;
  const effectiveScope = manualScopeStores
    ? (roleScopedStores ? manualScopeStores.filter(s => roleScopedStores.has(s)) : manualScopeStores)
    : (roleScopedStores ? [...roleScopedStores] : null);
  const scopedResults = effectiveScope ? detailResults.filter(r => effectiveScope.includes(r.store)) : detailResults;
  const scopedScans = effectiveScope ? scanData.filter(r => effectiveScope.includes(r.store)) : scanData;
  const totalScanned = scopedScans.length;

  const total = scopedResults.length;
  const match = scopedResults.filter(r=>r.status==='match').length;
  const short = scopedResults.filter(r=>r.status==='short').length;
  const excess = scopedResults.filter(r=>r.status==='excess').length;
  const matchPct = total ? ((match/total)*100) : 0;
  const totalVariance = short + excess;

  const scopeChip = document.getElementById('dashboardScopeChip');
  if(scopeChip){
    scopeChip.innerHTML = dashboardStoreFilter
      ? `<span class="scope-chip">Viewing <b>${dashboardStoreFilter}</b> <span class="clear-filter" onclick="setDashboardStoreFilter(null)">✕ clear</span></span>`
      : '';
  }

  // ---- Sidebar audit-progress widget ----
  // Based on assignments + locks, NOT on whether base data/scans exist for
  // a store — so a newly-assigned store or a genuine zero-stock store
  // (locked with nothing to scan) is counted correctly either way.
  const isAdminUser = currentProfile && currentProfile.role === 'admin';
  // myAssignedStores is only ever populated for an auditor ('user') login —
  // a circle head has no per-store assignment list, just circles, so that
  // branch used to silently fall through to an empty array (permanent
  // "0 / 0 stores completed"). roleScopedStores (computed above) already
  // holds exactly the right store set for a circle head — their own
  // circle(s), or an admin's drilled-in Circle Head territory.
  const progressScopeStores = isAdminUser
    ? [...new Set([...allStoreAssignments.map(a=>normalizeStoreCode(a.store_code)), ...totalBaseStores])]
    : roleScopedStores ? [...roleScopedStores]
    : myAssignedStores.slice();
  const progressCompletedStores = progressScopeStores.filter(s => storeLocks.some(l => l.store === s));
  const progressPct = progressScopeStores.length ? Math.round((progressCompletedStores.length/progressScopeStores.length)*100) : 0;
  const spPct = document.getElementById('sidebarProgressPct'); if(spPct) spPct.textContent = progressPct + '%';
  const spFill = document.getElementById('sidebarProgressFill'); if(spFill) spFill.style.width = progressPct + '%';
  const spSub = document.getElementById('sidebarProgressSub'); if(spSub) spSub.textContent = `${progressCompletedStores.length} / ${progressScopeStores.length} stores completed`;

  // ---- Topbar notification badge (real count: stores still pending audit) ----
  const bellBadge = document.getElementById('topbarBellBadge');
  if(bellBadge){
    if(storesPending > 0){ bellBadge.style.display = 'flex'; bellBadge.textContent = storesPending > 99 ? '99+' : storesPending; }
    else{ bellBadge.style.display = 'none'; }
  }

  // ---- Per-store stats (used by hero sparklines, store filter, and the detail table's Match rate / Last scanned columns) ----
  // Pull from reconciledStores (not just detailResults) so a locked or declared
  // zero-stock store — one with nothing to match, nothing short, nothing excess —
  // still shows up here instead of silently vanishing from the dashboard.
  let stores = reconciledStores.slice();
  // A circle head only ever sees their own circle's stores on this page —
  // RLS already stops their base_serials/scans reads at the DB level, this
  // just keeps the store list/cards in sync with that on the client too.
  if(isCircleHeadUser()) stores = stores.filter(s => myAssignedCircles.includes(circleFor(s)));
  // Admin drilled into one Circle Head's territory from the summary card —
  // scope everything below (KPIs, store grid, detail table) to just their circles too.
  if(isAppAdmin() && adminViewingCircleHead) stores = stores.filter(s => adminViewingCircleHead.circles.includes(circleFor(s)));
  // A client viewing a still-live (not yet completed) cycle gets nothing
  // back for base_serials/scans by RLS design — full match/short/excess
  // detail is reserved for completed cycles. This flag just drives a
  // friendlier "cycle in progress" message instead of a blank dashboard.
  const clientLiveGate = isClientUser() && !auditCompleted;
  // Worst-variance-first so problem stores surface immediately, not buried alphabetically
  stores.sort((a,b) => {
    const va = detailResults.filter(r=>r.store===a && r.status!=='match').length;
    const vb = detailResults.filter(r=>r.store===b && r.status!=='match').length;
    return vb - va || a.localeCompare(b);
  });
  const storeStats = {};
  stores.forEach(store => {
    const rows = detailResults.filter(r=>r.store===store);
    const m = rows.filter(r=>r.status==='match').length;
    const sh = rows.filter(r=>r.status==='short').length;
    const ex = rows.filter(r=>r.status==='excess').length;
    const t = rows.length;
    // Break the expected side back out by where it came from — Inventory
    // (already inward) vs GRN pending (physically present, pending inward).
    const grnRows = rows.filter(r => r.source === 'grn');
    const grnExpected = grnRows.length;
    const grnMatched = grnRows.filter(r => r.status === 'match').length;
    const invExpected = t - grnExpected;
    const invMatched = m - grnMatched;
    const storeScans = scanData.filter(r=>r.store===store);
    const lastTs = storeScans.reduce((latest,r) => (!latest || (r.rawTs && r.rawTs > latest)) ? (r.rawTs||latest) : latest, null);
    // 0 expected + 0 found is a fully-reconciled zero-stock store, not a 0% failure — treat it as 100%.
    storeStats[store] = { m, sh, ex, t, grnExpected, grnMatched, invExpected, invMatched, pct: t ? (m/t*100) : 100, lastTs, lastLabel: lastTs ? fmtRelativeTime(lastTs) : '—' };
  });

  // ---- Hero stat cards (Match Rate / Stock Scanned / Audit Pending / Total Variance), each with a real-data sparkline ----
  const matchTrend = stores.map(s => Math.round(storeStats[s].pct));
  const scanTrend = stores.map(s => storeStats[s].t);
  const pendingTrend = pendingStores.map(() => 1);
  const varianceTrend = stores.map(s => storeStats[s].sh + storeStats[s].ex);

  const cGreen = themeColor('--green'), cBlue = themeColor('--blue'), cAmber = themeColor('--amber'), cRed = themeColor('--red');

  const kpiCards = [
    { cls:'k-match', label:'Match Rate', value: matchPct.toFixed(1)+'%', sub:`${match} of ${total} matched`,
      trend: total ? (matchPct>=95?'up':matchPct>=80?'flat':'down') : 'flat', trendLabel: total ? matchPct.toFixed(1)+'%' : '—',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
      spark: sparklineLineSVG(matchTrend.length ? matchTrend : [0,0], cGreen) },
    { cls:'k-total', label:'Stock Scanned', value: totalScanned, sub:'Physical count',
      trend:'flat', trendLabel: totalScanned+' units',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>',
      spark: sparklineBarsSVG(scanTrend, cBlue, false) },
    { cls:'k-pending', label:'Audit Pending', value: storesPending, sub:'Stores', trend:'flat', trendLabel: storesPending===0?'All done':storesPending+' left',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
      spark: sparklineBarsSVG(pendingTrend, cAmber, true) },
    { cls:'k-variance', label:'Total Variance', value: totalVariance, sub:'Short + Excess', trend: totalVariance>0?'down':'flat', trendLabel: `${short} short · ${excess} excess`,
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v6"/><path d="m8 7 4-4 4 4"/><path d="M4 21h16"/><path d="M4 21v-6h16v6"/></svg>',
      spark: sparklineBarsSVG(varianceTrend, cRed, true) }
  ];
  const kpiCardsFinal = clientLiveGate
    ? [{ cls:'k-pending', label:'Audit Progress', value: `${lockedStoreCodes.size}/${Object.keys(STORE_MASTER).length}`, sub:'Stores submitted so far',
        trend:'flat', trendLabel: 'Live cycle — detail on completion',
        icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
        spark: sparklineBarsSVG(pendingTrend, cAmber, true) }]
    : kpiCards;
  document.getElementById('kpiStrip').innerHTML = kpiCardsFinal.map(k => `
    <div class="kpi ${k.cls}"${k.cls==='k-pending' ? ' onclick="showPendingStoresPanel()" style="cursor:pointer;" title="Click to see which stores are pending"' : ''}>
      <div class="kpi-top"><span class="kpi-icon">${k.icon}</span><span class="kpi-trend ${k.trend}">${k.trend==='up'?'\u2191':k.trend==='down'?'\u2193':'\u2192'} ${k.trendLabel}</span></div>
      <p class="kpi-value">${k.value}</p>
      <p class="kpi-label">${k.label}</p>
      <p class="kpi-sub">${k.sub}</p>
      <div class="kpi-spark">${k.spark}</div>
    </div>`).join('');

  // ---- Store result cards ----
  // Circle filter scopes only this card grid — KPIs, the detail table, and
  // storeStats itself stay computed across every reconciled store so a circle
  // filter here never silently changes numbers shown elsewhere on the page.
  const circleSelect = document.getElementById('storeCircleFilterSelect');
  if(circleSelect){
    const circles = [...new Set(Object.values(STORE_MASTER))].sort();
    circleSelect.innerHTML = '<option value="">All circles</option>' + circles.map(c => `<option value="${c}"${dashboardCircleFilter===c?' selected':''}>${c}</option>`).join('');
  }
  const visibleStoreCards = dashboardCircleFilter ? stores.filter(s => circleFor(s) === dashboardCircleFilter) : stores;
  document.getElementById('storeGrid').innerHTML = visibleStoreCards.length ? visibleStoreCards.map(store => {
    const {m, sh, ex, t, pct, grnExpected, grnMatched} = storeStats[store];
    let stamp = t===0 ? '<span class="stamp stamp-zero">Zero stock</span>'
      : sh>0 ? '<span class="stamp stamp-critical">Missing units</span>'
      : (ex>0 || m<t ? '<span class="stamp stamp-variance">Variance</span>' : '<span class="stamp stamp-match">Matched</span>');
    const isFiltered = dashboardStoreFilter === store;
    const grnNote = grnExpected ? ` · GRN pending ${grnMatched}/${grnExpected}` : '';
    const lock = getStoreLock(store);
    const approvalBadge = lock ? `<span class="badge badge-${lock.approvalStatus}" title="${lock.approvalRemark ? 'Remark: '+lock.approvalRemark : ''}">${lock.approvalStatus.charAt(0).toUpperCase()+lock.approvalStatus.slice(1)}</span>` : '';
    return `<div class="store-tag${isFiltered?' store-tag-selected':''}" onclick="setDashboardStoreFilter('${store.replace(/'/g,"\\'")}')" title="Click to filter the detail table below to this store">
      <span class="store-download" onclick="event.stopPropagation();downloadStoreExcel('${store.replace(/'/g,"\\'")}')" title="Download this store's report">↓ Export</span>
      <div class="store-tag-body">
      <p class="store-tag-name">${store} ${approvalBadge}</p>
      <p class="store-tag-meta">Circle ${circleFor(store)} · Expected ${t-ex} · Found ${t-sh}${grnNote}</p>
      <div class="store-tag-stats"><span>Match <b>${pct.toFixed(2)}%</b></span><span>Short <b>${sh}</b></span><span>Excess <b>${ex}</b></span></div>
      ${stamp}</div></div>`;
  }).join('') : `<div class="empty-note">${clientLiveGate ? `Cycle in progress — ${lockedStoreCodes.size} of ${Object.keys(STORE_MASTER).length} stores submitted so far. Full results appear here once the cycle is marked complete.` : dashboardCircleFilter ? `No audited stores in ${dashboardCircleFilter} yet.` : 'No stores scanned yet — complete at least one store in Scan / Upload to see results here.'}</div>`;

  // ---- Circle Summary / Circle Head Summary rollup ----
  // Admin sees cards grouped by the PERSON managing a circle (Circle Head
  // Summary) — clicking drills into that person's whole territory, which can
  // span several circles. A circle head sees their own circles directly
  // (Circle Summary), same as before, each still clickable down to the
  // store-card grid below. Either way this stays out of the client's view —
  // it's an operational tool, not something a client needs.
  const rollupEl = document.getElementById('circleRollupGrid');
  const rollupTitleEl = document.getElementById('circleRollupTitle');
  const drillBannerEl = document.getElementById('circleDrillBanner');
  if(rollupEl){
    if(clientLiveGate){
      rollupEl.innerHTML = `<div class="empty-note">Circle-level detail appears once this cycle is marked complete.</div>`;
    } else if(isAppAdmin() && !adminViewingCircleHead){
      if(rollupTitleEl) rollupTitleEl.textContent = 'Circle Head Summary';
      if(drillBannerEl) drillBannerEl.innerHTML = '';
      if(circleHeadsCache === null){
        rollupEl.innerHTML = '<div class="empty-note">Loading circle heads…</div>';
        loadCircleHeadsForAdmin();
      } else {
        rollupEl.innerHTML = renderCircleHeadCards();
      }
    } else if(isAppAdmin() && adminViewingCircleHead){
      if(rollupTitleEl) rollupTitleEl.textContent = `${adminViewingCircleHead.name}'s Territory`;
      if(drillBannerEl) drillBannerEl.innerHTML = `<button class="btn" style="margin-bottom:14px;" onclick="clearCircleHeadDrill()">← Back to Circle Head Summary</button>`;
      rollupEl.innerHTML = renderCircleCards(adminViewingCircleHead.circles);
    } else if(isCircleHeadUser()){
      if(rollupTitleEl) rollupTitleEl.textContent = 'Circle Summary';
      if(drillBannerEl) drillBannerEl.innerHTML = '';
      rollupEl.innerHTML = renderCircleCards(myAssignedCircles);
    }
  }

  // ---- Stores Pending Audit panel ----
  // Every master-list store not yet locked/submitted — the flip side of the
  // "Audit Pending" KPI count, so an admin can see exactly *which* stores,
  // not just how many. Respects the same circle filter as the card grid above.
  const filteredPendingStores = dashboardCircleFilter ? pendingStores.filter(s => circleFor(s) === dashboardCircleFilter) : pendingStores;
  const pendingCountEl = document.getElementById('pendingStoresCount');
  if(pendingCountEl) pendingCountEl.textContent = pendingStores.length;
  const pendingSubEl = document.getElementById('pendingStoresSub');
  if(pendingSubEl) pendingSubEl.textContent = dashboardCircleFilter ? `(${filteredPendingStores.length} of ${pendingStores.length} shown — filtered to ${dashboardCircleFilter})` : `(${pendingStores.length} store${pendingStores.length===1?'':'s'})`;
  const pendingGridEl = document.getElementById('pendingStoresGrid');
  if(pendingGridEl){
    pendingGridEl.innerHTML = filteredPendingStores.length
      ? filteredPendingStores.slice().sort((a,b) => circleFor(a).localeCompare(circleFor(b)) || a.localeCompare(b))
          .map(s => `<span class="pending-store-chip" title="Not yet submitted for this cycle"><b>${s}</b><span class="pending-store-chip-circle">${circleFor(s)}</span></span>`).join('')
      : `<div class="empty-note">${dashboardCircleFilter ? `No pending stores in ${dashboardCircleFilter}.` : 'No stores pending — every store has been submitted for this cycle.'}</div>`;
  }

  // ---- Store filter dropdown (mirrors the store-card click filter) ----
  const filterSelect = document.getElementById('detailStoreFilterSelect');
  if(filterSelect){
    filterSelect.innerHTML = '<option value="">Filters: all stores</option>' + stores.map(s => `<option value="${s}"${dashboardStoreFilter===s?' selected':''}>${s}</option>`).join('');
  }

  // scopedResults already carries the role/drill scope AND the store/circle
  // filters (computed above as effectiveScope) — using it here (instead of
  // raw detailResults) is what keeps this table in sync with an admin's
  // Circle Head drill-in instead of always showing every circle's rows.
  const filteredDetail = scopedResults;
  const searchTerm = (document.getElementById('detailSearch') ? document.getElementById('detailSearch').value : '').trim().toLowerCase();
  const searchedDetail = searchTerm ? filteredDetail.filter(r =>
    (r.physicalSerial||'').toLowerCase().includes(searchTerm) ||
    (r.systemSerial||'').toLowerCase().includes(searchTerm) ||
    (r.sku||'').toLowerCase().includes(searchTerm) ||
    (r.store||'').toLowerCase().includes(searchTerm)
  ) : filteredDetail;

  const filterBar = document.getElementById('detailFilterBar');
  if(filterBar){
    filterBar.innerHTML = dashboardStoreFilter
      ? `Filtered to <b>${dashboardStoreFilter}</b> <span class="clear-filter" onclick="setDashboardStoreFilter(null)">✕ clear</span>`
      : 'Showing all stores';
  }

  const rateColor = (pct) => pct>=95 ? 'var(--green)' : pct>=80 ? 'var(--amber)' : 'var(--red)';
  const detailBody = document.getElementById('detailTableBody');
  detailBody.innerHTML = searchedDetail.length ? searchedDetail.map(r => {
    const st = storeStats[r.store] || {pct:0, lastLabel:'—'};
    const sourceLabel = r.source === 'grn' ? 'GRN Pending' : r.source === 'inventory' ? 'Inventory' : '—';
    return `<tr><td>${r.store}</td><td>${circleFor(r.store)}</td><td>${r.sku||'—'}</td><td>${r.physicalSerial||'—'}</td><td>${r.systemSerial||'—'}</td>
    <td>${sourceLabel}</td>
    <td><div class="rate-cell"><div class="rate-track"><div class="rate-fill" style="width:${st.pct.toFixed(0)}%;background:${rateColor(st.pct)};"></div></div><span class="rate-text">${st.pct.toFixed(0)}%</span></div></td>
    <td><span class="badge badge-${r.status}">${r.status.charAt(0).toUpperCase()+r.status.slice(1)}</span></td>
    <td>${st.lastLabel}</td></tr>`;
  }).join('')
    : '<tr><td colspan="9" class="empty-note">No matching records.</td></tr>';

  renderCharts(stores, {match, short, excess, matchPct});
  buildLiveActivity(pendingStores, dashboardStoreFilter, roleScopedStores);
}

function renderCharts(stores, healthTotals){
  const cGreen = themeColor('--green'), cRed = themeColor('--red'), cAmber = themeColor('--amber');
  const cTextDim = themeColor('--text-dim'), cBorder = themeColor('--border-soft'), cPanel = themeColor('--panel');

  const matchData = stores.map(s => detailResults.filter(r=>r.store===s && r.status==='match').length);
  const varianceData = stores.map(s => detailResults.filter(r=>r.store===s && r.status!=='match').length);

  if(storeChartInstance) storeChartInstance.destroy();
  storeChartInstance = new Chart(document.getElementById('storeChart'), {
    type:'bar',
    data:{labels:stores, datasets:[
      {label:'Matched', data:matchData, backgroundColor:cGreen, borderRadius:6, maxBarThickness:26},
      {label:'Variance', data:varianceData, backgroundColor:cRed, borderRadius:6, maxBarThickness:26}
    ]},
    options:{responsive:true, maintainAspectRatio:false,
      onClick:(evt, elements) => {
        if(elements.length){ setDashboardStoreFilter(stores[elements[0].index]); }
      },
      onHover:(evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
      scales:{x:{stacked:true, grid:{display:false}, ticks:{color:cTextDim, font:{size:11}}},
              y:{stacked:true, beginAtZero:true, ticks:{color:cTextDim, font:{size:11}, precision:0}, grid:{color:cBorder}}},
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{footer:() => 'Click a bar to filter the table below'}}
      }}
  });

  const counts = {match: healthTotals.match, short: healthTotals.short, excess: healthTotals.excess};
  const colors = {match:cGreen, short:cRed, excess:cAmber};
  const labels = {match:'Matched', short:'Short', excess:'Excess'};
  const keys = Object.keys(counts);

  if(varianceChartInstance) varianceChartInstance.destroy();
  varianceChartInstance = new Chart(document.getElementById('varianceChart'), {
    type:'doughnut',
    data:{labels:keys.map(k=>labels[k]), datasets:[{data:keys.map(k=>counts[k]), backgroundColor:keys.map(k=>colors[k]), borderColor:cPanel, borderWidth:2}]},
    options:{responsive:true, maintainAspectRatio:false, cutout:'74%', plugins:{legend:{display:false},
      tooltip:{callbacks:{label:(ctx) => {
        const t = keys.reduce((s,k)=>s+counts[k],0) || 1;
        return `${ctx.label}: ${ctx.raw} (${((ctx.raw/t)*100).toFixed(2)}%)`;
      }}}}}
  });

  const centerPct = document.getElementById('healthCenterPct');
  if(centerPct) centerPct.textContent = healthTotals.matchPct.toFixed(0) + '%';

  const total = keys.reduce((s,k)=>s+counts[k],0) || 1;
  document.getElementById('varLegend').innerHTML = keys.map(k => `
    <div class="health-legend-row"><span class="health-legend-dot" style="background:${colors[k]};"></span><span class="health-legend-label">${labels[k]} (${counts[k]})</span><span class="health-legend-count">${((counts[k]/total)*100).toFixed(0)}%</span></div>`).join('');
}

// ---------------- LIVE ACTIVITY FEED (built from real scan / upload / lock / cycle timestamps) ----------------
// roleScopedStores restricts the feed to whatever the viewer is actually
// scoped to — a circle head's own circle(s), or an admin's drilled-in
// Circle Head territory — same store set every other dashboard widget
// already respects. Without this, a circle head was seeing scan/upload/
// lock activity for every store in the whole audit, not just their own.
function buildLiveActivity(pendingStores, scopeStore, roleScopedStores){
  const events = [];

  // Recent scans, most recent per store collapsed isn't necessary — show the latest individual scans.
  scanData.forEach(r => {
    if(!r.rawTs) return;
    events.push({ ts:r.rawTs, type:'scan', store:r.store, title:`Scan added — ${r.store}`, sub:`${r.sku||'Unlisted SKU'} · ${r.serial}` });
  });

  // Excess found per store (derived from current reconciliation), timestamped at that store's last scan.
  const excessByStore = {};
  detailResults.forEach(r => { if(r.status==='excess') excessByStore[r.store] = (excessByStore[r.store]||0)+1; });
  Object.keys(excessByStore).forEach(store => {
    const lastScan = scanData.filter(r=>r.store===store && r.rawTs).sort((a,b)=> (a.rawTs<b.rawTs?1:-1))[0];
    if(lastScan) events.push({ ts:lastScan.rawTs, type:'warn', store, title:`${excessByStore[store]} excess serial${excessByStore[store]===1?'':'s'} found`, sub:store });
  });

  // Base data uploads, grouped per store.
  const uploadGroups = {};
  baseData.forEach(r => {
    if(!r.uploadedAt) return;
    if(!uploadGroups[r.store]) uploadGroups[r.store] = {count:0, latest:r.uploadedAt};
    uploadGroups[r.store].count++;
    if(r.uploadedAt > uploadGroups[r.store].latest) uploadGroups[r.store].latest = r.uploadedAt;
  });
  Object.keys(uploadGroups).forEach(store => {
    events.push({ ts:uploadGroups[store].latest, type:'base', store, title:'Base data uploaded', sub:`${uploadGroups[store].count} serials · ${store}` });
  });

  // Store locks (submissions).
  storeLocks.forEach(l => {
    events.push({ ts:l.lockedAtRaw || l.lockedAt, type:'lock', store:l.store, title:`${l.store} submitted & locked`, sub: l.lockedByEmail || 'by auditor' });
  });

  // Cycle start — a cycle-level event (no single store), so it stays visible even when scoped to one store.
  if(currentCycleCreatedAt){
    events.push({ ts:currentCycleCreatedAt, type:'start', store:null, title:'Audit cycle started', sub: currentCycleName || 'Untitled cycle' });
  }

  const scoped = events.filter(e => {
    if(!e.store) return true; // cycle-level events (e.g. "Audit cycle started") always show
    if(roleScopedStores && !roleScopedStores.has(e.store)) return false;
    if(scopeStore && e.store !== scopeStore) return false;
    return true;
  });
  scoped.sort((a,b) => (a.ts < b.ts ? 1 : -1));
  const top = scoped.slice(0, 8);

  const iconFor = (type) => ({
    scan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V4h3"/><path d="M17 4h4v3"/><path d="M21 17v3h-4"/><path d="M7 20H3v-3"/><path d="M7 9v6"/><path d="M11 9v6"/><path d="M15 9v6"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 17h.01"/></svg>',
    base: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
    start: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4Z"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>'
  }[type] || '');

  const list = document.getElementById('liveActivityList');
  if(!list) return;
  if(!top.length){
    list.innerHTML = '<div class="empty-note" style="padding:8px 0;">No activity yet for this cycle.</div>';
    return;
  }
  list.innerHTML = top.map(e => `
    <div class="activity-row">
      <span class="activity-icon a-${e.type}">${iconFor(e.type)}</span>
      <div class="activity-body">
        <p class="activity-time">${fmtClock(e.ts)}</p>
        <p class="activity-title">${e.title}</p>
        <p class="activity-sub">${e.sub}</p>
      </div>
    </div>`).join('');
}

function sourceLabelFor(r){
  return r.source === 'grn' ? 'GRN Pending' : r.source === 'inventory' ? 'Inventory' : '—';
}

// The community/free build of SheetJS (loaded via CDN here) can't write a
// native Excel "Insert > Table" object with banded-row styling — that's a
// Pro-only feature. What it CAN do is a real AutoFilter range, which gives
// the same sort/filter dropdown arrows on the header row that a Table
// provides; that's what this adds. (Anyone who wants the full banded-table
// look can still select the range in Excel and hit Ctrl+T themselves —
// the filter arrows this sets don't conflict with that.)
function applyAutoFilter(ws, numDataRows, numCols){
  if(!numDataRows) return;
  const lastCol = XLSX.utils.encode_col(numCols - 1);
  ws['!autofilter'] = { ref: `A1:${lastCol}${numDataRows + 1}` };
}

function buildDetailRowsForExcel(rows){
  return rows.map((r,i) => ({
    'Sr. No.': i+1,
    'System scan serial number': r.systemSerial || '',
    'SKU': r.sku || '',
    'Physical scan serial number': r.physicalSerial || '',
    'Source': sourceLabelFor(r),
    'ASN Number': r.asn || '',
    'Match': r.status==='match' ? 'Match' : '',
    'Excess': r.status==='excess' ? 'Excess' : '',
    'Short': r.status==='short' ? 'Short' : ''
  }));
}

// Per-store rollup of expected/matched/short, split by where the "expected"
// serial came from (Inventory already-inward vs GRN pending) as well as the
// combined total — this is what "complete system" expected quantity means.
function storeSourceSummary(store){
  const rows = detailResults.filter(r=>r.store===store);
  const grnRows = rows.filter(r => r.source === 'grn');
  const invExpected = rows.filter(r => r.source === 'inventory').length;
  const invMatched = rows.filter(r => r.source === 'inventory' && r.status==='match').length;
  const invShort = rows.filter(r => r.source === 'inventory' && r.status==='short').length;
  const grnExpected = grnRows.length;
  const grnMatched = grnRows.filter(r => r.status==='match').length;
  const grnShort = grnRows.filter(r => r.status==='short').length;
  const m = rows.filter(r=>r.status==='match').length;
  const sh = rows.filter(r=>r.status==='short').length;
  const ex = rows.filter(r=>r.status==='excess').length;
  return { invExpected, invMatched, invShort, grnExpected, grnMatched, grnShort, m, sh, ex };
}

// The submitted-review side of a store — whatever the circle head (or
// admin) actually wrote when they approved/rejected it, straight from
// store_locks. This is the one place "when was it audited" and "what did
// the reviewer say" live, so both the export and the on-screen Audit
// Report page read it from here rather than re-deriving anything.
//
// profilesById (optional): a {uid: {email, full_name}} lookup. When given
// (the Audit Report page passes one, since it's admin-only and can read
// every profile), reviewedBy is resolved from the reviewer's CURRENT
// profile — the accurate source of truth — instead of the snapshot text
// columns, which are only as good as whatever full_name was set (or
// blank) at the moment they clicked Approve.
function storeApprovalInfo(store, profilesById){
  const lock = storeLocks.find(l => l.store === store);
  if(!lock) return { status:'not submitted', reviewedOn:'', reviewedBy:'', remark:'' };
  let reviewedByFull = '';
  if(profilesById && lock.approvedBy && profilesById[lock.approvedBy]){
    const p = profilesById[lock.approvedBy];
    reviewedByFull = displayNameFor(p.email, p.full_name);
  } else if(lock.approvedByEmail || lock.approvedByName){
    reviewedByFull = displayNameFor(lock.approvedByEmail, lock.approvedByName);
  }
  return {
    status: lock.approvalStatus || 'pending',
    reviewedOn: lock.approvedAtRaw ? new Date(lock.approvedAtRaw).toLocaleDateString() : '',
    reviewedBy: reviewedByFull ? (reviewedByFull.split(' ')[0] || reviewedByFull) : '',
    remark: lock.approvalRemark || ''
  };
}

// Downloadable blank/example files matching exactly the column headers this
// app recognizes — so a new user doesn't have to guess the "right" format
// before their upload is accepted (LocationCode/ItemNo/SerialNo etc. are
// picked up via header aliases, but nothing tells a first-time uploader that).
function downloadBaseTemplate(){
  const rows = [
    ['LocationCode','ItemNo','SerialNo'],
    ['SFXBEGUSARAI','STB-HD200','SN00000001'],
    ['SFXBEGUSARAI','STB-HD200','SN00000002'],
    ['SFXKANPUR','ONT-GX10','SN00000101'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{wch:16},{wch:16},{wch:18}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Base Data');
  const noteRows = [
    ['Column', 'What to put here'],
    ['LocationCode', 'Store code exactly as in the store master (e.g. SFXBEGUSARAI). "Store", "Client" or "Store Name" also work as the column name.'],
    ['ItemNo', 'SKU / item code. Optional — leave blank if you don\'t track it, matching only needs the serial.'],
    ['SerialNo', 'The unit serial to reconcile against physical scans. "Serial Number", "ItemSerialNo" or "IMEI" also work as column names.'],
    ['', ''],
    ['Uploading GRN Pending stock?', 'Same format — this app also recognizes GRN/ASN report headers directly: "Client" for store, "ItemNo" for SKU, "ItemSerialNo" or "BoxIDSerial" for serial, "ASNNo" for the order number, "GRNNo" for GRN status. Just pick "GRN Stock (Pending Inward)" before uploading.'],
    ['GRNNo column (GRN uploads only)', 'If your file has a GRNNo column, only rows with it left BLANK are kept as GRN Pending — a filled GRNNo means that serial has already been GRN\'d/inward (it\'s Inventory now), so those rows are automatically skipped.'],
    ['Zero-stock store', 'To declare a store as having ZERO stock (Inventory or GRN, whichever you\'re uploading), add one row with LocationCode filled in and SerialNo left blank.'],
    ['', ''],
    ['Before you upload', 'Delete the 3 example rows on the "Base Data" tab — they\'re only here to show the shape of the file.'],
  ];
  const noteWs = XLSX.utils.aoa_to_sheet(noteRows);
  noteWs['!cols'] = [{wch:22},{wch:95}];
  XLSX.utils.book_append_sheet(wb, noteWs, 'Read Me');
  XLSX.writeFile(wb, 'Base_Data_Upload_Format.xlsx');
}

function downloadScanTemplate(){
  const rows = [
    ['SerialNo'],
    ['SN00000001'],
    ['SN00000002'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{wch:18}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Scanned Serials');
  const noteRows = [
    ['Column', 'What to put here'],
    ['SerialNo', 'One row per physically scanned unit. "Serial Number", "Serial No", "ItemSerialNo" or "IMEI" also work as column names.'],
    ['LocationCode (optional)', 'Only needed if one file covers multiple stores. Left out, every row in the file is counted under whichever store is selected in the dropdown before you upload.'],
    ['ItemNo (optional)', 'Item code / SKU, if you track it. Not required for matching.'],
    ['', ''],
    ['Before you upload', 'Delete the 2 example rows on the "Scanned Serials" tab — they\'re only here to show the shape of the file.'],
  ];
  const noteWs = XLSX.utils.aoa_to_sheet(noteRows);
  noteWs['!cols'] = [{wch:24},{wch:95}];
  XLSX.utils.book_append_sheet(wb, noteWs, 'Read Me');
  XLSX.writeFile(wb, 'Scan_Upload_Format.xlsx');
}

function downloadExcel(){
  if(!reconciledStores.length){ showMessage('Complete the audit first to generate results.', true); return; }
  const cycle = document.getElementById('cycleName').value || 'Untitled_Cycle';
  // Scope the export to whatever the viewer is currently allowed/drilled
  // into — an admin viewing one Circle Head's territory (or a circle head's
  // own login) gets a report containing only that territory's stores, not
  // the whole audit.
  const exportScope = currentRoleScopedStores();
  const stores = (exportScope ? reconciledStores.filter(s => exportScope.has(s)) : reconciledStores).slice().sort();
  const scopedDetailResults = exportScope ? detailResults.filter(r => exportScope.has(r.store)) : detailResults;
  const scopedScanData = exportScope ? scanData.filter(r => exportScope.has(r.store)) : scanData;

  if(exportScope && !stores.length){ showMessage('No stores in this territory to export yet.', true); return; }

  const summaryRows = stores.map(store => {
    const { invExpected, invMatched, invShort, grnExpected, grnMatched, grnShort, m, sh, ex } = storeSourceSummary(store);
    const approval = storeApprovalInfo(store);
    // 0 expected + 0 found is a genuine zero-stock store, fully reconciled — not a 0% failure.
    return {
      Store:store, Circle:circleFor(store),
      'Inventory Expected': invExpected, 'Inventory Matched': invMatched, 'Inventory Short': invShort,
      'GRN Pending Expected': grnExpected, 'GRN Pending Matched': grnMatched, 'GRN Pending Short': grnShort,
      'Total Expected':m+sh, 'Total Found':m+ex, Matched:m, Short:sh, Excess:ex,
      'Match %': (m+sh+ex) ? ((m/(m+sh+ex))*100).toFixed(2) : '100.00',
      'Audited On': approval.reviewedOn || '', // when the circle head/admin approved or rejected this store — the audit-trail date
      'Reviewed By': approval.reviewedBy || '',
      'Review Status': approval.status,
      Remarks: approval.remark // whatever the reviewer actually wrote at approval time
    };
  });

  const detailRows = scopedDetailResults.map((r,i) => ({
    'Sr. No.': i+1, Store:r.store, Circle:circleFor(r.store),
    'System scan serial number': r.systemSerial || '', SKU: r.sku || '', 'Physical scan serial number': r.physicalSerial || '',
    'Source': sourceLabelFor(r),
    'ASN Number': r.asn || '', // which ASN/order this serial belongs to, for GRN-pending rows — blank for Inventory/Excess
    'Match': r.status==='match' ? 'Match' : '', 'Excess': r.status==='excess' ? 'Excess' : '', 'Short': r.status==='short' ? 'Short' : ''
  }));
  const scanLogRows = scopedScanData.map(r => ({Store:r.store, Circle:circleFor(r.store), SKU:r.sku, 'Serial Number':r.serial, 'Scanned at':r.ts}));

  // Dedicated sheet: every GRN-pending serial across the audited stores, and
  // whether it was found in the physical scan or is still pending/short.
  const grnRows = scopedDetailResults
    .filter(r => r.source === 'grn')
    .map((r,i) => ({
      'Sr. No.': i+1, Store: r.store, Circle: circleFor(r.store), SKU: r.sku || '',
      'GRN Pending Serial Number': r.systemSerial || '',
      'ASN Number': r.asn || '',
      'Matched in Physical Scan': r.status === 'match' ? 'Yes' : 'No — still pending'
    }));

  const wb = XLSX.utils.book_new();
  const summaryWs = XLSX.utils.json_to_sheet(summaryRows);
  applyAutoFilter(summaryWs, summaryRows.length, 15);
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
  const detailWs = XLSX.utils.json_to_sheet(detailRows);
  applyAutoFilter(detailWs, detailRows.length, 11);
  XLSX.utils.book_append_sheet(wb, detailWs, 'Detail');
  if(grnRows.length){
    const grnWs = XLSX.utils.json_to_sheet(grnRows);
    applyAutoFilter(grnWs, grnRows.length, 7);
    XLSX.utils.book_append_sheet(wb, grnWs, 'GRN Pending');
  }
  const logWs = XLSX.utils.json_to_sheet(scanLogRows);
  applyAutoFilter(logWs, scanLogRows.length, 5);
  XLSX.utils.book_append_sheet(wb, logWs, 'Scan Log');
  const territorySuffix = (isAppAdmin() && adminViewingCircleHead) ? `_${adminViewingCircleHead.name}` : '';
  XLSX.writeFile(wb, `PV_Recon_${cycle.replace(/[^a-z0-9]/gi,'_')}${territorySuffix.replace(/[^a-z0-9_]/gi,'_')}.xlsx`);
}

function downloadStoreExcel(store){
  const rows = detailResults.filter(r => r.store === store);
  if(!rows.length && !reconciledStores.includes(store)){ showMessage('No results for this store yet.', true); return; }
  const cycle = document.getElementById('cycleName').value || 'Untitled_Cycle';
  const { invExpected, invMatched, invShort, grnExpected, grnMatched, grnShort, m, sh, ex } = storeSourceSummary(store);
  const approval = storeApprovalInfo(store);
  const summaryRows = [{
    Store:store, Circle:circleFor(store),
    'Inventory Expected': invExpected, 'Inventory Matched': invMatched, 'Inventory Short': invShort,
    'GRN Pending Expected': grnExpected, 'GRN Pending Matched': grnMatched, 'GRN Pending Short': grnShort,
    'Total Expected':m+sh, 'Total Found':m+ex, Matched:m, Short:sh, Excess:ex,
    'Match %': (m+sh+ex) ? ((m/(m+sh+ex))*100).toFixed(2) : '100.00',
    'Audited On': approval.reviewedOn || '',
    'Reviewed By': approval.reviewedBy || '',
    'Review Status': approval.status,
    Remarks: approval.remark
  }];
  const scanLogRows = scanData.filter(r => r.store === store).map(r => ({Store:r.store, Circle:circleFor(r.store), SKU:r.sku, 'Serial Number':r.serial, 'Scanned at':r.ts}));
  const detailRows = buildDetailRowsForExcel(rows);
  const wb = XLSX.utils.book_new();
  const summaryWs = XLSX.utils.json_to_sheet(summaryRows);
  applyAutoFilter(summaryWs, summaryRows.length, 18);
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
  const detailWs = XLSX.utils.json_to_sheet(detailRows);
  applyAutoFilter(detailWs, detailRows.length, 9);
  XLSX.utils.book_append_sheet(wb, detailWs, 'Audit Report');
  const logWs = XLSX.utils.json_to_sheet(scanLogRows);
  applyAutoFilter(logWs, scanLogRows.length, 5);
  XLSX.utils.book_append_sheet(wb, logWs, 'Scan Log');
  const safeStore = store.replace(/[^a-z0-9]/gi,'_');
  XLSX.writeFile(wb, `PV_Recon_${safeStore}_${cycle.replace(/[^a-z0-9]/gi,'_')}.xlsx`);
}

function resetEverything(){
  confirmAction('reset-new-cycle', 'This disconnects from the current cycle so you can start a new one', () => {
    unsubscribeRealtime();
    stopDashboardPolling();
    currentCycleId = null; currentCycleName = ''; currentCycleCreatedAt = null;
    baseData = []; scanData = []; detailResults = []; reconciledStores = []; auditCompleted = false;
    dashboardStoreFilter = null; dashboardCircleFilter = null; adminViewingCircleHead = null;
    document.getElementById('cycleName').value = '';
    setSaveIndicator('session');
    updateCycleLabels();
    renderBaseTable();
    populateStoreSelect();
    document.getElementById('baseUploadStatus').textContent = '';
    showMessage('Type a new cycle name above and click "+ New cycle" (or "Load existing" for a past one). Your previous cycle\'s data is untouched in Supabase.');
    showStep(currentProfile && currentProfile.role === 'admin' ? 'setup' : 'scan');
  });
}

// ---------------- DRAG & DROP for the upload dropzones ----------------
function wireDropzone(zoneId, inputId){
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  if(!zone || !input) return;
  ['dragenter','dragover'].forEach(evt => zone.addEventListener(evt, (e) => {
    e.preventDefault(); e.stopPropagation();
    if(input.disabled) return;
    zone.classList.add('drag-active');
  }));
  ['dragleave','drop'].forEach(evt => zone.addEventListener(evt, (e) => {
    e.preventDefault(); e.stopPropagation();
    zone.classList.remove('drag-active');
  }));
  zone.addEventListener('drop', (e) => {
    if(input.disabled) return;
    const files = e.dataTransfer && e.dataTransfer.files;
    if(!files || !files.length) return;
    input.files = files;
    input.dispatchEvent(new Event('change'));
  });
}

setSaveIndicator('session');
renderBaseTable();
populateStoreSelect();
wireDropzone('baseUploadZone', 'baseFileInput');

// Visual selected-state for the Inventory/GRN pill radios (kept independent
// of the CSS :has() selector so older browsers still show which is picked).
(function wireBaseDataTypePills(){
  const inputs = document.querySelectorAll('input[name="baseDataType"]');
  const sync = () => inputs.forEach(i => i.closest('.radio-pill').classList.toggle('radio-pill-selected', i.checked));
  inputs.forEach(i => i.addEventListener('change', sync));
  sync();
})();
wireDropzone('scanUploadZone', 'scanFileInput');

(async function initAuth(){
  if(!sb){
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('authScreen').style.display = 'flex';
    setAuthMessage('Supabase library failed to load — check your connection and reload.', true);
    return;
  }

  // If this page load is the redirect from a "reset your password" email,
  // Supabase's client auto-detects the token in the URL and establishes a
  // temporary recovery session. Route straight to the new-password screen
  // instead of treating it as a normal sign-in.
  if(location.hash.includes('type=recovery')){
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('resetPasswordScreen').style.display = 'flex';
    return;
  }

  // Never let a stuck getSession() (paused Supabase project, network issue,
  // bad URL/key in config.js) leave the loading screen spinning forever with
  // no explanation — show a real error and the sign-in screen instead. The
  // timeout below is a backstop for the case where the request just hangs
  // (no error, no response) rather than failing outright.
  try{
    const sessionPromise = sb.auth.getSession();
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for Supabase')), 10000));
    const { data: { session } } = await Promise.race([sessionPromise, timeoutPromise]);
    if(session && session.user){
      await onLoginSuccess();
    } else {
      document.getElementById('authScreen').style.display = 'flex';
    }
  }catch(e){
    console.error('Could not reach Supabase on startup:', e);
    document.getElementById('authScreen').style.display = 'flex';
    setAuthMessage('Could not connect to the server. This usually means the Supabase project is paused, or the URL/key in js/config.js is wrong. Check the browser console for details, then reload.', true);
  }
  document.getElementById('loadingScreen').style.display = 'none';

  sb.auth.onAuthStateChange((event) => {
    if(event === 'PASSWORD_RECOVERY'){
      ['loadingScreen','authScreen','pendingScreen','forgotPasswordScreen','appRoot'].forEach(id => {
        const el = document.getElementById(id); if(el) el.style.display = 'none';
      });
      document.getElementById('resetPasswordScreen').style.display = 'flex';
      return;
    }
    if(event === 'SIGNED_OUT'){
      currentUser = null; currentProfile = null; myAssignedStores = []; myAssignedCircles = [];
      circleHeadsCache = null; adminViewingCircleHead = null;
      document.body.className = '';
      document.getElementById('appRoot').style.display = 'none';
      document.getElementById('pendingScreen').style.display = 'none';
      document.getElementById('loadingScreen').style.display = 'none';
      document.getElementById('authScreen').style.display = 'flex';
    }
  });
})();

// ---------------- FORGOT / RESET PASSWORD ----------------
function showForgotPasswordForm(){
  const email = document.getElementById('authEmail').value.trim();
  document.getElementById('forgotEmail').value = email;
  document.getElementById('forgotPasswordMessage').textContent = '';
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('forgotPasswordScreen').style.display = 'flex';
}
function hideForgotPasswordForm(){
  document.getElementById('forgotPasswordScreen').style.display = 'none';
  document.getElementById('authScreen').style.display = 'flex';
}
async function handleSendPasswordReset(){
  if(!sb){ return; }
  const email = document.getElementById('forgotEmail').value.trim();
  const msgEl = document.getElementById('forgotPasswordMessage');
  if(!email){ msgEl.textContent = 'Enter your email first.'; msgEl.className = 'auth-message error'; return; }
  msgEl.textContent = 'Sending…'; msgEl.className = 'auth-message';
  try{
    let redirectTo = window.location.origin + window.location.pathname;
    redirectTo = redirectTo.replace(/index\.html?$/i, ''); // normalize so it matches a wildcard allow-list entry cleanly
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
    if(error) throw error;
    msgEl.textContent = 'Check your inbox for a password reset link.';
    msgEl.className = 'auth-message ok';
  }catch(e){
    msgEl.textContent = errMsg(e);
    msgEl.className = 'auth-message error';
  }
}
async function handleCompletePasswordReset(){
  if(!sb){ return; }
  const pw = document.getElementById('resetNewPassword').value;
  const confirm = document.getElementById('resetConfirmPassword').value;
  const msgEl = document.getElementById('resetPasswordMessage');
  if(!pw || pw.length < 6){ msgEl.textContent = 'Password must be at least 6 characters.'; msgEl.className = 'auth-message error'; return; }
  if(pw !== confirm){ msgEl.textContent = 'Passwords do not match.'; msgEl.className = 'auth-message error'; return; }
  msgEl.textContent = 'Updating…'; msgEl.className = 'auth-message';
  try{
    const { error } = await sb.auth.updateUser({ password: pw });
    if(error) throw error;
    msgEl.textContent = 'Password updated! Signing you in…';
    msgEl.className = 'auth-message ok';
    history.replaceState(null, '', window.location.pathname);
    document.getElementById('resetPasswordScreen').style.display = 'none';
    await onLoginSuccess();
  }catch(e){
    msgEl.textContent = errMsg(e);
    msgEl.className = 'auth-message error';
  }
}

// Attempt to sync any scans queued from a previous offline session.
updateOfflineBanner();
if(navigator.onLine) syncOfflineQueue();
