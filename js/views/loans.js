/* ═══════════ views/loans.js ═══════════ */

import {
  h, frag, icon, card, stat, tag, empty, toast, confirm, modal, formModal, store, state, settings,
  fmtMoney, fmtDate, today, sortBy, pageHead, kpiGrid, confirmDelete, accountOptions, categoryOptions,
  relDate, statusTag,
} from './common.js';
import { dataTable, sheet, bar } from '../ui.js';
import { lineChart, barChart, donut, ring } from '../charts.js';
import { loanMetrics, loanTotals } from '../store.js';
import { money, emi, amortize, addMonths, daysBetween, fmtPct, colorFor, monthRange, fmtMonthKey } from '../util.js';

const LOAN_TYPES = [['personal', 'Personal loan'], ['auto', 'Car / auto loan'], ['home', 'Home / mortgage'],
  ['business', 'Business loan'], ['education', 'Education loan'], ['gold', 'Gold loan'],
  ['creditcard', 'Credit card debt'], ['informal', 'Informal / family'], ['other', 'Other']];

export async function render(root, api) {
  const draw = () => { root.innerHTML = ''; root.append(build(draw, api)); };
  draw();
  return store.bus.on('change', ({ store: s }) => { if (['loans', 'loanPayments'].includes(s)) draw(); });
}

function build(redraw, api) {
  const wrap = h('div', {});
  const loans = state.loans.map(l => ({ ...l, m: loanMetrics(l) }));
  const active = loans.filter(l => l.status !== 'closed');
  const T = loanTotals();
  const totalInterest = money(active.reduce((a, l) => a + l.m.totalInterest, 0));
  const paidInterest = money(active.reduce((a, l) => a + l.m.paidInterest, 0));
  api.setSubtitle(`${active.length} active · ${loans.length - active.length} closed`);

  wrap.append(pageHead('Loans', 'EMI schedules, amortisation, prepayment impact and interest paid to date.',
    h('button', { class: 'btn', html: `${icon('chart', 16)} EMI calculator`, onClick: () => calculator() }),
    h('button', { class: 'btn primary', html: `${icon('plus', 16)} Add loan`, onClick: () => editLoan(null, redraw) })));

  wrap.append(kpiGrid(
    stat({ label: 'Outstanding balance', value: fmtMoney(T.outstanding), icon: 'bank', tone: 'neg',
      foot: h('span', { class: 't3', text: `${active.length} active loans` }) }),
    stat({ label: 'Monthly EMI', value: fmtMoney(T.monthly), icon: 'calendar', tone: 'warn',
      foot: h('span', { class: 't3', text: `${fmtMoney(T.monthly * 12)} per year` }) }),
    stat({ label: 'Interest paid to date', value: fmtMoney(paidInterest), icon: 'export', tone: 'neg',
      foot: h('span', { class: 't3', text: `${fmtMoney(totalInterest)} total over full terms` }) }),
    stat({ label: 'Principal repaid', value: fmtMoney(money(active.reduce((a, l) => a + l.m.paidPrincipal, 0))), icon: 'check', tone: 'pos',
      foot: h('span', { class: 't3', text: `${active.length ? (money(active.reduce((a, l) => a + l.m.progress, 0)) / active.length).toFixed(0) : 0}% average progress` }) })));

  const grid = h('div', { class: 'grid auto-lg mt stagger' });
  if (!loans.length) grid.append(empty('No loans recorded', 'Add a mortgage, car loan, business facility or informal borrowing to track EMIs and interest.', 'bank',
    h('button', { class: 'btn primary sm mt', onClick: () => editLoan(null, redraw) }, 'Add a loan')));
  sortBy(loans, l => l.m.outstanding, -1).forEach(l => {
    const m = l.m;
    grid.append(h('div', { class: 'card pad', style: { cursor: 'pointer' }, onClick: () => openLoan(l, redraw) },
      h('div', { class: 'row between mb' },
        h('div', { style: { minWidth: 0 } }, h('b', { class: 'ell', text: l.name }),
          h('div', { class: 'tiny t3', text: `${l.lender || 'Lender'} · ${(LOAN_TYPES.find(t => t[0] === l.type) || [, l.type])[1]}` })),
        l.status === 'closed' ? tag('Closed', 'pos') : tag(`${l.rate}% p.a.`, 'warn')),
      h('div', { class: 'row', style: { gap: '14px', alignItems: 'center' } },
        ring(m.progress, { size: 78, thickness: 7, value: `${Math.round(m.progress)}%`, color: 'var(--accent)' }),
        h('div', { style: { flex: 1 } },
          h('div', { class: 'num', style: { fontSize: '1.25rem', fontWeight: 700 }, text: fmtMoney(m.outstanding) }),
          h('div', { class: 'tiny t3', text: `outstanding of ${fmtMoney(l.principal)}` }),
          h('div', { class: 'tiny t2 mt-sm', text: `${fmtMoney(m.monthly)} / month · ${m.remainingMonths} payments left` }))),
      h('div', { class: 'row mt-sm', style: { gap: '6px' } },
        h('button', { class: 'btn xs primary', text: 'Record payment', onClick: e => { e.stopPropagation(); payLoan(l, redraw); } }),
        h('button', { class: 'btn xs', text: 'Schedule', onClick: e => { e.stopPropagation(); openLoan(l, redraw, 'schedule'); } }))));
  });
  wrap.append(grid);

  if (active.length) {
    const months = monthRange(today(), addMonths(today(), 23));
    const series = months.map((mk, i) => money(active.reduce((a, l) =>
      a + (i < l.m.remainingMonths ? l.m.monthly : 0), 0)));
    wrap.append(h('div', { class: 'grid mt', style: { gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)' } },
      card('Committed EMI outflow — next 24 months', barChart([{ name: 'EMI', color: 'var(--warn)', values: series }],
        months.map(fmtMonthKey), { height: 230 })),
      card('Debt composition', donut(active.map(l => ({ label: l.name, value: l.m.outstanding, color: colorFor(l.name) })),
        { size: 200, centerLabel: 'Outstanding' }))));

    wrap.append(h('div', { class: 'mt' }, dataTable([
      { key: 'name', label: 'Loan', render: r => h('div', {}, h('b', { text: r.name }),
        h('div', { class: 'tiny t3', text: r.lender || '' })) },
      { key: 'principal', label: 'Principal', align: 'right', render: r => h('span', { class: 'num t2', text: fmtMoney(r.principal) }) },
      { key: 'rate', label: 'Rate', align: 'right', render: r => h('span', { class: 'num', text: `${r.rate}%` }) },
      { key: 'monthly', label: 'EMI', align: 'right', value: r => r.m.monthly, render: r => h('span', { class: 'num', text: fmtMoney(r.m.monthly) }) },
      { key: 'outstanding', label: 'Outstanding', align: 'right', value: r => r.m.outstanding,
        render: r => h('span', { class: 'num', style: { fontWeight: 650 }, text: fmtMoney(r.m.outstanding) }) },
      { key: 'progress', label: 'Repaid', align: 'right', value: r => r.m.progress,
        render: r => h('div', { style: { minWidth: '80px' } }, h('div', { class: 'tiny num', text: fmtPct(r.m.progress, 0) }), bar(r.m.progress, 'pos')) },
      { key: 'remainingMonths', label: 'Left', align: 'center', value: r => r.m.remainingMonths,
        render: r => h('span', { class: 'tiny', text: `${r.m.remainingMonths} mo` }) },
      { key: 'totalInterest', label: 'Total interest', align: 'right', value: r => r.m.totalInterest,
        render: r => h('span', { class: 'num tiny neg', text: fmtMoney(r.m.totalInterest) }) },
    ], {
      rows: loans, exportName: 'loans', pageSize: 15,
      onRowClick: l => openLoan(l, redraw),
      actions: l => [
        { label: 'View schedule', icon: 'calendar', onClick: () => openLoan(l, redraw, 'schedule') },
        { label: 'Record payment', icon: 'check', onClick: () => payLoan(l, redraw) },
        { label: 'Prepayment impact', icon: 'sparkle', onClick: () => prepayment(l) },
        { label: 'Edit', icon: 'edit', onClick: () => editLoan(l, redraw) },
        '-',
        { label: 'Delete', icon: 'trash', danger: true, onClick: async () => {
          if (await confirmDelete(l.name)) { await store.remove('loans', l.id); redraw(); } } },
      ],
    }).el));
  }
  return wrap;
}

/* ---------- editor ---------- */
function editLoan(l, redraw) {
  const { modal: m, form: f } = formModal({
    title: l ? `Edit ${l.name}` : 'New loan', size: 'wide', columns: 2,
    values: l || { startDate: today(), status: 'active', type: 'personal' },
    fields: [
      { key: 'name', label: 'Loan name', type: 'text', required: true, col: 'full' },
      { key: 'lender', label: 'Lender', type: 'text' },
      { key: 'type', label: 'Type', type: 'select', options: LOAN_TYPES },
      { key: 'principal', label: 'Principal amount', type: 'money', required: true },
      { key: 'rate', label: 'Annual interest rate', type: 'percent', required: true },
      { key: 'termMonths', label: 'Term (months)', type: 'number', required: true, min: 1 },
      { key: 'startDate', label: 'Start date', type: 'date', required: true },
      { key: 'emi', label: 'EMI override', type: 'money', hint: 'Leave blank to calculate automatically' },
      { key: 'accountId', label: 'Repaid from', type: 'select', options: accountOptions(), placeholder: 'Optional' },
      { key: 'status', label: 'Status', type: 'select', options: [['active', 'Active'], ['closed', 'Closed'], ['default', 'In default']] },
      { key: 'notes', label: 'Notes', type: 'textarea', col: 'full' },
      { key: 'attachments', label: 'Agreement / documents', type: 'attach', col: 'full' },
    ],
    onSubmit: async v => {
      await store.save('loans', { ...(l || {}), ...v, m: undefined });
      m.close(); toast(l ? 'Loan updated' : 'Loan added', 'ok'); redraw();
    },
  });
  // live EMI preview
  const preview = h('div', { class: 'insight', style: { marginTop: '12px' } },
    h('div', { class: 'ic', html: icon('sparkle', 15) }), h('div', { class: 'tt' }));
  m.body.append(preview);
  const upd = () => {
    const v = f.read();
    const p = Number(v.principal) || 0, r = Number(v.rate) || 0, n = Number(v.termMonths) || 0;
    if (!p || !n) { preview.querySelector('.tt').innerHTML = '<b>Enter principal and term</b><p>The EMI and total interest appear here.</p>'; return; }
    const e = Number(v.emi) || emi(p, r, n);
    preview.querySelector('.tt').innerHTML =
      `<b>EMI ${fmtMoney(e)} / month</b><p>Total repayment ${fmtMoney(money(e * n))} · interest ${fmtMoney(money(e * n - p))} over ${n} months.</p>`;
  };
  m.body.addEventListener('input', upd);
  m.body.addEventListener('change', upd);
  upd();
}

/* ---------- payment ---------- */
function payLoan(l, redraw) {
  const m0 = loanMetrics(l);
  const rate = (Number(l.rate) || 0) / 1200;
  const interest = money(m0.outstanding * rate);
  const { modal: m } = formModal({
    title: `Record payment — ${l.name}`, subtitle: `Outstanding ${fmtMoney(m0.outstanding)}`,
    size: '', columns: 2,
    values: { date: today(), amount: m0.monthly, interest, principal: money(m0.monthly - interest), createTxn: true },
    fields: [
      { key: 'amount', label: 'Payment amount', type: 'money', required: true, big: true, col: 'full' },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'method', label: 'Method', type: 'select', options: store.PAYMENT_METHODS },
      { key: 'interest', label: 'Interest portion', type: 'money', hint: `Auto-calculated at ${l.rate}% p.a.` },
      { key: 'principal', label: 'Principal portion', type: 'money' },
      { key: 'createTxn', label: 'Record as an expense in the tracker', type: 'switch', col: 'full' },
      { key: 'accountId', label: 'Paid from', type: 'select', options: accountOptions(), when: mm => mm.createTxn },
    ],
    onSubmit: async v => {
      const amt = Number(v.amount) || 0;
      const int = Number(v.interest) || 0;
      const prin = Number(v.principal) || money(amt - int);
      await store.save('loanPayments', { loanId: l.id, date: v.date, amount: amt, interest: int, principal: prin, method: v.method });
      const after = loanMetrics(store.find('loans', l.id));
      if (after.outstanding <= 0.01) await store.save('loans', { ...l, m: undefined, status: 'closed' }, { auditIt: false });
      if (v.createTxn && v.accountId) {
        const cat = state.categories.find(c => c.name === 'EMI' && c.kind === 'expense')
          || state.categories.find(c => c.name === 'Loan' && c.kind === 'expense');
        await store.save('transactions', { type: 'expense', amount: amt, currency: settings.baseCurrency, rate: 1,
          accountId: v.accountId, categoryId: cat?.id, date: v.date, paymentMethod: v.method,
          notes: `${l.name} EMI`, status: 'cleared', tags: ['loan'] });
      }
      m.close();
      toast(after.outstanding <= 0.01 ? 'Loan fully repaid 🎉' : `Payment recorded · ${fmtMoney(after.outstanding)} remaining`, 'ok');
      redraw();
    },
  });
}

/* ---------- detail ---------- */
function openLoan(l, redraw, tab = 'overview') {
  const m = loanMetrics(l);
  const payments = sortBy(state.loanPayments.filter(p => p.loanId === l.id), p => p.date, -1);
  const schedule = amortize(Number(l.principal), Number(l.rate), Number(l.termMonths), l.startDate);
  const body = h('div', {});

  body.append(h('div', { class: 'card pad', style: { textAlign: 'center', marginBottom: '13px' } },
    h('h2', { text: l.name }), h('div', { class: 'tiny t3', text: l.lender || '' }),
    h('div', { style: { display: 'grid', placeItems: 'center', margin: '11px 0' } },
      ring(m.progress, { size: 118, thickness: 10, value: `${Math.round(m.progress)}%`, label: 'repaid' })),
    h('div', { class: 'num', style: { fontSize: '1.5rem', fontWeight: 750 }, text: fmtMoney(m.outstanding) }),
    h('div', { class: 'tiny t3', text: `outstanding · ${m.remainingMonths} payments remaining` })));

  body.append(h('dl', { class: 'kv card pad', style: { marginBottom: '13px' } },
    ...[['Principal', fmtMoney(l.principal)], ['Interest rate', `${l.rate}% p.a.`],
        ['Term', `${l.termMonths} months`], ['Monthly EMI', fmtMoney(m.monthly)],
        ['Total repayable', fmtMoney(m.totalPayable)], ['Total interest', fmtMoney(m.totalInterest)],
        ['Interest paid so far', fmtMoney(m.paidInterest)], ['Principal repaid', fmtMoney(m.paidPrincipal)],
        ['Payments made', `${payments.length} of ${l.termMonths}`],
        ['Started', fmtDate(l.startDate)], ['Expected close', fmtDate(addMonths(l.startDate, Number(l.termMonths)))]]
      .flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { class: 'num', text: v })])));

  body.append(card('Balance over the full term', lineChart([
    { name: 'Outstanding', color: 'var(--accent)', values: schedule.map(r => r.balance) },
  ], schedule.map(r => fmtDate(r.date, 'short')), { height: 190, width: 420, showDots: false })));

  body.append(h('div', { class: 'up mt', style: { marginBottom: '6px' }, text: 'Amortisation schedule' }));
  const sched = h('div', { class: 'card', style: { maxHeight: '320px', overflowY: 'auto' } });
  schedule.slice(0, 400).forEach(r => sched.append(h('div', { class: 'ledger-row' },
    h('div', {}, h('div', { style: { fontSize: '.82rem', fontWeight: 560 }, text: `#${r.n} · ${fmtDate(r.date)}` }),
      h('div', { class: 'tiny t3', text: `Interest ${fmtMoney(r.interest)} · Principal ${fmtMoney(r.principal)}` })),
    h('span', { class: 'num tiny', text: fmtMoney(r.payment) }),
    h('span', { class: 'num tiny t3', text: fmtMoney(r.balance) }))));
  body.append(sched);

  if (payments.length) {
    body.append(h('div', { class: 'up mt', style: { marginBottom: '6px' }, text: 'Payments made' }));
    const pl = h('div', { class: 'card' });
    payments.slice(0, 24).forEach(p => pl.append(h('div', { class: 'ledger-row' },
      h('div', {}, h('div', { style: { fontSize: '.82rem' }, text: fmtDate(p.date) }),
        h('div', { class: 'tiny t3', text: `Interest ${fmtMoney(p.interest || 0)} · Principal ${fmtMoney(p.principal || 0)}` })),
      h('span', { class: 'num tiny', text: fmtMoney(p.amount) }),
      h('button', { class: 'icon-btn', html: icon('trash', 14), onClick: async () => {
        if (await confirmDelete('this payment')) { await store.remove('loanPayments', p.id); s0.close(); redraw(); } } }))));
    body.append(pl);
  }

  const s0 = sheet({
    title: 'Loan detail', body,
    footer: frag(
      h('button', { class: 'btn sm', text: 'Prepayment impact', onClick: () => { s0.close(); prepayment(l); } }),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn sm primary', text: 'Record payment', onClick: () => { s0.close(); payLoan(l, redraw); } })),
  });
  void tab;
}

/* ---------- prepayment simulator ---------- */
function prepayment(l) {
  const m = loanMetrics(l);
  let extra = Math.round(m.monthly * 0.2);
  const out = h('div', {});
  const calc = () => {
    const rate = (Number(l.rate) || 0) / 1200;
    const sim = (extraPay) => {
      let bal = m.outstanding, months = 0, interest = 0;
      while (bal > 0.01 && months < 1200) {
        const int = bal * rate;
        let prin = m.monthly + extraPay - int;
        if (prin <= 0) return null;
        if (prin > bal) prin = bal;
        bal -= prin; interest += int; months++;
      }
      return { months, interest: money(interest) };
    };
    const base = sim(0), withExtra = sim(extra);
    out.innerHTML = '';
    if (!base || !withExtra) { out.append(h('p', { class: 'tiny neg', text: 'The EMI does not cover the interest at this rate.' })); return; }
    out.append(
      h('div', { class: 'field mb' }, h('label', { text: `Extra payment per month: ${fmtMoney(extra)}` }),
        (() => { const r = h('input', { type: 'range', min: 0, max: Math.round(m.monthly * 2), step: 10, value: extra, style: { width: '100%' } });
          r.oninput = () => { extra = Number(r.value); calc(); }; return r; })()),
      h('dl', { class: 'kv card pad' },
        h('dt', { text: 'Payoff without extra' }), h('dd', { class: 'num', text: `${base.months} months` }),
        h('dt', { text: 'Payoff with extra' }), h('dd', { class: 'num pos', text: `${withExtra.months} months` }),
        h('dt', { text: 'Months saved' }), h('dd', { class: 'num pos', text: String(base.months - withExtra.months) }),
        h('dt', { text: 'Interest without extra' }), h('dd', { class: 'num', text: fmtMoney(base.interest) }),
        h('dt', { text: 'Interest with extra' }), h('dd', { class: 'num pos', text: fmtMoney(withExtra.interest) }),
        h('dt', { text: 'Interest saved' }), h('dd', { class: 'num pos', style: { fontWeight: 800 }, text: fmtMoney(money(base.interest - withExtra.interest)) })));
  };
  calc();
  const mm = modal({ title: 'Prepayment impact', subtitle: `${l.name} · ${fmtMoney(m.outstanding)} outstanding at ${l.rate}%`,
    body: out, footer: frag(h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onClick: () => mm.close() }, 'Close')) });
}

/* ---------- standalone EMI calculator ----------
   Rate bands are the Indian retail-lending reality: secured borrowing sits
   under 10%, unsecured personal loans run into the teens, and anything at or
   past 24% is credit-card territory. The colour is a judgement, so it says why. */
const RATE_BANDS = [
  { max: 10, key: 'good', tone: 'var(--pos)', label: 'Low rate',
    note: 'Typical of a secured loan — home, property or gold. This is cheap money.' },
  { max: 15, key: 'fair', tone: 'var(--warn)', label: 'Moderate rate',
    note: 'Normal for a car loan or a good personal loan. Worth comparing a few lenders.' },
  { max: 24, key: 'high', tone: 'var(--neg)', label: 'High rate',
    note: 'Expensive. Interest is a large share of what you repay — shorten the term or refinance if you can.' },
  { max: Infinity, key: 'danger', tone: 'var(--neg)', label: 'Very high rate',
    note: 'Credit-card territory. Borrowing at this rate is rarely worth it — clear it as fast as you can.' },
];
const bandFor = rate => RATE_BANDS.find(b => rate < b.max) || RATE_BANDS.at(-1);

function calculator() {
  const S = { principal: 100000, rate: 10, months: 60 };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const emiEl = h('div', { class: 'emi-figure num' });
  const subEl = h('div', { class: 'tiny t2 emi-sub' });
  const hero = h('div', { class: 'emi-hero' },
    h('div', { class: 'up', text: 'Monthly instalment' }), emiEl, subEl);
  const badge = h('span', { class: 'emi-badge' });
  const gaugeFill = h('i');
  const gauge = h('div', { class: 'emi-gauge' }, gaugeFill);
  const noteEl = h('p', { class: 'emi-note' });
  const rateCard = h('div', { class: 'emi-rate' },
    h('div', { class: 'row between', style: { alignItems: 'center', gap: '8px' } },
      h('span', { class: 'up', text: 'Interest rate' }), badge),
    gauge, noteEl);
  const chartEl = h('div', { class: 'emi-chart' });

  /** Counts the instalment up to its new value — small, and it makes a change felt. */
  let raf = 0, shown = 0;
  const setFigure = target => {
    cancelAnimationFrame(raf);
    // Paint the real value synchronously first. requestAnimationFrame does not
    // run in a background or non-compositing tab, and a pretty count-up is not
    // worth showing an empty box instead of the answer.
    emiEl.textContent = fmtMoney(target);
    if (reduced) { shown = target; return; }
    const from = shown, t0 = performance.now(), dur = 420;
    const tick = now => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      shown = from + (target - from) * eased;
      emiEl.textContent = fmtMoney(shown);
      if (p < 1) raf = requestAnimationFrame(tick);
      else { shown = target; emiEl.textContent = fmtMoney(target); }
    };
    raf = requestAnimationFrame(tick);
  };

  const calc = () => {
    const e = emi(S.principal, S.rate, S.months);
    const total = money(e * S.months);
    const interest = money(total - S.principal);
    const band = bandFor(S.rate);
    const share = S.principal > 0 ? (interest / S.principal) * 100 : 0;

    hero.style.setProperty('--tone', band.tone);
    hero.dataset.band = band.key;
    rateCard.dataset.band = band.key;
    setFigure(e);
    subEl.textContent = `${fmtMoney(total)} total · ${fmtMoney(interest)} interest`;

    badge.textContent = `${S.rate}% · ${band.label}`;
    badge.style.setProperty('--tone', band.tone);
    gaugeFill.style.width = `${Math.min(100, (S.rate / 40) * 100)}%`;
    gaugeFill.style.background = band.tone;
    noteEl.textContent = interest > 0
      ? `${band.note} You repay ${share.toFixed(0)}% more than you borrow.`
      : band.note;

    chartEl.innerHTML = '';
    chartEl.append(donut([
      { label: 'Principal', value: S.principal, color: 'var(--accent)' },
      { label: 'Interest', value: interest, color: band.tone },
    ], { size: 200, thickness: 26, centerLabel: 'Total payable' }));
    if (!reduced) {
      chartEl.querySelectorAll('svg path, svg circle').forEach(p => {
        p.style.animation = 'emi-sweep .5s var(--ease-out) both';
      });
    }
  };

  const fields = [
    ['Loan amount', 'principal', 1000, 50000000, 1000],
    ['Interest rate %', 'rate', 0, 40, 0.1],
    ['Term (months)', 'months', 6, 360, 6],
  ].map(([label, key, min, max, step]) => {
    const inp = h('input', { class: 'inp num', type: 'number', value: S[key], min, max, step });
    inp.oninput = () => { S[key] = Number(inp.value) || 0; calc(); };
    return h('div', { class: 'field' }, h('label', { text: label }), inp);
  });

  calc();
  shown = emi(S.principal, S.rate, S.months);

  const m = modal({
    title: 'EMI calculator', size: '',
    body: h('div', { class: 'emi-wrap' },
      h('div', { class: 'grid g3 emi-inputs' }, ...fields),
      h('div', { class: 'emi-body' },
        h('div', {}, hero, rateCard),
        chartEl)),
    footer: frag(h('div', { class: 'spacer' }),
      h('button', { class: 'btn primary', onClick: () => m.close() }, 'Close')),
  });
}
