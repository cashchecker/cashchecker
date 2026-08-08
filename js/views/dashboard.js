/* ═══════════ views/dashboard.js ═══════════ */

import {
  h, frag, icon, card, stat, bar, tag, empty, toast, store, state, settings,
  fmtMoney, fmtDate, today, sortBy, period, PERIODS, pageHead, kpiGrid, openTxnModal, amountCell,
  catChip, relDate, periodPicker, avatar,
} from './common.js';
import { lineChart, barChart, donut, sparkline, ring, gauge, hBarChart } from '../charts.js';
import { healthScore, insights, forecast, runwayProjection } from '../ai.js';
import {
  monthlySeries, dailySeries, categoryBreakdown, netWorth, creditTotals, portfolio, loanTotals,
  incomeIn, expenseIn, txnsIn, billsDue, budgetStatus, goalStatus,
} from '../store.js';
import { addMonths, monthKey, fmtMonthKey, pctChange, money, addDays, daysBetween, mean } from '../util.js';

export async function render(root, api) {
  let per = sessionStorage.getItem('dash.period') || 'month';
  const draw = () => {
    root.innerHTML = '';
    root.append(build(per, p => { per = p; sessionStorage.setItem('dash.period', p); draw(); }, api));
  };
  draw();
  const off = store.bus.on('change', ({ store: s }) => {
    if (['transactions', 'accounts', 'bills', 'budgets', 'goals', 'investments', 'credits'].includes(s)) draw();
  });
  return off;
}

function build(per, setPer, api) {
  const p = period(per);
  const prevLen = daysBetween(p.from, p.to) + 1;
  const prev = { from: addDays(p.from, -prevLen), to: addDays(p.from, -1) };
  const wrap = h('div', {});

  const inc = incomeIn(p.from, p.to), exp = expenseIn(p.from, p.to);
  const pInc = incomeIn(prev.from, prev.to), pExp = expenseIn(prev.from, prev.to);
  const net = money(inc - exp);
  const nw = netWorth();
  const credit = creditTotals();
  const pf = portfolio();
  const loans = loanTotals();
  const hs = healthScore();
  const months = monthlySeries(12);
  const savingsRate = inc ? (net / inc) * 100 : 0;

  api.setSubtitle(`${p.label} · ${fmtDate(p.from)} → ${fmtDate(p.to)}`);

  /* ---------- header ---------- */
  wrap.append(pageHead(
    greeting(), `Here is where your money stands ${p.label.toLowerCase()}.`,
    periodPicker(per, setPer),
    h('button', { class: 'btn primary', html: `${icon('plus', 16)} New transaction`, onClick: () => openTxnModal() })));

  /* ---------- hero: net worth + health ---------- */
  const heroSeries = months.map(m => m.net);
  // Class, not an inline grid-template: inline styles cannot be overridden by a
  // media query, which is why this used to force the gauge off a phone screen.
  wrap.append(h('div', { class: 'grid hero-split', style: { marginBottom: '16px' } },
    h('div', { class: 'hero' }, h('div', { class: 'rel' },
      h('div', { class: 'row wrap between' },
        h('div', {},
          h('div', { class: 'up', text: 'Total net worth' }),
          h('div', { class: 'num', style: { fontSize: '2.15rem', fontWeight: 750, letterSpacing: '-.04em', marginTop: '2px' },
            text: fmtMoney(nw.total) }),
          h('div', { class: 'row', style: { gap: '14px', marginTop: '8px', flexWrap: 'wrap' } },
            miniStat('Assets', fmtMoney(nw.assets), 'pos'),
            miniStat('Liabilities', fmtMoney(nw.liabilities), 'neg'),
            miniStat('Liquid cash', fmtMoney(nw.cash)),
            miniStat('Portfolio', fmtMoney(nw.investments)))),
        h('div', { style: { minWidth: '150px' }, html: sparkline(heroSeries, { width: 200, height: 62, color: 'var(--accent)' }) })))),
    h('div', { class: 'card pad', style: { display: 'grid', placeItems: 'center', textAlign: 'center' } },
      gauge(hs.score, { label: 'Financial health', size: 190 }),
      h('div', { class: 'tag ' + (hs.score >= 70 ? 'pos' : hs.score >= 55 ? 'warn' : 'neg'), text: hs.grade }),
      h('button', { class: 'btn sm ghost mt-sm', onClick: () => api.navigate('analytics'), text: 'See breakdown →' }))));

  /* ---------- KPI tiles ---------- */
  const daily = dailySeries(p.from, p.to);
  wrap.append(kpiGrid(
    stat({ label: 'Total income', value: fmtMoney(inc), icon: 'trend', tone: 'pos',
      foot: deltaText(pctChange(inc, pInc), 'vs previous period'),
      spark: sparkline(daily.map(d => d.income), { color: 'var(--pos)', height: 30 }) }),
    stat({ label: 'Total expense', value: fmtMoney(exp), icon: 'swap', tone: 'neg',
      foot: deltaText(pctChange(exp, pExp), 'vs previous period', true),
      spark: sparkline(daily.map(d => d.expense), { color: 'var(--neg)', height: 30 }) }),
    stat({ label: net >= 0 ? 'Net savings' : 'Net shortfall', value: fmtMoney(net), icon: 'wallet',
      tone: net >= 0 ? 'pos' : 'neg', foot: h('span', { class: 't3', text: `${savingsRate.toFixed(1)}% savings rate` }) }),
    stat({ label: 'Cash on hand', value: fmtMoney(nw.cash), icon: 'bank', tone: 'info',
      foot: h('span', { class: 't3', text: `${state.accounts.filter(a => !a.archived).length} accounts` }),
      onClick: () => api.navigate('accounts') }),
    stat({ label: 'Investment value', value: fmtMoney(pf.current), icon: 'trend', tone: pf.profit >= 0 ? 'pos' : 'neg',
      foot: h('span', { class: pf.profit >= 0 ? 'pos' : 'neg', text: `${pf.profit >= 0 ? '+' : ''}${fmtMoney(pf.profit)} (${pf.roiPct.toFixed(1)}% ROI)` }),
      onClick: () => api.navigate('investments') }),
    stat({ label: 'Receivables', value: fmtMoney(credit.receivable), icon: 'book',
      tone: credit.overdueCount ? 'warn' : '',
      foot: h('span', { class: credit.overdueCount ? 'warnc' : 't3', text: credit.overdueCount ? `${credit.overdueCount} overdue · ${fmtMoney(credit.overdue)}` : 'All current' }),
      onClick: () => api.navigate('credit') }),
    stat({ label: 'Loan balance', value: fmtMoney(loans.outstanding), icon: 'bank', tone: loans.outstanding ? 'warn' : '',
      foot: h('span', { class: 't3', text: loans.count ? `${fmtMoney(loans.monthly)}/mo across ${loans.count}` : 'No active loans' }),
      onClick: () => api.navigate('loans') }),
    stat({ label: 'Upcoming bills', value: String(billsDue({ within: 14 }).length), icon: 'clock', tone: 'warn',
      foot: h('span', { class: 't3', text: `${fmtMoney(billsDue({ within: 14 }).reduce((a, b) => a + Number(b.amount || 0), 0))} in 14 days` }),
      onClick: () => api.navigate('bills') })));

  /* ---------- charts row ---------- */
  const cats = categoryBreakdown(p.from, p.to, 'expense', { rollUp: true });
  wrap.append(h('div', { class: 'grid mt', style: { gridTemplateColumns: 'minmax(0,1.7fr) minmax(0,1fr)' } },
    card('Income vs expense', barChart([
      { name: 'Income', color: 'var(--pos)', values: months.map(m => m.income) },
      { name: 'Expense', color: 'var(--neg)', values: months.map(m => m.expense) },
    ], months.map(m => fmtMonthKey(m.key)), { height: 270 }), null, { sub: 'Last 12 months' }),
    card('Spending by category', cats.length
      ? donut(cats, { centerLabel: 'Total spend', size: 210 })
      : empty('No expenses yet', 'Log a few transactions to see the breakdown.', 'tag'), null, { sub: p.label })));

  /* ---------- cash flow + insights ---------- */
  wrap.append(h('div', { class: 'grid mt', style: { gridTemplateColumns: 'minmax(0,1.7fr) minmax(0,1fr)' } },
    card('Cash flow trend', lineChart([
      { name: 'Net flow', color: 'var(--accent)', values: months.map(m => m.net) },
    ], months.map(m => fmtMonthKey(m.key)), { height: 250, hLine: 0 }), null, { sub: 'Monthly surplus / deficit' }),
    card('Smart insights', insightList(api), null, { sub: 'Generated on-device' })));

  /* ---------- forecast + runway ---------- */
  const fc = forecast(6);
  const rw = runwayProjection(90);
  wrap.append(h('div', { class: 'grid mt', style: { gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' } },
    card('6-month forecast', frag(
      lineChart([
        { name: 'Projected income', color: 'var(--pos)', values: fc.months.map(m => m.income) },
        { name: 'Projected expense', color: 'var(--neg)', values: fc.months.map(m => m.expense) },
      ], fc.months.map(m => fmtMonthKey(m.key)), { height: 210 }),
      h('div', { class: 'row wrap mt-sm', style: { gap: '14px' } },
        miniStat('Avg projected surplus', fmtMoney(mean(fc.months.map(m => m.net))), mean(fc.months.map(m => m.net)) >= 0 ? 'pos' : 'neg'),
        miniStat('Model confidence', `${fc.confidence}%`),
        miniStat('Committed monthly', fmtMoney(scheduled())))),
      null, { sub: 'Trend blend + committed outflows' }),
    card('90-day cash runway', frag(
      lineChart([{ name: 'Projected balance', color: rw.zeroDate ? 'var(--warn)' : 'var(--accent)', values: rw.series.map(s => s.value) }],
        rw.series.map(s => fmtDate(s.key, 'short')), { height: 210, hLine: 0 }),
      h('div', { class: 'row wrap mt-sm', style: { gap: '14px' } },
        miniStat('Starting liquid', fmtMoney(rw.start)),
        miniStat('Net burn / day', fmtMoney(rw.burn), rw.burn > 0 ? 'neg' : 'pos'),
        miniStat('Runway', rw.runwayDays === Infinity ? 'Cash-flow positive' : `${rw.runwayDays} days`,
          rw.runwayDays === Infinity ? 'pos' : rw.runwayDays < 60 ? 'neg' : ''))),
      null, { sub: rw.zeroDate ? `Projected to hit zero on ${fmtDate(rw.zeroDate)}` : 'No shortfall projected' })));

  /* ---------- lower grid ---------- */
  wrap.append(h('div', { class: 'grid mt', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))' } },
    card('Recent transactions', recentList(api), h('button', { class: 'btn sm ghost', onClick: () => api.navigate('tracker') }, 'View all'), { flush: true }),
    card('Upcoming & overdue', upcomingList(api), h('button', { class: 'btn sm ghost', onClick: () => api.navigate('bills') }, 'Bills'), { flush: true }),
    card('Budget status', budgetList(api), h('button', { class: 'btn sm ghost', onClick: () => api.navigate('budget') }, 'Manage'), { flush: true }),
    card('Savings goals', goalList(api), h('button', { class: 'btn sm ghost', onClick: () => api.navigate('goals') }, 'Manage'), { flush: true }),
    card('Top spending categories', cats.length
      ? hBarChart({ values: cats.slice(0, 7).map(c => c.value) }, cats.slice(0, 7).map(c => c.label),
        { colors: cats.slice(0, 7).map(c => c.color), width: 520 })
      : empty('Nothing to rank yet', '', 'chart')),
    card('Accounts', accountList(api), h('button', { class: 'btn sm ghost', onClick: () => api.navigate('accounts') }, 'Manage'), { flush: true })));

  return wrap;
}

/* ---------- fragments ---------- */
function greeting() {
  const hr = new Date().getHours();
  return hr < 5 ? 'Still up?' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : hr < 22 ? 'Good evening' : 'Good night';
}
const miniStat = (label, value, tone) => h('div', {},
  h('div', { class: 'tiny t3', text: label }),
  h('div', { class: `num ${tone || ''}`, style: { fontWeight: 700, fontSize: '.92rem' }, text: value }));

function deltaText(pct, suffix, invert = false) {
  const v = Number(pct) || 0;
  const good = invert ? v <= 0 : v >= 0;
  return h('span', { class: `delta ${Math.abs(v) < 0.1 ? 'flat' : good ? 'up' : 'down'}` },
    `${v >= 0 ? '↑' : '↓'} ${Math.abs(v).toFixed(1)}%`,
    h('span', { class: 't3', style: { fontWeight: 400 }, text: ` ${suffix}` }));
}
function scheduled() {
  const f = { daily: 30.44, weekly: 4.33, biweekly: 2.17, monthly: 1, quarterly: 1 / 3, halfyearly: 1 / 6, yearly: 1 / 12 };
  let t = 0;
  state.bills.forEach(b => { t += (Number(b.amount) || 0) * (f[b.recurrence] || 1); });
  t += loanTotals().monthly;
  return money(t);
}

function insightList(api) {
  const rows = insights({ limit: 6 });
  if (!rows.length) return empty('Nothing needs attention', 'Add more data and insights will appear here automatically.', 'sparkle');
  return h('div', { class: 'col' }, ...rows.map(r =>
    h('div', { class: `insight ${r.level === 'neg' ? 'neg' : r.level === 'warn' ? 'warn' : r.level === 'pos' ? 'pos' : ''}` },
      h('div', { class: 'ic', html: icon(r.level === 'pos' ? 'check' : r.level === 'info' ? 'sparkle' : 'alert', 15) }),
      h('div', { class: 'tt' }, h('b', { text: r.title }), h('p', { text: r.body }),
        r.action ? h('button', { class: 'btn xs mt-sm', text: r.action.label,
          onClick: () => api.navigate(r.action.route.replace('#/', '')) }) : null))));
}

function recentList(api) {
  const rows = sortBy(state.transactions, t => `${t.date}${t.time || ''}`, -1).slice(0, 8);
  if (!rows.length) return empty('No transactions yet', 'Press N or click “New transaction” to start.', 'swap',
    h('button', { class: 'btn primary sm mt', onClick: () => openTxnModal() }, 'Add your first'));
  return h('div', { class: 'lst' }, ...rows.map(t => {
    const c = store.find('categories', t.categoryId);
    return h('div', { class: 'lst-item', style: { cursor: 'pointer' }, onClick: () => openTxnModal(t) },
      h('div', { class: 'avatar', style: { background: (c?.color || '#94a3b8') + '22', color: c?.color || '#94a3b8' },
        html: icon(t.type === 'income' ? 'trend' : t.type === 'transfer' ? 'swap' : 'tag', 17) }),
      h('div', { class: 'lst-main' },
        h('div', { class: 't ell', text: t.notes || t.merchant || store.catName(t.categoryId) }),
        h('div', { class: 's ell', text: `${fmtDate(t.date)} · ${t.type === 'transfer' ? `${store.accName(t.accountId)} → ${store.accName(t.toAccountId)}` : store.catName(t.categoryId)}` })),
      h('div', { class: 'lst-amt' }, amountCell(t)));
  }));
}

function upcomingList(api) {
  const bills = billsDue({ within: 30 }).slice(0, 5).map(b => ({
    kind: 'bill', label: b.name, date: b.dueDate, amount: b.amount, icon: 'clock',
    sub: `${b.type || 'Bill'} · ${relDate(b.dueDate)}`, route: 'bills' }));
  const credits = sortBy(state.credits.filter(c => c.dueDate && store.creditOutstanding(c) > 0.004), c => c.dueDate)
    .slice(0, 4).map(c => ({ kind: 'credit', label: store.contactName(c.contactId), date: c.dueDate,
      amount: store.creditOutstanding(c), icon: 'book', sub: `${c.direction === 'given' ? 'Receivable' : 'Payable'} · ${relDate(c.dueDate)}`, route: 'credit' }));
  const rows = sortBy([...bills, ...credits], r => r.date).slice(0, 7);
  if (!rows.length) return empty('Nothing due', 'No bills or receivables in the next 30 days.', 'check');
  return h('div', { class: 'lst' }, ...rows.map(r => {
    const late = r.date < today();
    return h('div', { class: 'lst-item', style: { cursor: 'pointer' }, onClick: () => api.navigate(r.route) },
      h('div', { class: 'avatar', style: { background: late ? 'color-mix(in srgb,var(--neg) 16%,transparent)' : 'var(--surface-3)', color: late ? 'var(--neg)' : 'var(--text-2)' }, html: icon(r.icon, 16) }),
      h('div', { class: 'lst-main' }, h('div', { class: 't ell', text: r.label }),
        h('div', { class: 's', text: r.sub })),
      h('div', { class: 'lst-amt' }, h('span', { class: 'num', text: fmtMoney(r.amount) }),
        late ? h('div', {}, tag('Overdue', 'neg')) : null));
  }));
}

function budgetList(api) {
  const rows = state.budgets.map(b => ({ b, s: budgetStatus(b) }));
  if (!rows.length) return empty('No budgets set', 'Set limits per category to keep spending on track.', 'target',
    h('button', { class: 'btn sm primary mt', onClick: () => api.navigate('budget') }, 'Create a budget'));
  return h('div', { class: 'lst' }, ...sortBy(rows, r => r.s.pct, -1).slice(0, 6).map(({ b, s }) => {
    const name = b.categoryId === '*' ? 'Overall spending' : store.catName(b.categoryId);
    const tone = s.over ? 'neg' : s.pct > 80 ? 'warn' : 'pos';
    return h('div', { class: 'lst-item', style: { display: 'block', cursor: 'pointer' }, onClick: () => api.navigate('budget') },
      h('div', { class: 'row between', style: { marginBottom: '6px' } },
        h('span', { style: { fontWeight: 600, fontSize: '.85rem' }, text: name }),
        h('span', { class: `num tiny ${tone === 'neg' ? 'neg' : 't2'}`, text: `${fmtMoney(s.spent)} / ${fmtMoney(s.limit)}` })),
      bar(s.pct, tone),
      h('div', { class: 'tiny t3', style: { marginTop: '4px' },
        text: s.over ? `${fmtMoney(-s.remaining)} over limit` : `${fmtMoney(s.remaining)} left · projected ${fmtMoney(s.projected)}` }));
  }));
}

function goalList(api) {
  const rows = state.goals.map(g => ({ g, s: goalStatus(g) }));
  if (!rows.length) return empty('No goals yet', 'Set a target and watch the progress build.', 'flame',
    h('button', { class: 'btn sm primary mt', onClick: () => api.navigate('goals') }, 'Create a goal'));
  return h('div', { class: 'lst' }, ...sortBy(rows, r => r.s.pct, -1).slice(0, 5).map(({ g, s }) =>
    h('div', { class: 'lst-item', style: { cursor: 'pointer' }, onClick: () => api.navigate('goals') },
      h('div', { style: { width: '46px', flex: 'none' } }, ring(s.pct, { size: 44, thickness: 5, value: `${Math.round(s.pct)}%`, color: g.color })),
      h('div', { class: 'lst-main' }, h('div', { class: 't ell', text: g.name }),
        h('div', { class: 's', text: `${fmtMoney(s.saved)} of ${fmtMoney(s.target)}${s.monthsLeft ? ` · ${fmtMoney(s.perMonth)}/mo needed` : ''}` })),
      s.done ? tag('Reached', 'pos') : s.behind ? tag('Behind', 'warn') : null)));
}

function accountList(api) {
  const bals = store.accountBalances();
  const rows = store.activeAccounts();
  if (!rows.length) return empty('No accounts', 'Add a cash, bank or card account to begin.', 'wallet');
  return h('div', { class: 'lst' }, ...rows.map(a =>
    h('div', { class: 'lst-item', style: { cursor: 'pointer' }, onClick: () => api.navigate('accounts') },
      h('div', { class: 'avatar', style: { background: (a.color || '#7c5cff') + '22', color: a.color || '#7c5cff' }, html: icon('wallet', 16) }),
      h('div', { class: 'lst-main' }, h('div', { class: 't ell', text: a.name }),
        h('div', { class: 's', text: (store.ACCOUNT_TYPES.find(t => t[0] === a.type) || [, a.type])[1] })),
      h('div', { class: 'lst-amt num', style: { color: (bals.get(a.id) || 0) < 0 ? 'var(--neg)' : 'inherit' },
        text: fmtMoney(bals.get(a.id) || 0) }))));
}
