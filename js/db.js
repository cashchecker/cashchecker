/* ═══════════ db.js — IndexedDB persistence layer ═══════════
   Promise wrapper + schema + bulk ops + full backup/restore.
   Falls back to an in-memory shim if IndexedDB is unavailable
   (private windows, hardened browsers) so the app still runs.
   ══════════════════════════════════════════════════════════ */

export const DB_NAME = 'cashchecker';

/**
 * Bump this whenever SCHEMA gains a store or an index.
 *
 * If it is ever forgotten, openOnce() repairs the gap at runtime rather than
 * failing to boot: a database whose version already equals DB_VERSION never
 * fires onupgradeneeded, so stores added to SCHEMA after the fact simply do
 * not exist on disk and the first read throws NotFoundError. See openOnce().
 */
export const DB_VERSION = 5;

/**
 * store → { key, indexes: [[name, keyPath, opts]] }
 *
 * Deliberately sparse. The store layer loads every table into memory at boot
 * and filters there, so secondary indexes buy nothing on read but cost real
 * time on every write — six indexes on `transactions` roughly doubled bulk
 * import time. Only indexes that support range scans on tables which can grow
 * unbounded are kept; v2 drops the rest and the upgrade path deletes any
 * stale index left over from v1.
 */
export const SCHEMA = {
  accounts:      { indexes: [] },
  categories:    { indexes: [] },
  transactions:  { indexes: [['date', 'date']] },
  contacts:      { indexes: [] },
  credits:       { indexes: [['contactId', 'contactId']] },
  creditPayments:{ indexes: [['creditId', 'creditId']] },
  investments:   { indexes: [] },
  investmentTxns:{ indexes: [['investmentId', 'investmentId']] },
  campaigns:     { indexes: [] },
  campaignDays:  { indexes: [['campaignId', 'campaignId']] },
  budgets:       { indexes: [] },
  goals:         { indexes: [] },
  bills:         { indexes: [['dueDate', 'dueDate']] },
  shoppingLists: { indexes: [] },
  shoppingItems: { indexes: [['listId', 'listId']] },
  products:      { indexes: [] },
  loans:         { indexes: [] },
  loanPayments:  { indexes: [['loanId', 'loanId']] },
  recurring:     { indexes: [] },
  notifications: { indexes: [['at', 'at']] },
  attachments:   { indexes: [['ownerId', 'ownerId']] },
  reminders:     { indexes: [['dueAt', 'dueAt']] },
  reminderRules: { indexes: [] },
  audit:         { indexes: [['at', 'at']] },
  entityTypes:   { indexes: [] },
  entityRecords: { indexes: [['typeId', 'typeId']] },
  rules:         { indexes: [] },
  devices:       { indexes: [] },
  settings:      { key: 'k', indexes: [] },
};
export const STORES = Object.keys(SCHEMA);
/** Stores excluded from routine exports because they're large or machine-local. */
export const VOLATILE = new Set(['audit', 'notifications', 'devices']);

let _db = null;
let _memory = null;   // fallback: Map<store, Map<key,value>>
let _openError = null;
let _opening = null;  // in-flight open(), so parallel callers share one connection
/** Why we fell back to memory, if we did. Surfaced to the user by app.js. */
export const openError = () => _openError;

const req = r => new Promise((res, rej) => {
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

export async function open() {
  if (_db || _memory) return _db;
  if (!('indexedDB' in globalThis)) return useMemory('IndexedDB unavailable');
  if (_opening) return _opening;

  // Every CRUD helper awaits open(); without this guard a boot that reads
  // several stores would race several indexedDB.open() calls against each
  // other, and an upgrade started by one blocks all the rest.
  _opening = (async () => {
    // A version upgrade is blocked while another tab holds an old connection.
    // Falling straight back to memory would look like a fresh install while the
    // real data sits untouched on disk, so retry a few times first.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await openOnce();
      } catch (err) {
        _openError = err.message;
        if (!/blocked/i.test(err.message) || attempt === 2) return useMemory(err.message);
        await new Promise(r => setTimeout(r, 500));
      }
    }
    return useMemory(_openError || 'unknown error');
  })();

  try { return await _opening; } finally { _opening = null; }
}

function rawOpen(version) {
  return new Promise((res, rej) => {
    const r = version == null ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version);
    r.onupgradeneeded = () => upgrade(r.result, r.transaction);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('Database blocked by another tab'));
  });
}

/** Creates whatever SCHEMA declares and is not there yet. Safe to re-run. */
function upgrade(db, tr) {
  for (const [name, def] of Object.entries(SCHEMA)) {
    const os = db.objectStoreNames.contains(name)
      ? tr.objectStore(name)
      : db.createObjectStore(name, { keyPath: def.key || 'id' });
    const wanted = new Set((def.indexes || []).map(i => i[0]));
    for (const [iname, path, opts] of def.indexes || []) {
      if (!os.indexNames.contains(iname)) os.createIndex(iname, path, opts || {});
    }
    // drop indexes this version no longer declares (they only cost write time)
    for (const existing of [...os.indexNames]) {
      if (!wanted.has(existing)) os.deleteIndex(existing);
    }
  }
}

const missingStores = db => STORES.filter(s => !db.objectStoreNames.contains(s));
/** Stop our own reload handler firing on a close we asked for. */
const detach = db => { db.onversionchange = null; };

async function openOnce() {
  let db;
  try {
    db = await rawOpen(DB_VERSION);
  } catch (err) {
    if (err?.name !== 'VersionError') throw err;
    // The database on disk is newer than this build (a rollback, or an older
    // deploy still cached). Opening at the existing version beats refusing to
    // start; the store check below still guarantees what we need exists.
    db = await rawOpen(null);
  }

  // Self-heal. If a build added stores to SCHEMA without bumping DB_VERSION,
  // onupgradeneeded never ran and those stores are absent — the first
  // db.all() then throws "One of the specified object stores was not found"
  // and boot dies. Reopening one version higher runs upgrade(), which creates
  // only what is missing. Existing rows are never touched.
  const missing = missingStores(db);
  if (missing.length) {
    console.warn('[db] schema behind — creating stores:', missing.join(', '));
    const next = db.version + 1;
    detach(db);
    db.close();
    db = await rawOpen(next);
    const still = missingStores(db);
    if (still.length) throw new Error(`Could not create stores: ${still.join(', ')}`);
  }

  _db = db;
  _db.onversionchange = () => { detach(_db); _db.close(); _db = null; location.reload(); };
  _openError = null;
  return _db;
}

function useMemory(reason) {
  console.warn('[db] falling back to in-memory store:', reason);
  _db = null;
  _memory = new Map(STORES.map(s => [s, new Map()]));
  return null;
}
export const isMemoryMode = () => !!_memory;
const keyOf = store => SCHEMA[store]?.key || 'id';
const bucket = store => _memory.get(store) || _memory.set(store, new Map()).get(store);

function tx(stores, mode = 'readonly') {
  // A clear message beats NotFoundError's "one of the specified object stores".
  const gone = stores.filter(s => !_db.objectStoreNames.contains(s));
  if (gone.length) throw new Error(`Store not in database: ${gone.join(', ')} (on disk v${_db.version}, code v${DB_VERSION})`);
  const t = _db.transaction(stores, mode);
  return { t, done: new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }) };
}

/* ---------- CRUD ----------
   open() comes first everywhere: it can decide mid-call to fall back to
   memory, and a _memory check taken before that await would be stale. */
export async function get(store, key) {
  await open();
  if (_memory) return structuredClone(bucket(store).get(key)) ?? undefined;
  const { t } = tx([store]);
  return req(t.objectStore(store).get(key));
}
export async function all(store) {
  await open();
  if (_memory) return [...bucket(store).values()].map(v => structuredClone(v));
  const { t } = tx([store]);
  return req(t.objectStore(store).getAll());
}
export async function put(store, value) {
  await open();
  if (_memory) { bucket(store).set(value[keyOf(store)], structuredClone(value)); return value; }
  const { t, done } = tx([store], 'readwrite');
  t.objectStore(store).put(value);
  await done;
  return value;
}
export async function putMany(store, values) {
  if (!values.length) return values;
  await open();
  if (_memory) { values.forEach(v => bucket(store).set(v[keyOf(store)], structuredClone(v))); return values; }
  const { t, done } = tx([store], 'readwrite');
  const os = t.objectStore(store);
  values.forEach(v => os.put(v));
  await done;
  return values;
}
export async function del(store, key) {
  await open();
  if (_memory) { bucket(store).delete(key); return; }
  const { t, done } = tx([store], 'readwrite');
  t.objectStore(store).delete(key);
  await done;
}
export async function delMany(store, keys) {
  if (!keys.length) return;
  await open();
  if (_memory) { keys.forEach(k => bucket(store).delete(k)); return; }
  const { t, done } = tx([store], 'readwrite');
  const os = t.objectStore(store);
  keys.forEach(k => os.delete(k));
  await done;
}
export async function clear(store) {
  await open();
  if (_memory) { bucket(store).clear(); return; }
  const { t, done } = tx([store], 'readwrite');
  t.objectStore(store).clear();
  await done;
}
export async function count(store) {
  await open();
  if (_memory) return bucket(store).size;
  const { t } = tx([store]);
  return req(t.objectStore(store).count());
}
/** Query by index equality or IDBKeyRange. */
export async function byIndex(store, index, value) {
  await open();
  if (_memory) {
    const path = ((SCHEMA[store]?.indexes || []).find(i => i[0] === index) || [, index])[1];
    return [...bucket(store).values()].filter(v => v[path] === value).map(v => structuredClone(v));
  }
  const { t } = tx([store]);
  return req(t.objectStore(store).index(index).getAll(value));
}

/* ---------- backup / restore ---------- */
export async function exportAll({ includeVolatile = false, includeAttachments = true } = {}) {
  const data = {};
  for (const s of STORES) {
    if (!includeVolatile && VOLATILE.has(s)) continue;
    if (!includeAttachments && s === 'attachments') continue;
    data[s] = await all(s);
  }
  return {
    format: 'cashchecker-backup',
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
    data,
  };
}
/** mode: 'replace' wipes matching stores first; 'merge' upserts by key. */
export async function importAll(backup, mode = 'replace') {
  if (!backup || backup.format !== 'cashchecker-backup') throw new Error('Not a Cash Checker backup file');
  const data = backup.data || {};
  for (const [store, rows] of Object.entries(data)) {
    if (!STORES.includes(store) || !Array.isArray(rows)) continue;
    if (mode === 'replace') await clear(store);
    await putMany(store, rows);
  }
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]));
}
export async function wipe() {
  for (const s of STORES) await clear(s);
}
export async function usage() {
  try {
    const est = await navigator.storage?.estimate?.();
    return { used: est?.usage || 0, quota: est?.quota || 0 };
  } catch { return { used: 0, quota: 0 }; }
}
/** Ask the browser not to evict our data under storage pressure. */
export async function persist() {
  try { return (await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.()) || false; }
  catch { return false; }
}
