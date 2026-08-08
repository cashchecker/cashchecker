/* ═══════════ Cash Checker — Cloudflare Worker API ═══════════
   Serves the static app and provides email-OTP auth + encrypted vault sync.

   The vault arrives already encrypted by the browser (AES-256-GCM with a key
   the client derives from a passphrase). This Worker never sees the key and
   cannot read the contents — it stores and returns opaque ciphertext.

   Routes
     POST /api/auth/register { email, authSecret, keys, recoveryAuthSecret }
     POST /api/auth/login    { email, authSecret }  → { token, email, keys }
     POST /api/auth/recover  { email, recoveryAuthSecret }
                                                    → { resetToken, keys }
     POST /api/auth/reset    { resetToken, authSecret, keys, recoveryAuthSecret }
                                                    → { token, email }
     POST /api/auth/request  { email }              → send a 6-digit code
     POST /api/auth/verify   { email, code }        → { token, email }
     POST /api/auth/logout                          → revoke this session
     GET  /api/me                                   → session + vault metadata
     GET  /api/vault                                → { version, blob, salt }
     PUT  /api/vault         { version, blob, salt} → { version } | 409
     DELETE /api/vault                              → wipe the cloud copy
   ═══════════════════════════════════════════════════════════ */

const CODE_TTL_MS      = 10 * 60 * 1000;        // login code lifetime
const SESSION_TTL_MS   = 14 * 24 * 3600 * 1000; // 14-day session lifetime (security best practice)
const MAX_ATTEMPTS     = 5;                     // wrong-code tries per code
const MAX_REQ_PER_HOUR = 5;                     // code requests per email/hour
const RESET_TTL_MS     = 15 * 60 * 1000;        // password-reset ticket lifetime
const CHUNK_LIMIT      = 900_000;               // chars per D1 row
const MAX_CHUNKS       = 24;                    // ≈ 21 MB vault ceiling

/* ---------- helpers ---------- */
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    },
  });
const bad = (msg, status = 400) => json({ error: msg }, status);

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const randomToken = () =>
  [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
const sixDigits = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
const normEmail = e => String(e || '').trim().toLowerCase().normalize('NFKC');
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

/** Constant-time-ish comparison so a wrong code can't be timed out digit by digit. */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------- access control ---------- */
/**
 * Who may use this deployment.
 *
 * `ALLOWED_EMAILS` still wins when set — that is the way to run this privately.
 * With it empty the deployment is open, so anyone can create an account, but
 * new sign-ups are capped: a public URL should not be able to fill someone
 * else's database for free. Existing accounts are never blocked by the cap.
 */
async function isAllowed(env, email, { signup = false } = {}) {
  const list = String(env.ALLOWED_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (list.length) return list.includes(email);
  if (!signup) return true;

  const existing = await env.DB.prepare('SELECT email FROM credentials WHERE email = ?').bind(email).first();
  if (existing) return true;

  const cap = Number(env.MAX_ACCOUNTS || 500);
  if (!Number.isFinite(cap) || cap <= 0) return true;
  const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM credentials').first();
  return (row?.c || 0) < cap;
}

/* ---------- email ---------- */
/**
 * Delivers the login code, trying each configured channel in order:
 *   1. Brevo                     — BREVO_API_KEY. No domain needed: verify a
 *      single sender address and you can then send to any recipient.
 *   2. Cloudflare Email Service  — the `EMAIL` send_email binding, if bound.
 *      Free to addresses verified in your own account; needs a domain on
 *      Cloudflare DNS for the `from` address.
 *   3. Resend                    — needs no domain, but without a verified one
 *      it only delivers to the address you signed up to Resend with.
 *   4. The Worker log            — always works, so setup is never blocked.
 * Any failure falls through to the next option rather than losing the code.
 */
async function sendCode(env, email, code) {
  const appName = env.APP_NAME || 'Cash Checker';
  const from = env.MAIL_FROM || 'onboarding@resend.dev';
  const subject = `${code} is your ${appName} sign-in code`;
  const text = `Your ${appName} sign-in code is ${code}.\n\nIt expires in 10 minutes. If you did not request it, ignore this email.`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:440px;margin:auto;padding:28px">
    <h2 style="margin:0 0 6px;letter-spacing:-.02em">${appName}</h2>
    <p style="color:#666;margin:0 0 22px;font-size:14px">Here is your sign-in code.</p>
    <div style="font-size:34px;font-weight:700;letter-spacing:.28em;padding:18px;background:#f4f5fb;border-radius:12px;text-align:center">${code}</div>
    <p style="color:#666;font-size:13px;margin-top:20px">It expires in 10 minutes. If you did not request it, ignore this email &mdash; nobody can access your data without it.</p>
  </div>`;

  // 1. Brevo — https://api.brevo.com/v3/smtp/email, key passed as `api-key`
  if (env.BREVO_API_KEY) {
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { email: stripName(from), name: senderName(from) || appName },
          to: [{ email }],
          subject, htmlContent: html, textContent: text,
        }),
      });
      if (res.ok) return 'email';                       // 201 Created
      console.log(`[auth] Brevo failed (${res.status}): ${await res.text()}`);
    } catch (err) {
      console.log(`[auth] Brevo request failed: ${err?.message || err}`);
    }
  }

  // 2. Cloudflare Email Service
  if (env.EMAIL && typeof env.EMAIL.send === 'function') {
    try {
      await env.EMAIL.send({ to: email, from: stripName(from), subject, html, text });
      return 'email';
    } catch (err) {
      console.log(`[auth] Cloudflare Email Service failed: ${err?.message || err}`);
    }
  }

  // 3. Resend
  if (env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [email], subject, html, text }),
      });
      if (res.ok) return 'email';
      console.log(`[auth] Resend failed (${res.status}): ${await res.text()}`);
    } catch (err) {
      console.log(`[auth] Resend request failed: ${err?.message || err}`);
    }
  }

  // 4. Log — visible via `npx wrangler tail`
  // Report which providers were actually visible, so a silent fallback is
  // diagnosable. Lengths only: never log a key's value.
  console.log('[auth] no provider delivered · ' +
    `brevo=${env.BREVO_API_KEY ? `set(${String(env.BREVO_API_KEY).length} chars)` : 'NOT SET'} · ` +
    `cloudflare=${env.EMAIL && typeof env.EMAIL.send === 'function' ? 'bound' : 'not bound'} · ` +
    `resend=${env.RESEND_API_KEY ? 'set' : 'NOT SET'} · from=${from}`);
  return 'log';
}
/** "Name <a@b.com>" -> "a@b.com" (bare address, for APIs that want it separate). */
const stripName = addr => {
  const m = String(addr).match(/<([^>]+)>/);
  return (m ? m[1] : addr).trim();
};
/** "Name <a@b.com>" -> "Name" */
const senderName = addr => {
  const m = String(addr).match(/^\s*([^<]+?)\s*</);
  return m ? m[1].replace(/^["']|["']$/g, '') : '';
};

/* ═══════════ password auth ═══════════ */

const PW_ITERATIONS = 100000;      // server-side hardening of the authSecret
const MAX_LOGIN_FAILS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

/** PBKDF2 over the client's authSecret, so the stored value is not replayable. */
async function hashAuthSecret(authSecret, saltB64, iterations = PW_ITERATIONS) {
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(authSecret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}
const randomSaltB64 = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));

/**
 * Hashes the recovery auth secret the same way as the password one.
 * Returns nulls when the client did not send one, so older clients still work —
 * they simply cannot use the reset flow until they rotate their recovery code.
 */
async function hashRecoverySecret(recoveryAuthSecret) {
  const secret = String(recoveryAuthSecret || '');
  if (secret.length < 20) return { hash: null, salt: null };
  const salt = randomSaltB64();
  return { hash: await hashAuthSecret(secret, salt), salt };
}

async function issueSession(env, email, req) {
  const now = Date.now();
  const token = randomToken();
  const device = (req.headers.get('user-agent') || 'unknown').slice(0, 120);
  await env.DB.prepare('INSERT INTO sessions (token_hash, email, created_at, expires_at, last_used, device) VALUES (?,?,?,?,?,?)')
    .bind(await sha256hex(token), email, now, now + SESSION_TTL_MS, now, device).run();
  return { token, expiresAt: now + SESSION_TTL_MS };
}

/** POST /api/auth/register — create the account and store the wrapped keys. */
async function register(req, env) {
  const body = await req.json().catch(() => ({}));
  const email = normEmail(body.email);
  const authSecret = String(body.authSecret || '');
  if (!validEmail(email)) return bad('Enter a valid email address');
  if (authSecret.length < 20) return bad('Invalid credentials payload');
  if (!(await isAllowed(env, email, { signup: true }))) {
    return bad('This deployment is not accepting new accounts', 403);
  }

  const existing = await env.DB.prepare('SELECT email FROM credentials WHERE email = ?').bind(email).first();
  if (existing) return bad('An account already exists for this email — sign in instead', 409);

  // Refuse to overwrite an existing encrypted vault. Registering writes fresh
  // wrapped keys, which would leave the old ciphertext permanently unreadable.
  // This can only happen for accounts created under the old code+passphrase
  // flow, and silent data loss is not an acceptable outcome.
  const priorVault = await env.DB.prepare('SELECT chunks FROM vaults WHERE email = ?').bind(email).first();
  if (priorVault && priorVault.chunks > 0) {
    return json({ error: 'vault-exists',
      message: 'This email already has encrypted data from the previous sign-in method. Signing up now would make it unreadable. Delete the cloud copy first, or restore it on a device that still has it.' }, 409);
  }

  const now = Date.now();
  const salt = randomSaltB64();
  const hash = await hashAuthSecret(authSecret, salt);
  const rec = await hashRecoverySecret(body.recoveryAuthSecret);

  await env.DB.batch([
    env.DB.prepare('INSERT INTO credentials (email, auth_hash, auth_salt, iterations, created_at, rec_hash, rec_salt) VALUES (?,?,?,?,?,?,?)')
      .bind(email, hash, salt, PW_ITERATIONS, now, rec.hash, rec.salt),
    env.DB.prepare('INSERT OR IGNORE INTO users (email, created_at) VALUES (?, ?)').bind(email, now),
    env.DB.prepare('INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)').bind('owner', email),
  ]);
  if (body.keys) await putKeys(env, email, body.keys);

  const s = await issueSession(env, email, req);
  return json({ token: s.token, email, expiresAt: s.expiresAt, created: true });
}

/** POST /api/auth/login */
async function login(req, env) {
  const body = await req.json().catch(() => ({}));
  const email = normEmail(body.email);
  const authSecret = String(body.authSecret || '');
  if (!validEmail(email) || !authSecret) return bad('Enter your email and password');

  const row = await env.DB.prepare(
    'SELECT auth_hash, auth_salt, iterations, fail_count, lock_until FROM credentials WHERE email = ?'
  ).bind(email).first();

  // Always spend similar time so a missing account is not detectable by timing.
  if (!row) {
    await hashAuthSecret(authSecret, randomSaltB64());
    return bad('No account found for that email, or the password is wrong', 401);
  }
  if (row.lock_until && Date.now() < row.lock_until) {
    const mins = Math.ceil((row.lock_until - Date.now()) / 60000);
    return bad(`Too many failed attempts. Try again in ${mins} minute${mins > 1 ? 's' : ''}.`, 429);
  }

  const hash = await hashAuthSecret(authSecret, row.auth_salt, row.iterations || PW_ITERATIONS);
  if (!safeEqual(hash, row.auth_hash)) {
    const fails = (row.fail_count || 0) + 1;
    const lock = fails >= MAX_LOGIN_FAILS ? Date.now() + LOCKOUT_MS : null;
    await env.DB.prepare('UPDATE credentials SET fail_count = ?, lock_until = ? WHERE email = ?')
      .bind(lock ? 0 : fails, lock, email).run();
    return bad('No account found for that email, or the password is wrong', 401);
  }

  await env.DB.batch([
    env.DB.prepare('UPDATE credentials SET fail_count = 0, lock_until = NULL WHERE email = ?').bind(email),
    env.DB.prepare('UPDATE users SET last_seen = ? WHERE email = ?').bind(Date.now(), email),
  ]);

  const s = await issueSession(env, email, req);
  return json({ token: s.token, email, expiresAt: s.expiresAt, keys: await getKeys(env, email) });
}

/** POST /api/auth/change-password — needs a valid session. */
async function changePassword(req, env, email) {
  const body = await req.json().catch(() => ({}));
  const authSecret = String(body.authSecret || '');
  if (authSecret.length < 20) return bad('Invalid credentials payload');
  const salt = randomSaltB64();
  const hash = await hashAuthSecret(authSecret, salt);
  const rec = await hashRecoverySecret(body.recoveryAuthSecret);
  // Upsert, not update: an account created under the old emailed-code flow has
  // no credentials row at all, and an UPDATE would silently affect nothing —
  // leaving the user unable to sign in with the password they just chose.
  // A password change always issues a fresh recovery code, so the stored
  // recovery hash must move with it or the old code would still open a reset.
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO credentials (email, auth_hash, auth_salt, iterations, created_at, updated_at, rec_hash, rec_salt)
     VALUES (?1,?2,?3,?4,?5,?5,?6,?7)
     ON CONFLICT(email) DO UPDATE SET
       auth_hash=?2, auth_salt=?3, iterations=?4, updated_at=?5,
       fail_count=0, lock_until=NULL,
       rec_hash=COALESCE(?6, rec_hash), rec_salt=COALESCE(?7, rec_salt),
       rec_fail=0, rec_lock_until=NULL`
  ).bind(email, hash, salt, PW_ITERATIONS, now, rec.hash, rec.salt).run();
  // Invalidate all existing sessions — any device using the old password is now locked out.
  await env.DB.prepare('DELETE FROM sessions WHERE email = ?').bind(email).run();
  if (body.keys) await putKeys(env, email, body.keys);
  return json({ ok: true });
}

/**
 * POST /api/auth/recover — step 1 of a genuine password reset.
 *
 * The browser derives a recovery auth secret from the recovery code exactly as
 * it derives one from the password, so the server can verify the code against a
 * stored hash. On success it hands back a single-use ticket plus the wrapped
 * keys; the master key itself is unwrapped in the browser, by the code. Nothing
 * here lets the server read the vault.
 */
async function recoverStart(req, env) {
  const body = await req.json().catch(() => ({}));
  const email = normEmail(body.email);
  const secret = String(body.recoveryAuthSecret || '');
  if (!validEmail(email) || !secret) return bad('Enter your email and recovery code');

  const row = await env.DB.prepare(
    'SELECT rec_hash, rec_salt, iterations, rec_fail, rec_lock_until FROM credentials WHERE email = ?'
  ).bind(email).first();

  // Same shape of answer, and the same work, whether or not the account exists.
  if (!row || !row.rec_hash) {
    await hashAuthSecret(secret, randomSaltB64());
    return bad(row
      ? 'This account has no recovery code on file. Sign in with your password, then set one up under Settings → Account & sync.'
      : 'That email and recovery code do not match an account', 401);
  }
  if (row.rec_lock_until && Date.now() < row.rec_lock_until) {
    const mins = Math.ceil((row.rec_lock_until - Date.now()) / 60000);
    return bad(`Too many failed attempts. Try again in ${mins} minute${mins > 1 ? 's' : ''}.`, 429);
  }

  const hash = await hashAuthSecret(secret, row.rec_salt, row.iterations || PW_ITERATIONS);
  if (!safeEqual(hash, row.rec_hash)) {
    const fails = (row.rec_fail || 0) + 1;
    const lock = fails >= MAX_LOGIN_FAILS ? Date.now() + LOCKOUT_MS : null;
    await env.DB.prepare('UPDATE credentials SET rec_fail = ?, rec_lock_until = ? WHERE email = ?')
      .bind(lock ? 0 : fails, lock, email).run();
    return bad('That email and recovery code do not match an account', 401);
  }

  const now = Date.now();
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare('UPDATE credentials SET rec_fail = 0, rec_lock_until = NULL WHERE email = ?').bind(email),
    env.DB.prepare('DELETE FROM reset_tokens WHERE email = ? OR expires_at < ?').bind(email, now),
    env.DB.prepare('INSERT INTO reset_tokens (token_hash, email, created_at, expires_at) VALUES (?,?,?,?)')
      .bind(await sha256hex(token), email, now, now + RESET_TTL_MS),
  ]);
  return json({ resetToken: token, expiresAt: now + RESET_TTL_MS, keys: await getKeys(env, email) });
}

/**
 * POST /api/auth/reset — step 2. Swaps in the new password-derived secrets and
 * the re-wrapped keys, then revokes every existing session: a reset is exactly
 * the moment you want other devices logged out.
 */
async function recoverFinish(req, env) {
  const body = await req.json().catch(() => ({}));
  const token = String(body.resetToken || '');
  const authSecret = String(body.authSecret || '');
  if (!token || authSecret.length < 20) return bad('Invalid reset payload');

  const now = Date.now();
  const row = await env.DB.prepare('SELECT email, expires_at FROM reset_tokens WHERE token_hash = ?')
    .bind(await sha256hex(token)).first();
  if (!row || row.expires_at < now) {
    return bad('That reset link has expired — start again with your recovery code', 401);
  }
  const email = row.email;

  const salt = randomSaltB64();
  const hash = await hashAuthSecret(authSecret, salt);
  const rec = await hashRecoverySecret(body.recoveryAuthSecret);
  if (!rec.hash) return bad('Invalid reset payload');

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE credentials SET auth_hash = ?, auth_salt = ?, iterations = ?, updated_at = ?,
       fail_count = 0, lock_until = NULL, rec_hash = ?, rec_salt = ?, rec_fail = 0, rec_lock_until = NULL
       WHERE email = ?`
    ).bind(hash, salt, PW_ITERATIONS, now, rec.hash, rec.salt, email),
    env.DB.prepare('DELETE FROM reset_tokens WHERE email = ?').bind(email),
    env.DB.prepare('DELETE FROM sessions WHERE email = ?').bind(email),
  ]);
  if (body.keys) await putKeys(env, email, body.keys);

  const s = await issueSession(env, email, req);
  return json({ token: s.token, email, expiresAt: s.expiresAt, reset: true });
}

/** Does this email already have an account? Drives the sign-in / sign-up UI. */
async function accountExists(env, email) {
  if (!validEmail(email)) return false;
  const r = await env.DB.prepare('SELECT email FROM credentials WHERE email = ?').bind(email).first();
  return !!r;
}

/* ---------- legacy one-time-code auth (kept for older clients) ---------- */
async function requestCode(req, env) {
  const body = await req.json().catch(() => ({}));
  const email = normEmail(body.email);
  if (!validEmail(email)) return bad('Enter a valid email address');
  if (!(await isAllowed(env, email))) return bad('This email is not permitted to sign in', 403);

  const now = Date.now();
  const existing = await env.DB.prepare('SELECT window_start, window_count FROM login_codes WHERE email = ?')
    .bind(email).first();

  let windowStart = now, windowCount = 1;
  if (existing) {
    const withinHour = now - existing.window_start < 3600_000;
    if (withinHour && existing.window_count >= MAX_REQ_PER_HOUR)
      return bad('Too many codes requested. Try again in an hour.', 429);
    windowStart = withinHour ? existing.window_start : now;
    windowCount = withinHour ? existing.window_count + 1 : 1;
  }

  const code = sixDigits();
  await env.DB.prepare(
    `INSERT INTO login_codes (email, code_hash, expires_at, attempts, window_start, window_count)
     VALUES (?1, ?2, ?3, 0, ?4, ?5)
     ON CONFLICT(email) DO UPDATE SET
       code_hash = ?2, expires_at = ?3, attempts = 0, window_start = ?4, window_count = ?5`
  ).bind(email, await sha256hex(code), now + CODE_TTL_MS, windowStart, windowCount).run();

  const delivery = await sendCode(env, email, code);
  return json({ ok: true, delivery });
}

async function verifyCode(req, env) {
  const body = await req.json().catch(() => ({}));
  const email = normEmail(body.email);
  const code = String(body.code || '').trim();
  if (!validEmail(email) || !/^\d{6}$/.test(code)) return bad('Enter the 6-digit code');
  // Verifying a code creates the account when there is none, so it counts as a
  // sign-up for the purposes of the cap.
  if (!(await isAllowed(env, email, { signup: true }))) {
    return bad('This deployment is not accepting new accounts', 403);
  }

  const row = await env.DB.prepare('SELECT code_hash, expires_at, attempts FROM login_codes WHERE email = ?')
    .bind(email).first();
  if (!row) return bad('Request a code first', 400);
  if (Date.now() > row.expires_at) return bad('That code has expired — request a new one', 400);
  if (row.attempts >= MAX_ATTEMPTS) return bad('Too many incorrect attempts — request a new code', 429);

  if (!safeEqual(await sha256hex(code), row.code_hash)) {
    await env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?').bind(email).run();
    return bad('Incorrect code', 401);
  }

  const now = Date.now();
  const token = randomToken();
  const device = (req.headers.get('user-agent') || 'unknown').slice(0, 120);

  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email),
    env.DB.prepare('INSERT OR IGNORE INTO users (email, created_at) VALUES (?, ?)').bind(email, now),
    env.DB.prepare('UPDATE users SET last_seen = ? WHERE email = ?').bind(now, email),
    env.DB.prepare('INSERT INTO sessions (token_hash, email, created_at, expires_at, last_used, device) VALUES (?,?,?,?,?,?)')
      .bind(await sha256hex(token), email, now, now + SESSION_TTL_MS, now, device),
    env.DB.prepare('INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)').bind('owner', email),
  ]);

  // `hasVault` lets the client warn accurately: an emailed code proves you own
  // the address, but it cannot decrypt anything, so the browser still needs its
  // own copy of the key to keep what is already stored.
  const v = await env.DB.prepare('SELECT chunks FROM vaults WHERE email = ?').bind(email).first();
  return json({ token, email, expiresAt: now + SESSION_TTL_MS, hasVault: !!(v && v.chunks > 0) });
}

async function authenticate(req, env) {
  const header = req.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const row = await env.DB.prepare('SELECT email, expires_at FROM sessions WHERE token_hash = ?')
    .bind(await sha256hex(token)).first();
  if (!row || Date.now() > row.expires_at) return null;
  return { email: row.email, tokenHash: await sha256hex(token) };
}

/* ---------- vault ---------- */
/** The wrapped master keys. Opaque to the server. */
async function getKeys(env, email) {
  const r = await env.DB.prepare(
    'SELECT wrap_pass, pass_salt, wrap_recovery, recovery_salt, recovery_hint FROM vault_keys WHERE email = ?'
  ).bind(email).first();
  if (!r) return null;
  return {
    wrapPass: r.wrap_pass ? JSON.parse(r.wrap_pass) : null,
    passSalt: r.pass_salt,
    wrapRecovery: r.wrap_recovery ? JSON.parse(r.wrap_recovery) : null,
    recoverySalt: r.recovery_salt,
    recoveryHint: r.recovery_hint,
  };
}

async function putKeys(env, email, keys) {
  if (!keys) return;
  await env.DB.prepare(
    `INSERT INTO vault_keys (email, wrap_pass, pass_salt, wrap_recovery, recovery_salt, recovery_hint, updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7)
     ON CONFLICT(email) DO UPDATE SET
       wrap_pass=?2, pass_salt=?3, wrap_recovery=?4, recovery_salt=?5, recovery_hint=?6, updated_at=?7`
  ).bind(
    email,
    keys.wrapPass ? JSON.stringify(keys.wrapPass) : null,
    keys.passSalt || null,
    keys.wrapRecovery ? JSON.stringify(keys.wrapRecovery) : null,
    keys.recoverySalt || null,
    (keys.recoveryHint || '').slice(0, 12) || null,
    Date.now()
  ).run();
}

async function getVault(env, email) {
  const meta = await env.DB.prepare(
    'SELECT version, updated_at, salt, chunks, size, device FROM vaults WHERE email = ?').bind(email).first();
  if (!meta || !meta.chunks) {
    return { version: meta?.version || 0, blob: null, salt: meta?.salt || null,
      updatedAt: meta?.updated_at || null, keys: await getKeys(env, email) };
  }

  const { results } = await env.DB.prepare('SELECT idx, data FROM vault_chunks WHERE email = ? ORDER BY idx ASC')
    .bind(email).all();
  return {
    version: meta.version,
    updatedAt: meta.updated_at,
    salt: meta.salt,
    size: meta.size,
    device: meta.device,
    blob: results.map(r => r.data).join(''),
    keys: await getKeys(env, email),
  };
}

async function putVault(req, env, email) {
  const body = await req.json().catch(() => ({}));
  const blob = String(body.blob || '');
  const expected = Number(body.version);
  if (!blob) return bad('Nothing to save');
  if (!Number.isInteger(expected) || expected < 0) return bad('A version number is required');

  const chunkCount = Math.ceil(blob.length / CHUNK_LIMIT);
  if (chunkCount > MAX_CHUNKS)
    return bad(`Vault is too large to sync (${(blob.length / 1048576).toFixed(1)} MB). Remove some attachments.`, 413);

  const current = await env.DB.prepare('SELECT version FROM vaults WHERE email = ?').bind(email).first();
  const serverVersion = current?.version || 0;
  if (serverVersion !== expected) {
    return json({ error: 'conflict', serverVersion, yourVersion: expected }, 409);
  }

  const now = Date.now();
  const next = serverVersion + 1;
  const device = (req.headers.get('user-agent') || 'unknown').slice(0, 120);

  const stmts = [
    env.DB.prepare('DELETE FROM vault_chunks WHERE email = ?').bind(email),
    env.DB.prepare(
      `INSERT INTO vaults (email, version, updated_at, salt, encrypted, chunks, size, device)
       VALUES (?1,?2,?3,?4,1,?5,?6,?7)
       ON CONFLICT(email) DO UPDATE SET
         version=?2, updated_at=?3, salt=?4, chunks=?5, size=?6, device=?7`
    ).bind(email, next, now, body.salt || null, chunkCount, blob.length, device),
  ];
  for (let i = 0; i < chunkCount; i++) {
    stmts.push(env.DB.prepare('INSERT INTO vault_chunks (email, idx, data) VALUES (?,?,?)')
      .bind(email, i, blob.slice(i * CHUNK_LIMIT, (i + 1) * CHUNK_LIMIT)));
  }
  await env.DB.batch(stmts);
  if (body.keys) await putKeys(env, email, body.keys);
  return json({ version: next, updatedAt: now, size: blob.length });
}

/* ---------- router ---------- */
async function api(req, env, url) {
  const path = url.pathname;
  const method = req.method;

  if (path === '/api/health') return json({ ok: true, name: env.APP_NAME || 'Cash Checker' });

  // email + password
  if (path === '/api/auth/register' && method === 'POST') return register(req, env);
  if (path === '/api/auth/login' && method === 'POST') return login(req, env);
  if (path === '/api/auth/recover' && method === 'POST') return recoverStart(req, env);
  if (path === '/api/auth/reset' && method === 'POST') return recoverFinish(req, env);
  if (path === '/api/auth/exists' && method === 'POST') {
    const b = await req.json().catch(() => ({}));
    return json({ exists: await accountExists(env, normEmail(b.email)) });
  }

  // legacy one-time code
  if (path === '/api/auth/request' && method === 'POST') return requestCode(req, env);
  if (path === '/api/auth/verify' && method === 'POST') return verifyCode(req, env);

  const session = await authenticate(req, env);
  if (!session) return bad('Not signed in', 401);

  if (path === '/api/auth/change-password' && method === 'POST') return changePassword(req, env, session.email);
  if (path === '/api/auth/logout' && method === 'POST') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(session.tokenHash).run();
    return json({ ok: true });
  }
  if (path === '/api/me' && method === 'GET') {
    const meta = await env.DB.prepare('SELECT version, updated_at, size, device FROM vaults WHERE email = ?')
      .bind(session.email).first();
    const devices = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE email = ? AND expires_at > ?')
      .bind(session.email, Date.now()).first();
    return json({
      email: session.email,
      version: meta?.version || 0,
      updatedAt: meta?.updated_at || null,
      size: meta?.size || 0,
      lastDevice: meta?.device || null,
      activeSessions: devices?.n || 1,
    });
  }
  // Wrapped master keys. Fetched before unlocking; updated when the passphrase
  // or recovery code changes, without re-uploading the vault itself.
  if (path === '/api/keys' && method === 'GET') return json({ keys: await getKeys(env, session.email) });
  if (path === '/api/keys' && method === 'PUT') {
    const body = await req.json().catch(() => ({}));
    if (!body.keys || !body.keys.wrapPass) return bad('Missing wrapped key');
    await putKeys(env, session.email, body.keys);
    return json({ ok: true });
  }

  if (path === '/api/vault' && method === 'GET') return json(await getVault(env, session.email));
  if (path === '/api/vault' && method === 'PUT') return putVault(req, env, session.email);
  if (path === '/api/vault' && method === 'DELETE') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM vault_chunks WHERE email = ?').bind(session.email),
      env.DB.prepare('DELETE FROM vaults WHERE email = ?').bind(session.email),
      env.DB.prepare('DELETE FROM vault_keys WHERE email = ?').bind(session.email),
    ]);
    return json({ ok: true });
  }
  if (path === '/api/sessions' && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM sessions WHERE email = ? AND token_hash != ?')
      .bind(session.email, session.tokenHash).run();
    return json({ ok: true });
  }
  return bad('Unknown endpoint', 404);
}

/**
 * Cross-origin access is OFF unless DEV_CORS_ORIGIN is set, which only the
 * local dev config does. In production the app and the API share an origin,
 * so no CORS headers are needed — and not emitting them keeps the auth API
 * unreachable from any other website.
 */
function corsHeaders(env, req) {
  const allow = env.DEV_CORS_ORIGIN;
  if (!allow) return null;
  const origin = req.headers.get('Origin') || '';
  if (allow !== '*' && origin !== allow) return null;
  return {
    'Access-Control-Allow-Origin': origin || allow,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname.startsWith('/api/')) {
      const cors = corsHeaders(env, req);
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors || {} });
      let res;
      try {
        res = await api(req, env, url);
      } catch (err) {
        console.log('[api error]', err?.stack || String(err));
        // Never leak internals (table names, SQL) to the browser.
        res = bad('Server error - check `npx wrangler tail` for details', 500);
      }
      if (cors) {
        res = new Response(res.body, res);
        for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      }
      return res;
    }
    return env.ASSETS.fetch(req);
  },
};
