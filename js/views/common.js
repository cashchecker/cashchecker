/* ═══════════ views/common.js — shared building blocks ═══════════ */

import {
  h, frag, icon, toast, modal, confirm, formModal, form, tag, stat, bar, avatar, menu, empty, card,
} from '../ui.js';
import {
  fmtMoney, fmtDate, today, nowTime, esc, sortBy, money, humanSize, uid, PERIODS, period,
  CURRENCIES, curSymbol, download, addMonths, monthKey, relDate, initials, colorFor, RECUR, nextOccurrence,
} from '../util.js';
import * as store from '../store.js';
import { state, settings } from '../store.js';
import { suggestCategory, reinforce, trainCategorizer } from '../ai.js';

/* ---------- option helpers ---------- */
export const accountOptions = () => store.activeAccounts().map(a => [a.id, a.name]);
/** Flat list, but sub-categories are shown indented under their parent. */
export const categoryOptions = kind => {
  const out = [];
  for (const parent of store.topCategories(kind)) {
    out.push([parent.id, `${parent.icon ? parent.icon + ' ' : ''}${parent.name}`]);
    for (const sub of store.subCategories(parent.id)) out.push([sub.id, `   ↳ ${sub.name}`]);
  }
  // orphans (a sub-category whose parent was deleted)
  for (const c of store.categoriesOf(kind)) {
    if (!out.some(o => o[0] === c.id)) out.push([c.id, c.name]);
  }
  return out;
};
export const contactOptions = () => sortBy(state.contacts, c => c.name).map(c => [c.id, c.name]);
export const currencyOptions = () =>
  CURRENCIES.map(([c, s, flag, name]) => [c, `${flag} ${c} · ${s} ${name}`]);

/* ---------- amount cell ---------- */
export function amountCell(t) {
  const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '';
  const cls = t.type === 'income' ? 'pos' : t.type === 'expense' ? 'neg' : 't2';
  return h('span', { class: `num ${cls}`, style: { fontWeight: 650 },
    text: `${sign}${fmtMoney(t.base, settings.baseCurrency)}` });
}
/** Category chip: emoji when present, and the parent shown above a sub-category. */
export const catChip = catId => {
  const c = store.find('categories', catId);
  if (!c) return h('span', { class: 'chip' }, h('span', { class: 'dot', style: { background: '#94a3b8' } }), 'Uncategorised');
  const parent = c.parentId ? store.find('categories', c.parentId) : null;
  const emoji = store.catIcon(c);
  const chip = h('span', { class: 'chip', style: { borderColor: (c.color || '#94a3b8') + '55' } },
    emoji ? h('span', { style: { fontSize: '.85em' }, text: emoji })
          : h('span', { class: 'dot', style: { background: c.color || '#94a3b8' } }),
    c.name);
  if (!parent) return chip;
  return h('span', { style: { display: 'inline-flex', flexDirection: 'column', gap: '1px' } },
    h('span', { class: 'tiny t3', style: { lineHeight: 1 }, text: parent.name }), chip);
};

/* ---------- period picker ---------- */
/**
 * Date-range chooser, as a dropdown.
 *
 * Nine chips wrap onto four rows on a phone and push the actual numbers below
 * the fold — the filter ends up taking more space than the data it filters.
 * The `title` carries the resolved dates, so "Quarter" is never a guess.
 */
export function periodSelect(value, onChange, { style, custom = false } = {}) {
  const s = h('select', {
    class: 'inp',
    'aria-label': 'Date range',
    style: { width: 'auto', minWidth: '148px', height: '31px', fontSize: '.78rem', ...(style || {}) },
  },
    ...PERIODS.map(([k, l]) => h('option', { value: k, selected: k === value }, l)),
    custom ? h('option', { value: 'custom', selected: value === 'custom' }, 'Custom range…') : null);
  const describe = () => {
    const p = period(s.value);
    s.title = p && s.value !== 'all' && s.value !== 'custom' ? `${p.from} → ${p.to}` : '';
  };
  describe();
  s.onchange = () => { describe(); onChange(s.value); };
  return s;
}

/**
 * Kept as the name callers already use, but it is the dropdown now — one
 * implementation, so no screen can drift back to a wall of chips.
 */
export function periodPicker(value, onChange, { extra } = {}) {
  const wrap = h('div', { class: 'row wrap', style: { gap: '6px', alignItems: 'center' } },
    periodSelect(value, onChange));
  if (extra) wrap.append(extra);
  return wrap;
}

/* ---------- attachments viewer ---------- */
export function attachmentStrip(files = [], { onRemove } = {}) {
  if (!files.length) return h('span', { class: 't3 tiny', text: 'No attachments' });
  return h('div', { class: 'attach-list' }, ...files.map((a, i) =>
    h('div', { class: 'attach', style: { cursor: 'pointer' }, onClick: () => viewAttachment(a) },
      a.mime?.startsWith('image/') ? h('img', { src: a.data, alt: '' }) : h('span', { html: icon('file', 15) }),
      h('span', { class: 'ell', style: { flex: 1 }, text: a.name }),
      h('span', { class: 't3 tiny', text: humanSize(a.size) }),
      onRemove ? h('button', { text: '×', onClick: e => { e.stopPropagation(); onRemove(i); } }) : null)));
}
export function viewAttachment(a) {
  modal({
    title: a.name, subtitle: `${a.mime || 'file'} · ${humanSize(a.size)}`, size: 'wide',
    body: a.mime?.startsWith('image/')
      ? h('img', { src: a.data, alt: a.name, style: { width: '100%', borderRadius: 'var(--r)' } })
      : a.mime === 'application/pdf'
        ? h('iframe', { src: a.data, style: { width: '100%', height: '70vh', border: 0, borderRadius: 'var(--r)' } })
        : empty('Preview not available', 'Download the file to open it in another application.', 'file'),
    footer: frag(h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onClick: async () => {
        const res = await fetch(a.data); download(await res.blob(), a.name);
      } }, 'Download')),
  });
}

/* ═══════════ INLINE CATEGORY MANAGEMENT ═══════════ */
/**
 * Minimal "new category" prompt for use from inside another form: name, emoji,
 * colour, nothing else. The full editor (parent, budget, keywords, notes) stays
 * on the Categories screen — offering all of that mid-transaction would be a
 * worse interruption than the one it is trying to remove.
 * Calls back with the new id, or with nothing if cancelled.
 */
export function quickAddCategory(kind, done) {
  const name = h('input', { class: 'inp', placeholder: kind === 'income' ? 'e.g. Freelance' : 'e.g. Groceries', maxlength: 40 });
  const emoji = h('input', { class: 'inp', placeholder: '🍽️', maxlength: 4, style: { textAlign: 'center', fontSize: '1.1rem' } });
  const err = h('div', { class: 'msg', hidden: true });
  let saved = false;

  const save = async btn => {
    const nm = name.value.trim();
    if (!nm) { err.textContent = 'Enter a name'; err.hidden = false; name.focus(); return; }
    const clash = state.categories.some(c => c.kind === kind && !c.parentId && c.name.toLowerCase() === nm.toLowerCase());
    if (clash) { err.textContent = 'A category with that name already exists'; err.hidden = false; name.focus(); return; }
    btn.disabled = true;
    try {
      const c = await store.save('categories', {
        name: nm, kind, parentId: '', icon: emoji.value.trim() || '',
        color: colorFor(String(state.categories.length)),
      });
      trainCategorizer();
      saved = true;
      m.close();
      toast(`${nm} added`, 'ok');
      done?.(c.id);
    } catch (e) { err.textContent = e.message; err.hidden = false; btn.disabled = false; }
  };

  const m = modal({
    title: `New ${kind} category`, size: 'narrow',
    subtitle: 'Add more detail later under Categories.',
    onClose: () => { if (!saved) done?.(null); },
    body: frag(
      h('div', { class: 'row', style: { gap: '10px', alignItems: 'flex-end' } },
        h('div', { class: 'field', style: { flex: 1 } }, h('label', { text: 'Name' }), name),
        h('div', { class: 'field', style: { width: '78px', flex: 'none' } }, h('label', { text: 'Emoji' }), emoji)),
      err),
    footer: frag(h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onClick: e => save(e.currentTarget) }, 'Add category')),
  });
  name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); m.dialog.querySelector('.btn.primary').click(); } });
  setTimeout(() => name.focus(), 60);
}

/**
 * Compact rename/delete list, again for use from inside another form.
 * Deleting a category that transactions still point at is refused here rather
 * than silently orphaning them — that needs the merge tool on the Categories
 * screen, so this says so and links there.
 */
export function manageCategories(kind, done) {
  const list = h('div', { class: 'cat-manage' });

  const draw = () => {
    list.innerHTML = '';
    const cats = store.topCategories(kind);
    if (!cats.length) { list.append(empty('No categories yet', 'Add one from the picker.', 'tag')); return; }
    cats.forEach(c => {
      const used = state.transactions.filter(t => t.categoryId === c.id
        || store.subCategories(c.id).some(s => s.id === t.categoryId)).length;
      list.append(h('div', { class: 'cat-row' },
        h('span', { class: 'em', text: store.catIcon(c) }),
        h('span', { class: 'nm', text: c.name }),
        h('span', { class: 'ct', text: used ? `${used} used` : 'unused' }),
        h('button', { class: 'icon-btn', title: `Rename ${c.name}`, html: icon('edit', 15),
          onClick: () => renameCategory(c, draw) }),
        h('button', { class: 'icon-btn', title: `Delete ${c.name}`, html: icon('trash', 15),
          style: { color: used ? 'var(--text-3)' : 'var(--neg)' },
          onClick: () => removeCategory(c, used, draw) })));
    });
  };
  draw();

  const m = modal({
    title: `Manage ${kind} categories`, size: '',
    subtitle: 'Rename or delete. Sub-categories and budgets live under Categories.',
    onClose: () => done?.(),
    body: list,
    footer: frag(
      h('button', { class: 'btn', onClick: () => { m.close(); location.hash = '#/categories'; } }, 'Open Categories'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn primary', onClick: () => m.close() }, 'Done')),
  });
}

function renameCategory(c, draw) {
  const inp = h('input', { class: 'inp', value: c.name, maxlength: 40 });
  // Seed with the icon actually on screen, not just a stored one. Most icons
  // come from the name-based default table, so renaming "Fuel" to "Petrol"
  // would otherwise silently drop ⛽ back to the generic folder.
  const emoji = h('input', { class: 'inp', value: store.catIcon(c), maxlength: 4,
    style: { textAlign: 'center', fontSize: '1.1rem' } });
  const err = h('div', { class: 'msg', hidden: true });
  const m = modal({
    title: `Rename ${c.name}`, size: 'narrow',
    body: frag(h('div', { class: 'row', style: { gap: '10px', alignItems: 'flex-end' } },
      h('div', { class: 'field', style: { flex: 1 } }, h('label', { text: 'Name' }), inp),
      h('div', { class: 'field', style: { width: '78px', flex: 'none' } }, h('label', { text: 'Emoji' }), emoji)), err),
    footer: frag(h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onClick: async () => {
        const nm = inp.value.trim();
        if (!nm) { err.textContent = 'Enter a name'; err.hidden = false; return; }
        if (state.categories.some(x => x.id !== c.id && x.kind === c.kind && !x.parentId
            && x.name.toLowerCase() === nm.toLowerCase())) {
          err.textContent = 'A category with that name already exists'; err.hidden = false; return;
        }
        await store.save('categories', { ...c, name: nm, icon: emoji.value.trim() || store.catIcon(c) });
        trainCategorizer();
        m.close(); toast('Renamed', 'ok'); draw();
      } }, 'Save')),
  });
  setTimeout(() => inp.focus(), 60);
}

async function removeCategory(c, used, draw) {
  const subs = store.subCategories(c.id);
  if (used) {
    await confirm({
      title: `${c.name} is used by ${used} transaction${used > 1 ? 's' : ''}`,
      message: 'Deleting it here would leave those uncategorised. Open Categories to merge it into another category first — that moves the transactions across, then removes it.',
      confirmText: 'Open Categories', cancelText: 'Keep it',
    }).then(go => { if (go) location.hash = '#/categories'; });
    return;
  }
  const label = subs.length ? `${c.name} and its ${subs.length} sub-categor${subs.length > 1 ? 'ies' : 'y'}` : c.name;
  if (!(await confirmDelete(label))) return;
  for (const s of subs) await store.remove('categories', s.id, { silent: true });
  await store.remove('categories', c.id);
  trainCategorizer();
  toast('Category deleted', 'ok');
  draw();
}

/* ═══════════ TRANSACTION MODAL ═══════════ */
/**
 * Full income / expense / transfer editor with AI category suggestion,
 * attachments, recurrence, tax, reminders and split support.
 */
export function openTxnModal(existing = null, { defaultType = 'expense', defaultDate, onSaved } = {}) {
  if (!state.accounts.length) {
    toast('Create an account first', 'warn', { action: 'Add account', onAction: () => (location.hash = '#/accounts') });
    return;
  }
  const isEdit = !!existing?.id;
  let type = existing?.type || defaultType;

  const build = () => {
    const kind = type === 'income' ? 'income' : 'expense';

    // A budget is a spending limit, not a movement of money, so it shares only
    // the amount and the category picker. Everything else — account, date,
    // payee, attachments — would be meaningless here.
    if (type === 'budget') {
      const taken = new Set(state.budgets.map(b => `${b.categoryId}|${b.scope || 'monthly'}`));
      return [
        { key: 'amount', label: 'Limit', type: 'money', required: true, big: true, col: 'full',
          currencyOf: () => settings.baseCurrency },
        { key: 'scope', label: 'Period', type: 'select', value: 'monthly',
          options: [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']] },
        { key: 'alertAt', label: 'Warn me at', type: 'percent', value: 80, hint: '% of the limit' },
        { key: 'catParent', label: 'Applies to', type: 'catgrid', required: true, col: 'full',
          options: () => [{ value: '*', label: 'Everything', emoji: '🌐' },
            ...store.topCategories('expense').map(c =>
              ({ value: c.id, label: c.name, emoji: store.catIcon(c), color: c.color }))],
          onAdd: () => quickAddCategory('expense', id => { if (id) ctl.set('catParent', id); rebuild(); }),
          onManage: () => manageCategories('expense', () => {
            const cur = ctl.read().catParent;
            if (cur && cur !== '*' && !store.find('categories', cur)) ctl.set('catParent', '');
            rebuild();
          }),
          validate: v => (v && taken.has(`${v}|${ctl?.read().scope || 'monthly'}`)
            ? 'A budget already exists for this category and period' : '') },
        { key: 'rollover', label: 'Roll unused amount into the next period', type: 'switch', col: 'full' },
        { key: 'notes', label: 'Note', type: 'text', col: 'full', placeholder: 'e.g. Keep eating out under control' },
      ];
    }

    const fields = [
      { key: 'amount', label: 'Amount', type: 'money', required: true, big: true, col: 'full',
        currencyOf: m => m.currency || settings.baseCurrency },
      { key: 'currency', label: 'Currency', type: 'select', options: currencyOptions(), value: settings.baseCurrency },
      { key: 'rate', label: 'Rate to ' + settings.baseCurrency, type: 'number', step: '0.000001', value: 1,
        hint: 'Only needed for foreign currency', when: m => m.currency && m.currency !== settings.baseCurrency },
      { key: 'accountId', label: type === 'transfer' ? 'From account' : 'Account', type: 'select', required: true,
        options: () => store.activeAccounts().map(a => [a.id, `${store.accEmoji(a)} ${a.name}`]) },
      { key: 'toAccountId', label: 'To account', type: 'select', required: type === 'transfer',
        options: () => store.activeAccounts().map(a => [a.id, `${store.accEmoji(a)} ${a.name}`]),
        when: () => type === 'transfer',
        validate: v => (type === 'transfer' && !v ? 'Choose a destination account' : '') },
      { key: 'catParent', label: 'Category', type: 'catgrid', required: type !== 'transfer', col: 'full',
        options: () => store.topCategories(kind).map(c =>
          ({ value: c.id, label: c.name, emoji: store.catIcon(c), color: c.color })),
        // Needing a category you have not created yet is the commonest reason to
        // abandon a half-typed transaction, so both actions live right here.
        // Rebuilding the whole form is the established way to refresh the
        // dependent sub-category chips, and it preserves everything typed so far.
        onAdd: () => quickAddCategory(kind, id => { if (id) ctl.set('catParent', id); rebuild(); }),
        onManage: () => manageCategories(kind, () => {
          // The selected category may have just been deleted — do not leave the
          // form holding an id that no longer resolves to anything.
          const cur = ctl.read().catParent;
          if (cur && !store.find('categories', cur)) { ctl.set('catParent', ''); ctl.set('categoryId', ''); }
          rebuild();
        }),
        when: () => type !== 'transfer' },
      { key: 'categoryId', label: 'Sub-category', type: 'chips', col: 'full',
        options: m => store.subCategories(m.catParent).map(c => [c.id, c.name]),
        hint: 'Optional — tap again to clear',
        when: m => type !== 'transfer' && store.subCategories(m.catParent).length > 0 },
      { key: 'date', label: 'Date', type: 'date', required: true, value: defaultDate || today() },
      { key: 'time', label: 'Time', type: 'time', value: nowTime() },
      { key: 'notes', label: 'Notes / description', type: 'text', col: 'full',
        placeholder: 'e.g. Monthly grocery run at Metro', hint: 'Used to auto-suggest a category' },
      { key: 'paymentMethod', label: 'Payment method', type: 'select', options: store.PAYMENT_METHODS },
      { key: 'status', label: 'Payment status', type: 'select', options: [['cleared', 'Cleared'], ['pending', 'Pending'], ['scheduled', 'Scheduled']] },
      { key: 'tags', label: 'Tags', type: 'tags', col: 'full', suggestions: store.allTags().slice(0, 10) },
      { key: 'merchant', label: 'Merchant / payee', type: 'text', datalist: [...new Set(state.transactions.map(t => t.merchant).filter(Boolean))].slice(0, 40) },
      { key: 'location', label: 'Location', type: 'text', placeholder: 'City, place or address' },
      { key: 'taxAmount', label: 'Tax included', type: 'money', when: () => type !== 'transfer' },
      { key: 'priority', label: 'Priority', type: 'select', options: [['normal', 'Normal'], ['high', 'High'], ['low', 'Low']], when: () => type === 'expense' },
      { key: 'dueDate', label: 'Due date', type: 'date', when: m => m.status !== 'cleared' },
      { key: 'reminderAt', label: 'Remind me on', type: 'date', when: m => m.status !== 'cleared' },
      { key: 'recurrence', label: 'Repeat', type: 'select', options: RECUR, value: 'none', col: 'full' },
      { key: 'attachments', label: 'Receipt / invoice', type: 'attach', col: 'full' },
    ];
    return fields;
  };

  // Split a stored categoryId back into parent + sub for the two-level picker.
  const splitCat = catId => {
    if (!catId) return {};
    const c = store.find('categories', catId);
    if (!c) return {};
    return c.parentId ? { catParent: c.parentId, categoryId: c.id } : { catParent: c.id, categoryId: '' };
  };
  const values = existing
    ? { ...existing, ...splitCat(existing.categoryId) }
    : { date: defaultDate || today(), time: nowTime(), currency: settings.baseCurrency, rate: 1, status: 'cleared', recurrence: 'none' };

  const typeBar = h('div', { class: 'seg', style: { marginBottom: '14px', width: '100%' } });
  const suggestBox = h('div', { style: { marginBottom: '10px' }, hidden: true });

  let ctl;
  let firstBuild = true;
  const rebuild = () => {
    // Picking a category rebuilds the form so the sub-category chips can
    // appear; keep the scroll position so the view does not jump.
    const scroller = bodyWrap.closest('.modal-b');
    const keepScroll = scroller ? scroller.scrollTop : 0;
    ctl = form(build(), { ...(ctl ? ctl.read() : values), type }, {
      columns: 2,
      onInput: (m, key) => {
        if (key === 'notes' || key === 'merchant') maybeSuggest(m);
        if (key === 'currency') ctl.set('rate', m.currency === settings.baseCurrency ? 1 : (m.rate || 1));
        // Changing the parent must repopulate the sub-category list.
        if (key === 'catParent') { m.categoryId = ''; rebuild(); }
      },
    });
    bodyWrap.innerHTML = '';
    bodyWrap.append(typeBar, suggestBox, ctl.el);
    paintAmount();
    if (firstBuild) { ctl.focus('amount'); firstBuild = false; }
    else if (scroller) scroller.scrollTop = keepScroll;
  };

  function maybeSuggest(m) {
    if (type === 'transfer' || m.catParent) { suggestBox.hidden = true; return; }
    const text = `${m.notes || ''} ${m.merchant || ''}`;
    const sg = suggestCategory(text, type === 'income' ? 'income' : 'expense', Number(m.amount) || 0);
    if (!sg) { suggestBox.hidden = true; return; }
    suggestBox.hidden = false;
    suggestBox.innerHTML = '';
    suggestBox.append(h('div', { class: 'insight pos' },
      h('div', { class: 'ic', html: icon('sparkle', 15) }),
      h('div', { class: 'tt', style: { flex: 1 } },
        h('b', { text: `Suggested category: ${sg.label}` }),
        h('p', { text: `${sg.reason} · ${Math.round(sg.confidence * 100)}% confidence` })),
      h('button', { class: 'btn sm primary', onClick: () => {
        const cat = store.find('categories', sg.categoryId);
        ctl.set('catParent', cat?.parentId || sg.categoryId);
        ctl.set('categoryId', cat?.parentId ? sg.categoryId : '');
        suggestBox.hidden = true;
        rebuild();
      } }, 'Apply')));
  }

  const bodyWrap = h('div', {});
  // Budget is offered only when creating: turning a saved transaction into a
  // budget is not a conversion that means anything.
  const TYPES = [['expense', '💸 Expense'], ['income', '💰 Income'], ['transfer', '🔄 Transfer'],
    ...(isEdit ? [] : [['budget', '🎯 Budget']])];
  TYPES.forEach(([v, label]) => {
    typeBar.append(h('button', { class: type === v ? 'on' : '', text: label, style: { flex: 1 },
      onClick: e => { type = v; [...typeBar.children].forEach(c => c.classList.remove('on'));
        e.currentTarget.classList.add('on');
        m.dialog.querySelector('.modal-h h2').textContent = titleFor();
        rebuild(); } }));
  });
  const titleFor = () => (isEdit ? 'Edit transaction' : type === 'budget' ? 'New budget' : 'New transaction');

  /** Amount reads red for money out, green for money in — as in the type toggle. */
  const paintAmount = () => {
    const inp = bodyWrap.querySelector('.big-amount');
    if (!inp) return;
    inp.style.color = type === 'income' ? 'var(--pos)' : type === 'expense' ? 'var(--neg)'
      : type === 'budget' ? 'var(--accent)' : 'var(--text)';
  };

  const m = modal({
    title: titleFor(),
    subtitle: isEdit ? `Created ${fmtDate(existing.date)}` : 'Amount, category and account are the essentials — everything else is optional.',
    size: 'wide',
    body: bodyWrap,
    footer: frag(
      isEdit ? h('button', { class: 'btn danger', html: `${icon('trash', 15)} Delete`, onClick: async () => {
        if (await confirm({ title: 'Delete transaction?', message: 'This cannot be undone.', danger: true, confirmText: 'Delete' })) {
          await store.remove('transactions', existing.id);
          m.close(); toast('Transaction deleted', 'ok'); onSaved?.();
        }
      } }) : null,
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'),
      !isEdit ? h('button', { class: 'btn', onClick: () => saveIt(true) }, 'Save & add another') : null,
      h('button', { class: 'btn primary', onClick: () => saveIt(false) }, isEdit ? 'Save changes' : 'Save')),
  });
  rebuild();

  async function saveIt(again) {
    if (!ctl.validate()) return;
    const v = ctl.read();

    if (type === 'budget') {
      await store.save('budgets', {
        categoryId: v.catParent, amount: Number(v.amount) || 0, scope: v.scope || 'monthly',
        alertAt: Number(v.alertAt) || 80, rollover: !!v.rollover, notes: v.notes || '',
      });
      toast('Budget created', 'ok', { action: 'View', onAction: () => (location.hash = '#/budget') });
      onSaved?.();
      if (again) { ctl.set('amount', ''); ctl.set('catParent', ''); ctl.set('notes', ''); rebuild(); ctl.focus('amount'); }
      else m.close();
      return;
    }

    if (type === 'transfer' && v.accountId === v.toAccountId) { toast('Source and destination accounts must differ', 'warn'); return; }
    const rec = {
      ...(isEdit ? { id: existing.id, createdAt: existing.createdAt } : {}),
      type,
      amount: Number(v.amount) || 0,
      currency: v.currency || settings.baseCurrency,
      rate: v.currency === settings.baseCurrency ? 1 : (Number(v.rate) || 1),
      accountId: v.accountId,
      toAccountId: type === 'transfer' ? v.toAccountId : null,
      // the sub-category wins when one is chosen, otherwise the parent is stored
      categoryId: type === 'transfer' ? null : (v.categoryId || v.catParent || null),
      date: v.date, time: v.time, notes: v.notes, merchant: v.merchant, location: v.location,
      paymentMethod: v.paymentMethod, status: v.status || 'cleared',
      tags: v.tags || [], taxAmount: Number(v.taxAmount) || 0, priority: v.priority || 'normal',
      dueDate: v.dueDate || null, reminderAt: v.reminderAt || null,
      attachments: v.attachments || [],
    };
    const saved = await store.save('transactions', rec);
    if (rec.categoryId && (rec.notes || rec.merchant)) reinforce(`${rec.notes || ''} ${rec.merchant || ''}`, rec.categoryId);

    if (v.recurrence && v.recurrence !== 'none') {
      const next = nextOccurrence(v.date, v.recurrence);
      await store.save('recurring', {
        rule: v.recurrence, nextRun: next, active: true, lastRun: v.date, name: rec.notes || store.catName(rec.categoryId),
        template: { ...rec, id: undefined, attachments: [], recurringId: undefined },
      });
      toast(`Repeating ${v.recurrence} — next on ${fmtDate(next)}`, 'info');
    }
    toast(isEdit ? 'Transaction updated' : 'Transaction saved', 'ok');
    onSaved?.(saved);
    if (again) {
      ctl.set('amount', ''); ctl.set('notes', ''); ctl.set('merchant', '');
      ctl.set('attachments', []);
      ctl.focus('amount');
    } else m.close();
  }

  return m;
}

/* ═══════════ SPLIT TRANSACTION ═══════════ */
export function openSplitModal(onDone) {
  let lines = [{ id: uid('s'), categoryId: '', amount: '', notes: '' }];
  const listEl = h('div', { class: 'col' });
  const totalEl = h('div', { class: 'row between', style: { padding: '10px 2px', fontWeight: 700 } });

  const base = form([
    { key: 'accountId', label: 'Account', type: 'select', required: true, options: accountOptions() },
    { key: 'date', label: 'Date', type: 'date', required: true, value: today() },
    { key: 'merchant', label: 'Merchant', type: 'text', col: 'full', placeholder: 'e.g. Metro Cash & Carry' },
  ], {}, { columns: 2 });

  const draw = () => {
    listEl.innerHTML = '';
    lines.forEach((ln, i) => {
      const catSel = h('select', { class: 'inp', style: { flex: 2 } },
        h('option', { value: '' }, 'Category…'),
        ...categoryOptions('expense').map(([v, l]) => h('option', { value: v, selected: ln.categoryId === v }, l)));
      catSel.onchange = () => { ln.categoryId = catSel.value; };
      const amt = h('input', { class: 'inp num', style: { flex: 1 }, type: 'number', step: '0.01', value: ln.amount, placeholder: '0.00' });
      amt.oninput = () => { ln.amount = Number(amt.value) || 0; total(); };
      const note = h('input', { class: 'inp', style: { flex: 2 }, value: ln.notes, placeholder: 'Note' });
      note.oninput = () => { ln.notes = note.value; };
      listEl.append(h('div', { class: 'row', style: { gap: '7px' } }, catSel, amt, note,
        h('button', { class: 'icon-btn', html: icon('trash', 15), disabled: lines.length === 1,
          onClick: () => { lines.splice(i, 1); draw(); total(); } })));
    });
    total();
  };
  const total = () => {
    const t = money(lines.reduce((a, l) => a + (Number(l.amount) || 0), 0));
    totalEl.innerHTML = '';
    totalEl.append(h('span', { text: `${lines.length} line${lines.length > 1 ? 's' : ''}` }),
      h('span', { class: 'num', text: fmtMoney(t) }));
  };

  const m = modal({
    title: 'Split transaction', subtitle: 'One receipt, several categories — each line is stored as its own transaction.',
    size: 'wide',
    body: frag(base.el, h('div', { class: 'up mt' }, 'Split lines'), listEl, totalEl,
      h('button', { class: 'btn sm mt-sm', html: `${icon('plus', 14)} Add line`,
        onClick: () => { lines.push({ id: uid('s'), categoryId: '', amount: '', notes: '' }); draw(); } })),
    footer: frag(h('div', { class: 'spacer' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onClick: async () => {
        if (!base.validate()) return;
        const v = base.read();
        const valid = lines.filter(l => l.categoryId && Number(l.amount) > 0);
        if (!valid.length) { toast('Add at least one valid line', 'warn'); return; }
        for (const l of valid) {
          await store.save('transactions', {
            type: 'expense', amount: Number(l.amount), currency: settings.baseCurrency, rate: 1,
            accountId: v.accountId, categoryId: l.categoryId, date: v.date, time: nowTime(),
            notes: l.notes || v.merchant, merchant: v.merchant, status: 'cleared', tags: ['split'],
          }, { silent: true });
        }
        store.bus.emit('change', { store: 'transactions', action: 'bulk' });
        toast(`${valid.length} split lines saved`, 'ok');
        m.close(); onDone?.();
      } }, 'Save split')),
  });
  draw();
}

/* ═══════════ KPI ROW ═══════════ */
export const kpiGrid = (...tiles) => h('div', { class: 'grid auto stagger' }, ...tiles.filter(Boolean));

/* ═══════════ generic delete confirm ═══════════ */
export async function confirmDelete(label, extra) {
  return confirm({ title: `Delete ${label}?`, danger: true, confirmText: 'Delete',
    message: extra || 'This action cannot be undone.' });
}

/* ═══════════ section header with actions ═══════════ */
/**
 * The screen's primary action, remembered so the toolbar's Add button can offer
 * it instead of always assuming "transaction". The button element itself is
 * kept rather than a copy of its handler — clicking it from the menu runs the
 * exact same code, so the two can never drift apart.
 */
let pageAction = null;
export const currentPageAction = () => (pageAction?.isConnected ? pageAction : null);
export const clearPageAction = () => { pageAction = null; };

export function pageHead(title, subtitle, ...actions) {
  const list = actions.flat().filter(Boolean);
  // Must actually be an "add": Reports' primary is an Excel/CSV export, and
  // offering that under a + button would be a lie. Some screens wrap their
  // buttons in a div, so look inside as well as at the top level.
  // Note the `querySelector` fallback covers DocumentFragments too, which have
  // no `matches` — Categories passes one, and it was being skipped entirely.
  pageAction = null;
  for (const a of list) {
    const btn = a?.matches?.('button.btn.primary') ? a : a?.querySelector?.('button.btn.primary');
    if (btn && /^(new|add)\b/i.test((btn.textContent || '').trim())) { pageAction = btn; break; }
  }
  return h('div', { class: 'page-head' },
    h('div', { class: 'ttl' }, h('h2', { text: title }), subtitle ? h('p', { text: subtitle }) : null),
    h('div', { class: 'row wrap', style: { gap: '8px' } }, ...list));
}

/* ═══════════ status pills ═══════════ */
export const statusTag = s0 => {
  const map = { cleared: ['pos', 'Cleared'], pending: ['warn', 'Pending'], scheduled: ['info', 'Scheduled'],
    paid: ['pos', 'Paid'], unpaid: ['warn', 'Unpaid'], overdue: ['neg', 'Overdue'], active: ['pos', 'Active'],
    closed: ['', 'Closed'], paused: ['warn', 'Paused'], matured: ['info', 'Matured'], draft: ['', 'Draft'],
    open: ['info', 'Open'], settled: ['pos', 'Settled'], partial: ['warn', 'Partial'] };
  const [cls, label] = map[s0] || ['', s0 || '—'];
  return tag(label, cls);
};

export { store, state, settings, h, frag, icon, toast, modal, confirm, formModal, form, tag, stat, bar,
  avatar, menu, empty, card, fmtMoney, fmtDate, today, sortBy, money, period, PERIODS, esc, relDate,
  addMonths, monthKey, colorFor, initials, download, curSymbol };
