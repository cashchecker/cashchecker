-- ═══════════ Cash Checker — D1 schema ═══════════
-- Apply with:
--   npx wrangler d1 execute cashchecker --remote --file=worker/schema.sql

CREATE TABLE IF NOT EXISTS users (
  email       TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER
);

-- Email + password sign-in.
-- The password never reaches the server. The browser derives an `authSecret`
-- from it, and even THAT is stored only as a slow PBKDF2 hash — so a database
-- leak yields neither the password nor anything that can decrypt the vault.
-- `rec_hash` is the same trick applied to the recovery code: the browser derives
-- a recovery auth secret from it, and the server stores only a slow hash. That
-- is what makes a genuine "forgot my password" reset possible — the server can
-- verify the code without ever being able to decrypt anything with it.
CREATE TABLE IF NOT EXISTS credentials (
  email           TEXT PRIMARY KEY,
  auth_hash       TEXT NOT NULL,
  auth_salt       TEXT NOT NULL,
  iterations      INTEGER NOT NULL DEFAULT 100000,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER,
  fail_count      INTEGER NOT NULL DEFAULT 0,
  lock_until      INTEGER,
  rec_hash        TEXT,
  rec_salt        TEXT,
  rec_fail        INTEGER NOT NULL DEFAULT 0,
  rec_lock_until  INTEGER
);

-- Short-lived, single-use tickets proving a recovery code was accepted. Stored
-- hashed, like sessions, so a database leak cannot be replayed into a reset.
CREATE TABLE IF NOT EXISTS reset_tokens (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

-- Legacy one-time login codes. Kept so old rows do not break anything.
CREATE TABLE IF NOT EXISTS login_codes (
  email         TEXT PRIMARY KEY,
  code_hash     TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  window_start  INTEGER NOT NULL,
  window_count  INTEGER NOT NULL DEFAULT 1
);

-- Sessions are also stored hashed; the raw token exists only on the device.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  last_used   INTEGER,
  device      TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_email ON sessions(email);

-- Vault metadata. `version` drives optimistic concurrency so two devices
-- cannot silently overwrite one another.
CREATE TABLE IF NOT EXISTS vaults (
  email       TEXT PRIMARY KEY,
  version     INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  salt        TEXT,
  encrypted   INTEGER NOT NULL DEFAULT 1,
  chunks      INTEGER NOT NULL DEFAULT 0,
  size        INTEGER NOT NULL DEFAULT 0,
  device      TEXT
);

-- The encrypted blob, split because a single D1 value is capped around 2 MB.
CREATE TABLE IF NOT EXISTS vault_chunks (
  email  TEXT NOT NULL,
  idx    INTEGER NOT NULL,
  data   TEXT NOT NULL,
  PRIMARY KEY (email, idx)
);

-- The vault is encrypted with a random master key. That master key is stored
-- here twice: once wrapped by the passphrase, once wrapped by the recovery
-- code. Either unwraps it, and the server can read neither — so "forgot my
-- passphrase" is possible without the server ever being able to decrypt.
CREATE TABLE IF NOT EXISTS vault_keys (
  email          TEXT PRIMARY KEY,
  wrap_pass      TEXT,
  pass_salt      TEXT,
  wrap_recovery  TEXT,
  recovery_salt  TEXT,
  recovery_hint  TEXT,
  updated_at     INTEGER
);

CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT
);
