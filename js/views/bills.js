/* ═══════════ views/bills.js — Bills & Due Dates ═══════════ */

import {
  h, frag, icon, card, stat, tag, empty, toast, confirm, modal, formModal, store, state, settings,
  fmtMoney, fmtDate, today, sortBy, pageHead, kpiGrid, confirmDelete, categoryOptions, accountOptions,
  relDate, statusTag,
} from './common.js';
import { dataTable, bar } from '../ui.js';
import { donut, barChart } from '../charts.js';
import { billsDue } from '../store.js';
import { money, addDays, addMonths, daysBetween, RECUR, nextOccurrence, monthKey, fmtMonthKey, monthRange, DOW, parseISO, startOfMonth, endOfMonth, daysInMonth, pad2 } from '../util.js';

const BILL_TYPES = ['Rent', 'EMI', 'Loan', 'Insurance', 'Utilities', 'Credit Card', 'Subscription',
  'Investment', 'Tuition', 'Tax', 'Membership', 'Other'];

export async function render(root, api) {
  let tab = 'upcoming';
  const draw = () => { root.innerHTML = ''; root.append(build(tab, t => { tab = t; draw(); }, draw, api)); };
  draw();
  return store.bus.on('change', ({ store: s }) => { if (['bills', 'transactions'].includes(s)) draw(); });
}

function build(tab, setTab, redraw, api) {
  const wrap = h('div', {});
  const all = state.bills;
  const unpaid = all.filter(b => b.status !== 'paid');
  const overdue = unpaid.filter(b => b.dueDate < today());
  const next7 = unpaid.filter(b => b.dueDate >= today() && b.dueDate <= addDays(today(), 7));
  const next30 = unpaid.filter(b => b.dueDate >= today() && b.dueDate <= addDays(today(), 30));
  const monthlyCommit = money(all.reduce((a, b) => {
    const f = { daily: 30.44, weekly: 4.33, biweekly: 2.17, monthly: 1, quarterly: 1 / 3, halfyearly: 1 / 6, yearly: 1 / 12 }[b.recurrence] || 0;
    return a + (Number(b.amount) || 0) * f;
  }, 0));
  api.setSubtitle(`${unpaid.length} unpaid · ${overdue.length} overdue`);

  wrap.append(pageHead('Bills & Due Dates', 'Never miss a payment — recurring bills roll forward automatically once marked paid.',
    h('button', { class: 'btn primary', html: `${icon('plus', 16)} Add bill`, onClick: () => editBill(null, redraw) })));

  wrap.append(kpiGrid(
    stat({ label: 'Overdue', value: String(overdue.length), icon: 'alert', tone: overdue.length ? 'neg' : 'pos',
      foot: h('span', { class: overdue.length ? 'neg' : 't3', text: fmtMoney(money(overdue.reduce((a, b) => a + Number(b.amount || 0), 0))) }) }),
    stat({ label: 'Due in 7 days', value: String(next7.length), icon: 'clock', tone: 'warn',
      foot: h('span', { class: 't3', text: fmtMoney(money(next7.reduce((a, b) => a + Number(b.amount || 0), 0))) }) }),
    stat({ label: 'Due in 30 days', value: String(next30.length), icon: 'calendar', tone: 'info',
      foot: h('span', { class: 't3', text: fmtMoney(money(next30.reduce((a, b) => a + Number(b.amount || 0), 0))) }) }),
    stat({ label: 'Monthly commitment', value: fmtMoney(monthlyCommit), icon: 'repeat',
      foot: h('span', { class: 't3', text: `${all.filter(b => b.recurrence && b.recurrence !== 'none').length} recurring bills` }) }),
    stat({ label: 'On autopay', value: String(all.filter(b => b.autopay).length), icon: 'check', tone: 'pos',
      foot: h('span', { class: 't3', text: 'Marked as auto-debit' }) })));

  const tabsEl = h('div', { class: 'tabs mt' });
  [['upcoming', 'Upcoming'], ['all', 'All bills'], ['calendar', 'Month view'], ['paid', 'Payment history']]
    .forEach(([v, l]) => tabsEl.append(h('button', { class: v === tab ? 'on' : '', text: l, onClick: () => setTab(v) })));
  wrap.append(tabsEl);
  const body = h('div', { class: 'mt' });
  wrap.append(body);

  if (tab === 'calendar') { body.append(monthView(redraw)); return wrap; }
  if (tab === 'paid') { body.append(historyPanel()); return wrap; }

  const rows = tab === 'upcoming' ? sortBy(unpaid, b => b.dueDate) : sortBy(all, b => b.dueDate);

  /* timeline cards for upcoming */
  if (tab === 'upcoming') {
    const grid = h('div', { class: 'grid auto stagger' });
    if (!rows.length) grid.append(empty('Nothing due', 'All bills are settled. Add one to keep track of what is coming.', 'check',
      h('button', { class: 'btn primary sm mt', onClick: () => editBill(null, redraw) }, 'Add a bill')));
    rows.slice(0, 12).forEach(b => {
      const d = daysBetween(today(), b.dueDate);
      const late = d < 0;
      grid.append(h('div', { class: 'card pad', style: { borderLeft: `3px solid ${late ? 'var(--neg)' : d <= 3 ? 'var(--warn)' : 'var(--border)'}`, cursor: 'pointer' },
        onClick: () => editBill(b, redraw) },
        h('div', { class: 'row between mb' },
          h('div', { style: { minWidth: 0 } }, h('b', { class: 'ell', text: b.name }),
            h('div', { class: 'tiny t3', text: b.type || 'Bill' })),
          b.autopay ? tag('Auto', 'info') : null),
        h('div', { class: 'num', style: { fontSize: '1.3rem', fontWeight: 700 }, text: fmtMoney(b.amount) }),
        h('div', { class: `tiny ${late ? 'neg' : d <= 3 ? 'warnc' : 't3'}`, style: { marginBottom: '9px' },
          text: late ? `Overdue by ${-d} day${-d > 1 ? 's' : ''}` : relDate(b.dueDate) }),
        h('div', { class: 'row', style: { gap: '6px' } },
          h('button', { class: 'btn xs primary', text: 'Mark paid', onClick: e => { e.stopPropagation(); payBill(b, redraw); } }),
          h('button', { class: 'btn xs', text: 'Snooze', onClick: async e => {
            e.stopPropagation();
            await store.save('bills', { ...b, dueDate: addDays(b.dueDate, 7) });
            toast('Pushed back 7 days', 'ok'); redraw(); } }))));
    });
    body.append(grid);
  }

  body.append(h('div', { class: 'mt' }, dataTable([
    { key: 'name', label: 'Bill', render: r => h('div', {}, h('b', { text: r.name }),
      h('div', { class: 'row', style: { gap: '4px', marginTop: '3px' } }, tag(r.type || 'Other'),
        r.recurrence && r.recurrence !== 'none' ? tag((RECUR.find(x => x[0] === r.recurrence) || [, r.recurrence])[1], 'acc') : null,
        r.autopay ? tag('Autopay', 'info') : null)) },
    { key: 'amount', label: 'Amount', align: 'right', render: r => h('span', { class: 'num', style: { fontWeight: 650 }, text: fmtMoney(r.amount) }) },
    { key: 'dueDate', label: 'Due date', render: r => h('div', {}, h('div', { text: fmtDate(r.dueDate) }),
      h('div', { class: `tiny ${r.status !== 'paid' && r.dueDate < today() ? 'neg' : 't3'}`, text: relDate(r.dueDate) })) },
    { key: 'accountId', label: 'Account', value: r => store.accName(r.accountId),
      render: r => h('span', { class: 'tiny t2', text: store.accName(r.accountId) }) },
    { key: 'status', label: 'Status', render: r => r.status === 'paid' ? statusTag('paid')
      : r.dueDate < today() ? statusTag('overdue') : statusTag('unpaid') },
    { key: 'lastPaid', label: 'Last paid', render: r => r.lastPaid ? h('span', { class: 'tiny t3', text: fmtDate(r.lastPaid) }) : '—' },
  ], {
    rows, exportName: 'bills', pageSize: 20,
    searchFields: ['name', 'type'],
    emptyTitle: 'No bills', emptyMsg: 'Add rent, EMIs, utilities, insurance and subscriptions.', emptyIcon: 'clock',
    onRowClick: b => editBill(b, redraw),
    actions: b => [
      { label: 'Mark paid', icon: 'check', onClick: () => payBill(b, redraw) },
      { label: 'Edit', icon: 'edit', onClick: () => editBill(b, redraw) },
      { label: 'Snooze 7 days', icon: 'clock', onClick: async () => {
        await store.save('bills', { ...b, dueDate: addDays(b.dueDate, 7) }); redraw(); } },
      '-',
      { label: 'Delete', icon: 'trash', danger: true, onClick: async () => {
        if (await confirmDelete(b.name)) { await store.remove('bills', b.id); redraw(); } } },
    ],
    footRow: data => h('tr', {}, h('td', { class: 't3', text: `${data.length} bills` }),
      h('td', { class: 'right num', text: fmtMoney(money(data.reduce((a, b) => a + Number(b.amount || 0), 0))) }),
      h('td', { colspan: 4 })),
  }).el));

  return wrap;
}

/* ---------- month view ---------- */
function monthView(redraw) {
  let anchor = today();
  const wrap = h('div', {});
  const draw = () => {
    wrap.innerHTML = '';
    const first = startOfMonth(anchor);
    const dt = parseISO(first);
    const y = dt.getFullYear(), mo = dt.getMonth();
    const startPad = (dt.getDay() - (settings.firstDayOfWeek || 1) + 7) % 7;
    const total = daysInMonth(y, mo);
    const bills = state.bills.filter(b => monthKey(b.dueDate) === monthKey(first));
    const monthTotal = money(bills.reduce((a, b) => a + Number(b.amount || 0), 0));

    wrap.append(h('div', { class: 'row between mb' },
      h('div', { class: 'row', style: { gap: '6px' } },
        h('button', { class: 'btn sm', html: icon('left', 15), onClick: () => { anchor = addMonths(anchor, -1); draw(); } }),
        h('h3', { text: fmtDate(first, 'mon') }),
        h('button', { class: 'btn sm', html: icon('right', 15), onClick: () => { anchor = addMonths(anchor, 1); draw(); } }),
        h('button', { class: 'btn sm ghost', text: 'Today', onClick: () => { anchor = today(); draw(); } })),
      h('span', { class: 'num t2', text: `${bills.length} bills · ${fmtMoney(monthTotal)}` })));

    const cal = h('div', { class: 'cal' });
    const dows = [...DOW.slice(settings.firstDayOfWeek || 1), ...DOW.slice(0, settings.firstDayOfWeek || 1)];
    dows.forEach(d => cal.append(h('div', { class: 'dow', text: d })));
    for (let i = 0; i < startPad; i++) cal.append(h('div', { class: 'day out' }));
    for (let day = 1; day <= total; day++) {
      const iso = `${y}-${pad2(mo + 1)}-${pad2(day)}`;
      const dayBills = bills.filter(b => b.dueDate === iso);
      const cell = h('div', { class: `day ${iso === today() ? 'today' : ''}`, onClick: () => editBill(null, redraw, iso) },
        h('div', { class: 'dn', text: String(day) }));
      dayBills.slice(0, 3).forEach(b => cell.append(h('div', { class: `ev ${b.status === 'paid' ? 'inc' : 'bill'}`,
        title: `${b.name} · ${fmtMoney(b.amount)}`,
        onClick: e => { e.stopPropagation(); editBill(b, redraw); }, text: `${b.name} ${fmtMoney(b.amount, undefined, { compact: true })}` })));
      if (dayBills.length > 3) cell.append(h('div', { class: 'more', text: `+${dayBills.length - 3} more` }));
      cal.append(cell);
    }
    wrap.append(cal);
  };
  draw();
  return wrap;
}

/* ---------- history ---------- */
function historyPanel() {
  const paid = state.transactions.filter(t => (t.tags || []).includes('bill'));
  const byMonth = monthRange(addMonths(today(), -11), today()).map(mk =>
    money(paid.filter(t => t.month === mk).reduce((a, t) => a + t.base, 0)));
  return h('div', {},
    card('Bill payments — last 12 months', barChart([{ name: 'Paid', color: 'var(--accent)', values: byMonth }],
      monthRange(addMonths(today(), -11), today()).map(fmtMonthKey), { height: 230 })),
    h('div', { class: 'mt' }, dataTable([
      { key: 'date', label: 'Paid on', render: r => fmtDate(r.date) },
      { key: 'notes', label: 'Bill' },
      { key: 'categoryId', label: 'Category', value: r => store.catName(r.categoryId) },
      { key: 'accountId', label: 'From', value: r => store.accName(r.accountId) },
      { key: 'base', label: 'Amount', align: 'right', render: r => h('span', { class: 'num', text: fmtMoney(r.base) }) },
    ], { rows: sortBy(paid, t => t.date, -1), pageSize: 20, exportName: 'bill-payments',
      emptyTitle: 'No bill payments recorded', emptyMsg: 'Marking a bill as paid records the payment here.', emptyIcon: 'check' }).el));
}

/* ---------- editor ---------- */
function editBill(b, redraw, presetDate) {
  const { modal: m } = formModal({
    title: b ? `Edit ${b.name}` : 'New bill', size: 'wide', columns: 2,
    values: b || { dueDate: presetDate || addDays(today(), 7), recurrence: 'monthly', status: 'unpaid' },
    fields: [
      { key: 'name', label: 'Bill name', type: 'text', required: true, col: 'full', placeholder: 'e.g. House rent, Netflix, Car EMI' },
      { key: 'type', label: 'Type', type: 'select', required: true, options: BILL_TYPES },
      { key: 'amount', label: 'Amount', type: 'money', required: true },
      { key: 'dueDate', label: 'Due date', type: 'date', required: true },
      { key: 'recurrence', label: 'Repeats', type: 'select', options: RECUR },
      { key: 'accountId', label: 'Pay from', type: 'select', options: accountOptions() },
      { key: 'categoryId', label: 'Expense category', type: 'select', options: categoryOptions('expense'), placeholder: 'Select…' },
      { key: 'autopay', label: 'Automatically debited by the provider', type: 'switch', col: 'full' },
      { key: 'lateFee', label: 'Late fee if missed', type: 'money' },
      { key: 'reminderDays', label: 'Remind me days before', type: 'number', value: 3, min: 0, max: 30 },
      { key: 'notes', label: 'Notes', type: 'textarea', col: 'full' },
      { key: 'attachments', label: 'Bill copy / invoice', type: 'attach', col: 'full' },
    ],
    extraFooter: b ? frag(
      h('button', { class: 'btn pos', html: `${icon('check', 15)} Mark paid`, onClick: () => { m.close(); payBill(b, redraw); } }),
      h('button', { class: 'btn danger', html: `${icon('trash', 15)}`, onClick: async () => {
        if (await confirmDelete(b.name)) { await store.remove('bills', b.id); m.close(); redraw(); } } })) : null,
    onSubmit: async v => {
      await store.save('bills', { ...(b || {}), ...v });
      m.close(); toast(b ? 'Bill updated' : 'Bill added', 'ok'); redraw();
    },
  });
}

/* ---------- pay ---------- */
function payBill(b, redraw) {
  const { modal: m } = formModal({
    title: `Pay ${b.name}`, subtitle: `Due ${fmtDate(b.dueDate)}`, size: '', columns: 2,
    values: { amount: b.amount, date: today(), accountId: b.accountId, createTxn: true },
    fields: [
      { key: 'amount', label: 'Amount paid', type: 'money', required: true, big: true, col: 'full' },
      { key: 'date', label: 'Payment date', type: 'date', required: true },
      { key: 'accountId', label: 'Paid from', type: 'select', options: accountOptions(), required: true },
      { key: 'method', label: 'Method', type: 'select', options: store.PAYMENT_METHODS },
      { key: 'createTxn', label: 'Record this as an expense in the tracker', type: 'switch', col: 'full' },
      { key: 'notes', label: 'Note', type: 'text', col: 'full' },
    ],
    onSubmit: async v => {
      if (v.createTxn) {
        await store.save('transactions', {
          type: 'expense', amount: Number(v.amount), currency: settings.baseCurrency, rate: 1,
          accountId: v.accountId, categoryId: b.categoryId, date: v.date, status: 'cleared',
          paymentMethod: v.method, notes: v.notes || b.name, tags: ['bill'],
        });
      }
      const nextDue = b.recurrence && b.recurrence !== 'none' ? nextOccurrence(b.dueDate, b.recurrence) : null;
      await store.save('bills', { ...b, status: nextDue ? 'unpaid' : 'paid', lastPaid: v.date,
        dueDate: nextDue || b.dueDate });
      m.close();
      toast(nextDue ? `Paid · next due ${fmtDate(nextDue)}` : 'Bill marked as paid', 'ok');
      redraw();
    },
  });
}
