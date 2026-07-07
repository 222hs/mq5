import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || "";
const API_KEY = 'mysecretkey123';
const DASH_VERSION = 'v3.23';
const POLL_MS = 1000; // HTTP poll interval

// ── Terminal palette (matches reference design) ─────────────────────
const C = {
  bg:      '#0d1117',
  surface: '#161b22',
  ink:     '#e6edf3',
  muted:   '#8b949e',
  faint:   '#21262d',
  neon:    '#00ff41',
  neonDim: 'rgba(0,255,65,0.08)',
  red:     '#ff4560',
  yellow:  '#f0b429',
  mono:    "'Courier New','Courier',monospace",
  shadow:  'none',
  border:  '1px solid rgba(0,255,65,0.25)',
};

// ── helpers ────────────────────────────────────────────────────────
function fmtMoney(v, sign = false) {
  if (v === null || v === undefined || isNaN(v)) return '--';
  const n = Number(v);
  const s = n < 0 ? '-' : sign && n > 0 ? '+' : '';
  return s + '$' + Math.abs(n).toFixed(2);
}
function fmtBig(v) {
  if (v === null || v === undefined || isNaN(v)) return { neg: false, dollars: '--', cents: '00' };
  const n = Number(v);
  const abs = Math.abs(n);
  const dollars = Math.floor(abs).toLocaleString('en-US').replace(/,/g, ' ');
  const cents = (abs - Math.floor(abs)).toFixed(2).slice(2);
  return { neg: n < 0, dollars, cents };
}
function ageStr(iso) {
  if (!iso) return '--';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm' + (s % 60) + 's';
  return Math.floor(s / 3600) + 'h' + Math.floor((s % 3600) / 60) + 'm';
}

// ── Brutalist card ─────────────────────────────────────────────────
const bCard = (extra = {}) => ({
  background: C.surface,
  border: C.border,
  boxShadow: C.shadow,
  padding: '1.1rem',
  minWidth: 0,
  fontFamily: C.mono,
  color: C.ink,
  ...extra,
});

const bLabel = (extra = {}) => ({
  fontSize: 10,
  letterSpacing: '2px',
  textTransform: 'uppercase',
  color: C.muted,
  fontFamily: C.mono,
  fontWeight: 700,
  ...extra,
});

const bBtn = (active, extra = {}) => ({
  fontFamily: C.mono,
  fontWeight: 'bold',
  fontSize: 12,
  letterSpacing: '2px',
  textTransform: 'uppercase',
  padding: '8px 18px',
  border: '1px solid rgba(0,255,65,0.5)',
  borderRadius: 2,
  cursor: 'pointer',
  background: active ? C.neon : 'transparent',
  color: active ? '#000' : C.neon,
  transition: 'background 0.1s, color 0.1s, box-shadow 0.1s',
  ...extra,
});

// ── Main ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const [data, setData] = useState(null);
  const [now, setNow] = useState(new Date());
  const [popup, setPopup] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(null);
  const settingsDirty = useRef(false);
  const [btcSettings, setBtcSettings] = useState({});
  const [btcSettingsDraft, setBtcSettingsDraft] = useState({});
  const btcSettingsDirty = useRef(false);
  const [hedgeSettingsDraft, setHedgeSettingsDraft] = useState({});
  const hedgeSettingsDirty = useRef(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [hedgeSaveMsg, setHedgeSaveMsg] = useState('');
  const [hedgeBusy, setHedgeBusy] = useState(false);
  const [grxSettingsDraft, setGrxSettingsDraft] = useState({});
  const grxSettingsDirty = useRef(false);
  const [grxSaveMsg, setGrxSaveMsg] = useState('');
  const [grxBusy, setGrxBusy] = useState(false);
  const [candleData, setCandleData] = useState({ candles: [], sessions: {} });
  const [tradePopup, setTradePopup] = useState(null); // trade detail popup
  const [tradeSnapshot, setTradeSnapshot] = useState(null); // entry snapshot
  const seenTickets = useRef(null);
  const prevPositions = useRef(null);
  const popupTimer = useRef(null);
  const [connState, setConnState] = useState('connecting');
  const socketRef = useRef(null);
  const [logs, setLogs] = useState([]);
  const logBoxRef = useRef(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  const [snapLoading, setSnapLoading] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // auto-scroll داخل صندوق اللوج فقط — لا يحرك الصفحة
  useEffect(() => {
    const box = logBoxRef.current;
    if (!box) return;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    if (atBottom) box.scrollTop = box.scrollHeight;
  }, [logs]);

  // HTTP poll — سريع وموثوق، بديل WebSocket للبيانات الرئيسية
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const r = await fetch(`${API_URL}/api/dashboard`, {
          headers: { 'X-API-Key': API_KEY },
          signal: AbortSignal.timeout(3000),
        });
        if (!active) return;
        if (r.ok) {
          const d = await r.json();
          setData(d);
          if (d.settings && !settingsDirty.current) setSettingsDraft({ ...d.settings });
          if (d.btc_settings && !btcSettingsDirty.current) {
            setBtcSettings({ ...d.btc_settings });
            setBtcSettingsDraft({ ...d.btc_settings });
          }
          if (Array.isArray(d.candles) && d.candles.length > 0)
            setCandleData({ candles: d.candles, sessions: d.sessions || {} });
        }
      } catch (_) {}
      if (active) setTimeout(poll, POLL_MS);
    };
    poll();
    return () => { active = false; };
  }, []);

  // keep-alive: ping backend every 25s so Railway doesn't sleep
  useEffect(() => {
    const ping = () => fetch(`${API_URL}/api/ping`, { method: 'GET' }).catch(() => {});
    ping();
    const t = setInterval(ping, 25000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const socket = io(API_URL || window.location.origin, {
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      timeout: 10000,
    });
    socketRef.current = socket;

    socket.on('connect',    () => setConnState('connected'));
    socket.on('disconnect', () => setConnState('disconnected'));
    socket.on('connect_error', () => setConnState('connecting'));

    const handleDashboard = (d) => {
      // Popup: detect closed positions (updates every 2s) — أسرع من history (60s)
      const curPos = Array.isArray(d.positions) ? d.positions : [];
      if (prevPositions.current !== null && prevPositions.current.length > 0) {
        const curTickets = new Set(curPos.map(p => p.ticket));
        const closed = prevPositions.current.filter(p => !curTickets.has(p.ticket));
        if (closed.length > 0) {
          const totalNet = closed.reduce((sum, p) => sum + (p.profit || 0), 0);
          setPopup({ profit: totalNet, count: closed.length });
          clearTimeout(popupTimer.current);
          popupTimer.current = setTimeout(() => setPopup(null), 3500);
        }
      }
      prevPositions.current = curPos;
      // history is pull-only — don't let socket overwrite it
      setData(prev => ({ ...d, history: prev?.history || d.history || [] }));
      if (d.settings && !settingsDirty.current) setSettingsDraft({ ...d.settings });
      // الشمعات تأتي داخل dashboard snapshot عند الاتصال الأول
      if (Array.isArray(d.candles) && d.candles.length > 0) {
        setCandleData({ candles: d.candles, sessions: d.sessions || {} });
      }
    };

    socket.on('dashboard', handleDashboard);
    socket.on('candles', (d) => setCandleData(d));
    socket.on('settings', (s) => {
      settingsDirty.current = false;
      setSettingsDraft({ ...s });
    });
    socket.on('btc_settings', (s) => {
      btcSettingsDirty.current = false;
      setBtcSettings({ ...s });
      setBtcSettingsDraft({ ...s });
    });
    socket.on('hedge_settings', (s) => {
      hedgeSettingsDirty.current = false;
      setHedgeSettingsDraft({ ...s });
    });
    socket.on('grx_settings', (s) => {
      grxSettingsDirty.current = false;
      setGrxSettingsDraft({ ...s });
    });
    socket.on('log', (entry) => {
      setLogs(prev => {
        const next = [...prev, entry];
        return next.length > 100 ? next.slice(-100) : next;
      });
    });
    socket.on('log_history', (entries) => {
      setLogs(entries || []);
    });

    return () => {
      socket.off('dashboard', handleDashboard);
      socket.off('candles');
      socket.off('settings');
      socket.off('btc_settings');
      socket.off('hedge_settings');
      socket.off('grx_settings');
      socket.off('log');
      socket.off('log_history');
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
      socket.disconnect();
      clearTimeout(popupTimer.current);
    };
  }, []);

  const [snapCount, setSnapCount] = useState(null);

  const loadSnapshots = async () => {
    setSnapLoading(true);
    try {
      const [r, rc, rh] = await Promise.all([
        fetch(`${API_URL}/api/snapshots?limit=100`, { headers: {'X-API-Key': API_KEY} }),
        fetch(`${API_URL}/api/snapshots/count`),
        fetch(`${API_URL}/api/history?limit=200`, { headers: {'X-API-Key': API_KEY} }),
      ]);
      if (rc.ok) { const d = await rc.json(); setSnapCount(d.count); }
      // ربط الـ snapshots بالـ history للحصول على P&L
      let histMap = {};
      if (rh.ok) {
        const hist = await rh.json();
        hist.forEach(t => { histMap[t.ticket] = t; });
      }
      if (r.ok) {
        const d = await r.json();
        const enriched = d.map(s => {
          const t = histMap[s.ticket];
          return t ? { ...s, profit: (t.profit||0)+(t.swap||0)+(t.commission||0) } : s;
        });
        setSnapshots(enriched);
      }
    } catch(e) {}
    setSnapLoading(false);
  };

  const openAnalysis = () => { setShowAnalysis(true); loadSnapshots(); };

  const botControl = async (action) => {
    setBusy(true);
    try {
      await fetch(`${API_URL}/api/bot/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify({ action }),
      });
    } catch (e) {}
    setBusy(false);
  };

  const openTradeDetail = async (trade) => {
    setTradePopup(trade);
    setTradeSnapshot(null);
    if (!trade?.ticket) return;
    try {
      const r = await fetch(`${API_URL}/api/trade_snapshot/${trade.ticket}`, { headers: {'X-API-Key': API_KEY} });
      if (r.ok) setTradeSnapshot(await r.json());
    } catch (e) {}
  };

  const saveSingle = async (key, value) => {
    setBusy(true);
    setSaveMsg(`SAVING ${key}...`);
    try {
      const r = await fetch(`${API_URL}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify({ [key]: value }),
      });
      if (r.ok) settingsDirty.current = false;
      setSaveMsg(r.ok ? `✓ ${key} SAVED` : 'ERROR');
    } catch (e) { setSaveMsg('ERROR'); }
    setBusy(false);
    setTimeout(() => setSaveMsg(''), 2500);
  };

  const saveBtcSingle = async (key, value) => {
    setBusy(true);
    setSaveMsg(`SAVING BTC ${key}...`);
    try {
      const r = await fetch(`${API_URL}/api/settings/btc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify({ [key]: value }),
      });
      if (r.ok) btcSettingsDirty.current = false;
      setSaveMsg(r.ok ? `✓ BTC ${key} SAVED` : 'ERROR');
    } catch (e) { setSaveMsg('ERROR'); }
    setBusy(false);
    setTimeout(() => setSaveMsg(''), 2500);
  };

  const saveGrxSingle = async (key, value) => {
    setGrxBusy(true);
    setGrxSaveMsg(`SAVING ${key}...`);
    try {
      const r = await fetch(`${API_URL}/api/settings/grx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify({ ...grxSettingsDraft, [key]: value }),
      });
      if (r.ok) {
        grxSettingsDirty.current = false;
        const updated = await r.json();
        if (updated.settings) setGrxSettingsDraft(updated.settings);
      }
      setGrxSaveMsg(r.ok ? `✓ ${key} SAVED` : 'ERROR');
    } catch (e) { setGrxSaveMsg('ERROR'); }
    setGrxBusy(false);
    setTimeout(() => setGrxSaveMsg(''), 2500);
  };

  const saveHedgeSingle = async (key, value) => {
    setHedgeBusy(true);
    setHedgeSaveMsg(`SAVING ${key}...`);
    try {
      const r = await fetch(`${API_URL}/api/settings/hedge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify({ [key]: value }),
      });
      if (r.ok) {
        hedgeSettingsDirty.current = false;
        const updated = await r.json();
        if (updated.settings) setHedgeSettingsDraft(updated.settings);
      }
      setHedgeSaveMsg(r.ok ? `✓ ${key} SAVED` : 'ERROR');
    } catch (e) { setHedgeSaveMsg('ERROR'); }
    setHedgeBusy(false);
    setTimeout(() => setHedgeSaveMsg(''), 2500);
  };

  // ── presets ────────────────────────────────────────────────────
  const HFT_PRESET  = { TP_USD:2, SL_USD:5, CooldownSecs:10, MaxPositions:10, UseH1Filter:0, MaxSpread:80  };
  const NORM_PRESET = { TP_USD:4, SL_USD:10, CooldownSecs:60, MaxPositions:5,  UseH1Filter:1, MaxSpread:350 };

  const applyPreset = async (preset, isBtc=false) => {
    setBusy(true);
    const url = isBtc ? `${API_URL}/api/settings/btc` : `${API_URL}/api/settings`;
    const label = isBtc ? 'BTC' : 'GOLD';
    setSaveMsg(`APPLYING ${label} PRESET...`);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify(preset),
      });
      if (r.ok) {
        if (isBtc) setBtcSettingsDraft(d => ({ ...d, ...preset }));
        else setSettingsDraft(d => ({ ...d, ...preset }));
        setSaveMsg(`✓ ${label} PRESET APPLIED`);
      } else { setSaveMsg('ERROR'); }
    } catch(e) { setSaveMsg('ERROR'); }
    setBusy(false);
    setTimeout(() => setSaveMsg(''), 3000);
  };

  const [histLoading, setHistLoading] = useState(false);
  const fetchHistory = async () => {
    setHistLoading(true);
    try {
      const r = await fetch(`${API_URL}/api/history?limit=200`, { headers: {'X-API-Key': API_KEY} });
      if (r.ok) {
        const hist = await r.json();
        setData(d => ({ ...d, history: hist }));
      }
    } catch(e) {}
    setHistLoading(false);
  };

  // Pull history on mount + every 5s
  useEffect(() => {
    fetchHistory();
    const t = setInterval(fetchHistory, 5000);
    return () => clearInterval(t);
  }, []);

  // Poll live log every 3s via HTTP (backup for WebSocket delays)
  const logTotalRef = useRef(0);
  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const r = await fetch(`${API_URL}/api/logs`, { headers: {'X-API-Key': API_KEY} });
        if (!r.ok) return;
        const d = await r.json();
        if (d.logs && d.logs.length > 0) {
          setLogs(d.logs.slice(-200));
          logTotalRef.current = d.total;
        }
      } catch(e) {}
    };
    fetchLogs();
    const t = setInterval(fetchLogs, 3000);
    return () => clearInterval(t);
  }, []);

  // Pull hedge settings on mount
  useEffect(() => {
    fetch(`${API_URL}/api/settings/hedge`, { headers: {'X-API-Key': API_KEY} })
      .then(r => r.ok ? r.json() : null)
      .then(s => { if(s) setHedgeSettingsDraft(s); })
      .catch(()=>{});
    fetch(`${API_URL}/api/settings/grx`, { headers: {'X-API-Key': API_KEY} })
      .then(r => r.ok ? r.json() : null)
      .then(s => { if(s) setGrxSettingsDraft(s); })
      .catch(()=>{});
  }, []);

  const exportSettings = (isBtc=false) => {
    const data = isBtc ? btcSettingsDraft : settingsDraft;
    const name = isBtc ? 'btc_settings' : 'gold_settings';
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${name}_${new Date().toISOString().slice(0,10)}.json`; a.click();
  };

  const importSettings = (isBtc=false) => {
    const input = document.createElement('input'); input.type='file'; input.accept='.json';
    input.onchange = async e => {
      const file = e.target.files[0]; if(!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const url = isBtc ? `${API_URL}/api/settings/btc` : `${API_URL}/api/settings`;
        const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json','X-API-Key':API_KEY}, body: JSON.stringify(data) });
        if(r.ok) { if(isBtc) setBtcSettingsDraft(d=>({...d,...data})); else setSettingsDraft(d=>({...d,...data})); setSaveMsg('✓ IMPORTED'); }
        else setSaveMsg('IMPORT ERROR');
      } catch(err) { setSaveMsg('IMPORT ERROR'); }
      setTimeout(()=>setSaveMsg(''),3000);
    };
    input.click();
  };

  // ── symbol branding ────────────────────────────────────────────
  const symInfo = (sym='') => {
    const s = (sym||'').toUpperCase();
    if(s.includes('XAU') || s.includes('GOLD')) return {icon:'🥇', color:'#FFD700', label:'GOLD'};
    if(s.includes('BTC') || s.includes('BITCOIN')) return {icon:'₿',  color:'#F7931A', label:'BTC'};
    if(s.includes('ETH') || s.includes('ETHEREUM')) return {icon:'Ξ',  color:'#627EEA', label:'ETH'};
    if(s.includes('XAG') || s.includes('SILVER')) return {icon:'🥈', color:'#C0C0C0', label:'SILVER'};
    if(s.includes('EUR')) return {icon:'€',  color:'#4CAF50', label:'EUR'};
    if(s.includes('GBP')) return {icon:'£',  color:'#2196F3', label:'GBP'};
    if(s.includes('JPY')) return {icon:'¥',  color:'#FF9800', label:'JPY'};
    if(s.includes('OIL') || s.includes('WTI') || s.includes('BRENT')) return {icon:'🛢', color:'#795548', label:'OIL'};
    if(s.includes('NAS') || s.includes('US100')) return {icon:'📈', color:'#00BCD4', label:'NAS'};
    if(s.includes('SPX') || s.includes('US500')) return {icon:'📊', color:'#9C27B0', label:'SPX'};
    return {icon:'◈', color:'#90A4AE', label: s.slice(0,6)};
  };

  // ── derive ─────────────────────────────────────────────────────
  const account        = data?.account || null;
  const positions      = Array.isArray(data?.positions) ? data.positions : [];
  const pendingOrders  = Array.isArray(data?.pending_orders) ? data.pending_orders : [];
  const newsFilter     = data?.news_filter || { blocked: false, title: '' };
  const history   = Array.isArray(data?.history)   ? data.history   : [];
  const stats     = data?.stats || { total_trades: 0, wins: 0, losses: 0, win_rate: 0, total_profit: 0 };
  const settings  = data?.settings || {};
  const isOnline  = !!data?.is_online;
  const botRunning= !!data?.bot_running;
  const candles   = candleData.candles || [];
  const sessions  = candleData.sessions || {};

  const netOf = t => (t.profit || 0) + (t.swap || 0) + (t.commission || 0);

  const times     = history.map(t => new Date(t.time).getTime()).filter(x => !isNaN(x));
  const spanMs    = times.length > 1 ? Math.max(...times) - Math.min(...times) : 0;
  const spanDays  = Math.max(1, spanMs / 86400000);
  const tradesPerDay = stats.total_trades / spanDays;
  const avgPerTrade  = stats.total_trades ? stats.total_profit / stats.total_trades : 0;

  let streak = 0;
  for (const t of history) { if (netOf(t) > 0) streak++; else break; }

  const todayStr    = new Date().toDateString();
  const todayTrades = history.filter(t => new Date(t.time).toDateString() === todayStr);
  const todayWins   = todayTrades.filter(t => netOf(t) > 0).length;
  const todayLosses = todayTrades.length - todayWins;
  const todayNet    = todayTrades.reduce((a, t) => a + netOf(t), 0);

  const tradesLastHour = history.filter(t => new Date(t.time).getTime() > Date.now() - 3600000).length;
  const openTotal = positions.reduce((a, p) => a + (p.profit || 0), 0);
  const lastTrade = history[0] || null;
  const lastProfit= lastTrade ? netOf(lastTrade) : null;
  const balance   = account?.balance ?? null;
  const bigBal    = fmtBig(balance);
  const balPos    = (balance ?? 0) >= 0;
  const bigPnl    = fmtBig(stats.total_profit);
  const pnlPos    = stats.total_profit >= 0;

  const recent30  = history.slice(0, 30).slice().reverse();

  const dayTrades = history.filter(t => new Date(t.time).getTime() > Date.now() - 86400000).slice().reverse();
  let cum = 0;
  const cumPts = dayTrades.map(t => (cum += netOf(t)));
  const peak24 = cumPts.length ? Math.max(...cumPts) : 0;

  const R = 130, CIRC = 2 * Math.PI * R;
  const streakPct = Math.min(1, streak / 20);

  const allNets   = history.map(t => netOf(t));
  const bestTrade = allNets.length ? Math.max(...allNets) : null;
  const worstTrade= allNets.length ? Math.min(...allNets) : null;

  const utc     = now.toISOString().slice(11, 19);
  const months  = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const dateStr = `${months[now.getUTCMonth()]} ${String(now.getUTCDate()).padStart(2,'0')} ${now.getUTCFullYear()}`;
  const claudeAdvice  = data?.claude_advice  || null;
  const claudeTime    = data?.claude_time    || null;
  const patternAdvice = data?.pattern_advice || null;
  const patternTime   = data?.pattern_time   || null;

  const settingKeys = ['LotSize','TP_USD','SL_USD','MaxSpread','MaxPositions','CooldownSecs','TrailUSD','MaxLossPerDay','MaxProfitPerDay','TradeHoursStart','TradeHoursEnd','RSIBuyMax','RSISellMin','BaseLot'];

  const pipeline = [
    { n:'01', t:'SCAN',   s:'candle dir',            ok: botRunning },
    { n:'02', t:'FILTER', s:`spread<${settings.MaxSpread??'--'}`, ok: botRunning },
    { n:'03', t:'SIZE',   s:`lot ${settings.LotSize??'--'}`,      ok: botRunning },
    { n:'04', t:'ENTRY',  s:'market ord',             ok: botRunning },
    { n:'05', t:'MANAGE', s:'TP/SL mon',              ok: positions.length > 0, active: positions.length > 0 },
    { n:'06', t:'CLOSE',  s:'settle',                 ok: !!lastTrade, last: lastProfit },
  ];

  return (
    <div style={{
      fontFamily: C.mono,
      background: C.bg,
      minHeight: '100vh',
      color: C.ink,
      paddingBottom: 52,
      position: 'relative',
    }}>
      <style>{`
        * { box-sizing: border-box; border-radius: 2px !important; }
        body { background: #0d1117; }
        @keyframes popIn  { from { transform: scale(0.8) translateY(20px); opacity: 0; } to { transform: scale(1) translateY(0); opacity: 1; } }
        @keyframes blink  { 0%,100%{opacity:1} 50%{opacity:0.15} }
        @keyframes slideUp{ from{transform:translateY(40px);opacity:0} to{transform:translateY(0);opacity:1} }
        .bcard:hover { border-color: rgba(0,255,65,0.6) !important; }
        .bbtn:hover  { background:#0d1117 !important; color:#00ff41 !important; border-color:#00ff41 !important; }
        .bbtn:active { opacity:0.8; }
        .bbtn-red:hover { background:#0d1117 !important; color:#ff4560 !important; border-color:#ff4560 !important; }
        .g4  { display:grid; grid-template-columns:repeat(4,1fr); gap:1.25rem; }
        .g3  { display:grid; grid-template-columns:repeat(3,1fr); gap:1.25rem; }
        .g2  { display:grid; grid-template-columns:repeat(2,1fr); gap:1.25rem; }
        .s2  { grid-column:span 2; }
        .s3  { grid-column:span 3; }
        .s4  { grid-column:span 4; }
        @media(max-width:960px){
          .g4{grid-template-columns:repeat(2,1fr);}
          .s3,.s4{grid-column:span 2;}
          .g3{grid-template-columns:repeat(2,1fr);}
        }
        @media(max-width:600px){
          .g4,.g3,.g2{grid-template-columns:1fr;}
          .s2,.s3,.s4{grid-column:span 1;}
        }
        input,select{outline:none;}
        input:focus,select:focus{border-color:#00ff41!important; box-shadow:0 0 8px rgba(0,255,65,0.5);}
        ::-webkit-scrollbar{width:8px;height:8px}
        ::-webkit-scrollbar-track{background:#000}
        ::-webkit-scrollbar-thumb{background:#00ff41}
        tr.hrow:hover td { background: rgba(0,255,65,0.08); }
      `}</style>
      <div className="scanlines" />

      {/* ═══ TOP BAR ═════════════════════════════════════════════ */}
      <header style={{
        background:C.bg,
        padding:'6px 16px', borderBottom:'1px solid #30363d',
        display:'flex', justifyContent:'space-between', alignItems:'center',
        flexWrap:'wrap', gap:'8px',
        fontFamily:C.mono,
      }}>
        {/* Left: title + status pill + controls */}
        <div style={{display:'flex', alignItems:'center', gap:14, flexWrap:'wrap'}}>
          <div style={{fontSize:14, fontWeight:'bold', letterSpacing:'2px', color:C.ink, textTransform:'uppercase'}}>
            GOLD_SCALPER_X<span style={{color:C.neon}}>&gt;_</span>
            <span style={{fontSize:9, color:C.muted, marginLeft:8, letterSpacing:'1px'}}>{DASH_VERSION}</span>
          </div>
          <div style={{
            border:`2px solid ${isOnline?C.neon:C.red}`,
            color: isOnline?C.neon:C.red,
            background:C.bg,
            fontSize:10, fontWeight:'bold', letterSpacing:'2px',
            padding:'3px 12px',
            boxShadow: isOnline ? '0 0 10px rgba(0,255,65,0.5)' : 'none',
          }}>
            <span style={{animation: isOnline?'blink 2s infinite':'none', display:'inline-block'}}>■</span> {isOnline ? 'LIVE' : 'OFFLINE'}
          </div>
          {/* WebSocket connection state */}
          <div style={{
            fontSize:9, fontWeight:'bold', letterSpacing:'1px',
            padding:'2px 8px',
            border:`1px solid ${connState==='connected'?'rgba(0,255,65,0.4)':connState==='connecting'?'rgba(240,180,41,0.4)':'rgba(255,69,96,0.4)'}`,
            color: connState==='connected'?C.neon : connState==='connecting'?C.yellow : C.red,
            background: connState==='connected'?'rgba(0,255,65,0.06)':connState==='connecting'?'rgba(240,180,41,0.06)':'rgba(255,69,96,0.06)',
            animation: connState==='connecting'?'blink 1s infinite':'none',
          }}>
            WS: {connState==='connected'?'●':connState==='connecting'?'◌':'✕'} {connState.toUpperCase()}
          </div>
          {newsFilter.blocked && (
            <div style={{
              fontFamily: C.mono, fontSize: 10, fontWeight: 'bold',
              letterSpacing: '1px', padding: '3px 10px',
              border: `2px solid ${C.red}`,
              color: C.red, background: 'rgba(255,69,96,0.12)',
              boxShadow: '0 0 8px rgba(255,69,96,0.4)',
              animation: 'blink 1s infinite',
            }}>
              🚫 NEWS: {newsFilter.title}
            </div>
          )}
          <button
            className={botRunning ? 'bbtn-red' : 'bbtn'}
            onClick={() => botControl(botRunning?'stop':'start')}
            disabled={busy}
            style={bBtn(true, botRunning
              ? { background:C.red, color:'#000', border:'2px solid #ff0040', padding:'5px 14px', fontSize:11 }
              : { padding:'5px 14px', fontSize:11 })}
          >
            {botRunning ? '[ STOP ]' : '[ START ]'}
          </button>
          <span style={{
            fontSize:10, fontWeight:'bold', letterSpacing:'2px',
            color: botRunning?C.neon:C.red, textTransform:'uppercase',
          }}>
            BOT:{botRunning?'RUNNING':'HALTED'}
          </span>
          <button onClick={openAnalysis} style={{
            fontFamily:C.mono, fontWeight:'bold', fontSize:11, letterSpacing:'2px',
            padding:'5px 14px', border:`2px solid #ff9900`, borderRadius:2,
            background:'transparent', color:'#ff9900', cursor:'pointer',
          }}>◆ ANALYSIS</button>
        </div>
        {/* Middle: symbol + account */}
        <div style={{display:'flex', gap:20, alignItems:'center', flexWrap:'wrap'}}>
          <div style={{fontSize:11, letterSpacing:'2px', color:C.yellow, fontWeight:'bold', textTransform:'uppercase'}}>
            XAUUSD·M1
          </div>
          <div style={{fontSize:11, letterSpacing:'1px', color:C.ink, fontVariantNumeric:'tabular-nums'}}>
            <span style={bLabel({fontSize:9})}>BAL </span>
            <span style={{fontWeight:'bold'}}>{account?'$'+Number(account.balance??0).toLocaleString('en-US',{minimumFractionDigits:2}):'--'}</span>
            <span style={bLabel({fontSize:9})}> EQ </span>
            <span style={{fontWeight:'bold', color:C.neon}}>{account?'$'+Number(account.equity??0).toLocaleString('en-US',{minimumFractionDigits:2}):'--'}</span>
          </div>
        </div>
        {/* Right: clock */}
        <div style={{textAlign:'right'}}>
          <div style={{fontSize:20, fontWeight:'bold', color:C.neon, fontVariantNumeric:'tabular-nums', textShadow:'0 0 10px rgba(0,255,65,0.6)'}}>{utc}</div>
          <div style={bLabel({fontSize:9})}>{dateStr} UTC</div>
        </div>
      </header>

      <div style={{padding:'1.25rem'}}>

        {/* ═══ WIN STREAK + TOTAL PNL ══════════════════════════ */}
        <div className="bcard" style={bCard({marginBottom:'1.25rem', display:'flex', alignItems:'center', justifyContent:'space-around', flexWrap:'wrap', gap:40, padding:'2.5rem 3rem'})}>

          {/* دائرة WIN STREAK */}
          <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:16}}>
            <svg width="320" height="320" viewBox="0 0 320 320">
              <circle cx="160" cy="160" r={R} fill="none" stroke={C.faint} strokeWidth="14"/>
              <circle cx="160" cy="160" r={R} fill="none"
                stroke={streak>0 ? C.neon : C.faint} strokeWidth="14"
                strokeDasharray={`${CIRC*streakPct} ${CIRC}`}
                transform="rotate(-90 160 160)" strokeLinecap="butt"
                style={{filter: streak>0 ? `drop-shadow(0 0 12px ${C.neon})` : 'none'}}/>
              <text x="160" y="148" textAnchor="middle"
                fontSize="90" fontWeight="bold" fontFamily={C.mono}
                fill={streak>0 ? C.neon : C.muted}>{streak}</text>
              <text x="160" y="196" textAnchor="middle"
                fontSize="18" fontWeight="bold" fontFamily={C.mono}
                fill={C.muted} letterSpacing="4">WIN STREAK</text>
            </svg>
            <div style={{display:'flex', gap:36}}>
              <div style={{textAlign:'center'}}>
                <div style={bLabel({fontSize:10})}>WINS</div>
                <div style={{fontSize:28, fontWeight:'bold', color:C.neon}}>{stats.wins??0}</div>
              </div>
              <div style={{textAlign:'center'}}>
                <div style={bLabel({fontSize:10})}>LOSSES</div>
                <div style={{fontSize:28, fontWeight:'bold', color:C.red}}>{stats.losses??0}</div>
              </div>
              <div style={{textAlign:'center'}}>
                <div style={bLabel({fontSize:10})}>WIN RATE</div>
                <div style={{fontSize:28, fontWeight:'bold', color: stats.win_rate>=50?C.neon:C.red}}>{stats.win_rate}%</div>
              </div>
            </div>
          </div>

          {/* BALANCE كبير */}
          <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:12}}>
            <div style={bLabel({fontSize:12, letterSpacing:'4px'})}>BALANCE</div>
            <div style={{
              fontSize:'clamp(72px,10vw,130px)',
              fontWeight:'bold',
              fontFamily:C.mono,
              fontVariantNumeric:'tabular-nums',
              lineHeight:1,
              color: balPos ? C.neon : C.red,
              textShadow: balPos
                ? '0 0 40px rgba(0,255,65,0.7), 0 0 80px rgba(0,255,65,0.3)'
                : '0 0 40px rgba(255,69,96,0.7), 0 0 80px rgba(255,69,96,0.3)',
            }}>
              {bigBal.neg ? '-$' : '$'}{bigBal.dollars}
              <span style={{fontSize:'35%', opacity:0.6}}>.{bigBal.cents}</span>
            </div>
            <div style={{fontSize:14, color:C.muted, letterSpacing:'2px', textTransform:'uppercase'}}>
              {stats.total_trades.toLocaleString()} TRADES &nbsp;·&nbsp; {tradesPerDay.toFixed(1)}/DAY
            </div>
            <div style={{marginTop:8, display:'flex', gap:32}}>
              <div style={{textAlign:'center'}}>
                <div style={bLabel({fontSize:10})}>TODAY NET</div>
                <div style={{fontSize:26, fontWeight:'bold', color: todayNet>=0?C.neon:C.red, fontVariantNumeric:'tabular-nums'}}>{fmtMoney(todayNet,true)}</div>
              </div>
              <div style={{textAlign:'center'}}>
                <div style={bLabel({fontSize:10})}>AVG/TRADE</div>
                <div style={{fontSize:26, fontWeight:'bold', color: avgPerTrade>=0?C.neon:C.red, fontVariantNumeric:'tabular-nums'}}>{fmtMoney(avgPerTrade,true)}</div>
              </div>
            </div>
          </div>

        </div>

        {/* ═══ MAIN 3-COL GRID: STATS | CHART | PIPELINE ══════ */}
        <div className="g3" style={{marginBottom:'1.25rem', alignItems:'stretch'}}>

          {/* COL 1: Stats big numbers */}
          <div className="bcard" style={bCard({display:'flex', flexDirection:'column', gap:14})}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
              <div style={bLabel({color:C.ink})}>&gt; TOTAL PNL</div>
              <span style={{fontSize:9, letterSpacing:'2px', color:C.neon, animation:'blink 2s infinite'}}>● LIVE</span>
            </div>
            <div style={{
              fontSize:'clamp(36px,4vw,56px)', fontWeight:'bold',
              color: pnlPos ? C.neon : C.red,
              textShadow: pnlPos ? '0 0 20px rgba(0,255,65,0.5)' : '0 0 20px rgba(255,0,64,0.5)',
              lineHeight:1, fontVariantNumeric:'tabular-nums',
            }}>
              {bigPnl.neg ? '-$' : '$'}{bigPnl.dollars}
              <span style={{fontSize:'40%', opacity:0.7}}>.{bigPnl.cents}</span>
            </div>
            <div style={{fontSize:10, color:C.muted, letterSpacing:'1px', textTransform:'uppercase'}}>
              {stats.total_trades.toLocaleString()} trades · {tradesPerDay.toFixed(1)}/day · avg {fmtMoney(avgPerTrade, true)}
            </div>

            {/* big stat grid */}
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:2, borderTop:C.border, paddingTop:12}}>
              {[
                { l:'WIN RATE',  v:`${stats.win_rate}%`, c: stats.win_rate>=50?C.neon:C.red },
                { l:'STREAK',    v: streak, c: streak>0?C.neon:C.muted },
                { l:'BEST',      v: bestTrade!==null?fmtMoney(bestTrade,true):'--', c:C.neon },
                { l:'WORST',     v: worstTrade!==null?fmtMoney(worstTrade,true):'--', c:C.red },
                { l:'TODAY NET', v: fmtMoney(todayNet,true), c: todayNet>=0?C.neon:C.red },
                { l:'1H VELO',   v:`${tradesLastHour}`, c:C.yellow },
                { l:'TODAY W/L', v:`${todayWins}/${todayLosses}`, c:C.ink },
                { l:'24H PEAK',  v: fmtMoney(peak24,true), c:C.neon },
              ].map(x=>(
                <div key={x.l} style={{padding:'8px 6px', border:`1px solid ${C.faint}`}}>
                  <div style={bLabel({fontSize:8})}>{x.l}</div>
                  <div style={{fontSize:18, fontWeight:'bold', color:x.c, fontVariantNumeric:'tabular-nums'}}>{x.v}</div>
                </div>
              ))}
            </div>

            {/* mini trade strip */}
            <div>
              <div style={bLabel({fontSize:8, marginBottom:4})}>LAST 30 TICKS</div>
              <div style={{display:'flex', gap:2}}>
                {recent30.length === 0
                  ? <div style={bLabel()}>NO DATA</div>
                  : recent30.map((t,i) => (
                      <div key={t.ticket??i} title={fmtMoney(netOf(t),true)} style={{
                        flex:1, height:14, maxWidth:24,
                        background: netOf(t)>0 ? C.neon : C.red,
                        cursor:'pointer',
                      }} onClick={() => openTradeDetail(t)} />
                    ))
                }
              </div>
            </div>
          </div>

          {/* COL 2: Chart canvas */}
          <div className="bcard" style={bCard()}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8}}>
              <div style={bLabel({color:C.ink})}>&gt; XAUUSD·M1·FEED</div>
              {candles.length > 0 && (
                <div style={{
                  fontSize:16, fontWeight:'bold', fontVariantNumeric:'tabular-nums',
                  color: (candles[candles.length-1]?.c >= candles[candles.length-1]?.o) ? C.neon : C.red,
                  textShadow:'0 0 10px currentColor',
                }}>
                  {candles[candles.length-1]?.c?.toFixed(2)}
                </div>
              )}
            </div>
            {/* Sessions */}
            <div style={{display:'flex', gap:4, marginBottom:10}}>
              {[
                {name:'TOKYO',  key:'tokyo',  h:'00-09'},
                {name:'LONDON', key:'london', h:'07-16'},
                {name:'NY',     key:'ny',     h:'13-22'},
              ].map(s => (
                <div key={s.key} style={{
                  flex:1, textAlign:'center', padding:'4px 2px',
                  background: sessions[s.key] ? C.neon : '#000',
                  color: sessions[s.key] ? '#000' : C.muted,
                  fontSize:9, fontWeight:'bold', letterSpacing:'2px',
                  border: sessions[s.key] ? '2px solid #00ff41' : `2px solid ${C.faint}`,
                  boxShadow: sessions[s.key] ? '0 0 10px rgba(0,255,65,0.4)' : 'none',
                }}>
                  <div>{s.name}</div>
                  <div style={{fontWeight:400, opacity:0.8}}>{s.h} UTC</div>
                </div>
              ))}
            </div>
            {candles.length < 2 ? (
              <div style={{...bLabel(), padding:'30px 0', textAlign:'center', color:C.yellow}}>
                AWAITING CANDLE DATA<br/>
                <span style={{opacity:0.6}}>تأكد من تشغيل الـ Agent</span>
              </div>
            ) : (() => {
              const last = candles.slice(-50);
              const W=420, H=210, padL=4, padR=52, padT=8, padB=8;
              const cw = (W-padL-padR)/last.length;
              const bodyW = Math.max(1.5, cw-1);
              const allH = last.flatMap(c=>[c.h,c.l]);
              const lo=Math.min(...allH), hi=Math.max(...allH);
              const range=Math.max(hi-lo,0.1);
              const Y=v=>padT+((hi-v)/range)*(H-padT-padB);
              const Cx=i=>padL+i*cw+(cw-bodyW)/2;
              const pLabels=[0,0.25,0.5,0.75,1].map(f=>lo+f*range);
              return (
                <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'auto',display:'block',background:C.bg}}>
                  {pLabels.map((p,i)=>{
                    const y=Y(p);
                    return <g key={i}>
                      <line x1={padL} y1={y} x2={W-padR} y2={y} stroke={C.faint} strokeWidth="0.5" strokeDasharray="3 3"/>
                      <text x={W-padR+4} y={y+3} fontSize="8" fill={C.muted} fontFamily={C.mono}>{p.toFixed(2)}</text>
                    </g>;
                  })}
                  {last.map((c,i)=>{
                    const bull=c.c>=c.o;
                    const col=bull?C.neon:C.red;
                    const midX=Cx(i)+bodyW/2;
                    const bTop=Y(Math.max(c.o,c.c));
                    const bBot=Y(Math.min(c.o,c.c));
                    const bH=Math.max(1,bBot-bTop);
                    return <g key={c.t??i}>
                      <line x1={midX} y1={Y(c.h)} x2={midX} y2={bTop} stroke={col} strokeWidth="1"/>
                      <rect x={Cx(i)} y={bTop} width={bodyW} height={bH} fill={col}/>
                      <line x1={midX} y1={bBot} x2={midX} y2={Y(c.l)} stroke={col} strokeWidth="1"/>
                    </g>;
                  })}
                  {positions.map((p,i)=>{
                    const y=Y(p.price_open);
                    if(y<padT||y>H-padB) return null;
                    return <g key={i}>
                      <line x1={padL} y1={y} x2={W-padR} y2={y} stroke={C.yellow} strokeWidth="1.5" strokeDasharray="5 3"/>
                      <text x={W-padR+4} y={y+3} fontSize="8" fill={C.yellow} fontFamily={C.mono} fontWeight="bold">{p.price_open?.toFixed(2)}</text>
                    </g>;
                  })}
                  {(()=>{
                    const lc=last[last.length-1];
                    const y=Y(lc.c);
                    return <g>
                      <rect x={W-padR} y={y-7} width={padR} height={14} fill={lc.c>=lc.o?C.neon:C.red}/>
                      <text x={W-padR+3} y={y+4} fontSize="8" fill="#000" fontFamily={C.mono} fontWeight="900">{lc.c?.toFixed(2)}</text>
                    </g>;
                  })()}
                </svg>
              );
            })()}

            {/* 24H PNL curve under the chart */}
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginTop:14, borderTop:C.border, paddingTop:10}}>
              <div style={bLabel({color:C.ink})}>&gt; 24H EQUITY CURVE</div>
              <div style={{fontSize:16, fontWeight:'bold', color: cum>=0?C.neon:C.red, fontVariantNumeric:'tabular-nums'}}>{fmtMoney(cum,true)}</div>
            </div>
            <svg width="100%" height="90" viewBox="0 0 400 160" preserveAspectRatio="none" style={{display:'block', marginTop:6}}>
              {cumPts.length < 2 ? (
                <text x="200" y="85" textAnchor="middle" fontSize="12" fill={C.muted} fontFamily={C.mono} letterSpacing="4">AWAITING DATA</text>
              ) : (()=>{
                const lo=Math.min(0,...cumPts), hi=Math.max(0,...cumPts);
                const range=Math.max(0.01,hi-lo);
                const X=i=>(i/(cumPts.length-1))*400;
                const Y=v=>150-((v-lo)/range)*140;
                const line=cumPts.map((v,i)=>`${i?'L':'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
                const zY=Y(0);
                const pos=cum>=0;
                return <g>
                  <line x1="0" y1={zY} x2="400" y2={zY} stroke={C.faint} strokeWidth="1" strokeDasharray="4 4"/>
                  <path d={`${line} L400,${zY.toFixed(1)} L0,${zY.toFixed(1)} Z`}
                    fill={pos?C.neon:C.red} fillOpacity="0.12"/>
                  <path d={line} fill="none" stroke={pos?C.neon:C.red} strokeWidth="2.5"/>
                  <circle cx={X(cumPts.length-1)} cy={Y(cumPts[cumPts.length-1])} r="4"
                    fill={pos?C.neon:C.red} stroke="#fff" strokeWidth="1.5"/>
                </g>;
              })()}
            </svg>
          </div>

          {/* COL 3: Pipeline steps + Claude + direction */}
          <div style={{display:'flex', flexDirection:'column', gap:'1.25rem'}}>
            <div className="bcard" style={bCard()}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, flexWrap:'wrap', gap:8}}>
                <div style={bLabel({color:C.ink})}>&gt; EXEC PIPELINE</div>
                <div style={bLabel({fontSize:8})}>
                  CYCLE <span style={{color:C.neon, fontWeight:'bold'}}>+{stats.total_trades}</span>
                </div>
              </div>
              <div style={{display:'flex', flexDirection:'column', gap:6}}>
                {pipeline.map((step)=>{
                  const isActive = step.active;
                  const isDone   = step.ok && !isActive;
                  return (
                    <div key={step.n} style={{
                      border: isActive ? '2px solid #00ff41' : isDone ? C.border : `2px solid ${C.faint}`,
                      padding:'8px 10px',
                      opacity: isDone||isActive ? 1 : 0.45,
                      background: isActive ? C.neonDim : '#000',
                      boxShadow: isActive ? '0 0 12px rgba(0,255,65,0.35)' : 'none',
                      display:'flex', alignItems:'center', gap:10,
                    }}>
                      <div style={{fontSize:11, color: isActive?C.neon:C.muted, fontWeight:'bold', letterSpacing:'2px'}}>{step.n}</div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:11, fontWeight:'bold', letterSpacing:'2px', color: isActive?C.neon:C.ink}}>{step.t}</div>
                        <div style={{fontSize:9, color:C.muted, letterSpacing:'1px'}}>{step.s}</div>
                      </div>
                      <div style={{
                        fontSize:9, fontWeight:'bold', letterSpacing:'1px',
                        color: step.last !== undefined
                          ? (step.last===null?C.muted:step.last>=0?C.neon:C.red)
                          : isActive?C.neon:isDone?C.neon:C.muted,
                        animation: isActive?'blink 1s infinite':'none',
                      }}>
                        {step.last !== undefined
                          ? (step.last===null?'LAST:--':`LAST:${fmtMoney(step.last,true)}`)
                          : isActive?'●ACTIVE':isDone?'✓READY':'IDLE'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* H1 Bias + Filters Status */}
            <div className="bcard" style={bCard({padding:'0.9rem'})}>
              <div style={bLabel({color:C.ink, marginBottom:8})}>&gt; SIGNAL FILTERS</div>
              <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                {[
                  { label:'H1 BIAS', value: data?.h1_bias_up == null ? '--' : data.h1_bias_up ? '↑ BUY' : '↓ SELL',
                    color: data?.h1_bias_up == null ? C.muted : data.h1_bias_up ? C.neon : C.red },
                  { label:'RSI', value: data?.last_rsi != null ? `${data.last_rsi}` : '--',
                    color: data?.last_rsi > 65 ? C.red : data?.last_rsi < 35 ? C.red : C.neon },
                  { label:'SPREAD', value: (() => {
                      const sp = data?.account?.spread || 0;
                      const sl = settings.SL_USD || 0;
                      const tickVal = data?.account?.tick_value || 0;
                      const tickSz  = data?.account?.tick_size  || 1;
                      const lot     = settings.LotSize || 0;
                      const spCost  = tickVal > 0 ? (sp * tickSz * (tickVal / tickSz) * lot) : 0;
                      const pct     = sl > 0 && spCost > 0 ? Math.round(spCost / sl * 100) : null;
                      return pct != null ? `${Math.round(sp)} (${pct}%SL)` : `${Math.round(sp)}`;
                    })(),
                    color: (() => {
                      const sp = data?.account?.spread || 0;
                      const sl = settings.SL_USD || 0;
                      const tickVal = data?.account?.tick_value || 0;
                      const tickSz  = data?.account?.tick_size  || 1;
                      const lot     = settings.LotSize || 0;
                      const spCost  = tickVal > 0 ? (sp * tickSz * (tickVal / tickSz) * lot) : 0;
                      const pct     = sl > 0 && spCost > 0 ? spCost / sl * 100 : 0;
                      return pct > 30 ? C.red : pct > 15 ? C.yellow : C.muted;
                    })() },
                  { label:'NEWS', value: newsFilter.blocked ? '🚫 BLOCK' : '✓ CLEAR',
                    color: newsFilter.blocked ? C.red : C.neon },
                ].map(f => (
                  <div key={f.label} style={{flex:1, minWidth:60, textAlign:'center', padding:'6px 4px', background:C.faint}}>
                    <div style={{fontSize:8, color:C.muted, letterSpacing:'2px', marginBottom:2}}>{f.label}</div>
                    <div style={{fontSize:12, fontWeight:'bold', color:f.color}}>{f.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Claude AI */}
            <div className="bcard" style={bCard({border:'2px solid #00ff41', boxShadow:'4px 4px 0px #000000'})}>
              <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:10}}>
                <span style={{fontSize:11, fontWeight:'bold', letterSpacing:'2px', color:C.neon}}>◆ CLAUDE_AI</span>
                {claudeTime && <span style={{fontSize:9, color:C.muted}}>{new Date(claudeTime).toLocaleTimeString()}</span>}
              </div>
              {claudeAdvice ? (
                <div style={{fontSize:12, fontWeight:'bold', color:C.ink, lineHeight:1.6}}>
                  "{claudeAdvice}"
                </div>
              ) : (
                <div style={{fontSize:10, color:C.muted, letterSpacing:'1px', lineHeight:1.6, textTransform:'uppercase'}}>
                  MONITORING · WILL ADVISE<br/>AFTER 5 CONSECUTIVE LOSSES
                </div>
              )}
            </div>

            {/* Pattern Analysis */}
            <div className="bcard" style={bCard({border:'2px solid #ff9900', boxShadow:'4px 4px 0px #000000'})}>
              <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginBottom:10, flexWrap:'wrap'}}>
                <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                  <span style={{fontSize:11, fontWeight:'bold', letterSpacing:'2px', color:'#ff9900'}}>◆ PATTERN_AI</span>
                  {patternTime && <span style={{fontSize:9, color:C.muted}}>updated {new Date(patternTime).toLocaleTimeString()}</span>}
                  {(settings.RSIBuyMax || settings.RSISellMin) && (
                    <span title="Claude auto-adjusted RSI thresholds" style={{
                      fontSize:9, fontFamily:C.mono, padding:'2px 7px',
                      background:'rgba(255,153,0,0.12)', border:'1px solid rgba(255,153,0,0.4)',
                      color:'#ff9900', borderRadius:2
                    }}>
                      RSI ≤{settings.RSIBuyMax??65} / ≥{settings.RSISellMin??35}
                    </span>
                  )}
                </div>
                <button className="bbtn"
                  style={{fontSize:9, padding:'4px 10px', letterSpacing:'1px',
                    border:`1px solid #ff9900`, color:'#ff9900', background:'transparent',
                    fontFamily:C.mono, fontWeight:'bold', cursor:'pointer'}}
                  onClick={async()=>{
                    try{ await fetch(`${API_URL}/api/analyze/run`,{method:'POST',headers:{'X-API-Key':API_KEY}}); }catch(e){}
                  }}>
                  ⚡ RUN NOW
                </button>
              </div>
              {patternAdvice ? (() => {
                const lines = patternAdvice.split('\n').filter(l => l.trim());
                const icons = {
                  'BEST SESSION': { icon: '🕐', color: C.neon },
                  'BEST RSI':     { icon: '📊', color: 'dodgerblue' },
                  'EMA RULE':     { icon: '📈', color: C.yellow },
                  'ACTION':       { icon: '⚡', color: C.red },
                };
                const parsed = lines.map(line => {
                  const sep = line.indexOf(':');
                  if (sep === -1) return { key: null, val: line };
                  const key = line.slice(0, sep).trim().toUpperCase();
                  const val = line.slice(sep + 1).trim();
                  return { key, val, ...icons[key] };
                });
                return (
                  <div style={{display:'flex', flexDirection:'column', gap:8}}>
                    {parsed.map((p, i) => p.key ? (
                      <div key={i} style={{
                        display:'flex', gap:10, alignItems:'flex-start',
                        padding:'8px 10px', background: C.faint,
                        borderLeft: `3px solid ${p.color || C.muted}`,
                      }}>
                        <span style={{fontSize:14, minWidth:20}}>{p.icon}</span>
                        <div>
                          <div style={{fontSize:9, color: p.color || C.muted, letterSpacing:'2px', fontWeight:'bold', marginBottom:2}}>
                            {p.key}
                          </div>
                          <div style={{fontSize:11, color: C.ink, lineHeight:1.5, fontWeight: p.key==='ACTION'?'bold':'normal'}}>
                            {p.val}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div key={i} style={{fontSize:10, color:C.muted, padding:'4px 0'}}>{p.val}</div>
                    ))}
                  </div>
                );
              })() : (
                <div style={{fontSize:10, color:C.muted, letterSpacing:'1px', lineHeight:1.8, textTransform:'uppercase'}}>
                  LEARNING MODE<br/>
                  NEEDS 10 TRADES WITH SNAPSHOTS<br/>
                  <span style={{color:C.yellow}}>ANALYSIS RUNS AUTOMATICALLY</span>
                </div>
              )}
            </div>

            {/* Direction + Order Type */}
            <div className="bcard" style={bCard()}>
              {settingsDraft && (
                <div style={{display:'flex', flexDirection:'column', gap:14}}>
                  {/* Direction */}
                  <div>
                    <div style={bLabel({marginBottom:6, color:C.ink})}>&gt; DIRECTION FILTER</div>
                    <div style={{display:'flex', flexDirection:'column', gap:6}}>
                      <select
                        value={settingsDraft.Direction??0}
                        onChange={e=>setSettingsDraft(d=>({...d,Direction:Number(e.target.value)}))}
                        style={{fontFamily:C.mono,fontSize:12,fontWeight:'bold',padding:'8px 10px',background:C.bg,border:C.border,color:C.ink,cursor:'pointer',letterSpacing:'1px'}}
                      >
                        <option value={0}>FREE (BUY + SELL)</option>
                        <option value={1}>BUY ONLY ▲</option>
                        <option value={-1}>SELL ONLY ▼</option>
                      </select>
                      <button className="bbtn" onClick={()=>saveSingle('Direction',settingsDraft.Direction??0)} disabled={busy} style={bBtn(true)}>SAVE DIRECTION</button>
                    </div>
                  </div>
                  {/* Order Type */}
                  <div style={{borderTop:C.border, paddingTop:12}}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:6}}>
                      <div style={bLabel({color:C.ink})}>&gt; ORDER TYPE</div>
                      <div style={{fontSize:9, fontWeight:'bold', letterSpacing:'1px',
                        color: [C.neon,'dodgerblue',C.yellow,'#ff9900'][(settingsDraft?.OrderType??0)] || C.neon
                      }}>
                        ACTIVE: {['MARKET','LIMIT','STOP','BASKET'][(settingsDraft?.OrderType??0)]||'MARKET'}
                      </div>
                    </div>
                    <div style={{display:'flex', flexDirection:'column', gap:6}}>
                      <select
                        value={settingsDraft?.OrderType??0}
                        onChange={e=>{ settingsDirty.current=true; setSettingsDraft(d=>({...d,OrderType:Number(e.target.value)})); }}
                        style={{fontFamily:C.mono,fontSize:12,fontWeight:'bold',padding:'8px 10px',background:C.bg,border:C.border,color:C.ink,cursor:'pointer',letterSpacing:'1px'}}
                      >
                        <option value={0}>⚡ MARKET — دخول فوري</option>
                        <option value={1}>↩ LIMIT — ينتظر pullback</option>
                        <option value={2}>🚀 STOP — كسر High/Low</option>
                        <option value={3}>🎯 BASKET — 3 أوردرات دفعة</option>
                      </select>
                      <div style={{fontSize:9, color:C.muted, letterSpacing:'1px', lineHeight:1.5}}>
                        {(settingsDraft?.OrderType??0)===0 && 'يفتح الصفقة فوراً بسعر السوق'}
                        {(settingsDraft?.OrderType??0)===1 && 'يضع LIMIT عند close الشمعة · ينتظر رجوع السعر'}
                        {(settingsDraft?.OrderType??0)===2 && 'يضع STOP فوق HIGH / تحت LOW · يدخل عند الكسر'}
                        {(settingsDraft?.OrderType??0)===3 && 'MARKET + STOP + LIMIT دفعة واحدة · أسرع للحركات القوية'}
                      </div>
                      <button className="bbtn"
                        onClick={()=>saveSingle('OrderType', settingsDraft?.OrderType??0)}
                        disabled={busy}
                        style={bBtn(true)}>
                        {busy ? 'SAVING...' : 'SAVE ORDER TYPE'}
                      </button>
                    </div>
                  </div>

                  {/* LOT SIZE MODE */}
                  <div style={{borderTop:C.border, paddingTop:12}}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
                      <div style={bLabel({color:C.ink})}>&gt; LOT SIZE MODE</div>
                      <div style={{
                        fontSize:9, fontWeight:'bold', letterSpacing:'1px',
                        padding:'2px 8px',
                        border:`1px solid ${(settingsDraft?.RiskMode??0)===1?C.yellow:C.neon}`,
                        color: (settingsDraft?.RiskMode??0)===1?C.yellow:C.neon,
                      }}>
                        {(settingsDraft?.RiskMode??0)===1?'DYNAMIC':'FIXED'}
                      </div>
                    </div>
                    <div style={{display:'flex', gap:8, marginBottom:8}}>
                      {[{v:0,label:'🔒 FIXED'},{v:1,label:'📈 DYNAMIC'}].map(opt=>(
                        <button key={opt.v} className="bbtn"
                          onClick={()=>{settingsDirty.current=true; setSettingsDraft(d=>({...d,RiskMode:opt.v}));}}
                          style={{...bBtn((settingsDraft?.RiskMode??0)===opt.v,{flex:1,fontSize:10,padding:'6px 4px'})}}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {(settingsDraft?.RiskMode??0)===1 && (
                      <div style={{display:'flex', flexDirection:'column', gap:6}}>
                        <div style={{display:'flex', alignItems:'center', gap:8}}>
                          <div style={bLabel({color:C.muted})}>RISK PER TRADE</div>
                          <div style={{fontSize:13, fontWeight:'bold', color:C.yellow, fontFamily:C.mono}}>
                            {(settingsDraft?.RiskPercent??1).toFixed(1)}%
                          </div>
                        </div>
                        <input type="range" min="0.1" max="5" step="0.1"
                          value={settingsDraft?.RiskPercent??1}
                          onChange={e=>{settingsDirty.current=true; setSettingsDraft(d=>({...d,RiskPercent:Number(e.target.value)}));}}
                          style={{width:'100%', accentColor:C.yellow}}
                        />
                        <div style={{display:'flex', justifyContent:'space-between', fontSize:9, color:C.muted}}>
                          <span>0.1% آمن</span><span>1% متوازن</span><span>5% خطر</span>
                        </div>
                        <div style={{fontSize:10, color:C.muted, lineHeight:1.5}}>
                          لوت = (رصيدك × {(settingsDraft?.RiskPercent??1).toFixed(1)}%) ÷ SL$
                        </div>
                      </div>
                    )}
                    <button className="bbtn"
                      onClick={()=>{
                        saveSingle('RiskMode', settingsDraft?.RiskMode??0);
                        if((settingsDraft?.RiskMode??0)===1)
                          saveSingle('RiskPercent', settingsDraft?.RiskPercent??1);
                      }}
                      disabled={busy}
                      style={bBtn(false,{marginTop:8,width:'100%',borderColor:C.yellow,color:C.yellow})}>
                      {busy?'SAVING...':'SAVE LOT MODE'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ═══ OPEN POSITIONS ═════════════════════════════════ */}
        <div className="bcard" style={bCard({marginBottom:'1.25rem'})}>
          <div style={{display:'flex', gap:12, alignItems:'baseline', marginBottom:10, flexWrap:'wrap'}}>
            <span style={{fontSize:12, fontWeight:'bold', letterSpacing:'2px', color:C.ink}}>
              <span style={{
                display:'inline-block', width:8, height:8, marginRight:8,
                background: positions.length?C.neon:C.faint,
                boxShadow: positions.length?'0 0 8px #00ff41':'none',
                animation: positions.length?'blink 2s infinite':'none',
              }}/>
              &gt; OPEN POSITIONS
            </span>
            <span style={bLabel()}>{positions.length} open · total <span style={{color:openTotal>=0?C.neon:C.red}}>{fmtMoney(openTotal,true)}</span></span>
          </div>
          {positions.length === 0 ? (
            <div style={bLabel({padding:'12px 0', color:C.yellow})}>NO OPEN POSITIONS · MONITORING MARKET_</div>
          ) : (
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:520}}>
                <thead>
                  <tr style={{borderBottom:'1px solid #30363d'}}>
                    {['SYMBOL','TYPE','VOL','ENTRY','PROFIT','AGE'].map(h=>(
                      <th key={h} style={{...bLabel({padding:'6px 8px', textAlign:'left', color:C.neon})}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p,i)=>{
                    const buy=p.type==='BUY';
                    const si=symInfo(p.symbol);
                    return (
                      <tr key={p.ticket??i} className="hrow" style={{
                        borderBottom:`1px solid ${C.faint}`,
                        borderLeft:`4px solid ${si.color}`,
                        cursor:'pointer',
                      }} onClick={()=>openTradeDetail(p)}>
                        <td style={{padding:'8px 8px'}}>
                          <span style={{fontSize:15, marginRight:5}}>{si.icon}</span>
                          <span style={{fontWeight:'bold', color:si.color, letterSpacing:'1px', fontSize:11}}>{p.symbol||si.label}</span>
                        </td>
                        <td style={{padding:'8px 8px', fontWeight:'bold', color:buy?C.neon:C.red, letterSpacing:'2px'}}>{p.type}</td>
                        <td style={{padding:'8px 8px'}}>{p.volume}</td>
                        <td style={{padding:'8px 8px', fontVariantNumeric:'tabular-nums'}}>{p.price_open}</td>
                        <td style={{padding:'8px 8px', fontWeight:'bold', color:(p.profit||0)>=0?C.neon:C.red, fontVariantNumeric:'tabular-nums'}}>
                          {fmtMoney(p.profit,true)}
                        </td>
                        <td style={{padding:'8px 8px', color:C.muted}}>{ageStr(p.time)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ═══ PENDING ORDERS ══════════════════════════════════ */}
        <div className="bcard" style={bCard({marginBottom:'1.25rem'})}>
          <div style={{display:'flex', gap:12, alignItems:'baseline', marginBottom:10, flexWrap:'wrap'}}>
            <span style={{fontSize:12, fontWeight:'bold', letterSpacing:'2px', color:C.ink}}>
              <span style={{
                display:'inline-block', width:8, height:8, marginRight:8,
                background: pendingOrders.length?C.yellow:C.faint,
                boxShadow: pendingOrders.length?'0 0 8px #f0b429':'none',
              }}/>
              &gt; PENDING ORDERS
            </span>
            <span style={bLabel()}>{pendingOrders.length} pending</span>
          </div>
          {pendingOrders.length === 0 ? (
            <div style={bLabel({padding:'12px 0', color:C.muted})}>NO PENDING ORDERS · WAITING FOR SETUP_</div>
          ) : (
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:560}}>
                <thead>
                  <tr style={{borderBottom:'1px solid #30363d'}}>
                    {['#TICKET','TYPE','SYM','VOL','PRICE','SL','TP','EXPIRY'].map(h=>(
                      <th key={h} style={{...bLabel({padding:'6px 8px', textAlign:'left', color:C.yellow})}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pendingOrders.map((o,i)=>{
                    const isBuy = o.type?.includes('BUY');
                    return (
                      <tr key={o.ticket??i} style={{borderBottom:`1px solid ${C.faint}`, borderLeft:`4px solid ${isBuy?C.neon:C.red}`}}>
                        <td style={{padding:'8px 8px', color:C.muted}}>#{o.ticket}</td>
                        <td style={{padding:'8px 8px', fontWeight:'bold', color:isBuy?C.neon:C.red, letterSpacing:'1px'}}>{o.type}</td>
                        <td style={{padding:'8px 8px', color:C.yellow}}>{o.symbol}</td>
                        <td style={{padding:'8px 8px'}}>{o.volume}</td>
                        <td style={{padding:'8px 8px', fontVariantNumeric:'tabular-nums'}}>{o.price?.toFixed?.(o.price>100?2:5)??o.price}</td>
                        <td style={{padding:'8px 8px', color:C.red, fontVariantNumeric:'tabular-nums'}}>{o.sl||'--'}</td>
                        <td style={{padding:'8px 8px', color:C.neon, fontVariantNumeric:'tabular-nums'}}>{o.tp||'--'}</td>
                        <td style={{padding:'8px 8px', color:C.muted, fontSize:10}}>{o.expiry?o.expiry.replace('T',' ').slice(0,16):'--'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ═══ SETTINGS ═══════════════════════════════════════ */}
        <div className="bcard" style={bCard({marginBottom:'1.25rem'})}>
          <div
            onClick={()=>setShowSettings(s=>!s)}
            style={{cursor:'pointer', fontSize:12, fontWeight:'bold', letterSpacing:'2px', userSelect:'none', display:'flex', alignItems:'center', gap:12, color:C.ink}}
          >
            &gt; SETTINGS {showSettings?'[-]':'[+]'}
            {saveMsg && (
              <span style={{
                fontSize:10, fontWeight:'bold',
                color: saveMsg.includes('ERROR')?C.red:C.neon,
                letterSpacing:'2px',
              }}>{saveMsg}</span>
            )}
          </div>
          {showSettings && (
            <div style={{display:'flex', gap:'1.25rem', marginTop:14, flexWrap:'wrap', alignItems:'flex-start'}}>
              {/* ── GOLD SETTINGS PANEL ── */}
              {settingsDraft && (
                <div style={{flex:'1 1 340px', minWidth:300, background:C.bg, border:'1px solid rgba(255,204,0,0.4)', padding:'1rem'}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
                  <div style={{fontSize:11, fontWeight:'bold', letterSpacing:'2px', color:'#ffd700'}}>⚙ GOLD SETTINGS</div>
                  <div style={{display:'flex', gap:6}}>
                    <button className="bbtn" disabled={busy} onClick={()=>applyPreset(HFT_PRESET,false)}
                      style={{fontSize:9,padding:'3px 10px',letterSpacing:'1px',border:'1px solid #ff6b35',color:'#ff6b35',background:'transparent',fontFamily:'monospace',cursor:'pointer'}}>
                      ⚡ HFT
                    </button>
                    <button className="bbtn" disabled={busy} onClick={()=>applyPreset(NORM_PRESET,false)}
                      style={{fontSize:9,padding:'3px 10px',letterSpacing:'1px',border:'1px solid #ffd700',color:'#ffd700',background:'transparent',fontFamily:'monospace',cursor:'pointer'}}>
                      🔄 NORMAL
                    </button>
                    <button className="bbtn" onClick={()=>exportSettings(false)}
                      style={{fontSize:9,padding:'3px 8px',letterSpacing:'1px',border:'1px solid #555',color:'#aaa',background:'transparent',fontFamily:'monospace',cursor:'pointer'}}
                      title="تحميل الإعدادات كملف JSON">💾</button>
                    <button className="bbtn" onClick={()=>importSettings(false)}
                      style={{fontSize:9,padding:'3px 8px',letterSpacing:'1px',border:'1px solid #555',color:'#aaa',background:'transparent',fontFamily:'monospace',cursor:'pointer'}}
                      title="تحميل إعدادات من ملف JSON">📂</button>
                  </div>
                </div>
                  <div style={{display:'flex', gap:10, flexWrap:'wrap', alignItems:'flex-end'}}>
                    {settingKeys.map(k=>(
                      <div key={k} style={{display:'flex', flexDirection:'column', gap:4}}>
                        <div style={bLabel({fontSize:9, color:C.yellow})}>{k}</div>
                        <input
                          type="number" step="any"
                          value={settingsDraft[k]??''}
                          onChange={e=>{settingsDirty.current=true;setSettingsDraft(d=>({...d,[k]:e.target.value===''?'':Number(e.target.value)}));}}
                          style={{fontFamily:C.mono, fontSize:12, width:88, padding:'6px 8px', background:'#0d1117', border:'1px solid rgba(255,204,0,0.4)', color:C.neon}}
                        />
                        <button className="bbtn" onClick={()=>saveSingle(k,settingsDraft[k])} disabled={busy}
                          style={bBtn(false,{fontSize:9,padding:'4px 6px',letterSpacing:'1px'})}>SAVE</button>
                      </div>
                    ))}
                    {/* Gold Claude toggle */}
                    <div style={{display:'flex', flexDirection:'column', gap:4}}>
                      <div style={bLabel({fontSize:9, color:C.yellow})}>CLAUDE AI</div>
                      <button className="bbtn"
                        onClick={()=>{ const v=(settingsDraft.ClaudeEnabled??1)===1?0:1; setSettingsDraft(d=>({...d,ClaudeEnabled:v})); saveSingle('ClaudeEnabled',v); }}
                        style={bBtn((settingsDraft.ClaudeEnabled??1)===1,{padding:'6px 14px'})}>
                        {(settingsDraft.ClaudeEnabled??1)===1?'ON':'OFF'}
                      </button>
                    </div>
                    {/* Gold BotRunning toggle */}
                    <div style={{display:'flex', flexDirection:'column', gap:4}}>
                      <div style={bLabel({fontSize:9, color:C.yellow})}>BOT ON/OFF</div>
                      <button className="bbtn"
                        onClick={()=>{ const v=(settingsDraft.BotRunning??1)===1?0:1; setSettingsDraft(d=>({...d,BotRunning:v})); saveSingle('BotRunning',v); }}
                        style={bBtn((settingsDraft.BotRunning??1)===1,{padding:'6px 14px'})}>
                        {(settingsDraft.BotRunning??1)===1?'ON':'OFF'}
                      </button>
                    </div>
                    {/* Gold H1 Filter toggle */}
                    <div style={{display:'flex', flexDirection:'column', gap:4}}>
                      <div style={bLabel({fontSize:9, color:'#f0a500'})}>H1 BIAS FILTER</div>
                      <button className="bbtn"
                        onClick={()=>{ const v=(settingsDraft.UseH1Filter??1)===1?0:1; setSettingsDraft(d=>({...d,UseH1Filter:v})); saveSingle('UseH1Filter',v); }}
                        style={bBtn((settingsDraft.UseH1Filter??1)===1,{padding:'6px 14px', borderColor:'#f0a500', color:(settingsDraft.UseH1Filter??1)===1?'#000':'#f0a500'})}>
                        {(settingsDraft.UseH1Filter??1)===1?'ON':'OFF'}
                      </button>
                      <div style={{fontSize:8, color:C.muted, textAlign:'center'}}>H1 EMA21</div>
                    </div>
                    {/* Gold RSI Filter toggle */}
                    <div style={{display:'flex', flexDirection:'column', gap:4}}>
                      <div style={bLabel({fontSize:9, color:'#f0a500'})}>RSI FILTER</div>
                      <button className="bbtn"
                        onClick={()=>{ const v=(settingsDraft.UseRSIFilter??1)===1?0:1; setSettingsDraft(d=>({...d,UseRSIFilter:v})); saveSingle('UseRSIFilter',v); }}
                        style={bBtn((settingsDraft.UseRSIFilter??1)===1,{padding:'6px 14px', borderColor:'#f0a500', color:(settingsDraft.UseRSIFilter??1)===1?'#000':'#f0a500'})}>
                        {(settingsDraft.UseRSIFilter??1)===1?'ON':'OFF'}
                      </button>
                      <div style={{fontSize:8, color:C.muted, textAlign:'center'}}>RSI BUY/SELL</div>
                    </div>
                  </div>

                  {/* ── STRATEGY SECTION ── */}
                  <div style={{borderTop:'1px solid rgba(255,153,0,0.3)', paddingTop:12, marginTop:4}}>
                    <div style={{fontSize:10, fontWeight:'bold', letterSpacing:'2px', color:'#ff9900', marginBottom:10}}>⚡ STRATEGY</div>
                    <div style={{display:'flex', gap:6, marginBottom:10}}>
                      {[
                        {bit:1, label:'GRID',  sub:'مستويات'},
                        {bit:2, label:'HEDGE', sub:'تحوط'},
                        {bit:4, label:'SCALE', sub:'تضاعف'},
                      ].map(s => {
                        const active = ((settingsDraft.StrategyMode??0) & s.bit) !== 0;
                        return (
                          <button key={s.bit} className="bbtn"
                            onClick={()=>{
                              const v=(settingsDraft.StrategyMode??0)^s.bit;
                              setSettingsDraft(d=>({...d,StrategyMode:v}));
                              saveSingle('StrategyMode',v);
                            }}
                            style={{...bBtn(active,{flex:1,padding:'8px 4px',borderColor:'#ff9900',color:active?'#000':'#ff9900'})}}>
                            <div style={{fontSize:10,fontWeight:'bold'}}>{s.label}</div>
                            <div style={{fontSize:8,opacity:0.8}}>{s.sub}</div>
                          </button>
                        );
                      })}
                    </div>
                    {/* Grid params */}
                    {((settingsDraft.StrategyMode??0) & 1) ? (
                      <div style={{padding:'8px',background:C.faint,marginBottom:6}}>
                        <div style={{fontSize:9,color:'#ff9900',letterSpacing:'2px',marginBottom:6}}>GRID — مستويات الدخول</div>
                        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                          {[{k:'GridLevels',label:'LEVELS',step:'1'},{k:'GridStep',label:'STEP (pts)',step:'10'}].map(f=>(
                            <div key={f.k} style={{display:'flex',flexDirection:'column',gap:3}}>
                              <div style={bLabel({fontSize:8})}>{f.label}</div>
                              <input type="number" step={f.step} value={settingsDraft[f.k]??''} onChange={e=>{settingsDirty.current=true;setSettingsDraft(d=>({...d,[f.k]:Number(e.target.value)}));}}
                                style={{fontFamily:C.mono,fontSize:12,width:72,padding:'4px 6px',background:'#0d1117',border:'1px solid rgba(255,153,0,0.4)',color:'#ff9900'}}
                              />
                              <button className="bbtn" onClick={()=>saveSingle(f.k,settingsDraft[f.k])} disabled={busy}
                                style={bBtn(false,{fontSize:8,padding:'3px 6px',borderColor:'rgba(255,153,0,0.5)',color:'#ff9900'})}>SAVE</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {/* Hedge params */}
                    {((settingsDraft.StrategyMode??0) & 2) ? (
                      <div style={{padding:'8px',background:C.faint,marginBottom:6}}>
                        <div style={{fontSize:9,color:'#ff9900',letterSpacing:'2px',marginBottom:6}}>HEDGE — صفقة معاكسة</div>
                        <div style={{display:'flex',gap:8}}>
                          <div style={{display:'flex',flexDirection:'column',gap:3}}>
                            <div style={bLabel({fontSize:8})}>HEDGE LOT ×</div>
                            <input type="number" step="0.1" min="0.1" max="2" value={settingsDraft.HedgeLotMult??0.5} onChange={e=>{settingsDirty.current=true;setSettingsDraft(d=>({...d,HedgeLotMult:Number(e.target.value)}));}}
                              style={{fontFamily:C.mono,fontSize:12,width:72,padding:'4px 6px',background:'#0d1117',border:'1px solid rgba(255,153,0,0.4)',color:'#ff9900'}}
                            />
                            <button className="bbtn" onClick={()=>saveSingle('HedgeLotMult',settingsDraft.HedgeLotMult)} disabled={busy}
                              style={bBtn(false,{fontSize:8,padding:'3px 6px',borderColor:'rgba(255,153,0,0.5)',color:'#ff9900'})}>SAVE</button>
                          </div>
                          <div style={{fontSize:9,color:C.muted,alignSelf:'center',lineHeight:1.5}}>
                            مثال: 0.5 = نص اللوت<br/>في الاتجاه الثاني
                          </div>
                        </div>
                      </div>
                    ) : null}
                    {/* Scale params */}
                    {((settingsDraft.StrategyMode??0) & 4) ? (
                      <div style={{padding:'8px',background:C.faint,marginBottom:6}}>
                        <div style={{fontSize:9,color:'#ff9900',letterSpacing:'2px',marginBottom:6}}>SCALE — تضاعف عند الخسارة</div>
                        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                          {[{k:'ScaleStep',label:'STEP (pts)',step:'10'},{k:'ScaleMult',label:'LOT ×',step:'0.1'},{k:'MaxScales',label:'MAX',step:'1'}].map(f=>(
                            <div key={f.k} style={{display:'flex',flexDirection:'column',gap:3}}>
                              <div style={bLabel({fontSize:8})}>{f.label}</div>
                              <input type="number" step={f.step} value={settingsDraft[f.k]??''} onChange={e=>{settingsDirty.current=true;setSettingsDraft(d=>({...d,[f.k]:Number(e.target.value)}));}}
                                style={{fontFamily:C.mono,fontSize:12,width:72,padding:'4px 6px',background:'#0d1117',border:'1px solid rgba(255,153,0,0.4)',color:'#ff9900'}}
                              />
                              <button className="bbtn" onClick={()=>saveSingle(f.k,settingsDraft[f.k])} disabled={busy}
                                style={bBtn(false,{fontSize:8,padding:'3px 6px',borderColor:'rgba(255,153,0,0.5)',color:'#ff9900'})}>SAVE</button>
                            </div>
                          ))}
                        </div>
                        <div style={{fontSize:8,color:C.red,marginTop:6,letterSpacing:'1px'}}>⚠ SCALE يزيد المخاطرة — استخدم بحذر</div>
                      </div>
                    ) : null}
                    {(settingsDraft.StrategyMode??0)===0 && (
                      <div style={{fontSize:9,color:C.muted,textAlign:'center',padding:'4px 0'}}>
                        NORMAL MODE — اضغط استراتيجية لتفعيلها
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── BTC SETTINGS PANEL ── */}
              <div style={{flex:'1 1 340px', minWidth:300, background:C.bg, border:'1px solid rgba(0,170,255,0.4)', padding:'1rem'}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
                  <div style={{fontSize:11, fontWeight:'bold', letterSpacing:'2px', color:'#00aaff'}}>₿ BTC SETTINGS</div>
                  <div style={{display:'flex', gap:6}}>
                    <button className="bbtn" disabled={busy} onClick={()=>applyPreset(HFT_PRESET,true)}
                      style={{fontSize:9,padding:'3px 10px',letterSpacing:'1px',border:'1px solid #ff6b35',color:'#ff6b35',background:'transparent',fontFamily:'monospace',cursor:'pointer'}}>
                      ⚡ HFT
                    </button>
                    <button className="bbtn" disabled={busy} onClick={()=>applyPreset(NORM_PRESET,true)}
                      style={{fontSize:9,padding:'3px 10px',letterSpacing:'1px',border:'1px solid #00aaff',color:'#00aaff',background:'transparent',fontFamily:'monospace',cursor:'pointer'}}>
                      🔄 NORMAL
                    </button>
                    <button className="bbtn" onClick={()=>exportSettings(true)}
                      style={{fontSize:9,padding:'3px 8px',letterSpacing:'1px',border:'1px solid #555',color:'#aaa',background:'transparent',fontFamily:'monospace',cursor:'pointer'}}
                      title="تحميل الإعدادات كملف JSON">💾</button>
                    <button className="bbtn" onClick={()=>importSettings(true)}
                      style={{fontSize:9,padding:'3px 8px',letterSpacing:'1px',border:'1px solid #555',color:'#aaa',background:'transparent',fontFamily:'monospace',cursor:'pointer'}}
                      title="تحميل إعدادات من ملف JSON">📂</button>
                  </div>
                </div>
                <div style={{display:'flex', gap:10, flexWrap:'wrap', alignItems:'flex-end'}}>
                  {['LotSize','TP_USD','SL_USD','MaxSpread','MaxPositions','CooldownSecs','MaxLossPerDay','MaxProfitPerDay','TradeHoursStart','TradeHoursEnd','RSIBuyMax','RSISellMin'].map(k=>(
                    <div key={k} style={{display:'flex', flexDirection:'column', gap:4}}>
                      <div style={bLabel({fontSize:9, color:'#00aaff'})}>{k}</div>
                      <input
                        type="number" step="any"
                        value={btcSettingsDraft[k]??''}
                        onChange={e=>{btcSettingsDirty.current=true;setBtcSettingsDraft(d=>({...d,[k]:e.target.value===''?'':Number(e.target.value)}));}}
                        style={{fontFamily:C.mono, fontSize:12, width:88, padding:'6px 8px', background:'#0d1117', border:'1px solid rgba(0,170,255,0.4)', color:'#00aaff'}}
                      />
                      <button className="bbtn" onClick={()=>saveBtcSingle(k,btcSettingsDraft[k])} disabled={busy}
                        style={bBtn(false,{fontSize:9,padding:'4px 6px',letterSpacing:'1px',borderColor:'rgba(0,170,255,0.5)',color:'#00aaff'})}>SAVE</button>
                    </div>
                  ))}
                  {/* BTC BotRunning toggle */}
                  <div style={{display:'flex', flexDirection:'column', gap:4}}>
                    <div style={bLabel({fontSize:9, color:'#00aaff'})}>BOT ON/OFF</div>
                    <button className="bbtn"
                      onClick={()=>{ const v=(btcSettingsDraft.BotRunning??1)===1?0:1; setBtcSettingsDraft(d=>({...d,BotRunning:v})); saveBtcSingle('BotRunning',v); }}
                      style={bBtn((btcSettingsDraft.BotRunning??1)===1,{padding:'6px 14px', borderColor:'#00aaff', color:(btcSettingsDraft.BotRunning??1)===1?'#000':'#00aaff'})}>
                      {(btcSettingsDraft.BotRunning??1)===1?'ON':'OFF'}
                    </button>
                  </div>
                  {/* BTC H1 Filter toggle */}
                  <div style={{display:'flex', flexDirection:'column', gap:4}}>
                    <div style={bLabel({fontSize:9, color:'#f0a500'})}>H1 BIAS FILTER</div>
                    <button className="bbtn"
                      onClick={()=>{ const v=(btcSettingsDraft.UseH1Filter??1)===1?0:1; setBtcSettingsDraft(d=>({...d,UseH1Filter:v})); saveBtcSingle('UseH1Filter',v); }}
                      style={bBtn((btcSettingsDraft.UseH1Filter??1)===1,{padding:'6px 14px', borderColor:'#f0a500', color:(btcSettingsDraft.UseH1Filter??1)===1?'#000':'#f0a500'})}>
                      {(btcSettingsDraft.UseH1Filter??1)===1?'ON':'OFF'}
                    </button>
                    <div style={{fontSize:8, color:C.muted, textAlign:'center'}}>H1 EMA21</div>
                  </div>
                  {/* BTC RSI Filter toggle */}
                  <div style={{display:'flex', flexDirection:'column', gap:4}}>
                    <div style={bLabel({fontSize:9, color:'#f0a500'})}>RSI FILTER</div>
                    <button className="bbtn"
                      onClick={()=>{ const v=(btcSettingsDraft.UseRSIFilter??1)===1?0:1; setBtcSettingsDraft(d=>({...d,UseRSIFilter:v})); saveBtcSingle('UseRSIFilter',v); }}
                      style={bBtn((btcSettingsDraft.UseRSIFilter??1)===1,{padding:'6px 14px', borderColor:'#f0a500', color:(btcSettingsDraft.UseRSIFilter??1)===1?'#000':'#f0a500'})}>
                      {(btcSettingsDraft.UseRSIFilter??1)===1?'ON':'OFF'}
                    </button>
                    <div style={{fontSize:8, color:C.muted, textAlign:'center'}}>RSI BUY/SELL</div>
                  </div>
                </div>
                {/* BTC LOT SIZE MODE */}
                <div style={{borderTop:'1px solid rgba(0,170,255,0.3)', marginTop:12, paddingTop:12}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
                    <div style={bLabel({color:'#00aaff'})}>&gt; LOT SIZE MODE</div>
                    <div style={{
                      fontSize:9, fontWeight:'bold', letterSpacing:'1px',
                      padding:'2px 8px',
                      border:`1px solid ${(btcSettingsDraft?.RiskMode??0)===1?C.yellow:'#00aaff'}`,
                      color: (btcSettingsDraft?.RiskMode??0)===1?C.yellow:'#00aaff',
                    }}>
                      {(btcSettingsDraft?.RiskMode??0)===1?'DYNAMIC':'FIXED'}
                    </div>
                  </div>
                  <div style={{display:'flex', gap:8, marginBottom:8}}>
                    {[{v:0,label:'🔒 FIXED'},{v:1,label:'📈 DYNAMIC'}].map(opt=>(
                      <button key={opt.v} className="bbtn"
                        onClick={()=>{btcSettingsDirty.current=true; setBtcSettingsDraft(d=>({...d,RiskMode:opt.v}));}}
                        style={{...bBtn((btcSettingsDraft?.RiskMode??0)===opt.v,{flex:1,fontSize:10,padding:'6px 4px',borderColor:'#00aaff',color:(btcSettingsDraft?.RiskMode??0)===opt.v?'#000':'#00aaff'})}}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {(btcSettingsDraft?.RiskMode??0)===0 && (
                    <div style={{display:'flex', flexDirection:'column', gap:4, marginBottom:8}}>
                      <div style={bLabel({fontSize:9, color:'#00aaff'})}>BASE LOT</div>
                      <input
                        type="number" step="0.01" min="0.01"
                        value={btcSettingsDraft.BaseLot??0.01}
                        onChange={e=>{btcSettingsDirty.current=true; setBtcSettingsDraft(d=>({...d,BaseLot:e.target.value===''?'':Number(e.target.value)}));}}
                        style={{fontFamily:C.mono, fontSize:12, width:88, padding:'6px 8px', background:'#0d1117', border:'1px solid rgba(0,170,255,0.4)', color:'#00aaff'}}
                      />
                    </div>
                  )}
                  {(btcSettingsDraft?.RiskMode??0)===1 && (
                    <div style={{display:'flex', flexDirection:'column', gap:6, marginBottom:8}}>
                      <div style={{display:'flex', alignItems:'center', gap:8}}>
                        <div style={bLabel({color:C.muted})}>RISK PER TRADE</div>
                        <div style={{fontSize:13, fontWeight:'bold', color:C.yellow, fontFamily:C.mono}}>
                          {(btcSettingsDraft?.RiskPercent??1).toFixed(1)}%
                        </div>
                      </div>
                      <input type="range" min="0.1" max="5" step="0.1"
                        value={btcSettingsDraft?.RiskPercent??1}
                        onChange={e=>{btcSettingsDirty.current=true; setBtcSettingsDraft(d=>({...d,RiskPercent:Number(e.target.value)}));}}
                        style={{width:'100%', accentColor:C.yellow}}
                      />
                      <div style={{display:'flex', justifyContent:'space-between', fontSize:9, color:C.muted}}>
                        <span>0.1% آمن</span><span>1% متوازن</span><span>5% خطر</span>
                      </div>
                      <div style={{fontSize:10, color:C.muted, lineHeight:1.5}}>
                        لوت = (رصيدك × {(btcSettingsDraft?.RiskPercent??1).toFixed(1)}%) ÷ SL$
                      </div>
                    </div>
                  )}
                  <button className="bbtn"
                    onClick={()=>{
                      saveBtcSingle('RiskMode', btcSettingsDraft?.RiskMode??0);
                      if((btcSettingsDraft?.RiskMode??0)===0)
                        saveBtcSingle('BaseLot', btcSettingsDraft?.BaseLot??0.01);
                      if((btcSettingsDraft?.RiskMode??0)===1)
                        saveBtcSingle('RiskPercent', btcSettingsDraft?.RiskPercent??1);
                    }}
                    disabled={busy}
                    style={bBtn(false,{marginTop:4,width:'100%',borderColor:'#00aaff',color:'#00aaff'})}>
                    {busy?'SAVING...':'SAVE LOT MODE'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ═══ HEDGE BOT SETTINGS ════════════════════════════ */}
        <div className="bcard" style={bCard()}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
            <div style={{fontSize:11, fontWeight:'bold', letterSpacing:'2px', color:'#ff4444'}}>⚔ GOLD HEDGE SCALPER</div>
            <div style={{display:'flex', gap:10, alignItems:'center'}}>
              {hedgeSaveMsg && <span style={{fontSize:9, color: hedgeSaveMsg.includes('ERROR')?C.red:'#ff8888', fontFamily:C.mono}}>{hedgeSaveMsg}</span>}
              <div style={{fontSize:9, color:C.muted}}>GSX_Hedge.json</div>
            </div>
          </div>
          {/* BOT ON/OFF */}
          <div style={{display:'flex', gap:10, alignItems:'center', marginBottom:12}}>
            <div style={{fontSize:9, color:C.muted, letterSpacing:'1px'}}>BOT</div>
            <button className="bbtn"
              onClick={()=>{ const v=(hedgeSettingsDraft.BotRunning??1)===1?0:1; setHedgeSettingsDraft(d=>({...d,BotRunning:v})); saveHedgeSingle('BotRunning',v); }}
              style={bBtn((hedgeSettingsDraft.BotRunning??1)===1,{padding:'5px 18px', borderColor:'#ff4444', color:(hedgeSettingsDraft.BotRunning??1)===1?'#000':'#ff4444'})}>
              {(hedgeSettingsDraft.BotRunning??1)===1?'ON':'OFF'}
            </button>
          </div>
          {/* fields */}
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:8}}>
            {[
              {k:'BaseLot',       label:'BASE LOT',         step:0.01, min:0.01},
              {k:'LotMultiplier', label:'LOT MULTIPLIER',   step:0.1,  min:1.1},
              {k:'HedgeDistUSD',  label:'HEDGE DIST $',     step:0.5,  min:0.5},
              {k:'BasketTP',      label:'BASKET TP $',      step:0.5,  min:0.1},
              {k:'TrailPct',      label:'TRAIL % (0=off)',  step:5,    min:0},
              {k:'PartialPct',    label:'PARTIAL % (0=off)',step:10,   min:0},
              {k:'MaxDrawdown',   label:'MAX DRAWDOWN $',   step:5,    min:5},
              {k:'MaxLevels',     label:'MAX LEVELS',       step:1,    min:1},
              {k:'MaxSpread',     label:'MAX SPREAD',       step:10,   min:10},
            ].map(({k,label,step,min}) => (
              <div key={k} style={{display:'flex',flexDirection:'column',gap:3}}>
                <div style={bLabel({fontSize:9,color:'#ff8888'})}>{label}</div>
                <div style={{display:'flex',gap:4}}>
                  <input type="number" step={step} min={min}
                    value={hedgeSettingsDraft[k]??''}
                    onChange={e=>{hedgeSettingsDirty.current=true; setHedgeSettingsDraft(d=>({...d,[k]:e.target.value===''?'':Number(e.target.value)}));}}
                    style={{width:80,background:C.bg,border:`1px solid #ff4444`,color:C.ink,fontFamily:C.mono,fontSize:10,padding:'4px 6px',borderRadius:3}}
                  />
                  <button className="bbtn" onClick={()=>saveHedgeSingle(k,hedgeSettingsDraft[k])} disabled={hedgeBusy}
                    style={{fontSize:9,padding:'4px 8px',border:`1px solid #ff4444`,color:'#ff4444',background:'transparent',fontFamily:C.mono,cursor:'pointer'}}>✓</button>
                </div>
              </div>
            ))}
          </div>
          <div style={{marginTop:10, fontSize:9, color:C.muted, lineHeight:1.6}}>
            ⚡ منطق: دخول بزخم شمعة → إذا خسرت صفقة &gt; HEDGE DIST$ تفتح معاكسة بـ LOT×MULT → إغلاق الكل لما الربح الإجمالي &ge; BASKET TP$
          </div>
        </div>

        {/* ═══ GRX BOT SETTINGS ═══════════════════════════════ */}
        <div className="bcard" style={bCard()}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
            <div style={{fontSize:11, fontWeight:'bold', letterSpacing:'2px', color:'#f0b429'}}>◆ GOLD RANGE SCALPER (GRX)</div>
            <div style={{display:'flex', gap:10, alignItems:'center'}}>
              {grxSaveMsg && <span style={{fontSize:9, color: grxSaveMsg.includes('ERROR')?C.red:'#f0b429', fontFamily:C.mono}}>{grxSaveMsg}</span>}
              <div style={{fontSize:9, color:C.muted}}>GRX_Settings.json</div>
            </div>
          </div>
          {/* BOT ON/OFF */}
          <div style={{display:'flex', gap:10, alignItems:'center', marginBottom:12}}>
            <div style={{fontSize:9, color:C.muted, letterSpacing:'1px'}}>BOT</div>
            <button className="bbtn"
              onClick={()=>{ const v=(grxSettingsDraft.BotRunning??1)===1?0:1; setGrxSettingsDraft(d=>({...d,BotRunning:v})); saveGrxSingle('BotRunning',v); }}
              style={bBtn((grxSettingsDraft.BotRunning??1)===1,{padding:'5px 18px', borderColor:'#f0b429', color:(grxSettingsDraft.BotRunning??1)===1?'#000':'#f0b429'})}>
              {(grxSettingsDraft.BotRunning??1)===1?'ON':'OFF'}
            </button>
          </div>
          {/* fields */}
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:8}}>
            {[
              {k:'BaseLot',      label:'BASE LOT',       step:0.01, min:0.01},
              {k:'BasketCount',  label:'BASKET COUNT',   step:1,    min:1},
              {k:'BasketTP',     label:'BASKET TP $',    step:1,    min:0.5},
              {k:'LotBoost',     label:'LOT BOOST',      step:0.5,  min:1},
              {k:'CooldownBars', label:'COOLDOWN BARS',  step:1,    min:0},
              {k:'ADXMax',       label:'ADX MAX (ترند)', step:1,    min:10},
              {k:'ProbeLot',     label:'PROBE LOT',      step:0.01, min:0.01},
              {k:'ProbeBars',    label:'PROBE BARS',     step:1,    min:1},
              {k:'MaxDrawdown',  label:'MAX DRAWDOWN $', step:5,    min:5},
              {k:'MaxSpread',    label:'MAX SPREAD',     step:10,   min:10},
            ].map(({k,label,step,min}) => (
              <div key={k} style={{display:'flex',flexDirection:'column',gap:3}}>
                <div style={bLabel({fontSize:9,color:'#f0b429'})}>{label}</div>
                <div style={{display:'flex',gap:4}}>
                  <input type="number" step={step} min={min}
                    value={grxSettingsDraft[k]??''}
                    onChange={e=>{grxSettingsDirty.current=true; setGrxSettingsDraft(d=>({...d,[k]:e.target.value===''?'':Number(e.target.value)}));}}
                    style={{width:80,background:C.bg,border:`1px solid #f0b429`,color:C.ink,fontFamily:C.mono,fontSize:10,padding:'4px 6px',borderRadius:3}}
                  />
                  <button className="bbtn" onClick={()=>saveGrxSingle(k,grxSettingsDraft[k])} disabled={grxBusy}
                    style={{fontSize:9,padding:'4px 8px',border:`1px solid #f0b429`,color:'#f0b429',background:'transparent',fontFamily:C.mono,cursor:'pointer'}}>✓</button>
                </div>
              </div>
            ))}
          </div>
          <div style={{marginTop:10, fontSize:9, color:C.muted, lineHeight:1.6}}>
            ⚡ منطق: شمعة M1 قوية → يفتح BASKET COUNT صفقة بنفس الاتجاه → يغلق الكل عند ربح BASKET TP$
          </div>
        </div>

        {/* ═══ LIVE LOG (full width) ══════════════════════════ */}
        <div className="bcard" style={bCard({padding:'12px 14px'})}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
            <span style={{fontSize:11, fontWeight:'bold', letterSpacing:'2px', color:C.neon}}>▶ LIVE LOG</span>
            <button className="bbtn"
              style={{fontSize:9,padding:'2px 8px',letterSpacing:'1px',border:`1px solid ${C.muted}`,color:C.muted,background:'transparent',fontFamily:C.mono,cursor:'pointer'}}
              onClick={()=>setLogs([])}>CLEAR</button>
          </div>
          <div ref={logBoxRef} style={{
            height:160, overflowY:'auto', fontFamily:C.mono, fontSize:10,
            background:C.bg, border:C.border, padding:'8px 10px',
            display:'flex', flexDirection:'column', gap:2,
          }}>
            {logs.length === 0
              ? <span style={{color:C.muted}}>— لا أحداث بعد —</span>
              : logs.map((e,i) => {
                  const col = e.l==='err'?C.red : e.l==='warn'?C.yellow : e.l==='ok'?C.neon : e.l==='trade'?(e.m.includes('🟢')?C.neon:C.red) : C.muted;
                  return (
                    <div key={i} style={{display:'flex', gap:8, lineHeight:1.4}}>
                      <span style={{color:C.muted, minWidth:52, flexShrink:0}}>{e.t}</span>
                      <span style={{color:col}}>{e.m}</span>
                    </div>
                  );
                })
            }
          </div>
        </div>

        {/* ═══ TRADE HISTORY (full width) ═════════════════════ */}
        <div className="bcard" style={bCard()}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
            <span style={{fontSize:12, fontWeight:'bold', letterSpacing:'2px', color:C.ink}}>
              &gt; TRADE HISTORY · LAST {Math.min(history.length,20)}
            </span>
            <div style={{display:'flex',gap:6}}>
              <button className="bbtn" onClick={fetchHistory} disabled={histLoading}
                style={{fontSize:9,padding:'3px 12px',letterSpacing:'1px',border:`1px solid ${C.neon}`,color:C.neon,background:'transparent',fontFamily:'monospace',cursor:'pointer'}}>
                {histLoading ? 'LOADING...' : '↻ PULL'}
              </button>
              <button className="bbtn" onClick={()=>{
                const a = document.createElement('a');
                a.href = '/api/export/trades';
                a.download = 'trades_export.json';
                a.click();
              }}
                style={{fontSize:9,padding:'3px 12px',letterSpacing:'1px',border:`1px solid ${C.yellow}`,color:C.yellow,background:'transparent',fontFamily:'monospace',cursor:'pointer'}}>
                ⬇ EXPORT
              </button>
            </div>
          </div>
          {history.length===0 ? (
            <div style={bLabel({padding:'12px 0', color:C.yellow})}>NO CLOSED TRADES YET_</div>
          ) : (
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:11, minWidth:560}}>
                <thead>
                  <tr style={{borderBottom:'1px solid #30363d'}}>
                    {['#','SYMBOL','TIME','TYPE','VOL','ENTRY','EXIT','PROFIT','SWAP','NET'].map(h=>(
                      <th key={h} style={{...bLabel({padding:'6px 8px',textAlign:'left', color:C.neon})}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.slice(0,20).map((t,i)=>{
                    const net=netOf(t);
                    const buy=t.type==='BUY';
                    const si=symInfo(t.symbol);
                    return (
                      <tr key={t.ticket??i} className="hrow"
                        style={{
                          borderBottom:`1px solid ${C.faint}`, cursor:'pointer',
                          borderLeft:`4px solid ${si.color}`,
                          background: i%2===0 ? '#000' : 'rgba(255,255,255,0.04)',
                        }}
                        onClick={()=>setTradePopup(t)}>
                        <td style={{padding:'7px 8px', color:C.muted}}>
                          {i+1}
                        </td>
                        <td style={{padding:'7px 8px'}}>
                          <span style={{fontSize:13, marginRight:4}}>{si.icon}</span>
                          <span style={{fontWeight:'bold', color:si.color, fontSize:10, letterSpacing:'1px'}}>{t.symbol||si.label}</span>
                        </td>
                        <td style={{padding:'7px 8px', color:C.muted, fontVariantNumeric:'tabular-nums'}}>
                          {t.time ? new Date(t.time).toLocaleTimeString() : '--'}
                        </td>
                        <td style={{padding:'7px 8px', fontWeight:'bold', color:buy?C.neon:C.red, letterSpacing:'2px'}}>{t.type??'--'}</td>
                        <td style={{padding:'7px 8px'}}>{t.volume??'--'}</td>
                        <td style={{padding:'7px 8px', fontVariantNumeric:'tabular-nums'}}>{t.price_open??'--'}</td>
                        <td style={{padding:'7px 8px', fontVariantNumeric:'tabular-nums'}}>{t.price_close??'--'}</td>
                        <td style={{padding:'7px 8px', fontVariantNumeric:'tabular-nums', color:(t.profit||0)>=0?C.neon:C.red}}>
                          {fmtMoney(t.profit,true)}
                        </td>
                        <td style={{padding:'7px 8px', color:C.muted, fontVariantNumeric:'tabular-nums'}}>
                          {fmtMoney(t.swap??0,true)}
                        </td>
                        <td style={{padding:'7px 8px', fontWeight:'bold', fontVariantNumeric:'tabular-nums', color:net>=0?C.neon:C.red}}>
                          {fmtMoney(net,true)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ═══ FIXED TICKER BAR ════════════════════════════════ */}
      <div style={{
        position:'fixed', left:0, right:0, bottom:0, zIndex:500,
        background:C.bg, color:C.ink, fontFamily:C.mono,
        fontSize:11, letterSpacing:'2px', padding:'8px 16px',
        whiteSpace:'nowrap', overflow:'hidden', borderTop:'1px solid #30363d',
        fontVariantNumeric:'tabular-nums', textTransform:'uppercase',
      }}>
        BAL {account?'$'+Number(account.balance??0).toLocaleString('en-US',{minimumFractionDigits:2}):'--'}
        {' · '}EQ {account?'$'+Number(account.equity??0).toLocaleString('en-US',{minimumFractionDigits:2}):'--'}
        {' · '}FREE {account?'$'+Number(account.margin_free??account.free_margin??0).toLocaleString('en-US',{minimumFractionDigits:2}):'--'}
        {' · '}<span style={{color:C.yellow}}>TP ${settings.TP_USD??'--'} · SL ${settings.SL_USD??'--'}</span>
        {' · '}MAX POS {settings.MaxPositions??'--'}
        {' · '}<span style={{color:isOnline?C.neon:C.red}}>{isOnline?'● LIVE':'○ STALE'}</span>
      </div>

      {/* ═══ PROFIT POPUP (trade close) ══════════════════════ */}
      {popup && (
        <div style={{
          position:'fixed', inset:0, display:'flex',
          alignItems:'center', justifyContent:'center',
          background:'rgba(0,0,0,0.8)', zIndex:1000,
        }} onClick={()=>setPopup(null)}>
          <div style={{
            background:C.bg,
            border:`2px solid ${popup.profit>=0?C.neon:C.red}`,
            boxShadow: popup.profit>=0
              ? '0 0 20px #00ff41, 0 0 40px #00ff41'
              : '0 0 20px #ff0040, 0 0 40px #ff0040',
            padding:'40px 60px', textAlign:'center',
            animation:'popIn 0.25s ease-out',
            fontFamily:C.mono,
          }}>
            <div style={bLabel({marginBottom:8, color:C.ink})}>
              {popup.count > 1 ? `${popup.count} TRADES CLOSED` : 'TRADE CLOSED'}
            </div>
            <div style={{
              fontSize:72, fontWeight:'bold', letterSpacing:'-0.02em',
              color: popup.profit>=0 ? C.neon : C.red,
              textShadow: popup.profit>=0 ? '0 0 40px rgba(0,255,65,0.7)' : '0 0 40px rgba(255,0,64,0.7)',
              fontVariantNumeric:'tabular-nums',
            }}>
              {fmtMoney(popup.profit,true)}
            </div>
            <div style={{
              fontSize:14, fontWeight:'bold', letterSpacing:'2px', marginTop:8,
              color: popup.profit>=0 ? C.neon : C.red,
            }}>
              {popup.profit>=0 ? '▲ PROFIT' : '▼ LOSS'}
            </div>
            <div style={bLabel({marginTop:12})}>TAP TO DISMISS</div>
          </div>
        </div>
      )}

      {/* ═══ TRADE DETAIL POPUP ══════════════════════════════ */}
      {tradePopup && (
        <div style={{
          position:'fixed', inset:0, display:'flex',
          alignItems:'center', justifyContent:'center',
          background:'rgba(0,0,0,0.85)', zIndex:999,
          overflowY:'auto', padding:'20px 0',
        }} onClick={()=>{ setTradePopup(null); setTradeSnapshot(null); }}>
          <div style={{
            background:C.bg, border:C.border,
            boxShadow:'0 0 20px #00ff41, 0 0 40px #00ff41',
            padding:'28px 32px',
            fontFamily:C.mono, width:'min(480px,96vw)', color:C.ink,
            animation:'slideUp 0.2s ease-out',
          }} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:11, fontWeight:'bold', letterSpacing:'2px', marginBottom:16, color:C.neon}}>
              &gt; TRADE DETAIL · #{tradePopup.ticket}
            </div>

            {/* ── mini snapshot chart ───────────────────────── */}
            {tradeSnapshot?.candles?.length > 1 && (() => {
              const cs = tradeSnapshot.candles.slice(-25);
              const W=420, H=120, padL=2, padR=44, padT=6, padB=6;
              const cw=(W-padL-padR)/cs.length;
              const bw=Math.max(1.5,cw-1);
              const allH=cs.flatMap(c=>[c.h,c.l]);
              const lo=Math.min(...allH), hi=Math.max(...allH);
              const rng=Math.max(hi-lo,0.1);
              const Y=v=>padT+((hi-v)/rng)*(H-padT-padB);
              const Cx=i=>padL+i*cw+(cw-bw)/2;
              const ep=tradeSnapshot.entry_price;
              return (
                <div style={{marginBottom:12}}>
                  <div style={bLabel({fontSize:8, marginBottom:4, color:'#ff9900'})}>
                    CHART AT ENTRY · {tradeSnapshot.session} SESSION
                  </div>
                  <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'auto',display:'block',background:'#000',border:`1px solid ${C.faint}`}}>
                    {[0,0.5,1].map((f,i)=>{
                      const y=Y(lo+f*rng);
                      return <g key={i}>
                        <line x1={padL} y1={y} x2={W-padR} y2={y} stroke={C.faint} strokeWidth="0.5" strokeDasharray="3 3"/>
                        <text x={W-padR+3} y={y+3} fontSize="7" fill={C.muted} fontFamily={C.mono}>{(lo+f*rng).toFixed(2)}</text>
                      </g>;
                    })}
                    {cs.map((c,i)=>{
                      const bull=c.c>=c.o;
                      const col=bull?C.neon:C.red;
                      const mx=Cx(i)+bw/2;
                      const bTop=Y(Math.max(c.o,c.c));
                      const bBot=Y(Math.min(c.o,c.c));
                      return <g key={c.t??i}>
                        <line x1={mx} y1={Y(c.h)} x2={mx} y2={bTop} stroke={col} strokeWidth="1"/>
                        <rect x={Cx(i)} y={bTop} width={bw} height={Math.max(1,bBot-bTop)} fill={col}/>
                        <line x1={mx} y1={bBot} x2={mx} y2={Y(c.l)} stroke={col} strokeWidth="1"/>
                      </g>;
                    })}
                    {ep && ep>=lo && ep<=hi && (
                      <g>
                        <line x1={padL} y1={Y(ep)} x2={W-padR} y2={Y(ep)} stroke={C.yellow} strokeWidth="1.5" strokeDasharray="4 3"/>
                        <rect x={W-padR} y={Y(ep)-7} width={padR} height={14} fill={C.yellow}/>
                        <text x={W-padR+3} y={Y(ep)+4} fontSize="7" fill="#000" fontFamily={C.mono} fontWeight="900">{ep?.toFixed(2)}</text>
                      </g>
                    )}
                  </svg>
                  {/* indicators row */}
                  <div style={{display:'flex', gap:8, marginTop:6}}>
                    {[
                      { l:'RSI', v: tradeSnapshot.rsi, c: tradeSnapshot.rsi > 70 ? C.red : tradeSnapshot.rsi < 30 ? C.neon : C.ink },
                      { l:'EMA', v: tradeSnapshot.ema_up ? '↑ UP' : '↓ DOWN', c: tradeSnapshot.ema_up ? C.neon : C.red },
                      { l:'ATR', v: tradeSnapshot.atr, c: C.yellow },
                      { l:'SESSION', v: tradeSnapshot.session, c: '#ff9900' },
                    ].map(x=>(
                      <div key={x.l} style={{flex:1, textAlign:'center', padding:'4px 2px', background:C.faint}}>
                        <div style={bLabel({fontSize:7})}>{x.l}</div>
                        <div style={{fontSize:11, fontWeight:'bold', color:x.c}}>{x.v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
            {tradeSnapshot === null && tradePopup.ticket && (
              <div style={bLabel({marginBottom:12, color:C.muted, fontSize:9})}>
                LOADING ENTRY SNAPSHOT...
              </div>
            )}

            {/* ── trade fields ──────────────────────────────── */}
            {[
              ['Type',      tradePopup.type??'--'],
              ['Volume',    tradePopup.volume??'--'],
              ['Entry',     tradePopup.price_open??tradeSnapshot?.entry_price??'--'],
              ['Exit',      tradePopup.price_close??'--'],
              ['Profit',    fmtMoney(tradePopup.profit??0,true)],
              ['Swap',      fmtMoney(tradePopup.swap??0,true)],
              ['Commission',fmtMoney(tradePopup.commission??0,true)],
              ['Net',       fmtMoney(netOf(tradePopup),true)],
              ['Time',      tradePopup.time ? new Date(tradePopup.time).toLocaleString() : '--'],
            ].map(([k,v])=>(
              <div key={k} style={{
                display:'flex', justifyContent:'space-between', gap:24,
                padding:'7px 0', borderBottom:`1px solid ${C.faint}`,
              }}>
                <span style={bLabel({fontSize:10})}>{k}</span>
                <span style={{
                  fontSize:12, fontWeight:'bold',
                  color: k==='Net' ? (netOf(tradePopup)>=0?C.neon:C.red) : C.ink,
                  fontVariantNumeric:'tabular-nums',
                }}>{v}</span>
              </div>
            ))}
            <button className="bbtn"
              onClick={()=>{ setTradePopup(null); setTradeSnapshot(null); }}
              style={bBtn(true,{width:'100%',marginTop:16})}>CLOSE</button>
          </div>
        </div>
      )}

      {/* ═══ ANALYSIS MODAL ══════════════════════════════════ */}
      {showAnalysis && (
        <div style={{
          position:'fixed', inset:0, background:'rgba(0,0,0,0.92)',
          zIndex:1100, display:'flex', flexDirection:'column',
          fontFamily:C.mono,
        }}>
          {/* Header */}
          <div style={{
            display:'flex', alignItems:'center', justifyContent:'space-between',
            padding:'14px 20px', borderBottom:`2px solid #ff9900`,
            background:C.surface, flexShrink:0,
          }}>
            <div style={{fontSize:13, fontWeight:'bold', letterSpacing:'3px', color:'#ff9900'}}>
              ◆ ANALYSIS · TRADE SNAPSHOTS
            </div>
            <div style={{display:'flex', gap:10, alignItems:'center'}}>
              <span style={{fontSize:10, color:C.muted}}>{snapshots.length} snapshots</span>
              <button onClick={loadSnapshots} style={{
                fontFamily:C.mono, fontSize:9, padding:'4px 10px', letterSpacing:'1px',
                border:`1px solid ${C.neon}`, color:C.neon, background:'transparent', cursor:'pointer',
              }}>⟳ REFRESH</button>
              <button onClick={()=>setShowAnalysis(false)} style={{
                fontFamily:C.mono, fontSize:11, padding:'5px 14px', letterSpacing:'2px',
                border:`2px solid ${C.red}`, color:C.red, background:'transparent', cursor:'pointer',
                fontWeight:'bold',
              }}>✕ CLOSE</button>
            </div>
          </div>

          {/* Pattern AI result */}
          {patternAdvice && (
            <div style={{
              padding:'10px 20px', background:'rgba(255,153,0,0.08)',
              borderBottom:`1px solid rgba(255,153,0,0.3)`,
              fontSize:10, color:'#ff9900', letterSpacing:'1px', flexShrink:0,
            }}>
              <span style={{fontWeight:'bold', marginRight:8}}>◆ AI:</span>
              {patternAdvice.split('\n').join('  ·  ')}
            </div>
          )}

          {/* Snapshots grid */}
          <div style={{overflowY:'auto', padding:'16px 20px', flex:1}}>
            {snapLoading ? (
              <div style={{color:C.muted, fontSize:12, textAlign:'center', paddingTop:40}}>
                جاري التحميل...
              </div>
            ) : snapshots.length === 0 ? (
              <div style={{color:C.muted, fontSize:13, textAlign:'center', paddingTop:40, lineHeight:2}}>
                <div style={{fontSize:28, marginBottom:12}}>📭</div>
                <div style={{color:C.ink, marginBottom:8}}>لا توجد snapshots في البكند</div>
                {snapCount !== null && <div style={{fontSize:11}}>عدد في DB: <b style={{color:C.neon}}>{snapCount}</b></div>}
                <div style={{marginTop:16, fontSize:11, color:C.muted, maxWidth:340, margin:'16px auto 0'}}>
                  الـ snapshots تُحفظ لما الأيجنت يشوف صفقة جديدة مفتوحة.<br/>
                  لو عندك local_snapshots.json، أعد تشغيل الأيجنت ليرفعها.
                </div>
              </div>
            ) : (() => {
              // إحصائيات سريعة
              const wins  = snapshots.filter(s=>s.profit>0).length;
              const total = snapshots.length;
              const avgRsiWin  = total ? (snapshots.filter(s=>s.profit>0).reduce((a,s)=>a+(s.rsi||50),0)/(wins||1)).toFixed(1) : '--';
              const avgRsiLoss = total ? (snapshots.filter(s=>s.profit<=0).reduce((a,s)=>a+(s.rsi||50),0)/((total-wins)||1)).toFixed(1) : '--';
              const sessions = {};
              snapshots.forEach(s=>{ const k=s.session||'?'; sessions[k]=(sessions[k]||{w:0,l:0}); s.profit>0?sessions[k].w++:sessions[k].l++; });

              return (
                <div>
                  {/* Summary bar */}
                  <div style={{display:'flex', gap:16, marginBottom:16, flexWrap:'wrap'}}>
                    <div style={{background:C.surface, border:C.border, padding:'8px 14px', fontSize:10}}>
                      <span style={{color:C.muted}}>WIN RATE </span>
                      <span style={{color:C.neon, fontWeight:'bold'}}>{total?Math.round(wins/total*100):0}%</span>
                      <span style={{color:C.muted}}> ({wins}/{total})</span>
                    </div>
                    <div style={{background:C.surface, border:C.border, padding:'8px 14px', fontSize:10}}>
                      <span style={{color:C.muted}}>RSI WIN avg </span>
                      <span style={{color:C.neon, fontWeight:'bold'}}>{avgRsiWin}</span>
                      <span style={{color:C.muted}}> · LOSS avg </span>
                      <span style={{color:C.red, fontWeight:'bold'}}>{avgRsiLoss}</span>
                    </div>
                    {Object.entries(sessions).map(([k,v])=>(
                      <div key={k} style={{background:C.surface, border:C.border, padding:'8px 14px', fontSize:10}}>
                        <span style={{color:C.yellow}}>{k} </span>
                        <span style={{color:C.neon}}>{v.w}W</span>
                        <span style={{color:C.muted}}>/</span>
                        <span style={{color:C.red}}>{v.l}L</span>
                      </div>
                    ))}
                  </div>

                  {/* Table */}
                  <div style={{overflowX:'auto'}}>
                    <table style={{width:'100%', borderCollapse:'collapse', fontSize:11}}>
                      <thead>
                        <tr style={{borderBottom:`1px solid ${C.faint}`, color:C.muted, fontSize:9, letterSpacing:'1px'}}>
                          {['#TICKET','DIR','ENTRY','RSI','EMA','ATR','SESSION','P&L','RSI ZONE'].map(h=>(
                            <th key={h} style={{padding:'6px 10px', textAlign:'left', fontWeight:'normal'}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {snapshots.map((s,i)=>{
                          const isBuy = s.direction==='BUY';
                          const profit = s.profit;
                          const hasProfit = profit != null;
                          const win = hasProfit && profit > 0;
                          const rsi = s.rsi;
                          const rsiZone = rsi==null?'--':rsi>=70?'OVERBOUGHT':rsi<=30?'OVERSOLD':rsi>=55?'HIGH':rsi<=45?'LOW':'NEUTRAL';
                          const rsiZoneC = rsi==null?C.muted:rsi>=70||rsi<=30?C.red:rsi>=55||rsi<=45?C.yellow:C.neon;
                          return (
                            <tr key={i} style={{
                              borderBottom:`1px solid ${C.faint}`,
                              background: i%2===0?'transparent':'rgba(255,255,255,0.02)',
                            }}>
                              <td style={{padding:'7px 10px', color:C.muted, fontSize:10}}>#{s.ticket}</td>
                              <td style={{padding:'7px 10px', fontWeight:'bold', color:isBuy?C.neon:C.red}}>
                                {isBuy?'▲ BUY':'▼ SELL'}
                              </td>
                              <td style={{padding:'7px 10px', fontVariantNumeric:'tabular-nums'}}>
                                {s.entry_price!=null?s.entry_price.toFixed(2):'--'}
                              </td>
                              <td style={{padding:'7px 10px', fontVariantNumeric:'tabular-nums',
                                color:rsi>60?C.red:rsi<40?C.neon:C.ink}}>
                                {rsi!=null?rsi.toFixed(0):'--'}
                              </td>
                              <td style={{padding:'7px 10px', color:s.ema_up?C.neon:C.red}}>
                                {s.ema_up?'↑ BULL':'↓ BEAR'}
                              </td>
                              <td style={{padding:'7px 10px', color:C.yellow, fontVariantNumeric:'tabular-nums'}}>
                                {s.atr!=null?s.atr.toFixed(1):'--'}
                              </td>
                              <td style={{padding:'7px 10px', color:C.muted}}>{s.session||'--'}</td>
                              <td style={{padding:'7px 10px', fontWeight:'bold', fontVariantNumeric:'tabular-nums',
                                color: hasProfit?(win?C.neon:C.red):C.muted}}>
                                {hasProfit?(win?'+':'')+profit.toFixed(2):'--'}
                              </td>
                              <td style={{padding:'7px 10px', fontSize:9, color:rsiZoneC}}>{rsiZone}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
