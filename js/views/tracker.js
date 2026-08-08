/* ═══════════ views/tracker.js — income & expense tracker ═══════════ */

import {
  h, frag, icon, card, stat, tag, empty, toast, confirm, modal, formModal, store, state, settings,
  fmtMoney, fmtDate, today, sortBy, period, periodSelect, pageHead, kpiGrid, openTxnModal, openSplitModal,
  amountCell, catChip, statusTag, accountOptions, categoryOptions, confirmDelete,
} from './common.js';
import { dataTable, form, menu } from '../ui.js';
import { donut, barChart, lineChart } from '../charts.js';
import { txnsIn, incomeIn, expenseIn, categoryBreakdown, monthlySeries, dailySeries } from '../store.js';
import {
  money, parseCSV, toCSV, download, addDays, daysBetween, uid, esc, fmtMonthKey, nextOccurrence, RECUR,
} from '../util.js';
import { suggestCategory } from '../ai.js';

const F = { per: 'month', type: '', accountId: '', categoryId: '', status: '', tag: '', from: '', to: '', min: '', max: '' };

export async function render(root, api) {
  let tab = 'all';
  const draw = () => {
    root.innerHTML = '';
    root.append(build(tab, t => { tab = t; draw(); }, draw, api));
  };
  draw();
  return store.bus.on('change', ({ store: s }) => { if (['transactions', 'recurring', 'categories', 'accounts'].includes(s)) draw(); });
}

function activeRange() {
  if (F.from && F.to) return { from: F.from, to: F.to, label: `${fmtDate(F.from)} → ${fmtDate(F.to)}` };
  return period(F.per);
}

function build(tab, setTab, redraw, api) {
  const wrap = h('div', {});
  const p = activeRange();
  api.setSubtitle(p.label);

  let rows = txnsIn(p.from, p.to).filter(t => {
    if (F.type && t.type !== F.type) return false;
    if (F.accountId && t.accountId !== F.accountId && t.toAccountId !== F.accountId) return false;
    // selecting a parent category also matches every sub-category under it
    if (F.categoryId && !store.catWithChildren(F.categoryId).includes(t.categoryId)) return false;
    if (F.status && t.status !== F.status) return false;
    if (F.tag && !(t.tags || []).includes(F.tag)) return false;
    if (F.min !== '' && t.base < Number(F.min)) return false;
    if (F.max !== '' && t.base > Number(F.max)) return false;
    return true;
  });

  const inc = money(rows.filter(t => t.type === 'income').reduce((a, t) => a + t.base, 0));
  const exp = money(rows.filter(t => t.type === 'expense').reduce((a, t) => a + t.base, 0));
  const tra = money(rows.filter(t => t.type === 'transfer').reduce((a, t) => a + t.base, 0));

  wrap.append(pageHead('Financial Tracker', 'Every rupee in, every rupee out — with receipts, tags and full history.',
    h('button', { class: 'btn', html: `${icon('import', 16)} Import`, onClick: () => importCSV(redraw) }),
    h('button', { class: 'btn', html: `${icon('copy', 16)} Split`, onClick: () => openSplitModal(redraw) }),
    h('button', { class: 'btn primary', html: `${icon('plus', 16)} Add transaction`, onClick: () => openTxnModal(null, { onSaved: redraw }) })));

  /* KPI */
  wrap.append(kpiGrid(
    stat({ label: 'Income', value: fmtMoney(inc), icon: 'trend', tone: 'pos',
      foot: h('span', { class: 't3', text: `${rows.filter(t => t.type === 'income').length} entries` }) }),
    stat({ label: 'Expense', value: fmtMoney(exp), icon: 'swap', tone: 'neg',
      foot: h('span', { class: 't3', text: `${rows.filter(t => t.type === 'expense').length} entries` }) }),
    stat({ label: 'Net', value: fmtMoney(inc - exp), icon: 'wallet', tone: inc - exp >= 0 ? 'pos' : 'neg',
      foot: h('span', { class: 't3', text: inc ? `${(((inc - exp) / inc) * 100).toFixed(1)}% savings rate` : '—' }) }),
    stat({ label: 'Transfers', value: `${rows.filter(t => t.type === 'transfer').length} movements`, icon: 'repeat', tone: 'info',
      foot: h('span', { class: 't3', text: `${rows.filter(t => t.type === 'transfer').length} entries` }) }),
    stat({ label: 'Avg / day', value: fmtMoney(exp / Math.max(1, daysBetween(p.from, p.to) + 1)), icon: 'chart',
      foot: h('span', { class: 't3', text: `over ${daysBetween(p.from, p.to) + 1} days` }) })));

  /* Tabs */
  const tabsEl = h('div', { class: 'tabs mt' });
  [['all', 'All transactions'], ['income', 'Income'], ['expense', 'Expenses'], ['recurring', 'Recurring'], ['pending', 'Pending & scheduled']]
    .forEach(([v, l]) => tabsEl.append(h('button', { class: v === tab ? 'on' : '', text: l, onClick: () => setTab(v) })));
  wrap.append(tabsEl);

  const body = h('div', { class: 'mt' });
  wrap.append(body);

  if (tab === 'recurring') { body.append(recurringPanel(redraw)); return wrap; }

  let view = rows;
  if (tab === 'income') view = rows.filter(t => t.type === 'income');
  else if (tab === 'expense') view = rows.filter(t => t.type === 'expense');
  else if (tab === 'pending') view = rows.filter(t => t.status !== 'cleared');

  /* Filter bar */
  body.append(filterBar(redraw));

  /* Charts */
  const cats = categoryBreakdown(p.from, p.to, tab === 'income' ? 'income' : 'expense');
  const dseries = dailySeries(p.from, p.to);
  body.append(h('div', { class: 'grid mt', style: { gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)' } },
    card('Daily flow', barChart([
      { name: 'Income', color: 'var(--pos)', values: dseries.map(d => d.income) },
      { name: 'Expense', color: 'var(--neg)', values: dseries.map(d => d.expense) },
    ], dseries.map(d => fmtDate(d.key, 'short')), { height: 230 }), null, { sub: p.label }),
    card(tab === 'income' ? 'Income sources' : 'Expense categories',
      cats.length ? donut(cats, { size: 200, centerLabel: 'Total' }) : empty('No data', '', 'tag'))));

  /* Table */
  const bulkBar = h('div', { class: 'row', style: { gap: '7px' }, hidden: true });
  const dt = dataTable([
    { key: 'date', label: 'Date', width: '108px', render: r => h('div', {},
      h('div', { style: { fontWeight: 600 }, text: fmtDate(r.date) }),
      h('div', { class: 'tiny t3', text: r.time || '' })) },
    { key: 'notes', label: 'Description', value: r => r.notes || r.merchant || store.catName(r.categoryId),
      render: r => h('div', { style: { minWidth: '160px' } },
        h('div', { class: 'ell', style: { fontWeight: 560 }, text: r.notes || r.merchant || store.catName(r.categoryId) }),
        h('div', { class: 'row', style: { gap: '4px', marginTop: '3px', flexWrap: 'wrap' } },
          ...(r.tags || []).slice(0, 3).map(t0 => tag(t0)),
          r.attachments?.length ? tag(`${icon('paper', 11)} ${r.attachments.length}`, 'info') : null,
          r.recurringId ? tag('Recurring', 'acc') : null)) },
    { key: 'categoryId', label: 'Category', value: r => store.catPath(r.categoryId),
      exportValue: r => store.catPath(r.categoryId, ' > '),
      render: r => (r.type === 'transfer' ? tag('Transfer', 'info') : catChip(r.categoryId)) },
    { key: 'accountId', label: 'Account', value: r => store.accName(r.accountId),
      render: r => h('span', { class: 'tiny t2', text: r.type === 'transfer' ? `${store.accName(r.accountId)} → ${store.accName(r.toAccountId)}` : store.accName(r.accountId) }) },
    { key: 'paymentMethod', label: 'Method', value: r => r.paymentMethod || '—',
      render: r => h('span', { class: 'tiny t3', text: r.paymentMethod || '—' }) },
    { key: 'status', label: 'Status', render: r => statusTag(r.status), value: r => r.status },
    { key: 'base', label: 'Amount', align: 'right', render: r => amountCell(r),
      exportValue: r => (r.type === 'expense' ? -r.base : r.base) },
  ], {
    rows: sortBy(view, t => `${t.date}${t.time || ''}`, -1),
    pageSize: 25, exportName: 'transactions', selectable: true,
    searchFields: ['notes', 'categoryId', 'accountId', 'paymentMethod'],
    emptyTitle: 'No transactions in this range',
    emptyMsg: 'Adjust the filters or add a new entry.',
    emptyIcon: 'swap',
    onRowClick: t => openTxnModal(t, { onSaved: redraw }),
    onSelect: ids => {
      bulkBar.hidden = !ids.length;
      bulkBar.innerHTML = '';
      if (!ids.length) return;
      bulkBar.append(
        tag(`${ids.length} selected`, 'acc'),
        h('button', { class: 'btn xs', text: 'Change category', onClick: () => bulkCategory(ids, redraw) }),
        h('button', { class: 'btn xs', text: 'Add tag', onClick: () => bulkTag(ids, redraw) }),
        h('button', { class: 'btn xs', text: 'Mark cleared', onClick: () => bulkStatus(ids, 'cleared', redraw) }),
        h('button', { class: 'btn xs neg', text: 'Delete', onClick: () => bulkDelete(ids, redraw) }));
    },
    toolbarExtra: bulkBar,
    actions: r => [
      { label: 'Edit', icon: 'edit', onClick: () => openTxnModal(r, { onSaved: redraw }) },
      { label: 'Duplicate', icon: 'copy', onClick: async () => {
        await store.save('transactions', { ...r, id: undefined, date: today(), createdAt: undefined });
        toast('Duplicated to today', 'ok'); redraw();
      } },
      { label: 'Make recurring', icon: 'repeat', onClick: () => makeRecurring(r, redraw) },
      '-',
      { label: 'Delete', icon: 'trash', danger: true, onClick: async () => {
        if (await confirmDelete('this transaction')) { await store.remove('transactions', r.id); toast('Deleted', 'ok'); redraw(); }
      } },
    ],
    footRow: data => {
      const i = money(data.filter(t => t.type === 'income').reduce((a, t) => a + t.base, 0));
      const e = money(data.filter(t => t.type === 'expense').reduce((a, t) => a + t.base, 0));
      return h('tr', {}, h('td', { colspan: 7, class: 'right' },
        h('span', { class: 't3', text: 'Filtered totals: ' }),
        h('span', { class: 'pos num', text: `+${fmtMoney(i)}` }), ' / ',
        h('span', { class: 'neg num', text: `−${fmtMoney(e)}` }), ' = ',
        h('span', { class: `num ${i - e >= 0 ? 'pos' : 'neg'}`, text: fmtMoney(i - e) })));
    },
  });
  body.append(h('div', { class: 'mt' }, dt.el));
  return wrap;
}

/* ---------- filter bar ---------- */
function filterBar(redraw) {
  const bar = h('div', { class: 'card pad', style: { display: 'flex', gap: '9px', flexWrap: 'wrap', alignItems: 'center' } });

  const sel = (label, key, opts) => {
    const s0 = h('select', { class: 'inp', style: { width: 'auto', minWidth: '130px', height: '31px', fontSize: '.78rem' } },
      h('option', { value: '' }, label), ...opts.map(([v, l]) => h('option', { value: v, selected: F[key] === v }, l)));
    s0.onchange = () => { F[key] = s0.value; redraw(); };
    return s0;
  };
  bar.append(
    periodSelect(F.from ? 'custom' : F.per, k => {
      // "Custom range…" is a signpost, not a range: send the user to the two
      // date fields that actually set one, rather than leaving a dead option.
      // showPicker() throws without user activation, so it is best-effort only.
      if (k === 'custom') {
        const d = bar.querySelector('input[type=date]');
        d?.focus();
        try { d?.showPicker?.(); } catch { /* focus alone is enough of a hint */ }
        return;
      }
      F.per = k; F.from = ''; F.to = '';
      redraw();
    }, { custom: true }),
    sel('All types', 'type', [['income', 'Income'], ['expense', 'Expense'], ['transfer', 'Transfer']]),
    sel('All accounts', 'accountId', accountOptions()),
    sel('All categories', 'categoryId', [...categoryOptions('income'), ...categoryOptions('expense')]),
    sel('Any status', 'status', [['cleared', 'Cleared'], ['pending', 'Pending'], ['scheduled', 'Scheduled']]),
    sel('Any tag', 'tag', store.allTags().map(t => [t, t])));

  const from = h('input', { class: 'inp', type: 'date', style: { width: 'auto', height: '31px', fontSize: '.78rem' }, value: F.from });
  const to = h('input', { class: 'inp', type: 'date', style: { width: 'auto', height: '31px', fontSize: '.78rem' }, value: F.to });
  from.onchange = to.onchange = () => { F.from = from.value; F.to = to.value; if (F.from && F.to) redraw(); };
  bar.append(h('span', { class: 'tiny t3', text: 'Custom:' }), from, h('span', { class: 'tiny t3', text: '→' }), to);

  const min = h('input', { class: 'inp num', type: 'number', placeholder: 'Min', style: { width: '84px', height: '31px', fontSize: '.78rem' }, value: F.min });
  const max = h('input', { class: 'inp num', type: 'number', placeholder: 'Max', style: { width: '84px', height: '31px', fontSize: '.78rem' }, value: F.max });
  min.onchange = () => { F.min = min.value; redraw(); };
  max.onchange = () => { F.max = max.value; redraw(); };
  bar.append(min, max);

  const active = Object.entries(F).filter(([k, v]) => v && k !== 'per').length;
  if (active) bar.append(h('button', { class: 'btn xs', text: `Clear ${active} filter${active > 1 ? 's' : ''}`,
    onClick: () => { Object.keys(F).forEach(k => { if (k !== 'per') F[k] = ''; }); redraw(); } }));
  return bar;
}

/* ---------- bulk operations ---------- */
async function bulkCategory(ids, redraw) {
  const { modal: m, form: f } = formModal({
    title: `Change category for ${ids.length} transactions`, size: 'narrow', columns: 1,
    fields: [{ key: 'categoryId', label: 'New category', type: 'select', required: true,
      options: [...categoryOptions('expense'), ...categoryOptions('income')] }],
    onSubmit: async v => {
      for (const id of ids) {
        const t = store.find('transactions', id);
        if (t) await store.save('transactions', { ...t, categoryId: v.categoryId }, { silent: true, auditIt: false });
      }
      await store.audit('bulk-update', 'transactions', '', `${ids.length} recategorised`);
      store.bus.emit('change', { store: 'transactions', action: 'bulk' });
      m.close(); toast(`${ids.length} transactions updated`, 'ok'); redraw();
    },
  });
}
async function bulkTag(ids, redraw) {
  const { modal: m } = formModal({
    title: `Tag ${ids.length} transactions`, size: 'narrow', columns: 1,
    fields: [{ key: 'tag', label: 'Tag to add', type: 'text', required: true, datalist: store.allTags() }],
    onSubmit: async v => {
      for (const id of ids) {
        const t = store.find('transactions', id);
        if (t && !(t.tags || []).includes(v.tag))
          await store.save('transactions', { ...t, tags: [...(t.tags || []), v.tag] }, { silent: true, auditIt: false });
      }
      store.bus.emit('change', { store: 'transactions', action: 'bulk' });
      m.close(); toast(`Tag “${v.tag}” applied`, 'ok'); redraw();
    },
  });
}
async function bulkStatus(ids, status, redraw) {
  for (const id of ids) {
    const t = store.find('transactions', id);
    if (t) await store.save('transactions', { ...t, status }, { silent: true, auditIt: false });
  }
  store.bus.emit('change', { store: 'transactions', action: 'bulk' });
  toast(`${ids.length} marked ${status}`, 'ok'); redraw();
}
async function bulkDelete(ids, redraw) {
  if (!await confirm({ title: `Delete ${ids.length} transactions?`, danger: true, confirmText: 'Delete all',
    message: 'This permanently removes the selected records.' })) return;
  await store.removeMany('transactions', ids);
  toast(`${ids.length} transactions deleted`, 'ok'); redraw();
}

/* ---------- recurring ---------- */
function makeRecurring(t, redraw) {
  const { modal: m } = formModal({
    title: 'Create recurring rule', size: 'narrow', columns: 1,
    subtitle: `Based on “${t.notes || store.catName(t.categoryId)}” (${fmtMoney(t.base)})`,
    fields: [
      { key: 'rule', label: 'Repeats', type: 'select', required: true, options: RECUR.filter(r => r[0] !== 'none') },
      { key: 'nextRun', label: 'Next occurrence', type: 'date', required: true, value: nextOccurrence(t.date, 'monthly') },
      { key: 'endDate', label: 'Stop after (optional)', type: 'date' },
    ],
    onSubmit: async v => {
      await store.save('recurring', { rule: v.rule, nextRun: v.nextRun, endDate: v.endDate || null, active: true,
        name: t.notes || store.catName(t.categoryId),
        template: { ...t, id: undefined, recurringId: undefined, attachments: [] } });
      m.close(); toast('Recurring rule created', 'ok'); redraw();
    },
  });
}

function recurringPanel(redraw) {
  const rows = state.recurring;
  const wrap = h('div', {});
  wrap.append(h('div', { class: 'row between mb' },
    h('div', {}, h('h3', { text: 'Recurring transactions' }),
      h('p', { class: 'tiny t3', text: 'These post automatically on their schedule, even if the app was closed.' })),
    h('button', { class: 'btn sm', html: `${icon('repeat', 15)} Run now`, onClick: async () => {
      const n = await store.runRecurring();
      toast(n ? `${n} transactions posted` : 'Nothing due right now', n ? 'ok' : 'info'); redraw();
    } })));

  if (!rows.length) return wrap.appendChild(empty('No recurring rules', 'Turn any transaction into a repeating one from its row menu, or tick “Repeat” when creating it.', 'repeat')) && wrap;

  wrap.append(dataTable([
    { key: 'name', label: 'Rule', render: r => h('div', {}, h('b', { text: r.name || 'Recurring' }),
      h('div', { class: 'tiny t3', text: `${r.template?.type === 'income' ? 'Income' : 'Expense'} · ${store.catName(r.template?.categoryId)}` })) },
    { key: 'rule', label: 'Frequency', render: r => tag((RECUR.find(x => x[0] === r.rule) || [, r.rule])[1], 'acc') },
    { key: 'amount', label: 'Amount', align: 'right', value: r => r.template?.amount || 0,
      render: r => h('span', { class: 'num', text: fmtMoney(r.template?.amount || 0) }) },
    { key: 'nextRun', label: 'Next run', render: r => r.nextRun ? h('span', {}, fmtDate(r.nextRun)) : tag('Ended') },
    { key: 'active', label: 'Status', render: r => tag(r.active ? 'Active' : 'Paused', r.active ? 'pos' : '') },
  ], {
    rows, exportName: 'recurring', pageSize: 15, searchable: false,
    actions: r => [
      { label: r.active ? 'Pause' : 'Resume', icon: 'repeat', onClick: async () => {
        await store.save('recurring', { ...r, active: !r.active }); toast(r.active ? 'Paused' : 'Resumed', 'ok'); redraw(); } },
      { label: 'Delete', icon: 'trash', danger: true, onClick: async () => {
        if (await confirmDelete('this rule')) { await store.remove('recurring', r.id); redraw(); } } },
    ],
  }).el);
  return wrap;
}

/* ---------- CSV import ---------- */
function importCSV(redraw) {
  const fileInp = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true });
  const dz = h('div', { class: 'dropzone', style: { padding: '30px' } });
  dz.innerHTML = `<div style="display:grid;gap:6px;place-items:center">${icon('import', 24)}
    <b>Drop a CSV here or click to browse</b>
    <span class="tiny">Columns are mapped in the next step. Date, amount and description are enough.</span></div>`;
  const preview = h('div', { class: 'mt' });

  const m = modal({ title: 'Import transactions', subtitle: 'Bank statements, other apps, spreadsheets — anything CSV.',
    size: 'wide', body: frag(dz, fileInp, preview) });

  const handle = async file => {
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length < 2) { toast('That file has no data rows', 'warn'); return; }
    const headers = rows[0].map(x => x.trim());
    const data = rows.slice(1);
    showMapper(headers, data);
  };
  dz.onclick = () => fileInp.click();
  fileInp.onchange = () => fileInp.files[0] && handle(fileInp.files[0]);
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove('over'); if (e.dataTransfer.files[0]) handle(e.dataTransfer.files[0]); };

  function guess(headers, names) {
    const i = headers.findIndex(hh => names.some(n => hh.toLowerCase().includes(n)));
    return i >= 0 ? String(i) : '';
  }
  function showMapper(headers, data) {
    const opts = [['', '— ignore —'], ...headers.map((hh, i) => [String(i), `${hh || `Column ${i + 1}`}`])];
    const f = form([
      { key: 'date', label: 'Date column', type: 'select', options: opts, value: guess(headers, ['date', 'time', 'posted']), required: true },
      { key: 'amount', label: 'Amount column', type: 'select', options: opts, value: guess(headers, ['amount', 'value', 'debit', 'credit']), required: true },
      { key: 'desc', label: 'Description column', type: 'select', options: opts, value: guess(headers, ['desc', 'narration', 'details', 'memo', 'particulars', 'note']) },
      { key: 'category', label: 'Category column', type: 'select', options: opts, value: guess(headers, ['category', 'type']) },
      { key: 'accountId', label: 'Import into account', type: 'select', options: accountOptions(), required: true },
      { key: 'sign', label: 'Amount convention', type: 'select', value: 'negative-expense', options: [
        ['negative-expense', 'Negative numbers are expenses'],
        ['positive-expense', 'All rows are expenses'],
        ['positive-income', 'All rows are income']] },
      { key: 'autoCat', label: 'Auto-categorise with on-device AI where the category is missing', type: 'switch', value: true, col: 'full' },
      { key: 'dedupe', label: 'Skip rows that look like existing transactions', type: 'switch', value: true, col: 'full' },
    ], {}, { columns: 2 });

    preview.innerHTML = '';
    preview.append(h('div', { class: 'up mb', text: `${data.length} rows detected` }), f.el);
    const sample = h('div', { class: 'tbl-wrap mt' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, ...headers.map(hh => h('th', { class: 'no-sort', text: hh })))),
      h('tbody', {}, ...data.slice(0, 4).map(r => h('tr', {}, ...r.map(c => h('td', { text: c })))))));
    preview.append(sample);

    m.setFooter(frag(h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onClick: async e => {
        if (!f.validate()) return;
        const v = f.read();
        e.currentTarget.disabled = true; e.currentTarget.textContent = 'Importing…';
        const res = await doImport(data, v);
        m.close();
        toast(`Imported ${res.added} transactions${res.skipped ? `, skipped ${res.skipped} duplicates` : ''}`, 'ok');
        redraw();
      } }, 'Import')));
  }

  async function doImport(data, v) {
    const existing = new Set(state.transactions.map(t => `${t.date}|${t.base.toFixed(2)}|${(t.notes || '').slice(0, 24).toLowerCase()}`));
    const out = [];
    let skipped = 0;
    for (const r of data) {
      const rawDate = (r[+v.date] || '').trim();
      const d = normDate(rawDate);
      if (!d) continue;
      const rawAmt = (r[+v.amount] || '').replace(/[^\d.,\-()]/g, '').replace(/[(](.*)[)]/, '-$1').replace(/,/g, '');
      const amt = Number(rawAmt);
      if (!Number.isFinite(amt) || amt === 0) continue;
      const desc = v.desc !== '' ? (r[+v.desc] || '').trim() : '';
      const type = v.sign === 'positive-income' ? 'income'
        : v.sign === 'positive-expense' ? 'expense'
        : (amt < 0 ? 'expense' : 'income');
      let categoryId = null;
      if (v.category !== '') {
        const cname = (r[+v.category] || '').trim().toLowerCase();
        categoryId = state.categories.find(c => c.name.toLowerCase() === cname && c.kind === type)?.id || null;
      }
      if (!categoryId && v.autoCat) categoryId = suggestCategory(desc, type, Math.abs(amt))?.categoryId || null;
      if (!categoryId) categoryId = state.categories.find(c => c.kind === type && /other/i.test(c.name))?.id
        || state.categories.find(c => c.kind === type)?.id || null;
      const key = `${d}|${Math.abs(amt).toFixed(2)}|${desc.slice(0, 24).toLowerCase()}`;
      if (v.dedupe && existing.has(key)) { skipped++; continue; }
      existing.add(key);
      out.push({ type, amount: Math.abs(amt), currency: settings.baseCurrency, rate: 1, accountId: v.accountId,
        categoryId, date: d, notes: desc, status: 'cleared', tags: ['imported'] });
    }
    await store.saveMany('transactions', out);
    return { added: out.length, skipped };
  }
}

function normDate(s) {
  if (!s) return null;
  const t = s.trim();
  let m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) { // assume dd/mm/yyyy unless the first part must be a month
    const a = +m[1], b = +m[2];
    const [d, mo] = a > 12 ? [a, b] : b > 12 ? [b, a] : [a, b];
    return `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const parsed = new Date(t);
  if (!isNaN(parsed)) return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  return null;
}
