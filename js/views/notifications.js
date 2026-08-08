/* ═══════════ views/notifications.js — alert centre & automation ═══════════ */

import {
  h, frag, icon, card, stat, tag, empty, toast, confirm, modal, formModal, store, state, settings,
  fmtMoney, fmtDate, today, sortBy, pageHead, kpiGrid,
} from './common.js';
import { dataTable } from '../ui.js';
import { relTime, money, addDays, RECUR, groupBy } from '../util.js';

export async function render(root, api) {
  let tab = 'all';
  const draw = () => { root.innerHTML = ''; root.append(build(tab, t => { tab = t; draw(); }, draw, api)); };
  draw();
  return store.bus.on('change', ({ store: s }) => { if (['notifications', 'recurring'].includes(s)) draw(); });
}

const TABS = [['all', 'All alerts'], ['unread', 'Unread'], ['automation', 'Automation'], ['audit', 'Audit log']];

function build(tab, setTab, redraw, api) {
  const wrap = h('div', {});
  const rows = sortBy(state.notifications, n => n.at, -1);
  const unread = rows.filter(n => !n.read);
  api.setSubtitle(`${unread.length} unread of ${rows.length}`);

  wrap.append(pageHead('Notifications', 'Everything the system noticed — due dates, budget limits, overdue receivables and automated actions.',
    h('button', { class: 'btn', html: `${icon('repeat', 16)} Re-scan now`, onClick: async () => {
      await store.refreshAlerts();
      const n = await store.runRecurring();
      toast(`Scan complete${n ? ` · ${n} recurring transactions posted` : ''}`, 'ok'); redraw();
    } }),
    unread.length ? h('button', { class: 'btn', html: `${icon('check', 16)} Mark all read`,
      onClick: async () => { await store.markAllRead(); redraw(); } }) : null,
    rows.length ? h('button', { class: 'btn danger', html: `${icon('trash', 16)} Clear`, onClick: async () => {
      if (await confirm({ title: 'Clear all notifications?', danger: true, confirmText: 'Clear',
        message: 'Alerts will be regenerated on the next scan if the underlying conditions still apply.' })) {
        await store.removeMany('notifications', rows.map(r => r.id)); toast('Cleared', 'ok'); redraw();
      } } }) : null));

  const byType = [...groupBy(rows, n => n.type)];
  wrap.append(kpiGrid(
    stat({ label: 'Unread', value: String(unread.length), icon: 'bell', tone: unread.length ? 'warn' : 'pos' }),
    stat({ label: 'Critical', value: String(rows.filter(n => n.level === 'danger').length), icon: 'alert', tone: 'neg',
      foot: h('span', { class: 't3', text: 'Overdue bills and receivables' }) }),
    stat({ label: 'Active automations', value: String(state.recurring.filter(r => r.active).length), icon: 'repeat', tone: 'info',
      foot: h('span', { class: 't3', text: `${state.recurring.length} total rules` }) }),
    stat({ label: 'Audit entries', value: String(state.audit.length), icon: 'file',
      foot: h('span', { class: 't3', text: 'Every change is logged locally' }) })));

  const tabsEl = h('div', { class: 'tabs mt mb' });
  TABS.forEach(([v, l]) => tabsEl.append(h('button', { class: v === tab ? 'on' : '', text: l, onClick: () => setTab(v) })));
  wrap.append(tabsEl);

  if (tab === 'automation') { wrap.append(automationPanel(redraw)); return wrap; }
  if (tab === 'audit') { wrap.append(auditPanel()); return wrap; }

  const list = tab === 'unread' ? unread : rows;
  if (!list.length) { wrap.append(empty('Nothing here', 'You are all caught up.', 'check')); return wrap; }

  const feed = h('div', { class: 'col' });
  list.slice(0, 200).forEach(n => {
    feed.append(h('div', { class: `insight ${n.level === 'danger' ? 'neg' : n.level === 'warn' ? 'warn' : ''}`,
      style: { opacity: n.read ? .68 : 1, cursor: n.route ? 'pointer' : 'default' },
      onClick: () => { if (n.route) api.navigate(n.route.replace('#/', '')); } },
      h('div', { class: 'ic', html: icon(iconFor(n.type), 15) }),
      h('div', { class: 'tt', style: { flex: 1 } },
        h('b', { text: n.title }),
        h('p', { text: n.body || '' }),
        h('div', { class: 'tiny t3', style: { marginTop: '3px' }, text: `${relTime(n.at)} · ${n.type || 'system'}` })),
      h('button', { class: 'icon-btn', html: icon('trash', 15), onClick: async e => {
        e.stopPropagation(); await store.remove('notifications', n.id); redraw(); } })));
  });
  wrap.append(feed);
  if (byType.length) wrap.append(h('div', { class: 'row wrap mt', style: { gap: '6px' } },
    ...byType.map(([t, r]) => tag(`${t || 'system'}: ${r.length}`))));
  return wrap;
}

const iconFor = t => ({ bill: 'clock', budget: 'target', credit: 'book', investment: 'trend', digest: 'sparkle' }[t] || 'bell');

/* ---------- automation ---------- */
function automationPanel(redraw) {
  const wrap = h('div', {});
  const cards = [
    ['Recurring transactions', `${state.recurring.filter(r => r.active).length} active`, 'repeat',
      'Posts scheduled income and expenses automatically on their due date — even if the app was closed for weeks, missed occurrences are caught up on next launch.'],
    ['Bill roll-forward', `${state.bills.filter(b => b.recurrence && b.recurrence !== 'none').length} recurring bills`, 'clock',
      'When a recurring bill is marked paid, the next due date is scheduled automatically based on its frequency.'],
    ['Budget monitoring', settings.notifyBudget ? 'Enabled' : 'Disabled', 'target',
      'Warns at 80% of any limit and raises a critical alert when a budget is exceeded.'],
    ['Due-date reminders', settings.notifyBills ? `${settings.billLeadDays} days ahead` : 'Disabled', 'bell',
      'Alerts before bills fall due and escalates once they are overdue.'],
    ['Credit collection', settings.notifyCredit ? 'Enabled' : 'Disabled', 'book',
      'Flags receivables approaching or past their due date so nothing slips.'],
    ['Auto-categorisation', settings.autoCategorize ? 'Enabled' : 'Disabled', 'sparkle',
      'Rules run first, then an on-device naive-Bayes model trained on your own history suggests the category.'],
    ['Daily digest', settings.notifyDigest ? 'Enabled' : 'Disabled', 'file',
      'A once-a-day summary of money in, money out and what is due.'],
    ['Investment maturity watch', 'Always on', 'trend',
      'Notifies a week before any investment reaches its maturity date.'],
  ];
  wrap.append(h('div', { class: 'grid auto-lg mb' }, ...cards.map(([title, status, ic, desc]) =>
    h('div', { class: 'card pad' },
      h('div', { class: 'row between mb' },
        h('div', { class: 'row', style: { gap: '9px' } },
          h('div', { class: 'avatar', style: { background: 'var(--accent-soft)', color: 'var(--accent)' }, html: icon(ic, 16) }),
          h('b', { text: title })),
        tag(status, /disabled/i.test(status) ? '' : 'pos')),
      h('p', { class: 'tiny t2', text: desc })))));

  wrap.append(h('div', { class: 'row between mb' }, h('h3', { text: 'Recurring rules' }),
    h('button', { class: 'btn sm', html: `${icon('repeat', 15)} Run pending now`, onClick: async () => {
      const n = await store.runRecurring();
      toast(n ? `${n} transactions posted` : 'Nothing due right now', n ? 'ok' : 'info'); redraw(); } })));

  wrap.append(dataTable([
    { key: 'name', label: 'Rule', render: r => h('div', {}, h('b', { text: r.name || 'Recurring' }),
      h('div', { class: 'tiny t3', text: `${r.template?.type === 'income' ? 'Income' : 'Expense'} · ${store.catName(r.template?.categoryId)} · ${store.accName(r.template?.accountId)}` })) },
    { key: 'rule', label: 'Frequency', render: r => tag((RECUR.find(x => x[0] === r.rule) || [, r.rule])[1], 'acc') },
    { key: 'amount', label: 'Amount', align: 'right', value: r => r.template?.amount || 0,
      render: r => h('span', { class: 'num', text: fmtMoney(r.template?.amount || 0) }) },
    { key: 'nextRun', label: 'Next run', render: r => r.nextRun ? h('div', {}, h('div', { text: fmtDate(r.nextRun) }),
      h('div', { class: 'tiny t3', text: r.nextRun <= today() ? 'due now' : '' })) : tag('Ended') },
    { key: 'lastRun', label: 'Last run', render: r => r.lastRun ? fmtDate(r.lastRun) : h('span', { class: 't3', text: 'never' }) },
    { key: 'active', label: 'Status', render: r => tag(r.active ? 'Active' : 'Paused', r.active ? 'pos' : '') },
  ], {
    rows: state.recurring, exportName: 'automation-rules', pageSize: 20,
    emptyTitle: 'No automations yet',
    emptyMsg: 'Tick “Repeat” when creating a transaction, or use “Make recurring” from any transaction row menu.',
    emptyIcon: 'repeat',
    actions: r => [
      { label: r.active ? 'Pause' : 'Resume', icon: 'repeat', onClick: async () => {
        await store.save('recurring', { ...r, active: !r.active }); redraw(); } },
      { label: 'Delete', icon: 'trash', danger: true, onClick: async () => {
        if (await confirm({ title: 'Delete this rule?', danger: true, confirmText: 'Delete',
          message: 'Transactions already posted by it are kept.' })) { await store.remove('recurring', r.id); redraw(); } } },
    ],
  }).el);
  return wrap;
}

/* ---------- audit ---------- */
function auditPanel() {
  const rows = sortBy(state.audit, a => a.at, -1);
  const wrap = h('div', {});
  wrap.append(h('div', { class: 'insight mb' }, h('div', { class: 'ic', html: icon('shield', 15) }),
    h('div', { class: 'tt' }, h('b', { text: 'Tamper-evident local audit trail' }),
      h('p', { text: 'Every create, update, delete, import, unlock and automated action is recorded with a timestamp. The log stays on this device and is capped at 4,000 entries.' }))));

  wrap.append(dataTable([
    { key: 'at', label: 'When', value: r => r.at, render: r => h('div', {},
      h('div', { class: 'tiny', text: new Date(r.at).toLocaleString() }),
      h('div', { class: 'tiny t3', text: relTime(r.at) })) },
    { key: 'action', label: 'Action', render: r => tag(r.action, r.action === 'delete' ? 'neg'
      : r.action === 'create' ? 'pos' : r.action.startsWith('auth') ? 'info' : '') },
    { key: 'entity', label: 'Module' },
    { key: 'detail', label: 'Detail', render: r => h('span', { class: 'tiny t2 ell', style: { display: 'inline-block', maxWidth: '360px' }, text: r.detail || '—' }) },
  ], { rows, exportName: 'audit-log', pageSize: 30, defaultSort: { key: 'at', dir: -1 },
    emptyTitle: 'No audit entries', emptyMsg: 'Activity is logged from your first change.', emptyIcon: 'file' }).el);
  return wrap;
}
