/* ═══════════ views/reminders.js — Calendar & Reminders ═══════════ */

import {
  h, frag, icon, card, stat, tag, empty, toast, confirm, modal, formModal,
  store, state, settings, fmtMoney, fmtDate, today, sortBy, pageHead, kpiGrid, confirmDelete,
} from './common.js';
import { money, addDays, daysBetween, relDate, dayRange, fmtMonthKey, monthKey, DOW, pad2, parseISO } from '../util.js';

const TABS = [
  ['upcoming', 'Upcoming'],
  ['overdue', 'Overdue'],
  ['done', 'Done'],
  ['rules', 'Rules'],
];

const LEVELS = [
  ['info', 'Info'],
  ['warn', 'Warning'],
  ['danger', 'Critical'],
];

const FREQUENCIES = [
  ['none', 'One-time'],
  ['daily', 'Daily'],
  ['weekly', 'Weekly'],
  ['monthly', 'Monthly'],
  ['yearly', 'Yearly'],
];

/* ============================ render ============================ */
export async function render(root, api) {
  let tab = 'upcoming';
  const draw = () => { root.innerHTML = ''; root.append(build(tab, t => { tab = t; draw(); }, draw, api)); };
  draw();
  return store.bus.on('change', ({ store: s }) => { if (['reminders', 'reminderRules', 'notifications'].includes(s)) draw(); });
}

/* ============================ build ============================ */
function build(tab, setTab, redraw, api) {
  const wrap = h('div', {});
  const day = today();

  const upcoming = state.reminders.filter(r => !r.done && (r.dueAt || r.date) >= day).sort((a, b) => (a.dueAt || a.date) - (b.dueAt || b.date));
  const overdue  = state.reminders.filter(r => !r.done && (r.dueAt || r.date) < day).sort((a, b) => (a.dueAt || a.date) - (b.dueAt || b.date));
  const done     = state.reminders.filter(r => r.done).sort((a, b) => b.doneAt - a.doneAt);
  const rules    = state.reminderRules;

  wrap.append(pageHead('Calendar & Reminders', 'Track upcoming due dates, deadlines and personal reminders alongside your bills and goals.',
    h('button', { class: 'btn primary', html: `${icon('plus', 16)} Add reminder`, onClick: () => editReminder(null, redraw) })));

  wrap.append(kpiGrid(
    stat({ label: 'Upcoming', value: String(upcoming.length), icon: 'calendar', tone: upcoming.length ? 'info' : 'pos' }),
    stat({ label: 'Overdue', value: String(overdue.length), icon: 'alert', tone: overdue.length ? 'neg' : 'pos' }),
    stat({ label: 'Completed', value: String(done.length), icon: 'check', tone: done.length ? 'info' : '' }),
    stat({ label: 'Rules', value: String(rules.filter(r => r.active).length), icon: 'repeat',
      foot: h('span', { class: 't3', text: `${rules.length} total` }) }),
  ));

  const tabsEl = h('div', { class: 'tabs mt mb' });
  TABS.forEach(([v, l]) => tabsEl.append(h('button', { class: v === tab ? 'on' : '', text: l, onClick: () => setTab(v) })));
  wrap.append(tabsEl);

  if (tab === 'rules') { wrap.append(rulesPanel(redraw)); return wrap; }

  const rows = tab === 'upcoming' ? upcoming : tab === 'overdue' ? overdue : done;
  if (!rows.length) { wrap.append(empty(tab === 'done' ? 'Nothing here' : 'Nothing due', tab === 'done' ? 'No completed reminders yet.' : 'Add one to stay on top of what matters.', 'calendar',
    tab === 'done' ? null : h('button', { class: 'btn primary sm mt', onClick: () => editReminder(null, redraw) }, 'Add reminder'))); return wrap; }

  const list = h('div', { class: 'col' });
  rows.forEach(r => {
    const isOverdue = !r.done && (r.dueAt || r.date) < day;
    const isToday   = !r.done && (r.dueAt || r.date) === day;
    list.append(h('div', { class: `card pad reminder-card${isOverdue ? ' overdue' : ''}${isToday ? ' today' : ''}`,
      style: isOverdue ? { borderLeft: '3px solid var(--neg)' } : isToday ? { borderLeft: '3px solid var(--warn)' } : undefined },
      h('div', { class: 'row between mb' },
        h('div', { class: 'row', style: { gap: '8px' } },
          h('div', { class: 'avatar', style: { background: (isOverdue ? '#f43f5e22' : isToday ? '#f59e0b22' : '#10b98122'), color: (isOverdue ? '#f43f5e' : isToday ? '#f59e0b' : '#10b981') }, html: icon(isOverdue ? 'alert' : isToday ? 'clock' : 'check', 16) }),
          h('div', {}, h('b', { text: r.title || 'Reminder' }),
            r.notes ? h('div', { class: 'tiny t2', text: r.notes }) : null)),
        h('div', { class: 'row', style: { gap: '6px' } },
          tag(levelLabel(r.level || 'info'), levelCls(r.level || 'info')),
          isOverdue ? tag('Overdue', 'neg') : isToday ? tag('Today', 'warn') : null)),
      h('div', { class: 'row between mt' },
        h('div', { class: 'tiny t2', text: `${fmtDate(r.dueAt || r.date, 'long')} · ${relDate(r.dueAt || r.date)}${r.recurrence && r.recurrence !== 'none' ? ' · ' + (FREQUENCIES.find(x => x[0] === r.recurrence) || ['', r.recurrence])[1] : ''}` }),
        h('div', { class: 'row', style: { gap: '4px' } },
          !r.done ? h('button', { class: 'btn xs primary', text: 'Done', onClick: async () => { await store.markReminderDone(r.id); toast('Reminder marked done', 'ok'); redraw(); } }) : null,
          h('button', { class: 'btn xs', html: icon('edit', 13), onClick: () => editReminder(r, redraw) }),
          h('button', { class: 'icon-btn', html: icon('trash', 14), onClick: async () => { if (await confirmDelete(r.title || 'Reminder')) { await store.removeReminder(r.id); toast('Reminder removed', 'ok'); redraw(); } } }),
      )),
    ));
  });
  wrap.append(list);
  return wrap;
}

/* ============================ rules panel ============================ */
function rulesPanel(redraw) {
  const wrap = h('div', {});
  wrap.append(h('div', { class: 'row between mb' },
    h('h3', { text: 'Reminder rules' }),
    h('button', { class: 'btn sm', html: `${icon('plus', 14)} Add rule`, onClick: () => editRule(null, redraw) })));

  if (!state.reminderRules.length) {
    wrap.append(empty('No rules yet', 'Create reminder rules to auto-generate reminders on a schedule — never forget an annual check-up, monthly review or weekly task.', 'repeat',
      h('button', { class: 'btn primary sm mt', onClick: () => editRule(null, redraw) }, 'Create rule'))); return wrap;
  }

  const grid = h('div', { class: 'grid auto stagger' });
  state.reminderRules.forEach(r => {
    grid.append(h('div', { class: 'card pad', style: { opacity: r.active ? 1 : .55 } },
      h('div', { class: 'row between mb' },
        h('div', {}, h('b', { text: r.title || 'Rule' }),
          r.notes ? h('div', { class: 'tiny t2', text: r.notes }) : null),
        tag(r.active ? 'Active' : 'Paused', r.active ? 'pos' : '')),
      h('div', { class: 'row between' },
        h('div', { class: 'tiny t2', text: `${(FREQUENCIES.find(x => x[0] === r.recurrence) || ['', r.recurrence])[1]} · ${levelLabel(r.level || 'info')} · Due ${r.remindBefore || 0}d before` }),
        h('div', { class: 'row', style: { gap: '4px' } },
          h('button', { class: 'btn xs', html: icon('repeat', 13), onClick: async () => { await store.saveReminderRule({ ...r, active: !r.active }); redraw(); } }),
          h('button', { class: 'btn xs', html: icon('edit', 13), onClick: () => editRule(r, redraw) }),
          h('button', { class: 'icon-btn', html: icon('trash', 14), onClick: async () => { if (await confirmDelete(r.title || 'Rule')) { await store.removeReminderRule(r.id); toast('Rule removed', 'ok'); redraw(); } } }),
      )),
    ));
  });
  wrap.append(grid);
  return wrap;
}

/* ============================ reminder modal ============================ */
function editReminder(existing, redraw) {
  const isEdit = !!existing;
  const { modal: m } = formModal({
    title: isEdit ? 'Edit reminder' : 'New reminder',
    fields: [
      { key: 'title', label: 'Title', type: 'text', value: existing?.title || '' },
      { key: 'notes', label: 'Notes', type: 'text', value: existing?.notes || '' },
      { key: 'date', label: 'Due date', type: 'date', value: existing?.dueAt || existing?.date || today() },
      { key: 'level', label: 'Priority', type: 'select', value: existing?.level || 'info', options: LEVELS },
      { key: 'recurrence', label: 'Repeat', type: 'select', value: existing?.recurrence || 'none', options: FREQUENCIES },
    ],
    async onSubmit(v) {
      const payload = {
        title: v.title || 'Reminder',
        notes: v.notes || '',
        dueAt: v.date,
        date: v.date,
        level: v.level || 'info',
        recurrence: v.recurrence || 'none',
        done: existing?.done || 0,
        doneAt: existing?.doneAt || null,
      };
      if (isEdit) await store.saveReminder({ ...existing, ...payload });
      else await store.addReminder(payload);
      m.close();
      toast(isEdit ? 'Reminder updated' : 'Reminder created', 'ok');
      redraw();
    },
  });
}

/* ============================ rule modal ============================ */
function editRule(existing, redraw) {
  const isEdit = !!existing;
  const { modal: m } = formModal({
    title: isEdit ? 'Edit reminder rule' : 'New reminder rule',
    fields: [
      { key: 'title', label: 'Rule name', type: 'text', value: existing?.title || '', placeholder: 'e.g. Annual health checkup' },
      { key: 'notes', label: 'Description', type: 'text', value: existing?.notes || '' },
      { key: 'recurrence', label: 'Frequency', type: 'select', value: existing?.recurrence || 'yearly', options: FREQUENCIES },
      { key: 'level', label: 'Priority', type: 'select', value: existing?.level || 'info', options: LEVELS },
      { key: 'remindBefore', label: 'Lead days (0 = on the day)', type: 'number', value: String(existing?.remindBefore ?? 0), min: 0, max: 90 },
    ],
    async onSubmit(v) {
      const payload = {
        title: v.title || 'Reminder rule',
        notes: v.notes || '',
        recurrence: v.recurrence || 'yearly',
        level: v.level || 'info',
        remindBefore: Number(v.remindBefore) || 0,
        active: existing?.active ?? 1,
      };
      if (isEdit) await store.saveReminderRule({ ...existing, ...payload });
      else await store.addReminderRule(payload);
      m.close();
      toast(isEdit ? 'Rule updated' : 'Rule created', 'ok');
      redraw();
    },
  });
}

/* ============================ helpers ============================ */
function levelLabel(l) { return LEVELS.find(x => x[0] === l)?.[1] || l; }
function levelCls(l) { return l === 'danger' ? 'neg' : l === 'warn' ? 'warn' : 'acc'; }
