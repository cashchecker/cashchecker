/* ═══════════ views/marketing.js — Digital Marketing Budget Manager ═══════════ */

import {
  h, frag, icon, card, stat, tag, empty, toast, confirm, modal, formModal, store, state, settings,
  fmtMoney, fmtDate, today, sortBy, pageHead, kpiGrid, confirmDelete, statusTag, relDate,
} from './common.js';
import { dataTable, sheet, bar } from '../ui.js';
import { donut, barChart, lineChart, hBarChart } from '../charts.js';
import { campaignMetrics, marketingTotals } from '../store.js';
import { money, fmtNum, fmtPct, colorFor, addDays, daysBetween, dayRange, uid } from '../util.js';

export async function render(root, api) {
  let tab = 'campaigns';
  const draw = () => { root.innerHTML = ''; root.append(build(tab, t => { tab = t; draw(); }, draw, api)); };
  draw();
  return store.bus.on('change', ({ store: s }) => { if (['campaigns', 'campaignDays'].includes(s)) draw(); });
}

function build(tab, setTab, redraw, api) {
  const wrap = h('div', {});
  const T = marketingTotals();
  api.setSubtitle(`${state.campaigns.length} campaigns · ${T.active} active`);

  wrap.append(pageHead('Digital Marketing Budget', 'Spend, CPC, CPA, ROAS and profitability per channel — with daily performance logging.',
    h('button', { class: 'btn', html: `${icon('plus', 16)} Log daily stats`, onClick: () => logDay(null, redraw) }),
    h('button', { class: 'btn primary', html: `${icon('plus', 16)} New campaign`, onClick: () => editCampaign(null, redraw) })));

  wrap.append(kpiGrid(
    stat({ label: 'Total ad spend', value: fmtMoney(T.spend), icon: 'mega', tone: 'neg',
      foot: h('span', { class: 't3', text: `${fmtMoney(T.budget)} budgeted` }) }),
    stat({ label: 'Revenue generated', value: fmtMoney(T.revenue), icon: 'trend', tone: 'pos',
      foot: h('span', { class: 't3', text: `${T.budget ? ((T.spend / T.budget) * 100).toFixed(0) : 0}% of budget used` }) }),
    stat({ label: 'Net profit', value: fmtMoney(T.profit), icon: 'wallet', tone: T.profit >= 0 ? 'pos' : 'neg',
      foot: h('span', { class: T.profit >= 0 ? 'pos' : 'neg', text: `${fmtPct(T.roi)} ROI` }) }),
    stat({ label: 'Blended ROAS', value: `${T.roas.toFixed(2)}×`, icon: 'chart',
      tone: T.roas >= 2 ? 'pos' : T.roas >= 1 ? 'warn' : 'neg',
      foot: h('span', { class: 't3', text: T.roas >= 1 ? 'Profitable overall' : 'Losing money overall' }) }),
    stat({ label: 'Active campaigns', value: String(T.active), icon: 'flame', tone: 'info',
      foot: h('span', { class: 't3', text: `${state.campaigns.filter(c => c.status === 'paused').length} paused` }) })));

  const tabsEl = h('div', { class: 'tabs mt' });
  [['campaigns', 'Campaigns'], ['channels', 'Channel performance'], ['daily', 'Daily log'], ['funnel', 'Funnel & efficiency']]
    .forEach(([v, l]) => tabsEl.append(h('button', { class: v === tab ? 'on' : '', text: l, onClick: () => setTab(v) })));
  wrap.append(tabsEl);
  const body = h('div', { class: 'mt' });
  wrap.append(body);

  if (tab === 'channels') { body.append(channelPanel(T)); return wrap; }
  if (tab === 'daily') { body.append(dailyPanel(redraw)); return wrap; }
  if (tab === 'funnel') { body.append(funnelPanel(T)); return wrap; }

  /* spend vs revenue chart */
  const rows = T.all;
  body.append(card('Spend vs revenue by campaign', rows.length ? barChart([
    { name: 'Spend', color: 'var(--neg)', values: rows.map(r => r.m.spend) },
    { name: 'Revenue', color: 'var(--pos)', values: rows.map(r => r.m.revenue) },
  ], rows.map(r => r.c.name), { height: 250 }) : empty('No campaigns yet', 'Create one to start tracking performance.', 'mega')));

  body.append(h('div', { class: 'mt' }, dataTable([
    { key: 'name', label: 'Campaign', value: r => r.c.name, render: r => h('div', {},
      h('div', { style: { fontWeight: 620 }, text: r.c.name }),
      h('div', { class: 'row', style: { gap: '5px', marginTop: '3px' } },
        tag(r.c.channel, 'acc'), statusTag(r.c.status))) },
    { key: 'budget', label: 'Budget', align: 'right', value: r => r.m.budget,
      render: r => h('div', { style: { minWidth: '110px' } },
        h('div', { class: 'num tiny t2', text: `${fmtMoney(r.m.spend)} / ${fmtMoney(r.m.budget)}` }),
        bar(r.m.utilisation, r.m.utilisation > 100 ? 'neg' : r.m.utilisation > 85 ? 'warn' : '')) },
    { key: 'revenue', label: 'Revenue', align: 'right', value: r => r.m.revenue,
      render: r => h('span', { class: 'num pos', text: fmtMoney(r.m.revenue) }) },
    { key: 'roas', label: 'ROAS', align: 'right', value: r => r.m.roas,
      render: r => h('span', { class: `num ${r.m.roas >= 2 ? 'pos' : r.m.roas >= 1 ? 'warnc' : 'neg'}`, style: { fontWeight: 700 },
        text: `${r.m.roas.toFixed(2)}×` }) },
    { key: 'cpc', label: 'CPC', align: 'right', value: r => r.m.cpc, render: r => h('span', { class: 'num tiny', text: fmtMoney(r.m.cpc) }) },
    { key: 'ctr', label: 'CTR', align: 'right', value: r => r.m.ctr, render: r => h('span', { class: 'num tiny', text: fmtPct(r.m.ctr, 2) }) },
    { key: 'cpa', label: 'CPA', align: 'right', value: r => r.m.cpa, render: r => h('span', { class: 'num tiny', text: r.m.cpa ? fmtMoney(r.m.cpa) : '—' }) },
    { key: 'profit', label: 'Profit', align: 'right', value: r => r.m.profit,
      render: r => h('span', { class: `num ${r.m.profit >= 0 ? 'pos' : 'neg'}`, style: { fontWeight: 650 },
        text: `${r.m.profit >= 0 ? '+' : ''}${fmtMoney(r.m.profit)}` }) },
    { key: 'dates', label: 'Period', value: r => r.c.startDate,
      render: r => h('div', { class: 'tiny t3' }, `${fmtDate(r.c.startDate, 'short')} → ${fmtDate(r.c.endDate, 'short')}`) },
  ], {
    rows, exportName: 'campaigns', pageSize: 15,
    searchFields: ['name', 'channel'],
    emptyTitle: 'No campaigns', emptyMsg: 'Add Meta, Google, TikTok, influencer or SEO campaigns.', emptyIcon: 'mega',
    onRowClick: r => openCampaign(r.c, redraw),
    actions: r => [
      { label: 'View performance', icon: 'eye', onClick: () => openCampaign(r.c, redraw) },
      { label: 'Log daily stats', icon: 'plus', onClick: () => logDay(r.c, redraw) },
      { label: 'Edit', icon: 'edit', onClick: () => editCampaign(r.c, redraw) },
      { label: r.c.status === 'active' ? 'Pause' : 'Activate', icon: 'repeat', onClick: async () => {
        await store.save('campaigns', { ...r.c, status: r.c.status === 'active' ? 'paused' : 'active' }); redraw(); } },
      '-',
      { label: 'Delete', icon: 'trash', danger: true, onClick: async () => {
        if (await confirmDelete(r.c.name, 'Daily performance rows are deleted too.')) { await store.remove('campaigns', r.c.id); redraw(); } } },
    ],
    footRow: data => h('tr', {},
      h('td', { class: 't3', text: `${data.length} campaigns` }),
      h('td', { class: 'right num', text: fmtMoney(money(data.reduce((a, r) => a + r.m.spend, 0))) }),
      h('td', { class: 'right num', text: fmtMoney(money(data.reduce((a, r) => a + r.m.revenue, 0))) }),
      h('td', { colspan: 4 }),
      h('td', { class: 'right num', text: fmtMoney(money(data.reduce((a, r) => a + r.m.profit, 0))) }),
      h('td')),
  }).el));

  return wrap;
}

/* ---------- channels ---------- */
function channelPanel(T) {
  const byChannel = new Map();
  T.all.forEach(({ c, m }) => {
    const g = byChannel.get(c.channel) || { spend: 0, revenue: 0, clicks: 0, impressions: 0, sales: 0, leads: 0, count: 0 };
    g.spend += m.spend; g.revenue += m.revenue; g.clicks += m.clicks; g.impressions += m.impressions;
    g.sales += m.sales; g.leads += m.leads; g.count++;
    byChannel.set(c.channel, g);
  });
  const rows = sortBy([...byChannel].map(([channel, g]) => ({
    id: channel, channel, ...g, spend: money(g.spend), revenue: money(g.revenue),
    roas: g.spend ? g.revenue / g.spend : 0, profit: money(g.revenue - g.spend),
    cpc: g.clicks ? money(g.spend / g.clicks) : 0, cpa: g.sales ? money(g.spend / g.sales) : 0,
    ctr: g.impressions ? (g.clicks / g.impressions) * 100 : 0,
  })), r => r.spend, -1);
  if (!rows.length) return empty('No channel data', 'Create campaigns to compare channels.', 'mega');

  return h('div', {},
    h('div', { class: 'grid', style: { gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.3fr)' } },
      card('Spend share by channel', donut(rows.map(r => ({ label: r.channel, value: r.spend, color: colorFor(r.channel) })),
        { size: 210, centerLabel: 'Ad spend' })),
      card('ROAS by channel', hBarChart({ values: rows.map(r => r.roas) }, rows.map(r => r.channel),
        { colors: rows.map(r => (r.roas >= 2 ? 'var(--pos)' : r.roas >= 1 ? 'var(--warn)' : 'var(--neg)')),
          width: 560, fmt: v => `${v.toFixed(2)}×` }))),
    h('div', { class: 'mt' }, dataTable([
      { key: 'channel', label: 'Channel', render: r => h('span', { class: 'chip', style: { background: colorFor(r.channel) + '22', color: colorFor(r.channel) }, text: r.channel }) },
      { key: 'count', label: 'Campaigns', align: 'center' },
      { key: 'spend', label: 'Spend', align: 'right', render: r => h('span', { class: 'num', text: fmtMoney(r.spend) }) },
      { key: 'revenue', label: 'Revenue', align: 'right', render: r => h('span', { class: 'num pos', text: fmtMoney(r.revenue) }) },
      { key: 'profit', label: 'Profit', align: 'right', render: r => h('span', { class: `num ${r.profit >= 0 ? 'pos' : 'neg'}`, text: fmtMoney(r.profit) }) },
      { key: 'roas', label: 'ROAS', align: 'right', render: r => h('span', { class: 'num', style: { fontWeight: 700 }, text: `${r.roas.toFixed(2)}×` }) },
      { key: 'cpc', label: 'Avg CPC', align: 'right', render: r => h('span', { class: 'num tiny', text: fmtMoney(r.cpc) }) },
      { key: 'cpa', label: 'Avg CPA', align: 'right', render: r => h('span', { class: 'num tiny', text: r.cpa ? fmtMoney(r.cpa) : '—' }) },
      { key: 'ctr', label: 'CTR', align: 'right', render: r => h('span', { class: 'num tiny', text: fmtPct(r.ctr, 2) }) },
    ], { rows, pageSize: 12, exportName: 'channel-performance', searchable: false }).el));
}

/* ---------- daily log ---------- */
function dailyPanel(redraw) {
  const rows = sortBy(state.campaignDays, d => d.date, -1);
  const last30 = dayRange(addDays(today(), -29), today());
  const spendSeries = last30.map(d => money(rows.filter(r => r.date === d).reduce((a, r) => a + (r.spend || 0), 0)));
  const revSeries = last30.map(d => money(rows.filter(r => r.date === d).reduce((a, r) => a + (r.revenue || 0), 0)));

  return h('div', {},
    card('Daily spend vs revenue — last 30 days', lineChart([
      { name: 'Spend', color: 'var(--neg)', values: spendSeries },
      { name: 'Revenue', color: 'var(--pos)', values: revSeries },
    ], last30.map(d => fmtDate(d, 'short')), { height: 240 })),
    h('div', { class: 'mt' }, dataTable([
      { key: 'date', label: 'Date', render: r => fmtDate(r.date) },
      { key: 'campaignId', label: 'Campaign', value: r => store.find('campaigns', r.campaignId)?.name || '—',
        render: r => h('span', { text: store.find('campaigns', r.campaignId)?.name || '—' }) },
      { key: 'spend', label: 'Spend', align: 'right', render: r => h('span', { class: 'num', text: fmtMoney(r.spend) }) },
      { key: 'impressions', label: 'Impr.', align: 'right', render: r => h('span', { class: 'num tiny', text: fmtNum(r.impressions) }) },
      { key: 'clicks', label: 'Clicks', align: 'right', render: r => h('span', { class: 'num tiny', text: fmtNum(r.clicks) }) },
      { key: 'leads', label: 'Leads', align: 'right', render: r => h('span', { class: 'num tiny', text: fmtNum(r.leads) }) },
      { key: 'sales', label: 'Sales', align: 'right', render: r => h('span', { class: 'num tiny', text: fmtNum(r.sales) }) },
      { key: 'revenue', label: 'Revenue', align: 'right', render: r => h('span', { class: 'num pos', text: fmtMoney(r.revenue) }) },
    ], {
      rows, pageSize: 25, exportName: 'daily-ad-performance',
      emptyTitle: 'No daily data', emptyMsg: 'Log spend, clicks and revenue each day for accurate CPC and ROAS.', emptyIcon: 'calendar',
      actions: r => [
        { label: 'Edit', icon: 'edit', onClick: () => logDay(store.find('campaigns', r.campaignId), redraw, r) },
        { label: 'Delete', icon: 'trash', danger: true, onClick: async () => {
          if (await confirmDelete('this entry')) { await store.remove('campaignDays', r.id); redraw(); } } },
      ],
    }).el));
}

/* ---------- funnel ---------- */
function funnelPanel(T) {
  const totals = T.all.reduce((a, { m }) => ({
    impressions: a.impressions + m.impressions, clicks: a.clicks + m.clicks,
    leads: a.leads + m.leads, sales: a.sales + m.sales, spend: a.spend + m.spend, revenue: a.revenue + m.revenue,
  }), { impressions: 0, clicks: 0, leads: 0, sales: 0, spend: 0, revenue: 0 });

  const steps = [
    { label: 'Impressions', value: totals.impressions, rate: 100 },
    { label: 'Clicks', value: totals.clicks, rate: totals.impressions ? (totals.clicks / totals.impressions) * 100 : 0 },
    { label: 'Leads', value: totals.leads, rate: totals.clicks ? (totals.leads / totals.clicks) * 100 : 0 },
    { label: 'Sales', value: totals.sales, rate: totals.leads ? (totals.sales / totals.leads) * 100 : 0 },
  ];
  const funnel = h('div', { class: 'col' });
  const max = Math.max(...steps.map(s => s.value), 1);
  steps.forEach((s, i) => {
    funnel.append(h('div', {},
      h('div', { class: 'row between', style: { marginBottom: '5px' } },
        h('span', { style: { fontWeight: 600, fontSize: '.85rem' }, text: s.label }),
        h('span', { class: 'num tiny t2', text: `${fmtNum(s.value)}${i ? ` · ${s.rate.toFixed(2)}% conversion` : ''}` })),
      h('div', { class: 'bar', style: { height: '22px' } },
        h('i', { style: { width: `${(s.value / max) * 100}%`, background: `linear-gradient(90deg,${colorFor(s.label, i)},var(--accent-2))` } }))));
  });

  const eff = [
    ['Cost per 1,000 impressions (CPM)', totals.impressions ? money((totals.spend / totals.impressions) * 1000) : 0],
    ['Cost per click (CPC)', totals.clicks ? money(totals.spend / totals.clicks) : 0],
    ['Cost per lead (CPL)', totals.leads ? money(totals.spend / totals.leads) : 0],
    ['Cost per acquisition (CPA)', totals.sales ? money(totals.spend / totals.sales) : 0],
    ['Average order value', totals.sales ? money(totals.revenue / totals.sales) : 0],
    ['Profit per sale', totals.sales ? money((totals.revenue - totals.spend) / totals.sales) : 0],
  ];

  return h('div', { class: 'grid', style: { gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)' } },
    card('Marketing funnel', funnel, null, { sub: 'Aggregated across every campaign' }),
    card('Unit economics', h('dl', { class: 'kv' },
      ...eff.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { class: 'num', text: fmtMoney(v) })]),
      h('dt', { text: 'Break-even ROAS' }), h('dd', { class: 'num', text: '1.00×' }),
      h('dt', { text: 'Actual ROAS' }), h('dd', { class: `num ${T.roas >= 1 ? 'pos' : 'neg'}`, text: `${T.roas.toFixed(2)}×` }))));
}

/* ---------- editors ---------- */
function editCampaign(c, redraw) {
  const { modal: m } = formModal({
    title: c ? `Edit ${c.name}` : 'New campaign', size: 'wide', columns: 2,
    values: c || { startDate: today(), endDate: addDays(today(), 30), status: 'active' },
    fields: [
      { key: 'name', label: 'Campaign name', type: 'text', required: true, col: 'full' },
      { key: 'channel', label: 'Channel', type: 'select', required: true, options: store.AD_CHANNELS },
      { key: 'objective', label: 'Objective', type: 'select', options: ['Conversions', 'Traffic', 'Awareness', 'Leads', 'App installs', 'Retention', 'Organic growth', 'Reach'] },
      { key: 'budget', label: 'Total budget', type: 'money', required: true },
      { key: 'dailyBudget', label: 'Daily budget cap', type: 'money' },
      { key: 'startDate', label: 'Start date', type: 'date', required: true },
      { key: 'endDate', label: 'End date', type: 'date', required: true },
      { key: 'status', label: 'Status', type: 'select', options: [['active', 'Active'], ['paused', 'Paused'], ['completed', 'Completed'], ['draft', 'Draft']] },
      { key: 'targetRoas', label: 'Target ROAS', type: 'number', step: '0.1', placeholder: 'e.g. 3' },
      { key: 'audience', label: 'Audience / targeting', type: 'text', col: 'full' },
      { key: 'notes', label: 'Notes', type: 'textarea', col: 'full' },
    ],
    onSubmit: async v => {
      await store.save('campaigns', { ...(c || {}), ...v });
      m.close(); toast(c ? 'Campaign updated' : 'Campaign created', 'ok'); redraw();
    },
  });
}

function logDay(campaign, redraw, existing) {
  const { modal: m } = formModal({
    title: existing ? 'Edit daily stats' : 'Log daily performance',
    subtitle: campaign ? campaign.name : 'Pick a campaign and enter that day’s numbers',
    size: 'wide', columns: 3,
    values: existing || { campaignId: campaign?.id || '', date: today() },
    fields: [
      { key: 'campaignId', label: 'Campaign', type: 'select', required: true,
        options: state.campaigns.map(c => [c.id, c.name]), placeholder: 'Select…', col: 'full' },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'spend', label: 'Spend', type: 'money', required: true },
      { key: 'revenue', label: 'Revenue', type: 'money' },
      { key: 'impressions', label: 'Impressions', type: 'number', min: 0 },
      { key: 'clicks', label: 'Clicks', type: 'number', min: 0 },
      { key: 'leads', label: 'Leads', type: 'number', min: 0 },
      { key: 'sales', label: 'Sales / conversions', type: 'number', min: 0 },
      { key: 'notes', label: 'Note', type: 'text', col: 'full' },
      { key: 'postToTracker', label: 'Also record the spend as an expense in the tracker', type: 'switch', col: 'full' },
      { key: 'accountId', label: 'Pay from account', type: 'select', options: store.activeAccounts().map(a => [a.id, a.name]),
        when: mm => mm.postToTracker },
    ],
    onSubmit: async v => {
      const rec = { ...(existing || {}), campaignId: v.campaignId, date: v.date,
        spend: Number(v.spend) || 0, revenue: Number(v.revenue) || 0,
        impressions: Number(v.impressions) || 0, clicks: Number(v.clicks) || 0,
        leads: Number(v.leads) || 0, sales: Number(v.sales) || 0, notes: v.notes };
      await store.save('campaignDays', rec);
      if (v.postToTracker && v.accountId && rec.spend) {
        const cat = state.categories.find(c => c.name === 'Digital Marketing' && c.kind === 'expense');
        await store.save('transactions', { type: 'expense', amount: rec.spend, currency: settings.baseCurrency, rate: 1,
          accountId: v.accountId, categoryId: cat?.id, date: rec.date, status: 'cleared', tags: ['marketing'],
          notes: `${store.find('campaigns', v.campaignId)?.name || 'Campaign'} ad spend` });
      }
      m.close(); toast('Daily stats saved', 'ok'); redraw();
    },
  });
}

/* ---------- detail ---------- */
function openCampaign(c, redraw) {
  const m = campaignMetrics(c);
  const days = sortBy(m.days, d => d.date);
  const body = h('div', {});

  body.append(h('div', { class: 'card pad', style: { marginBottom: '13px' } },
    h('h2', { text: c.name }),
    h('div', { class: 'row', style: { gap: '6px', marginTop: '6px' } }, tag(c.channel, 'acc'), statusTag(c.status),
      c.objective ? tag(c.objective) : null),
    h('div', { class: 'row between mt' },
      h('span', { class: 't3 tiny', text: 'Budget utilisation' }),
      h('span', { class: 'num tiny', text: `${fmtMoney(m.spend)} / ${fmtMoney(m.budget)} (${m.utilisation.toFixed(0)}%)` })),
    bar(m.utilisation, m.utilisation > 100 ? 'neg' : m.utilisation > 85 ? 'warn' : ''),
    h('div', { class: 'tiny t3 mt-sm', text: `${fmtDate(c.startDate)} → ${fmtDate(c.endDate)} · ${fmtMoney(m.remaining)} remaining` })));

  body.append(h('dl', { class: 'kv card pad', style: { marginBottom: '13px' } },
    ...[['Total spend', fmtMoney(m.spend)], ['Revenue generated', fmtMoney(m.revenue)],
        ['Net profit', fmtMoney(m.profit)], ['ROAS', `${m.roas.toFixed(2)}×`], ['ROI', fmtPct(m.roi)],
        ['Impressions', fmtNum(m.impressions)], ['Clicks', fmtNum(m.clicks)], ['CTR', fmtPct(m.ctr, 2)],
        ['CPC', fmtMoney(m.cpc)], ['CPM', fmtMoney(m.cpm)], ['Leads', fmtNum(m.leads)],
        ['Cost per lead', m.cpl ? fmtMoney(m.cpl) : '—'], ['Sales', fmtNum(m.sales)],
        ['CPA', m.cpa ? fmtMoney(m.cpa) : '—'], ['Conversion rate', fmtPct(m.cvr, 2)]]
      .flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { class: 'num', text: v })])));

  if (days.length) {
    body.append(card('Daily trend', lineChart([
      { name: 'Spend', color: 'var(--neg)', values: days.map(d => d.spend) },
      { name: 'Revenue', color: 'var(--pos)', values: days.map(d => d.revenue) },
    ], days.map(d => fmtDate(d.date, 'short')), { height: 200, width: 420 })));
  }
  if (c.targetRoas) {
    const ok = m.roas >= Number(c.targetRoas);
    body.append(h('div', { class: `insight mt ${ok ? 'pos' : 'warn'}` },
      h('div', { class: 'ic', html: icon(ok ? 'check' : 'alert', 15) }),
      h('div', { class: 'tt' }, h('b', { text: ok ? 'Hitting target ROAS' : 'Below target ROAS' }),
        h('p', { text: `Target ${Number(c.targetRoas).toFixed(2)}× · actual ${m.roas.toFixed(2)}×. ${ok ? 'Consider scaling budget.' : `Revenue needs to reach ${fmtMoney(m.spend * Number(c.targetRoas))} at current spend.`}` }))));
  }
  if (c.notes) body.append(h('div', { class: 'card pad mt' }, h('div', { class: 'up mb', text: 'Notes' }), h('p', { class: 'tiny t2', text: c.notes })));

  const s0 = sheet({
    title: 'Campaign performance', body,
    footer: frag(h('button', { class: 'btn sm', text: 'Log day', onClick: () => { s0.close(); logDay(c, redraw); } }),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn sm primary', text: 'Edit campaign', onClick: () => { s0.close(); editCampaign(c, redraw); } })),
  });
}
