/* ═══════════ landing.js — the sign in / sign up screen ═══════════
   Shown full-screen before the app when a backend exists and nobody is
   signed in. It is skippable on purpose: Cash Checker works completely
   offline, and forcing an account on a local-first app would be a lie.
   ═══════════════════════════════════════════════════════════════════ */

import { $, esc } from './util.js';
import { h, frag, icon, toast, modal } from './ui.js';

const SKIP_KEY = 'cc.skipAuth';
export const hasSkipped = () => localStorage.getItem(SKIP_KEY) === '1';
export const clearSkip = () => localStorage.removeItem(SKIP_KEY);

/**
 * @param {object} S       the sync module
 * @param {function} onDone called when the user signs in, or chooses to skip
 */
export function showLanding(S, onDone) {
  const root = $('#landing');
  if (!root) return onDone?.();

  let mode = 'signin';
  const card = h('div', { class: 'landing-card' });

  const finish = (signedIn) => {
    root.hidden = true;
    document.body.classList.remove('landing-open');
    onDone?.(signedIn);
  };

  /* ---------- shared bits ---------- */
  const tabs = h('div', { class: 'landing-tabs' });
  // Tab labels stay distinct from the submit buttons ("Sign in" / "Create account"),
  // so "click Create account" is never ambiguous.
  [['signin', 'Sign in'], ['signup', 'Sign up']].forEach(([v, label]) =>
    tabs.append(h('button', { class: v === mode ? 'on' : '', text: label,
      onClick: () => { mode = v; paint(); } })));

  const feature = (emoji, title, text) =>
    h('div', { class: 'lf' }, h('span', { class: 'lf-i', text: emoji }),
      h('div', {}, h('b', { text: title }), h('span', { text })));

  /* ---------- forms ---------- */
  function signInForm() {
    const email = h('input', { class: 'inp', type: 'email', placeholder: 'you@example.com', autocomplete: 'email' });
    const pass = h('input', { class: 'inp', type: 'password', placeholder: 'Your password', autocomplete: 'current-password' });
    const btn = h('button', { class: 'btn primary block', onClick: go }, 'Sign in');

    async function go() {
      const e = email.value.trim(), p = pass.value;
      if (!e || !p) { toast('Enter your email and password', 'warn'); return; }
      btn.disabled = true; btn.textContent = 'Signing in…';
      try {
        const res = await S.signIn(e, p);
        if (res.unlocked) {
          try { await S.pull(); } catch { /* nothing stored yet is fine */ }
          toast('Welcome back', 'ok');
          finish(true);
        } else {
          toast('Signed in, but that password did not unlock your data', 'warn');
          btn.disabled = false; btn.textContent = 'Sign in';
          recoveryDialog(S, e, finish);
        }
      } catch (err) {
        toast(err.message, 'err');
        btn.disabled = false; btn.textContent = 'Sign in';
      }
    }
    [email, pass].forEach(i => i.addEventListener('keydown', ev => { if (ev.key === 'Enter') go(); }));

    return frag(
      h('div', { class: 'field' }, h('label', { text: 'Email address' }), email),
      h('div', { class: 'field mt-sm' }, h('label', { text: 'Password' }), pass),
      h('div', { class: 'mt' }, btn),
      h('div', { class: 'row between mt-sm' },
        h('button', { class: 'btn ghost sm', onClick: () => { mode = 'signup'; paint(); } }, 'New here? Create one'),
        h('button', { class: 'btn ghost sm', onClick: () => recoveryDialog(S, email.value.trim(), finish) }, 'Forgot password?')));
  }

  function signUpForm() {
    const email = h('input', { class: 'inp', type: 'email', placeholder: 'you@example.com', autocomplete: 'email' });
    const pass = h('input', { class: 'inp', type: 'password', placeholder: 'At least 8 characters', autocomplete: 'new-password' });
    const conf = h('input', { class: 'inp', type: 'password', placeholder: 'Type it again', autocomplete: 'new-password' });
    const meter = h('div', { class: 'bar thin mt-sm' }, h('i', { style: { width: '0%' } }));
    const meterTxt = h('div', { class: 'hint', text: 'Longer is stronger. This also encrypts your data.' });
    const btn = h('button', { class: 'btn primary block', onClick: go }, 'Create account');

    pass.addEventListener('input', async () => {
      const { passwordStrength } = await import('./util.js');
      const { score, label } = passwordStrength(pass.value);
      const bar = meter.querySelector('i');
      bar.style.width = `${(score / 6) * 100}%`;
      bar.className = score >= 5 ? 'pos' : score >= 3 ? 'warn' : 'neg';
      meterTxt.textContent = pass.value ? label : 'Longer is stronger. This also encrypts your data.';
    });

    async function go() {
      const e = email.value.trim(), p = pass.value;
      if (!e) { toast('Enter your email', 'warn'); return; }
      if (p.length < 8) { toast('Password must be at least 8 characters', 'warn'); return; }
      if (p !== conf.value) { toast('The two passwords do not match', 'warn'); return; }
      btn.disabled = true; btn.textContent = 'Creating…';
      try {
        if (await S.accountExists(e)) {
          toast('That email already has an account — sign in instead', 'warn');
          mode = 'signin'; paint(); return;
        }
        const code = await S.signUp(e, p);
        await S.push({ force: true });
        recoveryCodeDialog(code, () => finish(true));
      } catch (err) {
        toast(err.message, 'err');
        btn.disabled = false; btn.textContent = 'Create account';
      }
    }
    conf.addEventListener('keydown', ev => { if (ev.key === 'Enter') go(); });

    return frag(
      h('div', { class: 'field' }, h('label', { text: 'Email address' }), email),
      h('div', { class: 'field mt-sm' }, h('label', { text: 'Password' }), pass, meter, meterTxt),
      h('div', { class: 'field mt-sm' }, h('label', { text: 'Confirm password' }), conf),
      h('div', { class: 'mt' }, btn),
      h('div', { class: 'row mt-sm' },
        h('button', { class: 'btn ghost sm', onClick: () => { mode = 'signin'; paint(); } }, 'I already have an account')));
  }

  /* ---------- paint ---------- */
  function paint() {
    [...tabs.children].forEach((c, i) => c.classList.toggle('on', ['signin', 'signup'][i] === mode));
    card.innerHTML = '';
    card.append(
      h('h2', { class: 'landing-h', text: mode === 'signin' ? 'Welcome back' : 'Create your account' }),
      h('p', { class: 'landing-sub', text: mode === 'signin'
        ? 'Sign in to reach your data on this device.'
        : 'One password signs you in and unlocks your data.' }),
      tabs,
      mode === 'signin' ? signInForm() : signUpForm(),
      h('div', { class: 'landing-sep' }, h('span', { text: 'or' })),
      h('button', { class: 'btn block', onClick: () => {
        localStorage.setItem(SKIP_KEY, '1');
        toast('Using Cash Checker offline. Sign in any time from the sidebar.', 'info', { timeout: 5000 });
        finish(false);
      } }, 'Use offline without an account'),
      h('p', { class: 'landing-fine', text: 'Everything works offline either way. An account only adds encrypted backup and sync across your devices.' }));
  }

  root.innerHTML = '';
  root.append(
    h('div', { class: 'landing-inner' },
      h('div', { class: 'landing-hero' },
        h('div', { class: 'landing-brand' },
          h('span', { class: 'landing-mark', html: `<svg viewBox="0 0 48 48" width="44" height="44"><use href="#i-logo"/></svg>` }),
          h('div', {}, h('b', { text: 'Cash Checker' }), h('small', { text: 'Financial operating system' }))),
        h('h1', { class: 'landing-title', text: 'Every rupee, accounted for.' }),
        h('p', { class: 'landing-lede', text: 'Track income and expenses, run a credit book, manage investments and marketing budgets, and see where your money is going — all in one place.' }),
        h('div', { class: 'landing-features' },
          feature('🔐', 'End-to-end encrypted', 'Your data is encrypted on this device before it is ever uploaded.'),
          feature('📱', 'Works on every device', 'Sign in anywhere and your data follows you.'),
          feature('⚡', 'Works offline', 'No connection needed. It syncs when you are back.'))),
      card));

  paint();
  root.hidden = false;
  document.body.classList.add('landing-open');
  setTimeout(() => root.querySelector('input')?.focus(), 120);
}

/* ---------- forgotten password ----------
   A real reset, with no password required. The recovery code proves ownership
   to the server AND unwraps the master key in the browser, so the new password
   can be wrapped around the same key — the vault already in the cloud stays
   readable, and the server never sees any of it. */
function recoveryDialog(S, presetEmail, finish) {
  const email = h('input', { class: 'inp', type: 'email', value: presetEmail || '',
    placeholder: 'you@example.com', autocomplete: 'username' });
  const code = h('input', { class: 'inp mono', placeholder: 'XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX',
    style: { letterSpacing: '.05em' }, autocomplete: 'off', spellcheck: 'false' });

  // Closing normally throws the half-finished reset away, but handing off to the
  // password step must not — that step owns the unwrapped key from here on.
  let handedOff = false;

  const m = modal({
    title: 'Forgot your password?',
    subtitle: 'Your recovery code resets it — no password needed.',
    onClose: () => { if (!handedOff) S.cancelRecovery?.(); },
    body: frag(
      h('div', { class: 'field' }, h('label', { text: 'Email address' }), email),
      h('div', { class: 'field mt' }, h('label', { text: 'Recovery code' }), code,
        h('div', { class: 'hint', text: 'Dashes, spaces and capitals do not matter.' })),
      h('div', { class: 'insight mt' }, h('div', { class: 'ic', html: icon('alert', 15) }),
        h('div', { class: 'tt', style: { flex: 1 } }, h('b', { text: 'No recovery code either?' }),
          h('p', { text: 'You can still get the account back with a code emailed to you. That proves the address is yours, but it cannot decrypt anything — so read what the next screen says about your data before confirming.' }),
          h('button', { class: 'btn sm mt-sm', onClick: () => { handedOff = true; m.close(); emailResetDialog(S, email.value.trim(), finish); } },
            'Reset by email instead')))),
    footer: frag(h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onClick: async e => {
        const addr = email.value.trim();
        if (!addr || !code.value.trim()) { toast('Enter your email and recovery code', 'warn'); return; }
        const btn = e.currentTarget;
        btn.disabled = true; btn.textContent = 'Checking…';
        try {
          await S.startRecovery(addr, code.value);
          handedOff = true;
          m.close();
          newPasswordDialog(S, addr, finish);
        } catch (err) {
          toast(err.message, 'err');
          btn.disabled = false; btn.textContent = 'Continue';
        }
      } }, 'Continue')),
  });
}

/* ---------- last resort: reset by emailed code ----------
   Honest about the trade: this returns the ACCOUNT, and returns the DATA only
   when this browser still holds the key. It never pretends the server could
   decrypt something it cannot. */
function emailResetDialog(S, presetEmail, finish) {
  const email = h('input', { class: 'inp', type: 'email', value: presetEmail || '',
    placeholder: 'you@example.com', autocomplete: 'username' });
  const code = h('input', { class: 'inp mono', placeholder: '000000', maxlength: 6,
    inputmode: 'numeric', style: { letterSpacing: '.3em', textAlign: 'center', fontSize: '1.15rem' } });
  const codeField = h('div', { class: 'field mt', hidden: true },
    h('label', { text: 'Code from your email' }), code,
    h('div', { class: 'hint', text: 'Valid for 10 minutes.' }));
  const note = h('div', { class: 'insight mt' }, h('div', { class: 'ic', html: icon('alert', 15) }),
    h('div', { class: 'tt' }, h('b', { text: 'What this can and cannot do' }),
      h('p', { text: 'It gives you the account back. Whatever is on this device stays exactly as it is. The encrypted cloud copy can only be reopened if this browser still holds the key — otherwise it is replaced by what this device has.' })));

  let sent = false;
  const m = modal({
    title: 'Reset by email', size: '',
    subtitle: 'For when the password and the recovery code are both gone.',
    body: frag(h('div', { class: 'field' }, h('label', { text: 'Email address' }), email), codeField, note),
    footer: frag(h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onClick: async e => {
        const addr = email.value.trim();
        if (!addr) { toast('Enter your email', 'warn'); return; }
        const btn = e.currentTarget;
        btn.disabled = true;

        if (!sent) {
          btn.textContent = 'Sending…';
          try {
            const delivery = await S.requestEmailReset(addr);
            sent = true;
            codeField.hidden = false;
            email.readOnly = true;
            btn.textContent = 'Verify code';
            btn.disabled = false;
            code.focus();
            if (delivery === 'email') toast('Code sent — check your inbox', 'ok');
            else {
              // Never leave someone waiting for mail that was never sent.
              toast('Email sending is not set up on this server, so no message went out', 'err', { timeout: 9000 });
              note.innerHTML = '';
              note.append(h('div', { class: 'ic', html: icon('alert', 15) }),
                h('div', { class: 'tt' }, h('b', { text: 'No email was actually sent' }),
                  h('p', { text: 'This deployment has no mail provider configured, so the code only reached the server log. Set a Brevo API key on the Pages project to turn this on — until then, the recovery code is the only way in.' })));
            }
          } catch (err) {
            toast(err.message, 'err');
            btn.textContent = 'Send code'; btn.disabled = false;
          }
          return;
        }

        btn.textContent = 'Checking…';
        try {
          const r = await S.verifyEmailReset(addr, code.value.trim());
          m.close();
          emailResetOutcome(S, addr, r, finish);
        } catch (err) {
          toast(err.message, 'err');
          btn.textContent = 'Verify code'; btn.disabled = false;
        }
      } }, 'Send code')),
  });
  setTimeout(() => (presetEmail ? m.dialog.querySelector('.btn.primary') : email).focus?.(), 60);
}

/** Says plainly what the reset is about to do to the data, then does it. */
function emailResetOutcome(S, addr, r, finish) {
  const good = r.canDecrypt;
  const m = modal({
    title: good ? 'Your data is safe' : 'Before you continue', size: '', closeOnBack: false,
    subtitle: good
      ? 'This browser still holds your key, so nothing is lost.'
      : 'Read this — part of it cannot be undone.',
    body: frag(
      h('div', { class: `insight ${good ? 'pos' : 'warn'}` }, h('div', { class: 'ic', html: icon(good ? 'check' : 'alert', 15) }),
        h('div', { class: 'tt' },
          h('b', { text: good ? 'The cloud copy will be carried over' : 'The cloud copy cannot be opened again' }),
          h('p', { text: good
            ? 'Your encrypted data is pulled down, re-encrypted under the new password, and uploaded again. Nothing changes except the password and the recovery code.'
            : 'No password and no recovery code means nobody can decrypt what is on the server — not you, not Cloudflare, not me. Continuing replaces it with the data on this device.' }))),
      h('div', { class: 'insight mt' }, h('div', { class: 'ic', html: icon('check', 15) }),
        h('div', { class: 'tt' }, h('b', { text: `This device holds ${r.localRecords.toLocaleString()} records` }),
          h('p', { text: r.localRecords
            ? 'Those are untouched by any of this, and they become the new cloud copy.'
            : 'This device is empty. If your data is on another device, cancel and do this there instead — or restore a backup file first.' }))),
      !good && !r.localRecords ? h('div', { class: 'insight warn mt' }, h('div', { class: 'ic', html: icon('alert', 15) }),
        h('div', { class: 'tt' }, h('b', { text: 'Continuing now would leave you with nothing' }),
          h('p', { text: 'An empty device plus an unreadable cloud copy is a fresh start, not a recovery. Try another device or a backup file first.' }))) : null),
    footer: frag(h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'),
      h('button', { class: `btn ${good ? 'primary' : 'danger'}`, onClick: () => { m.close(); newPasswordDialog(S, addr, finish, { viaEmail: true }); } },
        good ? 'Set a new password' : 'I understand — continue')),
  });
}

/**
 * Step 2 of the reset: choose the replacement password.
 * `viaEmail` finishes through the emailed-code path instead of the recovery
 * code — same screen, different way of proving who you are.
 */
function newPasswordDialog(S, addr, finish, { viaEmail = false } = {}) {
  const pw = h('input', { class: 'inp', type: 'password', placeholder: 'At least 8 characters', autocomplete: 'new-password' });
  const pw2 = h('input', { class: 'inp', type: 'password', placeholder: 'Type it again', autocomplete: 'new-password' });
  const meter = h('div', { class: 'bar thin', style: { marginTop: '6px' } }, h('i', { style: { width: '0%' } }));
  const meterText = h('div', { class: 'hint', text: 'Use at least 8 characters. Longer is stronger.' });
  pw.addEventListener('input', async () => {
    const { passwordStrength } = await import('./util.js');
    const { score, label } = passwordStrength(pw.value);
    const bar = meter.querySelector('i');
    bar.style.width = `${(score / 6) * 100}%`;
    bar.className = score >= 5 ? 'pos' : score >= 3 ? 'warn' : 'neg';
    meterText.textContent = pw.value ? label : 'Use at least 8 characters. Longer is stronger.';
  });

  const m = modal({
    title: 'Choose a new password', size: 'narrow', closeOnBack: false,
    subtitle: `Signing back in as ${addr}. A fresh recovery code is issued too.`,
    onClose: () => { if (!viaEmail) S.cancelRecovery?.(); },
    body: frag(
      h('div', { class: 'field' }, h('label', { text: 'New password' }), pw, meter, meterText),
      h('div', { class: 'field mt' }, h('label', { text: 'Confirm new password' }), pw2),
      h('div', { class: 'insight mt' }, h('div', { class: 'ic', html: icon('alert', 15) }),
        h('div', { class: 'tt' }, h('b', { text: 'Other devices will be signed out' }),
          h('p', { text: 'Every existing session is revoked, so anyone else holding the old password loses access. Your data itself is untouched.' })))),
    footer: frag(h('div', { class: 'spacer' }),
      h('button', { class: 'btn primary', onClick: async e => {
        if (pw.value.length < 8) { toast('Password must be at least 8 characters', 'warn'); return; }
        if (pw.value !== pw2.value) { toast('The two passwords do not match', 'warn'); return; }
        const btn = e.currentTarget;
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
          const newCode = viaEmail ? await S.finishEmailReset(pw.value) : await S.finishRecovery(pw.value);
          if (!viaEmail) await S.pull().catch(() => {});
          m.close();
          toast('Password reset — you are signed in', 'ok');
          recoveryCodeDialog(newCode, () => finish?.(true));
        } catch (err) {
          toast(err.message, 'err');
          btn.disabled = false; btn.textContent = 'Save password';
        }
      } }, 'Save password')),
  });
}

/** Shown once, after sign-up and after a password reset. */
function recoveryCodeDialog(code, after) {
  let saved = false;
  let done = false;
  const once = () => { if (done) return; done = true; after?.(); };
  const m = modal({
    title: 'Save your recovery code', size: '', closeOnBack: false,
    subtitle: 'Shown once. It is the only way in if you forget your password.',
    body: frag(
      h('div', { class: 'hero', style: { textAlign: 'center' } }, h('div', { class: 'rel' },
        h('div', { class: 'mono', style: { fontSize: '1.3rem', fontWeight: 700, letterSpacing: '.06em', wordBreak: 'break-all', lineHeight: 1.7 }, text: code }))),
      h('div', { class: 'row wrap mt', style: { gap: '8px', justifyContent: 'center' } },
        h('button', { class: 'btn sm', html: `${icon('copy', 15)} Copy`, onClick: async () => {
          await navigator.clipboard.writeText(code); toast('Copied', 'ok'); saved = true; } }),
        h('button', { class: 'btn sm', html: `${icon('export', 15)} Download`, onClick: async () => {
          const { download } = await import('./util.js');
          download(`Cash Checker — recovery code\n\n${code}\n\nKeep this private and safe.\nIt unlocks your encrypted financial data if you forget your password.\n\nGenerated ${new Date().toLocaleString()}\n`,
            'cash-checker-recovery-code.txt', 'text/plain');
          toast('Saved to your downloads', 'ok'); saved = true; } }),
        h('button', { class: 'btn sm', html: `${icon('print', 15)} Print`, onClick: () => {
          const w = window.open('', '_blank');
          if (!w) { toast('Allow pop-ups to print', 'warn'); return; }
          w.document.write(`<!doctype html><meta charset="utf-8"><title>Recovery code</title>
            <div style="font:16px system-ui;padding:50px;max-width:600px">
            <h1 style="font-size:20px">Cash Checker — recovery code</h1>
            <p style="color:#555">Keep this private. It unlocks your encrypted financial data if you forget your password.</p>
            <div style="font:700 26px ui-monospace,monospace;letter-spacing:.08em;padding:22px;background:#f4f4f8;border-radius:10px;margin:22px 0;word-break:break-all">${esc(code)}</div>
            <p style="color:#888;font-size:13px">Generated ${new Date().toLocaleString()}</p></div>`);
          w.document.close(); setTimeout(() => w.print(), 300); saved = true; } })),
      h('div', { class: 'insight warn mt' }, h('div', { class: 'ic', html: icon('alert', 15) }),
        h('div', { class: 'tt' }, h('b', { text: 'It is never shown again' }),
          h('p', { text: 'Cash Checker keeps no readable copy — that is what makes the encryption real. Store it somewhere separate from your password.' })))),
    footer: frag(h('div', { class: 'spacer' }),
      h('button', { class: 'btn primary', onClick: () => {
        if (!saved && !window.confirm('You have not copied or saved the code yet. Continue anyway?')) return;
        m.close();
      } }, 'I have saved it')),
    onClose: once,
  });
}
