/* ═══════════ views/accounts.js ═══════════ */

import {
  h, frag, icon, card, stat, tag, empty, toast, confirm, modal, formModal, store, state, settings,
  fmtMoney, fmtDate, today, sortBy, pageHead, kpiGrid, confirmDelete, openTxnModal, amountCell,
  currencyOptions, statusTag,
} from './common.js';
import { dataTable, sheet, bar } from '../ui.js';
import { donut, lineChart, barChart } from '../charts.js';
import { accountBalances, balanceSeries, netWorth } from '../store.js';
import { money, colorFor, addDays, addMonths, fmtPct, monthKey } from '../util.js';

export async function render(root, api) {
  const draw = () => { root.innerHTML = ''; root.append(build(draw, api)); };
  draw();
  return store.bus.on('change', ({ store: s }) => { if (['accounts', 'transactions'].includes(s)) draw(); });
}

function build(redraw, api) {
  const wrap = h('div', {});
  const bals = accountBalances();
  const accounts = state.accounts.map(a => {
    const txns = state.transactions.filter(t => t.accountId === a.id || t.toAccountId === a.id);
    return { ...a, balance: bals.get(a.id) || 0, txnCount: txns.length,
      lastActivity: sortBy(txns, t => t.date, -1)[0]?.date || null };
  });
  const active = accounts.filter(a => !a.archived);
  const positive = money(active.filter(a => a.balance > 0).reduce((s, a) => s + a.balance, 0));
  const negative = money(active.filter(a => a.balance < 0).reduce((s, a) => s + Math.abs(a.balance), 0));
  api.setSubtitle(`${active.length} active accounts`);

  wrap.append(pageHead('Accounts', 'Cash, bank, cards, wallets and brokerage — balances are derived from your transactions, never entered by hand.',
    h('button', { class: 'btn', html: `${icon('swap', 16)} Transfer`, onClick: () => openTxnModal(null, { defaultType: 'transfer', onSaved: redraw }) }),
    h('button', { class: 'btn primary', html: `${icon('plus', 16)} New account`, onClick: () => editAccount(null, redraw) })));

  wrap.append(kpiGrid(
    stat({ label: 'Total balance', value: fmtMoney(money(positive - negative)), icon: 'wallet',
      tone: positive - negative >= 0 ? 'pos' : 'neg', foot: h('span', { class: 't3', text: `${active.length} accounts` }) }),
    stat({ label: 'Assets', value: fmtMoney(positive), icon: 'trend', tone: 'pos',
      foot: h('span', { class: 't3', text: `${active.filter(a => a.balance > 0).length} in credit` }) }),
    stat({ label: 'Card / overdraft debt', value: fmtMoney(negative), icon: 'alert', tone: negative ? 'neg' : 'pos',
      foot: h('span', { class: 't3', text: `${active.filter(a => a.balance < 0).length} in debit` }) }),
    stat({ label: 'Net worth', value: fmtMoney(netWorth().total), icon: 'bank', tone: 'info',
      foot: h('span', { class: 't3', text: 'Including investments and receivables' }) })));

  /* cards */
  const grid = h('div', { class: 'grid auto mt stagger' });
  if (!active.length) grid.append(empty('No accounts', 'Add a cash, bank or card account to start tracking.', 'wallet',
    h('button', { class: 'btn primary sm mt', onClick: () => editAccount(null, redraw) }, 'Add account')));
  sortBy(active, a => a.balance, -1).forEach(a => {
    const util = a.type === 'card' && a.creditLimit ? (Math.abs(Math.min(0, a.balance)) / a.creditLimit) * 100 : null;
    grid.append(h('div', { class: 'card pad', style: { cursor: 'pointer', borderTop: `3px solid ${a.color || '#7c5cff'}` },
      onClick: () => openAccount(a, redraw) },
      h('div', { class: 'row between mb' },
        h('div', { class: 'row', style: { gap: '9px', minWidth: 0 } },
          h('div', { class: 'avatar', style: { background: (a.color || '#7c5cff') + '22', color: a.color || '#7c5cff',
            fontSize: '1.15rem' }, text: store.accEmoji(a) }),
          h('div', { style: { minWidth: 0 } }, h('b', { class: 'ell', text: a.name }),
            h('div', { class: 'tiny t3', text: (store.ACCOUNT_TYPES.find(t => t[0] === a.type) || [, a.type])[1] }))),
        a.currency && a.currency !== settings.baseCurrency ? tag(a.currency, 'info') : null),
      h('div', { class: `num ${a.balance < 0 ? 'neg' : ''}`, style: { fontSize: '1.4rem', fontWeight: 750, letterSpacing: '-.03em' },
        text: fmtMoney(a.balance) }),
      h('div', { class: 'tiny t3', text: `${a.txnCount} transactions${a.lastActivity ? ` · last ${fmtDate(a.lastActivity)}` : ''}` }),
      util != null ? h('div', { class: 'mt-sm' },
        h('div', { class: 'row between', style: { marginBottom: '4px' } },
          h('span', { class: 'tiny t3', text: 'Credit used' }),
          h('span', { class: 'tiny num', text: `${fmtPct(util, 0)} of ${fmtMoney(a.creditLimit)}` })),
        bar(util, util > 70 ? 'neg' : util > 40 ? 'warn' : 'pos')) : null));
  });
  wrap.append(grid);

  /* charts */
  if (active.length) {
    const series = balanceSeries(addDays(today(), -89), today());
    wrap.append(h('div', { class: 'grid mt', style: { gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)' } },
      card('Combined balance — 90 days', lineChart([{ name: 'Balance', color: 'var(--accent)', values: series.map(s => s.value) }],
        series.map(s => fmtDate(s.key, 'short')), { height: 240, showDots: false, yZero: false })),
      card('Distribution', donut(active.filter(a => a.balance > 0).map(a =>
        ({ label: a.name, value: a.balance, color: a.color || colorFor(a.name) })), { size: 200, centerLabel: 'Assets' }))));
  }

  /* table */
  wrap.append(h('div', { class: 'mt' }, dataTable([
    { key: 'name', label: 'Account', render: r => h('div', { class: 'row', style: { gap: '9px' } },
      h('span', { style: { fontSize: '1.05rem' }, text: store.accEmoji(r) }),
      h('div', {}, h('b', { text: r.name }), r.archived ? tag('Archived') : null)) },
    { key: 'type', label: 'Type', value: r => (store.ACCOUNT_TYPES.find(t => t[0] === r.type) || [, r.type])[1] },
    { key: 'currency', label: 'Currency', render: r => tag(r.currency || settings.baseCurrency) },
    { key: 'openingBalance', label: 'Opening', align: 'right', render: r => h('span', { class: 'num t3', text: fmtMoney(r.openingBalance || 0) }) },
    { key: 'txnCount', label: 'Transactions', align: 'center' },
    { key: 'lastActivity', label: 'Last activity', render: r => r.lastActivity ? fmtDate(r.lastActivity) : h('span', { class: 't3', text: '—' }) },
    { key: 'balance', label: 'Current balance', align: 'right',
      render: r => h('span', { class: `num ${r.balance < 0 ? 'neg' : 'pos'}`, style: { fontWeight: 700 }, text: fmtMoney(r.balance) }) },
  ], {
    rows: accounts, exportName: 'accounts', pageSize: 20,
    onRowClick: a => openAccount(a, redraw),
    actions: a => [
      { label: 'View statement', icon: 'file', onClick: () => openAccount(a, redraw) },
      { label: 'Add transaction', icon: 'plus', onClick: () => openTxnModal(null, { onSaved: redraw }) },
      { label: 'Reconcile balance', icon: 'check', onClick: () => reconcile(a, redraw) },
      { label: 'Edit', icon: 'edit', onClick: () => editAccount(a, redraw) },
      { label: a.archived ? 'Unarchive' : 'Archive', icon: 'copy', onClick: async () => {
        await store.save('accounts', { ...a, balance: undefined, txnCount: undefined, lastActivity: undefined, archived: !a.archived });
        toast(a.archived ? 'Unarchived' : 'Archived', 'ok'); redraw(); } },
      '-',
      { label: 'Delete', icon: 'trash', danger: true, onClick: async () => {
        if (a.txnCount) { toast(`${a.name} has ${a.txnCount} transactions — archive it instead`, 'warn'); return; }
        if (await confirmDelete(a.name)) { await store.remove('accounts', a.id); redraw(); } } },
    ],
    footRow: data => h('tr', {}, h('td', { colspan: 6, class: 'right t3', text: 'Total' }),
      h('td', { class: 'right num', text: fmtMoney(money(data.reduce((s, a) => s + a.balance, 0))) })),
  }).el));

  return wrap;
}

/* ---------- editor ---------- */
function editAccount(a, redraw) {
  const { modal: m } = formModal({
    title: a ? `Edit ${a.name}` : 'New account', size: '', columns: 2,
    values: a || { type: 'bank', currency: settings.baseCurrency, openingBalance: 0, color: '#7c5cff' },
    fields: [
      { key: 'name', label: 'Account name', type: 'text', required: true, col: 'full',
        validate: v => (String(v || '').trim() ? '' : 'Account name cannot be empty') },
      { key: 'type', label: 'Type', type: 'select', options: store.ACCOUNT_TYPES },
      { key: 'icon', label: 'Icon', type: 'text', placeholder: '🏦',
        hint: 'Leave blank to use the type’s default emoji' },
      { key: 'currency', label: 'Currency', type: 'select', options: currencyOptions() },
      { key: 'openingBalance', label: 'Opening balance', type: 'money',
        hint: a ? 'Changing this shifts every historical balance' : 'The balance before any transactions were recorded' },
      { key: 'creditLimit', label: 'Credit limit', type: 'money', when: mm => mm.type === 'card' },
      { key: 'institution', label: 'Bank / institution', type: 'text' },
      { key: 'accountNumber', label: 'Account number (last 4)', type: 'text', placeholder: '••••1234', hint: 'Never store a full account number' },
      { key: 'color', label: 'Colour', type: 'color', col: 'full' },
      { key: 'notes', label: 'Notes', type: 'text', col: 'full' },
      { key: 'archived', label: 'Archived (hidden from pickers and totals)', type: 'switch', col: 'full' },
    ],
    onSubmit: async v => {
      await store.save('accounts', { ...(a || {}), ...v, balance: undefined, txnCount: undefined, lastActivity: undefined });
      m.close(); toast(a ? 'Account updated' : 'Account created', 'ok'); redraw();
    },
  });
}

/* ---------- reconcile ---------- */
function reconcile(a, redraw) {
  const current = store.accountBalance(a.id);
  const { modal: m } = formModal({
    title: `Reconcile ${a.name}`,
    subtitle: `Cash Checker calculates ${fmtMoney(current)} — enter the real balance from your bank or wallet.`,
    size: '', columns: 1,
    values: { actual: current, date: today() },
    fields: [
      { key: 'actual', label: 'Actual balance', type: 'money', required: true, big: true },
      { key: 'date', label: 'As of', type: 'date', required: true },
      { key: 'note', label: 'Note', type: 'text', value: 'Balance reconciliation' },
    ],
    submitText: 'Create adjustment',
    onSubmit: async v => {
      const diff = money(Number(v.actual) - current);
      if (Math.abs(diff) < 0.005) { m.close(); toast('Already reconciled — no adjustment needed', 'ok'); return; }
      const kind = diff > 0 ? 'income' : 'expense';
      const cat = state.categories.find(c => c.kind === kind && /other/i.test(c.name)) || state.categories.find(c => c.kind === kind);
      await store.save('transactions', { type: kind, amount: Math.abs(diff), currency: settings.baseCurrency, rate: 1,
        accountId: a.id, categoryId: cat?.id, date: v.date, notes: v.note || 'Balance reconciliation',
        status: 'cleared', tags: ['reconciliation'] });
      m.close();
      toast(`Adjustment of ${fmtMoney(diff)} recorded`, 'ok');
      redraw();
    },
  });
}

/* ---------- statement ---------- */
function openAccount(a, redraw) {
  const txns = sortBy(state.transactions.filter(t => t.accountId === a.id || t.toAccountId === a.id), t => t.date, -1);
  const bal = store.accountBalance(a.id);
  const body = h('div', {});

  body.append(h('div', { class: 'card pad', style: { textAlign: 'center', marginBottom: '13px' } },
    h('div', { style: { display: 'grid', placeItems: 'center', marginBottom: '8px' } },
      h('div', { class: 'avatar', style: { width: '48px', height: '48px', fontSize: '1.5rem',
        background: (a.color || '#7c5cff') + '22', color: a.color || '#7c5cff' }, text: store.accEmoji(a) })),
    h('h2', { text: a.name }),
    h('div', { class: 'tiny t3', text: `${(store.ACCOUNT_TYPES.find(t => t[0] === a.type) || [, a.type])[1]}${a.institution ? ` · ${a.institution}` : ''}${a.accountNumber ? ` · ${a.accountNumber}` : ''}` }),
    h('div', { class: `num ${bal < 0 ? 'neg' : ''}`, style: { fontSize: '1.75rem', fontWeight: 750, marginTop: '9px' }, text: fmtMoney(bal) }),
    h('div', { class: 'tiny t3', text: `opening ${fmtMoney(a.openingBalance || 0)} · ${txns.length} transactions` })));

  const inflow = money(txns.filter(t => (t.type === 'income' && t.accountId === a.id) || (t.type === 'transfer' && t.toAccountId === a.id)).reduce((s, t) => s + t.base, 0));
  const outflow = money(txns.filter(t => (t.type === 'expense' && t.accountId === a.id) || (t.type === 'transfer' && t.accountId === a.id)).reduce((s, t) => s + t.base, 0));
  body.append(h('dl', { class: 'kv card pad', style: { marginBottom: '13px' } },
    h('dt', { text: 'Total in' }), h('dd', { class: 'num pos', text: fmtMoney(inflow) }),
    h('dt', { text: 'Total out' }), h('dd', { class: 'num neg', text: fmtMoney(outflow) }),
    h('dt', { text: 'Net movement' }), h('dd', { class: 'num', text: fmtMoney(money(inflow - outflow)) }),
    h('dt', { text: 'Opening balance' }), h('dd', { class: 'num', text: fmtMoney(a.openingBalance || 0) }),
    h('dt', { text: 'Current balance' }), h('dd', { class: 'num', style: { fontWeight: 800 }, text: fmtMoney(bal) })));

  body.append(h('div', { class: 'up', style: { marginBottom: '7px' }, text: 'Recent activity' }));
  if (!txns.length) body.append(empty('No transactions', 'Nothing has moved through this account yet.', 'swap'));
  const list = h('div', { class: 'card' });
  txns.slice(0, 60).forEach(t => {
    const isIn = (t.type === 'income' && t.accountId === a.id) || (t.type === 'transfer' && t.toAccountId === a.id);
    list.append(h('div', { class: 'lst-item', style: { cursor: 'pointer' },
      onClick: () => { s0.close(); openTxnModal(t, { onSaved: redraw }); } },
      h('div', { class: 'lst-main' },
        h('div', { class: 't ell', text: t.notes || store.catName(t.categoryId) || 'Transfer' }),
        h('div', { class: 's', text: `${fmtDate(t.date)} · ${t.type === 'transfer' ? (isIn ? `from ${store.accName(t.accountId)}` : `to ${store.accName(t.toAccountId)}`) : store.catName(t.categoryId)}` })),
      h('div', { class: `lst-amt num ${isIn ? 'pos' : 'neg'}`, text: `${isIn ? '+' : '−'}${fmtMoney(t.base)}` })));
  });
  body.append(list);

  const s0 = sheet({
    title: 'Account statement', body,
    footer: frag(
      h('button', { class: 'btn sm', text: 'Reconcile', onClick: () => { s0.close(); reconcile(a, redraw); } }),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn sm primary', text: 'Edit account', onClick: () => { s0.close(); editAccount(a, redraw); } })),
  });
}
