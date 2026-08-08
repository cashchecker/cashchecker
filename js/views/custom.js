/* ═══════════ views/custom.js — generated screen for any user-defined module ═══════════ */

import {
  h, frag, icon, card, stat, tag, empty, toast, confirm, modal, formModal, store, state, settings,
  fmtMoney, fmtDate, today, sortBy, pageHead, kpiGrid, confirmDelete, attachmentStrip, relDate,
} from './common.js';
import { dataTable, form, sheet } from '../ui.js';
import { donut, barChart, hBarChart } from '../charts.js';
import { money, colorFor, groupBy, esc, fmtNum, fmtPct, toCSV, download } from '../util.js';

export async function render(root, api) {
  const typeId = api.params?.[0];
  const type = store.find('entityTypes', typeId);
  if (!type) {
    root.append(empty('Module not found', 'It may have been deleted. Create a new one from Categories → Custom modules.', 'sparkle',
      h('button', { class: 'btn primary mt', onClick: () => api.navigate('categories') }, 'Go to Categories')));
    return;
  }
  const draw = () => { root.innerHTML = ''; root.append(build(type, draw, api)); };
  draw();
  return store.bus.on('change', ({ store: s }) => { if (['entityRecords', 'entityTypes'].includes(s)) draw(); });
}

function build(type, redraw, api) {
  const wrap = h('div', {});
  const fields = type.fields || [];
  const records = state.entityRecords.filter(r => r.typeId === type.id);
  api.setSubtitle(`${records.length} records · ${fields.length} fields`);
  document.title = `${type.name} · Cash Checker`;
  const titleEl = document.querySelector('#page-title');
  if (titleEl) titleEl.textContent = type.name;

  wrap.append(pageHead(type.name, type.description || 'A custom module generated from your own field definitions.',
    h('button', { class: 'btn', html: `${icon('edit', 16)} Edit fields`, onClick: () => api.navigate('categories') }),
    h('button', { class: 'btn primary', html: `${icon('plus', 16)} New record`, onClick: () => editRecord(type, null, redraw) })));

  /* summaries */
  const sumFields = fields.filter(f => f.summary === 'sum' && (f.type === 'money' || f.type === 'number'));
  const selectFields = fields.filter(f => f.type === 'select');
  const tiles = [
    stat({ label: 'Total records', value: String(records.length), icon: type.icon || 'sparkle', tone: 'info' }),
    ...sumFields.map(f => stat({
      label: `Total ${f.label.toLowerCase()}`, icon: 'wallet', tone: 'pos',
      value: f.type === 'money'
        ? fmtMoney(money(records.reduce((a, r) => a + (Number(r.data?.[f.key]) || 0), 0)))
        : fmtNum(records.reduce((a, r) => a + (Number(r.data?.[f.key]) || 0), 0)),
      foot: h('span', { class: 't3', text: records.length ? `average ${f.type === 'money'
        ? fmtMoney(money(records.reduce((a, r) => a + (Number(r.data?.[f.key]) || 0), 0) / records.length))
        : fmtNum(records.reduce((a, r) => a + (Number(r.data?.[f.key]) || 0), 0) / records.length, 1)}` : '—' }),
    })),
    ...selectFields.slice(0, 2).map(f => {
      const groups = [...groupBy(records, r => r.data?.[f.key] || '—')];
      const top = sortBy(groups, g => g[1].length, -1)[0];
      return stat({ label: f.label, value: top ? `${top[0]}` : '—', icon: 'tag', tone: 'warn',
        foot: h('span', { class: 't3', text: top ? `${top[1].length} of ${records.length} records` : '' }) });
    }),
  ];
  wrap.append(kpiGrid(...tiles));

  /* charts from select + money fields */
  const chartCards = [];
  selectFields.slice(0, 2).forEach(f => {
    const rows = sortBy([...groupBy(records, r => r.data?.[f.key] || 'Unset')]
      .map(([label, rs], i) => ({ label, value: rs.length, color: colorFor(label, i) })), r => r.value, -1);
    if (rows.length > 1) chartCards.push(card(`By ${f.label.toLowerCase()}`, donut(rows, { size: 200, centerLabel: 'Records', fmt: v => `${v}` })));
  });
  const moneyField = sumFields[0];
  if (moneyField && selectFields[0]) {
    const rows = sortBy([...groupBy(records, r => r.data?.[selectFields[0].key] || 'Unset')]
      .map(([label, rs], i) => ({ label, value: money(rs.reduce((a, r) => a + (Number(r.data?.[moneyField.key]) || 0), 0)), color: colorFor(label, i) })),
      r => r.value, -1);
    if (rows.length) chartCards.push(card(`${moneyField.label} by ${selectFields[0].label.toLowerCase()}`,
      hBarChart({ values: rows.map(r => r.value) }, rows.map(r => r.label), { colors: rows.map(r => r.color), width: 560 })));
  }
  if (chartCards.length) wrap.append(h('div', { class: 'grid mt', style: { gridTemplateColumns: `repeat(auto-fit,minmax(320px,1fr))` } }, ...chartCards));

  /* generated table */
  const cols = fields.slice(0, 7).map(f => ({
    key: f.key,
    label: f.label,
    align: f.type === 'money' || f.type === 'number' || f.type === 'percent' ? 'right' : undefined,
    value: r => r.data?.[f.key],
    render: r => renderValue(f, r.data?.[f.key]),
  }));
  cols.push({ key: '_updated', label: 'Updated', value: r => r.updatedAt,
    render: r => h('span', { class: 'tiny t3', text: r.updatedAt ? relDate(new Date(r.updatedAt).toISOString().slice(0, 10)) : '—' }) });

  wrap.append(h('div', { class: 'mt' }, dataTable(cols, {
    rows: records, exportName: type.name.toLowerCase().replace(/\s+/g, '-'), pageSize: 20,
    searchFields: fields.map(f => f.key),
    emptyTitle: `No ${type.name.toLowerCase()} yet`,
    emptyMsg: 'Add your first record — the form is generated from the fields you defined.',
    emptyIcon: type.icon || 'sparkle',
    onRowClick: r => viewRecord(type, r, redraw),
    actions: r => [
      { label: 'View', icon: 'eye', onClick: () => viewRecord(type, r, redraw) },
      { label: 'Edit', icon: 'edit', onClick: () => editRecord(type, r, redraw) },
      { label: 'Duplicate', icon: 'copy', onClick: async () => {
        await store.save('entityRecords', { typeId: type.id, data: { ...r.data } }); toast('Duplicated', 'ok'); redraw(); } },
      '-',
      { label: 'Delete', icon: 'trash', danger: true, onClick: async () => {
        if (await confirmDelete('this record')) { await store.remove('entityRecords', r.id); redraw(); } } },
    ],
    footRow: data => sumFields.length ? h('tr', {},
      ...fields.slice(0, 7).map(f => {
        const isSum = sumFields.some(s => s.key === f.key);
        return h('td', { class: isSum ? 'right num' : '' },
          isSum ? (f.type === 'money'
            ? fmtMoney(money(data.reduce((a, r) => a + (Number(r.data?.[f.key]) || 0), 0)))
            : fmtNum(data.reduce((a, r) => a + (Number(r.data?.[f.key]) || 0), 0)))
            : (f === fields[0] ? `${data.length} records` : ''));
      }), h('td')) : null,
  }).el));

  return wrap;
}

/* ---------- value rendering ---------- */
function renderValue(f, v) {
  if (v == null || v === '') return h('span', { class: 't3', text: '—' });
  switch (f.type) {
    case 'money': return h('span', { class: 'num', style: { fontWeight: 620 }, text: fmtMoney(Number(v) || 0) });
    case 'number': return h('span', { class: 'num', text: fmtNum(Number(v) || 0) });
    case 'percent': return h('span', { class: 'num', text: fmtPct(Number(v) || 0) });
    case 'date': return h('div', {}, h('div', { text: fmtDate(v) }), h('div', { class: 'tiny t3', text: relDate(v) }));
    case 'switch': return tag(v ? 'Yes' : 'No', v ? 'pos' : '');
    case 'select': return tag(String(v), 'acc');
    case 'tags': return h('span', { class: 'row', style: { gap: '4px', flexWrap: 'wrap' } },
      ...(Array.isArray(v) ? v : [v]).map(x => tag(String(x))));
    case 'attach': return Array.isArray(v) && v.length ? tag(`${v.length} file${v.length > 1 ? 's' : ''}`, 'info') : h('span', { class: 't3', text: '—' });
    case 'textarea': return h('span', { class: 'tiny t2 ell', style: { maxWidth: '220px', display: 'inline-block' }, text: String(v) });
    case 'email': return h('a', { href: `mailto:${v}`, class: 'accc tiny', text: String(v) });
    case 'tel': return h('a', { href: `tel:${v}`, class: 'tiny', text: String(v) });
    default: return h('span', { text: String(v) });
  }
}

/* ---------- generated form ---------- */
function editRecord(type, rec, redraw) {
  const fields = (type.fields || []).map(f => ({
    key: f.key, label: f.label, type: f.type, required: f.required,
    options: f.type === 'select' ? (f.options || []) : undefined,
    col: ['textarea', 'attach', 'tags'].includes(f.type) ? 'full' : 1,
    placeholder: f.placeholder,
  }));
  const { modal: m } = formModal({
    title: rec ? `Edit ${type.name.replace(/s$/, '')}` : `New ${type.name.replace(/s$/, '')}`,
    subtitle: type.description, size: 'wide', columns: 2,
    values: rec?.data || {},
    fields,
    extraFooter: rec ? h('button', { class: 'btn danger', html: `${icon('trash', 15)} Delete`, onClick: async () => {
      if (await confirmDelete('this record')) { await store.remove('entityRecords', rec.id); m.close(); redraw(); } } }) : null,
    onSubmit: async v => {
      await store.save('entityRecords', { ...(rec || {}), typeId: type.id, data: v });
      m.close(); toast(rec ? 'Record updated' : 'Record added', 'ok'); redraw();
    },
  });
}

/* ---------- detail ---------- */
function viewRecord(type, rec, redraw) {
  const fields = type.fields || [];
  const title = rec.data?.[fields[0]?.key] || type.name;
  const body = h('div', {});

  body.append(h('div', { class: 'card pad', style: { marginBottom: '13px' } },
    h('div', { class: 'row', style: { gap: '11px' } },
      h('div', { class: 'avatar', style: { background: (type.color || '#7c5cff') + '22', color: type.color || '#7c5cff' },
        html: icon(type.icon || 'sparkle', 18) }),
      h('div', {}, h('h2', { text: String(title) }),
        h('div', { class: 'tiny t3', text: `${type.name} · updated ${rec.updatedAt ? new Date(rec.updatedAt).toLocaleString() : '—'}` })))));

  const dl = h('dl', { class: 'kv card pad' });
  fields.forEach(f => {
    const v = rec.data?.[f.key];
    if (f.type === 'attach') return;
    dl.append(h('dt', { text: f.label }), h('dd', {}, renderValue(f, v)));
  });
  body.append(dl);

  fields.filter(f => f.type === 'attach').forEach(f => {
    const files = rec.data?.[f.key] || [];
    body.append(h('div', { class: 'card pad mt' }, h('div', { class: 'up mb', text: f.label }), attachmentStrip(files)));
  });

  const s0 = sheet({
    title: type.name, body,
    footer: frag(
      h('button', { class: 'btn sm danger', text: 'Delete', onClick: async () => {
        if (await confirmDelete('this record')) { await store.remove('entityRecords', rec.id); s0.close(); redraw(); } } }),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn sm primary', text: 'Edit', onClick: () => { s0.close(); editRecord(type, rec, redraw); } })),
  });
}
