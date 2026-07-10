import { create } from 'zustand';

/* ─────────────────────────────────────────────────────────────
   Central trading store — a pure ingestion target.
   Live sources (socket / REST / ping) call the ingest* actions;
   components subscribe with selectors. No data is invented here:
   fields the backend doesn't send (macd, orderBook, binance,
   firebase) stay null/offline until a real payload arrives.
   ───────────────────────────────────────────────────────────── */

const lastClose = (candles) => (Array.isArray(candles) && candles.length ? Number(candles[candles.length - 1].c) : null);

// keep the SAME array reference when content is unchanged, so 1s polls that
// return identical data don't trigger re-renders / animation flicker
const sameArr = (a, b, key) => {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (key(a[i]) !== key(b[i])) return false;
  return true;
};
const posKey = (p) => `${p.ticket}|${p.profit}|${p.price_open}`;
const trdKey = (t) => `${t.ticket}|${t.profit}`;

export const useTradingStore = create((set) => ({
  // ── market ──
  pair: 'XAUUSD',
  price: null,
  rsi: null,
  macd: null,            // backend does not emit yet
  candles: [],
  sessions: {},
  orderBook: null,       // backend does not emit yet

  // ── account / pnl ──
  account: null,
  balance: null,
  equity: null,
  pnlOpen: 0,
  stats: { total_trades: 0, wins: 0, losses: 0, win_rate: 0, total_profit: 0 },

  // ── execution ──
  positions: [],
  history: [],

  // ── system ──
  latencyMs: null,
  isOnline: false,
  botRunning: false,
  connections: { mt5: 'connecting', binance: 'offline', firebase: 'offline' },
  logs: [],

  // ── AI / learning (Claude pattern engine) ──
  patternAdvice: null,
  patternTime: null,
  claudeAdvice: null,
  snapshots: 0,

  // ── ingest actions (called by the live layer) ──
  ingestDashboard: (d) => set((s) => {
    const incomingPos = Array.isArray(d.positions) ? d.positions : s.positions;
    const positions = sameArr(incomingPos, s.positions, posKey) ? s.positions : incomingPos;
    const account = d.account || s.account;
    const candles = Array.isArray(d.candles) && d.candles.length ? d.candles : s.candles;
    const sortedHist = Array.isArray(d.history) && d.history.length
      ? [...d.history].sort((a, b) => new Date(b.time) - new Date(a.time))
      : s.history;
    const history = sameArr(sortedHist, s.history, trdKey) ? s.history : sortedHist;
    return {
      account,
      balance: account?.balance ?? s.balance,
      equity: account?.equity ?? s.equity,
      positions,
      pnlOpen: positions.reduce((a, p) => a + (p.profit || 0), 0),
      history,
      stats: d.stats || s.stats,
      isOnline: !!d.is_online,
      botRunning: !!d.bot_running,
      rsi: d.last_rsi ?? s.rsi,
      candles,
      sessions: d.sessions || s.sessions,
      price: lastClose(candles) ?? s.price,
      patternAdvice: d.pattern_advice ?? s.patternAdvice,
      patternTime: d.pattern_time ?? s.patternTime,
      claudeAdvice: d.claude_advice ?? s.claudeAdvice,
    };
  }),
  setSnapshots: (n) => set({ snapshots: n }),
  ingestCandles: (d) => set((s) => {
    const candles = d.candles || [];
    return { candles, sessions: d.sessions || s.sessions, price: lastClose(candles) ?? s.price };
  }),
  ingestHistory: (raw) => set((s) => {
    if (!Array.isArray(raw) || !raw.length) return {};
    const sorted = [...raw].sort((a, b) => new Date(b.time) - new Date(a.time));
    return sameArr(sorted, s.history, trdKey) ? {} : { history: sorted };
  }),
  ingestLog: (e) => set((s) => { const n = [...s.logs, e]; return { logs: n.length > 200 ? n.slice(-200) : n }; }),
  setLogs: (arr) => set({ logs: arr || [] }),
  setLatency: (ms) => set({ latencyMs: ms }),
  setConnection: (key, status) => set((s) => ({ connections: { ...s.connections, [key]: status } })),

  // future: external market feed (Binance order book, MACD…) — wired, not faked
  ingestMarket: (m) => set((s) => ({
    price: m.price ?? s.price, rsi: m.rsi ?? s.rsi, macd: m.macd ?? s.macd, orderBook: m.orderBook ?? s.orderBook,
  })),
}));
