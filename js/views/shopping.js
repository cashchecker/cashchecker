/* ═══════════ views/shopping.js — Shopping Lists ═══════════
   A list is one shopping trip; its items are the things to buy. Ticking an item
   off records it as an expense straight away, so a shop run reaches the tracker
   without anyone re-typing it. Unticking deletes that expense again — a mis-tap
   should not leave a phantom transaction behind.

   The paying account and expense category live on the LIST, not on each item:
   they are asked for once, saved, and reused for every tick after that. That is
   what makes "tick = expense" automatic rather than a form every time.
   ═══════════════════════════════════════════════════════════ */

import {
  h, frag, icon, stat, tag, empty, toast, modal, formModal, confirm, store, state, settings,
  fmtMoney, fmtDate, today, sortBy, money, monthKey, bar, pageHead, kpiGrid, confirmDelete,
  categoryOptions, accountOptions,
} from './common.js';
import { dataTable } from '../ui.js';

const itemsOf = listId => state.shoppingItems.filter(i => i.listId === listId);
const lineTotal = i => Number(i.price) || 0;
const qtyLabel = i => (i.qty ? `${i.qty}${i.unit ? ` ${i.unit}` : ''}` : i.unit || '');
const listOf = id => store.find('shoppingLists', id);
const sumOf = rows => money(rows.reduce((a, i) => a + lineTotal(i), 0));

export async function render(root, api) {
  let tab = 'active';
  const draw = () => { root.innerHTML = ''; root.append(build(tab, t => { tab = t; draw(); }, draw, api)); };
  draw();
  return store.bus.on('change', ({ store: s }) => {
    if (['shoppingLists', 'shoppingItems', 'transactions'].includes(s)) draw();
  });
}

function build(tab, setTab, redraw, api) {
  const wrap = h('div', {});
  const lists = state.shoppingLists;
  const active = lists.filter(l => l.status !== 'done');
  const openIds = new Set(active.map(l => l.id));
  const pending = state.shoppingItems.filter(i => !i.bought && openIds.has(i.listId));
  const mk = monthKey(today());
  const spentThisMonth = money(state.transactions
    .filter(t => (t.tags || []).includes('shopping') && t.month === mk)
    .reduce((a, t) => a + t.base, 0));

  api.setSubtitle(`${active.length} active · ${pending.length} to buy`);

  wrap.append(pageHead('Shopping Lists',
    'Tick an item off and it is recorded as an expense on the spot.',
    h('button', { class: 'btn primary', html: `${icon('plus', 16)} New list`, onClick: () => editList(null, redraw) })));

  wrap.append(kpiGrid(
    stat({ label: 'Active lists', value: String(active.length), icon: 'cart', tone: 'info',
      foot: h('span', { class: 't3', text: `${lists.length - active.length} completed` }) }),
    stat({ label: 'Items to buy', value: String(pending.length), icon: 'check', tone: pending.length ? 'warn' : 'pos',
      foot: h('span', { class: 't3', text: 'Across active lists' }) }),
    stat({ label: 'Still to spend', value: fmtMoney(sumOf(pending)), icon: 'wallet',
      foot: h('span', { class: 't3', text: 'Priced items only' }) }),
    stat({ label: 'Shopping this month', value: fmtMoney(spentThisMonth), icon: 'trend',
      foot: h('span', { class: 't3', text: fmtDate(today(), 'mon') }) })));

  const tabsEl = h('div', { class: 'tabs mt' });
  [['active', 'Active'], ['done', 'Completed'], ['items', 'All items']]
    .forEach(([v, l]) => tabsEl.append(h('button', { class: v === tab ? 'on' : '', text: l, onClick: () => setTab(v) })));
  wrap.append(tabsEl);
  const body = h('div', { class: 'mt' });
  wrap.append(body);

  if (tab === 'items') { body.append(itemsTable(redraw)); return wrap; }

  const rows = tab === 'active' ? active : lists.filter(l => l.status === 'done');
  const grid = h('div', { class: 'grid auto stagger' });
  if (!rows.length) {
    grid.append(tab === 'active'
      ? empty('No lists yet', 'Make one for your next shop — groceries, monthly stock-up, anything.', 'cart',
        h('button', { class: 'btn primary sm mt', onClick: () => editList(null, redraw) }, 'New list'))
      : empty('Nothing completed yet', 'Lists you finish are kept here.', 'check'));
  }
  sortBy(rows, l => l.updatedAt || 0, -1).forEach(l => grid.append(listCard(l, redraw)));
  body.append(grid);
  return wrap;
}

/* ---------- list card ---------- */
function listCard(l, redraw) {
  const its = itemsOf(l.id);
  const bought = its.filter(i => i.bought);
  const left = its.filter(i => !i.bought);
  const pct = its.length ? (bought.length / its.length) * 100 : 0;
  const done = l.status === 'done';

  return h('div', { class: 'card pad', style: { cursor: 'pointer', borderLeft: `3px solid ${done ? 'var(--pos)' : 'var(--accent)'}` },
    onClick: () => openList(l, redraw) },
    h('div', { class: 'row between mb' },
      h('div', { style: { minWidth: 0 } },
        h('b', { class: 'ell', text: l.name }),
        h('div', { class: 'tiny t3', text: its.length ? `${bought.length} of ${its.length} bought` : 'No items yet' })),
      done ? tag('Completed', 'pos') : tag('Active', 'info')),
    bar(pct, done ? 'pos' : ''),
    h('div', { class: 'row between', style: { marginTop: '9px' } },
      h('span', { class: 'num', style: { fontWeight: 650 }, text: fmtMoney(sumOf(bought)) }),
      left.length ? h('span', { class: 'tiny t3', text: `${fmtMoney(sumOf(left))} left` }) : null),
    h('div', { class: 'row', style: { gap: '6px', marginTop: '9px' } },
      h('button', { class: 'btn xs primary', text: 'Open', onClick: e => { e.stopPropagation(); openList(l, redraw); } }),
      h('button', { class: 'btn xs', html: icon('edit', 14), title: 'Edit list',
        onClick: e => { e.stopPropagation(); editList(l, redraw); } })));
}

/* ---------- the list itself ---------- */
function openList(l0, redraw) {
  const m = modal({ title: l0.name, subtitle: l0.note || 'Tap the tick to mark an item bought', size: 'wide' });

  const drawBody = () => {
    // Re-read every time: ticking an item touches the list too (the account and
    // category get saved onto it the first time), so a stale copy would ask again.
    const l = listOf(l0.id) || l0;
    const its = [...itemsOf(l.id)].sort((a, b) =>
      (a.bought ? 1 : 0) - (b.bought ? 1 : 0) || (a.createdAt || 0) - (b.createdAt || 0));
    const bought = its.filter(i => i.bought);
    const left = its.filter(i => !i.bought);

    m.body.innerHTML = '';
    m.body.append(quickAdd(l, drawBody));
    if (!its.length) {
      m.body.append(h('div', { class: 'mt' }, empty('Empty list', 'Add the first thing you need to buy above.', 'cart')));
    } else {
      const rows = h('div', { class: 'mt' });
      its.forEach(i => rows.append(itemRow(i, l, drawBody)));
      m.body.append(rows);
    }

    m.setFooter(frag(
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { class: 'num', style: { fontWeight: 700 }, text: fmtMoney(sumOf(bought)) }),
        h('div', { class: 'tiny t3', text: `of ${fmtMoney(sumOf(its))} · ${bought.length}/${its.length} bought` })),
      left.length ? h('button', { class: 'btn', html: `${icon('check', 15)} Mark all bought`, onClick: async () => {
        if (left.some(i => lineTotal(i) > 0) && !(await ensureDestination(l))) return;
        let n = 0;
        for (const i of left) if (await markBought(i, listOf(l.id) || l)) n++;
        if (n) toast(`${n} item${n === 1 ? '' : 's'} bought`, 'ok');
        drawBody(); redraw();
      } }) : null,
      l.status === 'done'
        ? h('button', { class: 'btn', text: 'Reopen list', onClick: async () => {
          await store.save('shoppingLists', { ...(listOf(l.id) || l), status: 'open' });
          drawBody(); redraw();
        } })
        : h('button', { class: 'btn primary', text: 'Complete list', onClick: async () => {
          await store.save('shoppingLists', { ...(listOf(l.id) || l), status: 'done' });
          toast('List completed', 'ok'); m.close(); redraw();
        } })));
  };

  drawBody();
}

/* ---------- quick add ----------
   The fastest path in, matching how a shopping list is actually used: type,
   press Enter, keep going. Qty and price are optional — an unpriced item is
   still a valid reminder to buy something. */
function quickAdd(l, after) {
  const name = h('input', { class: 'inp', type: 'text', placeholder: 'Add things need to buy', style: { flex: 1, minWidth: '150px' } });
  const qty = h('input', { class: 'inp num', type: 'number', min: '0', step: 'any', placeholder: 'Qty', style: { width: '76px' } });
  const unit = h('input', { class: 'inp', type: 'text', placeholder: 'Unit', style: { width: '88px' } });
  const price = h('input', { class: 'inp num', type: 'number', min: '0', step: 'any', placeholder: 'Price', style: { width: '100px' } });

  const add = async () => {
    const n = name.value.trim();
    if (!n) { name.focus(); return; }
    await store.save('shoppingItems', {
      listId: l.id, name: n, qty: Number(qty.value) || null,
      unit: unit.value.trim(), price: Number(price.value) || 0, bought: false,
    });
    [name, qty, unit, price].forEach(el => { el.value = ''; });
    name.focus();
    after();
  };
  [name, qty, unit, price].forEach(el =>
    el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }));

  return h('div', { class: 'row wrap', style: { gap: '6px' } }, name, qty, unit, price,
    h('button', { class: 'btn primary', html: icon('plus', 16), title: 'Add item', onClick: add }));
}

/* ---------- one row ---------- */
function itemRow(i, l, after) {
  const off = !!i.bought;
  return h('div', { class: 'row between', style: {
    gap: '10px', padding: '10px 2px', borderBottom: '1px solid var(--border)', opacity: off ? '.62' : '1' } },
    h('button', { class: `btn xs ${off ? 'pos' : 'ghost'}`, html: icon('check', 14),
      title: off ? 'Not bought after all' : 'Mark bought',
      onClick: async () => { await toggleBought(i, l); after(); } }),
    h('div', { style: { flex: 1, minWidth: 0 } },
      h('div', { class: 'ell', style: off ? { textDecoration: 'line-through' } : null, text: i.name }),
      (qtyLabel(i) || i.note)
        ? h('div', { class: 'tiny t3', text: [qtyLabel(i), i.note].filter(Boolean).join(' · ') })
        : null),
    h('span', { class: 'num', style: { fontWeight: 620 }, text: lineTotal(i) ? fmtMoney(lineTotal(i)) : '—' }),
    h('button', { class: 'btn xs', html: icon('edit', 13), title: 'Edit', onClick: () => editItem(i, l, after) }),
    h('button', { class: 'btn xs danger', html: icon('trash', 13), title: 'Delete', onClick: async () => {
      const linked = i.txnId && store.find('transactions', i.txnId);
      if (!(await confirmDelete(i.name, linked ? 'The expense recorded for this item is removed too.' : undefined))) return;
      if (linked) await store.remove('transactions', i.txnId);
      await store.remove('shoppingItems', i.id);
      after();
    } }));
}

/* ---------- tick / untick ---------- */
/** Records the expense and marks the item. Returns false if the user backed out. */
async function markBought(i, l) {
  const price = lineTotal(i);
  let txnId = null;
  if (price > 0) {
    const dest = await ensureDestination(l);
    if (!dest) return false;
    const t = await store.save('transactions', {
      type: 'expense', amount: price, currency: settings.baseCurrency, rate: 1,
      accountId: dest.accountId, categoryId: dest.categoryId, date: today(), status: 'cleared',
      notes: `${[i.name, qtyLabel(i)].filter(Boolean).join(' × ')} · ${l.name}`,
      tags: ['shopping'],
    });
    txnId = t.id;
  }
  await store.save('shoppingItems', { ...i, bought: true, boughtAt: today(), txnId });
  return true;
}

async function toggleBought(i, l) {
  if (i.bought) {
    if (i.txnId && store.find('transactions', i.txnId)) await store.remove('transactions', i.txnId);
    await store.save('shoppingItems', { ...i, bought: false, boughtAt: null, txnId: null });
    return;
  }
  const ok = await markBought(i, l);
  if (ok && lineTotal(i) > 0) toast(`${fmtMoney(lineTotal(i))} recorded as an expense`, 'ok');
}

/** Account + category for this list. Asked once, then remembered on the list. */
function ensureDestination(l) {
  const cur = listOf(l.id) || l;
  if (cur.accountId && cur.categoryId) return Promise.resolve({ accountId: cur.accountId, categoryId: cur.categoryId });

  return new Promise(res => {
    let done = false;
    const { modal: m } = formModal({
      title: 'Where do these expenses go?',
      subtitle: `Asked once — saved on “${cur.name}” and reused for every item after this.`,
      size: '', columns: 1, submitText: 'Save & continue',
      values: { accountId: cur.accountId || '', categoryId: cur.categoryId || '' },
      fields: [
        { key: 'accountId', label: 'Pay from', type: 'select', options: accountOptions(), required: true },
        { key: 'categoryId', label: 'Expense category', type: 'select', options: categoryOptions('expense'), required: true },
      ],
      onSubmit: async v => {
        await store.save('shoppingLists', { ...cur, accountId: v.accountId, categoryId: v.categoryId });
        done = true; m.close(); res(v);
      },
      onClose: () => { if (!done) res(null); },
    });
  });
}

/* ---------- editors ---------- */
function editItem(i, l, after) {
  const { modal: m } = formModal({
    title: `Edit ${i.name}`, size: '', columns: 2,
    values: i,
    fields: [
      { key: 'name', label: 'Item', type: 'text', required: true, col: 'full', placeholder: 'e.g. Sugar' },
      { key: 'qty', label: 'Quantity', type: 'number', min: 0, step: 'any' },
      { key: 'unit', label: 'Unit', type: 'text', placeholder: 'kg, pack, block…' },
      { key: 'price', label: 'Price', type: 'money', col: 'full' },
      { key: 'note', label: 'Note', type: 'text', col: 'full' },
    ],
    onSubmit: async v => {
      const rec = { ...i, ...v };
      await store.save('shoppingItems', rec);
      // Keep an already-recorded expense honest if the price was corrected later.
      const t = rec.bought && rec.txnId ? store.find('transactions', rec.txnId) : null;
      if (t && Number(t.amount) !== lineTotal(rec)) await store.save('transactions', { ...t, amount: lineTotal(rec) });
      m.close(); after();
    },
  });
}

function editList(l, redraw) {
  const { modal: m } = formModal({
    title: l ? `Edit ${l.name}` : 'New shopping list', size: '', columns: 2,
    values: l || { status: 'open' },
    fields: [
      { key: 'name', label: 'List name', type: 'text', required: true, col: 'full', placeholder: 'e.g. Grocery, Monthly stock-up' },
      { key: 'accountId', label: 'Pay from', type: 'select', options: accountOptions(), placeholder: 'Ask me later' },
      { key: 'categoryId', label: 'Expense category', type: 'select', options: categoryOptions('expense'), placeholder: 'Ask me later' },
      { key: 'note', label: 'Note', type: 'text', col: 'full' },
    ],
    extraFooter: l ? h('button', { class: 'btn danger', html: icon('trash', 15), title: 'Delete list', onClick: async () => {
      const n = itemsOf(l.id).length;
      const detail = n
        ? `${n} item${n === 1 ? '' : 's'} on this list go too. Expenses already recorded stay in the tracker.`
        : undefined;
      if (!(await confirmDelete(l.name, detail))) return;
      await store.remove('shoppingLists', l.id);
      m.close(); redraw();
    } }) : null,
    onSubmit: async v => {
      const saved = await store.save('shoppingLists', { ...(l || { status: 'open' }), ...v });
      m.close(); redraw();
      if (!l) openList(saved, redraw);   // straight into the empty list to add items
    },
  });
}

/* ---------- every item, across lists ---------- */
function itemsTable(redraw) {
  const nameOf = id => listOf(id)?.name || '—';
  return dataTable([
    { key: 'name', label: 'Item', render: r => h('div', {}, h('b', { text: r.name }),
      qtyLabel(r) ? h('div', { class: 'tiny t3', text: qtyLabel(r) }) : null) },
    { key: 'listId', label: 'List', value: r => nameOf(r.listId),
      render: r => h('span', { class: 'tiny t2', text: nameOf(r.listId) }) },
    { key: 'price', label: 'Price', align: 'right',
      render: r => h('span', { class: 'num', text: lineTotal(r) ? fmtMoney(lineTotal(r)) : '—' }) },
    { key: 'bought', label: 'Status', value: r => (r.bought ? 'Bought' : 'To buy'),
      render: r => (r.bought ? tag('Bought', 'pos') : tag('To buy', 'warn')) },
    { key: 'boughtAt', label: 'Bought on', render: r => (r.boughtAt ? fmtDate(r.boughtAt) : '—') },
  ], {
    rows: state.shoppingItems, pageSize: 25, exportName: 'shopping-items',
    searchFields: ['name', 'unit', 'note'],
    emptyTitle: 'No items yet', emptyMsg: 'Anything you add to a list shows up here.', emptyIcon: 'cart',
    actions: r => [
      { label: r.bought ? 'Not bought after all' : 'Mark bought', icon: 'check',
        onClick: async () => { await toggleBought(r, listOf(r.listId) || { id: r.listId, name: nameOf(r.listId) }); redraw(); } },
      { label: 'Open its list', icon: 'right',
        onClick: () => { const l = listOf(r.listId); if (l) openList(l, redraw); } },
      '-',
      { label: 'Delete', icon: 'trash', danger: true, onClick: async () => {
        if (!(await confirmDelete(r.name))) return;
        if (r.txnId && store.find('transactions', r.txnId)) await store.remove('transactions', r.txnId);
        await store.remove('shoppingItems', r.id); redraw();
      } },
    ],
    footRow: data => h('tr', {},
      h('td', { class: 't3', text: `${data.length} items` }),
      h('td', {}),
      h('td', { class: 'right num', text: fmtMoney(sumOf(data)) }),
      h('td', { colspan: 2 })),
  }).el;
}
