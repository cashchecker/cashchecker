/* ═══════════ ui.js — component kit ═══════════
   Toasts, modals, sheets, menus, confirm, form builder, data table.
   No framework: everything returns real DOM nodes.
   ═════════════════════════════════════════════ */

import {
  $, $$, esc, uid, fmtMoney, fmtNum, fmtDate, today, nowTime, download, toCSV,
  humanSize, fileToDataURL, sortBy, debounce, initials, colorFor, CURRENCIES, curSymbol, baseCurrency,
  amountInWords,
} from './util.js';

/* ---------- element factory ---------- */
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(3)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
export const frag = (...kids) => { const f = document.createDocumentFragment(); f.append(...kids.flat(3).filter(Boolean)); return f; };
export const icon = (name, size = 18) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

/* ---------- toast ---------- */
const TOAST_ICONS = { ok: 'check', err: 'alert', warn: 'alert', info: 'sparkle' };
export function toast(msg, kind = 'ok', { timeout = 3400, action, onAction } = {}) {
  const root = $('#toast-root');
  const el = h('div', { class: `toast ${kind}` },
    h('div', { class: 'ic', html: icon(TOAST_ICONS[kind] || 'check', 15) }),
    h('div', { class: 'msg', text: msg }),
    action ? h('button', { class: 'act', onClick: () => { onAction?.(); close(); } }, action) : null);
  root.append(el);
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 250); };
  const t = setTimeout(close, timeout);
  el.addEventListener('click', e => { if (e.target.closest('.act')) return; clearTimeout(t); close(); });
  return close;
}

/* ---------- modal ---------- */
let modalStack = [];
export function modal({ title, subtitle, body, footer, size = '', onClose, closeOnBack = true }) {
  const back = h('div', { class: 'modal-back' });
  const dlg = h('div', { class: `modal ${size}`, role: 'dialog', 'aria-modal': 'true' });
  const head = h('div', { class: 'modal-h' },
    h('div', { class: 'tt' }, h('h2', { text: title || '' }), subtitle ? h('p', { text: subtitle }) : null),
    h('button', { class: 'icon-btn', 'aria-label': 'Close', html: icon('x', 19), onClick: () => close() }));
  const bodyEl = h('div', { class: 'modal-b' });
  if (body) bodyEl.append(body);
  dlg.append(head, bodyEl);
  if (footer) dlg.append(h('div', { class: 'modal-f' }, footer));
  back.append(dlg);
  back.addEventListener('mousedown', e => { if (e.target === back && closeOnBack) close(); });
  $('#modal-root').append(back);

  const onKey = e => { if (e.key === 'Escape' && modalStack.at(-1) === api) { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);

  function close(result) {
    document.removeEventListener('keydown', onKey, true);
    modalStack = modalStack.filter(m => m !== api);
    back.style.animation = 'fade .16s reverse';
    dlg.style.animation = 'rise .16s reverse';
    setTimeout(() => back.remove(), 150);
    onClose?.(result);
  }
  const api = { el: back, dialog: dlg, body: bodyEl, close,
    setFooter(f) { dlg.querySelector('.modal-f')?.remove(); dlg.append(h('div', { class: 'modal-f' }, f)); } };
  modalStack.push(api);
  setTimeout(() => (dlg.querySelector('input,select,textarea,button.primary') || dlg).focus?.(), 60);
  return api;
}

export function confirm({ title = 'Are you sure?', message = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = false, detail }) {
  return new Promise(res => {
    let done = false;
    const m = modal({
      title, size: 'narrow',
      body: frag(
        message ? h('p', { class: 't2', style: { fontSize: '.87rem', lineHeight: 1.55 }, text: message }) : null,
        detail ? h('div', { class: 'card pad mt', style: { background: 'var(--surface-2)' } }, detail) : null),
      footer: frag(
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn', onClick: () => { done = true; m.close(); res(false); } }, cancelText),
        h('button', { class: `btn ${danger ? 'neg' : 'primary'}`, onClick: () => { done = true; m.close(); res(true); } }, confirmText)),
      onClose: () => { if (!done) res(false); },
    });
  });
}
export function prompt({ title, label = 'Value', value = '', placeholder = '', type = 'text', confirmText = 'Save' }) {
  return new Promise(res => {
    let done = false;
    const inp = h('input', { class: 'inp', type, value, placeholder });
    const m = modal({
      title, size: 'narrow',
      body: h('div', { class: 'field' }, h('label', { text: label }), inp),
      footer: frag(h('div', { class: 'spacer' }),
        h('button', { class: 'btn', onClick: () => { done = true; m.close(); res(null); } }, 'Cancel'),
        h('button', { class: 'btn primary', onClick: () => { done = true; m.close(); res(inp.value); } }, confirmText)),
      onClose: () => { if (!done) res(null); },
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { done = true; m.close(); res(inp.value); } });
  });
}

/* ---------- side sheet ---------- */
export function sheet({ title, body, footer, onClose }) {
  const back = h('div', { class: 'sheet-back', onClick: () => close() });
  const el = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' });
  el.append(
    h('div', { class: 'sheet-h' }, h('h2', { class: 'ell', text: title || '' }), h('div', { class: 'spacer' }),
      h('button', { class: 'icon-btn', html: icon('x', 19), onClick: () => close() })),
    h('div', { class: 'sheet-b' }, body || ''));
  if (footer) el.append(h('div', { class: 'modal-f' }, footer));
  $('#sheet-root').append(back, el);
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  function close() {
    document.removeEventListener('keydown', onKey);
    el.style.animation = 'slidein .2s reverse'; back.style.animation = 'fade .2s reverse';
    setTimeout(() => { el.remove(); back.remove(); }, 190);
    onClose?.();
  }
  return { el, close, body: el.querySelector('.sheet-b') };
}

/* ---------- context menu ---------- */
export function menu(anchorEl, items) {
  $$('.menu').forEach(m => m.remove());
  const el = h('div', { class: 'menu' });
  for (const it of items) {
    if (it === '-') { el.append(h('hr')); continue; }
    if (!it) continue;
    el.append(h('button', { class: it.danger ? 'danger' : '', onClick: e => { e.stopPropagation(); el.remove(); it.onClick?.(); } },
      it.icon ? h('span', { html: icon(it.icon, 16), style: { display: 'grid' } }) : null, it.label));
  }
  document.body.append(el);
  const r = anchorEl.getBoundingClientRect();
  const w = el.offsetWidth, hgt = el.offsetHeight;
  el.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
  el.style.top = `${r.bottom + hgt + 8 > window.innerHeight ? Math.max(8, r.top - hgt - 4) : r.bottom + 4}px`;
  const off = e => { if (!el.contains(e.target)) { el.remove(); document.removeEventListener('mousedown', off); } };
  setTimeout(() => document.addEventListener('mousedown', off), 0);
  return el;
}

/* ---------- tooltip ---------- */
let tipEl;
export function showTip(html, x, y) {
  tipEl ??= document.body.appendChild(h('div', { class: 'tip' }));
  tipEl.innerHTML = html;
  tipEl.style.display = 'block';
  const w = tipEl.offsetWidth, hh = tipEl.offsetHeight;
  tipEl.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, x + 12))}px`;
  tipEl.style.top = `${Math.max(8, y - hh - 10)}px`;
}
export const hideTip = () => { if (tipEl) tipEl.style.display = 'none'; };

/* ---------- misc builders ---------- */
export const empty = (title, msg, iconName = 'file', action) =>
  h('div', { class: 'empty' },
    h('div', { class: 'ico', html: icon(iconName, 24) }),
    h('h3', { text: title }),
    msg ? h('p', { text: msg }) : null,
    action || null);

export function stat({ label, value, icon: ic = 'wallet', tone = '', foot, spark, onClick }) {
  return h('div', { class: `stat ${tone ? 'tone-' + tone : ''}`, style: onClick ? { cursor: 'pointer' } : null, onClick },
    h('div', { class: 'ico', html: icon(ic, 18) }),
    h('div', { class: 'lbl', text: label }),
    h('div', { class: 'val num', text: value }),
    foot ? h('div', { class: 'foot' }, foot) : null,
    spark ? h('div', { class: 'spark', html: spark }) : null);
}
export const delta = (pct, { invert = false, suffix = 'vs last period' } = {}) => {
  const v = Number(pct) || 0;
  const good = invert ? v < 0 : v > 0;
  const cls = Math.abs(v) < 0.05 ? 'flat' : good ? 'up' : 'down';
  const arrow = Math.abs(v) < 0.05 ? '→' : v > 0 ? '↑' : '↓';
  return h('span', { class: `delta ${cls}` }, `${arrow} ${Math.abs(v).toFixed(1)}%`,
    suffix ? h('span', { class: 't3', style: { fontWeight: 400 }, text: ` ${suffix}` }) : null);
};
export const bar = (pct, tone = '') =>
  h('div', { class: 'bar' }, h('i', { class: tone, style: { width: `${Math.max(0, Math.min(100, pct))}%` } }));
export const tag = (text, cls = '') => h('span', { class: `tag ${cls}`, text });
export const avatar = (name, color) =>
  h('div', { class: 'avatar', style: { background: (color || colorFor(name)) + '22', color: color || colorFor(name) }, text: initials(name) });

export function segmented(options, value, onChange) {
  const el = h('div', { class: 'seg' });
  options.forEach(([v, label]) => el.append(h('button', {
    class: v === value ? 'on' : '', text: label,
    onClick: () => { [...el.children].forEach(c => c.classList.remove('on')); el.children[options.findIndex(o => o[0] === v)].classList.add('on'); onChange(v); },
  })));
  return el;
}
export function tabs(items, active, onChange) {
  const el = h('div', { class: 'tabs' });
  items.forEach(([v, label]) => el.append(h('button', {
    class: v === active ? 'on' : '', text: label,
    onClick: () => { [...el.children].forEach(c => c.classList.remove('on')); el.querySelector(`button:nth-child(${items.findIndex(i => i[0] === v) + 1})`).classList.add('on'); onChange(v); },
  })));
  return el;
}
export const card = (title, bodyNode, actions, { flush = false, sub } = {}) => {
  const c = h('div', { class: 'card' });
  if (title) c.append(h('div', { class: 'card-h' },
    h('div', { style: { flex: 1, minWidth: 0 } }, h('h3', { text: title }), sub ? h('div', { class: 'sub', text: sub }) : null),
    actions || null));
  c.append(h('div', { class: `card-b ${flush ? 'flush' : ''}` }, bodyNode));
  return c;
};

/* ═══════════ FORM BUILDER ═══════════ */
/**
 * fields: [{key,label,type,required,options,hint,placeholder,col,when,min,max,step,rows,transform}]
 * types: text number money percent date time select multi tags textarea switch color
 *        currency account category contact attach hidden static
 */
export function form(fields, values = {}, { columns = 2, onInput } = {}) {
  const model = { ...values };
  const wrap = h('div', { class: 'grid', style: { gridTemplateColumns: `repeat(${columns},minmax(0,1fr))`, gap: '13px' } });
  const controls = new Map();

  const rerenderConditional = () => {
    for (const [key, c] of controls) {
      const f = fields.find(x => x.key === key);
      if (f?.when) c.wrap.hidden = !f.when(model);
    }
  };

  for (const f of fields) {
    if (f.type === 'hidden') { model[f.key] ??= f.value; continue; }
    const span = f.col === 'full' ? columns : (f.col || 1);
    const fw = h('div', { class: 'field', style: { gridColumn: `span ${Math.min(span, columns)}` } });
    if (f.label && f.type !== 'switch') {
      fw.append(h('label', { html: esc(f.label) + (f.required ? ' <span class="req">*</span>' : '') }));
    }
    const set = v => { model[f.key] = v; onInput?.(model, f.key); rerenderConditional(); };
    let ctl;
    let rebuild = null;   // set by controls whose options can change while open

    switch (f.type) {
      case 'static':
        ctl = h('div', { class: 'inp', style: { display: 'flex', alignItems: 'center', background: 'var(--surface-3)' } },
          h('span', { text: f.value ?? model[f.key] ?? '—' }));
        break;

      case 'textarea':
        ctl = h('textarea', { class: 'inp', rows: f.rows || 3, placeholder: f.placeholder || '', value: model[f.key] ?? '' });
        ctl.addEventListener('input', () => set(ctl.value));
        break;

      case 'switch': {
        const inp = h('input', { type: 'checkbox', checked: !!model[f.key] });
        inp.addEventListener('change', () => set(inp.checked));
        ctl = h('label', { class: 'switch' }, inp, h('span', { class: 'track' }), h('span', { text: f.label }));
        break;
      }

      case 'select': {
        ctl = h('select', { class: 'inp' });
        const opts = typeof f.options === 'function' ? f.options(model) : (f.options || []);
        if (f.placeholder) ctl.append(h('option', { value: '' }, f.placeholder));
        for (const o of opts) {
          const [v, l] = Array.isArray(o) ? o : [o, o];
          ctl.append(h('option', { value: v, selected: String(model[f.key] ?? '') === String(v) }, l));
        }
        // `model` wins, then the field's declared default, and only then the
        // first option. Skipping `f.value` here silently ignored every declared
        // default — including the CSV importer's guessed column mapping.
        ctl.value = model[f.key] ?? f.value ?? (f.placeholder ? '' : (opts[0] ? (Array.isArray(opts[0]) ? opts[0][0] : opts[0]) : ''));
        model[f.key] ??= ctl.value;
        ctl.addEventListener('change', () => set(ctl.value));
        break;
      }

      case 'chips': {
        ctl = h('div', { class: 'row wrap', style: { gap: '6px' } });
        const opts = typeof f.options === 'function' ? f.options(model) : f.options;
        opts.forEach(o => {
          const [v, l] = Array.isArray(o) ? o : [o, o];
          const b = h('button', { type: 'button', class: `chip ${model[f.key] === v ? 'on' : ''}`, text: l,
            onClick: () => {
              // tapping the selected chip again clears it, so "none" stays reachable
              const next = model[f.key] === v && f.clearable !== false ? '' : v;
              set(next);
              [...ctl.children].forEach(c => c.classList.remove('on'));
              if (next) b.classList.add('on');
            } });
          ctl.append(b);
        });
        break;
      }

      /* Big tappable grid of emoji categories — far quicker than a dropdown,
         especially on a phone, and it shows every option at a glance. */
      case 'catgrid': {
        ctl = h('div', { class: 'cat-grid' });
        const paint = () => [...ctl.querySelectorAll('.cat-btn')].forEach(c =>
          c.classList.toggle('sel', !!c.dataset.value && c.dataset.value === String(model[f.key] ?? '')));
        // Rebuilt rather than patched, so a category added from inside the form
        // shows up immediately without reopening the whole modal.
        const build = () => {
          ctl.innerHTML = '';
          const opts = typeof f.options === 'function' ? f.options(model) : (f.options || []);
          opts.forEach(o => {
            const { value, label, emoji, color } = o;
            const b = h('button', { type: 'button', class: 'cat-btn', dataset: { value },
              onClick: () => { set(value); paint(); f.onPick?.(value); } },
              h('span', { class: 'em', text: emoji || '📁' }),
              h('span', { text: label }));
            if (color) b.style.setProperty('--accent-cat', color);
            ctl.append(b);
          });
          if (f.onAdd) ctl.append(h('button', { type: 'button', class: 'cat-btn ghost', title: 'Create a new category',
            onClick: () => f.onAdd(build) }, h('span', { class: 'em', text: '➕' }), h('span', { text: 'New' })));
          if (f.onManage) ctl.append(h('button', { type: 'button', class: 'cat-btn ghost', title: 'Rename or delete categories',
            onClick: () => f.onManage(build) }, h('span', { class: 'em', text: '⚙️' }), h('span', { text: 'Manage' })));
          paint();
        };
        build();
        rebuild = build;
        break;
      }

      case 'tags': {
        const box = h('div', { class: 'row wrap', style: { gap: '5px', padding: '5px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)', minHeight: '38px' } });
        const inp = h('input', { class: 'inp', style: { border: 0, background: 'none', height: '26px', flex: '1', minWidth: '90px', padding: '0 4px' }, placeholder: f.placeholder || 'Add tag + Enter' });
        model[f.key] = Array.isArray(model[f.key]) ? [...model[f.key]] : [];
        const draw = () => {
          box.querySelectorAll('.tag').forEach(t => t.remove());
          model[f.key].forEach((t, i) => box.insertBefore(
            h('span', { class: 'tag acc' }, t, h('button', { type: 'button', style: { marginLeft: '2px', opacity: .7 }, text: '×', onClick: () => { model[f.key].splice(i, 1); draw(); } })), inp));
        };
        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); const v = inp.value.trim(); if (v && !model[f.key].includes(v)) { model[f.key].push(v); inp.value = ''; draw(); } }
          else if (e.key === 'Backspace' && !inp.value) { model[f.key].pop(); draw(); }
        });
        box.append(inp); draw(); ctl = box;
        if (f.suggestions?.length) {
          const sug = h('div', { class: 'row wrap', style: { gap: '4px', marginTop: '5px' } },
            ...f.suggestions.slice(0, 8).map(s => h('button', { type: 'button', class: 'chip', style: { height: '22px', fontSize: '.68rem' }, text: s,
              onClick: () => { if (!model[f.key].includes(s)) { model[f.key].push(s); draw(); } } })));
          ctl = h('div', {}, box, sug);
        }
        break;
      }

      case 'money': {
        const cur = f.currencyOf ? f.currencyOf(model) : undefined;
        const inp = h('input', { class: `inp num ${f.big ? 'big-amount' : ''}`, type: 'text', inputmode: 'decimal',
          placeholder: f.placeholder || '0.00', value: model[f.key] ?? '' });

        // Spelling the figure out while it is being typed is how a mistyped
        // zero gets caught. It goes away on blur so it never competes with the
        // field's own hint once the number is settled.
        const words = h('div', { class: 'amt-words', hidden: true, 'aria-live': 'polite' });
        const paintWords = () => {
          const t = amountInWords(model[f.key], cur || baseCurrency());
          words.textContent = t;
          words.hidden = !t || document.activeElement !== inp;
        };
        inp.addEventListener('input', () => {
          inp.value = inp.value.replace(/[^\d.,\-]/g, '');
          set(inp.value === '' ? '' : Number(String(inp.value).replace(/,/g, '')) || 0);
          paintWords();
        });
        const hideWords = () => { words.hidden = true; };
        inp.addEventListener('focus', paintWords);
        // `focusout` bubbles and fires in cases where a bare `blur` does not,
        // so the readout cannot get stranded on screen after you move on.
        inp.addEventListener('blur', hideWords);
        inp.addEventListener('focusout', hideWords);

        // Fall back to the workspace currency, never to USD: a form that does
        // not declare `currencyOf` still deals in the user's own money.
        const box = f.big ? inp
          : h('div', { class: 'inp-grp' }, h('span', { class: 'pre', text: curSymbol(cur || baseCurrency()) }), inp);
        if (f.big) inp.classList.add('big-amount');
        ctl = h('div', { class: 'amt-field' }, box, words);
        break;
      }

      case 'percent': {
        const inp = h('input', { class: 'inp num', type: 'number', step: f.step || '0.01', value: model[f.key] ?? '' });
        inp.addEventListener('input', () => set(inp.value === '' ? '' : Number(inp.value)));
        ctl = h('div', { class: 'inp-grp' }, h('span', { class: 'pre', text: '%' }), inp);
        break;
      }

      case 'number': {
        ctl = h('input', { class: 'inp num', type: 'number', step: f.step || 'any', min: f.min, max: f.max,
          placeholder: f.placeholder || '', value: model[f.key] ?? '' });
        ctl.addEventListener('input', () => set(ctl.value === '' ? '' : Number(ctl.value)));
        break;
      }

      case 'color': {
        const swatches = ['#7c5cff','#22d3ee','#10b981','#f59e0b','#f43f5e','#8b5cf6','#38bdf8','#34d399','#fb923c','#f472b6','#facc15','#94a3b8'];
        model[f.key] ??= swatches[0];
        ctl = h('div', { class: 'row wrap', style: { gap: '6px' } });
        swatches.forEach(c => {
          const b = h('button', { type: 'button', style: { width: '26px', height: '26px', borderRadius: '8px', background: c, border: model[f.key] === c ? '2px solid var(--text)' : '2px solid transparent' },
            onClick: () => { set(c); [...ctl.children].forEach(x => (x.style.border = '2px solid transparent')); b.style.border = '2px solid var(--text)'; } });
          ctl.append(b);
        });
        break;
      }

      case 'attach': {
        model[f.key] = Array.isArray(model[f.key]) ? [...model[f.key]] : [];
        const listEl = h('div', { class: 'attach-list', style: { marginTop: '8px' } });
        const fileInp = h('input', { type: 'file', multiple: true, accept: f.accept || 'image/*,.pdf,.csv,.txt,.doc,.docx,.xls,.xlsx', hidden: true });
        const dz = h('div', { class: 'dropzone' }, `${icon('paper', 16)} Attach receipts, invoices or documents`);
        dz.innerHTML = `<span style="display:inline-flex;gap:7px;align-items:center">${icon('paper', 16)} Click or drop files here</span>`;
        const draw = () => {
          listEl.innerHTML = '';
          model[f.key].forEach((a, i) => listEl.append(h('div', { class: 'attach' },
            a.mime?.startsWith('image/') ? h('img', { src: a.data, alt: '' }) : h('span', { html: icon('file', 15) }),
            h('span', { class: 'ell', style: { flex: 1 }, text: a.name }),
            h('span', { class: 't3 tiny', text: humanSize(a.size) }),
            h('button', { type: 'button', style: { opacity: .7 }, text: '×', onClick: () => { model[f.key].splice(i, 1); draw(); } }))));
        };
        const addFiles = async files => {
          for (const file of files) {
            if (file.size > 6 * 1024 * 1024) { toast(`${file.name} is larger than 6 MB`, 'warn'); continue; }
            model[f.key].push({ id: uid('f'), name: file.name, mime: file.type, size: file.size, data: await fileToDataURL(file) });
          }
          draw();
        };
        dz.addEventListener('click', () => fileInp.click());
        dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('over'));
        dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); addFiles([...e.dataTransfer.files]); });
        fileInp.addEventListener('change', () => addFiles([...fileInp.files]));

        // Camera capture: `capture` opens the rear camera directly on phones and
        // falls back to a normal file picker on desktop.
        const camInp = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
        camInp.addEventListener('change', () => addFiles([...camInp.files]));
        const camBtn = h('button', { type: 'button', class: 'btn sm', style: { marginTop: '8px' },
          html: `${icon('paper', 15)}<span>Scan a bill with the camera</span>`,
          onClick: () => camInp.click() });

        draw();
        ctl = h('div', {}, dz, fileInp, camInp, camBtn, listEl);
        break;
      }

      case 'date':
      case 'time':
      case 'email':
      case 'tel':
      case 'url':
      default: {
        ctl = h('input', { class: 'inp', type: f.type === 'text' || !f.type ? 'text' : f.type,
          placeholder: f.placeholder || '', value: model[f.key] ?? '', min: f.min, max: f.max, list: f.datalistId });
        ctl.addEventListener('input', () => set(ctl.value));
        if (f.datalist?.length) {
          const dlId = uid('dl'); ctl.setAttribute('list', dlId);
          const dl = h('datalist', { id: dlId }, ...f.datalist.map(v => h('option', { value: v })));
          ctl = h('div', {}, ctl, dl);
        }
        break;
      }
    }
    if (f.type !== 'switch' && f.type !== 'static') model[f.key] ??= (f.value ?? '');
    fw.append(ctl);
    if (f.hint) fw.append(h('div', { class: 'hint', text: f.hint }));
    const msg = h('div', { class: 'msg', hidden: true });
    fw.append(msg);
    controls.set(f.key, { wrap: fw, ctl, msg, field: f, rebuild });
    wrap.append(fw);
  }
  rerenderConditional();

  return {
    el: wrap,
    get model() { return model; },
    read() {
      const out = { ...model };
      fields.forEach(f => { if (f.transform) out[f.key] = f.transform(out[f.key], out); });
      return out;
    },
    set(key, value) {
      model[key] = value;
      const c = controls.get(key);
      if (!c) return;
      const input = c.ctl.matches?.('input,select,textarea') ? c.ctl : c.ctl.querySelector('input,select,textarea');
      if (input) { if (input.type === 'checkbox') input.checked = !!value; else input.value = value ?? ''; }
      rerenderConditional();
    },
    validate() {
      let ok = true;
      for (const [key, c] of controls) {
        const f = c.field;
        c.msg.hidden = true;
        const input = c.ctl.matches?.('input,select,textarea') ? c.ctl : c.ctl.querySelector('input,select,textarea');
        input?.classList.remove('err');
        if (c.wrap.hidden) continue;
        const v = model[key];
        let err = '';
        if (f.required && (v === '' || v == null || (Array.isArray(v) && !v.length))) err = `${f.label} is required`;
        else if (f.validate) err = f.validate(v, model) || '';
        else if ((f.type === 'money' || f.type === 'number') && v !== '' && !Number.isFinite(Number(v))) err = 'Enter a valid number';
        if (err) { ok = false; c.msg.textContent = err; c.msg.hidden = false; input?.classList.add('err'); }
      }
      if (!ok) wrap.querySelector('.msg:not([hidden])')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return ok;
    },
    focus(key) { const c = controls.get(key); (c?.ctl.matches?.('input') ? c.ctl : c?.ctl.querySelector('input,select,textarea'))?.focus(); },
    /** Re-reads a field's `options` — use after the underlying list changes. */
    refresh(key) { controls.get(key)?.rebuild?.(); },
  };
}

/** Convenience: modal wrapping a form with Save/Cancel. */
export function formModal({ title, subtitle, fields, values = {}, size = 'wide', columns = 2, submitText = 'Save', onSubmit, extraFooter, onClose, closeOnBack = true }) {
  const f = form(fields, values, { columns });
  const m = modal({
    title, subtitle, size, body: f.el, onClose, closeOnBack,
    footer: frag(
      extraFooter || null,
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onClick: async e => {
        if (!f.validate()) return;
        const btn = e.currentTarget; btn.disabled = true;
        try { await onSubmit(f.read(), m); } catch (err) { console.error(err); toast(err.message || 'Something went wrong', 'err'); btn.disabled = false; }
      } }, submitText)),
  });
  m.el.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) m.dialog.querySelector('.btn.primary')?.click();
  });
  return { modal: m, form: f };
}

/* ═══════════ DATA TABLE ═══════════ */
/**
 * columns: [{key,label,render(row),value(row),align,width,sortable=true,className}]
 * options: {rows, empty, pageSize, searchable, searchFields, onRowClick, actions(row), exportName, toolbar, footer}
 */
export function dataTable(columns, options = {}) {
  const {
    rows = [], pageSize = 25, searchable = true, searchFields, onRowClick, actions,
    exportName = 'export', emptyTitle = 'Nothing here yet', emptyMsg = '', emptyIcon = 'file',
    toolbarExtra, footRow, defaultSort, selectable = false, onSelect, dense = false,
  } = options;

  let q = '', sortKey = defaultSort?.key || null, sortDir = defaultSort?.dir || -1, page = 1;
  const selected = new Set();

  const wrap = h('div', { class: 'card' });
  const toolbar = h('div', { class: 'row wrap', style: { padding: '11px 14px', gap: '9px', borderBottom: '1px solid var(--border)' } });
  const tblWrap = h('div', { class: 'tbl-wrap' });
  const pager = h('div', { class: 'pager' });

  const searchEl = h('div', { class: 'search-inp' }, h('span', { html: icon('search', 16) }),
    h('input', { class: 'inp', type: 'search', placeholder: 'Search…' }));
  const searchInput = searchEl.querySelector('input');
  searchInput.addEventListener('input', debounce(() => { q = searchInput.value.trim().toLowerCase(); page = 1; render(); }, 180));

  const val = (c, r) => (c.value ? c.value(r) : r[c.key]);

  function filtered() {
    let out = options.rows;
    if (q) {
      const fields = searchFields || columns.map(c => c.key);
      out = out.filter(r => fields.some(k => {
        const c = columns.find(x => x.key === k);
        const v = c ? val(c, r) : r[k];
        return String(v ?? '').toLowerCase().includes(q);
      }));
    }
    if (sortKey) {
      const c = columns.find(x => x.key === sortKey);
      if (c) out = sortBy(out, r => { const v = val(c, r); return typeof v === 'string' ? v.toLowerCase() : v; }, sortDir);
    }
    return out;
  }

  function render() {
    const data = filtered();
    const pages = Math.max(1, Math.ceil(data.length / pageSize));
    page = Math.min(page, pages);
    const slice = data.slice((page - 1) * pageSize, page * pageSize);

    tblWrap.innerHTML = '';
    if (!data.length) {
      tblWrap.append(empty(q ? 'No matches' : emptyTitle, q ? `Nothing matched “${q}”.` : emptyMsg, emptyIcon));
    } else {
      const tbl = h('table', { class: 'tbl' });
      const thead = h('thead');
      const hr = h('tr');
      if (selectable) hr.append(h('th', { class: 'no-sort', style: { width: '32px' } },
        h('input', { type: 'checkbox', onChange: e => {
          slice.forEach(r => e.target.checked ? selected.add(r.id) : selected.delete(r.id));
          onSelect?.([...selected]); render();
        } })));
      columns.forEach(c => {
        const th = h('th', { class: `${c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : ''} ${c.sortable === false ? 'no-sort' : ''} ${sortKey === c.key ? 'sorted' : ''}`,
          style: c.width ? { width: c.width } : null },
          c.label, c.sortable === false ? '' : h('span', { class: 'sortic', text: sortKey === c.key ? (sortDir === 1 ? ' ▲' : ' ▼') : ' ⇅' }));
        if (c.sortable !== false) th.addEventListener('click', () => {
          if (sortKey === c.key) sortDir = -sortDir; else { sortKey = c.key; sortDir = 1; }
          render();
        });
        hr.append(th);
      });
      if (actions) hr.append(h('th', { class: 'no-sort', style: { width: '44px' } }));
      thead.append(hr);
      const tbody = h('tbody');
      for (const r of slice) {
        const tr = h('tr', { class: onRowClick ? 'clickable' : '' });
        if (selectable) tr.append(h('td', {}, h('input', { type: 'checkbox', checked: selected.has(r.id),
          onClick: e => e.stopPropagation(),
          onChange: e => { e.target.checked ? selected.add(r.id) : selected.delete(r.id); onSelect?.([...selected]); } })));
        columns.forEach(c => {
          const td = h('td', { class: `${c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : ''} ${c.className || ''}`,
            style: dense ? { padding: '7px 12px' } : null });
          const content = c.render ? c.render(r) : val(c, r);
          if (content instanceof Node) td.append(content);
          else td.innerHTML = content == null ? '<span class="t3">—</span>' : String(content);
          tr.append(td);
        });
        if (actions) {
          const acts = actions(r);
          tr.append(h('td', { class: 'act' }, h('button', { class: 'icon-btn row-act', style: { width: '30px', height: '30px' }, html: icon('dots', 16),
            onClick: e => { e.stopPropagation(); menu(e.currentTarget, acts); } })));
        }
        if (onRowClick) tr.addEventListener('click', e => { if (!e.target.closest('button,input,a')) onRowClick(r); });
        tbody.append(tr);
      }
      tbl.append(thead, tbody);
      if (footRow) {
        const fr = footRow(data);
        if (fr) tbl.append(h('tfoot', {}, fr));
      }
      tblWrap.append(tbl);
    }

    pager.innerHTML = '';
    pager.append(h('span', { text: `${data.length.toLocaleString()} record${data.length === 1 ? '' : 's'}${data.length !== options.rows.length ? ` (of ${options.rows.length.toLocaleString()})` : ''}` }));
    if (pages > 1) {
      const nav = h('div', { class: 'pages' });
      nav.append(h('button', { class: 'btn xs', disabled: page === 1, html: icon('left', 13), onClick: () => { page--; render(); } }));
      const around = [...new Set([1, page - 1, page, page + 1, pages])].filter(p => p >= 1 && p <= pages).sort((a, b) => a - b);
      let last = 0;
      around.forEach(p => {
        if (p - last > 1) nav.append(h('span', { class: 't3', text: '…' }));
        nav.append(h('button', { class: `btn xs ${p === page ? 'primary' : ''}`, text: String(p), onClick: () => { page = p; render(); } }));
        last = p;
      });
      nav.append(h('button', { class: 'btn xs', disabled: page === pages, html: icon('right', 13), onClick: () => { page++; render(); } }));
      pager.append(nav);
    }
  }

  function exportCSV() {
    const data = filtered();
    const cols = columns.filter(c => c.export !== false);
    const rowsOut = data.map(r => Object.fromEntries(cols.map(c => {
      const v = c.exportValue ? c.exportValue(r) : val(c, r);
      return [c.label, v instanceof Node ? v.textContent : v];
    })));
    download(toCSV(rowsOut), `${exportName}-${today()}.csv`, 'text/csv');
    toast(`Exported ${rowsOut.length} rows to CSV`, 'ok');
  }

  if (searchable) toolbar.append(searchEl);
  if (toolbarExtra) toolbar.append(toolbarExtra);
  toolbar.append(h('div', { class: 'spacer' }));
  toolbar.append(h('button', { class: 'btn sm', html: `${icon('export', 15)}<span>CSV</span>`, onClick: exportCSV }));
  toolbar.append(h('button', { class: 'btn sm', html: icon('print', 15), title: 'Print', onClick: () => window.print() }));

  wrap.append(toolbar, tblWrap, pager);
  render();
  return { el: wrap, refresh: (newRows) => { if (newRows) options.rows = newRows; render(); }, exportCSV,
    get selected() { return [...selected]; }, clearSelection() { selected.clear(); render(); } };
}

/* ---------- privacy blur ---------- */
export function applyPrivacy(on) {
  document.body.classList.toggle('privacy', on);
  let st = $('#privacy-style');
  if (!st) { st = h('style', { id: 'privacy-style' }); document.head.append(st); }
  st.textContent = on
    ? '.privacy .num,.privacy .lst-amt,.privacy .stat .val{filter:blur(6px);transition:filter .2s}.privacy .num:hover,.privacy .stat:hover .val{filter:none}'
    : '';
}

export { fmtMoney, fmtNum, fmtDate, today, nowTime, CURRENCIES };
