let currentCycleId = null;
let currentCycleName = '';
let currentCycleCreatedAt = null;

let baseData = [];
let scanData = [];
let storeLocks = [];
let detailResults = [];
let auditCompleted = false;
let dashboardStoreFilter = null;

function setDashboardStoreFilter(store){
  dashboardStoreFilter = (dashboardStoreFilter === store) ? null : store;
  renderDashboard();
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
  const tRole = document.getElementById('topbarAvatarRole'); if(tRole) tRole.textContent = role === 'admin' ? 'Administrator' : 'Auditor';
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
  document.getElementById('authNameField').style.display = mode==='signup' ? '' : 'none';
  const forgotLink = document.getElementById('forgotPasswordLink');
  if(forgotLink) forgotLink.style.display = mode==='signin' ? '' : 'none';
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

  setAuthMessage(authMode==='signin' ? 'Signing in…' : 'Creating account…', false);
  try{
    if(authMode === 'signup'){
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
      if(error) throw error;
      // Belt-and-suspenders: also write the name directly in case the
      // signup trigger runs before the session is fully established.
      if(data && data.user){
        await sb.from('profiles').update({ full_name: fullName }).eq('id', data.user.id);
      }
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
    document.body.className = (profile.role === 'admin' ? 'role-admin' : 'role-user') + (document.body.classList.contains('theme-dark') ? ' theme-dark' : '');
    const whoAmIEl = document.getElementById('whoAmI');
    whoAmIEl.textContent = `${displayNameFor(user.email, profile.full_name)} · ${profile.role}`;
    whoAmIEl.title = user.email;
    updateTopbarUser();

    const requestedStep = location.hash.replace('#','');
    const wantsAdminOnlyPage = ['setup','dashboard','admin'].includes(requestedStep);

    if(profile.role !== 'admin'){
      const { data: assigned } = await sb.from('user_stores').select('store_code').eq('user_id', user.id);
      myAssignedStores = (assigned || []).map(r => r.store_code);
      const landing = (VALID_ROUTE_STEPS.includes(requestedStep) && !wantsAdminOnlyPage) ? requestedStep : 'scan';
      showStep(landing, true);
    } else {
      myAssignedStores = [];
      const landing = VALID_ROUTE_STEPS.includes(requestedStep) ? requestedStep : 'dashboard';
      showStep(landing, true);
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
      <tr><td>${displayNameFor(p.email, p.full_name)}<br><span style="color:var(--text-faint);font-size:11px;">${p.email}</span></td><td>${new Date(p.created_at).toLocaleDateString()}</td>
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
      const avatarHtml = u.avatar_url ? `<img src="${u.avatar_url}" alt="" class="avatar-img">` : initialsFor(u.email, u.full_name);
      return `<div class="user-row">
        <div class="user-row-email"><span class="user-avatar-sm">${avatarHtml}</span> ${displayNameFor(u.email, u.full_name)} <span class="role-pill ${u.role}">${u.role}</span><br><span style="color:var(--text-faint);font-size:11px;margin-left:34px;">${u.email}</span></div>
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
    Name: ${displayNameFor(currentUser.email, currentProfile.full_name)}<br>
    Email: ${currentUser.email}<br>
    Role: ${currentProfile.role}<br>
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
  currentCycleCreatedAt = cycle.created_at || null;
  auditCompleted = !!cycle.completed;
  dashboardStoreFilter = null;
  updateCycleLabels();
  await fetchCycleData();
  renderBaseTable();
  populateStoreSelect();
  renderScanView();
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
        currentCycleId = null; currentCycleName = ''; currentCycleCreatedAt = null;
        baseData = []; scanData = []; detailResults = []; auditCompleted = false;
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

async function fetchCycleData(){
  if(!currentCycleId) return;
  const { data: baseRows, error: baseErr } = await sb.from('base_serials').select('*').eq('cycle_id', currentCycleId);
  if(baseErr) throw baseErr;
  baseData = (baseRows||[]).map(r => ({store:r.store_code, sku:r.sku, desc:r.description, serial:r.serial_no, uploadedAt:r.uploaded_at}));

  const { data: scanRows, error: scanErr } = await sb.from('scans').select('*').eq('cycle_id', currentCycleId);
  if(scanErr) throw scanErr;
  scanData = (scanRows||[]).map(r => ({id:r.id, store:r.store_code, sku:r.sku, serial:r.serial_no, ts: new Date(r.scanned_at).toLocaleString(), rawTs:r.scanned_at, scannedBy:r.scanned_by}));

  const { data: lockRows, error: lockErr } = await sb.from('store_locks').select('*').eq('cycle_id', currentCycleId);
  if(lockErr) throw lockErr;
  storeLocks = (lockRows||[]).map(r => ({store:r.store_code, lockedBy:r.locked_by, lockedByEmail:r.locked_by_email, lockedAt:new Date(r.locked_at).toLocaleString(), lockedAtRaw:r.locked_at}));
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
}

function showStep(step, skipHistory){
  ['setup','scan','dashboard','admin','profile'].forEach(s => {
    document.getElementById('view-'+s).classList.toggle('active', s===step);
    document.getElementById('tab-'+s).classList.toggle('active', s===step);
  });
  const pageTitles = {setup:'Setup Base Data', scan:'Scan / Upload', dashboard:'Overview', admin:'Users & Stores', profile:'My Account'};
  const titleEl = document.getElementById('contentTitle');
  if(titleEl && pageTitles[step]) titleEl.textContent = pageTitles[step];
  const labelEl = document.getElementById('sidebarCurrentPageLabel');
  if(labelEl && pageTitles[step]) labelEl.textContent = pageTitles[step];
  // Selecting a page closes the drawer back down to just the hamburger.
  closeSidebarNav();
  stopDashboardPolling();
  if(step==='scan') renderScanView();
  if(step==='dashboard'){ renderDashboard(); if(currentProfile && currentProfile.role === 'admin') startDashboardPolling(); }
  if(step==='admin') renderAdminPanel();
  if(step==='profile') renderProfilePanel();

  // Keep the URL in sync so the browser's own Back/Forward buttons work,
  // and a page can be reloaded/bookmarked directly to a specific section.
  if(!skipHistory && location.hash.replace('#','') !== step){
    history.pushState({step}, '', '#'+step);
  }
  const backBtn = document.getElementById('routeBackBtn');
  if(backBtn) backBtn.style.display = history.length > 1 ? '' : 'none';
}

const VALID_ROUTE_STEPS = ['setup','scan','dashboard','admin','profile'];
window.addEventListener('popstate', () => {
  const step = location.hash.replace('#','');
  if(VALID_ROUTE_STEPS.includes(step) && document.getElementById('appRoot').style.display !== 'none'){
    showStep(step, true);
  }
});
function goBack(){ history.back(); }

let dashboardPollTimer = null;
function startDashboardPolling(){
  stopDashboardPolling();
  dashboardPollTimer = setInterval(async () => {
    if(!currentCycleId) return;
    try{ await fetchCycleData(); renderDashboard(); }
    catch(e){ console.error('Live refresh failed', e); }
  }, 15000);
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
  const placeholder = '<option value="">— Please select store —</option>';
  sel.innerHTML = stores.length
    ? placeholder + stores.map(s => `<option value="${s}">${s}</option>`).join('')
    : '<option value="">No stores assigned — contact your admin</option>';
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
  const isAdmin = currentProfile && currentProfile.role === 'admin';
  const lock = store ? getStoreLock(store) : null;
  const locked = !!lock;

  const baseForStore = baseData.filter(b => b.store === store);
  const scansForStore = scanData.filter(r => r.store === store);

  document.getElementById('scanProgress').innerHTML = store ? `
    <span>Expected here: <b>${baseForStore.length}</b></span>
    <span>Scanned here: <b>${scansForStore.length}</b></span>
    <span>Remaining: <b>${Math.max(baseForStore.length - scansForStore.length,0)}</b></span>` : '';

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
  if(isAdmin){
    completeBtn.textContent = 'Complete audit & build dashboard';
    completeBtn.disabled = false;
  } else {
    completeBtn.textContent = locked ? 'Store already submitted' : 'Submit & lock this store\u2019s audit';
    completeBtn.disabled = !store || locked;
  }

  const tbody = document.getElementById('scanTableBody');
  if(!scansForStore.length){ tbody.innerHTML = '<tr><td colspan="4" class="empty-note">No serials scanned for this store yet.</td></tr>'; return; }
  const canDeleteAny = isAdmin;
  tbody.innerHTML = scansForStore.slice().reverse().map(r => {
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
    }catch(e){
      console.error(e);
      showMessage('Could not unlock store: ' + errMsg(e), true);
    }
  });
}

function completeAudit(){
  if(!requireCycle()) return;

  const isAdmin = currentProfile && currentProfile.role === 'admin';

  if(!isAdmin){
    const store = document.getElementById('scanStoreSelect').value;
    if(!store){ showMessage('Select a store first.', true); return; }
    if(getStoreLock(store)){ showMessage(`${store} is already submitted and locked.`, true); return; }
    confirmAction('user-complete', `This locks ${store} — no further edits until an admin reopens it`, async () => {
      try{
        const { error } = await sb.from('store_locks').insert({
          cycle_id: currentCycleId, store_code: store, locked_by: currentUser.id, locked_by_email: currentUser.email
        });
        if(error) throw error;
        await fetchCycleData();
        showMessage(`${store} submitted and locked. Your admin will finalize the full audit once every store is done.`);
        renderScanView();
      }catch(e){
        console.error(e);
        showMessage('Could not submit this store: ' + errMsg(e), true);
      }
    });
    return;
  }

  if(!baseData.length){ showMessage('Upload base data in step 1 before completing the audit.', true); return; }
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

  const auditedCount = [...new Set(scanData.map(r=>r.store))].filter(Boolean).length;
  const greetSub = document.getElementById('greetSub');
  if(greetSub){
    if(!currentCycleId){
      greetSub.textContent = "Load or create an audit cycle to get started.";
    } else if(!auditCompleted){
      greetSub.textContent = `Live — ${auditedCount} store${auditedCount===1?'':'s'} scanned so far. Auto-refreshes every 15s.`;
    } else {
      greetSub.textContent = `Audit "${document.getElementById('cycleName').value || 'Untitled cycle'}" completed — final results for ${auditedCount} store${auditedCount===1?'':'s'}.`;
    }
  }

  const totalBaseStores = [...new Set(baseData.map(r=>r.store))].filter(Boolean);
  const auditedStores = [...new Set(scanData.map(r=>r.store))].filter(Boolean);
  const storesRecorded = auditedStores.length;
  const pendingStores = totalBaseStores.filter(s => !auditedStores.includes(s));
  const storesPending = pendingStores.length;

  // Everything below (hero cards, health donut, live activity) scopes to dashboardStoreFilter
  // when one is set — via a store-card click, the Filters dropdown, or a store match in the topbar search.
  const scopedResults = dashboardStoreFilter ? detailResults.filter(r=>r.store===dashboardStoreFilter) : detailResults;
  const scopedScans = dashboardStoreFilter ? scanData.filter(r=>r.store===dashboardStoreFilter) : scanData;
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
  const progressPct = totalBaseStores.length ? Math.round((storesRecorded/totalBaseStores.length)*100) : 0;
  const spPct = document.getElementById('sidebarProgressPct'); if(spPct) spPct.textContent = progressPct + '%';
  const spFill = document.getElementById('sidebarProgressFill'); if(spFill) spFill.style.width = progressPct + '%';
  const spSub = document.getElementById('sidebarProgressSub'); if(spSub) spSub.textContent = `${storesRecorded} / ${totalBaseStores.length} stores completed`;

  // ---- Topbar notification badge (real count: stores still pending audit) ----
  const bellBadge = document.getElementById('topbarBellBadge');
  if(bellBadge){
    if(storesPending > 0){ bellBadge.style.display = 'flex'; bellBadge.textContent = storesPending > 99 ? '99+' : storesPending; }
    else{ bellBadge.style.display = 'none'; }
  }

  // ---- Per-store stats (used by hero sparklines, store filter, and the detail table's Match rate / Last scanned columns) ----
  let stores = [...new Set(detailResults.map(r=>r.store))];
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
    const storeScans = scanData.filter(r=>r.store===store);
    const lastTs = storeScans.reduce((latest,r) => (!latest || (r.rawTs && r.rawTs > latest)) ? (r.rawTs||latest) : latest, null);
    storeStats[store] = { m, sh, ex, t, pct: t ? (m/t*100) : 0, lastTs, lastLabel: lastTs ? fmtRelativeTime(lastTs) : '—' };
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
  document.getElementById('kpiStrip').innerHTML = kpiCards.map(k => `
    <div class="kpi ${k.cls}">
      <div class="kpi-top"><span class="kpi-icon">${k.icon}</span><span class="kpi-trend ${k.trend}">${k.trend==='up'?'\u2191':k.trend==='down'?'\u2193':'\u2192'} ${k.trendLabel}</span></div>
      <p class="kpi-value">${k.value}</p>
      <p class="kpi-label">${k.label}</p>
      <p class="kpi-sub">${k.sub}</p>
      <div class="kpi-spark">${k.spark}</div>
    </div>`).join('');

  // ---- Store result cards ----
  document.getElementById('storeGrid').innerHTML = stores.length ? stores.map(store => {
    const {m, sh, ex, t, pct} = storeStats[store];
    let stamp = sh>0 ? '<span class="stamp stamp-critical">Missing units</span>' : (ex>0 || m<t ? '<span class="stamp stamp-variance">Variance</span>' : '<span class="stamp stamp-match">Matched</span>');
    const isFiltered = dashboardStoreFilter === store;
    return `<div class="store-tag${isFiltered?' store-tag-selected':''}" onclick="setDashboardStoreFilter('${store.replace(/'/g,"\\'")}')" title="Click to filter the detail table below to this store">
      <span class="store-download" onclick="event.stopPropagation();downloadStoreExcel('${store.replace(/'/g,"\\'")}')" title="Download this store's report">↓ Export</span>
      <div class="store-tag-body">
      <p class="store-tag-name">${store}</p>
      <p class="store-tag-meta">Circle ${circleFor(store)} · Expected ${t-ex} · Found ${t-sh}</p>
      <div class="store-tag-stats"><span>Match <b>${pct.toFixed(2)}%</b></span><span>Short <b>${sh}</b></span><span>Excess <b>${ex}</b></span></div>
      ${stamp}</div></div>`;
  }).join('') : '<div class="empty-note">No stores scanned yet — complete at least one store in Scan / Upload to see results here.</div>';

  // ---- Store filter dropdown (mirrors the store-card click filter) ----
  const filterSelect = document.getElementById('detailStoreFilterSelect');
  if(filterSelect){
    filterSelect.innerHTML = '<option value="">Filters: all stores</option>' + stores.map(s => `<option value="${s}"${dashboardStoreFilter===s?' selected':''}>${s}</option>`).join('');
  }

  const filteredDetail = dashboardStoreFilter ? detailResults.filter(r=>r.store===dashboardStoreFilter) : detailResults;
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
    return `<tr><td>${r.store}</td><td>${circleFor(r.store)}</td><td>${r.sku||'—'}</td><td>${r.physicalSerial||'—'}</td><td>${r.systemSerial||'—'}</td>
    <td><div class="rate-cell"><div class="rate-track"><div class="rate-fill" style="width:${st.pct.toFixed(0)}%;background:${rateColor(st.pct)};"></div></div><span class="rate-text">${st.pct.toFixed(0)}%</span></div></td>
    <td><span class="badge badge-${r.status}">${r.status.charAt(0).toUpperCase()+r.status.slice(1)}</span></td>
    <td>${st.lastLabel}</td></tr>`;
  }).join('')
    : '<tr><td colspan="8" class="empty-note">No matching records.</td></tr>';

  renderCharts(stores, {match, short, excess, matchPct});
  buildLiveActivity(pendingStores, dashboardStoreFilter);
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
function buildLiveActivity(pendingStores, scopeStore){
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

  const scoped = scopeStore ? events.filter(e => !e.store || e.store === scopeStore) : events;
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
    return {Store:store, Circle:circleFor(store), 'Total Expected':m+sh, 'Total Found':m+ex, Matched:m, Short:sh, Excess:ex, 'Match %': (m+sh+ex) ? ((m/(m+sh+ex))*100).toFixed(2) : '0.00'};
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
    currentCycleId = null; currentCycleName = ''; currentCycleCreatedAt = null;
    baseData = []; scanData = []; detailResults = []; auditCompleted = false;
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
renderDashboard();
wireDropzone('baseUploadZone', 'baseFileInput');
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

  const { data: { session } } = await sb.auth.getSession();
  if(session && session.user){
    await onLoginSuccess();
  } else {
    document.getElementById('authScreen').style.display = 'flex';
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
      currentUser = null; currentProfile = null; myAssignedStores = [];
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
