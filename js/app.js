/* ═══════════ app.js — shell, router, security, automation ═══════════ */

import { $, $$, esc, fmtMoney, fmtDate, relTime, today, debounce, pbkdf2, uid, sortBy, monthKey, initials } from './util.js';
import * as store from './store.js';
import { state, settings, bus } from './store.js';
import * as db from './db.js';
import { h, frag, icon, toast, modal, confirm, sheet, empty, applyPrivacy, form, menu } from './ui.js';
import { nlQuery, trainCategorizer } from './ai.js';
import { seedDemoData, seedStarterData } from './seed.js';
import { openTxnModal, currentPageAction, clearPageAction } from './views/common.js';

/* ═══════════ ROUTES ═══════════ */
const ROUTES = [
  { path: 'dashboard',     label: 'Dashboard',           icon: 'home',     load: () => import('./views/dashboard.js') },
  { path: 'tracker',       label: 'Financial Tracker',   icon: 'swap',     load: () => import('./views/tracker.js') },
  { path: 'shopping',      label: 'Shopping List',       icon: 'cart',     load: () => import('./views/shopping.js') },
  { path: 'credit',        label: 'Credit Book',         icon: 'book',     load: () => import('./views/credit.js') },
  { path: 'investments',   label: 'Investments',         icon: 'trend',    load: () => import('./views/investments.js') },
  { path: 'marketing',     label: 'Marketing',           icon: 'mega',     load: () => import('./views/marketing.js') },
  { path: 'budget',        label: 'Budget',              icon: 'target',   load: () => import('./views/budget.js') },
  { path: 'bills',         label: 'Bills',               icon: 'clock',    load: () => import('./views/bills.js') },
  { path: 'calendar',      label: 'Calendar',            icon: 'calendar', load: () => import('./views/calendar.js') },
  { path: 'goals',         label: 'Goals',               icon: 'flame',    load: () => import('./views/goals.js') },
  { path: 'loans',         label: 'Loans',               icon: 'bank',     load: () => import('./views/loans.js') },
  { path: 'reports',       label: 'Reports',             icon: 'file',     load: () => import('./views/reports.js') },
  { path: 'analytics',     label: 'Analytics',           icon: 'chart',    load: () => import('./views/analytics.js') },
  { path: 'categories',    label: 'Categories',          icon: 'tag',      load: () => import('./views/categories.js') },
  { path: 'reminders',     label: 'Reminders',           icon: 'bell',     load: () => import('./views/reminders.js') },
  { path: 'notifications', label: 'Notifications',       icon: 'bell',     load: () => import('./views/notifications.js') },
  { path: 'settings',      label: 'Settings',            icon: 'gear',     load: () => import('./views/settings.js') },
  { path: 'custom',        label: 'Custom Module',       icon: 'sparkle',  load: () => import('./views/custom.js'), hidden: true },
  { path: 'accounts',      label: 'Accounts',            icon: 'wallet',   load: () => import('./views/accounts.js'), hidden: true },
];
const routeOf = p => ROUTES.find(r => r.path === p) || ROUTES[0];

/* ═══════════ THEME ═══════════ */
const mq = matchMedia('(prefers-color-scheme: dark)');
function applyTheme(mode = settings.mode) {
  const resolved = mode === 'system' ? (mq.matches ? 'dark' : 'light') : mode;
  document.documentElement.dataset.mode = resolved;
  document.documentElement.dataset.theme = mode;
  $('meta[name=theme-color]')?.setAttribute('content', resolved === 'dark' ? '#080a14' : '#f4f5fb');
  const btn = $('#theme-btn');
  if (btn) btn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20"><use href="#i-${resolved === 'dark' ? 'sun' : 'moon'}"/></svg>`;
}
mq.addEventListener('change', () => { if (settings.mode === 'system') applyTheme(); });

/* ═══════════ NAVIGATION ═══════════ */
function renderNav() {
  const nav = $('#nav');
  nav.innerHTML = '';
  const cur = location.hash.replace('#/', '').split('/')[0] || 'dashboard';
  const groups = [
    ['Overview', ['dashboard', 'tracker', 'shopping', 'credit']],
    ['Growth', ['investments', 'marketing', 'budget']],
    ['Planning', ['bills', 'calendar', 'goals', 'loans']],
    ['Intelligence', ['reports', 'analytics']],
    ['System', ['categories', 'notifications', 'reminders', 'settings']],
  ];
  const counts = {
    bills: state.bills.filter(b => b.status !== 'paid' && b.dueDate <= today()).length,
    notifications: store.unreadCount(),
    credit: store.creditTotals().overdueCount,
    shopping: store.shoppingPending(),
  };
  for (const [gname, paths] of groups) {
    nav.append(h('div', { class: 'nav-group', text: gname }));
    for (const p of paths) {
      const r = routeOf(p);
      const n = counts[p] || 0;
      nav.append(h('a', { href: `#/${p}`, class: cur === p ? 'on' : '' },
        h('span', { html: icon(r.icon, 18), style: { display: 'grid' } }),
        h('span', { class: 'ell', style: { flex: 1 }, text: r.label }),
        n ? h('span', { class: 'pill', text: String(n) }) : null));
    }
  }
  const types = sortBy(state.entityTypes, t => t.name);
  if (types.length) {
    nav.append(h('div', { class: 'nav-group', text: 'Custom Modules' }));
    for (const t of types) {
      nav.append(h('a', { href: `#/custom/${t.id}`, class: location.hash.includes(t.id) ? 'on' : '' },
        h('span', { html: icon(t.icon || 'sparkle', 18), style: { display: 'grid', color: t.color } }),
        h('span', { class: 'ell', style: { flex: 1 }, text: t.name }),
        h('span', { class: 'pill soft', text: String(state.entityRecords.filter(r => r.typeId === t.id).length) })));
    }
  }
  nav.append(h('div', { class: 'nav-group', text: 'Data' }));
  nav.append(h('a', { href: '#/accounts', class: cur === 'accounts' ? 'on' : '' },
    h('span', { html: icon('wallet', 18), style: { display: 'grid' } }), h('span', { text: 'Accounts' })));
}

/**
 * Drawer card. When a backend exists but nobody is signed in, this becomes the
 * sign-in entry point — otherwise the only way in is buried three levels deep
 * inside Settings, which nobody finds.
 */
function renderProfile() {
  const el = $('#drawer-profile');
  if (!el) return;
  const name = (settings.profileName || '').trim();
  const email = (settings.profileEmail || '').trim();
  const photo = settings.profilePhoto;
  const s = syncMod?.sync;
  const signedOut = !!syncMod && s?.status === 'signed-out';

  el.innerHTML = '';
  el.classList.toggle('signin', signedOut);
  el.onclick = null;

  if (signedOut) {
    el.href = '#/settings/account';   // still works if JS routing is bypassed
    el.title = 'Sign in to sync across devices';
    el.onclick = e => { e.preventDefault(); openLanding(); };
    el.append(
      h('div', { class: 'pfp', style: { fontSize: '1.1rem' } }, h('span', { text: '🔐' })),
      h('div', { class: 'who' },
        h('b', { text: 'Sign in / Sign up' }),
        h('small', { text: 'Back up and sync your data' })),
      h('span', { class: 'edit', html: icon('right', 15), style: { display: 'grid', opacity: 1 } }));
    return;
  }

  el.href = '#/settings/profile';
  el.title = 'Edit your profile';
  const label = name || (s?.email ? s.email.split('@')[0] : 'Set up your profile');
  const sub = s?.email || email || (name ? 'Tap to edit' : 'Add your name and photo');
  el.append(
    h('div', { class: 'pfp' }, photo
      ? h('img', { src: photo, alt: name || 'Profile photo' })
      : h('span', { text: name ? initials(name) : '👤' })),
    h('div', { class: 'who' }, h('b', { text: label }), h('small', { class: 'ell', text: sub })),
    h('span', { class: 'edit', html: icon('edit', 15), style: { display: 'grid' } }));
}

function renderDrawerNet() {
  const el = $('#drawer-net');
  const nw = store.netWorth();
  el.innerHTML = '';
  el.append(
    h('div', { class: 'lbl', text: 'Net worth' }),
    h('div', { class: 'val num', text: fmtMoney(nw.total, settings.baseCurrency, { compact: Math.abs(nw.total) >= 1e6 }) }),
    h('div', { class: 'delta t3', text: `${fmtMoney(nw.assets, settings.baseCurrency, { compact: true })} assets · ${fmtMoney(nw.liabilities, settings.baseCurrency, { compact: true })} debt` }));
}

/* ═══════════ ROUTER ═══════════ */
let currentCleanup = null;
let currentPath = null;

async function router() {
  const raw = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [path, ...params] = raw.split('/');
  const route = routeOf(path);
  if (!location.hash) { location.hash = '#/dashboard'; return; }

  const view = $('#view');
  currentCleanup?.();
  currentCleanup = null;
  currentPath = path;

  $('#page-title').textContent = route.label;
  $('#page-sub').textContent = '';
  clearPageAction();               // the outgoing screen's action is gone with it
  document.title = `${route.label} · Cash Checker`;
  renderNav();
  closeDrawer();

  view.innerHTML = '';
  view.append(h('div', { class: 'grid auto' },
    ...[1, 2, 3, 4].map(() => h('div', { class: 'skel', style: { height: '108px', borderRadius: 'var(--r-lg)' } })),
    h('div', { class: 'skel span3', style: { height: '280px', borderRadius: 'var(--r-lg)', gridColumn: '1/-1' } })));

  try {
    const mod = await route.load();
    if (currentPath !== path) return;                 // navigated away while loading
    view.innerHTML = '';
    const api = { setSubtitle: t => { $('#page-sub').textContent = t || ''; }, navigate, params };
    const cleanup = await mod.render(view, api);
    currentCleanup = typeof cleanup === 'function' ? cleanup : null;
    view.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  } catch (err) {
    console.error('[router]', err);
    view.innerHTML = '';
    view.append(empty('This screen failed to load', String(err?.message || err), 'alert',
      h('button', { class: 'btn primary mt', onClick: () => router() }, 'Retry')));
  }
}
export const navigate = to => { location.hash = to.startsWith('#') ? to : `#/${to}`; };

/* ═══════════ DRAWER ═══════════ */
const openDrawer = () => { $('#drawer').classList.add('open'); $('#scrim').hidden = false; };
const closeDrawer = () => { $('#drawer').classList.remove('open'); $('#scrim').hidden = true; };

/* ═══════════ LOCK SCREEN ═══════════ */
let pinBuffer = '';
let lockTimer = null;
let unlocked = false;
const PIN_FAILS = new Map();   // count → timestamp
const PIN_MAX_FAILS = 5;
const PIN_LOCK_MS = 30_000;

const pinLength = () => Number(settings.pinLength) || 6;

function drawPinDots() {
  const el = $('#pin-dots');
  el.innerHTML = '';
  const n = pinLength();
  for (let i = 0; i < n; i++) el.append(h('i', { class: i < pinBuffer.length ? 'on' : '' }));
}
function buildPinPad() {
  const pad = $('#pin-pad');
  pad.innerHTML = '';
  for (let i = 1; i <= 9; i++) pad.append(h('button', { text: String(i), onClick: () => pushPin(String(i)) }));
  pad.append(h('button', { class: 'wide', text: 'Clear', onClick: () => { pinBuffer = ''; drawPinDots(); } }));
  pad.append(h('button', { text: '0', onClick: () => pushPin('0') }));
  pad.append(h('button', { class: 'wide', text: '⌫', onClick: () => { pinBuffer = pinBuffer.slice(0, -1); drawPinDots(); } }));
}
async function pushPin(d) {
  // Brute-force lockout: reject input if too many recent failures.
  const now = Date.now();
  const fCount = PIN_FAILS.get('count') || 0;
  const fTime = PIN_FAILS.get('time') || 0;
  if (fCount >= PIN_MAX_FAILS && now - fTime < PIN_LOCK_MS) {
    const secs = Math.ceil((PIN_LOCK_MS - (now - fTime)) / 1000);
    $('#lock-err').textContent = `Too many attempts. Wait ${secs}s.`;
    return;
  }
  // Clear stale lockout if the window has elapsed.
  if (fCount >= PIN_MAX_FAILS && now - fTime >= PIN_LOCK_MS) { PIN_FAILS.clear(); }

  const max = pinLength();
  if (pinBuffer.length >= max) return;
  pinBuffer += d;
  drawPinDots();
  $('#lock-err').textContent = '';
  if (pinBuffer.length >= Math.min(4, max)) {
    const ok = await verifyPin(pinBuffer);
    if (ok) { PIN_FAILS.clear(); unlock(); return; }
    PIN_FAILS.set('count', (PIN_FAILS.get('count') || 0) + 1);
    PIN_FAILS.set('time', Date.now());
    if (pinBuffer.length >= max) failPin();
  }
}
function failPin() {
  $('#lock-card')?.classList.add('shake');
  $('.lock-card').classList.add('shake');
  setTimeout(() => $('.lock-card').classList.remove('shake'), 450);
  $('#lock-err').textContent = 'Incorrect PIN. Try again.';
  pinBuffer = ''; drawPinDots();
  store.audit('auth-fail', 'security', '', 'Incorrect PIN entry');
}
async function verifyPin(pin) {
  if (!settings.pinHash) return true;
  const { hash } = await pbkdf2(pin, settings.pinSalt, settings.pinIters || 250000);
  return hash === settings.pinHash;
}
function showLock() {
  if (!settings.pinEnabled) return;
  unlocked = false;
  pinBuffer = '';
  drawPinDots();
  $('#lock-err').textContent = '';
  $('#lock').hidden = false;
  $('#app').hidden = true;
  $('#lock-bio').hidden = !settings.biometricEnabled;
}
function unlock() {
  unlocked = true;
  $('#lock').hidden = true;
  $('#app').hidden = false;
  pinBuffer = '';
  $('#lock-err').textContent = '';
  store.audit('auth-ok', 'security', '', 'Vault unlocked');
  resetLockTimer();
}
function resetLockTimer() {
  clearTimeout(lockTimer);
  const mins = Number(settings.autoLockMinutes) || 0;
  if (settings.pinEnabled && mins > 0) lockTimer = setTimeout(() => showLock(), mins * 60000);
}
export function lockNow() {
  if (!settings.pinEnabled) { toast('Set a PIN in Settings → Security to enable locking', 'info'); return; }
  showLock();
}
async function biometricUnlock() {
  try {
    if (!settings.biometricCredId) throw new Error('No biometric credential registered');
    const cred = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ id: Uint8Array.from(atob(settings.biometricCredId), c => c.charCodeAt(0)), type: 'public-key' }],
        userVerification: 'required', timeout: 60000,
      },
    });
    if (cred) unlock();
  } catch (e) { $('#lock-err').textContent = e.message || 'Biometric unlock failed'; }
}

/* ═══════════ GLOBAL SEARCH (⌘K) ═══════════ */
let cmdkIndex = 0, cmdkItems = [];
function openCmdk() {
  $('#cmdk').hidden = false;
  const inp = $('#cmdk-q');
  inp.value = ''; inp.focus();
  runCmdk('');
}
const closeCmdk = () => { $('#cmdk').hidden = true; };

function runCmdk(q) {
  const res = $('#cmdk-results');
  res.innerHTML = '';
  cmdkItems = []; cmdkIndex = 0;
  const query = q.trim();

  // natural-language answer card
  if (query.length > 6) {
    const ans = nlQuery(query);
    if (ans) {
      res.append(h('div', { class: 'cmdk-ans' },
        h('div', { class: 'tiny t3', text: ans.label }),
        h('div', { class: 'big num', text: ans.value }),
        h('div', { class: 'tiny t2', style: { marginTop: '4px' }, text: ans.detail })));
    }
  }

  const add = (section, items) => {
    if (!items.length) return;
    res.append(h('div', { class: 'cmdk-sec', text: section }));
    items.forEach(it => {
      const el = h('div', { class: 'cmdk-item', onClick: () => { closeCmdk(); it.run(); } },
        h('div', { class: 'ic', html: icon(it.icon || 'file', 15) }),
        h('div', { class: 'tt' }, h('b', { text: it.title }), it.sub ? h('small', { text: it.sub }) : null),
        it.right ? h('span', { class: 't3 tiny num', text: it.right }) : null);
      res.append(el);
      cmdkItems.push({ el, run: it.run });
    });
  };

  const lower = query.toLowerCase();
  const match = s0 => !lower || String(s0 || '').toLowerCase().includes(lower);

  if (!query) {
    add('Quick actions', [
      { title: 'Add transaction', sub: 'Income, expense or transfer', icon: 'plus', run: () => openTxnModal() },
      { title: 'Go to Dashboard', icon: 'home', run: () => navigate('dashboard') },
      { title: 'Open Reports', icon: 'file', run: () => navigate('reports') },
      { title: 'Lock vault', icon: 'lock', run: () => lockNow() },
    ]);
  }

  add('Pages', ROUTES.filter(r => !r.hidden && match(r.label)).slice(0, 6)
    .map(r => ({ title: r.label, icon: r.icon, sub: 'Page', run: () => navigate(r.path) })));

  if (query) {
    const txns = state.transactions
      .filter(t => match(t.notes) || match(store.catName(t.categoryId)) || match((t.tags || []).join(' ')) || match(t.merchant) || String(t.amount).includes(lower))
      .slice(0, 40);
    add('Transactions', sortBy(txns, t => t.date, -1).slice(0, 6).map(t => ({
      title: t.notes || store.catName(t.categoryId), icon: t.type === 'income' ? 'trend' : 'swap',
      sub: `${fmtDate(t.date)} · ${store.catName(t.categoryId)} · ${store.accName(t.accountId)}`,
      right: `${t.type === 'income' ? '+' : '−'}${fmtMoney(t.base)}`,
      run: () => { navigate('tracker'); setTimeout(() => openTxnModal(t), 260); },
    })));

    add('Contacts', state.contacts.filter(c => match(c.name) || match(c.phone)).slice(0, 4).map(c => ({
      title: c.name, icon: 'user', sub: c.phone || 'Credit book contact',
      right: fmtMoney(store.contactBalance(c.id)), run: () => navigate(`credit/${c.id}`),
    })));

    add('Investments', state.investments.filter(i => match(i.name) || match(i.category)).slice(0, 4).map(i => ({
      title: i.name, icon: 'trend', sub: i.category,
      right: fmtMoney(store.investmentMetrics(i).current), run: () => navigate('investments'),
    })));

    add('Campaigns', state.campaigns.filter(c => match(c.name) || match(c.channel)).slice(0, 3).map(c => ({
      title: c.name, icon: 'mega', sub: c.channel, run: () => navigate('marketing'),
    })));

    add('Bills', state.bills.filter(b => match(b.name)).slice(0, 3).map(b => ({
      title: b.name, icon: 'clock', sub: `Due ${fmtDate(b.dueDate)}`, right: fmtMoney(b.amount), run: () => navigate('bills'),
    })));

    add('Goals', state.goals.filter(g => match(g.name)).slice(0, 3).map(g => ({
      title: g.name, icon: 'flame', sub: `${Math.round(store.goalStatus(g).pct)}% funded`, run: () => navigate('goals'),
    })));

    add('Categories', state.categories.filter(c => match(c.name)).slice(0, 4).map(c => ({
      title: c.name, icon: 'tag', sub: `${c.kind} category`, run: () => navigate('categories'),
    })));
  }

  if (!cmdkItems.length && query) res.append(empty('No results', `Nothing matched “${query}”.`, 'search'));
  $('#cmdk-count').textContent = cmdkItems.length ? `${cmdkItems.length} result${cmdkItems.length > 1 ? 's' : ''}` : '';
  highlightCmdk();
}
function highlightCmdk() {
  cmdkItems.forEach((it, i) => it.el.classList.toggle('on', i === cmdkIndex));
  cmdkItems[cmdkIndex]?.el.scrollIntoView({ block: 'nearest' });
}

/* ═══════════ NOTIFICATIONS PANEL ═══════════ */
function openNotifications() {
  const rows = sortBy(state.notifications, n => n.at, -1).slice(0, 60);
  const body = h('div', {});
  if (!rows.length) body.append(empty('All clear', 'No alerts right now. We will notify you about due bills, budget limits and overdue receivables.', 'bell'));
  rows.forEach(n => {
    body.append(h('div', { class: 'insight ' + (n.level === 'danger' ? 'neg' : n.level === 'warn' ? 'warn' : ''),
      style: { marginBottom: '9px', cursor: n.route ? 'pointer' : 'default', opacity: n.read ? .62 : 1 },
      onClick: () => { if (n.route) { s0.close(); navigate(n.route); } } },
      h('div', { class: 'ic', html: icon(n.type === 'bill' ? 'clock' : n.type === 'budget' ? 'target' : n.type === 'credit' ? 'book' : 'bell', 15) }),
      h('div', { class: 'tt' }, h('b', { text: n.title }), h('p', { text: n.body || '' }),
        h('div', { class: 'tiny t3', style: { marginTop: '3px' }, text: relTime(n.at) }))));
  });
  const s0 = sheet({
    title: `Notifications${store.unreadCount() ? ` (${store.unreadCount()})` : ''}`,
    body,
    footer: frag(
      h('button', { class: 'btn sm', onClick: async () => { await store.markAllRead(); s0.close(); updateBell(); } }, 'Mark all read'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn sm', onClick: () => { s0.close(); navigate('notifications'); } }, 'Open centre')),
  });
  store.markAllRead().then(updateBell);
}
function updateBell() {
  const n = store.unreadCount();
  const badge = $('#bell-badge');
  badge.hidden = !n;
  badge.textContent = n > 99 ? '99+' : String(n);
  renderNav();
}

/* ═══════════ GOOGLE DRIVE BACKUP ═══════════ */
/**
 * Reconnects silently and, if the user asked for it, keeps a copy in their own
 * Drive. Rate-limited to once an hour and skipped when nothing changed, so it
 * never becomes a background upload loop.
 */
const DRIVE_MIN_GAP_MS = 60 * 60 * 1000;
let driveMod = null;
let driveDirty = false;

async function initDriveBackup() {
  try {
    driveMod = await import('./gdrive.js');
    // `resume` is a no-op unless this device has connected before, so this
    // costs nothing for people who never touch Drive.
    if (!(await driveMod.resume())) return;
    bus.on('change', ({ store: st }) => { if (st !== 'audit') driveDirty = true; });
    setInterval(driveAutoBackup, 10 * 60 * 1000);
  } catch (e) { console.warn('[drive] unavailable', e); }
}

async function driveAutoBackup() {
  if (!driveMod || !settings.gdriveAuto || !driveDirty) return;
  if (driveMod.drive.status !== 'ready') return;
  const last = driveMod.drive.lastBackupAt || 0;
  if (Date.now() - last < DRIVE_MIN_GAP_MS) return;
  try {
    driveDirty = false;
    await driveMod.backupNow({ label: 'auto' });
  } catch (e) {
    driveDirty = true;                 // failed, so the next tick should retry
    console.warn('[drive] auto backup failed', e.message);
  }
}

/* ═══════════ QUICK ADD ═══════════ */
/**
 * The toolbar Add and the button in the page header used to be the same thing
 * twice — on Investments you got "Add" (a transaction) sitting next to
 * "New investment". Now they have different jobs: the page button is the
 * one-click primary for that screen, and this is "add anything from anywhere",
 * led by whatever the current screen is actually about.
 */
function openAddMenu(anchor) {
  const own = currentPageAction();
  const ownLabel = own ? (own.textContent || '').trim() : '';
  // Skip the screen's own action when it is already one of the entries below,
  // so the same words never appear twice in one menu.
  const globals = [
    { label: 'New expense', icon: 'minus', onClick: () => openTxnModal(null, { defaultType: 'expense' }) },
    { label: 'New income', icon: 'plus', onClick: () => openTxnModal(null, { defaultType: 'income' }) },
    { label: 'Transfer between accounts', icon: 'repeat', onClick: () => openTxnModal(null, { defaultType: 'transfer' }) },
    { label: 'New budget', icon: 'target', onClick: () => openTxnModal(null, { defaultType: 'budget' }) },
  ];
  const duplicate = globals.some(g => g.label.toLowerCase() === ownLabel.toLowerCase())
    || /^(add|new) transaction$/i.test(ownLabel);
  const items = [];
  if (own && ownLabel && !duplicate) {
    items.push({ label: ownLabel, icon: 'sparkle', onClick: () => own.click() }, '-');
  }
  items.push(...globals);
  menu(anchor, items);
}

/* ═══════════ FOOTER STATS ═══════════ */
let syncMod = null;

async function updateFootStats() {
  const u = await db.usage();
  const pct = u.quota ? ((u.used / u.quota) * 100).toFixed(1) : '0';
  $('#foot-stats').textContent =
    `${state.transactions.length.toLocaleString()} transactions · ${(u.used / 1048576).toFixed(1)} MB used (${pct}% of quota)${db.isMemoryMode() ? ' · MEMORY MODE' : ''}`;
  updateSyncPill();
}

/** Drawer pill: reflects cloud sync when signed in, storage state otherwise. */
function updateSyncPill() {
  const pill = $('#sync-pill');
  const text = $('#sync-text');
  if (!pill || !text) return;
  pill.classList.remove('off', 'busy');

  if (db.isMemoryMode()) { pill.classList.add('off'); text.textContent = 'Memory only'; return; }
  if (!navigator.onLine) { pill.classList.add('off'); text.textContent = 'Offline · queued'; return; }

  const s = syncMod?.sync;
  if (!s || s.status === 'signed-out') { text.textContent = 'Local only'; pill.title = 'Sign in under Settings → Account to sync'; return; }
  const map = {
    idle: ['Cloud · synced', ''], syncing: ['Syncing…', 'busy'], offline: ['Offline · queued', 'off'],
    locked: ['Passphrase needed', 'off'], conflict: ['Sync conflict', 'off'], error: ['Sync error', 'off'],
  };
  const [label, cls] = map[s.status] || ['Cloud', ''];
  if (cls) pill.classList.add(cls);
  text.textContent = s.pending && s.status === 'idle' ? 'Cloud · pending' : label;
  pill.title = s.lastError || (s.lastSyncedAt ? `Last sync ${new Date(s.lastSyncedAt).toLocaleTimeString()}` : '');
}

/** Load the sync engine only if a backend is actually deployed at this origin. */
async function initSync() {
  try {
    const mod = await import('./sync.js');
    if (!(await mod.isAvailable())) return;      // static hosting: stay fully local
    syncMod = mod;
    mod.onSyncChange(() => { updateSyncPill(); renderProfile(); });
    await mod.init();
    updateSyncPill();
    renderProfile();          // shows the sign-in card once we know the state
    if (mod.sync.status === 'locked') {
      toast('Enter your vault passphrase to resume cloud sync', 'warn', {
        timeout: 9000, action: 'Open', onAction: () => navigate('settings'),
      });
    }
  } catch (e) { console.warn('[sync] unavailable', e); }
}

/**
 * Shows the landing page when there is a backend and nobody is signed in.
 * Skipping is remembered, so choosing "offline" is a one-time decision rather
 * than a wall the app throws up on every launch.
 */
async function maybeShowLanding() {
  if (!syncMod || syncMod.sync.status !== 'signed-out') return;
  try {
    const { showLanding, hasSkipped } = await import('./landing.js');
    if (hasSkipped()) return;
    $('#splash').classList.add('gone');
    await new Promise(resolve => showLanding(syncMod, resolve));
  } catch (e) {
    // A stale service-worker cache or a dropped connection must never strand
    // the user on a blank screen: fall through to the app, which works offline.
    console.warn('[landing] unavailable', e);
    $('#landing').hidden = true;
    document.body.classList.remove('landing-open');
  }
}

/** Re-opens the landing page on demand — the drawer card and padlock use this. */
export async function openLanding() {
  if (!syncMod) { navigate('settings/account'); return; }
  try {
    const { showLanding, clearSkip } = await import('./landing.js');
    clearSkip();
    closeDrawer();
    showLanding(syncMod, signedIn => { if (signedIn) location.reload(); });
  } catch (e) {
    console.warn('[landing] unavailable', e);
    navigate('settings/account');
  }
}

/* ═══════════ FIRST-RUN ═══════════ */
async function firstRun() {
  return new Promise(resolve => {
    const f = form([
      { key: 'baseCurrency', label: 'Base currency', type: 'select', required: true,
        options: (window.__CUR__ || []).length ? window.__CUR__ : [['USD', 'USD — US Dollar'], ['EUR', 'EUR — Euro'], ['GBP', 'GBP — Pound'], ['INR', 'INR — Rupee'], ['PKR', 'PKR — Pakistani Rupee'], ['BDT', 'BDT — Taka'], ['AED', 'AED — Dirham'], ['SAR', 'SAR — Riyal'], ['CAD', 'CAD — Canadian Dollar'], ['AUD', 'AUD — Australian Dollar'], ['NGN', 'NGN — Naira'], ['ZAR', 'ZAR — Rand']] },
      { key: 'openingCash', label: 'Cash on hand today', type: 'money', value: 0, hint: 'Sets the opening balance of your Cash account' },
      { key: 'openingBank', label: 'Bank balance today', type: 'money', value: 0 },
      { key: 'mode', label: 'Appearance', type: 'chips', value: 'system', col: 'full',
        options: [['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark']] },
      { key: 'demo', label: 'Load a demo workspace (12 months of realistic sample data)', type: 'switch', value: false, col: 'full' },
    ], {}, { columns: 2 });

    const m = modal({
      title: 'Welcome to Cash Checker',
      subtitle: 'Your data stays on this device. Nothing is uploaded anywhere.',
      size: '', closeOnBack: false,
      body: frag(
        h('div', { class: 'hero mb' }, h('div', { class: 'rel' },
          h('div', { class: 'row', style: { gap: '10px' } },
            h('span', { html: icon('shield', 26), style: { display: 'grid' } }),
            h('div', {}, h('b', { text: 'Local-first & private' }),
              h('div', { class: 'tiny t2', text: 'Encrypted-at-rest backups, PIN + biometric lock, full audit trail.' }))))),
        f.el),
      footer: frag(h('div', { class: 'spacer' }),
        h('button', { class: 'btn primary', onClick: async e => {
          if (!f.validate()) return;
          e.currentTarget.disabled = true;
          e.currentTarget.textContent = 'Setting up…';
          const v = f.read();
          await store.setSettings({ baseCurrency: v.baseCurrency, mode: v.mode, onboarded: true });
          applyTheme(v.mode);
          await seedStarterData({ cash: Number(v.openingCash) || 0, bank: Number(v.openingBank) || 0 });
          if (v.demo) await seedDemoData();
          m.close();
          resolve();
        } }, 'Start')),
    });
  });
}

/* ═══════════ AUTOMATION TICK ═══════════ */
async function automationTick() {
  try {
    if (settings.lastRecurringRun !== today()) {
      const n = await store.runRecurring();
      if (n) toast(`${n} recurring transaction${n > 1 ? 's' : ''} posted automatically`, 'info');
    }
    await store.refreshAlerts();
    updateBell();
    // daily digest
    if (settings.notifyDigest && settings.lastDigest !== today()) {
      const p = { from: today(), to: today() };
      const inc = store.incomeIn(p.from, p.to), exp = store.expenseIn(p.from, p.to);
      const due = store.billsDue({ within: 1 }).length;
      if (inc || exp || due) {
        await store.pushNotification({ key: `digest-${today()}`, type: 'digest', level: 'info',
          title: 'Daily summary', body: `In ${fmtMoney(inc)} · Out ${fmtMoney(exp)}${due ? ` · ${due} bill(s) due` : ''}`, route: '#/dashboard' });
      }
      await store.setSetting('lastDigest', today());
    }
  } catch (e) { console.warn('[automation]', e); }
}

/* ═══════════ BACKUP DRAG-DROP ═══════════ */
function wireDropImport() {
  let depth = 0;
  const hint = $('#drop-hint');
  addEventListener('dragenter', e => { if (![...e.dataTransfer.types].includes('Files')) return; depth++; hint.hidden = false; });
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; hint.hidden = true; } });
  addEventListener('drop', async e => {
    e.preventDefault(); depth = 0; hint.hidden = true;
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!/\.json$/i.test(file.name)) { toast('Drop a Cash Checker .json backup file', 'warn'); return; }
    try {
      const json = JSON.parse(await file.text());
      const ok = await confirm({ title: 'Restore this backup?', danger: true,
        message: `“${file.name}” was exported ${json.exportedAt ? new Date(json.exportedAt).toLocaleString() : 'at an unknown time'}. Restoring replaces all current data.`,
        confirmText: 'Replace everything' });
      if (!ok) return;
      await store.importBackup(json, 'replace');
      toast('Backup restored', 'ok');
      trainCategorizer();
      router();
    } catch (err) { toast(err.message || 'Could not read that file', 'err'); }
  });
}

/* ═══════════ KEYBOARD ═══════════ */
function wireKeys() {
  addEventListener('keydown', e => {
    // The lock and landing overlays cover the app; shortcuts must not reach through
    // them, or Ctrl+K opens a palette the user cannot see but can still drive.
    if (!unlocked || !$('#landing').hidden) return;
    const typing = /input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openCmdk(); return; }
    if (!$('#cmdk').hidden) {
      if (e.key === 'Escape') { closeCmdk(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); cmdkIndex = Math.min(cmdkItems.length - 1, cmdkIndex + 1); highlightCmdk(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); cmdkIndex = Math.max(0, cmdkIndex - 1); highlightCmdk(); return; }
      if (e.key === 'Enter') { e.preventDefault(); const fn = cmdkItems[cmdkIndex]?.run; if (fn) fn(); closeCmdk(); return; }
      return;
    }
    if (typing) return;
    if (e.key === '/') { e.preventDefault(); openCmdk(); }
    else if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); openTxnModal(); }
    else if (e.key.toLowerCase() === 'l' && (e.ctrlKey || e.metaKey) && e.shiftKey) { e.preventDefault(); lockNow(); }
    else if (e.key === '?') { showShortcuts(); }
    else if (/^[1-9]$/.test(e.key)) {
      const visible = ROUTES.filter(r => !r.hidden);
      const r = visible[Number(e.key) - 1];
      if (r) navigate(r.path);
    }
  });
  ['mousemove', 'keydown', 'click', 'touchstart'].forEach(ev =>
    addEventListener(ev, debounce(() => { if (unlocked || !settings.pinEnabled) resetLockTimer(); }, 800), { passive: true }));
}
function showShortcuts() {
  modal({
    title: 'Keyboard shortcuts', size: 'narrow',
    body: h('dl', { class: 'kv' },
      ...[['Ctrl / ⌘ + K', 'Global search'], ['/', 'Global search'], ['N', 'New transaction'],
          ['1 – 9', 'Jump to nav item'], ['Ctrl + Shift + L', 'Lock vault'], ['Esc', 'Close dialog'],
          ['Ctrl / ⌘ + Enter', 'Save open form'], ['?', 'This help']]
        .flatMap(([k, v]) => [h('dt', { text: v }), h('dd', {}, h('kbd', { text: k }))])),
  });
}

/* ═══════════ SERVICE WORKER ═══════════ */
async function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js', { scope: './' });
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('A new version is ready', 'info', { timeout: 12000, action: 'Reload', onAction: () => location.reload() });
        }
      });
    });
  } catch (e) { console.warn('[sw]', e); }
}

/* ═══════════ BOOT ═══════════ */
async function boot() {
  window.__CUR__ = (await import('./util.js')).CURRENCIES.map(([c]) => [c, c]);
  await store.load();
  applyTheme();
  applyPrivacy(settings.privacyMode);
  await db.persist();

  buildPinPad();
  drawPinDots();

  // wire shell
  $('#menu-btn').onclick = openDrawer;
  $('#drawer-close').onclick = closeDrawer;
  $('#scrim').onclick = closeDrawer;
  $('#quick-add').onclick = e => openAddMenu(e.currentTarget);
  $('#bell').onclick = openNotifications;
  // The padlock locks the app once a PIN exists; before that it is the fastest
  // route to the account screen, which is what people actually reach for.
  $('#lock-btn').onclick = () => {
    if (settings.pinEnabled) lockNow();
    else if (syncMod && syncMod.sync.status === 'signed-out') openLanding();
    else navigate('settings/security');
  };
  $('#lock-btn').title = 'Account & security';
  $('#search-open').onclick = openCmdk;
  $('#search-open-m').onclick = openCmdk;
  $('#cmdk').addEventListener('mousedown', e => { if (e.target.id === 'cmdk') closeCmdk(); });
  $('#cmdk-q').addEventListener('input', debounce(e => runCmdk(e.target.value), 130));
  $('#theme-btn').onclick = async () => {
    const order = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(settings.mode) + 1) % 3];
    await store.setSetting('mode', next);
    applyTheme(next);
    toast(`Theme: ${next === 'system' ? 'match system' : next}`, 'info', { timeout: 1500 });
  };
  $('#lock-bio').onclick = biometricUnlock;
  $('#lock-reset').onclick = async () => {
    const ok = await confirm({ title: 'Forgot your PIN?', danger: true,
      message: 'Your PIN protects local access only — it does not encrypt the database. You can disable it, but for safety this wipes nothing: choose "Disable PIN" to regain access, then set a new one in Settings.',
      confirmText: 'Disable PIN' });
    if (ok) { await store.setSettings({ pinEnabled: false, pinHash: null, pinSalt: null }); unlock(); toast('PIN disabled — set a new one in Settings', 'warn'); }
  };
  $('#app-ver').textContent = settings.version || '1.0.0';

  addEventListener('hashchange', router);
  addEventListener('online', updateFootStats);
  addEventListener('offline', updateFootStats);
  wireKeys();
  wireDropImport();

  bus.on('change', debounce(() => { renderDrawerNet(); renderProfile(); updateBell(); updateFootStats(); }, 250));
  bus.on('settings', renderProfile);
  bus.on('change', ({ store: st }) => { if (st === 'transactions' || st === 'categories' || st === 'rules') trainCategorizer(); });

  // The landing page is the front door: sign in, sign up, or carry on offline.
  // It runs before first-run setup because signing in may pull a workspace that
  // is already set up, which makes the setup wizard the wrong question to ask.
  await initSync();
  await maybeShowLanding();

  // storage unavailable — never let this look like a fresh install
  if (db.isMemoryMode()) {
    $('#splash').classList.add('gone');
    $('#app').hidden = false;
    await new Promise(resolve => {
      const m = modal({
        title: 'Running without local storage', size: 'narrow', closeOnBack: false,
        subtitle: db.openError() || 'IndexedDB could not be opened',
        body: frag(
          h('p', { class: 't2', style: { fontSize: '.87rem', lineHeight: 1.6 },
            text: 'Cash Checker could not open its database, so it is running entirely in memory. Any existing data is still on disk and untouched — but nothing you enter now will be saved.' }),
          h('p', { class: 't2 mt', style: { fontSize: '.87rem', lineHeight: 1.6 },
            text: 'This is usually caused by another tab holding an older version of the app open, or by private browsing. Close other Cash Checker tabs and reload.' })),
        footer: frag(h('div', { class: 'spacer' }),
          h('button', { class: 'btn', onClick: () => { m.close(); resolve(); } }, 'Continue anyway'),
          h('button', { class: 'btn primary', onClick: () => location.reload() }, 'Reload')),
      });
    });
  } else if (!settings.onboarded) {
    // first run
    $('#splash').classList.add('gone'); $('#app').hidden = false; await firstRun();
  }

  trainCategorizer();
  renderNav();
  renderProfile();
  applyTheme();
  applyPrivacy(settings.privacyMode);
  renderDrawerNet();
  updateBell();
  updateFootStats();

  if (settings.pinEnabled) showLock(); else { $('#app').hidden = false; unlocked = true; resetLockTimer(); }
  $('#splash').classList.add('gone');
  setTimeout(() => $('#splash').remove(), 600);

  await router();
  automationTick();
  setInterval(automationTick, 5 * 60 * 1000);
  registerSW();
  initDriveBackup();

  // expose a small console API for power users / debugging
  window.CashChecker = { navigate, toast, version: settings.version, lock: lockNow };
}

addEventListener('DOMContentLoaded', () => {
  boot().catch(err => {
    console.error(err);
    document.body.innerHTML = `<div style="padding:2rem;font:14px system-ui;max-width:640px;margin:auto">
      <h1 style="margin-bottom:.6rem">Cash Checker could not start</h1>
      <p style="opacity:.75;line-height:1.6">${esc(err.message || String(err))}</p>
      <pre style="margin-top:1rem;padding:1rem;background:#0002;border-radius:8px;overflow:auto;font-size:12px">${esc(err.stack || '')}</pre></div>`;
  });
});

export { openCmdk, openNotifications, updateBell, applyTheme, renderNav };
