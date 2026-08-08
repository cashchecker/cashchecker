/* ═══════════ store.js — in-memory repository + selectors ═══════════
   Everything is loaded into memory once at boot and mirrored to
   IndexedDB on every mutation. Reads are synchronous (fast charts,
   instant filtering); writes are async and audited.
   ═════════════════════════════════════════════════════════════════ */

import * as db from './db.js';
import {
  uid, money, sum, today, iso, monthKey, parseISO, addDays, addMonths, endOfMonth, startOfMonth,
  daysBetween, groupBy, sortBy, emitter, setBaseCurrency, accruedInterest, emi, nextOccurrence, monthRange,
} from './util.js';

export const bus = emitter();

/* ---------- defaults ---------- */
export const DEFAULT_SETTINGS = {
  profileName: '',
  profileEmail: '',
  profilePhone: '',
  profilePhoto: null,        // downscaled JPEG data URL, or null
  baseCurrency: 'USD',
  gdriveClientId: '',        // OAuth client ID for Google Drive backup (public value)
  gdriveAuto: false,         // back up to Drive automatically after changes
  locale: '',
  mode: 'system',            // light | dark | system
  firstDayOfWeek: 1,
  fiscalStartMonth: 1,
  decimals: 2,
  privacyMode: false,        // blur amounts
  pinEnabled: false,
  pinHash: null, pinSalt: null, pinIters: 250000, pinLength: 6,
  autoLockMinutes: 10,
  biometricEnabled: false,
  biometricCredId: null,
  twoFactorEmail: '',
  twoFactorEnabled: false,
  notifyBudget: true, notifyBills: true, notifyCredit: true, notifyDigest: true,
  billLeadDays: 3,
  autoCategorize: true,
  onboarded: false,
  lastDigest: null,
  lastRecurringRun: null,
  version: '1.0.0',
};

export const ACCOUNT_TYPES = [
  ['cash', '💵 Cash'], ['bank', '🏦 Bank account'], ['card', '💳 Credit card'],
  ['wallet', '📱 Mobile wallet / UPI'], ['savings', '🏧 Savings'], ['business', '🏢 Business'],
  ['broker', '📈 Brokerage'], ['crypto', '🪙 Crypto wallet'], ['other', '📦 Other'],
];
/** Default emoji per account type, used when the user has not picked one. */
export const ACCOUNT_TYPE_EMOJI = {
  cash: '💵', bank: '🏦', card: '💳', wallet: '📱', savings: '🏧',
  business: '🏢', broker: '📈', crypto: '🪙', other: '📦',
};
export const accEmoji = a => a?.icon || ACCOUNT_TYPE_EMOJI[a?.type] || '💼';
/** Emoji suggestions offered when creating a savings goal. */
export const GOAL_EMOJI = ['🏠', '🚗', '✈️', '🛡️', '🎓', '💼', '💍', '📱', '💻', '🏖️',
  '🎁', '👶', '🏥', '🐕', '🎸', '📷', '⌚', '🚲', '🏋️', '💰'];
export const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Debit Card', 'Credit Card', 'Mobile Wallet',
  'UPI', 'Cheque', 'Crypto', 'Auto-debit', 'Other'];
export const RISK_LEVELS = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['speculative', 'Speculative']];
export const AD_CHANNELS = ['Meta Ads', 'Google Ads', 'TikTok Ads', 'YouTube Ads', 'Influencer Marketing',
  'SEO', 'Affiliate Marketing', 'Email Marketing', 'Content Marketing', 'LinkedIn Ads', 'X Ads', 'Other'];
export const INVESTMENT_CATEGORIES = ['Real Estate', 'Stock Market', 'Forex', 'Gold', 'Cryptocurrency',
  'Mutual Funds', 'SIP', 'Business Investment', 'Fixed Deposit', 'Digital Marketing', 'Startup', 'Personal Projects', 'Bonds', 'P2P Lending'];

/**
 * Optional two-level taxonomy. Parent names are matched against existing
 * categories where possible, so installing this never duplicates a category
 * the user already has.
 * Shape: [parentName, emoji, [subcategory, ...]]
 */
export const SEED_EXPENSE_TREE = [
  ['Food', '🍽️', ['Restaurant', 'Groceries', 'Coffee', 'Food Delivery', 'Bakery', 'Snacks']],
  ['Travel', '🚗', ['Fuel', 'Taxi / Auto', 'Bus / Train', 'Flight', 'Parking', 'Vehicle Service', 'Hotel']],
  ['Shopping', '🛍️', ['Clothes', 'Electronics', 'Home Items', 'Online Shopping', 'Beauty', 'Accessories']],
  ['Healthcare', '💊', ['Medicine', 'Doctor Visit', 'Hospital', 'Gym', 'Dental', 'Supplements']],
  ['Electricity', '⚡', ['Electricity Bill', 'Gas', 'Water Bill']],
  ['Internet', '🌐', ['Broadband', 'Mobile Data', 'Hosting']],
  ['Education', '📚', ['Fees', 'Books', 'Online Course', 'Coaching', 'Stationery', 'Exam Fee']],
  ['Entertainment', '🎮', ['Movies', 'Subscriptions', 'Games', 'Events', 'Hobbies']],
  ['Rent', '🏠', ['House Rent', 'Shop Rent', 'Maintenance']],
  ['Family', '👨‍👩‍👧', ['Children', 'Parents', 'Allowance', 'School Fee']],
  ['Business', '🏢', ['Inventory', 'Supplier', 'Logistics', 'Packaging', 'Office Supplies']],
  ['Digital Marketing', '📣', ['Meta Ads', 'Google Ads', 'TikTok Ads', 'Influencer', 'SEO', 'Email Marketing']],
  ['EMI', '🏦', ['Car EMI', 'Home EMI', 'Personal Loan EMI', 'Appliance EMI']],
  ['Charity', '🤲', ['Donation', 'Zakat', 'Relief Fund']],
  ['Other Expense', '📦', ['Gifts', 'Fees & Charges', 'Fines', 'Miscellaneous']],
];
export const SEED_INCOME_TREE = [
  ['Salary', '💼', ['Monthly Salary', 'Bonus', 'Arrears', 'Incentive', 'Overtime']],
  ['Business', '🏢', ['Sales Revenue', 'Service Income', 'Commission', 'Profit Share']],
  ['Investment Profit', '📈', ['Dividends', 'Interest', 'Mutual Fund', 'Capital Gain']],
  ['Freelance', '💻', ['Client Project', 'Retainer', 'Consulting']],
  ['Rental Income', '🏘️', ['House Rent', 'Shop Rent', 'Equipment Rent']],
  ['Other Income', '🎁', ['Gift Received', 'Cashback', 'Refund', 'Lottery']],
];

export const SEED_INCOME_CATEGORIES = [
  ['Salary', '#10b981'], ['Freelance', '#22d3ee'], ['Business', '#7c5cff'], ['Trading', '#f59e0b'],
  ['Investment Profit', '#34d399'], ['Rental Income', '#38bdf8'], ['Cashback', '#a78bfa'], ['Commission', '#fb923c'],
  ['Referral Income', '#2dd4bf'], ['Bonus', '#facc15'], ['Gift', '#f472b6'], ['Other Income', '#8b5cf6'],
];
export const SEED_EXPENSE_CATEGORIES = [
  ['Food', '#f43f5e'], ['Shopping', '#a78bfa'], ['Fuel', '#fb923c'], ['Grocery', '#34d399'], ['Rent', '#7c5cff'],
  ['Electricity', '#facc15'], ['Water', '#38bdf8'], ['Internet', '#22d3ee'], ['Mobile Recharge', '#60a5fa'],
  ['EMI', '#f59e0b'], ['Loan', '#fb7185'], ['Subscription', '#c084fc'], ['Entertainment', '#f472b6'],
  ['Healthcare', '#10b981'], ['Education', '#4ade80'], ['Travel', '#2dd4bf'], ['Charity', '#fdba74'],
  ['Family', '#8b5cf6'], ['Office', '#94a3b8'], ['Business', '#7c5cff'], ['Trading', '#f59e0b'],
  ['Digital Marketing', '#22d3ee'], ['Insurance', '#38bdf8'], ['Taxes', '#f43f5e'], ['Maintenance', '#a3a3a3'],
  ['Pets', '#fbbf24'], ['Gifts', '#f472b6'], ['Other Expense', '#94a3b8'],
];

/* ---------- state ---------- */
export const state = {};
db.STORES.forEach(s => { if (s !== 'settings') state[s] = []; });
export let settings = { ...DEFAULT_SETTINGS };

const idx = {};   // store → Map(id → obj)
function reindex(store) { idx[store] = new Map(state[store].map(o => [o.id, o])); }
export const find = (store, id) => idx[store]?.get(id) || null;
export const list = store => state[store] || [];

let _dirty = false;
export const isDirty = () => _dirty;

/* ---------- boot ---------- */
export async function load() {
  await db.open();
  for (const s of db.STORES) {
    if (s === 'settings') continue;
    state[s] = await db.all(s);
    reindex(s);
  }
  const rows = await db.all('settings');
  settings = { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map(r => [r.k, r.v])) };
  setBaseCurrency(settings.baseCurrency);
  bus.emit('loaded');
  return state;
}

export async function setSetting(k, v) {
  settings[k] = v;
  await db.put('settings', { k, v });
  if (k === 'baseCurrency') setBaseCurrency(v);
  bus.emit('settings', { k, v });
  bus.emit('change', { store: 'settings', k });
}
export async function setSettings(obj) {
  for (const [k, v] of Object.entries(obj)) { settings[k] = v; await db.put('settings', { k, v }); }
  if ('baseCurrency' in obj) setBaseCurrency(obj.baseCurrency);
  bus.emit('settings', obj);
  bus.emit('change', { store: 'settings' });
}

/* ---------- audit ---------- */
const AUDIT_CAP = 4000;
export async function audit(action, entity, entityId, detail = '') {
  const row = { id: uid('a'), at: Date.now(), action, entity, entityId, detail: String(detail).slice(0, 400) };
  state.audit.push(row);
  idx.audit?.set(row.id, row);
  await db.put('audit', row);
  if (state.audit.length > AUDIT_CAP + 400) {
    const drop = sortBy(state.audit, r => r.at).slice(0, state.audit.length - AUDIT_CAP);
    const ids = new Set(drop.map(d => d.id));
    state.audit = state.audit.filter(r => !ids.has(r.id));
    reindex('audit');
    await db.delMany('audit', [...ids]);
  }
}

/* ---------- generic CRUD ---------- */
export async function save(store, obj, { silent = false, auditIt = true } = {}) {
  const isNew = !obj.id;
  const rec = { ...obj };
  if (isNew) rec.id = uid(store[0]);
  rec.updatedAt = Date.now();
  if (isNew) rec.createdAt = rec.createdAt || Date.now();
  if (store === 'transactions') decorateTxn(rec);

  const existing = idx[store]?.get(rec.id);
  if (existing) {
    const i = state[store].indexOf(existing);
    state[store][i] = rec;
  } else state[store].push(rec);
  idx[store] ??= new Map();
  idx[store].set(rec.id, rec);

  await db.put(store, rec);
  if (auditIt) await audit(isNew ? 'create' : 'update', store, rec.id, rec.name || rec.title || rec.notes || '');
  _dirty = true;
  if (!silent) bus.emit('change', { store, id: rec.id, action: isNew ? 'create' : 'update' });
  return rec;
}

/**
 * Bulk upsert. Records are prepared in memory and written in a single
 * IndexedDB transaction — importing 10k rows is one round trip, not 10k.
 */
export async function saveMany(store, objs, opts = {}) {
  if (!objs.length) return [];
  const now = Date.now();
  const out = objs.map(obj => {
    const rec = { ...obj };
    if (!rec.id) rec.id = uid(store[0]);
    rec.updatedAt = now;
    rec.createdAt = rec.createdAt || now;
    if (store === 'transactions') decorateTxn(rec);
    return rec;
  });
  idx[store] ??= new Map();
  for (const rec of out) {
    const existing = idx[store].get(rec.id);
    if (existing) state[store][state[store].indexOf(existing)] = rec;
    else state[store].push(rec);
    idx[store].set(rec.id, rec);
  }
  await db.putMany(store, out);
  if (opts.auditIt !== false) await audit('bulk-create', store, '', `${out.length} records`);
  _dirty = true;
  if (!opts.silent) bus.emit('change', { store, action: 'bulk' });
  return out;
}

export async function remove(store, id, { silent = false, cascade = true } = {}) {
  const rec = idx[store]?.get(id);
  state[store] = state[store].filter(o => o.id !== id);
  idx[store]?.delete(id);
  await db.del(store, id);
  if (cascade) await cascadeDelete(store, id);
  await audit('delete', store, id, rec?.name || rec?.notes || '');
  _dirty = true;
  if (!silent) bus.emit('change', { store, id, action: 'delete' });
}
/** Bulk delete in a single transaction, still cascading to child records. */
export async function removeMany(store, ids, { cascade = true } = {}) {
  if (!ids.length) return;
  const set = new Set(ids);
  state[store] = state[store].filter(o => !set.has(o.id));
  ids.forEach(id => idx[store]?.delete(id));
  await db.delMany(store, ids);
  if (cascade) for (const id of ids) await cascadeDelete(store, id);
  await audit('bulk-delete', store, '', `${ids.length} records`);
  _dirty = true;
  bus.emit('change', { store, action: 'bulk-delete' });
}

async function cascadeDelete(store, id) {
  const kids = {
    credits: [['creditPayments', 'creditId']],
    contacts: [['credits', 'contactId']],
    investments: [['investmentTxns', 'investmentId']],
    campaigns: [['campaignDays', 'campaignId']],
    loans: [['loanPayments', 'loanId']],
    entityTypes: [['entityRecords', 'typeId']],
  }[store];
  if (!kids) return;
  for (const [child, key] of kids) {
    const doomed = state[child].filter(r => r[key] === id).map(r => r.id);
    if (!doomed.length) continue;
    state[child] = state[child].filter(r => r[key] !== id);
    reindex(child);
    await db.delMany(child, doomed);
    for (const cid of doomed) await cascadeDelete(child, cid);
  }
}

/* ---------- transaction helpers ---------- */
export function decorateTxn(t) {
  t.date ??= today();
  t.month = monthKey(t.date);
  t.amount = money(Math.abs(Number(t.amount) || 0));
  t.rate = Number(t.rate) || 1;
  t.base = money(t.amount * t.rate);          // amount in base currency
  t.currency ||= settings.baseCurrency;
  t.status ||= 'cleared';
  t.tags = (t.tags || []).filter(Boolean);
  return t;
}
/** Signed value in base currency: income +, expense −, transfer 0. */
export const signed = t => (t.type === 'income' ? t.base : t.type === 'expense' ? -t.base : 0);

/* ---------- selectors: transactions ---------- */
export function txnsIn(from, to, filter = {}) {
  return state.transactions.filter(t => {
    if (t.date < from || t.date > to) return false;
    if (filter.type && t.type !== filter.type) return false;
    if (filter.accountId && t.accountId !== filter.accountId && t.toAccountId !== filter.accountId) return false;
    if (filter.categoryId && t.categoryId !== filter.categoryId) return false;
    if (filter.status && t.status !== filter.status) return false;
    if (filter.tag && !(t.tags || []).includes(filter.tag)) return false;
    return true;
  });
}
export const incomeIn  = (f, t) => sum(txnsIn(f, t, { type: 'income' }), x => x.base);
export const expenseIn = (f, t) => sum(txnsIn(f, t, { type: 'expense' }), x => x.base);
export const netIn     = (f, t) => money(incomeIn(f, t) - expenseIn(f, t));

/* ---------- selectors: accounts ---------- */
export function accountBalance(accountId) {
  const acc = find('accounts', accountId);
  if (!acc) return 0;
  let bal = Number(acc.openingBalance) || 0;
  for (const t of state.transactions) {
    if (t.type === 'income' && t.accountId === accountId) bal += t.base;
    else if (t.type === 'expense' && t.accountId === accountId) bal -= t.base;
    else if (t.type === 'transfer') {
      if (t.accountId === accountId) bal -= t.base;
      if (t.toAccountId === accountId) bal += t.base;
    }
  }
  return money(bal);
}
export function accountBalances() {
  const m = new Map(state.accounts.map(a => [a.id, Number(a.openingBalance) || 0]));
  for (const t of state.transactions) {
    if (t.type === 'income') m.set(t.accountId, (m.get(t.accountId) || 0) + t.base);
    else if (t.type === 'expense') m.set(t.accountId, (m.get(t.accountId) || 0) - t.base);
    else if (t.type === 'transfer') {
      m.set(t.accountId, (m.get(t.accountId) || 0) - t.base);
      m.set(t.toAccountId, (m.get(t.toAccountId) || 0) + t.base);
    }
  }
  for (const [k, v] of m) m.set(k, money(v));
  return m;
}
export function totalCash() {
  const bals = accountBalances();
  return money(state.accounts.filter(a => !a.archived).reduce((s, a) => s + (bals.get(a.id) || 0), 0));
}

/* ---------- selectors: credit book ---------- */
export function creditPaid(creditId) {
  return sum(state.creditPayments.filter(p => p.creditId === creditId), p => p.amount);
}
export function creditOutstanding(c) {
  const interest = c.interestRate
    ? accruedInterest(c.amount, c.interestRate, c.date, today(), c.interestType || 'simple') : 0;
  return money(c.amount + interest - creditPaid(c.id));
}
export function creditTotals() {
  let receivable = 0, payable = 0, overdue = 0, overdueCount = 0;
  for (const c of state.credits) {
    const out = creditOutstanding(c);
    if (out <= 0.004) continue;
    if (c.direction === 'given') receivable += out; else payable += out;
    if (c.dueDate && c.dueDate < today()) { overdue += out; overdueCount++; }
  }
  return { receivable: money(receivable), payable: money(payable), net: money(receivable - payable), overdue: money(overdue), overdueCount };
}
export function contactBalance(contactId) {
  let bal = 0;
  for (const c of state.credits.filter(c => c.contactId === contactId)) {
    const out = creditOutstanding(c);
    bal += c.direction === 'given' ? out : -out;
  }
  return money(bal);
}
/** Chronological ledger for one contact. */
export function contactLedger(contactId) {
  const rows = [];
  for (const c of state.credits.filter(c => c.contactId === contactId)) {
    rows.push({ date: c.date, kind: c.direction === 'given' ? 'given' : 'taken', amount: c.amount,
      note: c.notes || (c.direction === 'given' ? 'Amount given' : 'Amount taken'), refId: c.id, ref: 'credits' });
    for (const p of state.creditPayments.filter(p => p.creditId === c.id)) {
      rows.push({ date: p.date, kind: c.direction === 'given' ? 'received' : 'paid', amount: p.amount,
        note: p.notes || p.method || 'Payment', refId: p.id, ref: 'creditPayments', creditId: c.id });
    }
  }
  const sorted = sortBy(rows, r => r.date + (r.kind === 'given' || r.kind === 'taken' ? 'a' : 'b'));
  let run = 0;
  return sorted.map(r => {
    run += (r.kind === 'given' || r.kind === 'paid') ? r.amount : -r.amount;
    return { ...r, running: money(run) };
  });
}

/* ---------- selectors: investments ---------- */
export function investmentMetrics(inv) {
  const txns = state.investmentTxns.filter(t => t.investmentId === inv.id);
  const added = sum(txns.filter(t => t.type === 'buy'), t => t.amount);
  const returns = sum(txns.filter(t => t.type === 'return'), t => t.amount);
  const sold = sum(txns.filter(t => t.type === 'sell'), t => t.amount);
  const invested = money((Number(inv.amountInvested) || 0) + added);
  const current = inv.currentValue != null && inv.currentValue !== ''
    ? money(Number(inv.currentValue)) : money(invested - sold);
  const profit = money(current + returns + sold - invested);
  const years = Math.max(daysBetween(inv.date, today()) / 365, 0.0027);
  const roiPct = invested ? (profit / invested) * 100 : 0;
  const annualised = invested && years > 0 ? (Math.pow((current + returns + sold) / invested, 1 / years) - 1) * 100 : 0;
  const expMonthly = money(invested * ((Number(inv.expMonthlyPct) || 0) / 100));
  const expAnnual = money(invested * ((Number(inv.expAnnualPct) || (Number(inv.expMonthlyPct) || 0) * 12) / 100));
  const flows = [
    { date: inv.date, amount: -(Number(inv.amountInvested) || 0) },
    ...txns.filter(t => t.type === 'buy').map(t => ({ date: t.date, amount: -t.amount })),
    ...txns.filter(t => t.type === 'return' || t.type === 'sell').map(t => ({ date: t.date, amount: t.amount })),
    { date: today(), amount: current },
  ].filter(f => f.amount !== 0);
  let irr = 0;
  try { irr = flows.length > 1 ? Number(xirrSafe(flows).toFixed(2)) : 0; } catch { irr = 0; }
  return { invested, current, returns, sold, profit, roiPct, annualised, expMonthly, expAnnual, years, irr,
           isProfit: profit >= 0 };
}
function xirrSafe(flows) {
  const t0 = parseISO(flows[0].date);
  const npv = r => flows.reduce((s, f) => s + f.amount / Math.pow(1 + r, (parseISO(f.date) - t0) / (365 * 86400000)), 0);
  let lo = -0.99, hi = 10;
  if (npv(lo) * npv(hi) > 0) return 0;
  for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (npv(lo) * npv(m) <= 0) hi = m; else lo = m; }
  return ((lo + hi) / 2) * 100;
}
export function portfolio() {
  let invested = 0, current = 0, profit = 0, expMonthly = 0, expAnnual = 0, returns = 0;
  const byCat = new Map();
  for (const inv of state.investments) {
    if (inv.status === 'closed') { const m = investmentMetrics(inv); returns += m.returns; profit += m.profit; continue; }
    const m = investmentMetrics(inv);
    invested += m.invested; current += m.current; profit += m.profit;
    expMonthly += m.expMonthly; expAnnual += m.expAnnual; returns += m.returns;
    byCat.set(inv.category, money((byCat.get(inv.category) || 0) + m.current));
  }
  return { invested: money(invested), current: money(current), profit: money(profit), returns: money(returns),
    expMonthly: money(expMonthly), expAnnual: money(expAnnual),
    roiPct: invested ? (profit / invested) * 100 : 0, byCat };
}

/* ---------- selectors: campaigns ---------- */
export function campaignMetrics(c) {
  const days = state.campaignDays.filter(d => d.campaignId === c.id);
  const spend = money(sum(days, d => d.spend) + (Number(c.baseSpend) || 0));
  const revenue = money(sum(days, d => d.revenue) + (Number(c.baseRevenue) || 0));
  const clicks = sum(days, d => d.clicks) + (Number(c.baseClicks) || 0);
  const impressions = sum(days, d => d.impressions) + (Number(c.baseImpressions) || 0);
  const leads = sum(days, d => d.leads) + (Number(c.baseLeads) || 0);
  const sales = sum(days, d => d.sales) + (Number(c.baseSales) || 0);
  const budget = Number(c.budget) || 0;
  return {
    spend, revenue, clicks, impressions, leads, sales, budget, days,
    cpc: clicks ? money(spend / clicks) : 0,
    cpm: impressions ? money((spend / impressions) * 1000) : 0,
    ctr: impressions ? (clicks / impressions) * 100 : 0,
    cpa: sales ? money(spend / sales) : 0,
    cpl: leads ? money(spend / leads) : 0,
    cvr: clicks ? (sales / clicks) * 100 : 0,
    roas: spend ? revenue / spend : 0,
    roi: spend ? ((revenue - spend) / spend) * 100 : 0,
    profit: money(revenue - spend),
    utilisation: budget ? (spend / budget) * 100 : 0,
    remaining: money(budget - spend),
  };
}
export function marketingTotals() {
  const all = state.campaigns.map(c => ({ c, m: campaignMetrics(c) }));
  const spend = money(sum(all, x => x.m.spend));
  const revenue = money(sum(all, x => x.m.revenue));
  const budget = money(sum(all, x => x.m.budget));
  return { spend, revenue, budget, profit: money(revenue - spend),
    roas: spend ? revenue / spend : 0, roi: spend ? ((revenue - spend) / spend) * 100 : 0,
    active: state.campaigns.filter(c => c.status === 'active').length, all };
}

/* ---------- selectors: budgets ---------- */
export function budgetStatus(b, anchor = today()) {
  const range = b.scope === 'weekly'
    ? { from: addDays(anchor, -((parseISO(anchor).getDay() + 6) % 7)), to: '' }
    : b.scope === 'daily' ? { from: anchor, to: anchor } : { from: startOfMonth(anchor), to: endOfMonth(anchor) };
  if (b.scope === 'weekly') range.to = addDays(range.from, 6);
  const spent = sum(state.transactions.filter(t =>
    t.type === 'expense' && t.date >= range.from && t.date <= range.to &&
    (b.categoryId === '*' || t.categoryId === b.categoryId)), t => t.base);
  const limit = Number(b.amount) || 0;
  const pct = limit ? (spent / limit) * 100 : 0;
  const daysTotal = daysBetween(range.from, range.to) + 1;
  const daysGone = Math.min(daysTotal, daysBetween(range.from, anchor) + 1);
  const pace = daysTotal ? (daysGone / daysTotal) * 100 : 0;
  return { ...range, spent: money(spent), limit, remaining: money(limit - spent), pct, pace,
    over: spent > limit, atRisk: pct > pace + 12 && pct < 100,
    projected: daysGone ? money((spent / daysGone) * daysTotal) : 0, daysTotal, daysGone };
}

/* ---------- selectors: bills & loans ---------- */
export function billsDue({ within = 30, includeOverdue = true } = {}) {
  const limit = addDays(today(), within);
  return sortBy(state.bills.filter(b => b.status !== 'paid' &&
    (b.dueDate <= limit) && (includeOverdue || b.dueDate >= today())), b => b.dueDate);
}
export function loanMetrics(l) {
  const paid = state.loanPayments.filter(p => p.loanId === l.id);
  const paidPrincipal = sum(paid, p => p.principal ?? 0);
  const paidInterest = sum(paid, p => p.interest ?? 0);
  const paidTotal = sum(paid, p => p.amount);
  const principal = Number(l.principal) || 0;
  const monthly = l.emi ? Number(l.emi) : emi(principal, l.rate, l.termMonths);
  const elapsed = Math.max(0, Math.min(l.termMonths || 0, Math.floor(daysBetween(l.startDate, today()) / 30.44)));
  const outstanding = money(Math.max(0, principal - paidPrincipal));
  const totalPayable = money(monthly * (Number(l.termMonths) || 0));
  return { monthly, paidPrincipal, paidInterest, paidTotal, outstanding, elapsed,
    remainingMonths: Math.max(0, (Number(l.termMonths) || 0) - paid.length),
    totalInterest: money(totalPayable - principal), totalPayable,
    progress: principal ? (paidPrincipal / principal) * 100 : 0 };
}
export function loanTotals() {
  const act = state.loans.filter(l => l.status !== 'closed');
  return {
    outstanding: money(sum(act, l => loanMetrics(l).outstanding)),
    monthly: money(sum(act, l => loanMetrics(l).monthly)),
    count: act.length,
  };
}

/* ---------- selectors: goals ---------- */
export function goalStatus(g) {
  const saved = money(Number(g.saved) || 0);
  const target = Number(g.target) || 0;
  const pct = target ? Math.min(100, (saved / target) * 100) : 0;
  const daysLeft = g.deadline ? daysBetween(today(), g.deadline) : null;
  const remaining = money(Math.max(0, target - saved));
  const monthsLeft = daysLeft != null ? Math.max(1, Math.round(daysLeft / 30.44)) : null;
  return { saved, target, pct, remaining, daysLeft, monthsLeft,
    perMonth: monthsLeft ? money(remaining / monthsLeft) : 0,
    done: pct >= 100, behind: daysLeft != null && daysLeft > 0 && pct < 100 - (daysLeft / 3.65) };
}

/* ---------- net worth ---------- */
export function netWorth() {
  const cash = totalCash();
  const inv = portfolio().current;
  const credit = creditTotals();
  const loans = loanTotals().outstanding;
  const assets = money(Math.max(0, cash) + inv + credit.receivable);
  const liabilities = money(Math.abs(Math.min(0, cash)) + credit.payable + loans);
  return { cash, investments: inv, receivable: credit.receivable, payable: credit.payable,
    loans, assets, liabilities, total: money(assets - liabilities) };
}

/* ---------- time series ---------- */
export function monthlySeries(months = 12, endAnchor = today()) {
  const from = addMonths(startOfMonth(endAnchor), -(months - 1));
  const keys = monthRange(from, endAnchor);
  const inc = new Map(keys.map(k => [k, 0])), exp = new Map(keys.map(k => [k, 0]));
  for (const t of state.transactions) {
    if (!inc.has(t.month)) continue;
    if (t.type === 'income') inc.set(t.month, inc.get(t.month) + t.base);
    else if (t.type === 'expense') exp.set(t.month, exp.get(t.month) + t.base);
  }
  return keys.map(k => ({ key: k, income: money(inc.get(k)), expense: money(exp.get(k)),
    net: money(inc.get(k) - exp.get(k)) }));
}
export function dailySeries(from, to) {
  const map = new Map();
  for (const t of state.transactions) {
    if (t.date < from || t.date > to) continue;
    const r = map.get(t.date) || { income: 0, expense: 0 };
    if (t.type === 'income') r.income += t.base; else if (t.type === 'expense') r.expense += t.base;
    map.set(t.date, r);
  }
  const out = []; let cur = from, guard = 0;
  while (cur <= to && guard++ < 800) {
    const r = map.get(cur) || { income: 0, expense: 0 };
    out.push({ key: cur, income: money(r.income), expense: money(r.expense), net: money(r.income - r.expense) });
    cur = addDays(cur, 1);
  }
  return out;
}
/**
 * Spend/income per category.
 * `rollUp` folds sub-categories into their top-level parent, which is what you
 * want for charts — otherwise a two-level taxonomy shatters a pie into slivers.
 */
export function categoryBreakdown(from, to, type = 'expense', { rollUp = false } = {}) {
  const m = new Map();
  for (const t of txnsIn(from, to, { type })) {
    const key = rollUp ? catRootId(t.categoryId) : t.categoryId;
    m.set(key, money((m.get(key) || 0) + t.base));
  }
  return sortBy([...m].map(([id, value]) => {
    const c = find('categories', id);
    return { id, value, label: c ? (rollUp ? c.name : catPath(id)) : 'Uncategorised',
      color: c?.color || '#94a3b8', icon: c?.icon || '' };
  }), r => r.value, -1);
}
/** Running balance of all accounts across a window (for cash-flow charts). */
export function balanceSeries(from, to) {
  const opening = money(state.accounts.reduce((s, a) => s + (Number(a.openingBalance) || 0), 0));
  const before = state.transactions.filter(t => t.date < from).reduce((s, t) => s + signed(t), 0);
  let run = money(opening + before);
  return dailySeries(from, to).map(d => { run = money(run + d.net); return { key: d.key, value: run }; });
}

/* ---------- recurring engine ---------- */
export async function runRecurring(now = today()) {
  let created = 0;
  for (const r of state.recurring) {
    if (!r.active) continue;
    let next = r.nextRun;
    let guard = 0;
    while (next && next <= now && guard++ < 120) {
      if (r.endDate && next > r.endDate) { await save('recurring', { ...r, active: false }, { silent: true, auditIt: false }); break; }
      const tpl = { ...r.template, date: next, recurringId: r.id, id: undefined };
      await save('transactions', tpl, { silent: true, auditIt: false });
      created++;
      const after = nextOccurrence(next, r.rule);
      if (!after) { next = null; break; }
      next = after;
    }
    if (next !== r.nextRun) await save('recurring', { ...r, nextRun: next, lastRun: now, active: !!next && r.active }, { silent: true, auditIt: false });
  }
  // auto-roll recurring bills that were marked paid
  for (const b of state.bills) {
    if (b.status === 'paid' && b.recurrence && b.recurrence !== 'none' && b.dueDate <= now) {
      // Only roll if the bill hasn't already been rolled today (idempotency key).
      // The `lastPaid` field is set when rolling; if it's today, skip.
      if (b.lastPaid === now) continue;
      const nd = nextOccurrence(b.dueDate, b.recurrence);
      if (nd) await save('bills', { ...b, dueDate: nd, status: 'unpaid', lastPaid: now }, { silent: true, auditIt: false });
    }
  }
  if (created) { await audit('recurring', 'transactions', '', `${created} generated`); bus.emit('change', { store: 'transactions', action: 'bulk' }); }
  await setSetting('lastRecurringRun', now);
  return created;
}

/* ---------- reminders ---------- */
export async function addReminder(r) {
  const rec = { id: uid('r'), at: Date.now(), read: 0, done: 0, ...r };
  state.reminders.push(rec);
  idx.reminders ??= new Map(); idx.reminders.set(rec.id, rec);
  await db.put('reminders', rec);
  bus.emit('change', { store: 'reminders' });
  return rec;
}
export async function saveReminder(r) {
  const rec = { ...r, updatedAt: Date.now() };
  const i = state.reminders.findIndex(x => x.id === r.id);
  if (i >= 0) state.reminders[i] = rec; else state.reminders.push(rec);
  idx.reminders ??= new Map(); idx.reminders.set(rec.id, rec);
  await db.put('reminders', rec);
  bus.emit('change', { store: 'reminders' });
  return rec;
}
export async function removeReminder(id) {
  state.reminders = state.reminders.filter(x => x.id !== id);
  idx.reminders?.delete(id);
  await db.del('reminders', id);
  bus.emit('change', { store: 'reminders' });
}
export async function markReminderDone(id) {
  const r = idx.reminders?.get(id);
  if (!r) return;
  r.done = 1; r.read = 1;
  await db.put('reminders', r);
  bus.emit('change', { store: 'reminders' });
}

/* ---------- reminder rules ---------- */
export async function addReminderRule(rule) {
  const rec = { id: uid('rr'), active: 1, ...rule };
  state.reminderRules.push(rec);
  idx.reminderRules ??= new Map(); idx.reminderRules.set(rec.id, rec);
  await db.put('reminderRules', rec);
  bus.emit('change', { store: 'reminderRules' });
  return rec;
}
export async function saveReminderRule(rule) {
  const rec = { ...rule };
  const i = state.reminderRules.findIndex(x => x.id === rule.id);
  if (i >= 0) state.reminderRules[i] = rec; else state.reminderRules.push(rec);
  idx.reminderRules ??= new Map(); idx.reminderRules.set(rec.id, rec);
  await db.put('reminderRules', rec);
  bus.emit('change', { store: 'reminderRules' });
  return rec;
}
export async function removeReminderRule(id) {
  state.reminderRules = state.reminderRules.filter(x => x.id !== id);
  idx.reminderRules?.delete(id);
  await db.del('reminderRules', id);
  bus.emit('change', { store: 'reminderRules' });
}

/** Run all active reminder rules and emit notifications. Idempotent per rule+date key. */
export async function runReminderRules() {
  const seen = new Set(state.notifications.filter(n => n.key).map(n => n.key));
  const day = today();
  const add = async (key, n) => { if (!seen.has(key)) { seen.add(key); await pushNotification({ key, ...n }); } };
  for (const rule of state.reminderRules) {
    if (!rule.active) continue;
    const key = `rem-rule-${rule.id}-${day}`;
    await add(key, { type: 'reminder', level: rule.level || 'info', title: `Reminder: ${rule.title}`,
      body: rule.notes || 'Personal reminder', refType: 'reminders', refId: rule.id, route: '#/reminders' });
  }
}

/* ---------- notifications ---------- */
export async function pushNotification(n) {
  const row = { id: uid('n'), at: Date.now(), read: 0, level: 'info', ...n };
  state.notifications.push(row);
  idx.notifications ??= new Map();
  idx.notifications.set(row.id, row);
  await db.put('notifications', row);
  bus.emit('notify', row);
  bus.emit('change', { store: 'notifications' });
  return row;
}
export const unreadCount = () => state.notifications.filter(n => !n.read).length;
export async function markAllRead() {
  const un = state.notifications.filter(n => !n.read);
  un.forEach(n => { n.read = 1; });
  await db.putMany('notifications', un);
  bus.emit('change', { store: 'notifications' });
}

/** Recompute alerts (bills, budgets, credit, goals). Idempotent per key/day. */
export async function refreshAlerts() {
  const seen = new Set(state.notifications.filter(n => n.key).map(n => n.key));
  const day = today();
  const add = async (key, n) => { if (!seen.has(key)) { seen.add(key); await pushNotification({ key, ...n }); } };

  if (settings.notifyBills) {
    for (const b of state.bills) {
      if (b.status === 'paid') continue;
      const d = daysBetween(day, b.dueDate);
      if (d < 0) await add(`bill-late-${b.id}-${b.dueDate}`, { type: 'bill', level: 'danger',
        title: `${b.name} is overdue`, body: `Was due ${b.dueDate} · ${money(b.amount)}`, refType: 'bills', refId: b.id, route: '#/bills' });
      else if (d <= (settings.billLeadDays || 3)) await add(`bill-due-${b.id}-${b.dueDate}`, { type: 'bill', level: 'warn',
        title: `${b.name} due ${d === 0 ? 'today' : `in ${d} day${d > 1 ? 's' : ''}`}`, body: `${money(b.amount)} · ${b.type || 'Bill'}`, refType: 'bills', refId: b.id, route: '#/bills' });
    }
  }
  if (settings.notifyBudget) {
    for (const b of state.budgets) {
      const s = budgetStatus(b);
      const cat = b.categoryId === '*' ? 'Overall' : (find('categories', b.categoryId)?.name || 'Budget');
      const mk = monthKey(day);
      if (s.over) await add(`bud-over-${b.id}-${mk}`, { type: 'budget', level: 'danger',
        title: `${cat} budget exceeded`, body: `Spent ${money(s.spent)} of ${money(s.limit)}`, refType: 'budgets', refId: b.id, route: '#/budget' });
      else if (s.pct >= 80) await add(`bud-warn-${b.id}-${mk}`, { type: 'budget', level: 'warn',
        title: `${cat} budget at ${Math.round(s.pct)}%`, body: `${money(s.remaining)} left this period`, refType: 'budgets', refId: b.id, route: '#/budget' });
    }
  }
  if (settings.notifyCredit) {
    for (const c of state.credits) {
      if (!c.dueDate || creditOutstanding(c) <= 0.004) continue;
      const d = daysBetween(day, c.dueDate);
      const who = find('contacts', c.contactId)?.name || 'Contact';
      if (d < 0) await add(`cr-late-${c.id}-${c.dueDate}`, { type: 'credit', level: 'danger',
        title: `${who} · payment overdue`, body: `${money(creditOutstanding(c))} outstanding since ${c.dueDate}`, refType: 'credits', refId: c.id, route: '#/credit' });
      else if (d <= 3) await add(`cr-due-${c.id}-${c.dueDate}`, { type: 'credit', level: 'warn',
        title: `${who} · due ${d === 0 ? 'today' : `in ${d}d`}`, body: `${money(creditOutstanding(c))} outstanding`, refType: 'credits', refId: c.id, route: '#/credit' });
    }
  }
  for (const inv of state.investments) {
    if (inv.maturityDate && inv.status !== 'closed') {
      const d = daysBetween(day, inv.maturityDate);
      if (d >= 0 && d <= 7) await add(`inv-mat-${inv.id}`, { type: 'investment', level: 'info',
        title: `${inv.name} matures ${d === 0 ? 'today' : `in ${d}d`}`, body: inv.category, refType: 'investments', refId: inv.id, route: '#/investments' });
    }
  }
  bus.emit('change', { store: 'notifications' });
  await runReminderRules();
}

/* ---------- backup ---------- */
export async function exportBackup(opts) { return db.exportAll(opts); }
export async function importBackup(json, mode) {
  const res = await db.importAll(json, mode);
  await load();
  bus.emit('change', { store: '*', action: 'import' });
  return res;
}
export async function factoryReset() {
  await db.wipe();
  Object.keys(state).forEach(k => { state[k] = []; });
  state.reminders = []; state.reminderRules = [];
  settings = { ...DEFAULT_SETTINGS };
  bus.emit('change', { store: '*', action: 'reset' });
}

/* ---------- convenience ---------- */
export const categoriesOf = kind => sortBy(state.categories.filter(c => c.kind === kind && !c.archived), c => c.name);

/* ---------- category hierarchy (two-level: category > sub-category) ---------- */
/** Top-level categories only. */
export const topCategories = kind =>
  sortBy(state.categories.filter(c => c.kind === kind && !c.archived && !c.parentId), c => c.name);
/** Direct children of a category. */
export const subCategories = parentId =>
  sortBy(state.categories.filter(c => c.parentId === parentId && !c.archived), c => c.name);
/** Walks up to the top-level ancestor — used to roll sub-categories up in reports. */
export function catRoot(id) {
  let c = find('categories', id);
  let guard = 0;
  while (c?.parentId && guard++ < 8) {
    const parent = find('categories', c.parentId);
    if (!parent) break;
    c = parent;
  }
  return c || null;
}
export const catRootId = id => catRoot(id)?.id || id;
/** "Food & Dining › Restaurant" for display. */
export function catPath(id, sep = ' › ') {
  const c = find('categories', id);
  if (!c) return 'Uncategorised';
  if (!c.parentId) return c.name;
  const parent = find('categories', c.parentId);
  return parent ? `${parent.name}${sep}${c.name}` : c.name;
}
/**
 * Emoji for the built-in category names, so the picker looks complete even
 * for categories created before icons existed. A user-set `icon` always wins.
 */
export const CATEGORY_EMOJI = {
  // expense
  Food: '🍽️', Shopping: '🛍️', Fuel: '⛽', Grocery: '🛒', Rent: '🏠', Electricity: '⚡',
  Water: '🚰', Internet: '🌐', 'Mobile Recharge': '📱', EMI: '🏦', Loan: '💳',
  Subscription: '📺', Entertainment: '🎮', Healthcare: '💊', Education: '📚', Travel: '🚗',
  Charity: '🤲', Family: '👨‍👩‍👧', Office: '🏢', Business: '🏢', Trading: '📊',
  'Digital Marketing': '📣', Insurance: '🛡️', Taxes: '🧾', Maintenance: '🔧', Pets: '🐕',
  Gifts: '🎁', 'Other Expense': '📦',
  // income
  Salary: '💼', Freelance: '💻', 'Investment Profit': '📈', 'Rental Income': '🏘️',
  Cashback: '💸', Commission: '🤝', 'Referral Income': '🔗', Bonus: '🎯', Gift: '🎁',
  'Other Income': '🎁',
};
export const catIcon = c => (c ? (c.icon || CATEGORY_EMOJI[c.name] || (c.parentId ? catIcon(find('categories', c.parentId)) : '📁')) : '📁');
export const catEmoji = id => catIcon(find('categories', id));
/** A category plus every descendant — for filters that should include sub-categories. */
export function catWithChildren(id) {
  const out = [id];
  for (const c of state.categories) if (c.parentId === id) out.push(c.id);
  return out;
}
export const hasSubCategories = () => state.categories.some(c => c.parentId);
export const activeAccounts = () => sortBy(state.accounts.filter(a => !a.archived), a => a.name);
export const catName = id => find('categories', id)?.name || 'Uncategorised';
export const catColor = id => find('categories', id)?.color || '#94a3b8';
export const accName = id => find('accounts', id)?.name || '—';
export const contactName = id => find('contacts', id)?.name || '—';
export const allTags = () => [...new Set(state.transactions.flatMap(t => t.tags || []))].sort();

export { db, groupBy, sortBy, iso };
