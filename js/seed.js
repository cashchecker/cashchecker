/* ═══════════ seed.js — starter + demo workspaces ═══════════ */

import * as store from './store.js';
import { state, settings } from './store.js';
import {
  uid, today, iso, addDays, addMonths, startOfMonth, endOfMonth, money, parseISO, pad2, monthKey,
  nextOccurrence, colorFor,
} from './util.js';

/* deterministic PRNG so the demo looks the same every time */
let _s = 20260729;
const rnd = () => { _s = (_s * 1664525 + 1013904223) % 4294967296; return _s / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const between = (a, b) => money(a + rnd() * (b - a));
const int = (a, b) => Math.floor(a + rnd() * (b - a + 1));

/* ═══════════ starter: accounts + categories ═══════════ */
export async function seedStarterData({ cash = 0, bank = 0 } = {}) {
  if (!state.accounts.length) {
    await store.saveMany('accounts', [
      { name: 'Cash', type: 'cash', openingBalance: cash, color: '#10b981', currency: settings.baseCurrency },
      { name: 'Bank Account', type: 'bank', openingBalance: bank, color: '#7c5cff', currency: settings.baseCurrency },
    ], { auditIt: false });
  }
  if (!state.categories.length) {
    await store.saveMany('categories', [
      ...store.SEED_INCOME_CATEGORIES.map(([name, color]) => ({ name, color, kind: 'income' })),
      ...store.SEED_EXPENSE_CATEGORIES.map(([name, color]) => ({ name, color, kind: 'expense' })),
    ], { auditIt: false });
  }
  await store.audit('setup', 'system', '', 'Starter workspace created');
}

/**
 * Installs the two-level category taxonomy: attaches an emoji to each
 * top-level category and creates its sub-categories. Idempotent — existing
 * categories are reused and nothing is duplicated, so it is safe to re-run.
 */
export async function seedCategoryTree() {
  let added = 0, tagged = 0;
  const trees = [['expense', store.SEED_EXPENSE_TREE], ['income', store.SEED_INCOME_TREE]];

  for (const [kind, tree] of trees) {
    for (const [parentName, emoji, subs] of tree) {
      let parent = state.categories.find(c =>
        c.kind === kind && !c.parentId && c.name.toLowerCase() === parentName.toLowerCase());

      if (!parent) {
        parent = await store.save('categories',
          { name: parentName, kind, icon: emoji, color: colorFor(parentName) },
          { silent: true, auditIt: false });
        added++;
      } else if (!parent.icon) {
        parent = await store.save('categories', { ...parent, icon: emoji }, { silent: true, auditIt: false });
        tagged++;
      }

      for (const sub of subs) {
        const exists = state.categories.some(c =>
          c.parentId === parent.id && c.name.toLowerCase() === sub.toLowerCase());
        if (exists) continue;
        await store.save('categories',
          { name: sub, kind, parentId: parent.id, icon: emoji, color: parent.color },
          { silent: true, auditIt: false });
        added++;
      }
    }
  }
  await store.audit('setup', 'categories', '', `${added} categories added, ${tagged} icons set`);
  store.bus.emit('change', { store: 'categories', action: 'tree' });
  return { added, tagged };
}

/* ═══════════ demo workspace ═══════════ */
export async function seedDemoData() {
  _s = 20260729;
  const cat = name => state.categories.find(c => c.name === name)?.id;
  const acc = name => state.accounts.find(a => a.name === name)?.id;

  /* accounts */
  const extra = [
    { name: 'Business Account', type: 'business', openingBalance: 18400, color: '#22d3ee', currency: settings.baseCurrency },
    { name: 'Credit Card', type: 'card', openingBalance: -1250, color: '#f43f5e', currency: settings.baseCurrency, creditLimit: 8000 },
    { name: 'Savings', type: 'savings', openingBalance: 26000, color: '#34d399', currency: settings.baseCurrency },
    { name: 'Mobile Wallet', type: 'wallet', openingBalance: 640, color: '#f59e0b', currency: settings.baseCurrency },
  ].filter(a => !state.accounts.some(x => x.name === a.name));
  if (extra.length) await store.saveMany('accounts', extra, { auditIt: false });

  const accounts = { cash: acc('Cash'), bank: acc('Bank Account'), biz: acc('Business Account'),
    card: acc('Credit Card'), save: acc('Savings'), wallet: acc('Mobile Wallet') };

  /* ---------- 14 months of transactions ---------- */
  const start = startOfMonth(addMonths(today(), -13));
  const txns = [];
  const merchants = {
    Food: ['Cafe Mocha', 'Spice Route', 'Burger Lab', 'Sushi Bar', 'The Coffee House', 'Street Grill'],
    Grocery: ['Metro Cash & Carry', 'FreshMart', 'GreenGrocer', 'Hyper Star'],
    Fuel: ['Shell Station', 'Total Energies', 'PSO Pump'],
    Shopping: ['Amazon', 'Zara', 'Decathlon', 'Nike Store', 'Daraz'],
    Travel: ['Uber', 'Careem', 'Emirates', 'Airbnb', 'Booking.com'],
    Entertainment: ['Cineplex', 'Steam', 'Spotify Live', 'Bowling Alley'],
    Healthcare: ['City Pharmacy', 'Wellness Clinic', 'Dental Care'],
    Subscription: ['Netflix', 'Spotify', 'Adobe CC', 'iCloud', 'ChatGPT Plus', 'Figma'],
    'Digital Marketing': ['Meta Ads Manager', 'Google Ads', 'TikTok for Business'],
    Education: ['Udemy', 'Coursera', 'Book Depot'],
  };
  const push = (o) => txns.push({ ...o, currency: settings.baseCurrency, rate: 1, status: 'cleared', tags: o.tags || [] });

  let d = start;
  let monthIdx = 0;
  while (d <= today()) {
    const mStart = startOfMonth(d);
    const growth = 1 + monthIdx * 0.012;               // gentle upward drift
    const seasonal = 1 + (parseISO(mStart).getMonth() === 11 ? 0.28 : parseISO(mStart).getMonth() === 6 ? 0.12 : 0);

    /* income */
    push({ type: 'income', amount: money(4200 * growth), accountId: accounts.bank, categoryId: cat('Salary'),
      date: `${monthKey(mStart)}-01`, time: '09:15', notes: 'Monthly salary credit', merchant: 'Acme Corp Payroll', paymentMethod: 'Bank Transfer' });
    if (rnd() > 0.25) push({ type: 'income', amount: between(600, 2600), accountId: accounts.biz, categoryId: cat('Freelance'),
      date: addDays(mStart, int(6, 22)), time: '14:30', notes: pick(['Client retainer — Nexus', 'Website build milestone', 'Upwork contract payout', 'Fiverr order batch']), merchant: pick(['Upwork', 'Nexus Digital', 'Fiverr']), paymentMethod: 'Bank Transfer' });
    if (rnd() > 0.55) push({ type: 'income', amount: between(200, 900), accountId: accounts.bank, categoryId: cat('Rental Income'),
      date: addDays(mStart, 5), notes: 'Apartment rent received', merchant: 'Tenant — Flat 3B', paymentMethod: 'Bank Transfer' });
    if (rnd() > 0.7) push({ type: 'income', amount: between(60, 420), accountId: accounts.bank, categoryId: cat('Investment Profit'),
      date: addDays(mStart, int(10, 26)), notes: 'Dividend payout', merchant: 'Broker Dividend' });
    if (rnd() > 0.85) push({ type: 'income', amount: between(15, 90), accountId: accounts.card, categoryId: cat('Cashback'),
      date: addDays(mStart, int(2, 26)), notes: 'Card cashback reward', merchant: 'Card Rewards' });

    /* fixed monthly outflows */
    push({ type: 'expense', amount: 1150, accountId: accounts.bank, categoryId: cat('Rent'), date: addDays(mStart, 2),
      notes: 'House rent', merchant: 'Landlord', paymentMethod: 'Bank Transfer', tags: ['fixed'] });
    push({ type: 'expense', amount: between(85, 190), accountId: accounts.bank, categoryId: cat('Electricity'),
      date: addDays(mStart, 9), notes: 'Electricity bill', merchant: 'City Power', tags: ['utility'] });
    push({ type: 'expense', amount: between(38, 52), accountId: accounts.bank, categoryId: cat('Internet'),
      date: addDays(mStart, 7), notes: 'Fibre broadband', merchant: 'FiberNet', tags: ['utility'] });
    push({ type: 'expense', amount: between(18, 34), accountId: accounts.wallet, categoryId: cat('Mobile Recharge'),
      date: addDays(mStart, 11), notes: 'Mobile package', merchant: 'Telco' });
    push({ type: 'expense', amount: between(24, 78), accountId: accounts.card, categoryId: cat('Subscription'),
      date: addDays(mStart, 14), notes: pick(merchants.Subscription) + ' subscription', merchant: pick(merchants.Subscription), tags: ['recurring'] });
    push({ type: 'expense', amount: 620, accountId: accounts.bank, categoryId: cat('EMI'), date: addDays(mStart, 5),
      notes: 'Car loan instalment', merchant: 'AutoFinance Bank', tags: ['fixed'] });

    /* variable daily spend */
    const days = int(26, 34);
    for (let i = 0; i < days; i++) {
      const day = addDays(mStart, int(0, 27));
      if (day > today()) continue;
      const r = rnd();
      let cname, amt, account;
      if (r < 0.3)      { cname = 'Food'; amt = between(6, 42) * seasonal; account = pick([accounts.cash, accounts.card, accounts.wallet]); }
      else if (r < 0.48){ cname = 'Grocery'; amt = between(20, 130) * seasonal; account = accounts.card; }
      else if (r < 0.6) { cname = 'Fuel'; amt = between(28, 75); account = accounts.cash; }
      else if (r < 0.7) { cname = 'Shopping'; amt = between(18, 260) * seasonal; account = accounts.card; }
      else if (r < 0.78){ cname = 'Travel'; amt = between(8, 190); account = pick([accounts.card, accounts.wallet]); }
      else if (r < 0.84){ cname = 'Entertainment'; amt = between(10, 85); account = accounts.card; }
      else if (r < 0.89){ cname = 'Healthcare'; amt = between(12, 220); account = accounts.bank; }
      else if (r < 0.93){ cname = 'Education'; amt = between(15, 190); account = accounts.bank; }
      else if (r < 0.96){ cname = 'Family'; amt = between(30, 260); account = accounts.cash; }
      else              { cname = 'Charity'; amt = between(20, 150); account = accounts.cash; }
      const mlist = merchants[cname];
      push({ type: 'expense', amount: money(amt), accountId: account, categoryId: cat(cname), date: day,
        time: `${pad2(int(8, 21))}:${pad2(int(0, 59))}`, notes: mlist ? `${pick(mlist)}` : cname,
        merchant: mlist ? pick(mlist) : undefined,
        paymentMethod: account === accounts.cash ? 'Cash' : account === accounts.card ? 'Credit Card' : 'Mobile Wallet' });
    }

    /* business + marketing */
    push({ type: 'expense', amount: between(280, 1400), accountId: accounts.biz, categoryId: cat('Digital Marketing'),
      date: addDays(mStart, int(3, 25)), notes: pick(merchants['Digital Marketing']) + ' spend', merchant: pick(merchants['Digital Marketing']), tags: ['marketing'] });
    if (rnd() > 0.5) push({ type: 'expense', amount: between(120, 900), accountId: accounts.biz, categoryId: cat('Business'),
      date: addDays(mStart, int(3, 25)), notes: 'Inventory restock', merchant: 'Wholesale Supplier' });

    /* transfer to savings */
    if (rnd() > 0.25) push({ type: 'transfer', amount: between(300, 900), accountId: accounts.bank,
      toAccountId: accounts.save, date: addDays(mStart, 26), notes: 'Monthly savings sweep' });

    d = addMonths(d, 1);
    monthIdx++;
  }
  // one deliberate anomaly so the detector has something real to find
  push({ type: 'expense', amount: 1890, accountId: accounts.card, categoryId: cat('Shopping'),
    date: addDays(today(), -12), notes: 'Laptop purchase — MacBook Pro', merchant: 'Apple Store', tags: ['big-ticket'] });

  await store.saveMany('transactions', txns.filter(t => t.date <= today() && t.categoryId !== undefined), { auditIt: false });

  /* ---------- credit book ---------- */
  const contacts = await store.saveMany('contacts', [
    { name: 'Rashid Traders', phone: '+92 300 1234567', address: 'Shop 14, Main Market, Lahore', notes: 'Wholesale fabric buyer' },
    { name: 'Amina Khan', phone: '+92 321 9876543', address: 'DHA Phase 5', notes: 'Regular retail customer' },
    { name: 'Bright Steel Co.', phone: '+92 42 35678900', address: 'Industrial Estate, Sector 7', notes: 'B2B account, 30-day terms' },
    { name: 'Faisal Auto Parts', phone: '+92 333 4567890', address: 'Bund Road', notes: '' },
    { name: 'Zainab Boutique', phone: '+92 301 2223344', address: 'Gulberg III', notes: 'Pays weekly' },
  ], { auditIt: false });

  const credits = await store.saveMany('credits', [
    { contactId: contacts[0].id, direction: 'given', amount: 4800, date: addDays(today(), -52), dueDate: addDays(today(), -8),
      interestRate: 0, notes: 'Fabric consignment — invoice #1042', status: 'open' },
    { contactId: contacts[1].id, direction: 'given', amount: 950, date: addDays(today(), -21), dueDate: addDays(today(), 9),
      interestRate: 0, notes: 'Retail credit', status: 'open' },
    { contactId: contacts[2].id, direction: 'given', amount: 12500, date: addDays(today(), -74), dueDate: addDays(today(), 16),
      interestRate: 12, interestType: 'simple', notes: 'Bulk order — 30 day terms', status: 'open' },
    { contactId: contacts[3].id, direction: 'taken', amount: 3200, date: addDays(today(), -40), dueDate: addDays(today(), 20),
      interestRate: 0, notes: 'Short-term borrowing for stock', status: 'open' },
    { contactId: contacts[4].id, direction: 'given', amount: 1500, date: addDays(today(), -95), dueDate: addDays(today(), -35),
      interestRate: 0, notes: 'Boutique supply', status: 'open' },
  ], { auditIt: false });

  await store.saveMany('creditPayments', [
    { creditId: credits[0].id, amount: 1500, date: addDays(today(), -30), method: 'Bank Transfer', notes: 'Part payment' },
    { creditId: credits[0].id, amount: 800, date: addDays(today(), -12), method: 'Cash', notes: '' },
    { creditId: credits[2].id, amount: 5000, date: addDays(today(), -25), method: 'Cheque', notes: 'Cheque #88213' },
    { creditId: credits[4].id, amount: 1500, date: addDays(today(), -30), method: 'Cash', notes: 'Settled in full' },
    { creditId: credits[3].id, amount: 1000, date: addDays(today(), -10), method: 'Bank Transfer', notes: 'Repayment 1' },
  ], { auditIt: false });

  /* ---------- investments ---------- */
  const invs = await store.saveMany('investments', [
    { name: 'Downtown Apartment 3B', category: 'Real Estate', investor: 'Self', amountInvested: 68000,
      date: addMonths(today(), -26), currentValue: 79500, expAnnualPct: 8, riskLevel: 'low', status: 'active',
      notes: 'Rented out — yields monthly rental income' },
    { name: 'Index Fund Portfolio', category: 'Mutual Funds', investor: 'Self', amountInvested: 15000,
      date: addMonths(today(), -18), currentValue: 18240, expAnnualPct: 11, riskLevel: 'medium', status: 'active' },
    { name: 'Gold Bullion 200g', category: 'Gold', investor: 'Self', amountInvested: 12400,
      date: addMonths(today(), -11), currentValue: 14980, expAnnualPct: 9, riskLevel: 'low', status: 'active' },
    { name: 'BTC + ETH Position', category: 'Cryptocurrency', investor: 'Self', amountInvested: 6000,
      date: addMonths(today(), -8), currentValue: 4820, expAnnualPct: 30, riskLevel: 'speculative', status: 'active',
      notes: 'Currently under water — long horizon' },
    { name: 'Monthly SIP — Growth Fund', category: 'SIP', investor: 'Self', amountInvested: 500,
      date: addMonths(today(), -12), currentValue: 6900, expMonthlyPct: 0.9, riskLevel: 'medium', status: 'active' },
    { name: 'Bank Fixed Deposit', category: 'Fixed Deposit', investor: 'Self', amountInvested: 20000,
      date: addMonths(today(), -6), maturityDate: addDays(today(), 5), currentValue: 21100,
      expAnnualPct: 11, riskLevel: 'low', status: 'active', notes: 'Matures soon — decide renew vs withdraw' },
    { name: 'Kiosk Partnership', category: 'Business Investment', investor: 'Self + Partner', amountInvested: 9000,
      date: addMonths(today(), -14), currentValue: 11800, expMonthlyPct: 2, riskLevel: 'high', status: 'active' },
  ], { auditIt: false });

  const invTxns = [];
  for (let i = 11; i >= 1; i--) {
    invTxns.push({ investmentId: invs[4].id, type: 'buy', amount: 500, date: addMonths(today(), -i), notes: 'SIP instalment' });
  }
  for (let i = 6; i >= 1; i--) {
    invTxns.push({ investmentId: invs[0].id, type: 'return', amount: 620, date: addMonths(today(), -i), notes: 'Monthly rent' });
    if (i % 2 === 0) invTxns.push({ investmentId: invs[6].id, type: 'return', amount: 180, date: addMonths(today(), -i), notes: 'Profit share' });
  }
  await store.saveMany('investmentTxns', invTxns, { auditIt: false });

  /* ---------- marketing campaigns ---------- */
  const camps = await store.saveMany('campaigns', [
    { name: 'Winter Collection — Meta', channel: 'Meta Ads', budget: 5000, startDate: addDays(today(), -46), endDate: addDays(today(), 14), status: 'active', objective: 'Conversions', notes: 'Best performer' },
    { name: 'Search Brand Defence', channel: 'Google Ads', budget: 2400, startDate: addDays(today(), -60), endDate: addDays(today(), 30), status: 'active', objective: 'Traffic' },
    { name: 'TikTok Creator Push', channel: 'TikTok Ads', budget: 1800, startDate: addDays(today(), -28), endDate: addDays(today(), 2), status: 'active', objective: 'Awareness' },
    { name: 'Influencer — Q2 Bundle', channel: 'Influencer Marketing', budget: 3000, startDate: addDays(today(), -75), endDate: addDays(today(), -15), status: 'completed', objective: 'Reach' },
    { name: 'SEO Retainer', channel: 'SEO', budget: 1200, startDate: addDays(today(), -90), endDate: addDays(today(), 90), status: 'active', objective: 'Organic growth' },
    { name: 'Email Winback Flow', channel: 'Email Marketing', budget: 400, startDate: addDays(today(), -20), endDate: addDays(today(), 10), status: 'paused', objective: 'Retention' },
  ], { auditIt: false });

  const cdays = [];
  const profile = { 0: [1.0, 3.6], 1: [1.0, 2.4], 2: [1.0, 1.15], 3: [1.0, 2.9], 4: [1.0, 4.2], 5: [1.0, 5.5] };
  camps.forEach((c, ci) => {
    const spanStart = c.startDate, spanEnd = c.endDate < today() ? c.endDate : today();
    let dd = spanStart;
    const dailyBudget = c.budget / Math.max(1, Math.round((parseISO(c.endDate) - parseISO(c.startDate)) / 86400000));
    const [, mult] = profile[ci] || [1, 2];
    let guard = 0;
    while (dd <= spanEnd && guard++ < 200) {
      const spend = money(dailyBudget * between(0.55, 1.25));
      const impressions = Math.round(spend * between(180, 420));
      const clicks = Math.round(impressions * between(0.008, 0.035));
      const leads = Math.round(clicks * between(0.05, 0.18));
      const sales = Math.round(leads * between(0.15, 0.45));
      const revenue = money(sales * between(40, 160) * mult / 2.2);
      cdays.push({ campaignId: c.id, date: dd, spend, impressions, clicks, leads, sales, revenue });
      dd = addDays(dd, 1);
    }
  });
  await store.saveMany('campaignDays', cdays, { auditIt: false });

  /* ---------- budgets ---------- */
  await store.saveMany('budgets', [
    { categoryId: cat('Food'), scope: 'monthly', amount: 650, rollover: false },
    { categoryId: cat('Grocery'), scope: 'monthly', amount: 900, rollover: false },
    { categoryId: cat('Shopping'), scope: 'monthly', amount: 500, rollover: false },
    { categoryId: cat('Fuel'), scope: 'monthly', amount: 320, rollover: false },
    { categoryId: cat('Entertainment'), scope: 'monthly', amount: 220, rollover: false },
    { categoryId: cat('Travel'), scope: 'monthly', amount: 450, rollover: false },
    { categoryId: '*', scope: 'monthly', amount: 5200, rollover: false },
  ], { auditIt: false });

  /* ---------- goals ---------- */
  await store.saveMany('goals', [
    { name: 'Emergency Fund', target: 25000, saved: 16400, deadline: addMonths(today(), 8), icon: 'shield', color: '#10b981', priority: 'high' },
    { name: 'New Car', target: 32000, saved: 9200, deadline: addMonths(today(), 18), icon: 'wallet', color: '#7c5cff', priority: 'normal' },
    { name: 'Japan Trip', target: 6500, saved: 4150, deadline: addMonths(today(), 5), icon: 'flame', color: '#22d3ee', priority: 'normal' },
    { name: 'Home Down Payment', target: 90000, saved: 21000, deadline: addMonths(today(), 36), icon: 'home', color: '#f59e0b', priority: 'high' },
    { name: "Children's Education", target: 40000, saved: 12800, deadline: addMonths(today(), 60), icon: 'book', color: '#38bdf8', priority: 'normal' },
  ], { auditIt: false });

  /* ---------- bills ---------- */
  await store.saveMany('bills', [
    { name: 'House Rent', type: 'Rent', amount: 1150, dueDate: addDays(today(), 3), recurrence: 'monthly', status: 'unpaid', accountId: accounts.bank, categoryId: cat('Rent'), autopay: false },
    { name: 'Electricity', type: 'Utilities', amount: 142, dueDate: addDays(today(), 8), recurrence: 'monthly', status: 'unpaid', accountId: accounts.bank, categoryId: cat('Electricity') },
    { name: 'Car Loan EMI', type: 'EMI', amount: 620, dueDate: addDays(today(), 5), recurrence: 'monthly', status: 'unpaid', accountId: accounts.bank, categoryId: cat('EMI'), autopay: true },
    { name: 'Health Insurance', type: 'Insurance', amount: 210, dueDate: addDays(today(), 19), recurrence: 'monthly', status: 'unpaid', accountId: accounts.bank, categoryId: cat('Insurance') },
    { name: 'Internet — FiberNet', type: 'Utilities', amount: 45, dueDate: addDays(today(), -2), recurrence: 'monthly', status: 'unpaid', accountId: accounts.bank, categoryId: cat('Internet') },
    { name: 'Netflix', type: 'Subscription', amount: 15.99, dueDate: addDays(today(), 11), recurrence: 'monthly', status: 'unpaid', accountId: accounts.card, categoryId: cat('Subscription'), autopay: true },
    { name: 'Credit Card Statement', type: 'Credit Card', amount: 1840, dueDate: addDays(today(), 14), recurrence: 'monthly', status: 'unpaid', accountId: accounts.bank, categoryId: cat('Other Expense') },
    { name: 'Property Tax', type: 'Utilities', amount: 890, dueDate: addDays(today(), 42), recurrence: 'yearly', status: 'unpaid', accountId: accounts.bank, categoryId: cat('Taxes') },
  ], { auditIt: false });

  /* ---------- loans ---------- */
  const loans = await store.saveMany('loans', [
    { name: 'Car Loan', lender: 'AutoFinance Bank', principal: 28000, rate: 9.5, termMonths: 60,
      startDate: addMonths(today(), -22), type: 'auto', status: 'active', accountId: accounts.bank },
    { name: 'Business Expansion Loan', lender: 'Meezan Business', principal: 45000, rate: 13, termMonths: 48,
      startDate: addMonths(today(), -9), type: 'business', status: 'active', accountId: accounts.biz },
  ], { auditIt: false });
  const lp = [];
  loans.forEach(l => {
    const monthly = (l.principal * (l.rate / 1200) * Math.pow(1 + l.rate / 1200, l.termMonths)) / (Math.pow(1 + l.rate / 1200, l.termMonths) - 1);
    let bal = l.principal;
    const paidCount = Math.min(l.termMonths, Math.max(0, Math.floor((parseISO(today()) - parseISO(l.startDate)) / (30.44 * 86400000))));
    for (let i = 1; i <= paidCount; i++) {
      const interest = money(bal * (l.rate / 1200));
      const principal = money(monthly - interest);
      bal = money(bal - principal);
      lp.push({ loanId: l.id, date: addMonths(l.startDate, i), amount: money(monthly), principal, interest, method: 'Auto-debit' });
    }
  });
  await store.saveMany('loanPayments', lp, { auditIt: false });

  /* ---------- recurring rules ---------- */
  await store.saveMany('recurring', [
    { name: 'Salary', rule: 'monthly', nextRun: nextOccurrence(`${monthKey(today())}-01`, 'monthly'), active: true,
      template: { type: 'income', amount: money(4200 * 1.16), accountId: accounts.bank, categoryId: cat('Salary'),
        currency: settings.baseCurrency, rate: 1, notes: 'Monthly salary credit', merchant: 'Acme Corp Payroll', status: 'cleared', tags: [] } },
    { name: 'House Rent', rule: 'monthly', nextRun: addDays(today(), 3), active: true,
      template: { type: 'expense', amount: 1150, accountId: accounts.bank, categoryId: cat('Rent'),
        currency: settings.baseCurrency, rate: 1, notes: 'House rent', status: 'cleared', tags: ['fixed'] } },
    { name: 'Netflix', rule: 'monthly', nextRun: addDays(today(), 11), active: true,
      template: { type: 'expense', amount: 15.99, accountId: accounts.card, categoryId: cat('Subscription'),
        currency: settings.baseCurrency, rate: 1, notes: 'Netflix subscription', merchant: 'Netflix', status: 'cleared', tags: ['recurring'] } },
  ], { auditIt: false });

  /* ---------- auto-categorisation rules ---------- */
  await store.saveMany('rules', [
    { pattern: 'netflix', matchType: 'contains', categoryId: cat('Subscription'), priority: 10, active: true },
    { pattern: 'uber|careem', matchType: 'regex', categoryId: cat('Travel'), priority: 8, active: true },
    { pattern: 'metro cash', matchType: 'contains', categoryId: cat('Grocery'), priority: 9, active: true },
    { pattern: 'meta ads|google ads|tiktok for business', matchType: 'regex', categoryId: cat('Digital Marketing'), priority: 10, active: true },
  ], { auditIt: false });

  /* ---------- a custom module, to show the dynamic builder ---------- */
  const [propType] = await store.saveMany('entityTypes', [{
    name: 'Rental Properties', icon: 'home', color: '#22d3ee',
    description: 'Track units, tenants, rent and occupancy',
    fields: [
      { key: 'unit', label: 'Unit', type: 'text', required: true },
      { key: 'tenant', label: 'Tenant', type: 'text' },
      { key: 'rent', label: 'Monthly rent', type: 'money', required: true, summary: 'sum' },
      { key: 'deposit', label: 'Security deposit', type: 'money' },
      { key: 'leaseEnd', label: 'Lease ends', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', options: ['Occupied', 'Vacant', 'Notice period'], required: true },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  }], { auditIt: false });
  await store.saveMany('entityRecords', [
    { typeId: propType.id, data: { unit: 'Apartment 3B', tenant: 'Hassan Ali', rent: 620, deposit: 1240, leaseEnd: addMonths(today(), 7), status: 'Occupied', notes: 'Pays on the 5th' } },
    { typeId: propType.id, data: { unit: 'Shop 12', tenant: 'Zainab Boutique', rent: 450, deposit: 900, leaseEnd: addMonths(today(), 3), status: 'Occupied' } },
    { typeId: propType.id, data: { unit: 'Apartment 1A', tenant: '', rent: 580, deposit: 0, leaseEnd: '', status: 'Vacant', notes: 'Needs repainting before listing' } },
  ], { auditIt: false });

  await store.audit('setup', 'system', '', 'Demo workspace generated');
  store.bus.emit('change', { store: '*', action: 'seed' });
}
