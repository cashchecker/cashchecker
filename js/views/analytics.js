/* ═══════════ views/analytics.js ═══════════ */

import {
  h, frag, icon, card, stat, tag, empty, toast, modal, store, state, settings,
  fmtMoney, fmtDate, today, sortBy, pageHead, kpiGrid, openTxnModal, amountCell, period, periodSelect,
} from './common.js';
import { dataTable } from '../ui.js';
import { lineChart, barChart, donut, gauge, ring, heatmap, hBarChart, stackedArea } from '../charts.js';
import {
  monthlySeries, dailySeries, categoryBreakdown, txnsIn, incomeIn, expenseIn, netWorth, portfolio,
} from '../store.js';
import {
  healthScore, forecast, anomalies, habits, insights, runwayProjection, monthlyNarrative,
} from '../ai.js';
import {
  money, addMonths, addDays, monthKey, fmtMonthKey, monthRange, dayRange, DOW, colorFor, fmtPct,
  mean, median, stdev, linreg, groupBy, daysBetween, parseISO, startOfYear, endOfMonth,
} from '../util.js';

export async function render(root, api) {
  let tab = 'health';
  const draw = () => { root.innerHTML = ''; root.append(build(tab, t => { tab = t; draw(); }, draw, api)); };
  draw();
  return store.bus.on('change', ({ store: s }) => { if (s === 'transactions') draw(); });
}

const TABS = [['health', 'Financial health'], ['trends', 'Trends'], ['habits', 'Spending habits'],
  ['forecast', 'Forecast'], ['anomalies', 'Anomaly detection'], ['compare', 'Period comparison']];

function build(tab, setTab, redraw, api) {
  const wrap = h('div', {});
  api.setSubtitle((TABS.find(t => t[0] === tab) || [, ''])[1]);
  wrap.append(pageHead('Analytics', 'Deep analysis of your money — all computed on this device, nothing sent anywhere.'));

  const tabsEl = h('div', { class: 'tabs mb' });
  TABS.forEach(([v, l]) => tabsEl.append(h('button', { class: v === tab ? 'on' : '', text: l, onClick: () => setTab(v) })));
  wrap.append(tabsEl);

  wrap.append(({ health: healthPanel, trends: trendsPanel, habits: habitsPanel,
    forecast: forecastPanel, anomalies: anomalyPanel, compare: comparePanel }[tab])(api, redraw));
  return wrap;
}

/* ═══════════ health ═══════════ */
function healthPanel(api) {
  const hs = healthScore();
  const wrap = h('div', {});

  wrap.append(h('div', { class: 'grid', style: { gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.6fr)' } },
    h('div', { class: 'card pad', style: { textAlign: 'center' } },
      gauge(hs.score, { label: 'out of 100', size: 250 }),
      h('div', { class: `tag ${hs.score >= 70 ? 'pos' : hs.score >= 55 ? 'warn' : 'neg'}`, style: { fontSize: '.85rem', padding: '3px 12px' }, text: hs.grade }),
      h('p', { class: 'tiny t3 mt', style: { maxWidth: '280px', margin: '10px auto 0' },
        text: 'A weighted composite of savings rate, emergency cover, debt load, budget discipline, spending stability and net-worth trajectory.' })),
    card('Score breakdown', h('div', { class: 'col' }, ...sortBy(hs.pillars, p => p.score).map(p =>
      h('div', {},
        h('div', { class: 'row between', style: { marginBottom: '5px' } },
          h('span', { style: { fontWeight: 620, fontSize: '.87rem' } }, p.label,
            h('span', { class: 't3 tiny', style: { fontWeight: 400 }, text: ` · ${Math.round(p.weight * 100)}% weight` })),
          h('span', { class: `num ${p.score >= 70 ? 'pos' : p.score >= 45 ? 'warnc' : 'neg'}`, style: { fontWeight: 700 }, text: `${p.score}` })),
        h('div', { class: 'bar' }, h('i', { class: p.score >= 70 ? 'pos' : p.score >= 45 ? 'warn' : 'neg', style: { width: `${p.score}%` } })),
        h('div', { class: 'tiny t3', style: { marginTop: '4px' }, text: p.detail })))))));

  wrap.append(kpiGrid(
    stat({ label: 'Average monthly income', value: fmtMoney(hs.avgIncome), icon: 'trend', tone: 'pos' }),
    stat({ label: 'Average monthly expense', value: fmtMoney(hs.avgExpense), icon: 'swap', tone: 'neg' }),
    stat({ label: 'Savings rate', value: `${hs.savingsRate.toFixed(1)}%`, icon: 'target',
      tone: hs.savingsRate >= 20 ? 'pos' : hs.savingsRate > 0 ? 'warn' : 'neg' }),
    stat({ label: 'Emergency cover', value: `${hs.monthsCover.toFixed(1)} months`, icon: 'shield',
      tone: hs.monthsCover >= 6 ? 'pos' : hs.monthsCover >= 3 ? 'warn' : 'neg' }),
    stat({ label: 'Liquid reserves', value: fmtMoney(hs.liquid), icon: 'bank', tone: 'info' }),
    stat({ label: 'Net worth', value: fmtMoney(hs.netWorth.total), icon: 'wallet',
      tone: hs.netWorth.total >= 0 ? 'pos' : 'neg' })));

  const rows = insights({ limit: 10 });
  wrap.append(h('div', { class: 'mt' }, card('Recommendations', rows.length
    ? h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))' } },
      ...rows.map(r => h('div', { class: `insight ${r.level === 'neg' ? 'neg' : r.level === 'warn' ? 'warn' : r.level === 'pos' ? 'pos' : ''}` },
        h('div', { class: 'ic', html: icon(r.level === 'pos' ? 'check' : 'sparkle', 15) }),
        h('div', { class: 'tt' }, h('b', { text: r.title }), h('p', { text: r.body }),
          r.action ? h('button', { class: 'btn xs mt-sm', text: r.action.label,
            onClick: () => api.navigate(r.action.route.replace('#/', '')) }) : null))))
    : empty('Nothing to flag', 'Your finances look steady across every rule we check.', 'check'))));

  return wrap;
}

/* ═══════════ trends ═══════════ */
function trendsPanel() {
  const wrap = h('div', {});
  const months = monthlySeries(24);
  const keys = months.map(m => fmtMonthKey(m.key));
  const savings = months.map(m => (m.income ? ((m.income - m.expense) / m.income) * 100 : 0));
  const lr = linreg(months.map(m => m.expense));
  const cats = [...new Set(state.transactions.filter(t => t.type === 'expense').map(t => t.categoryId))];
  const topCats = sortBy(cats.map(cid => ({
    cid, total: money(state.transactions.filter(t => t.categoryId === cid && t.type === 'expense').reduce((a, t) => a + t.base, 0)),
  })), c => c.total, -1).slice(0, 6);
  const catSeries = topCats.map(c => ({
    name: store.catName(c.cid), color: store.catColor(c.cid),
    values: months.map(m => money(state.transactions.filter(t => t.month === m.key && t.categoryId === c.cid).reduce((a, t) => a + t.base, 0))),
  }));

  wrap.append(kpiGrid(
    stat({ label: 'Expense trend', value: `${lr.slope >= 0 ? '+' : ''}${fmtMoney(lr.slope)}/mo`, icon: 'chart',
      tone: lr.slope > 0 ? 'neg' : 'pos', foot: h('span', { class: 't3', text: `R² ${lr.r2.toFixed(2)} — ${lr.r2 > 0.5 ? 'consistent' : 'noisy'} trend` }) }),
    stat({ label: 'Best savings month', value: fmtMonthKey(months[savings.indexOf(Math.max(...savings))]?.key || months[0].key), icon: 'flame', tone: 'pos',
      foot: h('span', { class: 't3', text: `${Math.max(...savings).toFixed(1)}% saved` }) }),
    stat({ label: 'Average savings rate', value: `${mean(savings).toFixed(1)}%`, icon: 'target' }),
    stat({ label: 'Expense volatility', value: fmtMoney(stdev(months.map(m => m.expense))), icon: 'alert', tone: 'warn',
      foot: h('span', { class: 't3', text: 'Standard deviation across 24 months' }) })));

  wrap.append(h('div', { class: 'grid mt' },
    card('Income, expense and net — 24 months', lineChart([
      { name: 'Income', color: 'var(--pos)', values: months.map(m => m.income), area: false },
      { name: 'Expense', color: 'var(--neg)', values: months.map(m => m.expense), area: false },
      { name: 'Net', color: 'var(--accent)', values: months.map(m => m.net), area: false, dashed: true },
    ], keys, { height: 280 }))));

  wrap.append(h('div', { class: 'grid mt', style: { gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)' } },
    card('Category spend over time', catSeries.length ? stackedArea(catSeries, keys, { height: 260 }) : empty('No data', '', 'chart')),
    card('Savings rate trend', lineChart([{ name: 'Savings rate %', color: 'var(--accent-2)', values: savings }],
      keys, { height: 260, fmt: v => `${v.toFixed(1)}%`, hLine: 20 }), null, { sub: 'Dashed line marks a 20% target' })));

  /* year on year */
  const years = [...new Set(state.transactions.map(t => t.date.slice(0, 4)))].sort();
  if (years.length > 1) {
    const yoy = years.map(y => ({
      id: y, year: y,
      income: incomeIn(`${y}-01-01`, `${y}-12-31`),
      expense: expenseIn(`${y}-01-01`, `${y}-12-31`),
    })).map(r => ({ ...r, net: money(r.income - r.expense), rate: r.income ? ((r.income - r.expense) / r.income) * 100 : 0 }));
    wrap.append(h('div', { class: 'mt' }, card('Year on year', dataTable([
      { key: 'year', label: 'Year' },
      { key: 'income', label: 'Income', align: 'right', render: r => h('span', { class: 'num pos', text: fmtMoney(r.income) }) },
      { key: 'expense', label: 'Expense', align: 'right', render: r => h('span', { class: 'num neg', text: fmtMoney(r.expense) }) },
      { key: 'net', label: 'Net', align: 'right', render: r => h('span', { class: `num ${r.net >= 0 ? 'pos' : 'neg'}`, style: { fontWeight: 650 }, text: fmtMoney(r.net) }) },
      { key: 'rate', label: 'Savings rate', align: 'right', render: r => h('span', { class: 'num', text: fmtPct(r.rate) }) },
    ], { rows: yoy, searchable: false, pageSize: 12, exportName: 'year-on-year' }).el, null, { flush: true })));
  }
  return wrap;
}

/* ═══════════ habits ═══════════ */
function habitsPanel() {
  const hb = habits({ months: 6 });
  const wrap = h('div', {});
  const dows = DOW.map((d, i) => ({ label: d, value: hb.byDow[i], color: i === hb.topDow ? 'var(--neg)' : 'var(--accent)' }));

  wrap.append(kpiGrid(
    stat({ label: 'Average transaction', value: fmtMoney(hb.avgTxn), icon: 'swap',
      foot: h('span', { class: 't3', text: `${hb.txnCount} expenses in 6 months` }) }),
    stat({ label: 'Average per day', value: fmtMoney(hb.perDay), icon: 'calendar', tone: 'info' }),
    stat({ label: 'Heaviest spending day', value: DOW[hb.topDow], icon: 'flame', tone: 'warn',
      foot: h('span', { class: 't3', text: `${fmtMoney(hb.byDow[hb.topDow])} over 6 months` }) }),
    stat({ label: 'Small purchases', value: fmtMoney(hb.smallSpendTotal), icon: 'alert',
      foot: h('span', { class: 't3', text: `${hb.smallSpendCount} purchases under ${fmtMoney(hb.avgTxn * 0.35)}` }) })));

  wrap.append(h('div', { class: 'grid mt', style: { gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' } },
    card('Spending by day of week', barChart([{ name: 'Spend', color: 'var(--accent)', values: dows.map(d => d.value) }],
      dows.map(d => d.label), { height: 230 })),
    card('Spending by day of month', barChart([{ name: 'Spend', color: 'var(--accent-2)', values: hb.byDom }],
      hb.byDom.map((_, i) => String(i + 1)), { height: 230 }), null, { sub: 'Reveals payday and bill-day clustering' })));

  /* heatmap of last 52 weeks */
  const start = addDays(today(), -363);
  const days = dayRange(start, today());
  const byDay = new Map();
  state.transactions.filter(t => t.type === 'expense' && t.date >= start)
    .forEach(t => byDay.set(t.date, money((byDay.get(t.date) || 0) + t.base)));
  const cells = days.map(d => ({ key: d, value: byDay.get(d) || 0, label: fmtDate(d, 'long') }));

  wrap.append(h('div', { class: 'mt' }, card('Daily spending intensity — last 12 months',
    heatmap(cells, { cols: 53, cell: 12, gap: 3 }), null, { sub: 'Darker squares are heavier spending days' })));

  wrap.append(h('div', { class: 'grid mt', style: { gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' } },
    card('Top merchants', hb.topMerchants.length ? h('div', { class: 'lst' }, ...hb.topMerchants.map((m, i) =>
      h('div', { class: 'lst-item' },
        h('div', { class: 'avatar', style: { background: colorFor(m.label, i) + '22', color: colorFor(m.label, i) }, text: String(i + 1) }),
        h('div', { class: 'lst-main' }, h('div', { class: 't ell', text: m.label }),
          h('div', { class: 's', text: `${m.count} transactions · ${fmtMoney(money(m.total / m.count))} average` })),
        h('div', { class: 'lst-amt num', text: fmtMoney(m.total) })))) : empty('No merchant data', 'Add merchant names to transactions to see this.', 'user'), null, { flush: true }),
    card('Category concentration', (() => {
      const cats = categoryBreakdown(addMonths(today(), -6), today(), 'expense');
      const total = money(cats.reduce((a, c) => a + c.value, 0));
      const top3 = money(cats.slice(0, 3).reduce((a, c) => a + c.value, 0));
      return h('div', {},
        h('div', { style: { display: 'grid', placeItems: 'center', marginBottom: '12px' } },
          ring(total ? (top3 / total) * 100 : 0, { size: 130, thickness: 12, label: 'in top 3 categories' })),
        h('p', { class: 'tiny t2', style: { textAlign: 'center' },
          text: total ? `${fmtMoney(top3)} of ${fmtMoney(total)} — your three largest categories are ${cats.slice(0, 3).map(c => c.label).join(', ')}.` : 'No expenses yet.' }));
    })())));
  return wrap;
}

/* ═══════════ forecast ═══════════ */
function forecastPanel() {
  const wrap = h('div', {});
  const fc = forecast(12);
  const rw = runwayProjection(180);
  const hist = monthlySeries(12);
  const allKeys = [...hist.map(m => fmtMonthKey(m.key)), ...fc.months.map(m => fmtMonthKey(m.key))];
  const histLen = hist.length;
  const incSeries = [...hist.map(m => m.income), ...fc.months.map(m => m.income)];
  const expSeries = [...hist.map(m => m.expense), ...fc.months.map(m => m.expense)];

  wrap.append(kpiGrid(
    stat({ label: 'Projected 12-month income', value: fmtMoney(money(fc.months.reduce((a, m) => a + m.income, 0))), icon: 'trend', tone: 'pos' }),
    stat({ label: 'Projected 12-month expense', value: fmtMoney(money(fc.months.reduce((a, m) => a + m.expense, 0))), icon: 'swap', tone: 'neg' }),
    stat({ label: 'Projected surplus', value: fmtMoney(money(fc.months.reduce((a, m) => a + m.net, 0))), icon: 'wallet',
      tone: fc.months.reduce((a, m) => a + m.net, 0) >= 0 ? 'pos' : 'neg' }),
    stat({ label: 'Model confidence', value: `${fc.confidence}%`, icon: 'sparkle', tone: fc.confidence >= 60 ? 'pos' : 'warn',
      foot: h('span', { class: 't3', text: `± ${fmtMoney(fc.volatility)} monthly variance` }) })));

  wrap.append(h('div', { class: 'mt' }, card('History and projection',
    lineChart([
      { name: 'Income', color: 'var(--pos)', values: incSeries },
      { name: 'Expense', color: 'var(--neg)', values: expSeries },
    ], allKeys, { height: 290 }),
    null, { sub: `First ${histLen} points are actuals; the remainder is projected from trend, exponential smoothing and committed outflows.` })));

  wrap.append(h('div', { class: 'grid mt', style: { gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)' } },
    card('180-day balance projection', lineChart([{ name: 'Balance', color: rw.zeroDate ? 'var(--warn)' : 'var(--accent)', values: rw.series.map(s => s.value) }],
      rw.series.map(s => fmtDate(s.key, 'short')), { height: 250, hLine: 0, showDots: false }),
      null, { sub: rw.zeroDate ? `⚠ Projected to reach zero on ${fmtDate(rw.zeroDate)}` : 'No shortfall projected in the next 6 months' }),
    card('Month-by-month projection', h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, h('th', { class: 'no-sort' }, 'Month'), h('th', { class: 'no-sort right' }, 'In'),
        h('th', { class: 'no-sort right' }, 'Out'), h('th', { class: 'no-sort right' }, 'Net'))),
      h('tbody', {}, ...fc.months.map(m => h('tr', {},
        h('td', {}, fmtMonthKey(m.key)),
        h('td', { class: 'right num pos' }, fmtMoney(m.income)),
        h('td', { class: 'right num neg' }, fmtMoney(m.expense)),
        h('td', { class: `right num ${m.net >= 0 ? 'pos' : 'neg'}` }, fmtMoney(m.net))))))))));
  return wrap;
}

/* ═══════════ anomalies ═══════════ */
function anomalyPanel(api, redraw) {
  const rows = anomalies({ limit: 40 });
  const wrap = h('div', {});
  wrap.append(h('div', { class: 'insight mb' },
    h('div', { class: 'ic', html: icon('shield', 15) }),
    h('div', { class: 'tt' }, h('b', { text: 'How detection works' }),
      h('p', { text: 'Each category is scored with a modified z-score built on the median and median absolute deviation — a robust method that is not skewed by the very outliers it is looking for. Duplicate charges are flagged when an identical amount hits the same category within three days.' }))));

  wrap.append(kpiGrid(
    stat({ label: 'Flags raised', value: String(rows.length), icon: 'alert', tone: rows.length ? 'warn' : 'pos' }),
    stat({ label: 'Possible duplicates', value: String(rows.filter(r => r.duplicate).length), icon: 'copy', tone: 'neg' }),
    stat({ label: 'Value under review', value: fmtMoney(money(rows.reduce((a, r) => a + r.txn.base, 0))), icon: 'wallet' }),
    stat({ label: 'Categories scanned', value: String(new Set(state.transactions.filter(t => t.type === 'expense').map(t => t.categoryId)).size), icon: 'tag', tone: 'info' })));

  if (!rows.length) { wrap.append(h('div', { class: 'mt' }, empty('Nothing unusual', 'Every transaction sits within the normal range for its category.', 'check'))); return wrap; }

  wrap.append(h('div', { class: 'mt' }, dataTable([
    { key: 'date', label: 'Date', value: r => r.txn.date, render: r => fmtDate(r.txn.date) },
    { key: 'desc', label: 'Transaction', value: r => r.txn.notes || '',
      render: r => h('div', {}, h('b', { text: r.txn.notes || store.catName(r.txn.categoryId) }),
        h('div', { class: 'tiny t3', text: `${store.catName(r.txn.categoryId)} · ${store.accName(r.txn.accountId)}` })) },
    { key: 'flag', label: 'Flag', value: r => (r.duplicate ? 'Duplicate' : 'Outlier'),
      render: r => tag(r.duplicate ? 'Possible duplicate' : `Outlier · z=${r.z}`, r.duplicate ? 'neg' : 'warn') },
    { key: 'reason', label: 'Why it was flagged', render: r => h('span', { class: 'tiny t2', text: r.reason }) },
    { key: 'amount', label: 'Amount', align: 'right', value: r => r.txn.base,
      render: r => h('span', { class: 'num neg', style: { fontWeight: 650 }, text: fmtMoney(r.txn.base) }) },
  ], {
    rows, pageSize: 20, exportName: 'anomalies', searchable: false,
    onRowClick: r => openTxnModal(r.txn, { onSaved: redraw }),
    actions: r => [
      { label: 'Review transaction', icon: 'eye', onClick: () => openTxnModal(r.txn, { onSaved: redraw }) },
      { label: 'Mark as reviewed', icon: 'check', onClick: async () => {
        await store.save('transactions', { ...r.txn, tags: [...new Set([...(r.txn.tags || []), 'reviewed'])] });
        toast('Marked as reviewed', 'ok'); redraw(); } },
    ],
  }).el));
  return wrap;
}

/* ═══════════ compare ═══════════ */
function comparePanel() {
  const wrap = h('div', {});
  let a = 'month', b = 'lastmonth';
  const out = h('div', {});
  const draw = () => {
    const pa = period(a), pb = period(b);
    const ia = incomeIn(pa.from, pa.to), ea = expenseIn(pa.from, pa.to);
    const ib = incomeIn(pb.from, pb.to), eb = expenseIn(pb.from, pb.to);
    const ca = categoryBreakdown(pa.from, pa.to, 'expense');
    const cb = categoryBreakdown(pb.from, pb.to, 'expense');
    const allCats = [...new Set([...ca.map(c => c.id), ...cb.map(c => c.id)])];
    const rows = allCats.map(id => {
      const va = ca.find(c => c.id === id)?.value || 0;
      const vb = cb.find(c => c.id === id)?.value || 0;
      return { id, label: store.catName(id), a: va, b: vb, delta: money(va - vb),
        pct: vb ? ((va - vb) / vb) * 100 : (va ? 100 : 0), color: store.catColor(id) };
    });

    out.innerHTML = '';
    out.append(kpiGrid(
      stat({ label: `Income · ${pa.label}`, value: fmtMoney(ia), icon: 'trend', tone: 'pos',
        foot: h('span', { class: ia >= ib ? 'pos' : 'neg', text: `${ib ? (((ia - ib) / ib) * 100).toFixed(1) : '—'}% vs ${pb.label}` }) }),
      stat({ label: `Expense · ${pa.label}`, value: fmtMoney(ea), icon: 'swap', tone: 'neg',
        foot: h('span', { class: ea <= eb ? 'pos' : 'neg', text: `${eb ? (((ea - eb) / eb) * 100).toFixed(1) : '—'}% vs ${pb.label}` }) }),
      stat({ label: `Net · ${pa.label}`, value: fmtMoney(ia - ea), icon: 'wallet', tone: ia - ea >= 0 ? 'pos' : 'neg',
        foot: h('span', { class: 't3', text: `${fmtMoney(ib - eb)} in ${pb.label}` }) }),
      stat({ label: 'Biggest increase', value: sortBy(rows, r => r.delta, -1)[0]?.label || '—', icon: 'alert', tone: 'warn',
        foot: h('span', { class: 'neg', text: sortBy(rows, r => r.delta, -1)[0] ? `+${fmtMoney(sortBy(rows, r => r.delta, -1)[0].delta)}` : '' }) })));

    out.append(h('div', { class: 'grid mt' }, card('Category comparison', barChart([
      { name: pa.label, color: 'var(--accent)', values: rows.map(r => r.a) },
      { name: pb.label, color: 'var(--text-3)', values: rows.map(r => r.b) },
    ], rows.map(r => r.label), { height: 270 }))));

    out.append(h('div', { class: 'mt' }, dataTable([
      { key: 'label', label: 'Category', render: r => h('span', { class: 'row', style: { gap: '7px' } },
        h('span', { style: { width: '9px', height: '9px', borderRadius: '3px', background: r.color, flex: 'none' } }), r.label) },
      { key: 'a', label: pa.label, align: 'right', render: r => h('span', { class: 'num', text: fmtMoney(r.a) }) },
      { key: 'b', label: pb.label, align: 'right', render: r => h('span', { class: 'num t2', text: fmtMoney(r.b) }) },
      { key: 'delta', label: 'Change', align: 'right', render: r => h('span', { class: `num ${r.delta > 0 ? 'neg' : r.delta < 0 ? 'pos' : 't3'}`,
        style: { fontWeight: 650 }, text: `${r.delta > 0 ? '+' : ''}${fmtMoney(r.delta)}` }) },
      { key: 'pct', label: '%', align: 'right', render: r => h('span', { class: `num tiny ${r.pct > 0 ? 'neg' : r.pct < 0 ? 'pos' : 't3'}`,
        text: `${r.pct > 0 ? '+' : ''}${r.pct.toFixed(0)}%` }) },
    ], { rows: sortBy(rows, r => Math.abs(r.delta), -1), pageSize: 20, exportName: 'period-comparison', searchable: false }).el));
  };

  // Two dropdowns instead of two rows of chips — the pair now reads as one
  // sentence ("compare X against Y") and fits on a phone without scrolling.
  const bar = h('div', { class: 'card pad mb', style: { display: 'flex', gap: '9px', flexWrap: 'wrap', alignItems: 'center' } },
    h('span', { class: 'up', text: 'Compare' }),
    periodSelect(a, k => { a = k; draw(); }),
    h('span', { class: 'up', text: 'Against' }),
    periodSelect(b, k => { b = k; draw(); }));

  wrap.append(bar, out);
  draw();
  return wrap;
}
