/* ═══════════ views/categories.js — categories, tags, rules & custom modules ═══════════ */

import {
  h, frag, icon, card, stat, tag, empty, toast, confirm, modal, formModal, store, state, settings,
  fmtMoney, fmtDate, today, sortBy, pageHead, kpiGrid, confirmDelete, categoryOptions,
} from './common.js';
import { dataTable, form, menu } from '../ui.js';
import { donut, hBarChart } from '../charts.js';
import { categoryBreakdown } from '../store.js';
import { money, colorFor, uid, addMonths, esc, slug } from '../util.js';
import { trainCategorizer, suggestCategory } from '../ai.js';

export async function render(root, api) {
  let tab = 'expense';
  const draw = () => { root.innerHTML = ''; root.append(build(tab, t => { tab = t; draw(); }, draw, api)); };
  draw();
  return store.bus.on('change', ({ store: s }) => { if (['categories', 'rules', 'entityTypes', 'transactions'].includes(s)) draw(); });
}

const TABS = [['expense', 'Expense categories'], ['income', 'Income categories'], ['tags', 'Tags'],
  ['rules', 'Auto-categorisation rules'], ['modules', 'Custom modules']];

function build(tab, setTab, redraw, api) {
  const wrap = h('div', {});
  api.setSubtitle(`${state.categories.length} categories · ${state.entityTypes.length} custom modules`);

  wrap.append(pageHead('Categories', 'Organise everything — categories, tags, automatic classification rules and your own custom modules.',
    tab === 'modules'
      ? h('button', { class: 'btn primary', html: `${icon('plus', 16)} New module`, onClick: () => editEntityType(null, redraw, api) })
      : tab === 'rules'
        ? h('button', { class: 'btn primary', html: `${icon('plus', 16)} New rule`, onClick: () => editRule(null, redraw) })
        : frag(
            h('button', { class: 'btn', html: `${icon('sparkle', 16)} Install sub-categories`,
              onClick: () => installTree(redraw) }),
            h('button', { class: 'btn primary', html: `${icon('plus', 16)} New category`,
              onClick: () => editCategory(null, redraw, tab === 'income' ? 'income' : 'expense') }))));

  const tabsEl = h('div', { class: 'tabs mb' });
  TABS.forEach(([v, l]) => tabsEl.append(h('button', { class: v === tab ? 'on' : '', text: l, onClick: () => setTab(v) })));
  wrap.append(tabsEl);

  if (tab === 'tags') { wrap.append(tagsPanel(redraw)); return wrap; }
  if (tab === 'rules') { wrap.append(rulesPanel(redraw)); return wrap; }
  if (tab === 'modules') { wrap.append(modulesPanel(redraw, api)); return wrap; }

  /* categories */
  const kind = tab;
  const cats = store.categoriesOf(kind).map(c => {
    const txns = state.transactions.filter(t => t.categoryId === c.id);
    const last12 = txns.filter(t => t.date >= addMonths(today(), -12));
    return { ...c, count: txns.length, total: money(txns.reduce((a, t) => a + t.base, 0)),
      last12: money(last12.reduce((a, t) => a + t.base, 0)),
      avg: txns.length ? money(txns.reduce((a, t) => a + t.base, 0) / txns.length) : 0,
      lastUsed: sortBy(txns, t => t.date, -1)[0]?.date || null };
  });
  const breakdown = categoryBreakdown(addMonths(today(), -12), today(), kind);

  wrap.append(kpiGrid(
    stat({ label: `${kind === 'income' ? 'Income' : 'Expense'} categories`, value: String(cats.length), icon: 'tag', tone: 'info' }),
    stat({ label: 'In use', value: String(cats.filter(c => c.count).length), icon: 'check', tone: 'pos',
      foot: h('span', { class: 't3', text: `${cats.filter(c => !c.count).length} never used` }) }),
    stat({ label: 'Total recorded', value: fmtMoney(money(cats.reduce((a, c) => a + c.total, 0))), icon: 'wallet',
      tone: kind === 'income' ? 'pos' : 'neg' }),
    stat({ label: 'Largest category', value: breakdown[0]?.label || '—', icon: 'flame', tone: 'warn',
      foot: breakdown[0] ? h('span', { class: 't3', text: fmtMoney(breakdown[0].value) }) : null })));

  wrap.append(h('div', { class: 'grid mt', style: { gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.3fr)' } },
    card('Share of last 12 months', breakdown.length ? donut(breakdown, { size: 210, centerLabel: 'Total' }) : empty('No data', '', 'tag')),
    card('Ranked usage', breakdown.length
      ? hBarChart({ values: breakdown.slice(0, 10).map(b => b.value) }, breakdown.slice(0, 10).map(b => b.label),
        { colors: breakdown.slice(0, 10).map(b => b.color), width: 600 })
      : empty('No data', '', 'chart'))));

  wrap.append(h('div', { class: 'mt' }, dataTable([
    { key: 'name', label: 'Category', value: r => store.catPath(r.id),
      render: r => h('div', { class: 'row', style: { gap: '9px', paddingLeft: r.parentId ? '18px' : 0 } },
        h('span', { style: { fontSize: '1.05rem' }, text: store.catIcon(r) }),
        h('div', {}, h('b', { text: r.name }),
          r.parentId ? h('div', { class: 'tiny t3', text: `under ${store.catName(r.parentId)}` })
                     : (store.subCategories(r.id).length
                        ? h('div', { class: 'tiny t3', text: `${store.subCategories(r.id).length} sub-categories` }) : null))) },
    { key: 'count', label: 'Transactions', align: 'center' },
    { key: 'total', label: 'All-time total', align: 'right', render: r => h('span', { class: 'num', text: fmtMoney(r.total) }) },
    { key: 'last12', label: 'Last 12 months', align: 'right', render: r => h('span', { class: 'num t2', text: fmtMoney(r.last12) }) },
    { key: 'avg', label: 'Average', align: 'right', render: r => h('span', { class: 'num tiny t3', text: fmtMoney(r.avg) }) },
    { key: 'lastUsed', label: 'Last used', render: r => r.lastUsed ? fmtDate(r.lastUsed) : h('span', { class: 't3', text: 'never' }) },
  ], {
    rows: cats, exportName: `${kind}-categories`, pageSize: 30,
    defaultSort: { key: 'total', dir: -1 },
    emptyTitle: 'No categories', emptyMsg: 'Add your first category to start classifying transactions.', emptyIcon: 'tag',
    onRowClick: c => editCategory(c, redraw, kind),
    actions: c => [
      { label: 'Edit', icon: 'edit', onClick: () => editCategory(c, redraw, kind) },
      !c.parentId ? { label: 'Add sub-category', icon: 'plus',
        onClick: () => editCategory(null, redraw, kind, c.id) } : null,
      { label: 'Merge into…', icon: 'copy', onClick: () => mergeCategory(c, redraw) },
      '-',
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => deleteCategory(c, redraw) },
    ].filter(Boolean),
  }).el));

  return wrap;
}

/* ---------- category editor ---------- */
function editCategory(c, redraw, kind, presetParent) {
  const { modal: m } = formModal({
    title: c ? `Edit ${c.name}` : (presetParent ? `New sub-category of ${store.catName(presetParent)}` : 'New category'),
    size: '', columns: 2,
    values: c || { kind, parentId: presetParent || '', color: colorFor(String(state.categories.length)) },
    fields: [
      { key: 'name', label: 'Category name', type: 'text', required: true, col: 'full',
        validate: (v, mm) => (state.categories.some(x => x.id !== c?.id
            && x.name.toLowerCase() === String(v).toLowerCase()
            && x.kind === (c?.kind || kind)
            && (x.parentId || '') === (mm.parentId || ''))
          ? 'A category with that name already exists at this level' : '') },
      { key: 'kind', label: 'Type', type: 'select', options: [['expense', 'Expense'], ['income', 'Income']] },
      { key: 'parentId', label: 'Parent category', type: 'select', placeholder: 'None (top level)',
        hint: 'Pick a parent to make this a sub-category',
        // only top-level categories can be parents, so the tree stays two deep
        options: () => store.topCategories(c?.kind || kind).filter(x => x.id !== c?.id).map(x => [x.id, x.name]) },
      { key: 'icon', label: 'Emoji icon', type: 'text', placeholder: '🍽️',
        hint: 'Shown beside the category everywhere' },
      { key: 'color', label: 'Colour', type: 'color', col: 'full' },
      { key: 'monthlyBudget', label: 'Default monthly budget', type: 'money', hint: 'Optional shortcut — creates a budget entry' },
      { key: 'keywords', label: 'Auto-match keywords', type: 'tags', col: 'full',
        hint: 'Transactions containing these words will be suggested for this category' },
      { key: 'notes', label: 'Notes', type: 'text', col: 'full' },
    ],
    extraFooter: c ? h('button', { class: 'btn danger', html: `${icon('trash', 15)} Delete`,
      onClick: () => { m.close(); deleteCategory(c, redraw); } }) : null,
    onSubmit: async v => {
      const saved = await store.save('categories', { ...(c || {}), ...v });
      if (v.monthlyBudget && Number(v.monthlyBudget) > 0) {
        const existing = state.budgets.find(b => b.categoryId === saved.id && (b.scope || 'monthly') === 'monthly');
        await store.save('budgets', { ...(existing || {}), categoryId: saved.id, scope: 'monthly', amount: Number(v.monthlyBudget) });
      }
      for (const k of (v.keywords || [])) {
        if (!state.rules.some(r => r.pattern === k && r.categoryId === saved.id))
          await store.save('rules', { pattern: k, matchType: 'contains', categoryId: saved.id, priority: 5, active: true }, { auditIt: false });
      }
      trainCategorizer();
      m.close(); toast(c ? 'Category updated' : 'Category created', 'ok'); redraw();
    },
  });
}

/** Installs the built-in two-level taxonomy. Safe to run more than once. */
async function installTree(redraw) {
  const expCount = store.SEED_EXPENSE_TREE.reduce((a, t) => a + t[2].length, 0);
  const incCount = store.SEED_INCOME_TREE.reduce((a, t) => a + t[2].length, 0);
  const ok = await confirm({
    title: 'Install the sub-category set?',
    confirmText: 'Install',
    message: `Adds ${expCount + incCount} sub-categories under your existing top-level categories, and gives each one an emoji icon. Nothing is renamed, deleted or duplicated — categories you already have are reused, and it is safe to run again later.`,
  });
  if (!ok) return;
  toast('Installing…', 'info', { timeout: 1500 });
  const { seedCategoryTree } = await import('../../js/seed.js');
  const res = await seedCategoryTree();
  trainCategorizer();
  toast(res.added ? `${res.added} categories added` : 'Already up to date', 'ok');
  redraw();
}

async function deleteCategory(c, redraw) {
  const used = state.transactions.filter(t => t.categoryId === c.id).length;
  if (used) {
    const move = await confirm({
      title: `${c.name} is used by ${used} transactions`, danger: true, confirmText: 'Choose replacement',
      message: 'Deleting it would leave those transactions uncategorised. Pick a category to move them to instead.',
    });
    if (!move) return;
    return mergeCategory(c, redraw, true);
  }
  if (await confirmDelete(c.name)) { await store.remove('categories', c.id); trainCategorizer(); toast('Category deleted', 'ok'); redraw(); }
}

function mergeCategory(c, redraw, thenDelete = false) {
  const { modal: m } = formModal({
    title: `Merge ${c.name} into…`, size: 'narrow', columns: 1,
    submitText: thenDelete ? 'Move & delete' : 'Merge',
    fields: [{ key: 'target', label: 'Destination category', type: 'select', required: true,
      options: store.categoriesOf(c.kind).filter(x => x.id !== c.id).map(x => [x.id, x.name]) }],
    onSubmit: async v => {
      const affected = state.transactions.filter(t => t.categoryId === c.id);
      for (const t of affected) await store.save('transactions', { ...t, categoryId: v.target }, { silent: true, auditIt: false });
      for (const b of state.budgets.filter(b => b.categoryId === c.id)) await store.remove('budgets', b.id, { silent: true });
      await store.remove('categories', c.id, { silent: true });
      await store.audit('merge', 'categories', c.id, `${affected.length} transactions moved to ${store.catName(v.target)}`);
      store.bus.emit('change', { store: 'categories', action: 'merge' });
      trainCategorizer();
      m.close(); toast(`${affected.length} transactions moved`, 'ok'); redraw();
    },
  });
}

/* ---------- tags ---------- */
function tagsPanel(redraw) {
  const map = new Map();
  state.transactions.forEach(t => (t.tags || []).forEach(tg => {
    const r = map.get(tg) || { id: tg, tag: tg, count: 0, total: 0, income: 0, expense: 0 };
    r.count++;
    r.total = money(r.total + t.base);
    if (t.type === 'income') r.income = money(r.income + t.base); else if (t.type === 'expense') r.expense = money(r.expense + t.base);
    map.set(tg, r);
  }));
  const rows = sortBy([...map.values()], r => r.count, -1);
  const wrap = h('div', {});
  wrap.append(kpiGrid(
    stat({ label: 'Distinct tags', value: String(rows.length), icon: 'tag', tone: 'info' }),
    stat({ label: 'Tagged transactions', value: String(state.transactions.filter(t => (t.tags || []).length).length), icon: 'check' }),
    stat({ label: 'Most used tag', value: rows[0]?.tag || '—', icon: 'flame', tone: 'warn',
      foot: rows[0] ? h('span', { class: 't3', text: `${rows[0].count} transactions` }) : null })));

  if (!rows.length) { wrap.append(h('div', { class: 'mt' }, empty('No tags yet', 'Tags are free-form labels you add on any transaction — great for projects, trips or clients.', 'tag'))); return wrap; }

  wrap.append(h('div', { class: 'card pad mt' }, h('div', { class: 'row wrap', style: { gap: '7px' } },
    ...rows.map(r => h('span', { class: 'chip', style: { background: colorFor(r.tag) + '1e', color: colorFor(r.tag), borderColor: colorFor(r.tag) + '55' } },
      r.tag, h('span', { class: 't3', style: { marginLeft: '3px' }, text: String(r.count) }))))));

  wrap.append(h('div', { class: 'mt' }, dataTable([
    { key: 'tag', label: 'Tag', render: r => h('span', { class: 'chip', style: { background: colorFor(r.tag) + '1e', color: colorFor(r.tag) }, text: r.tag }) },
    { key: 'count', label: 'Uses', align: 'center' },
    { key: 'income', label: 'Income', align: 'right', render: r => h('span', { class: 'num pos', text: fmtMoney(r.income) }) },
    { key: 'expense', label: 'Expense', align: 'right', render: r => h('span', { class: 'num neg', text: fmtMoney(r.expense) }) },
    { key: 'net', label: 'Net', align: 'right', value: r => r.income - r.expense,
      render: r => h('span', { class: `num ${r.income - r.expense >= 0 ? 'pos' : 'neg'}`, text: fmtMoney(money(r.income - r.expense)) }) },
  ], {
    rows, exportName: 'tags', pageSize: 30,
    actions: r => [
      { label: 'Rename tag', icon: 'edit', onClick: () => renameTag(r.tag, redraw) },
      { label: 'Remove from all', icon: 'trash', danger: true, onClick: async () => {
        if (!await confirm({ title: `Remove tag “${r.tag}”?`, danger: true, confirmText: 'Remove',
          message: `It will be stripped from ${r.count} transactions. The transactions themselves are kept.` })) return;
        for (const t of state.transactions.filter(t => (t.tags || []).includes(r.tag)))
          await store.save('transactions', { ...t, tags: t.tags.filter(x => x !== r.tag) }, { silent: true, auditIt: false });
        store.bus.emit('change', { store: 'transactions' });
        toast('Tag removed', 'ok'); redraw(); } },
    ],
  }).el));
  return wrap;
}

function renameTag(oldTag, redraw) {
  const { modal: m } = formModal({
    title: `Rename “${oldTag}”`, size: 'narrow', columns: 1,
    values: { name: oldTag },
    fields: [{ key: 'name', label: 'New tag name', type: 'text', required: true }],
    onSubmit: async v => {
      let n = 0;
      for (const t of state.transactions.filter(t => (t.tags || []).includes(oldTag))) {
        await store.save('transactions', { ...t, tags: [...new Set(t.tags.map(x => (x === oldTag ? v.name : x)))] }, { silent: true, auditIt: false });
        n++;
      }
      store.bus.emit('change', { store: 'transactions' });
      m.close(); toast(`Renamed across ${n} transactions`, 'ok'); redraw();
    },
  });
}

/* ---------- rules ---------- */
function rulesPanel(redraw) {
  const wrap = h('div', {});
  wrap.append(h('div', { class: 'insight mb' }, h('div', { class: 'ic', html: icon('sparkle', 15) }),
    h('div', { class: 'tt' }, h('b', { text: 'How auto-categorisation works' }),
      h('p', { text: 'Rules run first and always win. If no rule matches, a naive-Bayes model trained on your own history proposes a category, with a confidence score. Everything runs on this device.' }))));

  const tester = h('div', { class: 'card pad mb' });
  const testInput = h('input', { class: 'inp', placeholder: 'Type a description to test, e.g. “Metro Cash & Carry weekly shop”' });
  const testOut = h('div', { class: 'mt-sm tiny t3', text: 'Result appears here.' });
  testInput.oninput = () => {
    const sg = suggestCategory(testInput.value, 'expense', 0);
    testOut.innerHTML = sg
      ? `<span class="tag acc">${esc(sg.label)}</span> <span class="t2">${esc(sg.reason)} · ${Math.round(sg.confidence * 100)}% confidence</span>`
      : '<span class="t3">No confident match — the transaction would stay uncategorised.</span>';
  };
  tester.append(h('div', { class: 'up mb', text: 'Test the classifier' }), testInput, testOut);
  wrap.append(tester);

  wrap.append(dataTable([
    { key: 'pattern', label: 'Pattern', render: r => h('code', { class: 'mono tiny', style: { background: 'var(--surface-3)', padding: '3px 7px', borderRadius: '6px' }, text: r.pattern }) },
    { key: 'matchType', label: 'Match', render: r => tag(r.matchType === 'regex' ? 'Regex' : 'Contains', 'info') },
    { key: 'categoryId', label: 'Assign to', value: r => store.catName(r.categoryId),
      render: r => h('span', { class: 'chip', style: { background: store.catColor(r.categoryId) + '22', color: store.catColor(r.categoryId) }, text: store.catName(r.categoryId) }) },
    { key: 'priority', label: 'Priority', align: 'center' },
    { key: 'active', label: 'Status', render: r => tag(r.active === false ? 'Off' : 'On', r.active === false ? '' : 'pos') },
  ], {
    rows: sortBy(state.rules, r => -(r.priority || 0)), exportName: 'rules', pageSize: 20,
    emptyTitle: 'No rules yet', emptyMsg: 'Rules give you deterministic control — “anything containing netflix is a Subscription”.', emptyIcon: 'sparkle',
    onRowClick: r => editRule(r, redraw),
    actions: r => [
      { label: 'Edit', icon: 'edit', onClick: () => editRule(r, redraw) },
      { label: r.active === false ? 'Enable' : 'Disable', icon: 'repeat', onClick: async () => {
        await store.save('rules', { ...r, active: r.active === false }); trainCategorizer(); redraw(); } },
      { label: 'Apply to existing transactions', icon: 'check', onClick: () => applyRule(r, redraw) },
      '-',
      { label: 'Delete', icon: 'trash', danger: true, onClick: async () => {
        if (await confirmDelete('this rule')) { await store.remove('rules', r.id); trainCategorizer(); redraw(); } } },
    ],
  }).el);
  return wrap;
}

function editRule(r, redraw) {
  const { modal: m } = formModal({
    title: r ? 'Edit rule' : 'New auto-categorisation rule', size: '', columns: 2,
    values: r || { matchType: 'contains', priority: 5, active: true },
    fields: [
      { key: 'pattern', label: 'Text or pattern to match', type: 'text', required: true, col: 'full',
        placeholder: 'netflix   ·   uber|careem   ·   metro cash',
        validate: (v, mm) => { if (mm.matchType === 'regex') { try { new RegExp(v); } catch { return 'Not a valid regular expression'; } } return ''; } },
      { key: 'matchType', label: 'Match type', type: 'select', options: [['contains', 'Contains text'], ['regex', 'Regular expression']] },
      { key: 'categoryId', label: 'Assign category', type: 'select', required: true,
        options: [...categoryOptions('expense'), ...categoryOptions('income')] },
      { key: 'minAmount', label: 'Only if amount ≥', type: 'money' },
      { key: 'maxAmount', label: 'Only if amount ≤', type: 'money' },
      { key: 'priority', label: 'Priority', type: 'number', min: 0, max: 100, hint: 'Higher runs first' },
      { key: 'active', label: 'Rule is active', type: 'switch', col: 'full' },
    ],
    onSubmit: async v => {
      const saved = await store.save('rules', { ...(r || {}), ...v });
      trainCategorizer();
      m.close(); toast('Rule saved', 'ok');
      redraw();
      setTimeout(() => applyRule(saved, redraw, true), 200);
    },
  });
}

async function applyRule(r, redraw, ask = false) {
  const matches = state.transactions.filter(t => {
    const text = `${t.notes || ''} ${t.merchant || ''}`.toLowerCase();
    const hit = r.matchType === 'regex'
      ? (() => { try { return new RegExp(r.pattern, 'i').test(text); } catch { return false; } })()
      : text.includes(String(r.pattern).toLowerCase());
    return hit && t.categoryId !== r.categoryId && t.type !== 'transfer';
  });
  if (!matches.length) { if (!ask) toast('No existing transactions match this rule', 'info'); return; }
  const ok = await confirm({ title: `Apply to ${matches.length} existing transactions?`,
    message: `They will be recategorised to ${store.catName(r.categoryId)}.`, confirmText: 'Apply' });
  if (!ok) return;
  for (const t of matches) await store.save('transactions', { ...t, categoryId: r.categoryId }, { silent: true, auditIt: false });
  await store.audit('rule-apply', 'transactions', r.id, `${matches.length} recategorised`);
  store.bus.emit('change', { store: 'transactions', action: 'bulk' });
  toast(`${matches.length} transactions recategorised`, 'ok');
  redraw();
}

/* ═══════════ CUSTOM MODULE BUILDER ═══════════ */
function modulesPanel(redraw, api) {
  const wrap = h('div', {});
  wrap.append(h('div', { class: 'insight mb' }, h('div', { class: 'ic', html: icon('sparkle', 15) }),
    h('div', { class: 'tt' }, h('b', { text: 'Build your own module — no code required' }),
      h('p', { text: 'Define the fields you need and Cash Checker generates a full screen: forms, validation, a searchable table, filters, summaries, CSV export and its own navigation entry.' }))));

  const grid = h('div', { class: 'grid auto-lg' });
  if (!state.entityTypes.length) {
    grid.append(empty('No custom modules yet', 'Rental properties, client projects, vehicles, inventory, staff advances — anything you track that is not a plain transaction.', 'sparkle',
      h('button', { class: 'btn primary sm mt', onClick: () => editEntityType(null, redraw, api) }, 'Create a module')));
  }
  state.entityTypes.forEach(t => {
    const records = state.entityRecords.filter(r => r.typeId === t.id);
    const sums = (t.fields || []).filter(f => f.summary === 'sum' && f.type === 'money')
      .map(f => ({ label: f.label, value: money(records.reduce((a, r) => a + (Number(r.data?.[f.key]) || 0), 0)) }));
    grid.append(h('div', { class: 'card pad' },
      h('div', { class: 'row between mb' },
        h('div', { class: 'row', style: { gap: '10px' } },
          h('div', { class: 'avatar', style: { background: (t.color || '#7c5cff') + '22', color: t.color || '#7c5cff' }, html: icon(t.icon || 'sparkle', 17) }),
          h('div', {}, h('b', { text: t.name }), h('div', { class: 'tiny t3', text: `${(t.fields || []).length} fields · ${records.length} records` }))),
        h('button', { class: 'icon-btn', html: icon('dots', 16), onClick: e => menu(e.currentTarget, [
          { label: 'Open module', icon: 'eye', onClick: () => api.navigate(`custom/${t.id}`) },
          { label: 'Edit fields', icon: 'edit', onClick: () => editEntityType(t, redraw, api) },
          { label: 'Duplicate', icon: 'copy', onClick: async () => {
            await store.save('entityTypes', { ...t, id: undefined, name: `${t.name} copy` }); redraw(); } },
          '-',
          { label: 'Delete module', icon: 'trash', danger: true, onClick: async () => {
            if (await confirm({ title: `Delete ${t.name}?`, danger: true, confirmText: 'Delete',
              message: `All ${records.length} records inside it are deleted too.` })) {
              await store.remove('entityTypes', t.id); toast('Module deleted', 'ok'); redraw(); } } },
        ]) })),
      t.description ? h('p', { class: 'tiny t2', style: { marginBottom: '9px' }, text: t.description }) : null,
      sums.length ? h('div', { class: 'row wrap', style: { gap: '13px', marginBottom: '9px' } },
        ...sums.map(s => h('div', {}, h('div', { class: 'tiny t3', text: s.label }),
          h('div', { class: 'num', style: { fontWeight: 700 }, text: fmtMoney(s.value) })))) : null,
      h('div', { class: 'row wrap', style: { gap: '5px', marginBottom: '10px' } },
        ...(t.fields || []).slice(0, 6).map(f => tag(f.label)),
        (t.fields || []).length > 6 ? tag(`+${t.fields.length - 6}`) : null),
      h('button', { class: 'btn sm block', text: 'Open module', onClick: () => api.navigate(`custom/${t.id}`) })));
  });
  wrap.append(grid);
  return wrap;
}

const FIELD_TYPES = [['text', 'Text'], ['textarea', 'Long text'], ['number', 'Number'], ['money', 'Money'],
  ['percent', 'Percentage'], ['date', 'Date'], ['select', 'Dropdown'], ['switch', 'Yes / no'],
  ['tags', 'Tags'], ['email', 'Email'], ['tel', 'Phone'], ['attach', 'Attachments']];

function editEntityType(t, redraw, api) {
  let fields = structuredClone(t?.fields || [
    { key: 'title', label: 'Name', type: 'text', required: true },
  ]);
  const listEl = h('div', { class: 'col' });

  const drawFields = () => {
    listEl.innerHTML = '';
    fields.forEach((f, i) => {
      const row = h('div', { class: 'card pad', style: { padding: '11px' } });
      const label = h('input', { class: 'inp', style: { flex: 2 }, value: f.label, placeholder: 'Field label' });
      const type = h('select', { class: 'inp', style: { flex: 1 } },
        ...FIELD_TYPES.map(([v, l]) => h('option', { value: v, selected: f.type === v }, l)));
      const req = h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!f.required }),
        h('span', { class: 'track' }), h('span', { class: 'tiny', text: 'Required' }));
      label.oninput = () => { f.label = label.value; f.key = f.key || slug(label.value) || uid('f'); };
      type.onchange = () => { f.type = type.value; drawFields(); };
      req.querySelector('input').onchange = e => { f.required = e.target.checked; };
      row.append(h('div', { class: 'row', style: { gap: '7px' } }, label, type, req,
        h('button', { class: 'icon-btn', html: icon('down', 15), title: 'Move down', disabled: i === fields.length - 1,
          onClick: () => { [fields[i], fields[i + 1]] = [fields[i + 1], fields[i]]; drawFields(); } }),
        h('button', { class: 'icon-btn', html: icon('trash', 15), disabled: fields.length === 1,
          onClick: () => { fields.splice(i, 1); drawFields(); } })));
      if (f.type === 'select') {
        const opts = h('input', { class: 'inp', style: { marginTop: '7px' }, value: (f.options || []).join(', '),
          placeholder: 'Dropdown choices, comma separated — e.g. Occupied, Vacant, Notice period' });
        opts.oninput = () => { f.options = opts.value.split(',').map(s => s.trim()).filter(Boolean); };
        row.append(opts);
      }
      if (f.type === 'money' || f.type === 'number') {
        const sum = h('label', { class: 'switch', style: { marginTop: '7px' } },
          h('input', { type: 'checkbox', checked: f.summary === 'sum' }), h('span', { class: 'track' }),
          h('span', { class: 'tiny', text: 'Show a total for this field on the module dashboard' }));
        sum.querySelector('input').onchange = e => { f.summary = e.target.checked ? 'sum' : null; };
        row.append(sum);
      }
      listEl.append(row);
    });
  };
  drawFields();

  const meta = form([
    { key: 'name', label: 'Module name', type: 'text', required: true, col: 'full', placeholder: 'e.g. Rental Properties, Client Projects, Vehicles' },
    { key: 'description', label: 'Short description', type: 'text', col: 'full' },
    { key: 'icon', label: 'Icon', type: 'select', options: ['sparkle', 'home', 'wallet', 'bank', 'book', 'trend', 'mega', 'target', 'flame', 'user', 'file', 'tag', 'calendar', 'clock'] },
    { key: 'color', label: 'Colour', type: 'color' },
  ], t || { icon: 'sparkle', color: '#7c5cff' }, { columns: 2 });

  const m = modal({
    title: t ? `Edit ${t.name}` : 'New custom module', size: 'wide',
    subtitle: 'Design the record type once — the entire screen is generated from it.',
    body: frag(meta.el,
      h('div', { class: 'up mt', style: { marginBottom: '8px' }, text: 'Fields' }),
      listEl,
      h('button', { class: 'btn sm mt-sm', html: `${icon('plus', 14)} Add field`,
        onClick: () => { fields.push({ key: uid('f'), label: '', type: 'text' }); drawFields(); } })),
    footer: frag(h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onClick: async () => {
        if (!meta.validate()) return;
        const clean = fields.filter(f => f.label?.trim()).map(f => ({ ...f, key: f.key || slug(f.label) || uid('f') }));
        if (!clean.length) { toast('Add at least one field', 'warn'); return; }
        const saved = await store.save('entityTypes', { ...(t || {}), ...meta.read(), fields: clean });
        m.close(); toast(t ? 'Module updated' : 'Module created', 'ok');
        redraw();
        if (!t) api.navigate(`custom/${saved.id}`);
      } }, t ? 'Save changes' : 'Create module')),
  });
}
