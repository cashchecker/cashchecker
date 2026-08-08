/* ═══════════ views/reports.js ═══════════ */

import {
  h, frag, icon, card, stat, tag, empty, toast, modal, store, state, settings,
  fmtMoney, fmtDate, today, sortBy, pageHead, kpiGrid, download, esc, periodSelect,
} from './common.js';
import { dataTable, segmented } from '../ui.js';
import { barChart, donut, lineChart, waterfall, hBarChart } from '../charts.js';
import {
  txnsIn, categoryBreakdown, monthlySeries, netWorth, portfolio, creditTotals, loanTotals,
  incomeIn, expenseIn, accountBalances, budgetStatus,
} from '../store.js';
import {
  money, period, toCSV, groupBy, addMonths, monthKey, fmtMonthKey, monthRange, startOfMonth,
  endOfMonth, yearKey, quarterOf, daysBetween, mean, fmtPct, colorFor, addDays,
} from '../util.js';
import { monthlyNarrative, healthScore, forecast } from '../ai.js';

export async function render(root, api) {
  let kind = 'summary';
  let per = 'month';
  const draw = () => {
    root.innerHTML = '';
    root.append(build(kind, per, (k, p) => { kind = k; per = p; draw(); }, api));
  };
  draw();
  return store.bus.on('change', ({ store: s }) => { if (s === 'transactions') draw(); });
}

const KINDS = [
  ['summary', 'Financial summary'],
  ['pl', 'Profit & loss'],
  ['category', 'Category report'],
  ['cashflow', 'Cash flow statement'],
  ['networth', 'Net worth statement'],
  ['tax', 'Tax summary'],
  ['narrative', 'Monthly narrative'],
];

function build(kind, per, set, api) {
  const wrap = h('div', {});
  const p = period(per);
  api.setSubtitle(`${(KINDS.find(k => k[0] === kind) || [, ''])[1]} · ${p.label}`);

  wrap.append(pageHead('Reports', 'Board-ready statements you can export to PDF, Excel or CSV.',
    h('button', { class: 'btn', html: `${icon('print', 16)} Print / PDF`, onClick: () => printReport(kind, p) }),
    h('button', { class: 'btn', html: `${icon('export', 16)} Excel`, onClick: () => exportExcel(kind, p) }),
    h('button', { class: 'btn primary', html: `${icon('export', 16)} CSV`, onClick: () => exportCSV(kind, p) })));

  const bar = h('div', { class: 'card pad', style: { display: 'flex', gap: '9px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '16px' } });
  bar.append(h('span', { class: 'up', text: 'Report' }));
  KINDS.forEach(([k, l]) => bar.append(h('button', { class: `chip ${k === kind ? 'on' : ''}`, text: l, onClick: () => set(k, per) })));
  bar.append(h('span', { style: { width: '100%', height: 0 } }), h('span', { class: 'up', text: 'Period' }),
    periodSelect(per, k => set(kind, k)));
  wrap.append(bar);

  const out = h('div', { id: 'report-body' });
  wrap.append(out);
  out.append(({
    summary: summaryReport, pl: plReport, category: categoryReport, cashflow: cashflowReport,
    networth: networthReport, tax: taxReport, narrative: narrativeReport,
  }[kind] || summaryReport)(p));

  return wrap;
}

/* ═══════════ report bodies ═══════════ */
function summaryReport(p) {
  const inc = incomeIn(p.from, p.to), exp = expenseIn(p.from, p.to);
  const txns = txnsIn(p.from, p.to);
  const nw = netWorth();
  const months = monthRange(p.from > '2000-01-01' ? p.from : addMonths(today(), -11), p.to);
  const series = months.map(mk => {
    const f = `${mk}-01`, t = endOfMonth(f);
    return { key: mk, income: incomeIn(f, t), expense: expenseIn(f, t) };
  });
  const cats = categoryBreakdown(p.from, p.to, 'expense');
  const incCats = categoryBreakdown(p.from, p.to, 'income');

  return h('div', {},
    kpiGrid(
      stat({ label: 'Total income', value: fmtMoney(inc), icon: 'trend', tone: 'pos' }),
      stat({ label: 'Total expense', value: fmtMoney(exp), icon: 'swap', tone: 'neg' }),
      stat({ label: 'Net result', value: fmtMoney(inc - exp), icon: 'wallet', tone: inc - exp >= 0 ? 'pos' : 'neg' }),
      stat({ label: 'Savings rate', value: inc ? `${(((inc - exp) / inc) * 100).toFixed(1)}%` : '—', icon: 'target' }),
      stat({ label: 'Transactions', value: String(txns.length), icon: 'file' }),
      stat({ label: 'Net worth', value: fmtMoney(nw.total), icon: 'bank', tone: 'info' })),
    h('div', { class: 'grid mt', style: { gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)' } },
      card('Income vs expense', series.length > 1
        ? barChart([{ name: 'Income', color: 'var(--pos)', values: series.map(s => s.income) },
                    { name: 'Expense', color: 'var(--neg)', values: series.map(s => s.expense) }],
          series.map(s => fmtMonthKey(s.key)), { height: 250 })
        : donut([{ label: 'Income', value: inc, color: 'var(--pos)' }, { label: 'Expense', value: exp, color: 'var(--neg)' }], { size: 210 })),
      card('Where money went', cats.length ? donut(cats, { size: 200, centerLabel: 'Expenses' }) : empty('No expenses', '', 'tag'))),
    h('div', { class: 'grid mt', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(330px,1fr))' } },
      card('Income breakdown', breakdownTable(incCats, inc)),
      card('Expense breakdown', breakdownTable(cats, exp))));
}

function breakdownTable(rows, total) {
  if (!rows.length) return empty('Nothing recorded', '', 'tag');
  const t = h('table', { class: 'tbl' },
    h('thead', {}, h('tr', {}, h('th', { class: 'no-sort' }, 'Category'), h('th', { class: 'no-sort right' }, 'Amount'), h('th', { class: 'no-sort right' }, 'Share'))),
    h('tbody', {}, ...rows.map(r => h('tr', {},
      h('td', {}, h('span', { class: 'row', style: { gap: '7px' } },
        h('span', { style: { width: '9px', height: '9px', borderRadius: '3px', background: r.color, flex: 'none' } }), r.label)),
      h('td', { class: 'right num' }, fmtMoney(r.value)),
      h('td', { class: 'right num t3' }, `${((r.value / (total || 1)) * 100).toFixed(1)}%`)))),
    h('tfoot', {}, h('tr', {}, h('td', {}, 'Total'), h('td', { class: 'right num' }, fmtMoney(total)), h('td', { class: 'right' }, '100%'))));
  return h('div', { class: 'tbl-wrap' }, t);
}

function plReport(p) {
  const incCats = categoryBreakdown(p.from, p.to, 'income');
  const expCats = categoryBreakdown(p.from, p.to, 'expense');
  const inc = money(incCats.reduce((a, r) => a + r.value, 0));
  const exp = money(expCats.reduce((a, r) => a + r.value, 0));
  const steps = [
    { label: 'Revenue', value: inc },
    ...expCats.slice(0, 8).map(c => ({ label: c.label, value: -c.value })),
    expCats.length > 8 ? { label: 'Other', value: -money(expCats.slice(8).reduce((a, c) => a + c.value, 0)) } : null,
    { label: 'Net result', isTotal: true, value: money(inc - exp) },
  ].filter(Boolean);

  return h('div', {},
    card('Profit & loss bridge', waterfall(steps, { height: 280 }), null, { sub: `${fmtDate(p.from)} → ${fmtDate(p.to)}` }),
    h('div', { class: 'card mt' }, h('div', { class: 'card-b' },
      h('table', { class: 'tbl' },
        h('tbody', {},
          sectionRow('INCOME'),
          ...incCats.map(r => lineRow(r.label, r.value)),
          totalRow('Total income', inc),
          sectionRow('EXPENSES'),
          ...expCats.map(r => lineRow(r.label, -r.value)),
          totalRow('Total expenses', -exp),
          totalRow(inc - exp >= 0 ? 'NET PROFIT' : 'NET LOSS', money(inc - exp), true))))));
}
const sectionRow = t => h('tr', {}, h('td', { colspan: 2, class: 'up', style: { paddingTop: '16px' } }, t));
const lineRow = (label, v) => h('tr', {}, h('td', { style: { paddingLeft: '18px' } }, label),
  h('td', { class: `right num ${v < 0 ? 'neg' : ''}` }, fmtMoney(Math.abs(v))));
const totalRow = (label, v, big) => h('tr', { style: { borderTop: '2px solid var(--border)' } },
  h('td', { style: { fontWeight: 700, fontSize: big ? '1rem' : '' } }, label),
  h('td', { class: `right num ${v < 0 ? 'neg' : 'pos'}`, style: { fontWeight: 700, fontSize: big ? '1rem' : '' } }, fmtMoney(v)));

function categoryReport(p) {
  const rows = [];
  for (const kind of ['expense', 'income']) {
    for (const c of categoryBreakdown(p.from, p.to, kind)) {
      const txns = txnsIn(p.from, p.to, { type: kind, categoryId: c.id });
      rows.push({ id: c.id + kind, category: c.label, kind, total: c.value, count: txns.length,
        avg: txns.length ? money(c.value / txns.length) : 0,
        max: txns.length ? money(Math.max(...txns.map(t => t.base))) : 0, color: c.color });
    }
  }
  return h('div', {},
    card('Category ranking', rows.length ? hBarChart({ values: rows.filter(r => r.kind === 'expense').map(r => r.total) },
      rows.filter(r => r.kind === 'expense').map(r => r.category),
      { colors: rows.filter(r => r.kind === 'expense').map(r => r.color), width: 760 }) : empty('No data', '', 'tag')),
    h('div', { class: 'mt' }, dataTable([
      { key: 'category', label: 'Category', render: r => h('span', { class: 'row', style: { gap: '7px' } },
        h('span', { style: { width: '9px', height: '9px', borderRadius: '3px', background: r.color, flex: 'none' } }), r.category) },
      { key: 'kind', label: 'Type', render: r => tag(r.kind === 'income' ? 'Income' : 'Expense', r.kind === 'income' ? 'pos' : 'neg') },
      { key: 'count', label: 'Entries', align: 'center' },
      { key: 'total', label: 'Total', align: 'right', render: r => h('span', { class: 'num', style: { fontWeight: 650 }, text: fmtMoney(r.total) }) },
      { key: 'avg', label: 'Average', align: 'right', render: r => h('span', { class: 'num tiny', text: fmtMoney(r.avg) }) },
      { key: 'max', label: 'Largest', align: 'right', render: r => h('span', { class: 'num tiny', text: fmtMoney(r.max) }) },
    ], { rows, pageSize: 30, exportName: 'category-report', defaultSort: { key: 'total', dir: -1 } }).el));
}

function cashflowReport(p) {
  const months = monthRange(p.from > '2000-01-01' ? p.from : addMonths(today(), -11), p.to);
  const rows = months.map(mk => {
    const f = `${mk}-01`, t = endOfMonth(f);
    const inc = incomeIn(f, t), exp = expenseIn(f, t);
    return { id: mk, month: fmtMonthKey(mk), income: inc, expense: exp, net: money(inc - exp) };
  });
  let running = 0;
  rows.forEach(r => { running = money(running + r.net); r.cumulative = running; });

  return h('div', {},
    card('Cumulative cash flow', lineChart([
      { name: 'Cumulative net', color: 'var(--accent)', values: rows.map(r => r.cumulative) },
    ], rows.map(r => r.month), { height: 250, hLine: 0 })),
    h('div', { class: 'mt' }, dataTable([
      { key: 'month', label: 'Period' },
      { key: 'income', label: 'Cash in', align: 'right', render: r => h('span', { class: 'num pos', text: fmtMoney(r.income) }) },
      { key: 'expense', label: 'Cash out', align: 'right', render: r => h('span', { class: 'num neg', text: fmtMoney(r.expense) }) },
      { key: 'net', label: 'Net', align: 'right', render: r => h('span', { class: `num ${r.net >= 0 ? 'pos' : 'neg'}`, style: { fontWeight: 650 }, text: fmtMoney(r.net) }) },
      { key: 'cumulative', label: 'Cumulative', align: 'right', render: r => h('span', { class: 'num', text: fmtMoney(r.cumulative) }) },
    ], { rows, pageSize: 24, exportName: 'cash-flow', searchable: false,
      footRow: data => h('tr', {}, h('td', { text: 'Total' }),
        h('td', { class: 'right num pos', text: fmtMoney(money(data.reduce((a, r) => a + r.income, 0))) }),
        h('td', { class: 'right num neg', text: fmtMoney(money(data.reduce((a, r) => a + r.expense, 0))) }),
        h('td', { class: 'right num', text: fmtMoney(money(data.reduce((a, r) => a + r.net, 0))) }),
        h('td')) }).el));
}

function networthReport() {
  const nw = netWorth();
  const bals = accountBalances();
  const pf = portfolio();
  const ct = creditTotals();
  const lt = loanTotals();
  const assets = [
    ...store.activeAccounts().filter(a => (bals.get(a.id) || 0) > 0).map(a => ({ label: a.name, value: bals.get(a.id) })),
    ...[...pf.byCat].map(([k, v]) => ({ label: `Investment — ${k}`, value: v })),
    ct.receivable ? { label: 'Receivables (credit book)', value: ct.receivable } : null,
  ].filter(Boolean);
  const liabilities = [
    ...store.activeAccounts().filter(a => (bals.get(a.id) || 0) < 0).map(a => ({ label: a.name, value: Math.abs(bals.get(a.id)) })),
    ...state.loans.filter(l => l.status !== 'closed').map(l => ({ label: `Loan — ${l.name}`, value: store.loanMetrics(l).outstanding })),
    ct.payable ? { label: 'Payables (credit book)', value: ct.payable } : null,
  ].filter(Boolean);

  return h('div', {},
    kpiGrid(
      stat({ label: 'Total assets', value: fmtMoney(nw.assets), icon: 'trend', tone: 'pos' }),
      stat({ label: 'Total liabilities', value: fmtMoney(nw.liabilities), icon: 'alert', tone: 'neg' }),
      stat({ label: 'Net worth', value: fmtMoney(nw.total), icon: 'bank', tone: nw.total >= 0 ? 'pos' : 'neg' }),
      stat({ label: 'Debt-to-asset ratio', value: nw.assets ? `${((nw.liabilities / nw.assets) * 100).toFixed(1)}%` : '—', icon: 'chart' })),
    h('div', { class: 'grid mt', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))' } },
      card('Assets', breakdownTable(assets.map((a, i) => ({ ...a, color: colorFor(a.label, i) })), nw.assets)),
      card('Liabilities', liabilities.length
        ? breakdownTable(liabilities.map((a, i) => ({ ...a, color: colorFor(a.label, i + 5) })), nw.liabilities)
        : empty('Debt free', 'You have no recorded liabilities.', 'check')),
      card('Composition', donut([
        { label: 'Cash', value: Math.max(0, nw.cash), color: '#10b981' },
        { label: 'Investments', value: nw.investments, color: '#7c5cff' },
        { label: 'Receivables', value: nw.receivable, color: '#22d3ee' },
      ], { size: 200, centerLabel: 'Assets' }))));
}

function taxReport(p) {
  const txns = txnsIn(p.from, p.to);
  const taxable = txns.filter(t => t.type === 'income');
  const deductible = txns.filter(t => t.type === 'expense' &&
    ['Business', 'Office', 'Digital Marketing', 'Education', 'Charity', 'Healthcare', 'Insurance', 'Trading'].includes(store.catName(t.categoryId)));
  const taxPaid = money(txns.reduce((a, t) => a + (Number(t.taxAmount) || 0), 0));
  const grossIncome = money(taxable.reduce((a, t) => a + t.base, 0));
  const deductions = money(deductible.reduce((a, t) => a + t.base, 0));

  return h('div', {},
    h('div', { class: 'insight mb' }, h('div', { class: 'ic', html: icon('alert', 15) }),
      h('div', { class: 'tt' }, h('b', { text: 'This is a data summary, not tax advice' }),
        h('p', { text: 'Cash Checker groups your own records into common tax buckets. Deductibility rules vary by jurisdiction — confirm everything with a qualified accountant before filing.' }))),
    kpiGrid(
      stat({ label: 'Gross income', value: fmtMoney(grossIncome), icon: 'trend', tone: 'pos' }),
      stat({ label: 'Potentially deductible', value: fmtMoney(deductions), icon: 'file', tone: 'info' }),
      stat({ label: 'Net taxable base', value: fmtMoney(grossIncome - deductions), icon: 'wallet' }),
      stat({ label: 'Tax recorded on transactions', value: fmtMoney(taxPaid), icon: 'bank', tone: 'warn' })),
    h('div', { class: 'grid mt', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))' } },
      card('Income by source', breakdownTable(categoryBreakdown(p.from, p.to, 'income'), grossIncome)),
      card('Deductible categories', breakdownTable(
        sortBy([...groupBy(deductible, t => store.catName(t.categoryId))].map(([label, rows], i) =>
          ({ label, value: money(rows.reduce((a, t) => a + t.base, 0)), color: colorFor(label, i) })), r => r.value, -1), deductions))),
    h('div', { class: 'mt' }, dataTable([
      { key: 'date', label: 'Date', render: r => fmtDate(r.date) },
      { key: 'notes', label: 'Description', value: r => r.notes || store.catName(r.categoryId) },
      { key: 'categoryId', label: 'Category', value: r => store.catName(r.categoryId) },
      { key: 'type', label: 'Type', render: r => tag(r.type, r.type === 'income' ? 'pos' : 'neg') },
      { key: 'taxAmount', label: 'Tax', align: 'right', render: r => h('span', { class: 'num tiny', text: r.taxAmount ? fmtMoney(r.taxAmount) : '—' }) },
      { key: 'base', label: 'Amount', align: 'right', render: r => h('span', { class: 'num', text: fmtMoney(r.base) }) },
    ], { rows: [...taxable, ...deductible], pageSize: 25, exportName: 'tax-summary' }).el));
}

function narrativeReport(p) {
  const mk = monthKey(p.to);
  const n = monthlyNarrative(mk);
  const hs = n.health;
  return h('div', {},
    h('div', { class: 'card pad' },
      h('div', { class: 'row between mb' },
        h('h2', { text: `Financial review — ${fmtMonthKey(mk)}` }),
        h('button', { class: 'btn sm', html: `${icon('copy', 14)} Copy text`, onClick: async () => {
          await navigator.clipboard.writeText(n.paragraphs.join('\n\n')); toast('Report copied', 'ok'); } })),
      ...n.paragraphs.map(t => h('p', { style: { fontSize: '.92rem', lineHeight: 1.7, marginBottom: '11px', color: 'var(--text-2)' }, text: t })),
      h('div', { class: 'tiny t3 mt', text: 'Generated locally from your own records — every figure above is traceable to a transaction in this app.' })),
    h('div', { class: 'grid mt', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' } },
      card('Health pillars', h('div', { class: 'col' }, ...hs.pillars.map(pl =>
        h('div', {},
          h('div', { class: 'row between', style: { marginBottom: '4px' } },
            h('span', { style: { fontSize: '.84rem', fontWeight: 600 }, text: pl.label }),
            h('span', { class: 'num tiny', text: `${pl.score}/100` })),
          h('div', { class: 'bar thin' }, h('i', { class: pl.score >= 70 ? 'pos' : pl.score >= 45 ? 'warn' : 'neg', style: { width: `${pl.score}%` } })),
          h('div', { class: 'tiny t3', style: { marginTop: '3px' }, text: pl.detail }))))),
      card('Top categories this month', breakdownTable(n.categories.slice(0, 10).map((c, i) => ({ ...c, color: colorFor(c.name, i) })).map(c => ({ label: c.name, value: c.value, color: c.color })), n.expense))));
}

/* ═══════════ exports ═══════════ */
function reportRows(kind, p) {
  if (kind === 'category') {
    return categoryBreakdown(p.from, p.to, 'expense').map(c => ({ Category: c.label, Amount: c.value, Type: 'Expense' }))
      .concat(categoryBreakdown(p.from, p.to, 'income').map(c => ({ Category: c.label, Amount: c.value, Type: 'Income' })));
  }
  if (kind === 'cashflow' || kind === 'summary' || kind === 'pl') {
    const months = monthRange(p.from > '2000-01-01' ? p.from : addMonths(today(), -11), p.to);
    return months.map(mk => {
      const f = `${mk}-01`, t = endOfMonth(f);
      const inc = incomeIn(f, t), exp = expenseIn(f, t);
      return { Month: mk, Income: inc, Expense: exp, Net: money(inc - exp) };
    });
  }
  if (kind === 'networth') {
    const nw = netWorth();
    return [{ Item: 'Cash', Amount: nw.cash }, { Item: 'Investments', Amount: nw.investments },
      { Item: 'Receivables', Amount: nw.receivable }, { Item: 'Payables', Amount: -nw.payable },
      { Item: 'Loans', Amount: -nw.loans }, { Item: 'Net worth', Amount: nw.total }];
  }
  return txnsIn(p.from, p.to).map(t => ({
    Date: t.date, Time: t.time || '', Type: t.type, Category: store.catName(t.categoryId),
    Account: store.accName(t.accountId), Description: t.notes || '', Merchant: t.merchant || '',
    Method: t.paymentMethod || '', Tags: (t.tags || []).join('|'), Status: t.status,
    Currency: t.currency, Amount: t.amount, [`Amount (${settings.baseCurrency})`]: t.base, Tax: t.taxAmount || 0,
  }));
}
function exportCSV(kind, p) {
  const rows = reportRows(kind, p);
  download(toCSV(rows), `cashchecker-${kind}-${p.from}_${p.to}.csv`, 'text/csv');
  toast(`Exported ${rows.length} rows`, 'ok');
}
/** SpreadsheetML — opens natively in Excel, LibreOffice and Numbers with no library. */
function exportExcel(kind, p) {
  const rows = reportRows(kind, p);
  if (!rows.length) { toast('Nothing to export in this period', 'warn'); return; }
  const cols = Object.keys(rows[0]);
  const cell = v => typeof v === 'number'
    ? `<Cell><Data ss:Type="Number">${v}</Data></Cell>`
    : `<Cell><Data ss:Type="String">${esc(String(v ?? ''))}</Data></Cell>`;
  const xml = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#EEEEEE" ss:Pattern="Solid"/></Style></Styles>
<Worksheet ss:Name="${esc(kind)}"><Table>
<Row>${cols.map(c => `<Cell ss:StyleID="h"><Data ss:Type="String">${esc(c)}</Data></Cell>`).join('')}</Row>
${rows.map(r => `<Row>${cols.map(c => cell(r[c])).join('')}</Row>`).join('\n')}
</Table></Worksheet></Workbook>`;
  download(xml, `cashchecker-${kind}-${p.from}_${p.to}.xls`, 'application/vnd.ms-excel');
  toast(`Excel file with ${rows.length} rows downloaded`, 'ok');
}
function printReport(kind, p) {
  const label = (KINDS.find(k => k[0] === kind) || [, kind])[1];
  const rows = reportRows(kind, p);
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  const w = window.open('', '_blank');
  if (!w) { toast('Allow pop-ups to print', 'warn'); return; }
  const inc = incomeIn(p.from, p.to), exp = expenseIn(p.from, p.to);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(label)}</title><style>
  body{font:12px system-ui;padding:34px;color:#111}h1{font-size:21px;margin:0 0 2px}
  .sub{color:#666;margin-bottom:16px;font-size:12px}
  .kpis{display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap}
  .kpi{flex:1;min-width:130px;padding:11px 13px;background:#f6f6f9;border-radius:9px}
  .kpi b{display:block;font-size:16px;margin-top:2px}.kpi span{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.06em}
  table{width:100%;border-collapse:collapse}th{text-align:left;font-size:10px;text-transform:uppercase;color:#666;border-bottom:2px solid #ddd;padding:6px}
  td{padding:6px;border-bottom:1px solid #eee}tr:nth-child(even) td{background:#fafafa}
  .r{text-align:right}@media print{body{padding:0}}</style></head><body>
  <h1>${esc(label)}</h1>
  <div class="sub">${esc(p.label)} · ${p.from} → ${p.to} · generated ${new Date().toLocaleString()}</div>
  <div class="kpis">
    <div class="kpi"><span>Income</span><b>${fmtMoney(inc)}</b></div>
    <div class="kpi"><span>Expense</span><b>${fmtMoney(exp)}</b></div>
    <div class="kpi"><span>Net</span><b>${fmtMoney(money(inc - exp))}</b></div>
    <div class="kpi"><span>Net worth</span><b>${fmtMoney(netWorth().total)}</b></div>
  </div>
  <table><thead><tr>${cols.map(c => `<th class="${typeof rows[0][c] === 'number' ? 'r' : ''}">${esc(c)}</th>`).join('')}</tr></thead>
  <tbody>${rows.slice(0, 2000).map(r => `<tr>${cols.map(c => `<td class="${typeof r[c] === 'number' ? 'r' : ''}">${typeof r[c] === 'number' ? fmtMoney(r[c]) : esc(String(r[c] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody></table>
  <p style="margin-top:24px;color:#999;font-size:10px">Generated by Cash Checker · ${rows.length} records</p>
  </body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 350);
}
