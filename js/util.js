/* ═══════════ util.js — primitives used everywhere ═══════════ */

export const $  = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------- ids & misc ---------- */
export function uid(p = '') {
  const t = Date.now().toString(36);
  const r = crypto.getRandomValues(new Uint32Array(2));
  return `${p}${t}${r[0].toString(36)}${r[1].toString(36).slice(0, 4)}`;
}
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const noop = () => {};
export const isNum = v => typeof v === 'number' && Number.isFinite(v);

export function debounce(fn, ms = 220) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function throttle(fn, ms = 200) {
  let last = 0, t;
  return (...a) => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...a); }
    else { clearTimeout(t); t = setTimeout(() => { last = Date.now(); fn(...a); }, ms - (now - last)); }
  };
}

/* ---------- money (integer minor units to avoid float drift) ---------- */
/**
 * Round to 2dp with true half-away-from-zero behaviour.
 * A plain `Math.round(v * 100) / 100` is wrong for values like 1.005, whose
 * binary representation is 1.00499999999999989 — it silently rounds *down* and
 * loses a cent. The epsilon nudge corrects for that representation error, and
 * the sign is handled explicitly so −1.005 rounds to −1.01, not −1.00.
 */
export function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  const sign = v < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(v) * 100 + 1e-9)) / 100;
}
export function cents(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  const sign = v < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(v) * 100 + 1e-9);
}
export const fromCents = c => (Number(c) || 0) / 100;
export const sum = (arr, f = x => x) => money(arr.reduce((a, x) => money(a + (Number(f(x)) || 0)), 0));

const fmtCache = new Map();
function nf(cur, opts) {
  const key = cur + JSON.stringify(opts);
  if (!fmtCache.has(key)) {
    try { fmtCache.set(key, new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, ...opts })); }
    catch { fmtCache.set(key, new Intl.NumberFormat(undefined, { style: 'decimal', ...opts })); }
  }
  return fmtCache.get(key);
}

/** [code, symbol, flag, name] */
export const CURRENCIES = [
  ['INR', '₹', '🇮🇳', 'Indian Rupee'], ['USD', '$', '🇺🇸', 'US Dollar'],
  ['EUR', '€', '🇪🇺', 'Euro'], ['GBP', '£', '🇬🇧', 'British Pound'],
  ['AED', 'د.إ', '🇦🇪', 'UAE Dirham'], ['SAR', '﷼', '🇸🇦', 'Saudi Riyal'],
  ['QAR', 'ر.ق', '🇶🇦', 'Qatari Riyal'], ['OMR', 'ر.ع.', '🇴🇲', 'Omani Rial'],
  ['KWD', 'د.ك', '🇰🇼', 'Kuwaiti Dinar'], ['BHD', '.د.ب', '🇧🇭', 'Bahraini Dinar'],
  ['PKR', '₨', '🇵🇰', 'Pakistani Rupee'], ['BDT', '৳', '🇧🇩', 'Bangladeshi Taka'],
  ['LKR', 'Rs', '🇱🇰', 'Sri Lankan Rupee'], ['NPR', 'रू', '🇳🇵', 'Nepalese Rupee'],
  ['JPY', '¥', '🇯🇵', 'Japanese Yen'], ['CNY', '¥', '🇨🇳', 'Chinese Yuan'],
  ['CAD', 'C$', '🇨🇦', 'Canadian Dollar'], ['AUD', 'A$', '🇦🇺', 'Australian Dollar'],
  ['SGD', 'S$', '🇸🇬', 'Singapore Dollar'], ['MYR', 'RM', '🇲🇾', 'Malaysian Ringgit'],
  ['ZAR', 'R', '🇿🇦', 'South African Rand'], ['NGN', '₦', '🇳🇬', 'Nigerian Naira'],
  ['KES', 'KSh', '🇰🇪', 'Kenyan Shilling'], ['TRY', '₺', '🇹🇷', 'Turkish Lira'],
  ['BRL', 'R$', '🇧🇷', 'Brazilian Real'], ['MXN', 'MX$', '🇲🇽', 'Mexican Peso'],
  ['IDR', 'Rp', '🇮🇩', 'Indonesian Rupiah'], ['PHP', '₱', '🇵🇭', 'Philippine Peso'],
  ['THB', '฿', '🇹🇭', 'Thai Baht'], ['CHF', 'CHF', '🇨🇭', 'Swiss Franc'],
];
const curRow = c => CURRENCIES.find(x => x[0] === c);
export const curSymbol = c => (curRow(c) || [, c])[1];
export const curFlag = c => (curRow(c) || [, , ''])[2] || '';
export const curName = c => (curRow(c) || [, , , c])[3] || c;

let BASE = 'USD';
export const setBaseCurrency = c => { BASE = c || 'USD'; };
export const baseCurrency = () => BASE;

/* ---------- amount in words ----------
   A typed figure is easy to get wrong by a digit; spelling it out is the check
   people actually use on a cheque. South Asian currencies group in lakh and
   crore, everything else in thousand/million, so the grouping follows the
   currency rather than the locale of the browser. */
const W_ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const W_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const LAKH_CURRENCIES = new Set(['INR', 'PKR', 'BDT', 'LKR', 'NPR']);
/** Minor unit names; omitted rather than guessed when a currency is not listed. */
const MINOR_UNITS = { INR: 'paise', PKR: 'paisa', NPR: 'paisa', LKR: 'cents', BDT: 'poisha',
  USD: 'cents', CAD: 'cents', AUD: 'cents', SGD: 'cents', NZD: 'cents',
  EUR: 'cents', GBP: 'pence', ZAR: 'cents', PHP: 'centavos', BRL: 'centavos' };

const under100 = n => (n < 20 ? W_ONES[n]
  : `${W_TENS[Math.floor(n / 10)]}${n % 10 ? `-${W_ONES[n % 10]}` : ''}`);
const under1000 = n => (n < 100 ? under100(n)
  : `${W_ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${under100(n % 100)}` : ''}`);

function wordsIndian(n) {
  const out = [];
  const cr = Math.floor(n / 1e7);
  if (cr) { out.push(cr > 99 ? wordsIndian(cr) : under100(cr), 'crore'); n -= cr * 1e7; }
  const lk = Math.floor(n / 1e5);
  if (lk) { out.push(under100(lk), 'lakh'); n -= lk * 1e5; }
  const th = Math.floor(n / 1e3);
  if (th) { out.push(under100(th), 'thousand'); n -= th * 1e3; }
  if (n) out.push(under1000(n));
  return out.join(' ');
}

function wordsWestern(n) {
  const out = [];
  for (const [value, name] of [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) {
    const q = Math.floor(n / value);
    if (q) { out.push(under1000(q), name); n -= q * value; }
  }
  if (n) out.push(under1000(n));
  return out.join(' ');
}

/**
 * "3500000" → "Thirty-five lakh rupees" (INR) / "Three million five hundred
 * thousand dollars"-style grouping elsewhere. Returns '' for a blank or
 * unusable value so callers can simply hide the line.
 */
export function amountInWords(value, cur = BASE) {
  const n = Number(value);
  if (!Number.isFinite(n) || value === '' || value == null) return '';
  const neg = n < 0;
  const abs = Math.abs(money(n));
  const whole = Math.floor(abs);
  const minor = Math.round((abs - whole) * 100);
  if (whole > 1e15) return '';                       // past the point of being useful
  const spell = LAKH_CURRENCIES.has(cur) ? wordsIndian : wordsWestern;
  let text = whole === 0 ? 'zero' : spell(whole);
  const unit = MINOR_UNITS[cur];
  if (minor && unit) text += ` and ${under100(minor)} ${unit}`;
  else if (minor) text += ` point ${String(minor).padStart(2, '0')}`;
  if (neg) text = `minus ${text}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function fmtMoney(v, cur = BASE, { compact = false, sign = false, dp } = {}) {
  const n = Number(v) || 0;
  const opts = compact
    ? { notation: 'compact', maximumFractionDigits: 1 }
    : { minimumFractionDigits: dp ?? 2, maximumFractionDigits: dp ?? 2 };
  let s = nf(cur, opts).format(Math.abs(n));
  if (n < 0) s = '−' + s;
  else if (sign && n > 0) s = '+' + s;
  return s;
}
export const fmtNum = (v, dp = 0) =>
  new Intl.NumberFormat(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(Number(v) || 0);
export const fmtCompact = v =>
  new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(Number(v) || 0);
export const fmtPct = (v, dp = 1) => `${(Number(v) || 0).toFixed(dp)}%`;
export const pctChange = (cur, prev) => (!prev ? (cur ? 100 : 0) : ((cur - prev) / Math.abs(prev)) * 100);

/* ---------- dates (ISO yyyy-mm-dd, local, no TZ surprises) ---------- */
export const pad2 = n => String(n).padStart(2, '0');
export const iso = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const today = () => iso(new Date());
export function parseISO(s) {
  if (!s) return new Date(NaN);
  if (s instanceof Date) return s;
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export const nowTime = () => { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
export const monthKey = s => String(s).slice(0, 7);
export const yearKey  = s => String(s).slice(0, 4);

export function addDays(s, n)   { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); }
export function addMonths(s, n) {
  const d = parseISO(s), day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())));
  return iso(d);
}
export const addYears = (s, n) => addMonths(s, n * 12);
export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
export const startOfMonth = s => `${monthKey(s)}-01`;
export function endOfMonth(s) { const d = parseISO(s); return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
export function startOfWeek(s, firstDay = 1) {
  const d = parseISO(s); const diff = (d.getDay() - firstDay + 7) % 7;
  d.setDate(d.getDate() - diff); return iso(d);
}
export const endOfWeek = (s, f = 1) => addDays(startOfWeek(s, f), 6);
export const startOfYear = s => `${yearKey(s)}-01-01`;
export const endOfYear = s => `${yearKey(s)}-12-31`;
export function quarterOf(s) { return Math.floor(parseISO(s).getMonth() / 3) + 1; }
export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
export const isPast = s => s && s < today();
export const isFuture = s => s && s > today();

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONF = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
export const monthName = (m, full) => (full ? MONF : MON)[m];
export function fmtDate(s, style = 'med') {
  if (!s) return '—';
  const d = parseISO(s);
  if (isNaN(d)) return '—';
  if (style === 'short') return `${d.getDate()} ${MON[d.getMonth()]}`;
  if (style === 'long')  return `${d.getDate()} ${MONF[d.getMonth()]} ${d.getFullYear()}`;
  if (style === 'mon')   return `${MON[d.getMonth()]} ${d.getFullYear()}`;
  if (style === 'dow')   return `${DOW[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}`;
  return `${d.getDate()} ${MON[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}
export function fmtMonthKey(mk) {
  const [y, m] = mk.split('-').map(Number);
  return `${MON[m - 1]} ${String(y).slice(2)}`;
}
export function relDate(s) {
  if (!s) return '—';
  const d = daysBetween(today(), s);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  if (d > 1 && d <= 14) return `in ${d} days`;
  if (d < -1 && d >= -14) return `${-d} days ago`;
  return fmtDate(s);
}
export function relTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(iso(new Date(ts)));
}

/** Inclusive list of yyyy-MM keys between two ISO dates. */
export function monthRange(from, to) {
  const out = []; let cur = startOfMonth(from); const end = startOfMonth(to);
  let guard = 0;
  while (cur <= end && guard++ < 600) { out.push(monthKey(cur)); cur = addMonths(cur, 1); }
  return out;
}
export function dayRange(from, to) {
  const out = []; let cur = from; let guard = 0;
  while (cur <= to && guard++ < 3000) { out.push(cur); cur = addDays(cur, 1); }
  return out;
}

/** Named period → {from,to,label}. */
export function period(name, anchor = today()) {
  switch (name) {
    case 'today':    return { from: anchor, to: anchor, label: 'Today' };
    case 'yesterday':{ const d = addDays(anchor, -1); return { from: d, to: d, label: 'Yesterday' }; }
    case 'week':     return { from: startOfWeek(anchor), to: endOfWeek(anchor), label: 'This week' };
    case 'lastweek': { const d = addDays(startOfWeek(anchor), -7); return { from: d, to: addDays(d, 6), label: 'Last week' }; }
    case 'month':    return { from: startOfMonth(anchor), to: endOfMonth(anchor), label: 'This month' };
    case 'lastmonth':{ const d = addMonths(anchor, -1); return { from: startOfMonth(d), to: endOfMonth(d), label: 'Last month' }; }
    case 'quarter':  { const q = quarterOf(anchor), y = yearKey(anchor);
                       return { from: `${y}-${pad2((q - 1) * 3 + 1)}-01`, to: endOfMonth(`${y}-${pad2(q * 3)}-01`), label: `Q${q} ${y}` }; }
    case 'year':     return { from: startOfYear(anchor), to: endOfYear(anchor), label: yearKey(anchor) };
    case 'lastyear': { const y = +yearKey(anchor) - 1; return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) }; }
    case '30d':      return { from: addDays(anchor, -29), to: anchor, label: 'Last 30 days' };
    case '90d':      return { from: addDays(anchor, -89), to: anchor, label: 'Last 90 days' };
    case '12m':      return { from: addMonths(anchor, -11), to: anchor, label: 'Last 12 months' };
    case 'all':      return { from: '1970-01-01', to: '2999-12-31', label: 'All time' };
    default:         return { from: startOfMonth(anchor), to: endOfMonth(anchor), label: 'This month' };
  }
}
export const PERIODS = [
  ['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['lastmonth', 'Last month'],
  ['30d', '30 days'], ['quarter', 'Quarter'], ['12m', '12 months'], ['year', 'This year'], ['all', 'All time'],
];

/* ---------- collections ---------- */
export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}
export function sortBy(arr, fn, dir = 1) {
  return [...arr].sort((a, b) => {
    const x = fn(a), y = fn(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1; if (y == null) return -1;
    return (x > y ? 1 : x < y ? -1 : 0) * dir;
  });
}
export const uniq = a => [...new Set(a)];
export const byId = arr => new Map(arr.map(x => [x.id, x]));
export const take = (a, n) => a.slice(0, n);

/* ---------- statistics ---------- */
export const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
export function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
/** Ordinary least-squares fit → {slope, intercept, r2, at(x)}. */
export function linreg(ys) {
  const n = ys.length;
  if (n < 2) return { slope: 0, intercept: ys[0] || 0, r2: 0, at: () => ys[0] || 0 };
  const xs = ys.map((_, i) => i);
  const mx = mean(xs), my = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const slope = den ? num / den : 0, intercept = my - slope * mx;
  const ssTot = ys.reduce((s, y) => s + (y - my) ** 2, 0);
  const ssRes = ys.reduce((s, y, i) => s + (y - (slope * i + intercept)) ** 2, 0);
  return { slope, intercept, r2: ssTot ? 1 - ssRes / ssTot : 0, at: x => slope * x + intercept };
}
/** Simple exponential smoothing forecast. */
export function ema(ys, alpha = 0.4) {
  if (!ys.length) return 0;
  let v = ys[0];
  for (let i = 1; i < ys.length; i++) v = alpha * ys[i] + (1 - alpha) * v;
  return v;
}

/* ---------- finance maths ---------- */
/** Equated monthly instalment. rate = annual %, term in months. */
export function emi(principal, annualRatePct, months) {
  const p = Number(principal) || 0, n = Number(months) || 0;
  const r = (Number(annualRatePct) || 0) / 12 / 100;
  if (!p || !n) return 0;
  if (!r) return money(p / n);
  const f = Math.pow(1 + r, n);
  return money((p * r * f) / (f - 1));
}
/**
 * Amortisation schedule.
 * The final instalment absorbs any rounding residual so the schedule always
 * closes at exactly zero and the principal column sums back to the loan amount.
 */
export function amortize(principal, annualRatePct, months, startDate) {
  const n = Number(months) || 0;
  const pay = emi(principal, annualRatePct, n);
  const r = (Number(annualRatePct) || 0) / 12 / 100;
  let bal = money(principal);
  const rows = [];
  for (let i = 1; i <= n && bal > 0; i++) {
    const int = money(bal * r);
    let prin = money(pay - int);
    if (i === n || prin >= bal) prin = bal;   // last payment clears the balance
    bal = money(bal - prin);
    rows.push({ n: i, date: addMonths(startDate, i), payment: money(prin + int), interest: int, principal: prin, balance: bal });
  }
  return rows;
}
/** Compound growth of a principal. */
export const compound = (p, annualPct, years, perYear = 1) =>
  money(p * Math.pow(1 + (annualPct / 100) / perYear, perYear * years));
/** Simple interest accrued between two dates. */
export function accruedInterest(principal, annualPct, fromDate, toDate = today(), type = 'simple') {
  const days = Math.max(0, daysBetween(fromDate, toDate));
  const yrs = days / 365;
  if (!annualPct || !principal) return 0;
  return type === 'compound'
    ? money(principal * (Math.pow(1 + annualPct / 100, yrs) - 1))
    : money(principal * (annualPct / 100) * yrs);
}
/** Internal rate of return over irregular cashflows (XIRR, bisection). */
export function xirr(flows) {
  if (flows.length < 2) return 0;
  const t0 = parseISO(flows[0].date);
  const npv = r => flows.reduce((s, f) =>
    s + f.amount / Math.pow(1 + r, (parseISO(f.date) - t0) / (365 * 86400000)), 0);
  let lo = -0.9999, hi = 10;
  if (npv(lo) * npv(hi) > 0) return 0;
  for (let i = 0; i < 120; i++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid;
  }
  return ((lo + hi) / 2) * 100;
}
export const roi = (gain, cost) => (cost ? ((gain - cost) / cost) * 100 : 0);
/** CAGR between two values across a number of years. */
export const cagr = (start, end, years) =>
  (start > 0 && years > 0 ? (Math.pow(end / start, 1 / years) - 1) * 100 : 0);

/* ---------- recurrence ---------- */
export const RECUR = [
  ['none', 'Does not repeat'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'],
  ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['halfyearly', 'Every 6 months'], ['yearly', 'Yearly'],
];
export function nextOccurrence(dateISO, rule) {
  switch (rule) {
    case 'daily':      return addDays(dateISO, 1);
    case 'weekly':     return addDays(dateISO, 7);
    case 'biweekly':   return addDays(dateISO, 14);
    case 'monthly':    return addMonths(dateISO, 1);
    case 'quarterly':  return addMonths(dateISO, 3);
    case 'halfyearly': return addMonths(dateISO, 6);
    case 'yearly':     return addYears(dateISO, 1);
    default:           return null;
  }
}

/* ---------- text ---------- */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '');
export const initials = s => String(s || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
export const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export function highlight(text, q) {
  if (!q) return esc(text);
  const i = String(text).toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(text);
  const t = String(text);
  return esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length));
}
/** Fuzzy subsequence score; higher is better, 0 = no match. */
export function fuzzy(needle, hay) {
  if (!needle) return 1;
  const n = needle.toLowerCase(), h = String(hay || '').toLowerCase();
  if (h.includes(n)) return 100 - h.indexOf(n);
  let i = 0, score = 0;
  for (const ch of h) { if (ch === n[i]) { i++; score += 2; } if (i === n.length) break; }
  return i === n.length ? score : 0;
}

/* ---------- colours ---------- */
export const PALETTE = ['#7c5cff','#22d3ee','#10b981','#f59e0b','#f43f5e','#8b5cf6','#38bdf8','#34d399',
  '#fb923c','#fb7185','#a78bfa','#2dd4bf','#facc15','#f472b6','#60a5fa','#4ade80','#c084fc','#fdba74'];
export const colorFor = (key, i) => {
  if (typeof i === 'number') return PALETTE[i % PALETTE.length];
  let h = 0; for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

/* ---------- files ---------- */
export function download(content, filename, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
export function toCSV(rows, headers) {
  const cols = headers || (rows[0] ? Object.keys(rows[0]) : []);
  const q = v => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [cols.map(q).join(','), ...rows.map(r => cols.map(c => q(r[c])).join(','))].join('\r\n');
}
export function parseCSV(text) {
  const rows = []; let row = [], cell = '', inQ = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x !== ''));
}
export const fileToDataURL = f => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f);
});
/**
 * Downscale an image file to a square-ish JPEG data URL.
 * Profile photos live inside the synced vault, so a 4 MB camera shot would
 * bloat every upload — 256 px at 85% quality lands around 15 KB.
 */
export async function resizeImage(file, max = 256, quality = 0.85) {
  const dataUrl = await fileToDataURL(file);
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('That file could not be read as an image'));
    i.src = dataUrl;
  });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);          // flatten transparency so JPEG looks right
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

export const humanSize = b => {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB']; const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
};

/* ---------- crypto (WebCrypto, no deps) ---------- */
const enc = new TextEncoder(), dec = new TextDecoder();
export const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
export const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export async function pbkdf2(pass, saltB64, iterations = 250000) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return { hash: b64(bits), salt: b64(salt), iterations };
}
export async function deriveKey(pass, saltB64, iterations = 250000) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: unb64(saltB64), iterations, hash: 'SHA-256' },
    key, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function aesEncrypt(plaintext, cryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, enc.encode(plaintext));
  return { iv: b64(iv), data: b64(ct) };
}
export async function aesDecrypt({ iv, data }, cryptoKey) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, cryptoKey, unb64(data));
  return dec.decode(pt);
}
export async function sha256(str) {
  return b64(await crypto.subtle.digest('SHA-256', enc.encode(str)));
}

/* ---------- account secrets from one password ---------- */
/**
 * Turns a single password into TWO independent secrets:
 *
 *   encRaw     — 256 bits used to encrypt your data. NEVER leaves the browser.
 *   authSecret — 256 bits sent to the server to prove who you are.
 *
 * Both come from one 512-bit PBKDF2 derivation salted with your email, so the
 * halves cannot be derived from one another. The server therefore learns
 * nothing that could decrypt your vault, even though you only type one
 * password. This is the same split Bitwarden and Standard Notes use.
 */
export async function deriveAccountSecrets(email, password, iterations = 250000) {
  const emailSalt = await sha256(String(email).trim().toLowerCase().normalize('NFKC'));
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: unb64(emailSalt), iterations, hash: 'SHA-256' }, base, 512));
  const encRaw = bits.slice(0, 32);
  const authRaw = bits.slice(32, 64);
  const encKey = await crypto.subtle.importKey('raw', encRaw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  bits.fill(0);
  return { encKey, authSecret: b64(authRaw) };
}

/** Encrypt/decrypt the master key with an already-derived CryptoKey. */
export const wrapWithKey = async (rawMaster, cryptoKey) => aesEncrypt(b64(rawMaster), cryptoKey);
export async function unwrapWithKey(wrapped, cryptoKey) {
  return unb64(await aesDecrypt(wrapped, cryptoKey));   // throws if the key is wrong
}

/** Rough password strength, for the sign-up meter. */
export function passwordStrength(pw) {
  const s = String(pw || '');
  if (!s) return { score: 0, label: 'Empty' };
  let score = 0;
  if (s.length >= 8) score++;
  if (s.length >= 12) score++;
  if (s.length >= 16) score++;
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) score++;
  if (/\d/.test(s)) score++;
  if (/[^A-Za-z0-9]/.test(s)) score++;
  if (/^(.)\1+$/.test(s) || /^(12345|qwerty|password|abc)/i.test(s)) score = Math.min(score, 1);
  const label = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong', 'Excellent'][score] || 'Weak';
  return { score: Math.min(score, 6), label };
}

/* ---------- recovery codes ---------- */
/**
 * Crockford-style alphabet: no I, L, O or U, so 1/l, 0/O and typo-prone
 * letters cannot be confused when the code is written on paper.
 */
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 30 characters ≈ 150 bits of entropy, grouped for legibility. */
export function randomRecoveryCode(groups = 6, size = 5) {
  const bytes = crypto.getRandomValues(new Uint8Array(groups * size));
  let out = '';
  for (let i = 0; i < groups * size; i++) {
    if (i && i % size === 0) out += '-';
    out += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
  }
  return out;
}

/** Accepts any spacing/case/dashes the user typed, and fixes common misreads. */
export function normaliseRecoveryCode(input) {
  return String(input || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0').replace(/I/g, '1').replace(/L/g, '1').replace(/U/g, 'V');
}

/* ---------- master-key wrapping ---------- */
/**
 * The vault is encrypted with a random master key, and that master key is
 * wrapped separately by the passphrase and by the recovery code. Either one
 * unwraps it; the server only ever sees the wrapped blobs, so it still cannot
 * read anything. This is what makes "forgot passphrase" possible without
 * weakening the encryption.
 */
export async function generateMasterKey() {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return { raw, key };
}
export async function importMasterKey(raw) {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
/** Encrypt the master key with a secret-derived key. */
export async function wrapMasterKey(rawMaster, secret, saltB64, iterations = 250000) {
  const kek = await deriveKey(secret, saltB64, iterations);
  return aesEncrypt(b64(rawMaster), kek);
}
/** Recover the master key, or throw if the secret is wrong. */
export async function unwrapMasterKey(wrapped, secret, saltB64, iterations = 250000) {
  const kek = await deriveKey(secret, saltB64, iterations);
  const rawB64 = await aesDecrypt(wrapped, kek);   // throws on a wrong secret
  return unb64(rawB64);
}
export const randomSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));

/* ---------- tiny event bus ---------- */
export function emitter() {
  const map = new Map();
  return {
    on(ev, fn) { (map.get(ev) || map.set(ev, new Set()).get(ev)).add(fn); return () => map.get(ev)?.delete(fn); },
    off(ev, fn) { map.get(ev)?.delete(fn); },
    emit(ev, payload) { map.get(ev)?.forEach(f => { try { f(payload); } catch (e) { console.error(e); } });
                        map.get('*')?.forEach(f => { try { f(ev, payload); } catch (e) { console.error(e); } }); },
  };
}
