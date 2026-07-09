import { create } from 'zustand';

/* ─────────────────────────────────────────────────────────────
   Central trading store — a pure ingestion target.
   Live sources (socket / REST / ping) call the ingest* actions;
   components subscribe with selectors. No data is invented here:
   fields the backend doesn't send (macd, orderBook, binance,
   firebase) stay null/offline until a real payload arrives.
   ───────────────────────────────────────────────────────────── */

const lastClose = (candles) => (Array.isArray(candles) && candles.length ? Number(candles[candles.length - 1].c) : null);

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

  // ── ingest actions (called by the live layer) ──
  ingestDashboard: (d) => set((s) => {
    const positions = Array.isArray(d.positions) ? d.positions : s.positions;
    const account = d.account || s.account;
    const candles = Array.isArray(d.candles) && d.candles.length ? d.candles : s.candles;
    const history = Array.isArray(d.history) && d.history.length
      ? [...d.history].sort((a, b) => new Date(b.time) - new Date(a.time))
      : s.history;
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
    };
  }),
  ingestCandles: (d) => set((s) => {
    const candles = d.candles || [];
    return { candles, sessions: d.sessions || s.sessions, price: lastClose(candles) ?? s.price };
  }),
  ingestHistory: (raw) => set((s) => ({
    history: Array.isArray(raw) && raw.length ? [...raw].sort((a, b) => new Date(b.time) - new Date(a.time)) : s.history,
  })),
  ingestLog: (e) => set((s) => { const n = [...s.logs, e]; return { logs: n.length > 200 ? n.slice(-200) : n }; }),
  setLogs: (arr) => set({ logs: arr || [] }),
  setLatency: (ms) => set({ latencyMs: ms }),
  setConnection: (key, status) => set((s) => ({ connections: { ...s.connections, [key]: status } })),

  // future: external market feed (Binance order book, MACD…) — wired, not faked
  ingestMarket: (m) => set((s) => ({
    price: m.price ?? s.price, rsi: m.rsi ?? s.rsi, macd: m.macd ?? s.macd, orderBook: m.orderBook ?? s.orderBook,
  })),
}));
