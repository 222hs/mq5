import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || '';
const API_KEY = 'mysecretkey123';
const H = { 'X-API-Key': API_KEY };

const sortByTime = (a) => a.slice().sort((x, y) => new Date(y.time) - new Date(x.time));

/* Single source of truth for all live MT5 bot data — mirrors the proven
   Dashboard wiring (HTTP poll + socket.io) so the new UI is 100% real. */
export function useLiveData() {
  const [data, setData] = useState(null);
  const [historyData, setHistoryData] = useState([]);
  const [logs, setLogs] = useState([]);
  const [grx, setGrx] = useState({});
  const [candleData, setCandleData] = useState({ candles: [], sessions: {} });
  const [connState, setConnState] = useState('connecting');

  const applyDashboard = (d) => {
    const hist = Array.isArray(d.history) && d.history.length ? sortByTime(d.history) : null;
    setData((prev) => ({ ...d, history: hist || prev?.history || [] }));
    if (Array.isArray(d.candles) && d.candles.length) setCandleData({ candles: d.candles, sessions: d.sessions || {} });
  };

  // dashboard poll (1s)
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const r = await fetch(`${API_URL}/api/dashboard`, { headers: H, signal: AbortSignal.timeout(3000) });
        if (active && r.ok) applyDashboard(await r.json());
      } catch { /* ignore */ }
      if (active) setTimeout(poll, 1000);
    };
    poll();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // history poll (4s)
  useEffect(() => {
    let active = true;
    const f = async () => {
      try {
        const r = await fetch(`${API_URL}/api/history?limit=1000`, { headers: H, signal: AbortSignal.timeout(4000) });
        if (active && r.ok) {
          const raw = await r.json();
          if (Array.isArray(raw) && raw.length) setHistoryData(sortByTime(raw));
        }
      } catch { /* ignore */ }
      if (active) setTimeout(f, 4000);
    };
    f();
    return () => { active = false; };
  }, []);

  // logs poll (3s)
  useEffect(() => {
    let active = true;
    const f = async () => {
      try {
        const r = await fetch(`${API_URL}/api/logs`, { headers: H });
        if (r.ok) { const d = await r.json(); if (d.logs?.length) setLogs(d.logs.slice(-200)); }
      } catch { /* ignore */ }
      if (active) setTimeout(f, 3000);
    };
    f();
    return () => { active = false; };
  }, []);

  // keep-alive ping (25s)
  useEffect(() => {
    const ping = () => fetch(`${API_URL}/api/ping`).catch(() => {});
    ping();
    const t = setInterval(ping, 25000);
    return () => clearInterval(t);
  }, []);

  // GRX settings (once)
  useEffect(() => {
    fetch(`${API_URL}/api/settings/grx`, { headers: H }).then((r) => (r.ok ? r.json() : null)).then((s) => { if (s) setGrx(s); }).catch(() => {});
  }, []);

  // socket.io — instant pushes
  useEffect(() => {
    const socket = io(API_URL || window.location.origin, {
      transports: ['websocket', 'polling'], reconnectionDelay: 1000, reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity, timeout: 10000,
    });
    socket.on('connect', () => setConnState('connected'));
    socket.on('disconnect', () => setConnState('disconnected'));
    socket.on('connect_error', () => setConnState('connecting'));
    socket.on('dashboard', applyDashboard);
    socket.on('candles', (d) => setCandleData(d));
    socket.on('grx_settings', (s) => setGrx(s));
    socket.on('log', (e) => setLogs((prev) => { const n = [...prev, e]; return n.length > 200 ? n.slice(-200) : n; }));
    socket.on('log_history', (e) => setLogs(e || []));
    socket.on('history', (raw) => { if (Array.isArray(raw) && raw.length) setHistoryData(sortByTime(raw)); });
    return () => socket.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const botControl = async (action) => {
    try {
      await fetch(`${API_URL}/api/bot/control`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...H }, body: JSON.stringify({ action }),
      });
    } catch { /* ignore */ }
  };

  const account = data?.account || null;
  const positions = Array.isArray(data?.positions) ? data.positions : [];
  const history = historyData.length ? historyData : (Array.isArray(data?.history) ? data.history : []);
  const stats = data?.stats || { total_trades: 0, wins: 0, losses: 0, win_rate: 0, total_profit: 0 };

  return {
    data, account, positions, history, stats,
    isOnline: !!data?.is_online, botRunning: !!data?.bot_running,
    candles: candleData.candles || [], sessions: candleData.sessions || {},
    lastRsi: data?.last_rsi, grx, logs, connState, botControl,
  };
}
