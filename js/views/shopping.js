/* ═══════════ views/shopping.js — Shopping Lists ═══════════
   Three things live here, and they exist for one reason: the list has to be
   usable while STANDING IN THE SHOP, not just while planning at home.

   1. Lists & items — a list is one shopping trip. Ticking an item off records it
      as an expense straight away; unticking deletes that expense again, so a
      mis-tap cannot leave a phantom transaction behind.

   2. Products — a saved catalogue of what you buy, with its unit and last price.
      Adding "Sugar 1 kg" for the fifth time should be two taps, not retyping.
      The catalogue fills itself: anything you actually buy is remembered, so it
      gets more useful the more it is used, with nobody maintaining it.

   3. Shop mode — big rows, one tap per item, a running trolley total. Tapping an
      unpriced item asks for its price there and then, because the shelf is
      exactly where that number becomes known.

   The paying account and expense category live on the LIST, not on each item:
   asked once, saved, reused for every tick after that.
   ═══════════════════════════════════════════════════════════ */

import {
  h, frag, icon, stat, tag, empty, toast, modal, formModal, confirm, store, state, settings,
  fmtMoney, fmtDate, today, sortBy, money, monthKey, bar, pageHead, kpiGrid, confirmDelete,
  categoryOptions, accountOptions,
} from './common.js';
import { dataTable, prompt } from '../ui.js';

/** Units people actually shop in. Free text invited kg / Kg / KG and made the
    catalogue unmatchable, so this is a fixed list. Blank is allowed. */
export const UNITS = ['pcs', 'kg', 'g', 'l', 'ml', 'pack', 'packet', 'box', 'bag',
  'bottle', 'can', 'tin', 'dozen', 'bunch', 'block', 'tray', 'lb', 'oz'];

/** How people actually type units, mapped onto UNITS above. "500g", "1 Kg",
    "2 ltr", "3 pkt" all have to land on the same value or the catalogue splits
    into near-duplicates that never match each other. */
const UNIT_ALIASES = {
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  g: 'g', gm: 'g', gms: 'g', gr: 'g', gram: 'g', grams: 'g',
  l: 'l', lt: 'l', ltr: 'l', ltrs: 'l', litre: 'l', litres: 'l', liter: 'l', liters: 'l',
  ml: 'ml', mls: 'ml',
  pc: 'pcs', pcs: 'pcs', piece: 'pcs', pieces: 'pcs', nos: 'pcs', unit: 'pcs', units: 'pcs',
  pack: 'pack', packs: 'pack', pkt: 'packet', pkts: 'packet', packet: 'packet', packets: 'packet',
  box: 'box', boxes: 'box', bag: 'bag', bags: 'bag',
  bottle: 'bottle', bottles: 'bottle', btl: 'bottle',
  can: 'can', cans: 'can', tin: 'tin', tins: 'tin',
  dozen: 'dozen', dz: 'dozen', doz: 'dozen',
  bunch: 'bunch', bunches: 'bunch', block: 'block', blocks: 'block',
  tray: 'tray', trays: 'tray',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
};
/* Longest first so "500gm" cannot be read as 500 g followed by a stray "m". */
const ALIAS_RE = Object.keys(UNIT_ALIASES).sort((a, b) => b.length - a.length).join('|');
/* Only measures are recognised WITHOUT a number in front. "can", "box", "tin",
   "unit" are ordinary words too, and eating them out of a product name ("milk
   can", "unit pack") is worse than making someone pick the unit by hand. */
const BARE_RE = ['kilograms', 'kilogram', 'kilos', 'kilo', 'kgs', 'kg', 'grams', 'gram', 'gms', 'gm', 'g',
  'litres', 'litre', 'liters', 'liter', 'ltrs', 'ltr', 'lt', 'l', 'mls', 'ml',
  'dozen', 'pcs', 'pounds', 'pound', 'lbs', 'lb', 'ounces', 'ounce', 'oz'].join('|');

/**
 * Reads one typed line into an item: "rice 1kg" → Rice, 1, kg.
 *
 * Written for how a shopping list is actually jotted down — one line, name and
 * amount together, in whatever order they come out. Quantity, unit and price are
 * all optional; "milk" alone is a perfectly good reminder to buy milk.
 *
 *   rice 1kg        → Rice · 1 kg
 *   sugar 500g      → Sugar · 500 g
 *   coconut oil 1l  → Coconut oil · 1 l
 *   oil 500ml       → Oil · 500 ml
 *   milk 2          → Milk · 2
 *   2kg onion @90   → Onion · 2 kg · 90
 */
export function parseItem(raw) {
  let s = String(raw || '').trim().replace(/\s+/g, ' ');
  let price = null, qty = null, unit = '';

  // Price only when explicitly marked, never "the last number" — that would
  // turn "milk 2" into two rupees of milk.
  s = s.replace(/(?:@|₹|rs\.?)\s*(\d+(?:[.,]\d+)?)/i, (_, n) => {
    price = Number(String(n).replace(',', '.')); return ' ';
  }).trim();

  const cut = (str, at, len) => (str.slice(0, at) + ' ' + str.slice(at + len)).replace(/\s+/g, ' ').trim();

  const m = s.match(new RegExp(`(?:^|\\s)(\\d+(?:[.,]\\d+)?)\\s*(${ALIAS_RE})?(?=\\s|$)`, 'i'));
  if (m) {
    qty = Number(String(m[1]).replace(',', '.'));
    if (m[2]) unit = UNIT_ALIASES[m[2].toLowerCase()] || '';
    s = cut(s, m.index, m[0].length);
  }
  if (!unit) {
    const b = s.match(new RegExp(`(?:^|\\s)(${BARE_RE})(?=\\s|$)`, 'i'));
    if (b) { unit = UNIT_ALIASES[b[1].toLowerCase()] || ''; s = cut(s, b.index, b[0].length); }
  }

  const name = s.replace(/^[-–,.\s]+|[-–,.\s]+$/g, '');
  return { name: name.charAt(0).toUpperCase() + name.slice(1), qty, unit, price };
}

const itemsOf = listId => state.shoppingItems.filter(i => i.listId === listId);
const lineTotal = i => Number(i.price) || 0;
const qtyLabel = i => (i.qty ? `${i.qty}${i.unit ? ` ${i.unit}` : ''}` : i.unit || '');
const listOf = id => store.find('shoppingLists', id);
const sumOf = rows => money(rows.reduce((a, i) => a + lineTotal(i), 0));
const norm = s => String(s || '').trim().toLowerCase();
const productNamed = name => state.products.find(p => norm(p.name) === norm(name));

export async function render(root, api) {
  let tab = 'active';
  const draw = () => { root.innerHTML = ''; root.append(build(tab, t => { tab = t; draw(); }, draw, api)); };
  draw();
  return store.bus.on('change', ({ store: s }) => {
    if (['shoppingLists', 'shoppingItems', 'products', 'transactions'].includes(s)) draw();
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
    'Take the list to the shop and tap each thing off as it goes in the trolley.',
    h('button', { class: 'btn primary', html: `${icon('plus', 16)} New list`, onClick: () => editList(null, redraw) })));

  wrap.append(kpiGrid(
    stat({ label: 'Active lists', value: String(active.length), icon: 'cart', tone: 'info',
      foot: h('span', { class: 't3', text: `${lists.length - active.length} completed` }) }),
    stat({ label: 'Items to buy', value: String(pending.length), icon: 'check', tone: pending.length ? 'warn' : 'pos',
      foot: h('span', { class: 't3', text: 'Across active lists' }) }),
    stat({ label: 'Still to spend', value: fmtMoney(sumOf(pending)), icon: 'wallet',
      foot: h('span', { class: 't3', text: 'Priced items only' }) }),
    stat({ label: 'Saved products', value: String(state.products.length), icon: 'tag',
      foot: h('span', { class: 't3', text: 'Reusable catalogue' }) }),
    stat({ label: 'Shopping this month', value: fmtMoney(spentThisMonth), icon: 'trend',
      foot: h('span', { class: 't3', text: fmtDate(today(), 'mon') }) })));

  const tabsEl = h('div', { class: 'tabs mt' });
  [['active', 'Active'], ['done', 'Completed'], ['products', 'Products'], ['items', 'All items']]
    .forEach(([v, l]) => tabsEl.append(h('button', { class: v === tab ? 'on' : '', text: l, onClick: () => setTab(v) })));
  wrap.append(tabsEl);
  const body = h('div', { class: 'mt' });
  wrap.append(body);

  if (tab === 'products') { body.append(productsPanel(redraw)); return wrap; }
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
    onClick: () => (done ? openList(l, redraw) : shopMode(l, redraw)) },
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
      done ? null : h('button', { class: 'btn xs primary', html: `${icon('cart', 14)} Shop`,
        onClick: e => { e.stopPropagation(); shopMode(l, redraw); } }),
      h('button', { class: 'btn xs', text: 'Items', onClick: e => { e.stopPropagation(); openList(l, redraw); } }),
      h('button', { class: 'btn xs', html: icon('edit', 14), title: 'Edit list',
        onClick: e => { e.stopPropagation(); editList(l, redraw); } })));
}

/* ---------- the list itself ---------- */
function openList(l0, redraw) {
  const m = modal({ title: l0.name, subtitle: l0.note || 'Everything on this list', size: 'wide' });

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
    m.body.append(h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '8px' } },
      h('button', { class: 'btn sm', html: `${icon('tag', 14)} Add from products`, onClick: () => pickProducts(l, drawBody) }),
      l.status === 'done' ? null : h('button', { class: 'btn sm', html: `${icon('cart', 14)} Shop mode`,
        onClick: () => { m.close(); shopMode(l, redraw); } })));

    if (!its.length) {
      m.body.append(h('div', { class: 'mt' }, empty('Empty list',
        'Type a line like “rice 1kg” above, or pick from your saved products.', 'cart')));
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
   ONE box, the way a list actually gets jotted down: "rice 1kg", "sugar 500g",
   "milk 2". parseItem() pulls the quantity and unit out, so nobody has to tab
   between three fields for every single line.

   The price is deliberately NOT filled in from the catalogue here. An item with
   no price gets asked for at the shelf in Shop mode, and silently reusing an old
   price would record a wrong number without anyone being asked. The last price
   paid is shown under the box as information instead. */
function quickAdd(l, after) {
  const box = h('input', { class: 'inp', type: 'text', style: { flex: 1, minWidth: '170px' },
    placeholder: 'Add things need to buy — e.g. rice 1kg' });
  const hint = h('div', { class: 'tiny t3', style: { marginTop: '5px', minHeight: '17px' } });

  const show = () => {
    if (!box.value.trim()) {
      hint.textContent = 'Quantity and unit are picked up automatically — kg, g, l, ml, pcs, dozen, pack, lb. Add @90 to set a price.';
      return;
    }
    const it = parseItem(box.value);
    const known = productNamed(it.name);
    hint.textContent = [
      it.name || '—',
      it.qty ? `${it.qty}${it.unit ? ` ${it.unit}` : ''}` : (it.unit || null),
      it.price ? fmtMoney(it.price) : null,
      !it.price && known && Number(known.price) ? `last paid ${fmtMoney(known.price)}` : null,
    ].filter(Boolean).join('   ·   ');
  };

  const add = async () => {
    const it = parseItem(box.value);
    if (!it.name) { box.focus(); return; }
    const known = productNamed(it.name);
    await store.save('shoppingItems', {
      listId: l.id, name: it.name, qty: it.qty,
      unit: it.unit || known?.unit || '',      // the catalogue already knows rice comes in kg
      price: it.price || 0,
      bought: false,
    });
    box.value = ''; show(); box.focus(); after();
  };

  box.addEventListener('input', show);
  box.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  show();

  return h('div', {},
    h('div', { class: 'row', style: { gap: '6px' } }, box,
      h('button', { class: 'btn primary', html: icon('plus', 16), title: 'Add item', onClick: add })),
    hint);
}

/** Setting or correcting a price mid-shop without leaving Shop mode. Keeps an
    already recorded expense in step with the new number. */
async function editPrice(i, after) {
  const typed = await prompt({
    title: i.name, label: `Price${qtyLabel(i) ? ` for ${qtyLabel(i)}` : ''}`,
    type: 'number', value: lineTotal(i) || '', confirmText: 'Save',
  });
  if (typed === null) return;
  const rec = await store.save('shoppingItems', { ...i, price: Number(typed) || 0 });
  const t = rec.bought && rec.txnId ? store.find('transactions', rec.txnId) : null;
  if (t && Number(t.amount) !== lineTotal(rec)) await store.save('transactions', { ...t, amount: lineTotal(rec) });
  after();
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
async function markBought(i, l, { askPrice = false } = {}) {
  let price = lineTotal(i);

  // The shelf is where the price becomes known, so ask for it there rather than
  // making someone leave Shop mode to go and edit the item.
  if (askPrice && !price) {
    const typed = await prompt({
      title: i.name, label: `Price paid${qtyLabel(i) ? ` for ${qtyLabel(i)}` : ''}`,
      type: 'number', placeholder: '0', confirmText: 'Bought',
    });
    if (typed === null) return false;              // cancelled — leave it unbought
    price = Number(typed) || 0;
    if (price) i = await store.save('shoppingItems', { ...i, price });
  }

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
  await rememberProduct(i, price);
  return true;
}

async function toggleBought(i, l, opts) {
  if (i.bought) {
    if (i.txnId && store.find('transactions', i.txnId)) await store.remove('transactions', i.txnId);
    await store.save('shoppingItems', { ...i, bought: false, boughtAt: null, txnId: null });
    return;
  }
  const ok = await markBought(i, l, opts);
  if (!ok) return;
  const paid = lineTotal(store.find('shoppingItems', i.id) || i);
  if (paid > 0) toast(`${fmtMoney(paid)} recorded as an expense`, 'ok');
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
      { key: 'unit', label: 'Unit', type: 'select', options: UNITS, placeholder: 'No unit' },
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
    { key: 'unit', label: 'Unit', render: r => (r.unit ? tag(r.unit) : '—') },
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
      h('td', {}), h('td', {}),
      h('td', { class: 'right num', text: fmtMoney(sumOf(data)) }),
      h('td', { colspan: 2 })),
  }).el;
}

/* ═══════════ SHOP MODE ═══════════
   What you hold in your hand in the aisle. Deliberately sparse: no tables, no
   editing, nothing to mis-tap. One big row per thing, one tap = in the trolley.
   Unbought stay on top so the list shrinks towards nothing as you go. */
function shopMode(l0, redraw) {
  const m = modal({ title: l0.name, subtitle: 'Tap an item as it goes in the trolley', size: 'wide' });

  const drawBody = () => {
    const l = listOf(l0.id) || l0;
    const its = itemsOf(l.id);
    const left = its.filter(i => !i.bought).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const got = its.filter(i => i.bought).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    m.body.innerHTML = '';

    if (!its.length) {
      m.body.append(empty('Nothing on this list', 'Add what you need before heading out.', 'cart',
        h('button', { class: 'btn primary sm mt', onClick: () => { m.close(); openList(l, redraw); } }, 'Add items')));
    }

    if (left.length) {
      m.body.append(h('div', { class: 'nav-group', text: `To buy — ${left.length}` }));
      left.forEach(i => m.body.append(shopRow(i, l, drawBody, redraw)));
    } else if (its.length) {
      m.body.append(h('div', { class: 'card pad', style: { textAlign: 'center' } },
        h('b', { text: 'Everything on the list is in the trolley' }),
        h('div', { class: 'tiny t3', style: { marginTop: '4px' }, text: 'Complete the list below to close it off.' })));
    }

    if (got.length) {
      m.body.append(h('div', { class: 'nav-group', style: { marginTop: '14px' }, text: `In the trolley — ${got.length}` }));
      got.forEach(i => m.body.append(shopRow(i, l, drawBody, redraw)));
    }

    m.setFooter(frag(
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { class: 'num', style: { fontWeight: 700, fontSize: '1.15rem' }, text: fmtMoney(sumOf(got)) }),
        h('div', { class: 'tiny t3', text: left.length
          ? `${left.length} still to get · ${fmtMoney(sumOf(left))} estimated`
          : 'Nothing left to get' })),
      h('button', { class: 'btn', text: 'Edit items', onClick: () => { m.close(); openList(l, redraw); } }),
      left.length ? null : h('button', { class: 'btn primary', text: 'Complete list', onClick: async () => {
        await store.save('shoppingLists', { ...(listOf(l.id) || l), status: 'done' });
        toast('List completed', 'ok'); m.close(); redraw();
      } })));
  };

  drawBody();
}

/** One big, thumb-sized row — 46px tap target, no small controls beside it. */
function shopRow(i, l, after, redraw) {
  const off = !!i.bought;
  return h('div', { class: 'row', style: {
    gap: '12px', alignItems: 'center', padding: '12px 4px',
    borderBottom: '1px solid var(--border)', opacity: off ? '.55' : '1' } },
    h('button', {
      class: `btn ${off ? 'pos' : ''}`,
      style: { width: '46px', height: '46px', padding: '0', display: 'grid', placeItems: 'center', flex: '0 0 auto' },
      title: off ? 'Take it back out' : 'Into the trolley',
      html: icon('check', 22),
      onClick: async () => { await toggleBought(i, l, { askPrice: true }); after(); redraw(); },
    }),
    h('div', { style: { flex: 1, minWidth: 0 } },
      h('div', { class: 'ell', style: { fontSize: '1.03rem', fontWeight: 560, textDecoration: off ? 'line-through' : 'none' }, text: i.name }),
      h('div', { class: 'tiny t3', text: [qtyLabel(i), i.note].filter(Boolean).join(' · ') || 'no quantity set' })),
    h('div', { style: { textAlign: 'right', flex: '0 0 auto', cursor: 'pointer' },
      title: 'Tap to set or correct the price',
      onClick: async () => { await editPrice(i, after); redraw(); } },
      h('div', { class: 'num', style: { fontWeight: 660 }, text: lineTotal(i) ? fmtMoney(lineTotal(i)) : '—' }),
      h('div', { class: 'tiny t3', text: lineTotal(i) ? 'tap to change' : 'asks on tap' })));
}

/* ═══════════ PRODUCTS ═══════════
   The catalogue fills itself from what is actually bought — a typo you never buy
   never lands here, and the price stays current without anyone maintaining it. */
async function rememberProduct(i, price) {
  const name = String(i.name || '').trim();
  if (!name) return;
  const p = productNamed(name);
  await store.save('products', {
    ...(p || {}),
    name,
    unit: i.unit || p?.unit || '',
    price: price || Number(p?.price) || 0,
    timesBought: (p?.timesBought || 0) + 1,
    lastBoughtAt: today(),
  }, { silent: true, auditIt: false });
}

function productsPanel(redraw) {
  const wrap = h('div', {});
  wrap.append(h('div', { class: 'row between wrap mb', style: { gap: '8px' } },
    h('div', { style: { minWidth: 0 } }, h('b', { text: 'Product catalogue' }),
      h('div', { class: 'tiny t3', text: 'What you buy, with its unit and last price. Pick from here instead of retyping.' })),
    h('button', { class: 'btn primary sm', html: `${icon('plus', 15)} New product`, onClick: () => editProduct(null, redraw) })));

  wrap.append(dataTable([
    { key: 'name', label: 'Product', render: r => h('div', {}, h('b', { text: r.name }),
      r.note ? h('div', { class: 'tiny t3', text: r.note }) : null) },
    { key: 'unit', label: 'Unit', render: r => (r.unit ? tag(r.unit) : '—') },
    { key: 'price', label: 'Last price', align: 'right',
      render: r => h('span', { class: 'num', text: Number(r.price) ? fmtMoney(r.price) : '—' }) },
    { key: 'timesBought', label: 'Bought', align: 'right',
      render: r => h('span', { class: 'num t2', text: String(r.timesBought || 0) }) },
    { key: 'lastBoughtAt', label: 'Last bought', render: r => (r.lastBoughtAt ? fmtDate(r.lastBoughtAt) : '—') },
  ], {
    rows: state.products, pageSize: 25, exportName: 'products',
    searchFields: ['name', 'unit', 'note'],
    emptyTitle: 'No products yet',
    emptyMsg: 'Add what you buy often — or just shop, and anything you tick off is remembered here by itself.',
    emptyIcon: 'tag',
    onRowClick: p => editProduct(p, redraw),
    actions: p => [
      { label: 'Add to a list', icon: 'plus', onClick: () => addToList(p, redraw) },
      { label: 'Edit', icon: 'edit', onClick: () => editProduct(p, redraw) },
      '-',
      { label: 'Delete', icon: 'trash', danger: true, onClick: async () => {
        if (await confirmDelete(p.name, 'Lists already using it are not affected.')) {
          await store.remove('products', p.id); redraw();
        }
      } },
    ],
  }).el);
  return wrap;
}

function editProduct(p, redraw) {
  const { modal: m } = formModal({
    title: p ? `Edit ${p.name}` : 'New product', size: '', columns: 2,
    values: p || {},
    fields: [
      { key: 'name', label: 'Product name', type: 'text', required: true, col: 'full', placeholder: 'e.g. Sugar, Milk, Rice' },
      { key: 'unit', label: 'Unit', type: 'select', options: UNITS, placeholder: 'No unit' },
      { key: 'price', label: 'Usual price', type: 'money' },
      { key: 'note', label: 'Note', type: 'text', col: 'full', placeholder: 'Brand, shop, size…' },
    ],
    extraFooter: p ? h('button', { class: 'btn danger', html: icon('trash', 15), title: 'Delete product', onClick: async () => {
      if (!(await confirmDelete(p.name, 'Lists already using it are not affected.'))) return;
      await store.remove('products', p.id); m.close(); redraw();
    } }) : null,
    onSubmit: async v => {
      // Two rows for the same thing would split its price history and show up
      // twice in the picker, so refuse the duplicate instead of merging blindly.
      const dup = productNamed(v.name);
      if (dup && dup.id !== p?.id) { toast(`“${dup.name}” is already in your products`, 'warn'); return; }
      await store.save('products', { ...(p || {}), ...v });
      m.close(); redraw();
    },
  });
}

/** Put one product onto whichever open list you choose. */
function addToList(p, redraw) {
  const open = state.shoppingLists.filter(l => l.status !== 'done');
  if (!open.length) { toast('No active list — make one first', 'warn'); return; }
  const { modal: m } = formModal({
    title: `Add ${p.name}`, size: '', columns: 2,
    values: { listId: open[0].id, qty: 1, unit: p.unit || '', price: Number(p.price) || 0 },
    fields: [
      { key: 'listId', label: 'To list', type: 'select', options: open.map(l => [l.id, l.name]), required: true, col: 'full' },
      { key: 'qty', label: 'Quantity', type: 'number', min: 0, step: 'any' },
      { key: 'unit', label: 'Unit', type: 'select', options: UNITS, placeholder: 'No unit' },
      { key: 'price', label: 'Price', type: 'money', col: 'full' },
    ],
    onSubmit: async v => {
      await store.save('shoppingItems', { listId: v.listId, name: p.name, qty: Number(v.qty) || null,
        unit: v.unit || '', price: Number(v.price) || 0, bought: false });
      m.close(); toast(`${p.name} added`, 'ok'); redraw();
    },
  });
}

/** Multi-add straight from the catalogue — the two-tap path. Most-bought first,
    and anything already on the list is hidden so it cannot be added twice. */
function pickProducts(l, after) {
  const m = modal({ title: 'Add from products', subtitle: `Onto “${l.name}” — tap to add`, size: '' });
  const q = h('input', { class: 'inp', type: 'text', placeholder: 'Search products…' });
  const rowsEl = h('div', { class: 'mt' });
  let added = 0;

  const paint = () => {
    const term = norm(q.value);
    const onList = new Set(itemsOf(l.id).map(i => norm(i.name)));
    const rows = sortBy(state.products.filter(p =>
      !onList.has(norm(p.name)) && (!term || norm(p.name).includes(term))), p => -(p.timesBought || 0));

    rowsEl.innerHTML = '';
    if (!state.products.length) {
      rowsEl.append(empty('No saved products', 'Anything you tick off while shopping is remembered here automatically.', 'tag'));
      return;
    }
    if (!rows.length) {
      rowsEl.append(h('p', { class: 't3', style: { fontSize: '.86rem', padding: '10px 2px' },
        text: term ? 'Nothing matches that.' : 'Everything in your catalogue is already on this list.' }));
      return;
    }
    rows.slice(0, 60).forEach(p => rowsEl.append(h('div', { class: 'row between', style: {
      gap: '10px', padding: '10px 2px', borderBottom: '1px solid var(--border)', cursor: 'pointer' },
      onClick: async () => {
        await store.save('shoppingItems', { listId: l.id, name: p.name, qty: 1,
          unit: p.unit || '', price: Number(p.price) || 0, bought: false });
        added++; paint(); after();
      } },
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { class: 'ell', text: p.name }),
        h('div', { class: 'tiny t3', text: [p.unit, p.timesBought ? `bought ${p.timesBought}×` : null]
          .filter(Boolean).join(' · ') || 'not bought yet' })),
      h('span', { class: 'num t2', text: Number(p.price) ? fmtMoney(p.price) : '—' }),
      h('span', { class: 'btn xs primary', html: icon('plus', 13) }))));
  };

  q.addEventListener('input', paint);
  m.body.append(q, rowsEl);
  m.setFooter(frag(h('div', { class: 'spacer' }),
    h('button', { class: 'btn primary', text: 'Done', onClick: () => { m.close(); if (added) toast(`${added} added`, 'ok'); } })));
  paint();
}
