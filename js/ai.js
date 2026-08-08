/* ═══════════ ai.js — on-device financial intelligence ═══════════
   Everything here runs locally: no network, no third party, no data
   leaves the device. The techniques are classical (naive Bayes,
   OLS regression, robust z-scores, rule engines) rather than an LLM —
   deterministic, explainable and instant on large datasets.
   ═══════════════════════════════════════════════════════════════ */

import {
  money, today, addMonths, monthKey, startOfMonth, endOfMonth, daysBetween, mean, median, stdev,
  linreg, ema, sortBy, groupBy, period, fmtMoney, parseISO, addDays, uniq, iso,
} from './util.js';
import {
  state, find, categoriesOf, catName, monthlySeries, budgetStatus, netWorth, creditTotals,
  loanTotals, portfolio, txnsIn, goalStatus, settings, list,
} from './store.js';

/* ═══════════ 1. AUTO-CATEGORISATION ═══════════
   Hybrid: user-defined rules → learned naive-Bayes model over
   transaction notes/tags/merchants → seeded keyword priors. */

const SEED_KEYWORDS = {
  Food: ['restaurant','cafe','coffee','pizza','burger','dinner','lunch','breakfast','food','kfc','mcdonald','starbucks','bakery','biryani','snack','tea','canteen','doordash','ubereats','swiggy','zomato','deliveroo'],
  Grocery: ['grocery','supermarket','mart','bazaar','fresh','vegetable','fruit','walmart','tesco','aldi','carrefour','costco','kroger','sainsbury'],
  Fuel: ['fuel','petrol','diesel','gas station','shell','total','chevron','bp ','pump','cng','octane'],
  Rent: ['rent','landlord','lease','tenancy','house rent','apartment'],
  Electricity: ['electric','power bill','wapda','k-electric','energy','utility bill','meralco','eskom'],
  Water: ['water bill','water supply','wasa','aqua'],
  Internet: ['internet','broadband','wifi','fiber','fibre','isp','ptcl','comcast','airtel broadband'],
  'Mobile Recharge': ['recharge','topup','top-up','prepaid','mobile bill','jazz','telenor','zong','airtel','vodafone','at&t','verizon','sim'],
  Subscription: ['netflix','spotify','youtube premium','prime','subscription','icloud','dropbox','adobe','office 365','chatgpt','claude','saas','hosting','domain','canva','figma'],
  Entertainment: ['cinema','movie','game','concert','netflix','theatre','park','bowling','playstation','steam','xbox'],
  Healthcare: ['hospital','clinic','doctor','pharmacy','medicine','medical','dental','lab test','diagnostic','insurance health','physio'],
  Education: ['school','college','university','tuition','course','udemy','coursera','book','exam fee','semester','academy'],
  Travel: ['flight','airline','hotel','airbnb','uber','careem','taxi','train','bus ticket','visa fee','booking.com','tour','trip','luggage'],
  Shopping: ['amazon','ebay','daraz','aliexpress','clothes','shoes','mall','fashion','zara','h&m','store','shein','myntra'],
  EMI: ['emi','instal','installment','instalment'],
  Loan: ['loan','repayment','principal','mortgage'],
  Insurance: ['insurance','premium','policy','takaful'],
  Charity: ['charity','donation','zakat','sadaqah','ngo','relief','mosque','church','temple'],
  Office: ['office','stationery','printer','coworking','wework','supplies'],
  'Digital Marketing': ['facebook ads','meta ads','google ads','tiktok ads','adwords','boost post','campaign','influencer','seo','ad spend','ppc'],
  Business: ['supplier','inventory','vendor','wholesale','logistics','shipment','packaging','courier'],
  Trading: ['broker','brokerage','trading fee','margin','forex','binance','coinbase','exchange fee'],
  Family: ['family','kids','children','parents','wife','husband','allowance','school fee'],
  Pets: ['pet','vet','dog','cat food','grooming'],
  Maintenance: ['repair','maintenance','service','plumber','electrician','mechanic','spare part','car service'],
  Taxes: ['tax','vat','gst','fbr','income tax','withholding','irs','hmrc'],
  Salary: ['salary','payroll','wage','monthly pay','stipend'],
  Freelance: ['freelance','upwork','fiverr','client payment','contract work','invoice paid','gig'],
  'Rental Income': ['rent received','tenant','rental income','lease income'],
  Cashback: ['cashback','reward','refund','rebate'],
  Commission: ['commission','brokerage received','referral fee'],
  Bonus: ['bonus','incentive','13th month','eid bonus'],
  'Investment Profit': ['dividend','profit payout','interest earned','coupon','maturity','capital gain'],
};

const tokenize = str => String(str || '').toLowerCase()
  .replace(/[^a-z0-9\s&.'-]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP.has(w));
const STOP = new Set(['the','and','for','with','from','into','this','that','was','are','you','your','via','ref','txn','payment','paid','pay','amount','rs','usd','inr','pkr']);

let model = null;   // {docs, byCat:Map(cat→{n, tokens:Map}), vocab:Set}

/** Train (or retrain) the naive-Bayes classifier from historical transactions. */
export function trainCategorizer() {
  const byCat = new Map();
  let docs = 0;
  const vocab = new Set();
  const add = (catId, text, weight = 1) => {
    if (!catId) return;
    const toks = tokenize(text);
    if (!toks.length) return;
    if (!byCat.has(catId)) byCat.set(catId, { n: 0, total: 0, tokens: new Map() });
    const rec = byCat.get(catId);
    rec.n += weight; docs += weight;
    for (const t of toks) {
      rec.tokens.set(t, (rec.tokens.get(t) || 0) + weight);
      rec.total += weight;
      vocab.add(t);
    }
  };
  // learn from history (recent transactions weigh more)
  const now = today();
  for (const t of state.transactions) {
    if (!t.categoryId) continue;
    const ageMonths = Math.abs(daysBetween(t.date, now)) / 30.44;
    const w = ageMonths < 3 ? 3 : ageMonths < 12 ? 2 : 1;
    add(t.categoryId, `${t.notes || ''} ${t.merchant || ''} ${(t.tags || []).join(' ')} ${t.paymentMethod || ''}`, w);
  }
  // seed priors so a fresh install still classifies well
  for (const [name, words] of Object.entries(SEED_KEYWORDS)) {
    const cat = state.categories.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (cat) add(cat.id, words.join(' '), 2);
  }
  model = { docs, byCat, vocab };
  return model;
}

/**
 * Suggest a category for free text.
 * @returns {{categoryId,confidence,label,reason}|null}
 */
export function suggestCategory(text, kind = 'expense', amount) {
  if (!settings.autoCategorize) return null;
  if (!model) trainCategorizer();
  // 1. explicit user rules win
  const lower = String(text || '').toLowerCase();
  for (const r of sortBy(state.rules.filter(r => r.active !== false), r => -(r.priority || 0))) {
    const hit = r.matchType === 'regex'
      ? safeRegex(r.pattern)?.test(lower)
      : lower.includes(String(r.pattern || '').toLowerCase());
    if (hit && r.pattern) {
      if (r.minAmount && amount < r.minAmount) continue;
      if (r.maxAmount && amount > r.maxAmount) continue;
      const c = find('categories', r.categoryId);
      if (c && c.kind === kind) return { categoryId: c.id, confidence: 1, label: c.name, reason: `Rule: “${r.pattern}”` };
    }
  }
  const toks = tokenize(text);
  if (!toks.length || !model.docs) return null;
  const V = model.vocab.size || 1;
  let best = null, second = null;
  for (const [catId, rec] of model.byCat) {
    const cat = find('categories', catId);
    if (!cat || cat.kind !== kind) continue;
    let logp = Math.log(rec.n / model.docs);
    for (const t of toks) logp += Math.log(((rec.tokens.get(t) || 0) + 1) / (rec.total + V));
    const cand = { categoryId: catId, score: logp, label: cat.name };
    if (!best || logp > best.score) { second = best; best = cand; }
    else if (!second || logp > second.score) second = cand;
  }
  if (!best) return null;
  // confidence from log-odds margin, squashed to 0..1
  const margin = second ? best.score - second.score : 2;
  const confidence = Math.min(0.99, 1 / (1 + Math.exp(-margin / 1.6)));
  if (confidence < 0.58) return null;
  const matched = toks.filter(t => model.byCat.get(best.categoryId)?.tokens.has(t)).slice(0, 3);
  return { categoryId: best.categoryId, confidence, label: best.label,
    reason: matched.length ? `Matched “${matched.join(', ')}”` : 'Similar to past entries' };
}
function safeRegex(p) { try { return new RegExp(p, 'i'); } catch { return null; } }

/** Learn immediately from a confirmed correction. */
export function reinforce(text, categoryId) {
  if (!model) trainCategorizer();
  const toks = tokenize(text);
  if (!toks.length || !categoryId) return;
  if (!model.byCat.has(categoryId)) model.byCat.set(categoryId, { n: 0, total: 0, tokens: new Map() });
  const rec = model.byCat.get(categoryId);
  rec.n += 3; model.docs += 3;
  toks.forEach(t => { rec.tokens.set(t, (rec.tokens.get(t) || 0) + 3); rec.total += 3; model.vocab.add(t); });
}

/* ═══════════ 2. FORECASTING ═══════════ */

/**
 * Forecast income/expense/net for the next N months using a blend of
 * OLS trend and exponential smoothing, plus known scheduled commitments.
 */
export function forecast(months = 6, history = 12) {
  const hist = monthlySeries(history);
  const inc = hist.map(m => m.income), exp = hist.map(m => m.expense);
  const project = (arr) => {
    const lr = linreg(arr);
    const smooth = ema(arr, 0.45);
    const conf = Math.max(0.15, Math.min(0.95, lr.r2));
    return i => Math.max(0, money(conf * lr.at(arr.length - 1 + i) + (1 - conf) * smooth));
  };
  const fi = project(inc), fe = project(exp);
  const scheduled = scheduledOutflowPerMonth();
  const out = [];
  let anchor = today();
  for (let i = 1; i <= months; i++) {
    anchor = addMonths(anchor, 1);
    const income = fi(i);
    const expense = money(Math.max(fe(i), scheduled * 0.9));
    out.push({ key: monthKey(anchor), income, expense, net: money(income - expense) });
  }
  const volatility = stdev(exp);
  const r2 = linreg(exp).r2;
  return { months: out, confidence: Math.round(Math.max(25, Math.min(95, (0.4 + r2 * 0.6) * 100))),
    volatility: money(volatility), basis: hist };
}

/** Recurring transactions + bills + loan EMIs = committed monthly outflow. */
export function scheduledOutflowPerMonth() {
  const perMonthFactor = { daily: 30.44, weekly: 4.33, biweekly: 2.17, monthly: 1, quarterly: 1 / 3, halfyearly: 1 / 6, yearly: 1 / 12 };
  let total = 0;
  for (const r of state.recurring) {
    if (!r.active || r.template?.type !== 'expense') continue;
    total += (Number(r.template.amount) || 0) * (perMonthFactor[r.rule] || 1);
  }
  for (const b of state.bills) {
    if (b.status === 'paid' && (!b.recurrence || b.recurrence === 'none')) continue;
    total += (Number(b.amount) || 0) * (perMonthFactor[b.recurrence] || 1);
  }
  total += loanTotals().monthly;
  return money(total);
}

/** Projected cash balance day by day — flags the date you could run dry. */
export function runwayProjection(days = 90) {
  const start = totalLiquid();
  const hist = monthlySeries(6);
  const avgIn = mean(hist.map(m => m.income)) / 30.44;
  const avgOut = mean(hist.map(m => m.expense)) / 30.44;
  const out = [];
  let bal = start, zeroDate = null;
  for (let i = 1; i <= days; i++) {
    const d = addDays(today(), i);
    let delta = avgIn - avgOut;
    for (const b of state.bills) if (b.dueDate === d && b.status !== 'paid') delta -= Number(b.amount) || 0;
    bal = money(bal + delta);
    if (bal < 0 && !zeroDate) zeroDate = d;
    out.push({ key: d, value: bal });
  }
  const burn = money(avgOut - avgIn);
  return { series: out, zeroDate, burn, runwayDays: burn > 0 ? Math.floor(start / burn) : Infinity, start };
}
function totalLiquid() {
  const bals = new Map(state.accounts.map(a => [a.id, Number(a.openingBalance) || 0]));
  for (const t of state.transactions) {
    if (t.type === 'income') bals.set(t.accountId, (bals.get(t.accountId) || 0) + t.base);
    else if (t.type === 'expense') bals.set(t.accountId, (bals.get(t.accountId) || 0) - t.base);
    else if (t.type === 'transfer') { bals.set(t.accountId, (bals.get(t.accountId) || 0) - t.base); bals.set(t.toAccountId, (bals.get(t.toAccountId) || 0) + t.base); }
  }
  return money(state.accounts.filter(a => !a.archived && a.type !== 'card').reduce((s, a) => s + (bals.get(a.id) || 0), 0));
}

/* ═══════════ 3. ANOMALY / FRAUD DETECTION ═══════════ */

/**
 * Robust per-category outlier detection using the modified z-score
 * (median + MAD), which — unlike mean/σ — is not dragged around by
 * the very outliers we are hunting for.
 */
export function anomalies({ lookbackMonths = 12, threshold = 3.5, limit = 12 } = {}) {
  const from = addMonths(today(), -lookbackMonths);
  const txns = state.transactions.filter(t => t.type === 'expense' && t.date >= from);
  const out = [];
  for (const [catId, rows] of groupBy(txns, t => t.categoryId)) {
    if (rows.length < 6) continue;
    const vals = rows.map(r => r.base);
    const med = median(vals);
    const mad = median(vals.map(v => Math.abs(v - med))) || 1e-9;
    for (const t of rows) {
      const z = (0.6745 * (t.base - med)) / mad;
      if (z > threshold && t.base > med * 2) {
        out.push({ txn: t, z: Math.round(z * 10) / 10, median: money(med), catId,
          reason: `${fmtMoney(t.base)} is ${(t.base / (med || 1)).toFixed(1)}× your typical ${catName(catId)} spend (${fmtMoney(med)})` });
      }
    }
  }
  // duplicate detection: same amount + category within 3 days
  const seen = new Map();
  for (const t of sortBy(txns, x => x.date)) {
    const k = `${t.categoryId}|${t.base.toFixed(2)}`;
    const prev = seen.get(k);
    if (prev && Math.abs(daysBetween(prev.date, t.date)) <= 3 && prev.id !== t.id) {
      out.push({ txn: t, z: 0, duplicate: true, catId: t.categoryId,
        reason: `Possible duplicate of ${fmtMoney(prev.base)} on ${prev.date}` });
    }
    seen.set(k, t);
  }
  return sortBy(out, o => (o.duplicate ? 1e6 : o.z * 1000) + o.txn.base, -1).slice(0, limit);
}

/* ═══════════ 4. FINANCIAL HEALTH SCORE ═══════════ */

/**
 * Weighted 0–100 score across six pillars, each independently
 * explainable so the user can see exactly what to improve.
 */
export function healthScore() {
  const m = period('month');
  const last6 = monthlySeries(6);
  const closed = last6.slice(0, -1);                    // exclude the partial current month
  const avgIncome = mean(closed.map(x => x.income)) || 0;
  const avgExpense = mean(closed.map(x => x.expense)) || 0;
  const nw = netWorth();
  const liquid = totalLiquid();
  const credit = creditTotals();
  const loans = loanTotals();

  const pillars = [];
  const push = (key, label, score, weight, detail) =>
    pillars.push({ key, label, score: Math.max(0, Math.min(100, Math.round(score))), weight, detail });

  // savings rate
  const savingsRate = avgIncome ? ((avgIncome - avgExpense) / avgIncome) * 100 : 0;
  push('savings', 'Savings rate', savingsRate <= 0 ? 0 : Math.min(100, (savingsRate / 25) * 100), 0.24,
    `${savingsRate.toFixed(1)}% of income kept over the last ${closed.length || 1} closed month(s)`);

  // emergency runway
  const monthsCover = avgExpense ? liquid / avgExpense : (liquid > 0 ? 6 : 0);
  push('runway', 'Emergency fund', Math.min(100, (monthsCover / 6) * 100), 0.2,
    `${monthsCover.toFixed(1)} months of expenses in liquid accounts`);

  // debt load
  const debt = loans.outstanding + credit.payable;
  const dti = avgIncome ? (loans.monthly / avgIncome) * 100 : (debt ? 60 : 0);
  push('debt', 'Debt burden', debt === 0 ? 100 : Math.max(0, 100 - (dti / 36) * 100), 0.18,
    debt ? `${dti.toFixed(0)}% of income goes to debt service · ${fmtMoney(debt)} outstanding` : 'No outstanding debt');

  // budget discipline
  const budgets = state.budgets.map(b => budgetStatus(b));
  const kept = budgets.filter(b => !b.over).length;
  push('budget', 'Budget discipline', budgets.length ? (kept / budgets.length) * 100 : 55, 0.13,
    budgets.length ? `${kept}/${budgets.length} budgets within limit` : 'No budgets set yet — add one to score here');

  // spending consistency (lower volatility = better)
  const cv = avgExpense ? stdev(closed.map(x => x.expense)) / avgExpense : 0;
  push('stability', 'Spending stability', Math.max(0, 100 - cv * 180), 0.1,
    `Month-to-month expense variation ${(cv * 100).toFixed(0)}%`);

  // net worth trajectory
  const growth = last6.length > 1 ? last6.reduce((a, x) => a + x.net, 0) : 0;
  push('growth', 'Net worth trend', nw.total <= 0 ? (growth > 0 ? 45 : 15) : Math.min(100, 55 + (growth > 0 ? 45 : -35)), 0.15,
    `${growth >= 0 ? 'Positive' : 'Negative'} cumulative cash flow of ${fmtMoney(growth)} over 6 months`);

  const total = Math.round(pillars.reduce((s, p) => s + p.score * p.weight, 0));
  const grade = total >= 85 ? 'Excellent' : total >= 70 ? 'Strong' : total >= 55 ? 'Fair' : total >= 40 ? 'At risk' : 'Critical';
  void m;
  return { score: total, grade, pillars, savingsRate, monthsCover, avgIncome, avgExpense, liquid, netWorth: nw };
}

/* ═══════════ 5. INSIGHTS & RECOMMENDATIONS ═══════════ */

export function insights({ limit = 8 } = {}) {
  const out = [];
  const add = (level, title, body, action) => out.push({ level, title, body, action });
  const cur = period('month'), prev = period('lastmonth');
  const curExp = txnsIn(cur.from, cur.to, { type: 'expense' });
  const prevExp = txnsIn(prev.from, prev.to, { type: 'expense' });
  const curTotal = money(curExp.reduce((a, t) => a + t.base, 0));
  const prevTotal = money(prevExp.reduce((a, t) => a + t.base, 0));

  // month-over-month category swings
  const byCatCur = groupBy(curExp, t => t.categoryId);
  const byCatPrev = groupBy(prevExp, t => t.categoryId);
  const swings = [];
  for (const [cid, rows] of byCatCur) {
    const now = money(rows.reduce((a, t) => a + t.base, 0));
    const before = money((byCatPrev.get(cid) || []).reduce((a, t) => a + t.base, 0));
    if (before > 0 && now > before * 1.4 && now - before > 20) swings.push({ cid, now, before, delta: now - before });
  }
  sortBy(swings, x => x.delta, -1).slice(0, 2).forEach(s0 =>
    add('warn', `${catName(s0.cid)} spending jumped ${Math.round(((s0.now - s0.before) / s0.before) * 100)}%`,
      `${fmtMoney(s0.now)} this month vs ${fmtMoney(s0.before)} last month. That is ${fmtMoney(s0.delta)} of extra outflow.`,
      { label: 'Review category', route: '#/tracker' }));

  // budget risk
  for (const b of state.budgets) {
    const s0 = budgetStatus(b);
    const name = b.categoryId === '*' ? 'Overall' : catName(b.categoryId);
    if (s0.over) add('neg', `${name} budget exceeded`, `Spent ${fmtMoney(s0.spent)} against a ${fmtMoney(s0.limit)} limit — ${fmtMoney(-s0.remaining)} over.`, { label: 'Adjust budget', route: '#/budget' });
    else if (s0.atRisk) add('warn', `${name} budget pacing high`, `You are ${Math.round(s0.pct)}% through the budget but only ${Math.round(s0.pace)}% through the period. Projected: ${fmtMoney(s0.projected)}.`, { label: 'See budgets', route: '#/budget' });
  }

  // subscriptions creep
  const subs = state.transactions.filter(t => t.type === 'expense' && catName(t.categoryId) === 'Subscription' && t.date >= addMonths(today(), -1));
  if (subs.length >= 3) {
    const total = money(subs.reduce((a, t) => a + t.base, 0));
    add('info', `${subs.length} subscription charges last month`, `${fmtMoney(total)} recurring — roughly ${fmtMoney(total * 12)} a year. Cancelling the two smallest would save ${fmtMoney(sortBy(subs, t => t.base).slice(0, 2).reduce((a, t) => a + t.base, 0) * 12)} annually.`, { label: 'View recurring', route: '#/tracker' });
  }

  // overdue receivables
  const ct = creditTotals();
  if (ct.overdueCount) add('neg', `${ct.overdueCount} overdue receivable${ct.overdueCount > 1 ? 's' : ''}`,
    `${fmtMoney(ct.overdue)} is past its due date. Collecting it would lift your cash position immediately.`, { label: 'Open credit book', route: '#/credit' });

  // idle cash
  const hs = healthScore();
  if (hs.monthsCover > 9 && portfolio().current < hs.liquid * 0.5)
    add('pos', 'Idle cash detected', `You hold ${hs.monthsCover.toFixed(1)} months of expenses in cash. Beyond a 6-month buffer, ${fmtMoney(hs.liquid - hs.avgExpense * 6)} could be deployed into your investment portfolio.`, { label: 'Investments', route: '#/investments' });
  if (hs.monthsCover < 3 && hs.avgExpense > 0)
    add('warn', 'Emergency fund below 3 months', `Liquid reserves cover ${hs.monthsCover.toFixed(1)} months. Target ${fmtMoney(hs.avgExpense * 6)} for a 6-month cushion.`, { label: 'Create goal', route: '#/goals' });

  // marketing efficiency
  for (const c of state.campaigns.filter(c => c.status === 'active')) {
    const m = campaignRoas(c);
    if (m && m.spend > 50 && m.roas < 1) add('neg', `${c.name} is losing money`,
      `ROAS ${m.roas.toFixed(2)}× — ${fmtMoney(m.spend)} spent returned ${fmtMoney(m.revenue)}. Pause or rework the creative.`, { label: 'Open campaign', route: '#/marketing' });
    else if (m && m.roas >= 3 && m.utilisation < 70) add('pos', `${c.name} is outperforming`,
      `ROAS ${m.roas.toFixed(2)}× with only ${Math.round(m.utilisation)}% of budget used. Scaling spend is likely profitable.`, { label: 'Open campaign', route: '#/marketing' });
  }

  // anomalies
  anomalies({ limit: 2 }).forEach(a => add('warn', a.duplicate ? 'Possible duplicate charge' : 'Unusual transaction',
    `${a.reason}${a.txn.notes ? ` · “${a.txn.notes}”` : ''}`, { label: 'Review', route: '#/tracker' }));

  // trend summary
  if (prevTotal > 0) {
    const pct = ((curTotal - prevTotal) / prevTotal) * 100;
    if (Math.abs(pct) > 8) add(pct < 0 ? 'pos' : 'warn', `Total spending ${pct < 0 ? 'down' : 'up'} ${Math.abs(pct).toFixed(0)}% this month`,
      `${fmtMoney(curTotal)} so far versus ${fmtMoney(prevTotal)} in the same period last month.`);
  }
  return out.slice(0, limit);
}
function campaignRoas(c) {
  const days = state.campaignDays.filter(d => d.campaignId === c.id);
  const spend = money(days.reduce((a, d) => a + (d.spend || 0), 0) + (Number(c.baseSpend) || 0));
  const revenue = money(days.reduce((a, d) => a + (d.revenue || 0), 0) + (Number(c.baseRevenue) || 0));
  if (!spend) return null;
  return { spend, revenue, roas: revenue / spend, utilisation: c.budget ? (spend / c.budget) * 100 : 0 };
}

/* ═══════════ 6. BUDGET OPTIMISER ═══════════ */

/** Suggest per-category limits from 3-month trimmed averages. */
export function suggestBudgets({ months = 3, savingsTargetPct = 20 } = {}) {
  const from = startOfMonth(addMonths(today(), -months));
  const to = endOfMonth(addMonths(today(), -1));
  const txns = txnsIn(from, to, { type: 'expense' });
  const hist = monthlySeries(months + 1).slice(0, -1);
  const avgIncome = mean(hist.map(h => h.income));
  const rows = [];
  for (const [cid, list0] of groupBy(txns, t => t.categoryId)) {
    const perMonth = [...groupBy(list0, t => t.month).values()].map(g => money(g.reduce((a, t) => a + t.base, 0)));
    const typical = median(perMonth.length ? perMonth : [0]);
    const cat = find('categories', cid);
    if (!cat) continue;
    rows.push({ categoryId: cid, name: cat.name, color: cat.color, typical: money(typical),
      max: money(Math.max(...perMonth, 0)), suggested: money(Math.ceil(typical * 1.05 / 5) * 5), months: perMonth.length });
  }
  const sorted = sortBy(rows, r => r.typical, -1);
  const totalSuggested = money(sorted.reduce((a, r) => a + r.suggested, 0));
  const targetSpend = avgIncome ? money(avgIncome * (1 - savingsTargetPct / 100)) : totalSuggested;
  const scale = totalSuggested > targetSpend && targetSpend > 0 ? targetSpend / totalSuggested : 1;
  return {
    rows: sorted.map(r => ({ ...r, suggested: money(r.suggested * scale),
      cut: scale < 1 ? money(r.suggested * (1 - scale)) : 0 })),
    avgIncome: money(avgIncome), targetSpend, totalSuggested, needsCut: scale < 1,
    savingsTargetPct,
  };
}

/* ═══════════ 7. SPENDING HABITS ═══════════ */

export function habits({ months = 6 } = {}) {
  const from = startOfMonth(addMonths(today(), -(months - 1)));
  const txns = txnsIn(from, today(), { type: 'expense' });
  const byDow = new Array(7).fill(0), cntDow = new Array(7).fill(0);
  const byDom = new Array(31).fill(0);
  for (const t of txns) {
    const d = parseISO(t.date);
    byDow[d.getDay()] += t.base; cntDow[d.getDay()]++;
    byDom[d.getDate() - 1] += t.base;
  }
  const topDow = byDow.indexOf(Math.max(...byDow));
  const merchants = new Map();
  for (const t of txns) {
    const key = (t.merchant || t.notes || '').trim().toLowerCase().slice(0, 40);
    if (!key) continue;
    const r = merchants.get(key) || { label: (t.merchant || t.notes).slice(0, 40), count: 0, total: 0 };
    r.count++; r.total = money(r.total + t.base);
    merchants.set(key, r);
  }
  const avgTxn = txns.length ? money(txns.reduce((a, t) => a + t.base, 0) / txns.length) : 0;
  const smallOnes = txns.filter(t => t.base < avgTxn * 0.35);
  return {
    byDow, cntDow, byDom, topDow,
    topMerchants: sortBy([...merchants.values()], m => m.total, -1).slice(0, 8),
    avgTxn, txnCount: txns.length,
    perDay: money(txns.reduce((a, t) => a + t.base, 0) / Math.max(1, daysBetween(from, today()) + 1)),
    smallSpendTotal: money(smallOnes.reduce((a, t) => a + t.base, 0)), smallSpendCount: smallOnes.length,
  };
}

/* ═══════════ 8. NATURAL-LANGUAGE QUERY ═══════════ */

const PERIOD_WORDS = [
  [/\b(today)\b/, 'today'], [/\b(yesterday)\b/, 'yesterday'],
  [/\blast month\b/, 'lastmonth'], [/\bthis month\b/, 'month'],
  [/\blast week\b/, 'lastweek'], [/\bthis week\b/, 'week'],
  [/\blast year\b/, 'lastyear'], [/\bthis year\b/, 'year'],
  [/\blast 30 days?\b|\bpast 30 days?\b/, '30d'], [/\blast 90 days?\b/, '90d'],
  [/\blast 12 months?\b|\bpast year\b/, '12m'], [/\bquarter\b/, 'quarter'],
  [/\ball time\b|\bever\b|\btotal\b/, 'all'],
];

/**
 * Parse a plain-English money question into a structured answer.
 * Handles: "how much did I spend on food last month",
 *          "income this year", "biggest expense", "top categories 90 days".
 */
export function nlQuery(q) {
  const text = String(q || '').toLowerCase().trim();
  if (!text) return null;
  const isMoneyQ = /\b(how much|spend|spent|earn|earned|income|expense|total|average|avg|biggest|largest|top|most)\b/.test(text);
  if (!isMoneyQ) return null;

  let periodKey = 'month';
  for (const [re, key] of PERIOD_WORDS) if (re.test(text)) { periodKey = key; break; }
  const p = period(periodKey);

  const type = /\b(earn|earned|income|received|revenue)\b/.test(text) ? 'income'
    : /\b(spend|spent|expense|cost|paid|outflow)\b/.test(text) ? 'expense' : null;

  // category match
  let category = null;
  for (const c of state.categories) {
    const n = c.name.toLowerCase();
    if (n.length > 2 && (text.includes(n) || text.includes(n.replace(/\s/g, '')))) { category = c; break; }
  }
  const rows = txnsIn(p.from, p.to, { type: type || undefined, categoryId: category?.id });
  const total = money(rows.reduce((a, t) => a + t.base, 0));

  if (/\b(biggest|largest|most expensive|highest)\b/.test(text)) {
    const top = sortBy(rows, t => t.base, -1)[0];
    return { kind: 'txn', label: `Largest ${type || 'transaction'}${category ? ` in ${category.name}` : ''} · ${p.label}`,
      value: top ? fmtMoney(top.base) : '—', detail: top ? `${top.notes || catName(top.categoryId)} on ${top.date}` : 'No matching transactions',
      rows: top ? [top] : [], period: p, type, category };
  }
  if (/\btop\b|\bcategories\b|\bbreakdown\b/.test(text)) {
    // "top categories" without an explicit verb means spending — mixing income
    // in would produce a list headed by Salary, which is never what was asked.
    const kind = type || 'expense';
    const scoped = type ? rows : txnsIn(p.from, p.to, { type: kind, categoryId: category?.id });
    const scopedTotal = money(scoped.reduce((a, t) => a + t.base, 0));
    const g = sortBy([...groupBy(scoped, t => t.categoryId)].map(([cid, r]) =>
      ({ label: catName(cid), value: money(r.reduce((a, t) => a + t.base, 0)) })), x => x.value, -1).slice(0, 5);
    return { kind: 'breakdown', label: `Top ${kind === 'income' ? 'income' : 'spending'} categories · ${p.label}`,
      value: fmtMoney(scopedTotal), detail: g.map(x => `${x.label} ${fmtMoney(x.value)}`).join(' · '),
      breakdown: g, rows: scoped, period: p, type: kind, category };
  }
  if (/\baverage|avg\b/.test(text)) {
    const avg = rows.length ? money(total / rows.length) : 0;
    return { kind: 'sum', label: `Average ${type || 'transaction'}${category ? ` · ${category.name}` : ''} · ${p.label}`,
      value: fmtMoney(avg), detail: `${rows.length} transactions totalling ${fmtMoney(total)}`, rows, period: p, type, category };
  }
  return {
    kind: 'sum',
    label: `${type === 'income' ? 'Income' : type === 'expense' ? 'Spending' : 'Net activity'}${category ? ` on ${category.name}` : ''} · ${p.label}`,
    value: fmtMoney(total),
    detail: `${rows.length} transaction${rows.length === 1 ? '' : 's'} between ${p.from} and ${p.to}`,
    rows, period: p, type, category,
  };
}

/* ═══════════ 9. MONTHLY NARRATIVE REPORT ═══════════ */

/** Generates a written monthly review from the data — templated, not hallucinated. */
export function monthlyNarrative(mk = monthKey(today())) {
  const from = `${mk}-01`, to = endOfMonth(from);
  const prevFrom = startOfMonth(addMonths(from, -1)), prevTo = endOfMonth(prevFrom);
  const inc = money(txnsIn(from, to, { type: 'income' }).reduce((a, t) => a + t.base, 0));
  const exp = money(txnsIn(from, to, { type: 'expense' }).reduce((a, t) => a + t.base, 0));
  const pInc = money(txnsIn(prevFrom, prevTo, { type: 'income' }).reduce((a, t) => a + t.base, 0));
  const pExp = money(txnsIn(prevFrom, prevTo, { type: 'expense' }).reduce((a, t) => a + t.base, 0));
  const net = money(inc - exp);
  const rate = inc ? (net / inc) * 100 : 0;
  const cats = sortBy([...groupBy(txnsIn(from, to, { type: 'expense' }), t => t.categoryId)]
    .map(([cid, r]) => ({ name: catName(cid), value: money(r.reduce((a, t) => a + t.base, 0)) })), x => x.value, -1);
  const topCat = cats[0];
  const dExp = pExp ? ((exp - pExp) / pExp) * 100 : 0;
  const dInc = pInc ? ((inc - pInc) / pInc) * 100 : 0;
  const hs = healthScore();
  const paras = [];
  paras.push(`In ${mk}, you brought in ${fmtMoney(inc)} and spent ${fmtMoney(exp)}, leaving a ${net >= 0 ? 'surplus' : 'shortfall'} of ${fmtMoney(Math.abs(net))} — a savings rate of ${rate.toFixed(1)}%.`);
  if (pExp) paras.push(`Spending was ${Math.abs(dExp).toFixed(0)}% ${dExp >= 0 ? 'higher' : 'lower'} than the previous month, while income moved ${Math.abs(dInc).toFixed(0)}% ${dInc >= 0 ? 'up' : 'down'}.`);
  if (topCat) paras.push(`Your largest category was ${topCat.name} at ${fmtMoney(topCat.value)} (${((topCat.value / (exp || 1)) * 100).toFixed(0)}% of all spending)${cats[1] ? `, followed by ${cats[1].name} at ${fmtMoney(cats[1].value)}` : ''}.`);
  const anom = anomalies({ limit: 1 })[0];
  if (anom) paras.push(`One transaction stood out: ${anom.reason}.`);
  paras.push(`Your financial health score is ${hs.score}/100 (${hs.grade}). ${sortBy(hs.pillars, p => p.score)[0].label} is the weakest pillar — ${sortBy(hs.pillars, p => p.score)[0].detail.toLowerCase()}.`);
  const f = forecast(1);
  if (f.months[0]) paras.push(`Looking ahead, the model projects ${fmtMoney(f.months[0].income)} income against ${fmtMoney(f.months[0].expense)} of expenses next month (${f.confidence}% confidence).`);
  return { month: mk, income: inc, expense: exp, net, rate, categories: cats, paragraphs: paras, health: hs };
}

export { uniq, iso };
