/* ═══════════ views/investments.js ═══════════ */

import {
  h, frag, icon, card, stat, tag, empty, toast, confirm, modal, formModal, store, state, settings,
  fmtMoney, fmtDate, today, sortBy, pageHead, kpiGrid, confirmDelete, attachmentStrip, relDate, statusTag,
} from './common.js';
import { dataTable, sheet } from '../ui.js';
import { donut, barChart, hBarChart, ring } from '../charts.js';
import { portfolio, investmentMetrics } from '../store.js';
import { money, addMonths, daysBetween, compound, fmtPct, colorFor, uid, monthRange, fmtMonthKey } from '../util.js';

export async function render(root, api) {
  let tab = 'all';
  const draw = () => { root.innerHTML = ''; root.append(build(tab, t => { tab = t; draw(); }, draw, api)); };
  draw();
  return store.bus.on('change', ({ store: s }) => { if (['investments', 'investmentTxns'].includes(s)) draw(); });
}

function build(tab, setTab, redraw, api) {
  const wrap = h('div', {});
  const pf = portfolio();
  const invs = state.investments.map(i => ({ ...i, m: investmentMetrics(i) }));
  api.setSubtitle(`${invs.length} holdings · ${[...pf.byCat.keys()].length} asset classes`);

  wrap.append(pageHead('Investment Manager', 'Every asset class in one portfolio, with ROI, IRR and return schedules calculated for you.',
    h('button', { class: 'btn', html: `${icon('tag', 16)} Categories`, onClick: () => manageCategories(redraw) }),
    h('button', { class: 'btn primary', html: `${icon('plus', 16)} New investment`, onClick: () => editInvestment(null, redraw) })));

  wrap.append(kpiGrid(
    stat({ label: 'Portfolio value', value: fmtMoney(pf.current), icon: 'trend', tone: 'info',
      foot: h('span', { class: 't3', text: `${fmtMoney(pf.invested)} invested` }) }),
    stat({ label: 'Total profit / loss', value: fmtMoney(pf.profit), icon: pf.profit >= 0 ? 'trend' : 'alert',
      tone: pf.profit >= 0 ? 'pos' : 'neg',
      foot: h('span', { class: pf.profit >= 0 ? 'pos' : 'neg', text: `${fmtPct(pf.roiPct)} total ROI` }) }),
    stat({ label: 'Returns collected', value: fmtMoney(pf.returns), icon: 'import', tone: 'pos',
      foot: h('span', { class: 't3', text: 'Dividends, rent and payouts' }) }),
    stat({ label: 'Expected monthly', value: fmtMoney(pf.expMonthly), icon: 'calendar',
      foot: h('span', { class: 't3', text: `${fmtMoney(pf.expAnnual)} per year` }) }),
    stat({ label: 'Active holdings', value: String(invs.filter(i => i.status !== 'closed').length), icon: 'chart',
      foot: h('span', { class: 't3', text: `${invs.filter(i => i.m.profit < 0).length} currently at a loss` }) })));

  const tabsEl = h('div', { class: 'tabs mt' });
  [['all', 'All holdings'], ['byclass', 'By asset class'], ['schedule', 'Return schedule'], ['closed', 'Closed']]
    .forEach(([v, l]) => tabsEl.append(h('button', { class: v === tab ? 'on' : '', text: l, onClick: () => setTab(v) })));
  wrap.append(tabsEl);
  const body = h('div', { class: 'mt' });
  wrap.append(body);

  if (tab === 'byclass') { body.append(byClassPanel(invs, pf)); return wrap; }
  if (tab === 'schedule') { body.append(schedulePanel(invs)); return wrap; }

  const rows = tab === 'closed' ? invs.filter(i => i.status === 'closed') : invs.filter(i => i.status !== 'closed');

  /* charts */
  const alloc = sortBy([...pf.byCat].map(([label, value]) => ({ label, value, color: colorFor(label) })), r => r.value, -1);
  const perf = sortBy(rows, r => r.m.profit, -1);
  body.append(h('div', { class: 'grid', style: { gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.4fr)' } },
    card('Asset allocation', alloc.length ? donut(alloc, { size: 210, centerLabel: 'Portfolio' }) : empty('No holdings', '', 'trend')),
    card('Profit / loss by holding', perf.length
      ? hBarChart({ values: perf.map(r => r.m.profit) }, perf.map(r => r.name),
        { colors: perf.map(r => (r.m.profit >= 0 ? 'var(--pos)' : 'var(--neg)')), width: 620, rowH: 28 })
      : empty('Nothing to compare yet', '', 'chart'))));

  /* table */
  body.append(h('div', { class: 'mt' }, dataTable([
    { key: 'name', label: 'Investment', render: r => h('div', {},
      h('div', { style: { fontWeight: 620 }, text: r.name }),
      h('div', { class: 'tiny t3', text: `${r.category}${r.investor ? ` · ${r.investor}` : ''}` })) },
    { key: 'date', label: 'Started', render: r => h('div', {}, h('div', { text: fmtDate(r.date) }),
      h('div', { class: 'tiny t3', text: `${r.m.years.toFixed(1)} yrs` })) },
    { key: 'invested', label: 'Invested', align: 'right', value: r => r.m.invested,
      render: r => h('span', { class: 'num t2', text: fmtMoney(r.m.invested) }) },
    { key: 'current', label: 'Current value', align: 'right', value: r => r.m.current,
      render: r => h('span', { class: 'num', style: { fontWeight: 650 }, text: fmtMoney(r.m.current) }) },
    { key: 'profit', label: 'P / L', align: 'right', value: r => r.m.profit,
      render: r => h('div', {}, h('div', { class: `num ${r.m.profit >= 0 ? 'pos' : 'neg'}`, style: { fontWeight: 700 },
        text: `${r.m.profit >= 0 ? '+' : ''}${fmtMoney(r.m.profit)}` }),
        h('div', { class: `tiny ${r.m.profit >= 0 ? 'pos' : 'neg'}`, text: fmtPct(r.m.roiPct) })) },
    { key: 'irr', label: 'IRR', align: 'right', value: r => r.m.irr,
      render: r => h('span', { class: 'num tiny t2', text: r.m.irr ? fmtPct(r.m.irr) : '—' }) },
    { key: 'riskLevel', label: 'Risk', render: r => tag(cap(r.riskLevel || 'medium'),
      { low: 'pos', medium: 'info', high: 'warn', speculative: 'neg' }[r.riskLevel] || '') },
    { key: 'maturityDate', label: 'Maturity', render: r => r.maturityDate
      ? h('span', { class: r.maturityDate <= today() ? 'warnc' : '', text: relDate(r.maturityDate) }) : h('span', { class: 't3', text: '—' }) },
  ], {
    rows, exportName: 'investments', pageSize: 15,
    searchFields: ['name', 'category', 'investor'],
    emptyTitle: tab === 'closed' ? 'No closed positions' : 'No investments yet',
    emptyMsg: 'Add real estate, stocks, gold, crypto, a business stake — anything you put money into.',
    emptyIcon: 'trend',
    onRowClick: r => openInvestment(r, redraw),
    actions: r => [
      { label: 'View details', icon: 'eye', onClick: () => openInvestment(r, redraw) },
      { label: 'Add capital', icon: 'plus', onClick: () => addInvTxn(r, 'buy', redraw) },
      { label: 'Record return', icon: 'import', onClick: () => addInvTxn(r, 'return', redraw) },
      { label: 'Update valuation', icon: 'edit', onClick: () => updateValue(r, redraw) },
      '-',
      { label: r.status === 'closed' ? 'Reopen' : 'Close position', icon: 'check', onClick: async () => {
        await store.save('investments', { ...r, m: undefined, status: r.status === 'closed' ? 'active' : 'closed' });
        toast('Status updated', 'ok'); redraw(); } },
      { label: 'Delete', icon: 'trash', danger: true, onClick: async () => {
        if (await confirmDelete(r.name)) { await store.remove('investments', r.id); redraw(); } } },
    ],
    footRow: data => h('tr', {}, h('td', { colspan: 3, class: 'right t3', text: 'Totals' }),
      h('td', { class: 'right num', text: fmtMoney(money(data.reduce((a, r) => a + r.m.invested, 0))) }),
      h('td', { class: 'right num', text: fmtMoney(money(data.reduce((a, r) => a + r.m.current, 0))) }),
      h('td', { class: 'right num', text: fmtMoney(money(data.reduce((a, r) => a + r.m.profit, 0))) }),
      h('td', { colspan: 3 })),
  }).el));

  return wrap;
}
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '');

/* ---------- by class ---------- */
function byClassPanel(invs, pf) {
  const groups = new Map();
  invs.filter(i => i.status !== 'closed').forEach(i => {
    const g = groups.get(i.category) || { invested: 0, current: 0, profit: 0, count: 0, items: [] };
    g.invested += i.m.invested; g.current += i.m.current; g.profit += i.m.profit; g.count++; g.items.push(i);
    groups.set(i.category, g);
  });
  const wrap = h('div', { class: 'grid auto-lg' });
  if (!groups.size) return empty('No holdings to group', '', 'trend');
  sortBy([...groups], g => g[1].current, -1).forEach(([name, g]) => {
    const roi = g.invested ? (g.profit / g.invested) * 100 : 0;
    wrap.append(h('div', { class: 'card pad' },
      h('div', { class: 'row between mb' },
        h('div', {}, h('h3', { text: name }), h('div', { class: 'tiny t3', text: `${g.count} holding${g.count > 1 ? 's' : ''}` })),
        h('span', { class: 'chip', style: { background: colorFor(name) + '22', color: colorFor(name), borderColor: colorFor(name) + '55' },
          text: `${((g.current / (pf.current || 1)) * 100).toFixed(0)}% of portfolio` })),
      h('div', { class: 'row between', style: { marginBottom: '6px' } },
        h('span', { class: 't3 tiny', text: 'Invested' }), h('span', { class: 'num tiny', text: fmtMoney(money(g.invested)) })),
      h('div', { class: 'row between', style: { marginBottom: '6px' } },
        h('span', { class: 't3 tiny', text: 'Current value' }), h('span', { class: 'num', style: { fontWeight: 700 }, text: fmtMoney(money(g.current)) })),
      h('div', { class: 'row between', style: { marginBottom: '9px' } },
        h('span', { class: 't3 tiny', text: 'Profit / loss' }),
        h('span', { class: `num ${g.profit >= 0 ? 'pos' : 'neg'}`, style: { fontWeight: 700 }, text: `${g.profit >= 0 ? '+' : ''}${fmtMoney(money(g.profit))} (${fmtPct(roi)})` })),
      h('div', { class: 'lst', style: { borderTop: '1px solid var(--border)', paddingTop: '6px' } },
        ...sortBy(g.items, i => i.m.current, -1).map(i => h('div', { class: 'row between', style: { padding: '5px 0' } },
          h('span', { class: 'tiny ell', text: i.name }),
          h('span', { class: 'num tiny', text: fmtMoney(i.m.current) }))))));
  });
  return wrap;
}

/* ---------- return schedule ---------- */
function schedulePanel(invs) {
  const active = invs.filter(i => i.status !== 'closed');
  const months = monthRange(today(), addMonths(today(), 11));
  const series = months.map(mk => money(active.reduce((a, i) => a + i.m.expMonthly, 0)));
  const rows = [];
  active.forEach(i => {
    if (i.m.expMonthly > 0) for (let k = 1; k <= 12; k++)
      rows.push({ id: uid('r'), name: i.name, category: i.category, date: addMonths(today(), k), amount: i.m.expMonthly, kind: 'Expected return' });
    if (i.maturityDate) rows.push({ id: uid('r'), name: i.name, category: i.category, date: i.maturityDate, amount: i.m.current, kind: 'Maturity' });
  });
  return h('div', {},
    card('Projected returns — next 12 months', barChart([{ name: 'Expected return', color: 'var(--pos)', values: series }],
      months.map(fmtMonthKey), { height: 230 }), null, { sub: `Based on the expected return % recorded on each holding` }),
    h('div', { class: 'mt' }, dataTable([
      { key: 'date', label: 'Date', render: r => h('div', {}, h('div', { text: fmtDate(r.date) }), h('div', { class: 'tiny t3', text: relDate(r.date) })) },
      { key: 'name', label: 'Investment' },
      { key: 'category', label: 'Class', render: r => tag(r.category, 'acc') },
      { key: 'kind', label: 'Type', render: r => tag(r.kind, r.kind === 'Maturity' ? 'warn' : 'pos') },
      { key: 'amount', label: 'Amount', align: 'right', render: r => h('span', { class: 'num', text: fmtMoney(r.amount) }) },
    ], { rows: sortBy(rows, r => r.date), pageSize: 20, exportName: 'return-schedule',
      emptyTitle: 'No scheduled returns', emptyMsg: 'Set an expected monthly or annual return % on a holding.', emptyIcon: 'calendar' }).el));
}

/* ---------- editor ---------- */
function editInvestment(existing, redraw) {
  const cats = [...new Set([...store.INVESTMENT_CATEGORIES, ...state.investments.map(i => i.category)])].filter(Boolean);
  const { modal: m } = formModal({
    title: existing ? `Edit ${existing.name}` : 'New investment', size: 'wide', columns: 2,
    values: existing || { date: today(), status: 'active', riskLevel: 'medium', investor: 'Self' },
    fields: [
      { key: 'name', label: 'Investment name', type: 'text', required: true, col: 'full', placeholder: 'e.g. Downtown Apartment 3B' },
      { key: 'category', label: 'Category', type: 'select', required: true, options: cats, hint: 'Add your own from the Categories button' },
      { key: 'investor', label: 'Investor name', type: 'text', placeholder: 'Self, partner, company…' },
      { key: 'amountInvested', label: 'Amount invested', type: 'money', required: true },
      { key: 'currentValue', label: 'Current value', type: 'money', hint: 'Leave blank to use the invested amount' },
      { key: 'date', label: 'Investment date', type: 'date', required: true },
      { key: 'maturityDate', label: 'Maturity date', type: 'date' },
      { key: 'dueDate', label: 'Next payout due', type: 'date' },
      { key: 'expMonthlyPct', label: 'Expected monthly return', type: 'percent' },
      { key: 'expAnnualPct', label: 'Expected annual return', type: 'percent' },
      { key: 'riskLevel', label: 'Risk level', type: 'select', options: store.RISK_LEVELS },
      { key: 'status', label: 'Status', type: 'select', options: [['active', 'Active'], ['matured', 'Matured'], ['closed', 'Closed'], ['paused', 'On hold']] },
      { key: 'notes', label: 'Notes', type: 'textarea', col: 'full' },
      { key: 'attachments', label: 'Contracts, photos, documents', type: 'attach', col: 'full' },
    ],
    onSubmit: async v => {
      await store.save('investments', { ...(existing || {}), ...v, m: undefined });
      m.close(); toast(existing ? 'Investment updated' : 'Investment added', 'ok'); redraw();
    },
  });
}

function addInvTxn(inv, type, redraw) {
  const labels = { buy: 'Add capital', return: 'Record a return', sell: 'Record a sale' };
  const { modal: m } = formModal({
    title: labels[type], subtitle: inv.name, size: '', columns: 2,
    values: { date: today() },
    fields: [
      { key: 'amount', label: 'Amount', type: 'money', required: true, big: true, col: 'full' },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'notes', label: 'Note', type: 'text' },
      { key: 'postToTracker', label: 'Also record this in the financial tracker', type: 'switch', value: type === 'return', col: 'full' },
      { key: 'accountId', label: 'Account', type: 'select', options: store.activeAccounts().map(a => [a.id, a.name]),
        when: mm => mm.postToTracker },
    ],
    onSubmit: async v => {
      await store.save('investmentTxns', { investmentId: inv.id, type, amount: Number(v.amount), date: v.date, notes: v.notes });
      if (v.postToTracker && v.accountId) {
        const catName = type === 'return' ? 'Investment Profit' : 'Business';
        const kind = type === 'buy' ? 'expense' : 'income';
        const cat = state.categories.find(c => c.name === catName && c.kind === kind)
          || state.categories.find(c => c.kind === kind);
        await store.save('transactions', { type: kind, amount: Number(v.amount), currency: settings.baseCurrency, rate: 1,
          accountId: v.accountId, categoryId: cat?.id, date: v.date, notes: `${inv.name} — ${labels[type]}`, status: 'cleared', tags: ['investment'] });
      }
      m.close(); toast('Recorded', 'ok'); redraw();
    },
  });
}

function updateValue(inv, redraw) {
  const { modal: m } = formModal({
    title: 'Update valuation', subtitle: `${inv.name} · currently ${fmtMoney(investmentMetrics(inv).current)}`,
    size: 'narrow', columns: 1,
    values: { currentValue: inv.currentValue },
    fields: [{ key: 'currentValue', label: 'New market value', type: 'money', required: true, big: true }],
    onSubmit: async v => {
      await store.save('investments', { ...inv, m: undefined, currentValue: Number(v.currentValue) });
      m.close(); toast('Valuation updated', 'ok'); redraw();
    },
  });
}

/* ---------- detail sheet ---------- */
function openInvestment(inv, redraw) {
  const m = investmentMetrics(inv);
  const txns = sortBy(state.investmentTxns.filter(t => t.investmentId === inv.id), t => t.date, -1);
  const body = h('div', {});

  body.append(h('div', { class: 'card pad', style: { textAlign: 'center', marginBottom: '14px' } },
    h('h2', { text: inv.name }),
    h('div', { class: 'tiny t3', text: `${inv.category} · ${inv.investor || 'Self'}` }),
    h('div', { style: { display: 'grid', placeItems: 'center', margin: '12px 0' } },
      ring(Math.max(0, Math.min(100, 50 + m.roiPct / 2)), { size: 118, thickness: 10,
        value: `${m.roiPct >= 0 ? '+' : ''}${m.roiPct.toFixed(1)}%`, label: 'ROI',
        color: m.profit >= 0 ? 'var(--pos)' : 'var(--neg)' })),
    h('div', { class: 'num', style: { fontSize: '1.55rem', fontWeight: 750 }, text: fmtMoney(m.current) }),
    h('div', { class: `tiny ${m.profit >= 0 ? 'pos' : 'neg'}`, text: `${m.profit >= 0 ? '+' : ''}${fmtMoney(m.profit)} against ${fmtMoney(m.invested)} invested` })));

  body.append(h('dl', { class: 'kv card pad', style: { marginBottom: '14px' } },
    ...[['Invested capital', fmtMoney(m.invested)], ['Current value', fmtMoney(m.current)],
        ['Returns collected', fmtMoney(m.returns)], ['Realised from sales', fmtMoney(m.sold)],
        ['Total ROI', fmtPct(m.roiPct)], ['Annualised return', fmtPct(m.annualised)],
        ['IRR (money-weighted)', m.irr ? fmtPct(m.irr) : '—'],
        ['Expected monthly', fmtMoney(m.expMonthly)], ['Expected annual', fmtMoney(m.expAnnual)],
        ['Holding period', `${m.years.toFixed(2)} years`],
        ['Started', fmtDate(inv.date)], ['Maturity', inv.maturityDate ? fmtDate(inv.maturityDate) : '—'],
        ['Risk level', cap(inv.riskLevel || 'medium')], ['Status', cap(inv.status || 'active')]]
      .flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { class: 'num', text: v })])));

  if (inv.expAnnualPct) {
    const yrs = [1, 3, 5, 10];
    body.append(card('Compound growth projection', h('dl', { class: 'kv' },
      ...yrs.flatMap(y => [h('dt', { text: `In ${y} year${y > 1 ? 's' : ''}` }),
        h('dd', { class: 'num', text: fmtMoney(compound(m.current, Number(inv.expAnnualPct), y)) })])),
      null, { sub: `At ${inv.expAnnualPct}% annually` }));
  }

  if (inv.notes) body.append(h('div', { class: 'card pad mt' }, h('div', { class: 'up mb', text: 'Notes' }), h('p', { class: 'tiny t2', text: inv.notes })));
  if (inv.attachments?.length) body.append(h('div', { class: 'card pad mt' }, h('div', { class: 'up mb', text: 'Documents' }), attachmentStrip(inv.attachments)));

  body.append(h('div', { class: 'up mt', style: { marginBottom: '7px' }, text: 'Activity' }));
  if (!txns.length) body.append(h('p', { class: 'tiny t3', text: 'No capital additions or returns recorded yet.' }));
  txns.forEach(t => body.append(h('div', { class: 'lst-item', style: { padding: '9px 0', borderBottom: '1px solid var(--border)' } },
    h('div', { class: 'lst-main' }, h('div', { class: 't', text: { buy: 'Capital added', return: 'Return received', sell: 'Partial sale', valuation: 'Revaluation' }[t.type] || t.type }),
      h('div', { class: 's', text: `${fmtDate(t.date)}${t.notes ? ` · ${t.notes}` : ''}` })),
    h('div', { class: `lst-amt num ${t.type === 'buy' ? 'neg' : 'pos'}`, text: `${t.type === 'buy' ? '−' : '+'}${fmtMoney(t.amount)}` }),
    h('button', { class: 'icon-btn', html: icon('trash', 14), onClick: async () => {
      if (await confirmDelete('this entry')) { await store.remove('investmentTxns', t.id); s0.close(); redraw(); } } }))));

  const s0 = sheet({
    title: 'Investment detail', body,
    footer: frag(
      h('button', { class: 'btn sm', text: 'Add capital', onClick: () => { s0.close(); addInvTxn(inv, 'buy', redraw); } }),
      h('button', { class: 'btn sm pos', text: 'Record return', onClick: () => { s0.close(); addInvTxn(inv, 'return', redraw); } }),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn sm primary', text: 'Edit', onClick: () => { s0.close(); editInvestment(inv, redraw); } })),
  });
}

/* ---------- categories ---------- */
function manageCategories(redraw) {
  const used = [...new Set(state.investments.map(i => i.category))];
  const all = [...new Set([...store.INVESTMENT_CATEGORIES, ...used])];
  const listEl = h('div', { class: 'row wrap', style: { gap: '7px' } },
    ...all.map(c => tag(`${c} (${state.investments.filter(i => i.category === c).length})`, used.includes(c) ? 'acc' : '')));
  const m = modal({
    title: 'Investment categories',
    subtitle: 'Categories are free text — type a new one on any investment and it appears here automatically.',
    body: frag(listEl, h('p', { class: 'tiny t3 mt', text: 'To rename a category, edit the investments that use it. Unused categories disappear on their own.' })),
    footer: frag(h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onClick: () => m.close() }, 'Done')),
  });
  void redraw;
}
