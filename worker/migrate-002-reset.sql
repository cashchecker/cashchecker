-- ═══════════ Migration 002 — password reset via recovery code ═══════════
-- Adds the columns and table that let a forgotten password be reset without
-- the server ever being able to decrypt anything.
--
-- Apply with:
--   npx wrangler d1 execute cashchecker --remote --file=worker/migrate-002-reset.sql
--
-- SQLite has no "ADD COLUMN IF NOT EXISTS"; on a database that already has
-- these columns each ALTER simply errors and can be ignored.

ALTER TABLE credentials ADD COLUMN rec_hash TEXT;
ALTER TABLE credentials ADD COLUMN rec_salt TEXT;
ALTER TABLE credentials ADD COLUMN rec_fail INTEGER NOT NULL DEFAULT 0;
ALTER TABLE credentials ADD COLUMN rec_lock_until INTEGER;

CREATE TABLE IF NOT EXISTS reset_tokens (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
