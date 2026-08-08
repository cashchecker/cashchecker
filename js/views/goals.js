/* ═══════════ views/goals.js — Savings Goals ═══════════ */

import {
  h, frag, icon, card, stat, tag, empty, toast, confirm, modal, formModal, store, state, settings,
  fmtMoney, fmtDate, today, sortBy, pageHead, kpiGrid, confirmDelete, accountOptions, relDate,
} from './common.js';
import { dataTable, bar } from '../ui.js';
import { ring, barChart, donut } from '../charts.js';
import { goalStatus } from '../store.js';
import { money, addMonths, daysBetween, colorFor, fmtPct } from '../util.js';

const GOAL_PRESETS = [
  ['House', 'home', '#7c5cff'], ['Car', 'wallet', '#22d3ee'], ['Vacation', 'flame', '#f59e0b'],
  ['Emergency Fund', 'shield', '#10b981'], ['Education', 'book', '#38bdf8'], ['Business', 'bank', '#a78bfa'],
  ['Wedding', 'flame', '#f472b6'], ['Retirement', 'target', '#34d399'], ['Gadget', 'sparkle', '#fb923c'],
];

export async function render(root, api) {
  const draw = () => { root.innerHTML = ''; root.append(build(draw, api)); };
  draw();
  return store.bus.on('change', ({ store: s }) => { if (s === 'goals') draw(); });
}

function build(redraw, api) {
  const wrap = h('div', {});
  const goals = state.goals.map(g => ({ ...g, s: goalStatus(g) }));
  const totalTarget = money(goals.reduce((a, g) => a + g.s.target, 0));
  const totalSaved = money(goals.reduce((a, g) => a + g.s.saved, 0));
  const monthlyNeed = money(goals.filter(g => !g.s.done).reduce((a, g) => a + g.s.perMonth, 0));
  api.setSubtitle(`${goals.length} goals · ${goals.filter(g => g.s.done).length} reached`);

  wrap.append(pageHead('Savings Goals', 'Give every rupee a purpose — track progress, deadlines and the monthly contribution needed.',
    h('button', { class: 'btn primary', html: `${icon('plus', 16)} New goal`, onClick: () => editGoal(null, redraw) })));

  wrap.append(kpiGrid(
    stat({ label: 'Total saved', value: fmtMoney(totalSaved), icon: 'flame', tone: 'pos',
      foot: h('span', { class: 't3', text: `of ${fmtMoney(totalTarget)} across all goals` }) }),
    stat({ label: 'Overall progress', value: `${totalTarget ? ((totalSaved / totalTarget) * 100).toFixed(1) : 0}%`, icon: 'target', tone: 'info',
      foot: h('span', { class: 't3', text: `${fmtMoney(totalTarget - totalSaved)} still needed` }) }),
    stat({ label: 'Monthly contribution needed', value: fmtMoney(monthlyNeed), icon: 'calendar', tone: 'warn',
      foot: h('span', { class: 't3', text: 'To hit every deadline on time' }) }),
    stat({ label: 'Goals reached', value: `${goals.filter(g => g.s.done).length} / ${goals.length}`, icon: 'check',
      tone: 'pos', foot: h('span', { class: 't3', text: `${goals.filter(g => g.s.behind).length} running behind` }) })));

  const grid = h('div', { class: 'grid auto-lg mt stagger' });
  if (!goals.length) {
    grid.append(empty('No goals yet', 'Whether it is a house, a car or an emergency fund — set the target and start tracking.', 'flame',
      h('button', { class: 'btn primary sm mt', onClick: () => editGoal(null, redraw) }, 'Create your first goal')));
  }
  sortBy(goals, g => (g.s.done ? 1 : 0) * 1000 - g.s.pct).forEach(g => {
    const s = g.s;
    grid.append(h('div', { class: 'card pad', style: { cursor: 'pointer' }, onClick: () => editGoal(g, redraw) },
      h('div', { class: 'row', style: { gap: '14px', alignItems: 'flex-start' } },
        h('div', { style: { flex: 'none' } }, ring(s.pct, { size: 92, thickness: 8, color: g.color || 'var(--accent)',
          value: g.emoji || `${Math.round(s.pct)}%` })),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { class: 'row between' },
            h('b', { class: 'ell' }, g.emoji ? `${g.emoji} ` : '', g.name),
            s.done ? tag('Reached 🎉', 'pos') : s.behind ? tag('Behind', 'warn') : g.priority === 'high' ? tag('Priority', 'acc') : null),
          h('div', { class: 'num', style: { fontSize: '1.2rem', fontWeight: 700, marginTop: '4px' }, text: fmtMoney(s.saved) }),
          h('div', { class: 'tiny t3', text: `of ${fmtMoney(s.target)} target` }),
          h('div', { class: 'mt-sm' }, bar(s.pct, s.done ? 'pos' : s.behind ? 'warn' : '')),
          h('div', { class: 'row between mt-sm' },
            h('span', { class: 'tiny t3', text: s.deadline || g.deadline ? relDate(g.deadline) : 'No deadline' }),
            h('span', { class: 'tiny t2', text: s.done ? 'Complete' : `${fmtMoney(s.perMonth)}/mo needed` })),
          h('div', { class: 'row mt-sm', style: { gap: '6px' } },
            h('button', { class: 'btn xs primary', text: 'Add money', onClick: e => { e.stopPropagation(); contribute(g, redraw); } }),
            h('button', { class: 'btn xs', text: 'Withdraw', onClick: e => { e.stopPropagation(); contribute(g, redraw, true); } })))) ));
  });
  wrap.append(grid);

  if (goals.length) {
    wrap.append(h('div', { class: 'grid mt', style: { gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)' } },
      card('Progress by goal', barChart([
        { name: 'Saved', color: 'var(--pos)', values: goals.map(g => g.s.saved) },
        { name: 'Remaining', color: 'var(--surface-3)', values: goals.map(g => g.s.remaining) },
      ], goals.map(g => g.name), { height: 240, stacked: true })),
      card('Allocation of savings', donut(goals.filter(g => g.s.saved > 0).map(g =>
        ({ label: g.name, value: g.s.saved, color: g.color || colorFor(g.name) })), { size: 200, centerLabel: 'Saved' }))));

    wrap.append(h('div', { class: 'mt' }, dataTable([
      { key: 'name', label: 'Goal', render: r => h('div', { class: 'row', style: { gap: '8px' } },
        r.emoji ? h('span', { style: { fontSize: '1.05rem' }, text: r.emoji })
                : h('span', { style: { width: '9px', height: '9px', borderRadius: '50%', background: r.color || colorFor(r.name), flex: 'none' } }),
        h('b', { text: r.name })) },
      { key: 'target', label: 'Target', align: 'right', value: r => r.s.target, render: r => h('span', { class: 'num', text: fmtMoney(r.s.target) }) },
      { key: 'saved', label: 'Saved', align: 'right', value: r => r.s.saved, render: r => h('span', { class: 'num pos', text: fmtMoney(r.s.saved) }) },
      { key: 'remaining', label: 'Remaining', align: 'right', value: r => r.s.remaining, render: r => h('span', { class: 'num', text: fmtMoney(r.s.remaining) }) },
      { key: 'pct', label: 'Progress', align: 'right', value: r => r.s.pct,
        render: r => h('div', { style: { minWidth: '90px' } }, h('div', { class: 'tiny num', text: fmtPct(r.s.pct, 0) }), bar(r.s.pct)) },
      { key: 'deadline', label: 'Deadline', render: r => r.deadline ? h('div', {}, h('div', { text: fmtDate(r.deadline) }),
        h('div', { class: 'tiny t3', text: relDate(r.deadline) })) : '—' },
      { key: 'perMonth', label: 'Needed / month', align: 'right', value: r => r.s.perMonth,
        render: r => h('span', { class: 'num tiny', text: r.s.done ? '—' : fmtMoney(r.s.perMonth) }) },
    ], {
      rows: goals, exportName: 'savings-goals', pageSize: 15,
      onRowClick: g => editGoal(g, redraw),
      actions: g => [
        { label: 'Add money', icon: 'plus', onClick: () => contribute(g, redraw) },
        { label: 'Withdraw', icon: 'export', onClick: () => contribute(g, redraw, true) },
        { label: 'Edit', icon: 'edit', onClick: () => editGoal(g, redraw) },
        '-',
        { label: 'Delete', icon: 'trash', danger: true, onClick: async () => {
          if (await confirmDelete(g.name)) { await store.remove('goals', g.id); redraw(); } } },
      ],
    }).el));
  }
  return wrap;
}

function editGoal(g, redraw) {
  const { modal: m } = formModal({
    title: g ? `Edit ${g.name}` : 'New savings goal', size: 'wide', columns: 2,
    values: g || { deadline: addMonths(today(), 12), priority: 'normal', color: '#7c5cff', saved: 0 },
    fields: [
      { key: 'name', label: 'Goal name', type: 'text', required: true, col: 'full',
        datalist: GOAL_PRESETS.map(p => p[0]), placeholder: 'House, Car, Vacation, Emergency Fund…' },
      { key: 'emoji', label: 'Icon', type: 'chips', col: 'full',
        options: store.GOAL_EMOJI.map(e => [e, e]) },
      { key: 'target', label: 'Target amount', type: 'money', required: true },
      { key: 'saved', label: 'Already saved', type: 'money' },
      { key: 'deadline', label: 'Target date', type: 'date' },
      { key: 'priority', label: 'Priority', type: 'select', options: [['high', 'High'], ['normal', 'Normal'], ['low', 'Low']] },
      { key: 'accountId', label: 'Linked account', type: 'select', options: accountOptions(), placeholder: 'Optional' },
      { key: 'monthlyPlan', label: 'Planned monthly contribution', type: 'money', hint: 'Leave blank to auto-calculate from the deadline' },
      { key: 'color', label: 'Colour', type: 'color', col: 'full' },
      { key: 'notes', label: 'Why does this matter?', type: 'textarea', col: 'full',
        placeholder: 'A short reason makes goals much easier to stick to.' },
    ],
    extraFooter: g ? h('button', { class: 'btn danger', html: `${icon('trash', 15)} Delete`, onClick: async () => {
      if (await confirmDelete(g.name)) { await store.remove('goals', g.id); m.close(); redraw(); } } }) : null,
    onSubmit: async v => {
      await store.save('goals', { ...(g || {}), ...v, s: undefined });
      m.close(); toast(g ? 'Goal updated' : 'Goal created', 'ok'); redraw();
    },
  });
}

function contribute(g, redraw, withdraw = false) {
  const s = goalStatus(g);
  const { modal: m } = formModal({
    title: withdraw ? `Withdraw from ${g.name}` : `Add to ${g.name}`,
    subtitle: `${fmtMoney(s.saved)} saved of ${fmtMoney(s.target)}${s.remaining ? ` · ${fmtMoney(s.remaining)} to go` : ''}`,
    size: '', columns: 2,
    values: { date: today(), amount: withdraw ? '' : (s.perMonth || ''), createTxn: false },
    fields: [
      { key: 'amount', label: 'Amount', type: 'money', required: true, big: true, col: 'full',
        validate: v => (withdraw && Number(v) > s.saved ? 'You cannot withdraw more than is saved' : '') },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'note', label: 'Note', type: 'text' },
      { key: 'createTxn', label: withdraw ? 'Record as income in the tracker' : 'Record as a transfer in the tracker', type: 'switch', col: 'full' },
      { key: 'accountId', label: withdraw ? 'Move money to' : 'Take money from', type: 'select',
        options: accountOptions(), when: mm => mm.createTxn },
    ],
    onSubmit: async v => {
      const amt = Number(v.amount) || 0;
      const contributions = [...(g.contributions || []), { date: v.date, amount: withdraw ? -amt : amt, note: v.note }];
      await store.save('goals', { ...g, s: undefined, contributions,
        saved: money(Math.max(0, (Number(g.saved) || 0) + (withdraw ? -amt : amt))) });
      if (v.createTxn && v.accountId) {
        const linked = g.accountId && g.accountId !== v.accountId ? g.accountId : null;
        if (linked) {
          await store.save('transactions', { type: 'transfer', amount: amt, currency: settings.baseCurrency, rate: 1,
            accountId: withdraw ? linked : v.accountId, toAccountId: withdraw ? v.accountId : linked,
            date: v.date, notes: `${g.name} — ${withdraw ? 'withdrawal' : 'contribution'}`, status: 'cleared', tags: ['goal'] });
        } else {
          const cat = state.categories.find(c => c.kind === (withdraw ? 'income' : 'expense') && /other/i.test(c.name))
            || state.categories.find(c => c.kind === (withdraw ? 'income' : 'expense'));
          await store.save('transactions', { type: withdraw ? 'income' : 'expense', amount: amt,
            currency: settings.baseCurrency, rate: 1, accountId: v.accountId, categoryId: cat?.id,
            date: v.date, notes: `${g.name} — ${withdraw ? 'withdrawal' : 'contribution'}`, status: 'cleared', tags: ['goal'] });
        }
      }
      const after = goalStatus(store.find('goals', g.id));
      m.close();
      toast(after.done ? `${g.name} reached! 🎉` : withdraw ? 'Withdrawal recorded' : 'Contribution added', 'ok');
      redraw();
    },
  });
}
