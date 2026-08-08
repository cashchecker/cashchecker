/* ═══════════ views/credit.js — Credit Book (khata) ═══════════ */

import {
  h, frag, icon, card, stat, tag, empty, toast, confirm, modal, formModal, store, state, settings,
  fmtMoney, fmtDate, today, sortBy, pageHead, kpiGrid, avatar, statusTag, confirmDelete, contactOptions,
  attachmentStrip, relDate,
} from './common.js';
import { dataTable, form, sheet } from '../ui.js';
import { donut, barChart } from '../charts.js';
import { creditTotals, creditOutstanding, creditPaid, contactBalance, contactLedger } from '../store.js';
import { money, addDays, daysBetween, accruedInterest, toCSV, download, esc, initials, colorFor } from '../util.js';

export async function render(root, api) {
  const draw = () => {
    root.innerHTML = '';
    const focusId = api.params?.[0];
    root.append(build(draw, api));
    if (focusId) { const c = store.find('contacts', focusId); if (c) setTimeout(() => openLedger(c, draw), 120); }
  };
  draw();
  return store.bus.on('change', ({ store: s }) => { if (['credits', 'creditPayments', 'contacts'].includes(s)) draw(); });
}

function build(redraw, api) {
  const wrap = h('div', {});
  const T = creditTotals();
  api.setSubtitle(`${state.contacts.length} contacts · ${state.credits.filter(c => creditOutstanding(c) > 0.004).length} open entries`);

  wrap.append(pageHead('Credit Book', 'Track money given and taken, partial payments, interest and reminders — one ledger per person.',
    h('button', { class: 'btn', html: `${icon('user', 16)} New contact`, onClick: () => editContact(null, redraw) }),
    h('button', { class: 'btn neg', html: `${icon('export', 16)} Money given`, onClick: () => editCredit(null, redraw, 'given') }),
    h('button', { class: 'btn pos', html: `${icon('import', 16)} Money taken`, onClick: () => editCredit(null, redraw, 'taken') })));

  wrap.append(kpiGrid(
    stat({ label: 'You will receive', value: fmtMoney(T.receivable), icon: 'import', tone: 'pos',
      foot: h('span', { class: 't3', text: `${state.credits.filter(c => c.direction === 'given' && creditOutstanding(c) > 0.004).length} open entries` }) }),
    stat({ label: 'You will pay', value: fmtMoney(T.payable), icon: 'export', tone: 'neg',
      foot: h('span', { class: 't3', text: `${state.credits.filter(c => c.direction === 'taken' && creditOutstanding(c) > 0.004).length} open entries` }) }),
    stat({ label: 'Net position', value: fmtMoney(T.net), icon: 'book', tone: T.net >= 0 ? 'pos' : 'neg',
      foot: h('span', { class: 't3', text: T.net >= 0 ? 'In your favour' : 'You owe more than you are owed' }) }),
    stat({ label: 'Overdue', value: fmtMoney(T.overdue), icon: 'alert', tone: T.overdueCount ? 'warn' : '',
      foot: h('span', { class: T.overdueCount ? 'warnc' : 't3', text: `${T.overdueCount} past due date` }) })));

  /* contacts table */
  const contacts = state.contacts.map(c => {
    const credits = state.credits.filter(x => x.contactId === c.id);
    const bal = contactBalance(c.id);
    const overdue = credits.filter(x => x.dueDate && x.dueDate < today() && creditOutstanding(x) > 0.004);
    const last = sortBy(credits, x => x.date, -1)[0];
    return { ...c, balance: bal, entries: credits.length, overdue: overdue.length,
      lastDate: last?.date || null,
      totalGiven: money(credits.filter(x => x.direction === 'given').reduce((a, x) => a + x.amount, 0)),
      totalTaken: money(credits.filter(x => x.direction === 'taken').reduce((a, x) => a + x.amount, 0)) };
  });

  wrap.append(h('div', { class: 'mt' }, dataTable([
    { key: 'name', label: 'Contact', render: r => h('div', { class: 'row', style: { gap: '10px' } },
      avatar(r.name), h('div', { style: { minWidth: 0 } },
        h('div', { style: { fontWeight: 620 }, text: r.name }),
        h('div', { class: 'tiny t3 ell', text: r.phone || r.address || 'No contact details' }))) },
    { key: 'entries', label: 'Entries', align: 'center' },
    { key: 'totalGiven', label: 'Given', align: 'right', render: r => h('span', { class: 'num t2', text: fmtMoney(r.totalGiven) }) },
    { key: 'totalTaken', label: 'Taken', align: 'right', render: r => h('span', { class: 'num t2', text: fmtMoney(r.totalTaken) }) },
    { key: 'lastDate', label: 'Last activity', render: r => r.lastDate ? h('span', { class: 'tiny', text: relDate(r.lastDate) }) : '—' },
    { key: 'balance', label: 'Balance', align: 'right', render: r => h('div', {},
      h('div', { class: `num ${r.balance > 0 ? 'pos' : r.balance < 0 ? 'neg' : 't3'}`, style: { fontWeight: 700 },
        text: fmtMoney(Math.abs(r.balance)) }),
      h('div', { class: 'tiny t3', text: r.balance > 0 ? 'will receive' : r.balance < 0 ? 'will pay' : 'settled' }),
      r.overdue ? tag(`${r.overdue} overdue`, 'neg') : null) },
  ], {
    rows: sortBy(contacts, c => Math.abs(c.balance), -1),
    exportName: 'credit-book', pageSize: 15,
    searchFields: ['name', 'phone', 'address'],
    emptyTitle: 'No contacts yet',
    emptyMsg: 'Add a customer, supplier or friend, then record what was given or taken.',
    emptyIcon: 'book',
    onRowClick: r => openLedger(r, redraw),
    actions: r => [
      { label: 'Open ledger', icon: 'book', onClick: () => openLedger(r, redraw) },
      { label: 'Give money', icon: 'export', onClick: () => editCredit(null, redraw, 'given', r.id) },
      { label: 'Take money', icon: 'import', onClick: () => editCredit(null, redraw, 'taken', r.id) },
      { label: 'Send reminder', icon: 'phone', onClick: () => remind(r) },
      { label: 'Edit contact', icon: 'edit', onClick: () => editContact(r, redraw) },
      '-',
      { label: 'Delete contact', icon: 'trash', danger: true, onClick: async () => {
        if (await confirm({ title: `Delete ${r.name}?`, danger: true, confirmText: 'Delete',
          message: `This also deletes ${r.entries} credit entries and their payment history.` })) {
          await store.remove('contacts', r.id); toast('Contact deleted', 'ok'); redraw();
        } } },
    ],
    footRow: data => h('tr', {}, h('td', { colspan: 6, class: 'right' },
      h('span', { class: 't3', text: 'Net across listed contacts: ' }),
      h('span', { class: 'num', text: fmtMoney(money(data.reduce((a, r) => a + r.balance, 0))) }))),
  }).el));

  /* open entries */
  const open = state.credits.filter(c => creditOutstanding(c) > 0.004);
  if (open.length) {
    wrap.append(h('div', { class: 'grid mt', style: { gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)' } },
      card('Open entries by due date', dataTable([
        { key: 'contactId', label: 'Contact', value: r => store.contactName(r.contactId),
          render: r => h('span', { style: { fontWeight: 600 }, text: store.contactName(r.contactId) }) },
        { key: 'direction', label: 'Type', render: r => tag(r.direction === 'given' ? 'Receivable' : 'Payable', r.direction === 'given' ? 'pos' : 'neg') },
        { key: 'amount', label: 'Principal', align: 'right', render: r => h('span', { class: 'num t2', text: fmtMoney(r.amount) }) },
        { key: 'out', label: 'Outstanding', align: 'right', value: r => creditOutstanding(r),
          render: r => h('span', { class: 'num', style: { fontWeight: 700 }, text: fmtMoney(creditOutstanding(r)) }) },
        { key: 'dueDate', label: 'Due', render: r => r.dueDate
          ? h('span', { class: r.dueDate < today() ? 'neg' : '', text: relDate(r.dueDate) }) : h('span', { class: 't3', text: 'No date' }) },
      ], { rows: sortBy(open, c => c.dueDate || '9999'), pageSize: 8, searchable: false, exportName: 'open-credits',
        onRowClick: r => openLedger(store.find('contacts', r.contactId), redraw) }).el, null, { flush: true }),
      card('Receivables by contact', (() => {
        const rows = sortBy(state.contacts.map(c => ({ label: c.name, value: Math.max(0, contactBalance(c.id)), color: colorFor(c.name) }))
          .filter(r => r.value > 0), r => r.value, -1);
        return rows.length ? donut(rows, { size: 200, centerLabel: 'Receivable' }) : empty('Nothing outstanding', '', 'check');
      })())));
  }

  return wrap;
}

/* ---------- contact editor ---------- */
function editContact(c, redraw) {
  const { modal: m } = formModal({
    title: c ? `Edit ${c.name}` : 'New contact', size: '', columns: 2,
    values: c || {},
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, col: 'full', placeholder: 'Customer, supplier or person' },
      { key: 'phone', label: 'Mobile number', type: 'tel', placeholder: '+92 300 0000000' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'address', label: 'Address', type: 'text', col: 'full' },
      { key: 'company', label: 'Business / company', type: 'text' },
      { key: 'creditLimit', label: 'Credit limit', type: 'money', hint: 'Optional — warns when exceeded' },
      { key: 'notes', label: 'Notes', type: 'textarea', col: 'full' },
    ],
    onSubmit: async v => {
      await store.save('contacts', { ...(c || {}), ...v });
      m.close(); toast(c ? 'Contact updated' : 'Contact added', 'ok'); redraw();
    },
  });
}

/* ---------- credit entry editor ---------- */
function editCredit(existing, redraw, direction = 'given', contactId = '') {
  const dir = existing?.direction || direction;
  const { modal: m } = formModal({
    title: existing ? 'Edit entry' : dir === 'given' ? 'Money given' : 'Money taken',
    subtitle: dir === 'given' ? 'You gave money — this becomes a receivable.' : 'You received money — this becomes a payable.',
    size: 'wide', columns: 2,
    values: existing || { contactId, date: today(), direction: dir, interestType: 'simple' },
    fields: [
      { key: 'contactId', label: 'Contact', type: 'select', required: true, options: contactOptions(), placeholder: 'Choose contact…' },
      { key: 'amount', label: 'Amount', type: 'money', required: true },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'dueDate', label: 'Due date', type: 'date', hint: 'Drives reminders and overdue alerts' },
      { key: 'interestRate', label: 'Interest rate (annual)', type: 'percent', hint: 'Leave blank for interest-free' },
      { key: 'interestType', label: 'Interest method', type: 'select', options: [['simple', 'Simple'], ['compound', 'Compound']],
        when: mm => Number(mm.interestRate) > 0 },
      { key: 'reference', label: 'Reference / invoice no.', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea', col: 'full' },
      { key: 'attachments', label: 'Documents', type: 'attach', col: 'full' },
    ],
    onSubmit: async v => {
      await store.save('credits', { ...(existing || {}), ...v, direction: dir, status: 'open' });
      m.close(); toast('Entry saved', 'ok'); redraw();
    },
  });
}

/* ---------- payment ---------- */
function addPayment(credit, redraw) {
  const out = creditOutstanding(credit);
  const { modal: m } = formModal({
    title: credit.direction === 'given' ? 'Record money received' : 'Record money paid',
    subtitle: `${store.contactName(credit.contactId)} · outstanding ${fmtMoney(out)}`,
    size: '', columns: 2,
    values: { date: today(), amount: out },
    fields: [
      { key: 'amount', label: 'Amount', type: 'money', required: true, big: true, col: 'full',
        validate: v => (Number(v) <= 0 ? 'Enter an amount greater than zero' : '') },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'method', label: 'Payment method', type: 'select', options: store.PAYMENT_METHODS },
      { key: 'notes', label: 'Note', type: 'text', col: 'full' },
      { key: 'attachments', label: 'Receipt', type: 'attach', col: 'full' },
    ],
    onSubmit: async v => {
      await store.save('creditPayments', { ...v, creditId: credit.id });
      const remaining = creditOutstanding(credit);
      if (remaining <= 0.004) await store.save('credits', { ...credit, status: 'settled' }, { auditIt: false });
      m.close();
      toast(remaining <= 0.004 ? 'Settled in full 🎉' : `Payment recorded · ${fmtMoney(remaining)} still outstanding`, 'ok');
      redraw();
    },
  });
}

/* ---------- ledger sheet ---------- */
function openLedger(contact, redraw) {
  if (!contact) return;
  const credits = state.credits.filter(c => c.contactId === contact.id);
  const ledger = contactLedger(contact.id);
  const bal = contactBalance(contact.id);
  const body = h('div', {});

  body.append(h('div', { class: 'card pad', style: { textAlign: 'center', marginBottom: '14px' } },
    h('div', { style: { display: 'grid', placeItems: 'center', marginBottom: '8px' } }, avatar(contact.name)),
    h('h2', { text: contact.name }),
    contact.phone ? h('div', { class: 'tiny t2', text: contact.phone }) : null,
    contact.address ? h('div', { class: 'tiny t3', text: contact.address }) : null,
    h('div', { class: 'up mt', text: bal >= 0 ? 'You will receive' : 'You will pay' }),
    h('div', { class: `num ${bal > 0 ? 'pos' : bal < 0 ? 'neg' : ''}`, style: { fontSize: '1.7rem', fontWeight: 750 },
      text: fmtMoney(Math.abs(bal)) }),
    h('div', { class: 'row', style: { gap: '7px', justifyContent: 'center', marginTop: '12px', flexWrap: 'wrap' } },
      h('button', { class: 'btn sm neg', text: 'Give money', onClick: () => { s0.close(); editCredit(null, redraw, 'given', contact.id); } }),
      h('button', { class: 'btn sm pos', text: 'Take money', onClick: () => { s0.close(); editCredit(null, redraw, 'taken', contact.id); } }),
      h('button', { class: 'btn sm', html: `${icon('phone', 14)} Remind`, onClick: () => remind(contact) }))));

  /* open entries */
  body.append(h('div', { class: 'up', style: { marginBottom: '7px' }, text: 'Entries' }));
  if (!credits.length) body.append(empty('No entries yet', 'Record money given or taken to build this ledger.', 'book'));
  credits.forEach(c => {
    const out = creditOutstanding(c);
    const paid = creditPaid(c.id);
    const interest = c.interestRate ? accruedInterest(c.amount, c.interestRate, c.date, today(), c.interestType) : 0;
    const late = c.dueDate && c.dueDate < today() && out > 0.004;
    body.append(h('div', { class: 'card pad', style: { marginBottom: '9px', borderLeft: `3px solid ${c.direction === 'given' ? 'var(--pos)' : 'var(--neg)'}` } },
      h('div', { class: 'row between' },
        h('div', {}, h('b', { text: c.direction === 'given' ? 'Money given' : 'Money taken' }),
          h('div', { class: 'tiny t3', text: `${fmtDate(c.date)}${c.reference ? ` · ${c.reference}` : ''}` })),
        h('div', { style: { textAlign: 'right' } },
          h('div', { class: 'num', style: { fontWeight: 700 }, text: fmtMoney(c.amount) }),
          out > 0.004 ? h('div', { class: 'tiny warnc', text: `${fmtMoney(out)} outstanding` }) : tag('Settled', 'pos'))),
      interest ? h('div', { class: 'tiny t2 mt-sm', text: `Interest accrued at ${c.interestRate}% (${c.interestType || 'simple'}): ${fmtMoney(interest)}` }) : null,
      paid ? h('div', { class: 'tiny t2', text: `Paid so far: ${fmtMoney(paid)}` }) : null,
      c.notes ? h('div', { class: 'tiny t3 mt-sm', text: c.notes }) : null,
      late ? h('div', { class: 'mt-sm' }, tag(`Overdue since ${fmtDate(c.dueDate)}`, 'neg')) :
        c.dueDate ? h('div', { class: 'tiny t3 mt-sm', text: `Due ${relDate(c.dueDate)}` }) : null,
      c.attachments?.length ? h('div', { class: 'mt-sm' }, attachmentStrip(c.attachments)) : null,
      h('div', { class: 'row mt-sm', style: { gap: '6px' } },
        out > 0.004 ? h('button', { class: 'btn xs primary', text: c.direction === 'given' ? 'Receive payment' : 'Make payment',
          onClick: () => { s0.close(); addPayment(c, redraw); } }) : null,
        h('button', { class: 'btn xs', text: 'Edit', onClick: () => { s0.close(); editCredit(c, redraw); } }),
        h('button', { class: 'btn xs danger', text: 'Delete', onClick: async () => {
          if (await confirmDelete('this entry', 'Payment history for this entry is removed too.')) {
            await store.remove('credits', c.id); s0.close(); redraw();
          } } }))));
  });

  /* statement */
  if (ledger.length) {
    body.append(h('div', { class: 'up mt', style: { marginBottom: '7px' }, text: 'Statement' }));
    const tbl = h('div', { class: 'card', style: { overflow: 'hidden' } });
    ledger.forEach(r => {
      const isDebit = r.kind === 'given' || r.kind === 'paid';
      tbl.append(h('div', { class: 'ledger-row' },
        h('div', {}, h('div', { style: { fontWeight: 560, fontSize: '.84rem' }, text: labelFor(r.kind) }),
          h('div', { class: 'tiny t3', text: `${fmtDate(r.date)}${r.note ? ` · ${r.note}` : ''}` })),
        h('span', { class: `num ${isDebit ? 'neg' : 'pos'}`, text: `${isDebit ? '−' : '+'}${fmtMoney(r.amount)}` }),
        h('span', { class: 'num t3 tiny', text: fmtMoney(r.running) })));
    });
    body.append(tbl);
    body.append(h('div', { class: 'row mt-sm', style: { gap: '7px' } },
      h('button', { class: 'btn sm', html: `${icon('export', 14)} CSV`, onClick: () => {
        download(toCSV(ledger.map(r => ({ Date: r.date, Type: labelFor(r.kind), Note: r.note, Amount: r.amount, Balance: r.running }))),
          `${contact.name}-statement-${today()}.csv`, 'text/csv');
        toast('Statement exported', 'ok');
      } }),
      h('button', { class: 'btn sm', html: `${icon('print', 14)} Print / PDF`, onClick: () => printStatement(contact, ledger, bal) })));
  }

  const s0 = sheet({ title: 'Customer ledger', body });
}
const labelFor = k => ({ given: 'Money given', taken: 'Money taken', received: 'Payment received', paid: 'Payment made' }[k] || k);

/* ---------- reminder ---------- */
function remind(contact) {
  const bal = contactBalance(contact.id);
  const open = state.credits.filter(c => c.contactId === contact.id && creditOutstanding(c) > 0.004);
  const lines = open.map(c => `• ${fmtMoney(creditOutstanding(c))} from ${fmtDate(c.date)}${c.dueDate ? ` (due ${fmtDate(c.dueDate)})` : ''}`).join('\n');
  const text = `Hello ${contact.name},\n\nThis is a friendly reminder about the outstanding balance of ${fmtMoney(Math.abs(bal))}:\n${lines}\n\nPlease let me know if you need any details.\n\nThank you.`;
  const ta = h('textarea', { class: 'inp', rows: 9, value: text });
  const phone = (contact.phone || '').replace(/[^\d+]/g, '');
  const m = modal({
    title: 'Send a payment reminder', subtitle: 'Cash Checker prepares the message — you choose how to send it.',
    size: '',
    body: frag(
      h('div', { class: 'insight mb' }, h('div', { class: 'ic', html: icon('alert', 15) }),
        h('div', { class: 'tt' }, h('b', { text: 'Nothing is sent automatically' }),
          h('p', { text: 'This app has no server, so it cannot send SMS or WhatsApp on your behalf. The buttons below hand the message to your own apps.' }))),
      h('div', { class: 'field' }, h('label', { text: 'Message' }), ta)),
    footer: frag(
      h('button', { class: 'btn sm', html: `${icon('copy', 14)} Copy`, onClick: async () => {
        await navigator.clipboard.writeText(ta.value); toast('Message copied', 'ok'); } }),
      h('div', { class: 'spacer' }),
      phone ? h('a', { class: 'btn sm pos', target: '_blank', rel: 'noopener',
        href: `https://wa.me/${phone.replace(/^\+/, '')}?text=${encodeURIComponent(ta.value)}` }, 'WhatsApp') : null,
      phone ? h('a', { class: 'btn sm', href: `sms:${phone}?body=${encodeURIComponent(ta.value)}` }, 'SMS') : null,
      contact.email ? h('a', { class: 'btn sm', href: `mailto:${contact.email}?subject=${encodeURIComponent('Payment reminder')}&body=${encodeURIComponent(ta.value)}` }, 'Email') : null,
      h('button', { class: 'btn sm primary', onClick: () => m.close() }, 'Done')),
  });
}

/* ---------- print ---------- */
function printStatement(contact, ledger, bal) {
  const w = window.open('', '_blank');
  if (!w) { toast('Allow pop-ups to print', 'warn'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Statement — ${esc(contact.name)}</title>
  <style>body{font:13px system-ui;padding:36px;color:#111}h1{font-size:20px;margin:0 0 3px}
  .sub{color:#666;margin-bottom:18px}table{width:100%;border-collapse:collapse;margin-top:14px}
  th{text-align:left;font-size:11px;text-transform:uppercase;color:#666;border-bottom:2px solid #ddd;padding:7px 6px}
  td{padding:7px 6px;border-bottom:1px solid #eee}.r{text-align:right}
  .tot{margin-top:20px;padding:14px;background:#f5f5f7;border-radius:8px;display:flex;justify-content:space-between;font-weight:700}
  </style></head><body>
  <h1>Account statement</h1>
  <div class="sub">${esc(contact.name)}${contact.phone ? ` · ${esc(contact.phone)}` : ''}${contact.address ? `<br>${esc(contact.address)}` : ''}
  <br>Generated ${new Date().toLocaleString()}</div>
  <table><thead><tr><th>Date</th><th>Particulars</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead><tbody>
  ${ledger.map(r => { const d = r.kind === 'given' || r.kind === 'paid';
    return `<tr><td>${r.date}</td><td>${esc(labelFor(r.kind))}${r.note ? ` — ${esc(r.note)}` : ''}</td>
    <td class="r">${d ? fmtMoney(r.amount) : ''}</td><td class="r">${d ? '' : fmtMoney(r.amount)}</td>
    <td class="r">${fmtMoney(r.running)}</td></tr>`; }).join('')}
  </tbody></table>
  <div class="tot"><span>${bal >= 0 ? 'Amount receivable' : 'Amount payable'}</span><span>${fmtMoney(Math.abs(bal))}</span></div>
  <p style="margin-top:26px;color:#999;font-size:11px">Generated by Cash Checker</p>
  </body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 300);
}
