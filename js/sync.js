/* ═══════════ sync.js — email login + end-to-end encrypted cloud sync ═══════════

   Design rules, in order of priority:

   1. The device stays the source of truth. IndexedDB keeps working exactly as
      before; the cloud is an encrypted mirror. Losing the passphrase, the
      network or the whole Cloudflare account never costs you local data.
   2. The server only ever receives ciphertext. The vault is gzipped, then
      encrypted with AES-256-GCM using a key derived from your passphrase via
      PBKDF2-SHA256 (250k iterations). The key never leaves the browser.
   3. Nothing overwrites silently. Every push carries the version it was based
      on; if the server moved on, the push is refused and the user chooses.
   ══════════════════════════════════════════════════════════════════════════ */

import * as store from './store.js';
import { state, settings } from './store.js';
import * as db from './db.js';
import {
  b64, unb64, deriveKey, pbkdf2, uid, debounce,
  randomRecoveryCode, normaliseRecoveryCode, generateMasterKey, importMasterKey,
  wrapMasterKey, unwrapMasterKey, randomSalt,
  deriveAccountSecrets, wrapWithKey, unwrapWithKey,
} from './util.js';

const SESSION_KEY = 'cc.session';
const STATE_KEY = 'cc.syncState';

export const sync = {
  status: 'signed-out',   // signed-out | locked | idle | syncing | offline | conflict | error
  email: null,
  lastError: null,
  lastSyncedAt: null,
  version: 0,
  pending: false,
};

const listeners = new Set();
export const onSyncChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
function emit(patch = {}) {
  Object.assign(sync, patch);
  listeners.forEach(fn => { try { fn(sync); } catch (e) { console.warn(e); } });
}

/* ---------- session persistence ---------- */
const loadSession = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } };
const saveSession = s => localStorage.setItem(SESSION_KEY, JSON.stringify(s));
const clearSession = () => localStorage.removeItem(SESSION_KEY);
const loadState = () => { try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch { return {}; } };
const saveState = s => localStorage.setItem(STATE_KEY, JSON.stringify(s));

let session = loadSession();
let vaultKey = null;          // non-extractable CryptoKey, never serialised
let syncing = false;
/** Guard against re-entrant pushes (e.g., two rapid edits before syncing flag resets). */
let syncPromise = null;

/* ---------- API ---------- */
/** Same origin by default: the Worker serves both the app and /api. */
export const apiBase = () => (localStorage.getItem('cc.apiBase') || '').replace(/\/$/, '');

async function apiFetch(path, { method = 'GET', body, auth = true } = {}, retries = 2) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && session?.token) headers.Authorization = `Bearer ${session.token}`;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetch(`${apiBase()}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (err) {
      lastErr = err;
      if (attempt < retries) { await new Promise(r => setTimeout(r, 500 * 2 ** attempt)); continue; }
      throw Object.assign(new Error('Cannot reach the server — you appear to be offline'), { offline: true });
    }
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 200) }; }
    if (res.status === 401 && auth) { signOutLocal(); throw new Error('Your session expired — sign in again'); }
    if (res.status === 409) throw Object.assign(new Error('conflict'), { conflict: true, ...data });
    if (!res.ok) {
      if (res.status >= 500 && attempt < retries) { await new Promise(r => setTimeout(r, 500 * 2 ** attempt)); continue; }
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  }
  throw lastErr;
}

/** Is a backend actually deployed here? Used to hide sync UI on plain static hosting. */
export async function isAvailable() {
  try { await apiFetch('/api/health', { auth: false }); return true; }
  catch { return false; }
}

/* ═══════════ email + password ═══════════ */

/** Has this email got an account already? Drives sign-in vs sign-up. */
export async function accountExists(email) {
  try {
    const r = await apiFetch('/api/auth/exists', { method: 'POST', body: { email }, auth: false });
    return !!r.exists;
  } catch { return false; }
}

/**
 * Derives the value that proves ownership of a recovery code to the server.
 *
 * It reuses the password derivation deliberately: the salt is sha256(email), so
 * the browser can compute it from nothing but the email and the code — no
 * server round-trip first, and therefore no oracle that confirms an address.
 * Only the auth half is used here; the master key is still unwrapped locally
 * with the separate, stored `recoverySalt`.
 */
async function recoveryAuthSecretFor(email, recoveryCode) {
  const { authSecret } = await deriveAccountSecrets(email, normaliseRecoveryCode(recoveryCode));
  return authSecret;
}

/**
 * Create the account. One password does two jobs: it authenticates you AND
 * unlocks the vault, but the server only ever receives the auth half.
 * Returns the recovery code — shown once.
 */
export async function signUp(email, password) {
  const { encKey, authSecret } = await deriveAccountSecrets(email, password);
  const { raw, key } = await generateMasterKey();
  const recoveryCode = randomRecoveryCode();
  const recoverySalt = randomSalt();

  const keys = {
    wrapPass: await wrapWithKey(raw, encKey),      // password half — no salt needed, it is email-derived
    passSalt: null,
    wrapRecovery: await wrapMasterKey(raw, normaliseRecoveryCode(recoveryCode), recoverySalt),
    recoverySalt,
    recoveryHint: recoveryCode.slice(0, 5),
  };

  const r = await apiFetch('/api/auth/register', { method: 'POST', auth: false,
    body: { email, authSecret, keys, recoveryAuthSecret: await recoveryAuthSecretFor(email, recoveryCode) } });

  session = { token: r.token, email: r.email, expiresAt: r.expiresAt };
  saveSession(session);
  vaultKey = key;
  await persistKey(key);
  raw.fill(0);
  saveState({ ...loadState(), hasRecovery: true, recoveryHint: keys.recoveryHint, passwordAuth: true });
  emit({ status: 'idle', email: r.email });
  return recoveryCode;
}

/** Sign in and unlock in a single step — no second prompt. */
export async function signIn(email, password) {
  const { encKey, authSecret } = await deriveAccountSecrets(email, password);
  const r = await apiFetch('/api/auth/login', { method: 'POST', auth: false, body: { email, authSecret } });

  session = { token: r.token, email: r.email, expiresAt: r.expiresAt };
  saveSession(session);

  const keys = r.keys || await fetchKeys();
  if (!keys?.wrapPass) {
    // Account exists but has no password-wrapped key (migrated from the old
    // code-based flow). Let the caller fall back to the recovery code.
    emit({ status: 'locked', email: r.email });
    return { unlocked: false, needsRecovery: true };
  }
  let raw;
  try {
    raw = keys.passSalt
      ? await unwrapMasterKey(keys.wrapPass, password, keys.passSalt)   // legacy passphrase wrap
      : await unwrapWithKey(keys.wrapPass, encKey);
  } catch {
    emit({ status: 'locked', email: r.email });
    return { unlocked: false, needsRecovery: true };
  }
  vaultKey = await importMasterKey(raw);
  raw.fill(0);
  await persistKey(vaultKey);
  saveState({ ...loadState(), hasRecovery: !!keys.wrapRecovery, recoveryHint: keys.recoveryHint, passwordAuth: true });
  emit({ status: 'idle', email: r.email });
  return { unlocked: true };
}

/** Change the password: re-derive, re-wrap the master key, update the server. */
export async function changePassword(email, newPassword) {
  if (!vaultKey) throw new Error('Unlock the vault first');
  const backup = await store.exportBackup({ includeVolatile: false });
  const { encKey, authSecret } = await deriveAccountSecrets(email, newPassword);

  const { raw, key } = await generateMasterKey();
  const recoveryCode = randomRecoveryCode();
  const recoverySalt = randomSalt();
  const keys = {
    wrapPass: await wrapWithKey(raw, encKey),
    passSalt: null,
    wrapRecovery: await wrapMasterKey(raw, normaliseRecoveryCode(recoveryCode), recoverySalt),
    recoverySalt,
    recoveryHint: recoveryCode.slice(0, 5),
  };

  const previous = vaultKey;
  vaultKey = key;
  try {
    const blob = await encryptVault(backup);
    const version = await serverVersion();
    const r = await apiFetch('/api/vault', { method: 'PUT', body: { version, blob, keys } });
    await apiFetch('/api/auth/change-password', { method: 'POST',
      body: { authSecret, keys, recoveryAuthSecret: await recoveryAuthSecretFor(email, recoveryCode) } });
    // Server invalidated all sessions — issue a fresh one with the new auth secret.
    session = null; saveSession(null);
    const loginR = await apiFetch('/api/auth/login', { method: 'POST', auth: false,
      body: { email, authSecret } });
    session = { token: loginR.token, email: loginR.email, expiresAt: loginR.expiresAt };
    saveSession(session);
    saveState({ ...loadState(), version: r.version, lastSyncedAt: Date.now(),
      hasRecovery: true, recoveryHint: keys.recoveryHint, passwordAuth: true });
    await persistKey(key);
    raw.fill(0);
    emit({ status: 'idle', version: r.version, lastSyncedAt: Date.now() });
  } catch (err) {
    vaultKey = previous;
    throw err;
  }
  return recoveryCode;
}

/* ---------- forgotten password ----------
   Two steps, because the browser has to do work between them.

   1. `startRecovery` proves the recovery code to the server and gets the
      wrapped keys back, then unwraps the master key locally with that code.
   2. `finishRecovery` re-wraps that SAME master key under the new password.

   Keeping the master key is the whole point: the vault already sitting on the
   server stays readable. Minting a new one — as changePassword does — would
   require re-uploading the decrypted data, which we do not have yet. */

let pendingReset = null;   // { email, resetToken, rawMaster } — memory only

/** Step 1. Verifies the recovery code and unwraps the master key in the browser. */
export async function startRecovery(email, recoveryCode) {
  const addr = String(email).trim().toLowerCase().normalize('NFKC');
  const code = normaliseRecoveryCode(recoveryCode);
  const r = await apiFetch('/api/auth/recover', { method: 'POST', auth: false,
    body: { email: addr, recoveryAuthSecret: await recoveryAuthSecretFor(addr, code) } });

  if (!r.keys?.wrapRecovery) throw new Error('This account has no recovery key stored');
  let rawMaster;
  try {
    rawMaster = await unwrapMasterKey(r.keys.wrapRecovery, code, r.keys.recoverySalt);
  } catch {
    // The server accepted the code, so a failure here means the stored blob is
    // damaged rather than the user being wrong. Say so, do not blame them.
    throw new Error('Your recovery code is correct but the stored key could not be opened');
  }
  pendingReset = { email: addr, resetToken: r.resetToken, rawMaster };
  return { email: addr, expiresAt: r.expiresAt };
}

/** Step 2. Sets the new password, issues a fresh recovery code, signs you in. */
export async function finishRecovery(newPassword) {
  if (!pendingReset) throw new Error('Verify your recovery code first');
  const { email, resetToken, rawMaster } = pendingReset;

  const { encKey, authSecret } = await deriveAccountSecrets(email, newPassword);
  const recoveryCode = randomRecoveryCode();
  const recoverySalt = randomSalt();
  const keys = {
    wrapPass: await wrapWithKey(rawMaster, encKey),
    passSalt: null,
    wrapRecovery: await wrapMasterKey(rawMaster, normaliseRecoveryCode(recoveryCode), recoverySalt),
    recoverySalt,
    recoveryHint: recoveryCode.slice(0, 5),
  };

  const r = await apiFetch('/api/auth/reset', { method: 'POST', auth: false,
    body: { resetToken, authSecret, keys, recoveryAuthSecret: await recoveryAuthSecretFor(email, recoveryCode) } });

  session = { token: r.token, email: r.email, expiresAt: r.expiresAt };
  saveSession(session);
  vaultKey = await importMasterKey(rawMaster);
  await persistKey(vaultKey);
  rawMaster.fill(0);
  pendingReset = null;
  saveState({ ...loadState(), hasRecovery: true, recoveryHint: keys.recoveryHint, passwordAuth: true });
  emit({ status: 'idle', email: r.email });
  return recoveryCode;
}

/* ---------- forgotten password AND forgotten recovery code ----------
   The last resort. An emailed code proves you own the address, which is enough
   to give the account back — but it cannot decrypt anything, because the server
   has never held a key. So what happens to the data depends on this device:

     • still holds the master key → the cloud copy is pulled down first and
       everything survives the password change.
     • does not → that ciphertext can never be opened by anyone again. Rather
       than leave an unreadable blob on the server, this device's own data is
       re-encrypted and uploaded in its place. Local data is untouched either
       way; it is the source of truth and always was. */

/** Step 1 — email a 6-digit code. Returns 'email' when it was really sent. */
export async function requestEmailReset(email) {
  const r = await apiFetch('/api/auth/request', { method: 'POST', auth: false, body: { email } });
  return r.delivery;   // 'email' | 'log'
}

/** Step 2 — check the code. Signs in, and reports what the data outlook is. */
export async function verifyEmailReset(email, code) {
  const r = await apiFetch('/api/auth/verify', { method: 'POST', auth: false, body: { email, code } });
  session = { token: r.token, email: r.email, expiresAt: r.expiresAt };
  saveSession(session);
  const canDecrypt = await restoreKey();
  emit({ status: canDecrypt ? 'idle' : 'locked', email: r.email });
  return { email: r.email, hasVault: !!r.hasVault, canDecrypt, localRecords: countLocal() };
}

/** Step 3 — set the new password and issue a fresh recovery code. */
export async function finishEmailReset(newPassword) {
  if (!session?.token) throw new Error('Verify the emailed code first');
  const email = session.email;
  if (vaultKey) {
    // This device can still read the cloud copy — take it before re-keying.
    try { await pull(); } catch { /* local data still stands; carry on */ }
    return changePassword(email, newPassword);
  }
  return rebuildVaultWithPassword(email, newPassword);
}

const countLocal = () =>
  ['transactions', 'accounts', 'categories', 'credits', 'investments', 'loans', 'goals', 'bills']
    .reduce((n, k) => n + (state[k]?.length || 0), 0);

/** Fresh master key wrapped by the new password; this device's data replaces the vault. */
async function rebuildVaultWithPassword(email, newPassword) {
  const backup = await store.exportBackup({ includeVolatile: false });
  const { encKey, authSecret } = await deriveAccountSecrets(email, newPassword);
  const { raw, key } = await generateMasterKey();
  const recoveryCode = randomRecoveryCode();
  const recoverySalt = randomSalt();
  const keys = {
    wrapPass: await wrapWithKey(raw, encKey),
    passSalt: null,
    wrapRecovery: await wrapMasterKey(raw, normaliseRecoveryCode(recoveryCode), recoverySalt),
    recoverySalt,
    recoveryHint: recoveryCode.slice(0, 5),
  };
  vaultKey = key;
  const blob = await encryptVault(backup);
  const r = await apiFetch('/api/vault', { method: 'PUT', body: { version: await serverVersion(), blob, keys } });
  await apiFetch('/api/auth/change-password', { method: 'POST',
    body: { authSecret, keys, recoveryAuthSecret: await recoveryAuthSecretFor(email, recoveryCode) } });
  saveState({ ...loadState(), version: r.version, lastSyncedAt: Date.now(),
    hasRecovery: true, recoveryHint: keys.recoveryHint, passwordAuth: true });
  await persistKey(key);
  raw.fill(0);
  emit({ status: 'idle', version: r.version, lastSyncedAt: Date.now() });
  return recoveryCode;
}

/** Drops a half-finished reset — called when the user backs out of the dialog. */
export function cancelRecovery() {
  pendingReset?.rawMaster?.fill(0);
  pendingReset = null;
}

/** After a recovery-code unlock while signed in, set a brand-new password. */
export async function resetPasswordWithRecovery(email, newPassword) {
  if (!vaultKey) throw new Error('Unlock with your recovery code first');
  return changePassword(email, newPassword);
}

/* ---------- legacy one-time code (still supported) ---------- */
export async function requestCode(email) {
  const r = await apiFetch('/api/auth/request', { method: 'POST', body: { email }, auth: false });
  return r.delivery;   // 'email' | 'log'
}

export async function verifyCode(email, code) {
  const r = await apiFetch('/api/auth/verify', { method: 'POST', body: { email, code }, auth: false });
  session = { token: r.token, email: r.email, expiresAt: r.expiresAt };
  saveSession(session);
  emit({ status: 'locked', email: r.email });
  return r;
}

export function signOutLocal() {
  session = null; vaultKey = null;
  clearSession();
  emit({ status: 'signed-out', email: null, version: 0 });
}

export async function signOut() {
  try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch { /* offline is fine */ }
  await db.del('devices', 'vaultKey').catch(() => {});
  signOutLocal();
}

export async function revokeOtherDevices() {
  await apiFetch('/api/sessions', { method: 'DELETE' });
}

export const isSignedIn = () => !!session?.token;
export const currentEmail = () => session?.email || null;

/* ---------- encryption key ---------- */
/**
 * The derived key is stored in IndexedDB as a NON-EXTRACTABLE CryptoKey, so it
 * survives reloads without ever holding the passphrase — and cannot be read
 * back out by any script, including this one.
 */
async function persistKey(key) {
  try { await db.put('devices', { id: 'vaultKey', key }); } catch (e) { console.warn('[sync] key not persisted', e); }
}
async function restoreKey() {
  try {
    const row = await db.get('devices', 'vaultKey');
    if (row?.key) { vaultKey = row.key; return true; }
  } catch { /* ignore */ }
  return false;
}

/* ---------- wrapped master keys ---------- */
async function fetchKeys() {
  try {
    const r = await apiFetch('/api/keys');
    return r.keys || null;
  } catch { return null; }
}
async function saveKeys(keys) {
  await apiFetch('/api/keys', { method: 'PUT', body: { keys } });
  const st = loadState();
  saveState({ ...st, hasRecovery: !!keys.wrapRecovery, recoveryHint: keys.recoveryHint || null });
}

/** Build a fresh key set: random master key wrapped by both secrets. */
async function buildKeySet(passphrase, recoveryCode, rawMaster) {
  const passSalt = randomSalt();
  const recoverySalt = randomSalt();
  return {
    wrapPass: await wrapMasterKey(rawMaster, passphrase, passSalt),
    passSalt,
    wrapRecovery: await wrapMasterKey(rawMaster, normaliseRecoveryCode(recoveryCode), recoverySalt),
    recoverySalt,
    recoveryHint: recoveryCode.slice(0, 5),
  };
}

/**
 * First-time setup: creates the master key and a one-time recovery code.
 * Returns the code — it is shown once and never stored anywhere in readable
 * form, so if the user does not save it, it is genuinely gone.
 */
export async function setupVault(passphrase) {
  const { raw, key } = await generateMasterKey();
  const recoveryCode = randomRecoveryCode();
  const keys = await buildKeySet(passphrase, recoveryCode, raw);
  await saveKeys(keys);
  vaultKey = key;
  await persistKey(key);
  raw.fill(0);
  emit({ status: 'idle' });
  return recoveryCode;
}

/** Unlock with the passphrase. Falls back to the legacy format transparently. */
export async function unlockVault(passphrase) {
  const keys = await fetchKeys();

  if (keys?.wrapPass) {
    let raw;
    try {
      raw = await unwrapMasterKey(keys.wrapPass, passphrase, keys.passSalt);
    } catch {
      throw new Error('Wrong passphrase');
    }
    vaultKey = await importMasterKey(raw);
    raw.fill(0);
    await persistKey(vaultKey);
    const st = loadState();
    saveState({ ...st, hasRecovery: !!keys.wrapRecovery, recoveryHint: keys.recoveryHint || null });
    emit({ status: 'idle' });
    return { migrated: false };
  }

  // Legacy vaults derived the key straight from the passphrase. Unlock that
  // way, then upgrade to the wrapped-master-key format so recovery works.
  const st = loadState();
  const legacySalt = st.salt || (await apiFetch('/api/vault').catch(() => ({}))).salt;
  if (!legacySalt) throw new Error('No vault found for this account yet');
  const legacyKey = await deriveKey(passphrase, legacySalt, 250000);
  vaultKey = legacyKey;
  saveState({ ...st, salt: legacySalt });
  await persistKey(legacyKey);
  emit({ status: 'idle' });
  return { migrated: true, legacy: true };
}

/** Unlock using the printed recovery code instead of the passphrase. */
export async function unlockWithRecovery(recoveryCode) {
  const keys = await fetchKeys();
  if (!keys?.wrapRecovery) {
    throw new Error('No recovery code was ever set up for this account');
  }
  let raw;
  try {
    raw = await unwrapMasterKey(keys.wrapRecovery, normaliseRecoveryCode(recoveryCode), keys.recoverySalt);
  } catch {
    throw new Error('That recovery code is not correct');
  }
  vaultKey = await importMasterKey(raw);
  raw.fill(0);
  await persistKey(vaultKey);
  emit({ status: 'idle' });
  return true;
}

/**
 * Convert a legacy passphrase-derived vault to the wrapped format, or rotate
 * the passphrase / recovery code. Requires the vault to be unlocked already.
 */
export async function rotateSecrets({ newPassphrase, keepRecovery = false } = {}) {
  if (!vaultKey) throw new Error('Unlock the vault first');
  const backup = await store.exportBackup({ includeVolatile: false });

  const { raw, key } = await generateMasterKey();
  const recoveryCode = randomRecoveryCode();
  const passphrase = newPassphrase;
  if (!passphrase) throw new Error('A passphrase is required');

  const keys = await buildKeySet(passphrase, recoveryCode, raw);
  const newKey = key;

  // re-encrypt the whole vault under the new master key, then publish both
  const previous = vaultKey;
  vaultKey = newKey;
  try {
    const blob = await encryptVault(backup);
    const st = loadState();
    const version = await serverVersion();
    const r = await apiFetch('/api/vault', { method: 'PUT', body: { version, blob, salt: st.salt, keys } });
    saveState({ ...st, version: r.version, lastSyncedAt: Date.now(), hasRecovery: true, recoveryHint: keys.recoveryHint });
    await persistKey(newKey);
    raw.fill(0);
    emit({ status: 'idle', version: r.version, lastSyncedAt: Date.now() });
  } catch (err) {
    vaultKey = previous;               // roll back so the session stays usable
    throw err;
  }
  void keepRecovery;
  return recoveryCode;
}

export const hasKey = () => !!vaultKey;
export const vaultSalt = () => loadState().salt || null;
export const hasRecovery = () => !!loadState().hasRecovery;
export const recoveryHint = () => loadState().recoveryHint || null;
/** Does this account already use the wrapped-key format? */
export async function keyStatus() {
  const keys = await fetchKeys();
  return { wrapped: !!keys?.wrapPass, recovery: !!keys?.wrapRecovery, hint: keys?.recoveryHint || null };
}

/* ---------- compression + crypto ---------- */
async function gzip(str) {
  const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

async function encryptVault(obj) {
  const packed = await gzip(JSON.stringify(obj));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, vaultKey, packed);
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), 12);
  return b64(out);
}
async function decryptVault(blobB64) {
  const raw = unb64(blobB64);
  const iv = raw.slice(0, 12);
  const ct = raw.slice(12);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, vaultKey, ct);
  } catch {
    throw new Error('Wrong passphrase — the cloud copy could not be decrypted');
  }
  return JSON.parse(await gunzip(new Uint8Array(plain)));
}

/* ---------- push / pull ---------- */
export async function pull({ apply = true } = {}) {
  if (!isSignedIn()) throw new Error('Not signed in');
  if (!vaultKey) throw new Error('Enter your passphrase to decrypt the cloud copy');
  emit({ status: 'syncing' });
  try {
    const r = await apiFetch('/api/vault');
    if (!r.blob) { emit({ status: 'idle', version: r.version || 0 }); return { empty: true }; }
    const backup = await decryptVault(r.blob);
    if (apply) {
      await store.importBackup(backup, 'replace');
    }
    const st = loadState();
    saveState({ ...st, version: r.version, lastSyncedAt: Date.now(), salt: r.salt || st.salt });
    emit({ status: 'idle', version: r.version, lastSyncedAt: Date.now(), pending: false });
    return { version: r.version, counts: backup.counts };
  } catch (e) {
    emit({ status: e.offline ? 'offline' : 'error', lastError: e.message });
    throw e;
  }
}

export async function push({ force = false } = {}) {
  if (!isSignedIn() || !vaultKey) return;
  if (syncPromise) { emit({ pending: true }); return; }
  syncing = true;
  syncPromise = (async () => {
    emit({ status: 'syncing' });
    try {
      const st = loadState();
      const backup = await store.exportBackup({ includeVolatile: false });
      const blob = await encryptVault(backup);
      let version = force ? await serverVersion() : (st.version || 0);
      const r = await apiFetch('/api/vault', { method: 'PUT', body: { version, blob, salt: st.salt } });
      saveState({ ...st, version: r.version, lastSyncedAt: Date.now() });
      emit({ status: 'idle', version: r.version, lastSyncedAt: Date.now(), pending: false, lastError: null });
      return r;
    } catch (e) {
      if (e.conflict) { emit({ status: 'conflict', lastError: 'Another device changed your data' }); throw e; }
      emit({ status: e.offline ? 'offline' : 'error', lastError: e.message });
      throw e;
    } finally {
      syncing = false;
      syncPromise = null;
    }
  })();
  return syncPromise;
}

async function serverVersion() {
  const me = await apiFetch('/api/me');
  return me.version || 0;
}

/** Conflict resolution: 'local' keeps this device, 'cloud' takes the server copy. */
export async function resolveConflict(choice) {
  if (choice === 'cloud') return pull();
  return push({ force: true });
}

export async function deleteCloudCopy() {
  await apiFetch('/api/vault', { method: 'DELETE' });
  const st = loadState();
  saveState({ ...st, version: 0, lastSyncedAt: null });
  emit({ version: 0, lastSyncedAt: null });
}

export async function serverInfo() {
  return apiFetch('/api/me');
}

/* ---------- automatic sync ---------- */
const schedulePush = debounce(() => {
  if (!isSignedIn() || !vaultKey) return;
  if (!navigator.onLine) { emit({ status: 'offline', pending: true }); return; }
  push().catch(() => { /* status already reported */ });
}, 4000);

export async function init() {
  const st = loadState();
  emit({ version: st.version || 0, lastSyncedAt: st.lastSyncedAt || null });

  if (!session) { emit({ status: 'signed-out' }); return; }
  emit({ email: session.email });

  const restored = await restoreKey();
  emit({ status: restored ? 'idle' : 'locked' });

  // mirror local changes to the cloud, coalesced
  store.bus.on('change', ({ store: s }) => {
    if (s === 'audit' || s === 'notifications') return;   // noise, not user data
    emit({ pending: true });
    schedulePush();
  });

  addEventListener('online', () => { if (sync.pending) schedulePush(); });
  addEventListener('offline', () => emit({ status: 'offline' }));

  // flush before the tab closes so a last-second edit is not stranded
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && sync.pending && isSignedIn() && vaultKey) {
      push().catch(() => {});
    }
  });

  if (restored && navigator.onLine) {
    // On launch, take whatever the server has if it is ahead of this device.
    // Normalise both to Number — the server may serialise version as a string.
    const localVer = Number(st.version);
    try {
      const me = await serverInfo();
      const meVer = Number(me?.version);
      if ((meVer || 0) > (localVer || 0)) await pull();
      else if (sync.pending) await push();
      else emit({ status: 'idle', version: meVer || 0 });
    } catch (e) {
      emit({ status: e.offline ? 'offline' : 'error', lastError: e.message });
    }
  }
}

export { store, state, settings };
