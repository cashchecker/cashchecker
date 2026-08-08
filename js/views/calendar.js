/* ═══════════ views/calendar.js — financial calendar & timeline ═══════════ */

import {
  h, frag, icon, card, stat, tag, empty, toast, modal, store, state, settings,
  fmtMoney, fmtDate, today, sortBy, pageHead, kpiGrid, openTxnModal, amountCell, relDate,
} from './common.js';
import { barChart, lineChart } from '../charts.js';
import { dailySeries, billsDue, creditOutstanding, investmentMetrics } from '../store.js';
import {
  money, addDays, addMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, parseISO, pad2,
  daysInMonth, DOW, monthKey, dayRange, daysBetween, colorFor, fmtMonthKey,
} from '../util.js';

export async function render(root, api) {
  let view = sessionStorage.getItem('cal.view') || 'month';
  let anchor = today();
  const draw = () => {
    root.innerHTML = '';
    root.append(build(view, anchor, {
      setView: v => { view = v; sessionStorage.setItem('cal.view', v); draw(); },
      move: n => { anchor = view === 'day' ? addDays(anchor, n) : view === 'week' ? addDays(anchor, n * 7) : addMonths(anchor, n); draw(); },
      goToday: () => { anchor = today(); draw(); },
      redraw: draw,
    }, api));
  };
  draw();
  return store.bus.on('change', ({ store: s }) => { if (['transactions', 'bills', 'credits', 'investments', 'reminders'].includes(s)) draw(); });
}

/** All financial events on a given date, from every module. */
function eventsOn(dateISO) {
  const out = [];
  state.transactions.filter(t => t.date === dateISO).forEach(t => out.push({
    kind: t.type === 'income' ? 'inc' : t.type === 'transfer' ? 'inv' : 'exp',
    label: t.notes || store.catName(t.categoryId), amount: t.base, ref: t, type: 'transaction',
    sub: `${store.catName(t.categoryId)} · ${store.accName(t.accountId)}` }));
  state.bills.filter(b => b.dueDate === dateISO).forEach(b => out.push({
    kind: 'bill', label: `${b.name}${b.status === 'paid' ? ' (paid)' : ''}`, amount: Number(b.amount) || 0,
    ref: b, type: 'bill', sub: `${b.type || 'Bill'} due` }));
  state.credits.filter(c => c.dueDate === dateISO && creditOutstanding(c) > 0.004).forEach(c => out.push({
    kind: 'bill', label: `${store.contactName(c.contactId)} — ${c.direction === 'given' ? 'collect' : 'pay'}`,
    amount: creditOutstanding(c), ref: c, type: 'credit', sub: 'Credit book due date' }));
  state.investments.filter(i => i.maturityDate === dateISO || i.dueDate === dateISO).forEach(i => out.push({
    kind: 'inv', label: `${i.name} ${i.maturityDate === dateISO ? 'matures' : 'payout due'}`,
    amount: investmentMetrics(i).current, ref: i, type: 'investment', sub: i.category }));
  state.recurring.filter(r => r.active && r.nextRun === dateISO).forEach(r => out.push({
    kind: r.template?.type === 'income' ? 'inc' : 'exp', label: `${r.name} (scheduled)`,
    amount: Number(r.template?.amount) || 0, ref: r, type: 'recurring', sub: 'Recurring transaction' }));
  state.goals.filter(g => g.deadline === dateISO).forEach(g => out.push({
    kind: 'inv', label: `${g.name} deadline`, amount: Number(g.target) || 0, ref: g, type: 'goal', sub: 'Savings goal target date' }));
  state.reminders.filter(r => !r.done && (r.dueAt || r.date) === dateISO).forEach(r => out.push({
    kind: 'rem', label: r.title || 'Reminder', amount: 0, ref: r, type: 'reminder',
    sub: r.notes || 'Personal reminder' }));
  return out;
}

function build(view, anchor, ctl, api) {
  const wrap = h('div', {});
  const range = view === 'day' ? { from: anchor, to: anchor }
    : view === 'week' ? { from: startOfWeek(anchor, settings.firstDayOfWeek || 1), to: endOfWeek(anchor, settings.firstDayOfWeek || 1) }
    : { from: startOfMonth(anchor), to: endOfMonth(anchor) };
  const label = view === 'day' ? fmtDate(anchor, 'long')
    : view === 'week' ? `${fmtDate(range.from, 'short')} – ${fmtDate(range.to, 'long')}`
    : fmtDate(anchor, 'mon');
  api.setSubtitle(label);

  const days = dayRange(range.from, range.to);
  const allEvents = days.flatMap(d => eventsOn(d).map(e => ({ ...e, date: d })));
  const income = money(allEvents.filter(e => e.type === 'transaction' && e.ref.type === 'income').reduce((a, e) => a + e.amount, 0));
  const expense = money(allEvents.filter(e => e.type === 'transaction' && e.ref.type === 'expense').reduce((a, e) => a + e.amount, 0));
  const dueTotal = money(allEvents.filter(e => e.type === 'bill' || e.type === 'credit').reduce((a, e) => a + e.amount, 0));

  wrap.append(pageHead('Calendar', 'Every dated commitment in one timeline — transactions, bills, receivables, maturities and goal deadlines.',
    h('div', { class: 'seg' }, ...[['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['timeline', 'Timeline']].map(([v, l]) =>
      h('button', { class: view === v ? 'on' : '', text: l, onClick: () => ctl.setView(v) }))),
    h('button', { class: 'btn primary', html: `${icon('plus', 16)} Add on ${view === 'day' ? 'this day' : 'today'}`,
      onClick: () => openTxnModal(null, { defaultDate: view === 'day' ? anchor : today(), onSaved: ctl.redraw }) })));

  wrap.append(kpiGrid(
    stat({ label: 'Income in view', value: fmtMoney(income), icon: 'trend', tone: 'pos' }),
    stat({ label: 'Expense in view', value: fmtMoney(expense), icon: 'swap', tone: 'neg' }),
    stat({ label: 'Net', value: fmtMoney(income - expense), icon: 'wallet', tone: income - expense >= 0 ? 'pos' : 'neg' }),
    stat({ label: 'Due / scheduled', value: fmtMoney(dueTotal), icon: 'clock', tone: 'warn',
      foot: h('span', { class: 't3', text: `${allEvents.filter(e => e.type !== 'transaction').length} upcoming items` }) })));

  if (view === 'timeline') { wrap.append(h('div', { class: 'mt' }, timelinePanel(ctl))); return wrap; }

  /* navigation */
  wrap.append(h('div', { class: 'row between mt mb' },
    h('div', { class: 'row', style: { gap: '6px' } },
      h('button', { class: 'btn sm', html: icon('left', 15), onClick: () => ctl.move(-1) }),
      h('h3', { style: { minWidth: '190px', textAlign: 'center' }, text: label }),
      h('button', { class: 'btn sm', html: icon('right', 15), onClick: () => ctl.move(1) })),
    h('button', { class: 'btn sm ghost', text: 'Today', onClick: ctl.goToday })));

  if (view === 'month') wrap.append(monthGrid(anchor, ctl));
  else if (view === 'week') wrap.append(weekView(range, ctl));
  else wrap.append(dayView(anchor, ctl));

  /* daily net chart for the range */
  if (view !== 'day') {
    const series = dailySeries(range.from, range.to);
    wrap.append(h('div', { class: 'mt' }, card('Daily net flow',
      barChart([{ name: 'Net', color: 'var(--accent)', values: series.map(s => s.net) }],
        series.map(s => fmtDate(s.key, 'short')), { height: 200 }))));
  }
  return wrap;
}

/* ---------- month grid ---------- */
function monthGrid(anchor, ctl) {
  const first = startOfMonth(anchor);
  const d0 = parseISO(first);
  const y = d0.getFullYear(), mo = d0.getMonth();
  const fdow = settings.firstDayOfWeek || 1;
  const startPad = (d0.getDay() - fdow + 7) % 7;
  const total = daysInMonth(y, mo);
  const cal = h('div', { class: 'cal' });
  [...DOW.slice(fdow), ...DOW.slice(0, fdow)].forEach(d => cal.append(h('div', { class: 'dow', text: d })));
  for (let i = 0; i < startPad; i++) {
    const prev = addDays(first, -(startPad - i));
    cal.append(h('div', { class: 'day out' }, h('div', { class: 'dn', text: String(parseISO(prev).getDate()) })));
  }
  for (let day = 1; day <= total; day++) {
    const iso = `${y}-${pad2(mo + 1)}-${pad2(day)}`;
    const evs = eventsOn(iso);
    const net = money(evs.filter(e => e.type === 'transaction')
      .reduce((a, e) => a + (e.ref.type === 'income' ? e.amount : e.ref.type === 'expense' ? -e.amount : 0), 0));
    const cell = h('div', { class: `day ${iso === today() ? 'today' : ''}`,
      onClick: () => dayModal(iso, ctl) },
      h('div', { class: 'row between' },
        h('div', { class: 'dn', text: String(day) }),
        net ? h('span', { class: `tiny num ${net > 0 ? 'pos' : 'neg'}`, text: fmtMoney(net, undefined, { compact: true }) }) : null));
    evs.slice(0, 3).forEach(e => cell.append(h('div', { class: `ev ${e.kind}`,
      title: e.type === 'reminder' ? e.label : `${e.label} · ${fmtMoney(e.amount)}`,
      text: `${e.label}` })));
    if (evs.length > 3) cell.append(h('div', { class: 'more', text: `+${evs.length - 3} more` }));
    cal.append(cell);
  }
  const trailing = (7 - ((startPad + total) % 7)) % 7;
  for (let i = 0; i < trailing; i++) cal.append(h('div', { class: 'day out' }, h('div', { class: 'dn', text: String(i + 1) })));
  return cal;
}

/* ---------- week ---------- */
function weekView(range, ctl) {
  const grid = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(7,minmax(0,1fr))', gap: '10px' } });
  dayRange(range.from, range.to).forEach(d => {
    const evs = eventsOn(d);
    const net = money(evs.filter(e => e.type === 'transaction')
      .reduce((a, e) => a + (e.ref.type === 'income' ? e.amount : e.ref.type === 'expense' ? -e.amount : 0), 0));
    const col = h('div', { class: 'card pad', style: { padding: '11px', minHeight: '190px', cursor: 'pointer',
      borderColor: d === today() ? 'var(--accent)' : undefined },
      onClick: () => dayModal(d, ctl) },
      h('div', { class: 'row between mb' },
        h('div', {}, h('div', { class: 'up', text: DOW[parseISO(d).getDay()] }),
          h('div', { style: { fontWeight: 700, fontSize: '1.05rem' }, text: String(parseISO(d).getDate()) })),
        net ? h('span', { class: `tiny num ${net > 0 ? 'pos' : 'neg'}`, text: fmtMoney(net, undefined, { compact: true }) }) : null));
    if (!evs.length) col.append(h('div', { class: 'tiny t3', text: 'Nothing scheduled' }));
    evs.slice(0, 6).forEach(e => col.append(h('div', { class: `ev ${e.kind}`, style: { marginBottom: '3px' },
      text: e.type === 'reminder' ? e.label : `${e.label} ${fmtMoney(e.amount, undefined, { compact: true })}` })));
    if (evs.length > 6) col.append(h('div', { class: 'more', text: `+${evs.length - 6}` }));
    grid.append(col);
  });
  return grid;
}

/* ---------- day ---------- */
function dayView(dateISO, ctl) {
  const evs = eventsOn(dateISO);
  if (!evs.length) return empty('Nothing on this day', 'No transactions, bills or due dates recorded.', 'calendar',
    h('button', { class: 'btn primary sm mt', onClick: () => openTxnModal(null, { defaultDate: dateISO, onSaved: ctl.redraw }) }, 'Add a transaction'));
  const list = h('div', { class: 'card' });
  sortBy(evs, e => (e.ref.time || '99:99')).forEach(e => {
    list.append(h('div', { class: 'lst-item', style: { cursor: e.type === 'transaction' ? 'pointer' : 'default' },
      onClick: () => { if (e.type === 'transaction') openTxnModal(e.ref, { onSaved: ctl.redraw }); } },
      h('div', { class: 'avatar', style: { background: kindColor(e.kind) + '22', color: kindColor(e.kind) },
        html: icon(e.type === 'bill' ? 'clock' : e.type === 'credit' ? 'book' : e.type === 'investment' ? 'trend' : e.type === 'goal' ? 'flame' : e.type === 'reminder' ? 'bell' : 'swap', 16) }),
      h('div', { class: 'lst-main' }, h('div', { class: 't ell', text: e.label }),
        h('div', { class: 's', text: `${e.sub}${e.ref.time ? ` · ${e.ref.time}` : ''}` })),
      h('div', { class: 'lst-amt' },
        e.type === 'reminder'
          ? h('span', { class: 'tiny t3', text: 'Reminder' })
          : h('span', { class: `num ${e.kind === 'inc' ? 'pos' : e.kind === 'exp' ? 'neg' : ''}`,
              text: `${e.kind === 'inc' ? '+' : e.kind === 'exp' ? '−' : ''}${fmtMoney(e.amount)}` }))));
  });
  return list;
}
const kindColor = k => ({ inc: '#10b981', exp: '#f43f5e', bill: '#f59e0b', inv: '#7c5cff', rem: '#0ea5e9' }[k] || '#94a3b8');

/* ---------- day modal ---------- */
function dayModal(dateISO, ctl) {
  const evs = eventsOn(dateISO);
  const m = modal({
    title: fmtDate(dateISO, 'long'),
    subtitle: `${evs.length} item${evs.length === 1 ? '' : 's'} · ${relDate(dateISO)}`,
    body: evs.length ? dayView(dateISO, { ...ctl, redraw: () => { m.close(); ctl.redraw(); } })
      : empty('Nothing scheduled', 'Add a transaction to this date.', 'calendar'),
    footer: frag(h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onClick: () => m.close() }, 'Close'),
      h('button', { class: 'btn primary', onClick: () => { m.close(); openTxnModal(null, { defaultDate: dateISO, onSaved: ctl.redraw }); } },
        'Add transaction')),
  });
}

/* ---------- timeline ---------- */
function timelinePanel(ctl) {
  const from = today(), to = addDays(today(), 120);
  const items = dayRange(from, to).flatMap(d => eventsOn(d).filter(e => e.type !== 'transaction').map(e => ({ ...e, date: d })));
  const wrap = h('div', {});
  if (!items.length) return empty('Nothing ahead', 'No bills, due dates, maturities or goal deadlines in the next 120 days.', 'check');

  let lastMonth = '';
  const tl = h('div', { class: 'timeline' });
  sortBy(items, i => i.date).forEach(i => {
    const mk = monthKey(i.date);
    if (mk !== lastMonth) { lastMonth = mk; tl.append(h('div', { class: 'up', style: { margin: '14px 0 9px' }, text: fmtMonthKey(mk) })); }
    tl.append(h('div', { class: `tl-item ${i.kind === 'bill' ? 'warn' : i.kind === 'inc' ? 'pos' : ''}` },
      h('div', { class: 'row between' },
        h('div', {}, h('b', { style: { fontSize: '.87rem' }, text: i.label }),
          h('div', { class: 'tiny t3', text: `${fmtDate(i.date)} · ${relDate(i.date)} · ${i.sub}` })),
        i.type === 'reminder'
          ? h('span', { class: 'tiny t3', text: 'Reminder' })
          : h('span', { class: 'num', style: { fontWeight: 650 }, text: fmtMoney(i.amount) }))));
  });
  wrap.append(h('div', { class: 'card pad' }, tl));
  return wrap;
}
