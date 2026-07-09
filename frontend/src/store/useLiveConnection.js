import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { useTradingStore } from './useTradingStore';

const API_URL = import.meta.env.VITE_API_URL || '';
const API_KEY = 'mysecretkey123';
const AUTH = { 'X-API-Key': API_KEY };

/* Establishes every live source once, feeds the store, and tears
   everything down cleanly on unmount (socket + all poll timers). */
export function useLiveConnection() {
  const socketRef = useRef(null);

  useEffect(() => {
    const st = () => useTradingStore.getState();
    let alive = true;
    const timers = [];
    const later = (fn, ms) => { if (alive) timers.push(setTimeout(fn, ms)); };

    // ── socket.io (MT5 push channel) ──
    const socket = io(API_URL || window.location.origin, {
      transports: ['websocket', 'polling'], reconnectionDelay: 1000, reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity, timeout: 10000,
    });
    socketRef.current = socket;
    socket.on('connect', () => st().setConnection('mt5', 'connected'));
    socket.on('disconnect', () => st().setConnection('mt5', 'disconnected'));
    socket.on('connect_error', () => st().setConnection('mt5', 'connecting'));
    socket.on('dashboard', (d) => st().ingestDashboard(d));
    socket.on('candles', (d) => st().ingestCandles(d));
    socket.on('history', (raw) => st().ingestHistory(raw));
    socket.on('log', (e) => st().ingestLog(e));
    socket.on('log_history', (arr) => st().setLogs(arr));

    // ── REST dashboard poll (1s) ──
    const pollDash = async () => {
      try {
        const r = await fetch(`${API_URL}/api/dashboard`, { headers: AUTH, signal: AbortSignal.timeout(3000) });
        if (alive && r.ok) st().ingestDashboard(await r.json());
      } catch { /* ignore */ }
      later(pollDash, 1000);
    };
    pollDash();

    // ── history poll (4s) ──
    const pollHist = async () => {
      try {
        const r = await fetch(`${API_URL}/api/history?limit=1000`, { headers: AUTH, signal: AbortSignal.timeout(4000) });
        if (alive && r.ok) st().ingestHistory(await r.json());
      } catch { /* ignore */ }
      later(pollHist, 4000);
    };
    pollHist();

    // ── logs poll (3s) ──
    const pollLogs = async () => {
      try {
        const r = await fetch(`${API_URL}/api/logs`, { headers: AUTH });
        if (r.ok) { const d = await r.json(); if (d.logs?.length) st().setLogs(d.logs.slice(-200)); }
      } catch { /* ignore */ }
      later(pollLogs, 3000);
    };
    pollLogs();

    // ── learning: stored training snapshots (15s) ──
    const pollSnaps = async () => {
      try { const r = await fetch(`${API_URL}/api/snapshots/count`); if (r.ok) { const d = await r.json(); if (typeof d.count === 'number') st().setSnapshots(d.count); } } catch { /* ignore */ }
      later(pollSnaps, 15000);
    };
    pollSnaps();

    // ── REAL execution latency via ping round-trip (2s) ──
    const pingLoop = async () => {
      const t0 = performance.now();
      try {
        await fetch(`${API_URL}/api/ping`, { cache: 'no-store' });
        st().setLatency(Math.round(performance.now() - t0));
      } catch { st().setLatency(null); }
      later(pingLoop, 2000);
    };
    pingLoop();

    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);

  return socketRef;
}

/* Selector hooks (per the brief) — kept granular so components
   only re-render on the slice they read. */
export const useLiveMarketData = () => ({
  pair: useTradingStore((s) => s.pair),
  price: useTradingStore((s) => s.price),
  rsi: useTradingStore((s) => s.rsi),
  macd: useTradingStore((s) => s.macd),
  candles: useTradingStore((s) => s.candles),
  sessions: useTradingStore((s) => s.sessions),
});

export function useTradeExecution() {
  const positions = useTradingStore((s) => s.positions);
  const history = useTradingStore((s) => s.history);
  const botRunning = useTradingStore((s) => s.botRunning);
  // Real backend control. `action` ∈ {start, stop}. Returns ok/err.
  const execute = async (action) => {
    try {
      const r = await fetch(`${API_URL}/api/bot/control`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...AUTH }, body: JSON.stringify({ action }),
      });
      return r.ok;
    } catch { return false; }
  };
  return { positions, history, botRunning, execute };
}
