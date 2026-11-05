// =========================================================================
// SIMULATED CONNECTION — drop-in replacement for the real Deriv client.
// Exposes the same functions and emits the same events the bots already
// use (balance / tick / proposal / buy / contractUpdate / connection:*),
// but nothing leaves the browser: markets are generated locally and every
// contract settles by the simulated win rate (default 85%, adjustable via
// the badge), not by the price path. Payouts follow the contract's
// nominal odds, like the real platform.
// =========================================================================

import { emit } from '/src/core/state/eventBus.js';
import { getWinRate } from '/src/core/sim/simBadge.js';
import { mountPortfolioPanel } from '/src/core/sim/simPortfolioPanel.js';

// Test hook: speeds the whole simulation up (never set in the browser).
const SPEED = (typeof globalThis.__SIM_SPEED === 'number' && globalThis.__SIM_SPEED > 0) ? globalThis.__SIM_SPEED : 1;
const LATENCY_MS = 150 / SPEED;
const CONNECT_DELAY_MS = 400 / SPEED;
const PAYOUT_MARGIN = 0.96;
const MIN_STAKE = 0.35;
const START_BALANCE = { demo: 10000, real: 500 };
const MAX_TICKS = 3600;

const SYMBOLS = {
  R_10:      { start: 6743.512,    pip: 3, vol: 0.10, ms: 2000 },
  R_25:      { start: 2315.447,    pip: 3, vol: 0.25, ms: 2000 },
  R_50:      { start: 245.6182,    pip: 4, vol: 0.50, ms: 2000 },
  R_75:      { start: 589432.1745, pip: 4, vol: 0.75, ms: 2000 },
  R_100:     { start: 1124.37,     pip: 2, vol: 1.00, ms: 2000 },
  '1HZ10V':  { start: 10234.56,    pip: 2, vol: 0.10, ms: 1000 },
  '1HZ15V':  { start: 4521.123,    pip: 3, vol: 0.15, ms: 1000 },
  '1HZ25V':  { start: 2890.12,     pip: 2, vol: 0.25, ms: 1000 },
  '1HZ30V':  { start: 5321.123,    pip: 3, vol: 0.30, ms: 1000 },
  '1HZ50V':  { start: 580.45,      pip: 2, vol: 0.50, ms: 1000 },
  '1HZ75V':  { start: 6892.31,     pip: 2, vol: 0.75, ms: 1000 },
  '1HZ90V':  { start: 4120.15,     pip: 2, vol: 0.90, ms: 1000 },
  '1HZ100V': { start: 803.62,      pip: 2, vol: 1.00, ms: 1000 }
};

const DIGIT_TYPES = ['DIGITOVER', 'DIGITUNDER', 'DIGITEVEN', 'DIGITODD', 'DIGITMATCH', 'DIGITDIFF'];
const SUPPORTED_TYPES = [...DIGIT_TYPES, 'CALL', 'PUT', 'ONETOUCH', 'NOTOUCH'];

// ---------------------------------------------------------------- state
let connected = false;
let accountType = 'demo';
let committedBalance = 0;   // persisted balance (settled results only)
let openStakes = 0;         // stakes of contracts still running
let balanceSubscribed = false;

const markets = new Map();
const proposals = new Map();
const contracts = new Map();
let proposalCounter = 1;
let nextContractId = 14830000000 + Math.floor(Math.random() * 1e6);

// -------------------------------------------------------------- helpers
const round2 = (x) => Math.round(x * 100) / 100;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const range = (a, b) => { const out = []; for (let i = a; i <= b; i++) out.push(i); return out; };
const roundToPip = (x, pip) => Number(x.toFixed(pip));

function gaussian() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

// Moves `base` to the nearest price whose last digit is `digit`.
function forceDigit(base, digit, pip) {
  const scale = Math.pow(10, pip);
  const baseInt = Math.round(base * scale);
  const mod = ((baseInt % 10) + 10) % 10;
  const floor10 = baseInt - mod;
  const cands = [floor10 - 10 + digit, floor10 + digit, floor10 + 10 + digit];
  let best = cands[0];
  for (const c of cands) if (Math.abs(c - baseInt) < Math.abs(best - baseInt)) best = c;
  return Number((best / scale).toFixed(pip));
}

const balanceKey = (t) => `pipstrades_sim_balance_${t}`;
function loadBalance(t) {
  try {
    const v = parseFloat(localStorage.getItem(balanceKey(t)));
    if (!isNaN(v)) return v;
  } catch (e) { /* ignore */ }
  return START_BALANCE[t] !== undefined ? START_BALANCE[t] : START_BALANCE.demo;
}
function saveBalance(t, value) {
  try { localStorage.setItem(balanceKey(t), String(value)); } catch (e) { /* ignore */ }
}

const liveBalance = () => round2(committedBalance - openStakes);
const accountId = () => (accountType === 'real' ? 'SIM-REAL-001' : 'SIM-DEMO-001');

function emitBalance() {
  if (!balanceSubscribed || !connected) return;
  emit('balance', { balance: liveBalance(), currency: 'USD', loginid: accountId() });
}

// --------------------------------------------------------------- market
class Market {
  constructor(symbol) {
    this.symbol = symbol;
    this.cfg = SYMBOLS[symbol];
    this.price = this.cfg.start;
    this.sigma = this.cfg.start * this.cfg.vol / Math.sqrt(31536000000 / this.cfg.ms);
    this.subscribed = false;
    this.contracts = new Set();
    this.timer = null;
  }

  ensureRunning() {
    if (!this.timer) this.timer = setInterval(() => this.step(), this.cfg.ms / SPEED);
  }

  maybeStop() {
    if (!this.subscribed && this.contracts.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  randomQuote() {
    return roundToPip(this.price + gaussian() * this.sigma, this.cfg.pip);
  }

  tickPayload(quote) {
    return { symbol: this.symbol, quote, pip_size: this.cfg.pip, epoch: Math.floor(Date.now() / 1000), id: 'sim-' + this.symbol };
  }

  step() {
    let quote = this.randomQuote();
    const due = [...this.contracts].find((c) => c.ticksLeft === 1);
    if (due) quote = forceQuote(due, this, quote);
    this.price = quote;

    if (this.subscribed && connected) emit('tick', this.tickPayload(quote));

    for (const c of [...this.contracts]) {
      c.ticksLeft -= 1;
      if (c.ticksLeft <= 0) {
        this.contracts.delete(c);
        settleContract(c, quote);
      }
    }
    this.maybeStop();
  }

  history(count) {
    const prices = [];
    let p = this.price;
    for (let i = 0; i < count; i++) {
      prices.push(roundToPip(p, this.cfg.pip));
      p -= gaussian() * this.sigma;
    }
    prices.reverse();
    prices[prices.length - 1] = this.price;
    const now = Math.floor(Date.now() / 1000);
    const step = Math.round(this.cfg.ms / 1000);
    const times = prices.map((_, i) => now - (prices.length - 1 - i) * step);
    return { prices, times };
  }
}

function getMarket(symbol) {
  let m = markets.get(symbol);
  if (!m) { m = new Market(symbol); markets.set(symbol, m); }
  return m;
}

// The settlement tick is chosen to agree with the contract's outcome so
// what's shown on screen matches the result.
function forceQuote(c, market, randomQ) {
  const pip = market.cfg.pip;
  const u = Math.pow(10, -pip);
  const win = c.win;
  const b = c.barrier;
  const all = range(0, 9);

  switch (c.type) {
    case 'DIGITOVER':  return forceDigit(randomQ, pick(win ? range(b + 1, 9) : range(0, b)), pip);
    case 'DIGITUNDER': return forceDigit(randomQ, pick(win ? range(0, b - 1) : range(b, 9)), pip);
    case 'DIGITEVEN':  return forceDigit(randomQ, pick(win ? [0, 2, 4, 6, 8] : [1, 3, 5, 7, 9]), pip);
    case 'DIGITODD':   return forceDigit(randomQ, pick(win ? [1, 3, 5, 7, 9] : [0, 2, 4, 6, 8]), pip);
    case 'DIGITMATCH': return forceDigit(randomQ, win ? b : pick(all.filter((d) => d !== b)), pip);
    case 'DIGITDIFF':  return forceDigit(randomQ, win ? pick(all.filter((d) => d !== b)) : b, pip);
    case 'CALL':
    case 'PUT': {
      const up = (c.type === 'CALL') === win;
      const step = Math.max(Math.abs(randomQ - c.entry), 2 * u);
      return roundToPip(up ? c.entry + step : c.entry - step, pip);
    }
    case 'ONETOUCH':
    case 'NOTOUCH': {
      const level = c.entry + c.offset;
      const touches = (c.type === 'ONETOUCH') === win;
      if (touches) return roundToPip(level, pip);
      if (c.offset >= 0 && randomQ >= level) return roundToPip(level - 2 * u, pip);
      if (c.offset < 0 && randomQ <= level) return roundToPip(level + 2 * u, pip);
      return randomQ;
    }
    default: return randomQ;
  }
}

// ------------------------------------------------------------ contracts
function buildPoc(c, spot) {
  const open = !c.settled;
  return {
    contract_id: c.id,
    contract_type: c.type,
    underlying: c.symbol,
    currency: 'USD',
    buy_price: c.stake,
    payout: c.payout,
    barrier: c.barrierStr,
    entry_spot: c.entry,
    current_spot: spot !== undefined ? spot : getMarket(c.symbol).price,
    is_sold: open ? 0 : 1,
    is_expired: open ? 0 : 1,
    status: open ? 'open' : (c.win ? 'won' : 'lost'),
    profit: open ? 0 : c.profit,
    sell_price: open ? 0 : (c.win ? c.payout : 0),
    date_start: c.start
  };
}

function adjustCommitted(type, delta) {
  if (type === accountType) {
    committedBalance = round2(committedBalance + delta);
    saveBalance(type, committedBalance);
  } else {
    saveBalance(type, round2(loadBalance(type) + delta));
  }
}

function settleContract(c, exitQuote) {
  c.settled = true;
  c.profit = c.win ? round2(c.payout - c.stake) : -c.stake;
  if (c.accountType === accountType) openStakes = round2(openStakes - c.stake);
  adjustCommitted(c.accountType, c.profit);
  c.finalPoc = buildPoc(c, exitQuote);
  emitBalance();
  if (c.subscribed) emit('contractUpdate', c.finalPoc);
}

function durationToTicks(duration, unit, ms) {
  const n = Number(duration);
  if (!(n >= 1)) throw new Error('Invalid duration.');
  let ticks;
  switch (unit) {
    case 't': ticks = n; break;
    case 's': ticks = Math.ceil((n * 1000) / ms); break;
    case 'm': ticks = Math.ceil((n * 60000) / ms); break;
    case 'h': ticks = Math.ceil((n * 3600000) / ms); break;
    default: ticks = Math.ceil((n * 86400000) / ms);
  }
  return Math.min(Math.max(1, ticks), MAX_TICKS);
}

function handleProposal(p) {
  const symbol = p.underlying_symbol || p.symbol;
  const cfg = SYMBOLS[symbol];
  if (!cfg) throw new Error('Trading is not offered for this asset.');
  const type = p.contract_type;
  if (!SUPPORTED_TYPES.includes(type)) throw new Error('This contract type is not supported.');
  const stake = Number(p.amount);
  if (!(stake >= MIN_STAKE)) throw new Error(`Minimum stake of ${MIN_STAKE} is required.`);

  const market = getMarket(symbol);
  const ticks = durationToTicks(p.duration, p.duration_unit, cfg.ms);

  let barrier = null;
  let barrierStr = '';
  let offset = 0;
  let prob;

  if (['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(type)) {
    barrier = parseInt(p.barrier, 10);
    if (isNaN(barrier) || barrier < 0 || barrier > 9) throw new Error('Barrier must be a digit from 0 to 9.');
    if (type === 'DIGITOVER' && barrier > 8) throw new Error('Barrier must be between 0 and 8 for this contract.');
    if (type === 'DIGITUNDER' && barrier < 1) throw new Error('Barrier must be between 1 and 9 for this contract.');
    barrierStr = String(barrier);
    prob = type === 'DIGITOVER' ? (9 - barrier) / 10
         : type === 'DIGITUNDER' ? barrier / 10
         : type === 'DIGITMATCH' ? 0.1 : 0.9;
  } else if (type === 'DIGITEVEN' || type === 'DIGITODD' || type === 'CALL' || type === 'PUT') {
    prob = 0.5;
  } else {
    barrierStr = String(p.barrier === undefined ? '' : p.barrier).trim();
    if (!/^[+-]?\d+(\.\d+)?$/.test(barrierStr)) throw new Error('A valid barrier is required for this contract.');
    const decimals = barrierStr.includes('.') ? barrierStr.split('.')[1].length : 0;
    if (decimals > 2) throw new Error('The barrier offset can not have more than 2 decimal places.');
    const relative = barrierStr.startsWith('+') || barrierStr.startsWith('-');
    offset = relative ? parseFloat(barrierStr) : parseFloat(barrierStr) - market.price;
    if (offset === 0) throw new Error('The barrier must differ from the current spot.');
    const z = Math.abs(offset) / (market.sigma * Math.sqrt(ticks));
    const pTouch = Math.min(1, 2 * (1 - normCdf(z)));
    prob = type === 'ONETOUCH' ? pTouch : 1 - pTouch;
  }

  const ratio = PAYOUT_MARGIN / Math.max(prob, 1e-6);
  if (!(ratio > 1.0) || ratio > 30) throw new Error('This contract offers no return.');

  const id = 'SIMP' + (proposalCounter++);
  const payout = round2(stake * ratio);
  proposals.set(id, { id, symbol, type, barrier, barrierStr, offset, stake, payout, ticks });
  if (proposals.size > 200) proposals.delete(proposals.keys().next().value);

  return {
    msg_type: 'proposal',
    proposal: {
      id,
      ask_price: stake,
      payout,
      spot: market.price,
      display_value: stake.toFixed(2),
      longcode: `Simulated ${type} on ${symbol}`
    }
  };
}

function handleBuy(p) {
  const prop = proposals.get(p.buy);
  if (!prop) throw new Error('This proposal has expired or could not be found.');
  if (Number(p.price) + 1e-9 < prop.stake) throw new Error('The price offered is lower than the contract price.');
  if (liveBalance() < prop.stake) throw new Error('Your account balance is insufficient to buy this contract.');
  proposals.delete(p.buy);

  const market = getMarket(prop.symbol);
  nextContractId += 1 + Math.floor(Math.random() * 5000);

  const c = {
    id: nextContractId,
    symbol: prop.symbol,
    type: prop.type,
    barrier: prop.barrier,
    barrierStr: prop.barrierStr,
    offset: prop.offset,
    stake: prop.stake,
    payout: prop.payout,
    ticksLeft: prop.ticks,
    entry: market.price,
    start: Math.floor(Date.now() / 1000),
    win: Math.random() * 100 < getWinRate(),
    accountType,
    settled: false,
    subscribed: false,
    profit: 0,
    finalPoc: null
  };

  contracts.set(c.id, c);
  market.contracts.add(c);
  market.ensureRunning();
  openStakes = round2(openStakes + c.stake);
  emitBalance();

  return {
    msg_type: 'buy',
    buy: {
      contract_id: c.id,
      buy_price: c.stake,
      payout: c.payout,
      balance_after: liveBalance(),
      longcode: `Simulated ${c.type} on ${c.symbol}`,
      start_time: c.start,
      transaction_id: c.id + 1
    }
  };
}

// -------------------------------------------------------- request router
function handle(payload) {
  if (payload.ping) return { msg_type: 'ping', ping: 'pong' };

  if (payload.balance) {
    balanceSubscribed = true;
    return { msg_type: 'balance', balance: { balance: liveBalance(), currency: 'USD', loginid: accountId() } };
  }

  if (payload.ticks_history) {
    const symbol = payload.ticks_history;
    const cfg = SYMBOLS[symbol];
    if (!cfg) throw new Error('Trading is not offered for this asset.');
    const count = Math.min(Number(payload.count) || 100, 5000);
    return { msg_type: 'history', history: getMarket(symbol).history(count), pip_size: cfg.pip };
  }

  if (payload.ticks) {
    const symbol = payload.ticks;
    if (!SYMBOLS[symbol]) throw new Error('Trading is not offered for this asset.');
    const market = getMarket(symbol);
    market.subscribed = true;
    market.ensureRunning();
    return { msg_type: 'tick', tick: market.tickPayload(market.price) };
  }

  if (payload.forget_all) {
    markets.forEach((m) => { m.subscribed = false; m.maybeStop(); });
    return null;
  }

  if (payload.forget) return null;

  if (payload.proposal) return handleProposal(payload);
  if (payload.buy) return handleBuy(payload);

  if (payload.proposal_open_contract) {
    const c = contracts.get(Number(payload.contract_id));
    if (!c) throw new Error('Contract not found.');
    c.subscribed = true;
    if (c.settled) {
      return { msg_type: 'proposal_open_contract', proposal_open_contract: c.finalPoc };
    }
    return { msg_type: 'proposal_open_contract', proposal_open_contract: buildPoc(c) };
  }

  return null;
}

function emitFor(msg) {
  if (!msg) return;
  switch (msg.msg_type) {
    case 'balance': emit('balance', msg.balance); break;
    case 'tick': emit('tick', msg.tick); break;
    case 'proposal': emit('proposal', msg.proposal); break;
    case 'buy': emit('buy', msg.buy); break;
    case 'proposal_open_contract': emit('contractUpdate', msg.proposal_open_contract); break;
    default: break;
  }
}

// ------------------------------------------------------------ public API
export function connect(token, type = 'demo') {
  return new Promise((resolve) => {
    setTimeout(() => {
      accountType = type === 'real' ? 'real' : 'demo';
      committedBalance = loadBalance(accountType);
      openStakes = 0;
      balanceSubscribed = false;
      connected = true;
      emit('connection:open', {});
      resolve(true);
    }, CONNECT_DELAY_MS);
  });
}

export function disconnect() {
  const wasConnected = connected;
  connected = false;
  balanceSubscribed = false;
  markets.forEach((m) => { m.subscribed = false; m.maybeStop(); });
  if (wasConnected) emit('connection:close', {});
}

export function isConnected() {
  return connected;
}

export function getCurrentAccountId() {
  return accountId();
}

export function send(payload) {
  if (!connected) {
    emit('connection:error', { message: 'Not connected' });
    return;
  }
  setTimeout(() => {
    try {
      emitFor(handle(payload));
    } catch (err) {
      emit('connection:error', { message: err.message });
    }
  }, LATENCY_MS);
}

export function sendRequest(payload) {
  return new Promise((resolve, reject) => {
    if (!connected) { reject(new Error('Not connected')); return; }
    setTimeout(() => {
      try {
        const msg = handle(payload);
        emitFor(msg);
        resolve(msg);
      } catch (err) {
        reject(err);
      }
    }, LATENCY_MS);
  });
}

export function subscribeTicks(symbol) {
  send({ ticks: symbol, subscribe: 1 });
}

// Used by the Portfolio page's "Simulation settings" section.
export function getSimBalance(type) {
  return type === accountType && connected ? committedBalance : loadBalance(type);
}

export function setSimBalance(type, value) {
  const v = round2(Math.max(0, Number(value) || 0));
  if (type === accountType && connected) {
    // Keep the displayed balance equal to what was typed, even if a
    // contract is still open.
    committedBalance = round2(v + openStakes);
    saveBalance(type, committedBalance);
    emitBalance();
  } else {
    saveBalance(type, v);
  }
}

mountPortfolioPanel({ getBalance: getSimBalance, setBalance: setSimBalance });
