/* ═══════════ views/settings.js — preferences, security, data ═══════════ */

import {
  h, frag, icon, card, stat, tag, empty, toast, confirm, modal, formModal, store, state, settings,
  fmtMoney, fmtDate, today, sortBy, pageHead, kpiGrid, download, currencyOptions,
} from './common.js';
import { form, dataTable, applyPrivacy } from '../ui.js';
import * as db from '../db.js';
import {
  pbkdf2, deriveKey, aesEncrypt, aesDecrypt, b64, humanSize, CURRENCIES, uid, relTime, esc, sha256,
  resizeImage, initials,
} from '../util.js';
import { seedDemoData, seedStarterData } from '../seed.js';
import { trainCategorizer } from '../ai.js';

export async function render(root, api) {
  // #/settings/account opens straight on that tab, so links can deep-link.
  const requested = api.params?.[0];
  let tab = TABS.some(t => t[0] === requested) ? requested : 'profile';
  const draw = () => { root.innerHTML = ''; root.append(build(tab, t => { tab = t; draw(); }, draw, api)); };
  draw();
  return store.bus.on('change', ({ store: s }) => { if (s === 'settings') draw(); });
}

const TABS = [['profile', 'Profile'], ['general', 'General'], ['account', 'Account & sync'],
  ['security', 'Security'], ['notifications', 'Notifications'], ['data', 'Data & backup'], ['about', 'About']];

function build(tab, setTab, redraw, api) {
  const wrap = h('div', {});
  api.setSubtitle((TABS.find(t => t[0] === tab) || [, ''])[1]);
  wrap.append(pageHead('Settings', 'Preferences, security and your data — all of it stays on this device.'));

  const tabsEl = h('div', { class: 'tabs mb' });
  TABS.forEach(([v, l]) => tabsEl.append(h('button', { class: v === tab ? 'on' : '', text: l, onClick: () => setTab(v) })));
  wrap.append(tabsEl);

  wrap.append(({ profile: profilePanel, general: generalPanel, account: accountPanel,
    security: securityPanel, notifications: notifyPanel, data: dataPanel, about: aboutPanel }[tab])(redraw, api));
  return wrap;
}

/* ═══════════ profile ═══════════ */
function profilePanel(redraw) {
  const wrap = h('div', {});
  let photo = settings.profilePhoto || null;

  const avatar = h('div', { class: 'pfp-big' });
  const drawAvatar = () => {
    avatar.innerHTML = '';
    const nm = (nameInp?.value || settings.profileName || '').trim();
    if (photo) avatar.append(h('img', { src: photo, alt: 'Profile photo' }));
    else avatar.append(h('span', { text: nm ? initials(nm) : '👤' }));
    removeBtn.hidden = !photo;
    sizeNote.textContent = photo ? `Photo stored · about ${humanSize(Math.round(photo.length * 0.75))}` : 'No photo set';
  };

  const fileInp = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const camInp = h('input', { type: 'file', accept: 'image/*', capture: 'user', hidden: true });
  const sizeNote = h('div', { class: 'tiny t3' });

  const pick = async files => {
    const file = files?.[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast('Choose an image file', 'warn'); return; }
    try {
      photo = await resizeImage(file, 256, 0.85);   // shrunk so it barely affects sync size
      drawAvatar();
      toast('Photo ready — press Save to keep it', 'info');
    } catch (e) { toast(e.message || 'Could not read that image', 'err'); }
  };
  fileInp.addEventListener('change', () => pick(fileInp.files));
  camInp.addEventListener('change', () => pick(camInp.files));

  const removeBtn = h('button', { class: 'btn sm danger', hidden: true,
    html: `${icon('trash', 15)} Remove photo`,
    onClick: () => { photo = null; fileInp.value = ''; camInp.value = ''; drawAvatar(); toast('Photo removed — press Save', 'info'); } });

  const nameInp = h('input', { class: 'inp', type: 'text', value: settings.profileName || '',
    placeholder: 'Your name', autocomplete: 'name' });
  nameInp.addEventListener('input', drawAvatar);
  const emailInp = h('input', { class: 'inp', type: 'email', value: settings.profileEmail || '',
    placeholder: 'you@example.com', autocomplete: 'email' });
  const phoneInp = h('input', { class: 'inp', type: 'tel', value: settings.profilePhone || '',
    placeholder: '+91 98765 43210', autocomplete: 'tel' });

  wrap.append(section('Your profile',
    'Shown in the sidebar and included on printed statements and reports. It is stored with your data — encrypted before upload if cloud sync is on.',
    h('div', { class: 'row', style: { gap: '20px', alignItems: 'center', flexWrap: 'wrap' } },
      avatar,
      h('div', { style: { display: 'grid', gap: '8px' } },
        h('div', { class: 'row wrap', style: { gap: '8px' } },
          h('button', { class: 'btn sm', html: `${icon('import', 15)} Choose photo`, onClick: () => fileInp.click() }),
          h('button', { class: 'btn sm', html: `${icon('user', 15)} Take photo`, onClick: () => camInp.click() }),
          removeBtn),
        sizeNote)),
    fileInp, camInp,
    h('div', { class: 'grid g2 mt', style: { gap: '13px' } },
      h('div', { class: 'field' }, h('label', { text: 'Name' }), nameInp),
      h('div', { class: 'field' }, h('label', { text: 'Email' }), emailInp),
      h('div', { class: 'field' }, h('label', { text: 'Phone' }), phoneInp)),
    h('div', { class: 'row wrap mt', style: { gap: '8px' } },
      h('button', { class: 'btn primary', onClick: async () => {
        const email = emailInp.value.trim();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { toast('That email does not look valid', 'warn'); return; }
        await store.setSettings({
          profileName: nameInp.value.trim(),
          profileEmail: email,
          profilePhone: phoneInp.value.trim(),
          profilePhoto: photo,
        });
        toast('Profile saved', 'ok');
        redraw();
      } }, 'Save profile'),
      h('button', { class: 'btn', onClick: () => {
        photo = settings.profilePhoto || null;
        nameInp.value = settings.profileName || '';
        emailInp.value = settings.profileEmail || '';
        phoneInp.value = settings.profilePhone || '';
        drawAvatar();
        toast('Changes discarded', 'info');
      } }, 'Cancel'))));

  wrap.append(section('Clear profile', 'Removes the name, email, phone and photo. Your financial data is untouched.',
    h('button', { class: 'btn danger', onClick: async () => {
      if (!await confirm({ title: 'Clear your profile?', danger: true, confirmText: 'Clear',
        message: 'The name, email, phone and photo are removed. No transactions, accounts or reports are affected.' })) return;
      await store.setSettings({ profileName: '', profileEmail: '', profilePhone: '', profilePhoto: null });
      toast('Profile cleared', 'ok');
      redraw();
    } }, 'Clear profile')));

  drawAvatar();
  return wrap;
}

/* ═══════════ account & sync ═══════════ */
function accountPanel(redraw) {
  const wrap = h('div', {});
  const host = h('div', {});
  wrap.append(host);
  host.append(h('div', { class: 'card pad' }, h('div', { class: 'skel', style: { height: '90px' } })));

  (async () => {
    const S = await import('../sync.js');
    const available = await S.isAvailable();
    const draw = () => {
      host.innerHTML = '';
      host.append(renderAccount(S, available, draw, redraw));
    };
    draw();
    S.onSyncChange(() => { /* status line only */ draw(); });
  })();
  return wrap;
}

function renderAccount(S, available, draw, redraw) {
  const box = h('div', {});
  const st = S.sync;

  if (!available) {
    box.append(section('Cloud sync is not deployed here', null,
      h('div', { class: 'insight' }, h('div', { class: 'ic', html: icon('cloud', 15) }),
        h('div', { class: 'tt' }, h('b', { text: 'No backend responding at this address' }),
          h('p', { text: 'You are running the offline-only build (for example from localhost or plain static hosting). Everything works, but there is no email login and nothing is synced. Deploy the Cloudflare Worker — see CLOUDFLARE-SETUP.md — and this section activates automatically.' })))));
    return box;
  }

  const statusTone = { idle: 'pos', syncing: 'info', offline: 'warn', conflict: 'neg', error: 'neg', locked: 'warn', 'signed-out': '' }[st.status] || '';
  const statusText = {
    idle: 'Synced', syncing: 'Syncing…', offline: 'Offline — will sync when reconnected',
    conflict: 'Conflict — needs your decision', error: 'Sync error', locked: 'Passphrase required',
    'signed-out': 'Not signed in',
  }[st.status] || st.status;

  /* ---------- signed out: sign in / sign up ---------- */
  if (!S.isSignedIn()) {
    box.append(authPanel(S, draw, redraw));
    return box;
  }

  /* ---------- signed in but the data could not be unlocked ---------- */
  if (!S.hasKey()) {
    const pass = h('input', { class: 'inp', type: 'password', placeholder: '••••••••', autocomplete: 'current-password' });
    box.append(section('Unlock your data',
      `Signed in as ${S.currentEmail()}, but your data is still locked. Re-enter your password, or use your recovery code.`,
      h('div', { class: 'field' }, h('label', { text: 'Password' }), pass),
      h('div', { class: 'row wrap mt-sm', style: { gap: '8px' } },
        h('button', { class: 'btn primary', onClick: async () => {
          if (!pass.value) { toast('Enter your password', 'warn'); return; }
          try {
            const res = await S.signIn(S.currentEmail(), pass.value);
            if (res.unlocked) {
              toast('Unlocked', 'ok');
              try { await S.pull(); redraw(); } catch { /* empty vault is fine */ }
              draw();
            } else toast('That password did not unlock your data', 'err');
          } catch (e) { toast(e.message, 'err'); }
        } }, 'Unlock'),
        h('button', { class: 'btn', onClick: () => forgotPassword(S, S.currentEmail(), draw, redraw) }, 'Use recovery code'),
        h('button', { class: 'btn ghost', onClick: async () => { await S.signOut(); draw(); } }, 'Sign out'))));
    return box;
  }

  /* ---------- signed in & unlocked ---------- */
  const info = h('div', { class: 'tiny t3', text: 'Loading account…' });
  S.serverInfo().then(me => {
    info.innerHTML = '';
    info.append(h('dl', { class: 'kv' },
      h('dt', { text: 'Signed in as' }), h('dd', { text: me.email }),
      h('dt', { text: 'Cloud version' }), h('dd', { class: 'num', text: '#' + (me.version || 0) }),
      h('dt', { text: 'Last uploaded' }), h('dd', { text: me.updatedAt ? new Date(me.updatedAt).toLocaleString() : 'never' }),
      h('dt', { text: 'Encrypted size' }), h('dd', { class: 'num', text: me.size ? humanSize(me.size) : '—' }),
      h('dt', { text: 'Active sessions' }), h('dd', { class: 'num', text: String(me.activeSessions || 1) })));
  }).catch(e => { info.textContent = e.message; });

  box.append(section('Sync status', null,
    h('div', { class: 'row between mb' },
      h('span', {}, tag(statusText, statusTone)),
      h('span', { class: 'tiny t3', text: st.lastSyncedAt ? 'Last sync ' + new Date(st.lastSyncedAt).toLocaleTimeString() : 'Not synced yet' })),
    st.status === 'conflict' ? h('div', { class: 'insight neg', style: { marginBottom: '12px' } },
      h('div', { class: 'ic', html: icon('alert', 15) }),
      h('div', { class: 'tt' }, h('b', { text: 'Another device changed your data' }),
        h('p', { text: 'Both this device and the cloud copy have changes. Choose which one to keep — the other version is replaced.' }),
        h('div', { class: 'row mt-sm', style: { gap: '8px' } },
          h('button', { class: 'btn xs primary', onClick: async () => {
            try { await S.resolveConflict('local'); toast('This device uploaded', 'ok'); draw(); } catch (e) { toast(e.message, 'err'); } } }, 'Keep this device'),
          h('button', { class: 'btn xs neg', onClick: async () => {
            try { await S.resolveConflict('cloud'); toast('Cloud copy restored', 'ok'); redraw(); } catch (e) { toast(e.message, 'err'); } } }, 'Use cloud copy')))) : null,
    info,
    h('div', { class: 'row wrap mt', style: { gap: '8px' } },
      h('button', { class: 'btn primary', html: `${icon('cloud', 15)} Sync now`, onClick: async () => {
        try { await S.push(); toast('Uploaded', 'ok'); draw(); } catch (e) { if (!e.conflict) toast(e.message, 'err'); draw(); } } }),
      h('button', { class: 'btn', html: `${icon('import', 15)} Pull from cloud`, onClick: async () => {
        if (!await confirm({ title: 'Replace this device with the cloud copy?', danger: true, confirmText: 'Pull & replace',
          message: 'Everything currently on this device is replaced by what is stored in the cloud.' })) return;
        try { await S.pull(); toast('Cloud copy restored', 'ok'); redraw(); } catch (e) { toast(e.message, 'err'); } } }),
      h('button', { class: 'btn', onClick: async () => {
        if (!await confirm({ title: 'Sign out other devices?', message: 'Other browsers will need to sign in again with a fresh email code.', confirmText: 'Revoke' })) return;
        try { await S.revokeOtherDevices(); toast('Other sessions revoked', 'ok'); draw(); } catch (e) { toast(e.message, 'err'); } } }, 'Revoke other devices'),
      h('button', { class: 'btn', onClick: async () => { await S.signOut(); toast('Signed out on this device', 'ok'); draw(); } }, 'Sign out'))));

  /* recovery code management */
  const recoveryBox = h('div', { class: 'tiny t3', text: 'Checking recovery status…' });
  S.keyStatus().then(st2 => {
    recoveryBox.innerHTML = '';
    if (!st2.wrapped) {
      recoveryBox.append(h('div', { class: 'insight warn' },
        h('div', { class: 'ic', html: icon('alert', 15) }),
        h('div', { class: 'tt' },
          h('b', { text: 'No recovery code yet' }),
          h('p', { text: 'This vault was set up before recovery codes existed. If you forget the passphrase right now, the cloud copy cannot be opened. Generate one — it takes a second and nothing is lost.' }),
          h('button', { class: 'btn xs primary mt-sm', onClick: () => rotate(S, draw, 'Set up a recovery code') }, 'Generate a recovery code'))));
    } else if (!st2.recovery) {
      recoveryBox.append(h('div', { class: 'insight warn' },
        h('div', { class: 'ic', html: icon('alert', 15) }),
        h('div', { class: 'tt' }, h('b', { text: 'Recovery code missing' }),
          h('button', { class: 'btn xs primary mt-sm', onClick: () => rotate(S, draw, 'Generate a recovery code') }, 'Generate one'))));
    } else {
      recoveryBox.append(
        h('div', { class: 'row between' },
          h('div', {}, h('div', { style: { fontWeight: 600, fontSize: '.87rem' } }, 'Recovery code is active ',
            tag('Protected', 'pos')),
            h('div', { class: 'tiny t3', text: `Starts with ${st2.hint || '?????'}… — it unlocks your vault if you forget the passphrase.` })),
          h('button', { class: 'btn sm', onClick: () => rotate(S, draw, 'Replace the recovery code') }, 'New code')),
        h('div', { class: 'row wrap mt', style: { gap: '8px' } },
          h('button', { class: 'btn sm', onClick: () => setNewPassword(S, S.currentEmail(), draw) }, 'Change password')));
    }
  }).catch(() => { recoveryBox.textContent = 'Could not read recovery status.'; });

  box.append(section('Passphrase & recovery',
    'A recovery code is a second key to the same vault. Cloudflare still cannot read anything — the code only exists on your paper.',
    recoveryBox));

  box.append(section('Danger zone', 'Your local data is never touched by these.',
    h('button', { class: 'btn danger', onClick: async () => {
      if (!await confirm({ title: 'Delete the cloud copy?', danger: true, confirmText: 'Delete from cloud',
        message: 'The encrypted vault is erased from Cloudflare. Everything on this device stays exactly as it is, and the next sync will upload it again.' })) return;
      try { await S.deleteCloudCopy(); toast('Cloud copy deleted', 'ok'); draw(); } catch (e) { toast(e.message, 'err'); }
    } }, 'Delete cloud copy')));

  return box;
}

/* ═══════════ sign in / sign up ═══════════ */
function authPanel(S, draw, redraw) {
  const wrap = h('div', {});
  let mode = 'signin';           // 'signin' | 'signup'

  const host = h('div', {});
  const tabs = h('div', { class: 'tabs mb' });
  // Tab labels stay distinct from the submit buttons ("Create account",
  // "Sign in") so the two are never mistaken for one another.
  [['signin', 'Sign in'], ['signup', 'Sign up']].forEach(([v, label]) => {
    tabs.append(h('button', { class: v === mode ? 'on' : '', text: label,
      onClick: () => { mode = v; render(); } }));
  });

  function field(labelText, inp, hint) {
    return h('div', { class: 'field' }, h('label', { text: labelText }), inp,
      hint ? h('div', { class: 'hint', text: hint }) : null);
  }
  const emailInp = () => h('input', { class: 'inp', type: 'email', placeholder: 'you@example.com', autocomplete: 'email' });
  const passInp = (auto) => h('input', { class: 'inp', type: 'password', placeholder: '••••••••', autocomplete: auto });

  function render() {
    [...tabs.children].forEach((c, i) => c.classList.toggle('on', ['signin', 'signup'][i] === mode));
    host.innerHTML = '';
    host.append(mode === 'signin' ? signInForm() : signUpForm());
  }

  /* ---- sign in ---- */
  function signInForm() {
    const email = emailInp();
    const pass = passInp('current-password');
    const btn = h('button', { class: 'btn primary', onClick: submit }, 'Sign in');

    async function submit() {
      const e = email.value.trim(), p = pass.value;
      if (!e || !p) { toast('Enter your email and password', 'warn'); return; }
      btn.disabled = true; btn.textContent = 'Signing in…';
      try {
        const res = await S.signIn(e, p);
        if (res.unlocked) {
          toast('Signed in', 'ok');
          try { await S.pull(); toast('Your data is here', 'ok'); redraw(); } catch { /* empty vault is fine */ }
          draw();
        } else {
          toast('Signed in, but that password could not unlock your data', 'warn');
          forgotPassword(S, e, draw, redraw);
        }
      } catch (err) {
        toast(err.message, 'err');
        btn.disabled = false; btn.textContent = 'Sign in';
      }
    }
    pass.addEventListener('keydown', ev => { if (ev.key === 'Enter') submit(); });

    return section('Sign in', 'Use the email and password you signed up with.',
      field('Email address', email),
      field('Password', pass),
      h('div', { class: 'row wrap mt', style: { gap: '8px' } },
        btn,
        h('button', { class: 'btn ghost', onClick: () => { mode = 'signup'; render(); } }, 'New here? Sign up'),
        h('button', { class: 'btn ghost', onClick: () => forgotPassword(S, email.value.trim(), draw, redraw) },
          'Forgot password?')));
  }

  /* ---- sign up ---- */
  function signUpForm() {
    const email = emailInp();
    const pass = passInp('new-password');
    const confirm2 = passInp('new-password');
    const meter = h('div', { class: 'bar thin', style: { marginTop: '6px' } }, h('i', { style: { width: '0%' } }));
    const meterText = h('div', { class: 'hint', text: 'Use at least 8 characters. Longer is stronger.' });

    pass.addEventListener('input', async () => {
      const { passwordStrength } = await import('../util.js');
      const { score, label } = passwordStrength(pass.value);
      const pct = (score / 6) * 100;
      const bar = meter.querySelector('i');
      bar.style.width = `${pct}%`;
      bar.className = score >= 5 ? 'pos' : score >= 3 ? 'warn' : 'neg';
      meterText.textContent = pass.value ? `${label}` : 'Use at least 8 characters. Longer is stronger.';
    });

    const btn = h('button', { class: 'btn primary', onClick: submit }, 'Create account');

    async function submit() {
      const e = email.value.trim(), p = pass.value;
      if (!e) { toast('Enter your email', 'warn'); return; }
      if (p.length < 8) { toast('Password must be at least 8 characters', 'warn'); return; }
      if (p !== confirm2.value) { toast('The two passwords do not match', 'warn'); return; }
      btn.disabled = true; btn.textContent = 'Creating…';
      try {
        if (await S.accountExists(e)) {
          toast('An account already exists for that email — sign in instead', 'warn');
          mode = 'signin'; render(); return;
        }
        const code = await S.signUp(e, p);
        await S.push({ force: true });
        showRecoveryCode(code, draw);
      } catch (err) {
        toast(err.message, 'err');
        btn.disabled = false; btn.textContent = 'Create account';
      }
    }
    confirm2.addEventListener('keydown', ev => { if (ev.key === 'Enter') submit(); });

    return frag(
      section('Create your account',
        'One password signs you in and unlocks your data. Nothing else to remember.',
        field('Email address', email),
        h('div', { class: 'field' }, h('label', { text: 'Password' }), pass, meter, meterText),
        field('Confirm password', confirm2),
        h('div', { class: 'row wrap mt', style: { gap: '8px' } },
          btn,
          h('button', { class: 'btn ghost', onClick: () => { mode = 'signin'; render(); } }, 'I already have an account'))),
      section('How your password protects you', null,
        h('div', { class: 'col' },
          ...[['Your password never reaches the server',
               'The browser derives two separate keys from it — one proves who you are, the other encrypts your data and never leaves this device.'],
              ['Cloudflare stores only ciphertext',
               'Even with full access to the database, your transactions cannot be read.'],
              ['You get a recovery code',
               'Shown once after sign-up. It is the only way back in if you forget your password, because nobody can reset it for you.']]
            .map(([t, d]) => h('div', { class: 'insight' }, h('div', { class: 'ic', html: icon('shield', 15) }),
              h('div', { class: 'tt' }, h('b', { text: t }), h('p', { text: d })))))));
  }

  wrap.append(tabs, host);
  render();
  return wrap;
}

/**
 * Recovery-code path. Works with no password at all: the code proves ownership
 * to the server and unwraps the master key here, so a new password can be set
 * outright. Signed in already, it doubles as "my password stopped decrypting".
 */
function forgotPassword(S, presetEmail, draw, redraw) {
  const email = h('input', { class: 'inp', type: 'email', value: S.currentEmail() || presetEmail || '',
    placeholder: 'you@example.com', autocomplete: 'username' });
  const code = h('input', { class: 'inp mono', placeholder: 'XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX',
    style: { letterSpacing: '.05em' }, autocomplete: 'off', spellcheck: 'false' });
  let handedOff = false;
  const m = modal({
    title: 'Forgot your password?', size: '',
    subtitle: 'Your recovery code resets it — no password needed.',
    onClose: () => { if (!handedOff) S.cancelRecovery?.(); },
    body: frag(
      h('div', { class: 'field' }, h('label', { text: 'Email address' }), email),
      h('div', { class: 'field mt' }, h('label', { text: 'Recovery code' }), code,
        h('div', { class: 'hint', text: 'Dashes, spaces and upper/lower case do not matter.' })),
      h('div', { class: 'insight mt' }, h('div', { class: 'ic', html: icon('alert', 15) }),
        h('div', { class: 'tt' }, h('b', { text: 'No recovery code either?' }),
          h('p', { text: 'Then nobody can open the cloud copy — that is what end-to-end encryption means. Your data is not necessarily lost though: if any device still has it, open Cash Checker there and it is all intact, or restore a backup file you exported earlier.' })))),
    footer: frag(h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onClick: async e => {
        const addr = email.value.trim();
        if (!addr || !code.value.trim()) { toast('Enter your email and recovery code', 'warn'); return; }
        e.currentTarget.disabled = true; e.currentTarget.textContent = 'Checking…';
        try {
          await S.startRecovery(addr, code.value);
          handedOff = true;
          m.close();
          redraw();
          setNewPassword(S, addr, draw, { fromRecovery: true });
        } catch (err) {
          toast(err.message, 'err');
          e.currentTarget.disabled = false; e.currentTarget.textContent = 'Continue';
        }
      } }, 'Continue')),
  });
}

/**
 * `fromRecovery` picks the completion path. A reset re-wraps the master key
 * that the recovery code just unlocked; a normal change mints a new master key
 * and re-uploads the vault, which only works when the data is already decrypted.
 */
function setNewPassword(S, email, draw, { fromRecovery = false } = {}) {
  const { modal: m } = formModal({
    title: 'Choose a new password', size: 'narrow', columns: 1, submitText: 'Save password',
    subtitle: fromRecovery
      ? 'A fresh recovery code is issued and other devices are signed out.'
      : 'Your data is re-encrypted and a fresh recovery code is issued.',
    onClose: () => { if (fromRecovery) S.cancelRecovery?.(); },
    fields: [
      { key: 'next', label: 'New password', type: 'password', required: true,
        validate: v => (String(v).length >= 8 ? '' : 'Use at least 8 characters') },
      { key: 'confirm', label: 'Confirm new password', type: 'password', required: true,
        validate: (v, mm) => (v === mm.next ? '' : 'The two entries do not match') },
    ],
    onSubmit: async v => {
      try {
        const code = fromRecovery
          ? await S.finishRecovery(v.next)
          : await S.changePassword(email, v.next);
        if (fromRecovery) await S.pull().catch(() => {});
        m.close();
        showRecoveryCode(code, draw);
      } catch (e) { toast(e.message, 'err'); }
    },
  });
}

/* ---------- recovery code helpers ---------- */
function showRecoveryCode(code, after) {
  let confirmed = false;
  const m = modal({
    title: 'Save your recovery code', size: '', closeOnBack: false,
    subtitle: 'This is shown once. It is the only way in if you forget your passphrase.',
    body: frag(
      h('div', { class: 'hero', style: { textAlign: 'center' } }, h('div', { class: 'rel' },
        h('div', { class: 'mono', style: { fontSize: '1.35rem', fontWeight: 700, letterSpacing: '.06em', wordBreak: 'break-all', lineHeight: 1.7 }, text: code }))),
      h('div', { class: 'row wrap mt', style: { gap: '8px', justifyContent: 'center' } },
        h('button', { class: 'btn sm', html: `${icon('copy', 15)} Copy`, onClick: async () => {
          await navigator.clipboard.writeText(code); toast('Copied', 'ok'); } }),
        h('button', { class: 'btn sm', html: `${icon('export', 15)} Download`, onClick: () => {
          download(`Cash Checker — recovery code\n\n${code}\n\nKeep this somewhere safe and private.\nIt unlocks your encrypted vault if you forget your passphrase.\nAnyone holding it can read your financial data.\n\nGenerated ${new Date().toLocaleString()}\n`,
            'cash-checker-recovery-code.txt', 'text/plain'); toast('Saved to your downloads', 'ok'); } }),
        h('button', { class: 'btn sm', html: `${icon('print', 15)} Print`, onClick: () => {
          const w = window.open('', '_blank');
          if (!w) { toast('Allow pop-ups to print', 'warn'); return; }
          w.document.write(`<!doctype html><meta charset="utf-8"><title>Recovery code</title>
            <div style="font:16px system-ui;padding:50px;max-width:600px">
            <h1 style="font-size:20px">Cash Checker — recovery code</h1>
            <p style="color:#555">Keep this private. It unlocks your encrypted financial data if you forget your passphrase.</p>
            <div style="font:700 26px ui-monospace,monospace;letter-spacing:.08em;padding:22px;background:#f4f4f8;border-radius:10px;margin:22px 0;word-break:break-all">${esc(code)}</div>
            <p style="color:#888;font-size:13px">Generated ${new Date().toLocaleString()}</p></div>`);
          w.document.close(); setTimeout(() => w.print(), 300); } })),
      h('div', { class: 'insight warn mt' }, h('div', { class: 'ic', html: icon('alert', 15) }),
        h('div', { class: 'tt' }, h('b', { text: 'It is never shown again' }),
          h('p', { text: 'Cash Checker does not keep a readable copy — that is what makes the encryption real. Store it like a spare key: safe, private, and not in the same place as your passphrase.' })))),
    footer: frag(h('div', { class: 'spacer' }),
      h('button', { class: 'btn primary', onClick: () => { confirmed = true; m.close(); after?.(); } }, 'I have saved it')),
    onClose: () => { if (!confirmed) after?.(); },
  });
}

/** Generate a fresh master key + recovery code, re-encrypting the vault. */
/**
 * Issue a fresh recovery code. Confirming the current password re-wraps the
 * master key, so the old code stops working the moment the new one is shown.
 */
function rotate(S, draw, title) {
  const pass = h('input', { class: 'inp', type: 'password', placeholder: '••••••••', autocomplete: 'current-password' });
  const m = modal({
    title, size: 'narrow',
    subtitle: 'Confirm your password. Your data is re-encrypted and a new recovery code is issued — the old one stops working.',
    body: h('div', { class: 'field' }, h('label', { text: 'Password' }), pass),
    footer: frag(h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onClick: async e => {
        if (!pass.value) { toast('Enter your password', 'warn'); return; }
        e.currentTarget.disabled = true; e.currentTarget.textContent = 'Working…';
        try {
          const code = await S.changePassword(S.currentEmail(), pass.value);
          m.close();
          showRecoveryCode(code, draw);
        } catch (err) { toast(err.message, 'err'); e.currentTarget.disabled = false; e.currentTarget.textContent = 'Continue'; }
      } }, 'Continue')),
  });
}

const section = (title, desc, ...kids) => h('div', { class: 'card pad', style: { marginBottom: '14px' } },
  h('h3', { text: title }), desc ? h('p', { class: 'tiny t3', style: { marginBottom: '13px' }, text: desc }) : h('div', { style: { height: '10px' } }),
  ...kids);

const toggleRow = (label, desc, checked, onChange) => {
  const inp = h('input', { type: 'checkbox', checked });
  inp.onchange = () => onChange(inp.checked);
  return h('div', { class: 'row between', style: { padding: '9px 0', borderBottom: '1px solid var(--border)' } },
    h('div', { style: { flex: 1, minWidth: 0, paddingRight: '12px' } },
      h('div', { style: { fontWeight: 600, fontSize: '.87rem' }, text: label }),
      desc ? h('div', { class: 'tiny t3', text: desc }) : null),
    h('label', { class: 'switch' }, inp, h('span', { class: 'track' })));
};

/* ═══════════ general ═══════════ */
function generalPanel(redraw) {
  const wrap = h('div', {});
  const f = form([
    { key: 'baseCurrency', label: 'Base currency', type: 'select',
      options: CURRENCIES.map(([c, s, flag, name]) => [c, `${flag} ${c} · ${s} — ${name}`]),
      hint: 'All totals and reports are shown in this currency' },
    { key: 'mode', label: 'Appearance', type: 'select', options: [['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark']] },
    { key: 'firstDayOfWeek', label: 'Week starts on', type: 'select',
      options: [[1, 'Monday'], [0, 'Sunday'], [6, 'Saturday']] },
    { key: 'fiscalStartMonth', label: 'Financial year starts', type: 'select',
      options: ['January,1;February,2;March,3;April,4;May,5;June,6;July,7;August,8;September,9;October,10;November,11;December,12'
        .split(';').map(s => s.split(',')).map(([l, v]) => [Number(v), l])] .flat() },
    { key: 'decimals', label: 'Decimal places', type: 'select', options: [[2, '2 (1,234.56)'], [0, '0 (1,235)']] },
  ], settings, { columns: 2 });

  wrap.append(section('Regional & display', 'These affect every screen, chart and export.',
    f.el,
    h('button', { class: 'btn primary mt', onClick: async () => {
      const v = f.read();
      await store.setSettings({ ...v, firstDayOfWeek: Number(v.firstDayOfWeek),
        fiscalStartMonth: Number(v.fiscalStartMonth), decimals: Number(v.decimals) });
      const { applyTheme } = await import('../app.js');
      applyTheme(v.mode);
      toast('Preferences saved', 'ok');
      redraw();
    } }, 'Save preferences')));

  wrap.append(section('Behaviour', null,
    toggleRow('Privacy mode', 'Blurs every amount until you hover over it — useful in public or on shared screens.',
      settings.privacyMode, async v => { await store.setSetting('privacyMode', v); applyPrivacy(v); toast(v ? 'Amounts hidden' : 'Amounts visible', 'ok'); }),
    toggleRow('On-device auto-categorisation', 'Suggests a category from your own history when you type a description.',
      settings.autoCategorize, async v => { await store.setSetting('autoCategorize', v); trainCategorizer(); }),
  ));

  wrap.append(section('Starter data', 'Useful when setting up or evaluating the app.',
    h('div', { class: 'row wrap', style: { gap: '8px' } },
      h('button', { class: 'btn', onClick: async () => {
        await seedStarterData({});
        toast('Default accounts and categories restored', 'ok'); redraw();
      } }, 'Restore default categories'),
      h('button', { class: 'btn', onClick: async () => {
        if (!await confirm({ title: 'Load demo workspace?',
          message: 'Adds 14 months of realistic sample transactions, contacts, investments, campaigns, budgets, goals, bills and loans alongside your existing data.',
          confirmText: 'Load demo data' })) return;
        toast('Generating demo workspace…', 'info');
        await seedDemoData();
        trainCategorizer();
        toast('Demo workspace ready', 'ok');
        redraw();
      } }, 'Load demo workspace'))));
  return wrap;
}

/* ═══════════ security ═══════════ */
function securityPanel(redraw) {
  const wrap = h('div', {});

  wrap.append(h('div', { class: 'insight mb' }, h('div', { class: 'ic', html: icon('shield', 15) }),
    h('div', { class: 'tt' }, h('b', { text: 'What these controls actually do' }),
      h('p', { text: 'Cash Checker is fully offline: there is no account, no server and no cloud copy of your data. The PIN and biometric lock guard access to this app in this browser; they do not encrypt the database, because the browser itself controls that storage. For portable protection, use an encrypted backup — those files are AES-256-GCM encrypted with a key derived from your passphrase and are unreadable without it.' }))));

  wrap.append(section('App lock', 'Requires a PIN before the vault opens, and re-locks after inactivity.',
    toggleRow('PIN lock', settings.pinEnabled ? 'Enabled' : 'No PIN set', settings.pinEnabled,
      async v => { if (v) setPin(redraw); else { await store.setSettings({ pinEnabled: false, pinHash: null, pinSalt: null }); toast('PIN lock disabled', 'warn'); redraw(); } }),
    settings.pinEnabled ? h('div', { class: 'row wrap mt', style: { gap: '8px' } },
      h('button', { class: 'btn sm', onClick: () => setPin(redraw) }, 'Change PIN'),
      h('button', { class: 'btn sm', onClick: async () => { const { lockNow } = await import('../app.js'); lockNow(); } }, 'Lock now')) : null,
    h('div', { class: 'field mt' }, h('label', { text: 'Auto-lock after inactivity' }),
      (() => {
        const s = h('select', { class: 'inp' }, ...[[0, 'Never'], [1, '1 minute'], [5, '5 minutes'], [10, '10 minutes'], [30, '30 minutes'], [60, '1 hour']]
          .map(([v, l]) => h('option', { value: v, selected: Number(settings.autoLockMinutes) === v }, l)));
        s.onchange = async () => { await store.setSetting('autoLockMinutes', Number(s.value)); toast('Auto-lock updated', 'ok'); };
        return s;
      })())));

  wrap.append(section('Biometric unlock', 'Uses your device fingerprint, face or Windows Hello through WebAuthn. The credential never leaves your device.',
    h('div', { class: 'row between' },
      h('div', {}, h('div', { style: { fontWeight: 600, fontSize: '.87rem' }, text: settings.biometricEnabled ? 'Registered on this device' : 'Not registered' }),
        h('div', { class: 'tiny t3', text: window.PublicKeyCredential ? 'This browser supports WebAuthn' : 'This browser does not support WebAuthn' })),
      settings.biometricEnabled
        ? h('button', { class: 'btn sm danger', onClick: async () => {
            await store.setSettings({ biometricEnabled: false, biometricCredId: null });
            toast('Biometric unlock removed', 'ok'); redraw(); } }, 'Remove')
        : h('button', { class: 'btn sm primary', disabled: !window.PublicKeyCredential,
            onClick: () => registerBiometric(redraw) }, 'Set up'))));

  wrap.append(section('Two-factor by email', 'A verification code is generated locally and shown for you to send or note. Because there is no server, Cash Checker cannot email it for you — it hands the code to your own mail client.',
    h('div', { class: 'row', style: { gap: '9px', alignItems: 'flex-end' } },
      (() => {
        const inp = h('input', { class: 'inp', type: 'email', value: settings.twoFactorEmail || '', placeholder: 'you@example.com' });
        const fieldEl = h('div', { class: 'field', style: { flex: 1 } }, h('label', { text: 'Recovery email' }), inp);
        fieldEl.dataset.k = '1';
        fieldEl._inp = inp;
        return fieldEl;
      })(),
      h('button', { class: 'btn', onClick: async e => {
        const inp = e.currentTarget.parentElement.querySelector('input');
        await store.setSetting('twoFactorEmail', inp.value);
        toast('Recovery email saved locally', 'ok');
      } }, 'Save')),
    h('button', { class: 'btn sm mt', onClick: () => sendOtp() }, 'Generate a verification code')));

  /* devices & sessions */
  const thisDevice = navigator.userAgent.slice(0, 90);
  wrap.append(section('This device & session', 'Sessions are local to this browser profile. Clearing browser data signs you out and removes the vault.',
    h('dl', { class: 'kv' },
      h('dt', { text: 'Browser' }), h('dd', { class: 'tiny', style: { textAlign: 'right', maxWidth: '360px' }, text: thisDevice }),
      h('dt', { text: 'Platform' }), h('dd', { text: navigator.platform || '—' }),
      h('dt', { text: 'Storage engine' }), h('dd', { text: db.isMemoryMode() ? 'In-memory (IndexedDB unavailable)' : 'IndexedDB' }),
      h('dt', { text: 'Language' }), h('dd', { text: navigator.language }),
      h('dt', { text: 'Online' }), h('dd', {}, tag(navigator.onLine ? 'Connected' : 'Offline', navigator.onLine ? 'pos' : 'warn')))));

  /* login history */
  const auth = sortBy(state.audit.filter(a => a.action.startsWith('auth')), a => a.at, -1).slice(0, 20);
  wrap.append(section('Login history', 'Every unlock attempt is recorded in the local audit log.',
    auth.length ? h('div', { class: 'card', style: { overflow: 'hidden' } }, ...auth.map(a =>
      h('div', { class: 'ledger-row' },
        h('div', {}, h('div', { style: { fontSize: '.84rem', fontWeight: 560 }, text: a.action === 'auth-ok' ? 'Successful unlock' : 'Failed PIN attempt' }),
          h('div', { class: 'tiny t3', text: new Date(a.at).toLocaleString() })),
        h('span', {}, tag(a.action === 'auth-ok' ? 'OK' : 'Failed', a.action === 'auth-ok' ? 'pos' : 'neg')),
        h('span', { class: 'tiny t3', text: relTime(a.at) }))))
      : h('p', { class: 'tiny t3', text: 'No unlock events recorded yet — enable the PIN lock to start tracking.' })));

  return wrap;
}

function setPin(redraw) {
  const { modal: m, form: f } = formModal({
    title: settings.pinEnabled ? 'Change PIN' : 'Set a PIN', size: 'narrow', columns: 1,
    submitText: 'Save PIN',
    fields: [
      ...(settings.pinEnabled ? [{ key: 'current', label: 'Current PIN', type: 'password', required: true }] : []),
      { key: 'pin', label: 'New PIN (4–6 digits)', type: 'password', required: true,
        validate: v => (/^\d{4,6}$/.test(v) ? '' : 'Use 4 to 6 digits') },
      { key: 'confirm', label: 'Confirm PIN', type: 'password', required: true,
        validate: (v, mm) => (v === mm.pin ? '' : 'The two entries do not match') },
    ],
    onSubmit: async v => {
      if (settings.pinEnabled) {
        const { hash } = await pbkdf2(v.current, settings.pinSalt, settings.pinIters || 250000);
        if (hash !== settings.pinHash) { toast('Current PIN is incorrect', 'err'); return; }
      }
      const { hash, salt, iterations } = await pbkdf2(v.pin);
      await store.setSettings({ pinEnabled: true, pinHash: hash, pinSalt: salt, pinIters: iterations,
        pinLength: String(v.pin).length });
      await store.audit('security', 'settings', '', 'PIN configured');
      m.close(); toast('PIN lock enabled', 'ok'); redraw();
    },
  });
}

async function registerBiometric(redraw) {
  try {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'Cash Checker' },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: settings.twoFactorEmail || 'local-user', displayName: 'Cash Checker user' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        timeout: 60000, attestation: 'none',
      },
    });
    if (!cred) throw new Error('Registration cancelled');
    await store.setSettings({ biometricEnabled: true, biometricCredId: b64(cred.rawId) });
    await store.audit('security', 'settings', '', 'Biometric credential registered');
    toast('Biometric unlock enabled', 'ok');
    redraw();
  } catch (e) {
    toast(e.message || 'Could not register a biometric credential', 'err');
  }
}

function sendOtp() {
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
  const email = settings.twoFactorEmail;
  const m = modal({
    title: 'Verification code', size: 'narrow',
    subtitle: 'Generated locally, valid for this session only.',
    body: frag(
      h('div', { class: 'hero', style: { textAlign: 'center' } }, h('div', { class: 'rel' },
        h('div', { class: 'mono', style: { fontSize: '2rem', fontWeight: 700, letterSpacing: '.28em' }, text: code }))),
      h('p', { class: 'tiny t3 mt', text: 'There is no server to deliver this for you. Copy it, or open your mail client with the message prefilled.' })),
    footer: frag(
      h('button', { class: 'btn sm', onClick: async () => { await navigator.clipboard.writeText(code); toast('Code copied', 'ok'); } }, 'Copy'),
      h('div', { class: 'spacer' }),
      email ? h('a', { class: 'btn sm', href: `mailto:${email}?subject=${encodeURIComponent('Cash Checker verification code')}&body=${encodeURIComponent(`Your verification code is ${code}`)}` }, 'Open mail client') : null,
      h('button', { class: 'btn sm primary', onClick: () => m.close() }, 'Done')),
  });
}

/* ═══════════ notifications ═══════════ */
function notifyPanel(redraw) {
  const wrap = h('div', {});
  wrap.append(section('Alerts', 'Checks run every five minutes while the app is open, and once on every launch.',
    toggleRow('Bill and due-date reminders', 'Warns before a bill is due and escalates when it is overdue.',
      settings.notifyBills, v => store.setSetting('notifyBills', v)),
    toggleRow('Budget warnings', 'Notifies at 80% of a limit and again when exceeded.',
      settings.notifyBudget, v => store.setSetting('notifyBudget', v)),
    toggleRow('Credit collection reminders', 'Flags receivables approaching or past their due date.',
      settings.notifyCredit, v => store.setSetting('notifyCredit', v)),
    toggleRow('Daily summary', 'A once-a-day digest of money in, money out and what is due.',
      settings.notifyDigest, v => store.setSetting('notifyDigest', v)),
    h('div', { class: 'field mt' }, h('label', { text: 'Remind me this many days before a bill is due' }),
      (() => {
        const s = h('select', { class: 'inp' }, ...[0, 1, 2, 3, 5, 7, 14].map(v =>
          h('option', { value: v, selected: Number(settings.billLeadDays) === v }, v === 0 ? 'On the day' : `${v} day${v > 1 ? 's' : ''} before`)));
        s.onchange = async () => { await store.setSetting('billLeadDays', Number(s.value)); toast('Reminder window updated', 'ok'); };
        return s;
      })())));

  wrap.append(section('System notifications', 'Optional desktop notifications from the browser, in addition to in-app alerts.',
    h('div', { class: 'row between' },
      h('div', {}, h('div', { style: { fontWeight: 600, fontSize: '.87rem' },
        text: `Browser permission: ${typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'}` }),
        h('div', { class: 'tiny t3', text: 'Only fires while the app is open in a tab.' })),
      h('button', { class: 'btn sm', disabled: typeof Notification === 'undefined', onClick: async () => {
        const p = await Notification.requestPermission();
        if (p === 'granted') { new Notification('Cash Checker', { body: 'Notifications are enabled.' }); toast('Enabled', 'ok'); }
        else toast('Permission denied by the browser', 'warn');
        redraw();
      } }, 'Request permission'))));

  wrap.append(section('Test the pipeline', null,
    h('button', { class: 'btn', onClick: async () => {
      await store.pushNotification({ type: 'system', level: 'info', title: 'Test notification',
        body: 'If you can see this in the bell menu, alerts are working.' });
      toast('Test notification created', 'ok');
    } }, 'Create a test alert')));
  return wrap;
}

/* ═══════════ data ═══════════ */
function dataPanel(redraw, api) {
  const wrap = h('div', {});
  const counts = Object.fromEntries(db.STORES.filter(s => s !== 'settings').map(s => [s, (state[s] || []).length]));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const usageEl = h('div', { class: 'tiny t3', text: 'Measuring storage…' });
  db.usage().then(u => {
    usageEl.textContent = u.quota
      ? `${humanSize(u.used)} used of roughly ${humanSize(u.quota)} available (${((u.used / u.quota) * 100).toFixed(2)}%)`
      : 'Storage estimate unavailable in this browser';
  });

  wrap.append(kpiGrid(
    stat({ label: 'Total records', value: total.toLocaleString(), icon: 'file', tone: 'info' }),
    stat({ label: 'Transactions', value: counts.transactions.toLocaleString(), icon: 'swap' }),
    stat({ label: 'Attachments', value: String(state.transactions.reduce((a, t) => a + (t.attachments?.length || 0), 0)), icon: 'paper' }),
    stat({ label: 'Audit entries', value: counts.audit.toLocaleString(), icon: 'shield' })));

  wrap.append(section('Backup', 'A backup is a single JSON file containing everything. Drag one onto the app window at any time to restore it.',
    usageEl,
    h('div', { class: 'row wrap mt', style: { gap: '8px' } },
      h('button', { class: 'btn primary', html: `${icon('export', 15)} Export backup`, onClick: () => exportBackup(false) }),
      h('button', { class: 'btn', html: `${icon('lock', 15)} Encrypted backup`, onClick: () => exportBackup(true) }),
      h('button', { class: 'btn', html: `${icon('import', 15)} Restore backup`, onClick: () => importBackup(redraw, api) }),
      h('button', { class: 'btn', html: `${icon('export', 15)} Export everything as CSV`, onClick: () => exportAllCSV() }))));

  wrap.append(googleDrivePanel(redraw, api));

  wrap.append(section('Record counts', null,
    h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))', gap: '9px' } },
      ...sortBy(Object.entries(counts), e => e[1], -1).filter(([, v]) => v > 0).map(([k, v]) =>
        h('div', { class: 'row between', style: { padding: '7px 11px', background: 'var(--surface-2)', borderRadius: '9px' } },
          h('span', { class: 'tiny t2', text: k }), h('span', { class: 'num tiny', style: { fontWeight: 700 }, text: v.toLocaleString() }))))));

  wrap.append(section('Danger zone', 'These actions cannot be undone. Export a backup first.',
    h('div', { class: 'row wrap', style: { gap: '8px' } },
      h('button', { class: 'btn danger', onClick: async () => {
        if (!await confirm({ title: 'Delete all transactions?', danger: true, confirmText: 'Delete transactions',
          message: `${state.transactions.length} transactions will be permanently removed. Accounts, categories and everything else are kept.` })) return;
        await store.removeMany('transactions', state.transactions.map(t => t.id));
        toast('All transactions deleted', 'ok'); redraw();
      } }, 'Delete all transactions'),
      h('button', { class: 'btn neg', onClick: async () => {
        if (!await confirm({ title: 'Factory reset', danger: true, confirmText: 'Erase everything',
          message: 'Every record, setting, PIN and attachment is erased and the app restarts as if freshly installed.' })) return;
        const second = await confirm({ title: 'Are you absolutely sure?', danger: true, confirmText: 'Yes, erase it all',
          message: 'There is no recovery. If you have not exported a backup, cancel now and do that first.' });
        if (!second) return;
        await store.factoryReset();
        location.reload();
      } }, 'Factory reset'))));
  return wrap;
}

/* ---------- Google Drive ----------
   A second copy in an account the user already owns. Deliberately independent
   of this app's own sync: if this project disappeared tomorrow, the files are
   still sitting in their Drive as plain JSON they can open themselves. */
function googleDrivePanel(redraw, api) {
  const body = h('div', {});
  const wrap = section('Google Drive backup',
    'Keeps a copy in your own Google Drive, in a folder you can open yourself. Cash Checker can only see the files it creates there — never the rest of your Drive.',
    body);

  let G = null;
  const draw = async () => {
    body.innerHTML = '';
    if (!G) {
      body.append(h('div', { class: 'tiny t3', text: 'Loading…' }));
      G = await import('../gdrive.js').catch(() => null);
      if (!G) { body.innerHTML = ''; body.append(h('div', { class: 'insight warn' },
        h('div', { class: 'ic', html: icon('alert', 15) }),
        h('div', { class: 'tt' }, h('b', { text: 'Drive backup could not load' }),
          h('p', { text: 'Reload the page and try again.' })))); return; }
      G.onDriveChange(() => draw());
      body.innerHTML = '';
    }

    const idInp = h('input', { class: 'inp', value: settings.gdriveClientId || '',
      placeholder: '000000000000-xxxxxxxx.apps.googleusercontent.com', spellcheck: 'false', autocomplete: 'off' });
    idInp.onchange = async () => {
      await store.setSetting('gdriveClientId', idInp.value.trim());
      toast(idInp.value.trim() ? 'Client ID saved' : 'Client ID cleared', 'ok');
      draw();
    };

    const s = G.drive;
    const connected = s.status === 'ready' || s.status === 'working';
    const busy = s.status === 'working' || s.status === 'connecting';

    body.append(h('div', { class: 'row wrap between', style: { gap: '10px', alignItems: 'center' } },
      h('div', {},
        h('b', { text: connected ? `Connected${s.email ? ` · ${s.email}` : ''}` : 'Not connected' }),
        h('div', { class: 'tiny t3', text: s.lastBackupAt ? `Last backup ${relTime(s.lastBackupAt)}` : 'No backup yet' })),
      h('div', { class: 'row wrap', style: { gap: '8px' } },
        connected
          ? h('button', { class: 'btn primary', disabled: busy,
              html: `${icon('export', 15)} ${busy ? 'Backing up…' : 'Back up now'}`,
              onClick: async e => {
                e.currentTarget.disabled = true;
                try {
                  const f = await G.backupNow();
                  toast(`Backed up ${f.records.toLocaleString()} records to Drive`, 'ok');
                } catch (err) { toast(err.message, 'err'); }
                draw();
              } })
          : h('button', { class: 'btn primary', disabled: busy, html: `${icon('cloud', 15)} Connect Google Drive`,
              onClick: async () => {
                try { await G.connect(); toast('Google Drive connected', 'ok'); }
                catch (err) { toast(err.message, 'err'); }
                draw();
              } }),
        connected ? h('button', { class: 'btn', html: `${icon('import', 15)} Restore from Drive`,
          onClick: () => driveRestoreDialog(G, redraw, api) }) : null,
        connected ? h('button', { class: 'btn', text: 'Disconnect',
          onClick: () => { G.disconnect(); toast('Disconnected from Google Drive', 'ok'); draw(); } }) : null)));

    if (s.lastError) {
      body.append(h('div', { class: 'insight warn mt' }, h('div', { class: 'ic', html: icon('alert', 15) }),
        h('div', { class: 'tt' }, h('b', { text: 'Google Drive reported a problem' }), h('p', { text: s.lastError }))));
    }

    if (connected) {
      const auto = h('input', { type: 'checkbox', checked: !!settings.gdriveAuto });
      auto.onchange = async () => {
        await store.setSetting('gdriveAuto', auto.checked);
        toast(auto.checked ? 'Automatic Drive backup on' : 'Automatic Drive backup off', 'ok');
      };
      body.append(h('label', { class: 'switch mt' }, auto, h('span', { class: 'track' }),
        h('span', { text: 'Back up automatically (at most once an hour, only when something changed)' })));
    }

    // Almost nobody needs this — the app ships with a client ID. It stays for
    // anyone who would rather the Google consent screen carry their own name.
    body.append(h('details', { class: 'mt' },
      h('summary', { class: 'tiny t3', style: { cursor: 'pointer' },
        text: G.usingOwnClientId() ? 'Using your own Google project' : 'Use your own Google project (optional)' }),
      h('div', { class: 'insight mt' }, h('div', { class: 'ic', html: icon('alert', 15) }),
        h('div', { class: 'tt' }, h('b', { text: 'Only if you want your own Google Cloud project' }),
          h('p', { text: 'Leave this blank to use the one built into Cash Checker. Your backups go to your own Drive either way — the client ID only names the app on the Google consent screen.' }))),
      h('ol', { class: 'gd-steps' },
        h('li', { html: 'Open <b>console.cloud.google.com/apis/credentials</b> and create a project.' }),
        h('li', { html: 'Configure the OAuth consent screen — <b>External</b>, then publish it.' }),
        h('li', { html: 'Create credentials → <b>OAuth client ID</b> → <b>Web application</b>.' }),
        h('li', { html: `Under <b>Authorised JavaScript origins</b> add <code>${esc(location.origin)}</code>` }),
        h('li', { html: 'Enable the <b>Google Drive API</b> for the project.' }),
        h('li', { text: 'Copy the client ID and paste it below.' })),
      h('div', { class: 'field mt' }, h('label', { text: 'OAuth client ID' }), idInp)));
  };
  draw();
  return wrap;
}

function driveRestoreDialog(G, redraw, api) {
  const list = h('div', {});
  const m = modal({
    title: 'Restore from Google Drive', size: '',
    subtitle: 'Pick a backup. Nothing changes until you confirm.',
    body: list,
    footer: frag(h('div', { class: 'spacer' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Close')),
  });
  list.append(h('div', { class: 'tiny t3', text: 'Loading backups…' }));
  G.listBackups().then(files => {
    list.innerHTML = '';
    if (!files.length) { list.append(empty('No backups in Drive yet', 'Use "Back up now" first.', 'cloud')); return; }
    files.forEach(f => list.append(h('div', { class: 'row between gd-row' },
      h('div', { style: { minWidth: 0 } },
        h('div', { class: 'ell', style: { fontWeight: 640, fontSize: '.84rem' }, text: f.name }),
        h('div', { class: 'tiny t3', text: `${new Date(f.modifiedTime).toLocaleString()}${f.size ? ` · ${humanSize(Number(f.size))}` : ''}${f.description ? ` · ${f.description.replace('Cash Checker backup · ', '')}` : ''}` })),
      h('div', { class: 'row', style: { gap: '6px' } },
        h('button', { class: 'btn xs', text: 'Restore', onClick: async e => {
          const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Loading…';
          try {
            const json = await G.downloadBackup(f.id);
            const n = Object.values(json.counts || {}).reduce((a, b) => a + b, 0);
            const ok = await confirm({
              title: 'Replace everything with this backup?', danger: true, confirmText: 'Replace',
              message: `${f.name} holds ${n.toLocaleString()} records. Your current data on this device is replaced by it. Export a backup first if you are not sure.`,
            });
            if (ok) {
              await store.importBackup(json, 'replace');
              m.close(); toast(`Restored ${n.toLocaleString()} records from Drive`, 'ok');
              redraw(); api?.navigate?.('dashboard');
            }
          } catch (err) { toast(err.message, 'err'); }
          btn.disabled = false; btn.textContent = 'Restore';
        } }),
        h('button', { class: 'btn xs danger', text: 'Delete', onClick: async e => {
          if (!(await confirm({ title: `Delete ${f.name}?`, danger: true, confirmText: 'Delete',
            message: 'This removes the file from your Google Drive.' }))) return;
          try { await G.deleteBackup(f.id); e.currentTarget.closest('.gd-row').remove(); toast('Backup deleted', 'ok'); }
          catch (err) { toast(err.message, 'err'); }
        } })))));
  }).catch(err => { list.innerHTML = ''; list.append(empty('Could not list backups', err.message, 'alert')); });
}

async function exportBackup(encrypted) {
  const backup = await store.exportBackup({ includeVolatile: true });
  if (!encrypted) {
    download(JSON.stringify(backup, null, 1), `cashchecker-backup-${today()}.json`, 'application/json');
    toast(`Backup exported · ${Object.values(backup.counts).reduce((a, b) => a + b, 0)} records`, 'ok');
    await store.audit('export', 'system', '', 'Plain backup exported');
    return;
  }
  const { modal: m, form: f } = formModal({
    title: 'Encrypted backup', size: 'narrow', columns: 1, submitText: 'Encrypt & download',
    fields: [
      { key: 'pass', label: 'Passphrase', type: 'password', required: true,
        hint: 'AES-256-GCM with PBKDF2 (250,000 iterations). There is no recovery if you forget it.',
        validate: v => (String(v).length >= 8 ? '' : 'Use at least 8 characters') },
      { key: 'confirm', label: 'Confirm passphrase', type: 'password', required: true,
        validate: (v, mm) => (v === mm.pass ? '' : 'The two entries do not match') },
    ],
    onSubmit: async v => {
      const { salt } = await pbkdf2(v.pass);
      const key = await deriveKey(v.pass, salt);
      const payload = await aesEncrypt(JSON.stringify(backup), key);
      const file = { format: 'cashchecker-encrypted', version: 1, algo: 'AES-256-GCM', kdf: 'PBKDF2-SHA256-250000',
        salt, iv: payload.iv, data: payload.data, exportedAt: new Date().toISOString() };
      download(JSON.stringify(file), `cashchecker-encrypted-${today()}.json`, 'application/json');
      await store.audit('export', 'system', '', 'Encrypted backup exported');
      m.close(); toast('Encrypted backup downloaded', 'ok');
    },
  });
}

function importBackup(redraw, api) {
  const fileInp = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  const dz = h('div', { class: 'dropzone', style: { padding: '28px' } });
  dz.innerHTML = `<div style="display:grid;gap:6px;place-items:center">${icon('import', 24)}<b>Click or drop a backup file</b>
    <span class="tiny">Plain or encrypted Cash Checker backups</span></div>`;
  const info = h('div', { class: 'mt' });
  let parsed = null;

  const m = modal({
    title: 'Restore a backup', size: '', body: frag(dz, fileInp, info),
    footer: frag(h('div', { class: 'spacer' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel')),
  });

  const load = async file => {
    try {
      let json = JSON.parse(await file.text());
      if (json.format === 'cashchecker-encrypted') {
        const pass = await new Promise(res => {
          const inp = h('input', { class: 'inp', type: 'password', placeholder: 'Passphrase' });
          const pm = modal({ title: 'This backup is encrypted', size: 'narrow',
            body: h('div', { class: 'field' }, h('label', { text: 'Enter the passphrase' }), inp),
            footer: frag(h('div', { class: 'spacer' }),
              h('button', { class: 'btn', onClick: () => { pm.close(); res(null); } }, 'Cancel'),
              h('button', { class: 'btn primary', onClick: () => { pm.close(); res(inp.value); } }, 'Decrypt')) });
          inp.addEventListener('keydown', e => { if (e.key === 'Enter') { pm.close(); res(inp.value); } });
        });
        if (!pass) return;
        const key = await deriveKey(pass, json.salt);
        json = JSON.parse(await aesDecrypt({ iv: json.iv, data: json.data }, key));
      }
      if (json.format !== 'cashchecker-backup') throw new Error('This is not a Cash Checker backup file');
      parsed = json;
      info.innerHTML = '';
      info.append(
        h('div', { class: 'insight pos' }, h('div', { class: 'ic', html: icon('check', 15) }),
          h('div', { class: 'tt' }, h('b', { text: 'Backup verified' }),
            h('p', { text: `Exported ${json.exportedAt ? new Date(json.exportedAt).toLocaleString() : 'unknown'} · ${Object.values(json.counts || {}).reduce((a, b) => a + b, 0)} records` }))),
        h('div', { class: 'grid mt', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: '7px' } },
          ...Object.entries(json.counts || {}).filter(([, v]) => v).map(([k, v]) =>
            h('div', { class: 'row between', style: { padding: '6px 10px', background: 'var(--surface-2)', borderRadius: '8px' } },
              h('span', { class: 'tiny t2', text: k }), h('span', { class: 'num tiny', text: String(v) })))));
      m.setFooter(frag(h('div', { class: 'spacer' }),
        h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'),
        h('button', { class: 'btn', onClick: () => doRestore('merge') }, 'Merge with current data'),
        h('button', { class: 'btn neg', onClick: () => doRestore('replace') }, 'Replace everything')));
    } catch (e) {
      info.innerHTML = '';
      info.append(h('div', { class: 'insight neg' }, h('div', { class: 'ic', html: icon('alert', 15) }),
        h('div', { class: 'tt' }, h('b', { text: 'Could not read that file' }), h('p', { text: e.message }))));
    }
  };
  const doRestore = async mode => {
    if (!parsed) return;
    if (mode === 'replace' && !await confirm({ title: 'Replace all current data?', danger: true,
      confirmText: 'Replace everything', message: 'Everything currently in the app is erased and replaced by the backup.' })) return;
    const res = await store.importBackup(parsed, mode);
    trainCategorizer();
    m.close();
    toast(`Restored ${Object.values(res).reduce((a, b) => a + b, 0)} records`, 'ok');
    redraw();
    api.navigate('dashboard');
  };

  dz.onclick = () => fileInp.click();
  fileInp.onchange = () => fileInp.files[0] && load(fileInp.files[0]);
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove('over'); if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); };
}

async function exportAllCSV() {
  const { toCSV } = await import('../util.js');
  const parts = [];
  for (const s of db.STORES) {
    if (s === 'settings' || !state[s]?.length) continue;
    const flat = state[s].map(r => Object.fromEntries(Object.entries(r).map(([k, v]) =>
      [k, v && typeof v === 'object' ? JSON.stringify(v) : v])));
    parts.push(`### ${s} (${flat.length} records)\r\n${toCSV(flat)}`);
  }
  download(parts.join('\r\n\r\n'), `cashchecker-full-export-${today()}.csv`, 'text/csv');
  toast('Full CSV export downloaded', 'ok');
}

/* ═══════════ about ═══════════ */
function aboutPanel() {
  const wrap = h('div', {});
  wrap.append(h('div', { class: 'hero mb' }, h('div', { class: 'rel' },
    h('div', { class: 'row', style: { gap: '13px', alignItems: 'center' } },
      h('span', { html: `<svg viewBox="0 0 48 48" width="42" height="42"><use href="#i-logo"/></svg>`, style: { display: 'grid' } }),
      h('div', {}, h('h2', { text: 'Cash Checker' }),
        h('div', { class: 'tiny t2', text: `Version ${settings.version} · local-first financial operating system` }))))));

  wrap.append(section('How your data is handled', null,
    h('div', { class: 'col' },
      ...[['No account, no server', 'There is no sign-up and no backend. Nothing you enter is transmitted anywhere.'],
          ['Stored in IndexedDB', 'Data lives in your browser profile on this device, including attachments.'],
          ['You own the export', 'Backups are plain JSON, or AES-256-GCM encrypted with your passphrase.'],
          ['Analysis runs locally', 'Categorisation, forecasting and anomaly detection are classical statistics computed on-device — no model is called over the network.'],
          ['Clearing browser data erases it', 'Because it is browser storage, wiping site data removes the vault. Keep backups.']]
        .map(([t, d]) => h('div', { class: 'insight' }, h('div', { class: 'ic', html: icon('shield', 15) },),
          h('div', { class: 'tt' }, h('b', { text: t }), h('p', { text: d })))))));

  wrap.append(section('Keyboard shortcuts', null,
    h('dl', { class: 'kv' },
      ...[['Ctrl / ⌘ + K', 'Global search and natural-language queries'], ['/', 'Global search'],
          ['N', 'New transaction'], ['1 – 9', 'Jump to a navigation item'],
          ['Ctrl + Shift + L', 'Lock the vault'], ['Ctrl / ⌘ + Enter', 'Save the open form'],
          ['Esc', 'Close the top dialog'], ['?', 'Shortcut help']]
        .flatMap(([k, v]) => [h('dt', { text: v }), h('dd', {}, h('kbd', { text: k }))]))));

  wrap.append(section('Install as an app', 'Cash Checker is a PWA. Use your browser menu → “Install app” (or “Add to Home Screen”) to run it in its own window, offline.',
    h('div', { class: 'row wrap', style: { gap: '8px' } },
      h('button', { class: 'btn', onClick: async () => {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.unregister()));
          if ('caches' in window) { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); }
          toast('Caches cleared — reloading', 'ok');
          setTimeout(() => location.reload(true), 700);
        }
      } }, 'Clear cache & update'),
      h('button', { class: 'btn', onClick: async () => {
        const ok = await db.persist();
        toast(ok ? 'Storage marked persistent — the browser will not evict your data' : 'The browser declined persistent storage', ok ? 'ok' : 'warn');
      } }, 'Request persistent storage'))));
  return wrap;
}
