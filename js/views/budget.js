/* ═══════════ views/budget.js — Budget Planner ═══════════ */

import {
  h, frag, icon, card, stat, tag, empty, toast, confirm, modal, formModal, store, state, settings,
  fmtMoney, fmtDate, today, sortBy, pageHead, kpiGrid, confirmDelete, categoryOptions,
} from './common.js';
import { dataTable, bar } from '../ui.js';
import { donut, barChart, ring, hBarChart } from '../charts.js';
import { budgetStatus, monthlySeries, categoryBreakdown } from '../store.js';
import { money, fmtPct, period, colorFor, daysBetween, mean } from '../util.js';
import { suggestBudgets, healthScore } from '../ai.js';

export async function render(root, api) {
  let scope = 'monthly';
  const draw = () => { root.innerHTML = ''; root.append(build(scope, s => { scope = s; draw(); }, draw, api)); };
  draw();
  return store.bus.on('change', ({ store: s }) => { if (['budgets', 'transactions'].includes(s)) draw(); });
}

function build(scope, setScope, redraw, api) {
  const wrap = h('div', {});
  const budgets = state.budgets.filter(b => (b.scope || 'monthly') === scope).map(b => ({ ...b, s: budgetStatus(b) }));
  const overall = budgets.find(b => b.categoryId === '*');
  const cats = budgets.filter(b => b.categoryId !== '*');
  const totalLimit = money(cats.reduce((a, b) => a + b.s.limit, 0));
  const totalSpent = money(cats.reduce((a, b) => a + b.s.spent, 0));
  api.setSubtitle(`${budgets.length} ${scope} budgets`);

  wrap.append(pageHead('Budget Planner', 'Set limits, watch pacing, and let the optimiser propose realistic numbers from your own history.',
    h('div', { class: 'seg' }, ...[['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']].map(([v, l]) =>
      h('button', { class: scope === v ? 'on' : '', text: l, onClick: () => setScope(v) }))),
    h('button', { class: 'btn', html: `${icon('sparkle', 16)} Suggest budgets`, onClick: () => optimiser(redraw) }),
    h('button', { class: 'btn primary', html: `${icon('plus', 16)} New budget`, onClick: () => editBudget(null, redraw, scope) })));

  const over = budgets.filter(b => b.s.over).length;
  const risk = budgets.filter(b => b.s.atRisk).length;

  wrap.append(kpiGrid(
    stat({ label: `Total ${scope} limit`, value: fmtMoney(totalLimit + (overall ? 0 : 0)), icon: 'target',
      foot: h('span', { class: 't3', text: `${cats.length} category budgets` }) }),
    stat({ label: 'Spent so far', value: fmtMoney(totalSpent), icon: 'swap', tone: totalSpent > totalLimit ? 'neg' : 'info',
      foot: h('span', { class: 't3', text: totalLimit ? `${((totalSpent / totalLimit) * 100).toFixed(0)}% of limits` : '—' }) }),
    stat({ label: 'Remaining', value: fmtMoney(totalLimit - totalSpent), icon: 'wallet',
      tone: totalLimit - totalSpent >= 0 ? 'pos' : 'neg',
      foot: h('span', { class: 't3', text: overall ? `Overall cap ${fmtMoney(overall.s.limit)}` : 'No overall cap set' }) }),
    stat({ label: 'Over limit', value: String(over), icon: 'alert', tone: over ? 'neg' : 'pos',
      foot: h('span', { class: risk ? 'warnc' : 't3', text: risk ? `${risk} pacing high` : 'All within pace' }) })));

  if (overall) {
    const s = overall.s;
    wrap.append(h('div', { class: 'card pad mt' },
      h('div', { class: 'row between mb' },
        h('div', {}, h('h3', { text: 'Overall spending cap' }),
          h('div', { class: 'tiny t3', text: `${fmtDate(s.from)} → ${fmtDate(s.to)} · day ${s.daysGone} of ${s.daysTotal}` })),
        h('div', { style: { textAlign: 'right' } },
          h('div', { class: 'num', style: { fontSize: '1.2rem', fontWeight: 700 }, text: `${fmtMoney(s.spent)} / ${fmtMoney(s.limit)}` }),
          h('div', { class: `tiny ${s.over ? 'neg' : 'pos'}`, text: s.over ? `${fmtMoney(-s.remaining)} over` : `${fmtMoney(s.remaining)} left` }))),
      h('div', { style: { position: 'relative' } },
        bar(s.pct, s.over ? 'neg' : s.pct > 85 ? 'warn' : 'pos'),
        h('div', { style: { position: 'absolute', left: `${Math.min(100, s.pace)}%`, top: '-3px', width: '2px', height: '13px', background: 'var(--text)', opacity: .55 },
          title: 'Where you should be by now' })),
      h('div', { class: 'row between mt-sm' },
        h('span', { class: 'tiny t3', text: `Pace marker at ${Math.round(s.pace)}% of period` }),
        h('span', { class: 'tiny t3', text: `Projected total ${fmtMoney(s.projected)}` }))));
  }

  /* budget cards */
  const grid = h('div', { class: 'grid auto mt stagger' });
  if (!cats.length) {
    grid.append(empty('No budgets yet', 'Create category limits, or let the optimiser suggest them from three months of history.', 'target',
      h('div', { class: 'row mt', style: { gap: '8px' } },
        h('button', { class: 'btn primary sm', onClick: () => editBudget(null, redraw, scope) }, 'Create manually'),
        h('button', { class: 'btn sm', onClick: () => optimiser(redraw) }, 'Suggest for me'))));
  }
  sortBy(cats, b => b.s.pct, -1).forEach(b => {
    const c = store.find('categories', b.categoryId);
    const s = b.s;
    const tone = s.over ? 'neg' : s.atRisk ? 'warn' : 'pos';
    grid.append(h('div', { class: 'card pad', style: { cursor: 'pointer' }, onClick: () => editBudget(b, redraw, scope) },
      h('div', { class: 'row between mb' },
        h('div', { class: 'row', style: { gap: '8px', minWidth: 0 } },
          h('span', { class: 'dot', style: { width: '9px', height: '9px', borderRadius: '50%', background: c?.color || '#94a3b8', flex: 'none' } }),
          h('b', { class: 'ell', text: c?.name || 'Unknown category' })),
        s.over ? tag('Over', 'neg') : s.atRisk ? tag('At risk', 'warn') : tag(`${Math.round(s.pct)}%`, 'pos')),
      h('div', { class: 'num', style: { fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-.03em' }, text: fmtMoney(s.spent) }),
      h('div', { class: 'tiny t3', style: { marginBottom: '9px' }, text: `of ${fmtMoney(s.limit)} limit` }),
      bar(s.pct, tone),
      h('div', { class: 'row between mt-sm' },
        h('span', { class: `tiny ${s.over ? 'neg' : 't3'}`, text: s.over ? `${fmtMoney(-s.remaining)} over` : `${fmtMoney(s.remaining)} left` }),
        h('span', { class: 'tiny t3', text: `≈ ${fmtMoney(s.projected)} projected` }))));
  });
  wrap.append(grid);

  /* limit vs actual chart */
  if (cats.length) {
    const sorted = sortBy(cats, b => b.s.limit, -1);
    wrap.append(h('div', { class: 'grid mt', style: { gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)' } },
      card('Limit vs actual', barChart([
        { name: 'Limit', color: 'var(--accent)', values: sorted.map(b => b.s.limit) },
        { name: 'Spent', color: 'var(--neg)', values: sorted.map(b => b.s.spent) },
      ], sorted.map(b => store.catName(b.categoryId)), { height: 250 })),
      card('Budget allocation', donut(sorted.map(b => ({ label: store.catName(b.categoryId), value: b.s.limit, color: store.catColor(b.categoryId) })),
        { size: 200, centerLabel: 'Allocated' }))));

    wrap.append(h('div', { class: 'mt' }, dataTable([
      { key: 'cat', label: 'Category', value: r => store.catName(r.categoryId),
        render: r => h('span', { class: 'chip', style: { background: store.catColor(r.categoryId) + '22', color: store.catColor(r.categoryId) },
          text: store.catName(r.categoryId) }) },
      { key: 'limit', label: 'Limit', align: 'right', value: r => r.s.limit, render: r => h('span', { class: 'num', text: fmtMoney(r.s.limit) }) },
      { key: 'spent', label: 'Spent', align: 'right', value: r => r.s.spent, render: r => h('span', { class: 'num', text: fmtMoney(r.s.spent) }) },
      { key: 'remaining', label: 'Remaining', align: 'right', value: r => r.s.remaining,
        render: r => h('span', { class: `num ${r.s.remaining < 0 ? 'neg' : 'pos'}`, text: fmtMoney(r.s.remaining) }) },
      { key: 'pct', label: 'Used', align: 'right', value: r => r.s.pct, render: r => h('span', { class: 'num tiny', text: fmtPct(r.s.pct, 0) }) },
      { key: 'projected', label: 'Projected', align: 'right', value: r => r.s.projected,
        render: r => h('span', { class: `num tiny ${r.s.projected > r.s.limit ? 'neg' : 't2'}`, text: fmtMoney(r.s.projected) }) },
    ], {
      rows: cats, exportName: 'budgets', pageSize: 20, searchable: false,
      onRowClick: b => editBudget(b, redraw, scope),
      actions: b => [
        { label: 'Edit', icon: 'edit', onClick: () => editBudget(b, redraw, scope) },
        { label: 'Delete', icon: 'trash', danger: true, onClick: async () => {
          if (await confirmDelete('this budget')) { await store.remove('budgets', b.id); redraw(); } } },
      ],
    }).el));
  }

  return wrap;
}

/* ---------- editor ---------- */
function editBudget(b, redraw, scope) {
  const used = new Set(state.budgets.filter(x => x.id !== b?.id && (x.scope || 'monthly') === scope).map(x => x.categoryId));
  const opts = [['*', '— Overall spending cap —'], ...categoryOptions('expense')].filter(([v]) => !used.has(v) || v === b?.categoryId);
  const { modal: m } = formModal({
    title: b ? 'Edit budget' : 'New budget', size: '', columns: 2,
    values: b || { scope, rollover: false },
    fields: [
      { key: 'categoryId', label: 'Applies to', type: 'select', required: true, options: opts, col: 'full' },
      { key: 'amount', label: 'Limit', type: 'money', required: true, big: true, col: 'full' },
      { key: 'scope', label: 'Period', type: 'select', options: [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']] },
      { key: 'alertAt', label: 'Warn me at', type: 'percent', value: 80, hint: '% of the limit' },
      { key: 'rollover', label: 'Roll unused amount into the next period', type: 'switch', col: 'full' },
      { key: 'notes', label: 'Note', type: 'text', col: 'full' },
    ],
    extraFooter: b ? h('button', { class: 'btn danger', html: `${icon('trash', 15)} Delete`, onClick: async () => {
      if (await confirmDelete('this budget')) { await store.remove('budgets', b.id); m.close(); redraw(); } } }) : null,
    onSubmit: async v => {
      await store.save('budgets', { ...(b || {}), ...v, s: undefined });
      m.close(); toast(b ? 'Budget updated' : 'Budget created', 'ok'); redraw();
    },
  });
}

/* ---------- AI optimiser ---------- */
function optimiser(redraw) {
  let target = 20;
  const body = h('div', {});
  const render = () => {
    const sug = suggestBudgets({ months: 3, savingsTargetPct: target });
    body.innerHTML = '';
    body.append(
      h('div', { class: 'insight mb' }, h('div', { class: 'ic', html: icon('sparkle', 15) }),
        h('div', { class: 'tt' }, h('b', { text: 'How these numbers were derived' }),
          h('p', { text: `Median monthly spend per category over the last 3 closed months, plus 5% headroom${sug.needsCut ? `, then scaled down to fit a ${target}% savings target against your ${fmtMoney(sug.avgIncome)} average income.` : '.'}` }))),
      h('div', { class: 'field mb' }, h('label', { text: `Savings target: ${target}% of income` }),
        (() => { const r = h('input', { type: 'range', min: 0, max: 60, step: 5, value: target, style: { width: '100%' } });
          r.oninput = () => { target = Number(r.value); render(); }; return r; })()),
      h('div', { class: 'row between mb' },
        h('span', { class: 'tiny t3', text: 'Total suggested' }),
        h('span', { class: 'num', style: { fontWeight: 700 }, text: fmtMoney(sug.rows.reduce((a, r) => a + r.suggested, 0)) })));

    const list = h('div', { class: 'card', style: { overflow: 'hidden' } });
    sug.rows.forEach(r => {
      const existing = state.budgets.find(b => b.categoryId === r.categoryId && (b.scope || 'monthly') === 'monthly');
      list.append(h('div', { class: 'lst-item' },
        h('span', { class: 'dot', style: { width: '9px', height: '9px', borderRadius: '50%', background: r.color, flex: 'none' } }),
        h('div', { class: 'lst-main' }, h('div', { class: 't', text: r.name }),
          h('div', { class: 's', text: `typical ${fmtMoney(r.typical)} · peak ${fmtMoney(r.max)}${existing ? ` · current limit ${fmtMoney(existing.amount)}` : ''}` })),
        h('span', { class: 'lst-amt num', text: fmtMoney(r.suggested) })));
    });
    body.append(list);
    if (!sug.rows.length) body.append(empty('Not enough history', 'Log at least a month of expenses and the optimiser can propose limits.', 'sparkle'));
  };
  render();

  const m = modal({
    title: 'Budget optimiser', subtitle: 'Suggestions computed locally from your spending history.',
    size: 'wide', body,
    footer: frag(h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onClick: async () => {
        const sug = suggestBudgets({ months: 3, savingsTargetPct: target });
        let n = 0;
        for (const r of sug.rows) {
          if (r.suggested < 1) continue;
          const existing = state.budgets.find(b => b.categoryId === r.categoryId && (b.scope || 'monthly') === 'monthly');
          await store.save('budgets', { ...(existing || {}), categoryId: r.categoryId, scope: 'monthly',
            amount: r.suggested, alertAt: 80 }, { silent: true, auditIt: false });
          n++;
        }
        await store.audit('optimise', 'budgets', '', `${n} budgets applied`);
        store.bus.emit('change', { store: 'budgets', action: 'bulk' });
        m.close(); toast(`${n} budgets applied`, 'ok'); redraw();
      } }, 'Apply all suggestions')),
  });
}
