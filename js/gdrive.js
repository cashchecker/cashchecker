/* ═══════════ gdrive.js — backup into the user's own Google Drive ═══════════

   Why this exists: the local database is the source of truth, and the app's own
   cloud sync is optional. This adds a second, independent copy that lives in an
   account the user already owns and already trusts — so losing a phone, a
   browser profile or even this whole project cannot take the data with it.

   Design rules:

   1. The scope is `drive.file`, not full Drive access. Google grants it without
      a verification review, and it lets this app touch ONLY the files it
      created — it can never read the rest of someone's Drive.
   2. Backups land in a normal, visible folder. The user can open, download or
      delete them without this app, which is the point of an escape hatch.
   3. The client ID is public by design (it ships in every browser that loads
      the page). There is no client secret in this flow, and none is needed.
   4. Nothing is ever deleted to make room without being asked.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as store from './store.js';
import { emitter } from './util.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER = 'Cash Checker Backups';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const STATE_KEY = 'cc.gdrive';

export const drive = {
  status: 'disconnected',   // disconnected | connecting | ready | working | error
  email: null,
  lastBackupAt: null,
  lastError: null,
  folderId: null,
};

const bus = emitter();
export const onDriveChange = fn => bus.on('drive', fn);
const emit = patch => { Object.assign(drive, patch); bus.emit('drive', drive); };

const loadState = () => { try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch { return {}; } };
const saveState = s => localStorage.setItem(STATE_KEY, JSON.stringify(s));

/* ---------- configuration ----------
   The client ID identifies the APP to Google, not the user. Shipping it means
   nobody has to make a Google Cloud project of their own — they just click
   Connect and grant access to their own Drive. It is public by design: it is
   visible in every browser that loads this page, and it is useless without a
   user's explicit consent and an origin Google has been told to accept. */
const DEFAULT_CLIENT_ID = '1037531796827-pjca2bvo3o05ul2d59jftblmisnd6ql0.apps.googleusercontent.com';

/** A per-device override, for anyone who would rather use their own project. */
export const clientId = () => (store.settings.gdriveClientId || '').trim() || DEFAULT_CLIENT_ID;
export const isConfigured = () => !!clientId();
export const usingOwnClientId = () => !!(store.settings.gdriveClientId || '').trim();

/* ---------- token ---------- */
let token = null;          // { value, expiresAt }
let tokenClient = null;
let gisReady = null;

/* Google's access tokens live ~1 hour. Keeping the current one across reloads
   means a refresh inside that window stays connected without touching Google —
   at boot the browser blocks the popup a renewal would need, so without this
   the app looked disconnected after every refresh. */
{
  const saved = loadState().token;
  if (saved?.value && Date.now() < saved.expiresAt - 60_000) token = saved;
}

function loadGis() {
  if (gisReady) return gisReady;
  gisReady = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => (window.google?.accounts?.oauth2 ? resolve() : reject(new Error('Google sign-in loaded but did not initialise')));
    s.onerror = () => { gisReady = null; reject(new Error('Could not reach Google — check your connection')); };
    document.head.append(s);
  });
  return gisReady;
}

const tokenValid = () => token && Date.now() < token.expiresAt - 60_000;

/**
 * Asks Google for an access token. `interactive: false` reuses an existing
 * grant silently; the first connection needs a real click, because browsers
 * block the popup otherwise.
 */
async function getToken({ interactive = false } = {}) {
  if (tokenValid()) return token.value;
  if (!isConfigured()) throw new Error('Add your Google client ID in Settings first');
  await loadGis();

  return new Promise((resolve, reject) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId(),
      scope: SCOPE,
      callback: res => {
        if (res.error) { reject(new Error(describeTokenError(res))); return; }
        token = { value: res.access_token, expiresAt: Date.now() + (Number(res.expires_in) || 3600) * 1000 };
        saveState({ ...loadState(), token });
        resolve(token.value);
      },
      error_callback: err => reject(new Error(describeTokenError(err))),
    });
    tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
  });
}

function describeTokenError(res) {
  const t = res?.type || res?.error || '';
  if (/popup_closed|popup_failed/i.test(t)) return 'The Google window was closed before finishing';
  if (/access_denied/i.test(t)) return 'Google access was declined';
  if (/idpiframe|invalid_client|unauthorized_client/i.test(t)) {
    return 'Google rejected the client ID. Check it is correct and that this site is listed under "Authorised JavaScript origins".';
  }
  return res?.error_description || res?.message || 'Google sign-in failed';
}

/* ---------- REST ---------- */
/* Silent renewal fails when the browser suppresses Google's hidden popup.
   Inside a real user gesture (a click on Back up / Restore) a visible popup is
   allowed, so retry interactively there; from timers it would just be blocked
   again, so let the caller see the original failure. */
async function ensureToken() {
  try { return await getToken(); }
  catch (e) {
    if (navigator.userActivation?.isActive) return getToken({ interactive: true });
    throw e;
  }
}

async function api(path, { method = 'GET', headers = {}, body, raw = false, base = 'https://www.googleapis.com/drive/v3' } = {}) {
  const access = await ensureToken();
  const res = await fetch(`${base}${path}`, {
    method, body,
    headers: { Authorization: `Bearer ${access}`, ...headers },
  });
  if (res.status === 401) {           // token died early — one clean retry
    token = null;
    saveState({ ...loadState(), token: null });
    const retryAccess = await ensureToken();
    const retry = await fetch(`${base}${path}`, { method, body, headers: { Authorization: `Bearer ${retryAccess}`, ...headers } });
    if (!retry.ok) throw new Error(await driveError(retry));
    return raw ? retry : retry.json();
  }
  if (!res.ok) throw new Error(await driveError(res));
  return raw ? res : res.json();
}

async function driveError(res) {
  let msg = `Google Drive returned ${res.status}`;
  try {
    const d = await res.json();
    if (d?.error?.message) msg = d.error.message;
  } catch { /* keep the status line */ }
  if (res.status === 403 && /insufficient|scope/i.test(msg)) {
    return 'Google did not grant Drive access — reconnect and accept the permission';
  }
  return msg;
}

/* ---------- folder ---------- */
async function ensureFolder() {
  const cached = loadState().folderId;
  if (cached) {
    try {
      const f = await api(`/files/${cached}?fields=id,trashed`);
      if (f && !f.trashed) { emit({ folderId: cached }); return cached; }
    } catch { /* fall through and make a new one */ }
  }
  const q = encodeURIComponent(`name='${FOLDER}' and mimeType='${FOLDER_MIME}' and trashed=false`);
  const found = await api(`/files?q=${q}&fields=files(id,name)&pageSize=1`);
  let id = found.files?.[0]?.id;
  if (!id) {
    const made = await api('/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER, mimeType: FOLDER_MIME }),
    });
    id = made.id;
  }
  saveState({ ...loadState(), folderId: id });
  emit({ folderId: id });
  return id;
}

/* ---------- public API ---------- */
export async function connect() {
  emit({ status: 'connecting', lastError: null });
  try {
    // User explicitly reconnected — clear the disconnect flag so resume() works after reloads
    const s = loadState();
    if (s.userDisconnected) { delete s.userDisconnected; saveState(s); }
    await getToken({ interactive: true });
    const me = await api('/about?fields=user(emailAddress)').catch(() => null);
    const email = me?.user?.emailAddress || null;
    await ensureFolder();
    saveState({ ...loadState(), connected: true, email });
    emit({ status: 'ready', email });
    return { email };
  } catch (e) {
    emit({ status: 'error', lastError: e.message });
    throw e;
  }
}

export function disconnect() {
  const t = token?.value;
  token = null;
  // Revoking is best-effort: the grant should not outlive the user's intent.
  if (t && window.google?.accounts?.oauth2) {
    try { window.google.accounts.oauth2.revoke(t, () => {}); } catch { /* ignore */ }
  }
  saveState({ ...loadState(), connected: false, email: null, token: null, userDisconnected: true });
  emit({ status: 'disconnected', email: null, lastError: null });
}

/** Reconnects at boot when the user has connected before. The stored grant is
    the source of truth: once someone connected and never hit Disconnect, they
    stay connected across reloads. The saved token covers the first hour; after
    it expires we try one silent renewal, and if the browser blocks that (it
    usually does at boot — no user gesture), we still stay "connected" and renew
    on demand inside the next real click instead of flipping the UI to off. */
export async function resume() {
  const s = loadState();
  if (s.userDisconnected) { emit({ status: 'disconnected', email: null, lastBackupAt: s.lastBackupAt || null }); return false; }
  if (!s.connected || !isConfigured()) return false;
  const ready = () => emit({ status: 'ready', email: s.email || null, lastBackupAt: s.lastBackupAt || null });
  if (tokenValid()) { ready(); return true; }
  try { await getToken({ interactive: false }); } catch { /* renewed on the next user action */ }
  ready();
  return true;
}

/** Uploads a fresh backup. Returns the created file's metadata. */
export async function backupNow({ label = '' } = {}) {
  emit({ status: 'working', lastError: null });
  try {
    const folderId = await ensureFolder();
    const backup = await store.exportBackup({ includeVolatile: true });
    const records = Object.values(backup.counts || {}).reduce((a, b) => a + b, 0);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = `cashchecker-${stamp}${label ? `-${label}` : ''}.json`;
    const json = JSON.stringify(backup);

    const boundary = `cc${Math.random().toString(36).slice(2)}`;
    const meta = { name, parents: [folderId], mimeType: 'application/json',
      description: `Cash Checker backup · ${records} records` };
    const body = [
      `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify(meta),
      `--${boundary}`, 'Content-Type: application/json', '', json,
      `--${boundary}--`, '',
    ].join('\r\n');

    const file = await api('/files?uploadType=multipart&fields=id,name,size,modifiedTime', {
      method: 'POST',
      base: 'https://www.googleapis.com/upload/drive/v3',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });

    const at = Date.now();
    saveState({ ...loadState(), lastBackupAt: at });
    emit({ status: 'ready', lastBackupAt: at });
    await store.audit('export', 'system', '', `Backed up to Google Drive (${records} records)`);
    return { ...file, records };
  } catch (e) {
    emit({ status: 'error', lastError: e.message });
    throw e;
  }
}

export async function listBackups() {
  const folderId = await ensureFolder();
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const r = await api(`/files?q=${q}&orderBy=modifiedTime desc&pageSize=50&fields=files(id,name,size,modifiedTime,description)`);
  return r.files || [];
}

export async function downloadBackup(fileId) {
  const res = await api(`/files/${fileId}?alt=media`, { raw: true });
  return res.json();
}

export async function deleteBackup(fileId) {
  await api(`/files/${fileId}`, { method: 'DELETE', raw: true });
}

/** Keeps the newest `keep` backups and removes the rest. Never runs unasked. */
export async function prune(keep = 20) {
  const files = await listBackups();
  const doomed = files.slice(keep);
  for (const f of doomed) await deleteBackup(f.id).catch(() => {});
  return doomed.length;
}
