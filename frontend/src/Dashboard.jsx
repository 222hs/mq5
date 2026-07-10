import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || "";
const API_KEY = 'mysecretkey123';
const DASH_VERSION = 'v3.47';
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
  const [grxSettingsDraft, setGrxSettingsDraft] = useState({});
  const grxSettingsDirty = useRef(new Set());
  const mergeKeepDirty = (server, dirtyRef, prevDraft) => {
    const merged = { ...server };
    dirtyRef.current.forEach((k) => {
      if (prevDraft && Object.prototype.hasOwnProperty.call(prevDraft, k)) merged[k] = prevDraft[k];
    });
    return merged;
  };
  const [grxSaveMsg, setGrxSaveMsg] = useState('');
  const [grxBusy, setGrxBusy] = useState(false);
  const [candleData, setCandleData] = useState({ candles: [], sessions: {} });
  const [tradePopup, setTradePopup] = useState(null); // trade detail popup
  const [histFilter, setHistFilter] = useState('ALL'); // trade history symbol filter
  const [tradeSnapshot, setTradeSnapshot] = useState(null); // entry snapshot
  const seenTickets = useRef(null);
  const prevPositions = useRef(null);
  const skipCloseDetect = useRef(true); // تجاهل أول payload بعد الاتصال
  const seenHistoryTickets = useRef(new Set());
  const historyInitialized = useRef(false); // أول payload لود الـ tickets بدون popup
  const popupTimer = useRef(null);
  const [connState, setConnState] = useState('connecting');
  const socketRef = useRef(null);
  const [logs, setLogs] = useState([]);
  const logBoxRef = useRef(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  const [snapLoading, setSnapLoading] = useState(false);
  const [historyData, setHistoryData] = useState([]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // auto-scroll داخل صندوق اللوج فقط — دائماً ينزل لآخر سطر
  useEffect(() => {
    const box = logBoxRef.current;
    if (!box) return;
    box.scrollTop = box.scrollHeight;
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
          const hist = Array.isArray(d.history) && d.history.length > 0
            ? d.history.slice().sort((a,b) => new Date(b.time) - new Date(a.time))
            : null;
          setData(prev => {
            const prevPos = prev?.positions || [];
            const newPos  = d.positions || [];
            const posChanged =
              prevPos.length !== newPos.length ||
              newPos.some((p, i) =>
                p.ticket !== prevPos[i]?.ticket ||
                p.profit !== prevPos[i]?.profit
              );
            return {
              ...d,
              positions: posChanged ? newPos : prevPos,
              history: hist || prev?.history || [],
            };
          });
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

  // poll هستوري مستقل كل 4 ثواني من /api/history مباشرة
  useEffect(() => {
    let active = true;
    const fetchH = async () => {
      try {
        const r = await fetch(`${API_URL}/api/history?limit=1000`, {
          headers: { 'X-API-Key': API_KEY },
          signal: AbortSignal.timeout(4000),
        });
        if (!active || !r.ok) return;
        const raw = await r.json();
        if (Array.isArray(raw) && raw.length > 0) {
          const sorted = raw.slice().sort((a, b) => new Date(b.time) - new Date(a.time));
          setHistoryData(sorted);
        }
      } catch (_) {}
      if (active) setTimeout(fetchH, 4000);
    };
    fetchH();
    return () => { active = false; };
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

    socket.on('connect',    () => { setConnState('connected'); skipCloseDetect.current = true; historyInitialized.current = false; seenHistoryTickets.current = new Set(); });
    socket.on('disconnect', () => setConnState('disconnected'));
    socket.on('connect_error', () => setConnState('connecting'));

    const handleDashboard = (d) => {
      const curPos = Array.isArray(d.positions) ? d.positions : [];
      let hadClose = false;
      // كشف الإغلاق من التاريخ — أول payload يُهيئ الـ set بدون popup
      const hist = Array.isArray(d.history) ? d.history : [];
      if (!historyInitialized.current) {
        // أول مرة: حفظ كل التذاكر الموجودة بدون popup
        hist.forEach(h => seenHistoryTickets.current.add(h.ticket));
        historyInitialized.current = true;
      } else if (hist.length > 0) {
        const newClosed = hist.filter(h => !seenHistoryTickets.current.has(h.ticket));
        if (newClosed.length > 0) {
          hadClose = true;
          const totalNet = newClosed.reduce((sum, h) => sum + (h.profit || 0), 0);
          setPopup({ profit: totalNet, count: newClosed.length });
          clearTimeout(popupTimer.current);
          popupTimer.current = setTimeout(() => setPopup(null), 3500);
          newClosed.forEach(h => seenHistoryTickets.current.add(h.ticket));
        }
      }
      skipCloseDetect.current = false;
      prevPositions.current = curPos;
      if (hadClose) fetchHistory(false);
      const histSorted = Array.isArray(d.history) && d.history.length > 0
        ? d.history.slice().sort((a,b) => new Date(b.time) - new Date(a.time))
        : null;
      setData(prev => ({ ...d, history: histSorted || prev?.history || [] }));
      if (Array.isArray(d.candles) && d.candles.length > 0)
        setCandleData({ candles: d.candles, sessions: d.sessions || {} });
    };

    socket.on('dashboard', handleDashboard);
    socket.on('candles', (d) => setCandleData(d));
    socket.on('grx_settings', (s) => {
      setGrxSettingsDraft(prev => mergeKeepDirty(s, grxSettingsDirty, prev));
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
    socket.on('history', (raw) => {
      applyHistory(raw);
    });

    return () => {
      socket.off('dashboard', handleDashboard);
      socket.off('candles');
      socket.off('grx_settings');
      socket.off('log');
      socket.off('log_history');
      socket.off('history');
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
    setGrxBusy(true);
    try {
      await fetch(`${API_URL}/api/bot/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify({ action }),
      });
    } catch (e) {}
    setGrxBusy(false);
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
        grxSettingsDirty.current.delete(key);
        const updated = await r.json();
        if (updated.settings) setGrxSettingsDraft(prev => mergeKeepDirty(updated.settings, grxSettingsDirty, prev));
      }
      setGrxSaveMsg(r.ok ? `✓ ${key} SAVED` : 'ERROR');
    } catch (e) { setGrxSaveMsg('ERROR'); }
    setGrxBusy(false);
    setTimeout(() => setGrxSaveMsg(''), 2500);
  };

  const [histLoading, setHistLoading] = useState(false);
  const applyHistory = (raw) => {
    if (!Array.isArray(raw) || raw.length === 0) return;
    const sorted = raw.slice().sort((a,b) => new Date(b.time) - new Date(a.time));
    setData(d => ({ ...(d||{}), history: sorted }));
  };
  const fetchHistory = async (showSpinner=false) => {
    if(showSpinner) setHistLoading(true);
    try {
      const r = await fetch(`${API_URL}/api/history?limit=200`, { headers: {'X-API-Key': API_KEY} });
      if (r.ok) applyHistory(await r.json());
    } catch(e) {}
    if(showSpinner) setHistLoading(false);
  };

  // Pull on mount + every 10s (silent) — WS يبث فوراً عند صفقة جديدة
  useEffect(() => {
    fetchHistory(true);
    const t = setInterval(() => fetchHistory(false), 10000);
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

  // Pull GRX settings on mount
  useEffect(() => {
    fetch(`${API_URL}/api/settings/grx`, { headers: {'X-API-Key': API_KEY} })
      .then(r => r.ok ? r.json() : null)
      .then(s => { if(s) setGrxSettingsDraft(s); })
      .catch(()=>{});
  }, []);

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
  const history   = historyData.length > 0 ? historyData : (Array.isArray(data?.history) ? data.history : []);
  const stats     = data?.stats || { total_trades: 0, wins: 0, losses: 0, win_rate: 0, total_profit: 0 };
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
  const patternAdvice = data?.pattern_advice || null;
  const patternTime   = data?.pattern_time   || null;

  const pipeline = [
    { n:'01', t:'HFT GRID', s:'BUY+SELL/bar',         ok: botRunning },
    { n:'02', t:'RSI FILTER', s:'<30 sell / >70 buy', ok: botRunning },
    { n:'03', t:'SPREAD',   s:`max ${grxSettingsDraft.MaxSpread??'--'}`, ok: botRunning },
    { n:'04', t:'ENTRY',    s:`lot ${grxSettingsDraft.BaseLot??'--'}`, ok: botRunning },
    { n:'05', t:'MONITOR',  s:`TP$${grxSettingsDraft.TradeTP??'--'} SL$${grxSettingsDraft.TradeSL??'--'}`, ok: positions.length > 0, active: positions.length > 0 },
    { n:'06', t:'CLOSE',    s:'per-trade',             ok: !!lastTrade, last: lastProfit },
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
          <button
            className={botRunning ? 'bbtn-red' : 'bbtn'}
            onClick={() => botControl(botRunning?'stop':'start')}
            disabled={grxBusy}
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
              const midX=i=>Cx(i)+bodyW/2;
              const pLabels=[0,0.25,0.5,0.75,1].map(f=>lo+f*range);
              const hasPTD = last.some(c => c.ps != null);
              // بناء polyline PTD
              const ptdSlowPts = last.map((c,i) => c.ps!=null ? `${midX(i)},${Y(c.ps)}` : null).filter(Boolean).join(' ');
              const ptdFastPts = last.map((c,i) => c.pf!=null ? `${midX(i)},${Y(c.pf)}` : null).filter(Boolean).join(' ');
              const lastPTD = last[last.length-1];
              const ptdUp = lastPTD?.pt === 0;
              return (
                <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'auto',display:'block',background:C.bg}}>
                  {pLabels.map((p,i)=>{
                    const y=Y(p);
                    return <g key={i}>
                      <line x1={padL} y1={y} x2={W-padR} y2={y} stroke={C.faint} strokeWidth="0.5" strokeDasharray="3 3"/>
                      <text x={W-padR+4} y={y+3} fontSize="8" fill={C.muted} fontFamily={C.mono}>{p.toFixed(2)}</text>
                    </g>;
                  })}
                  {/* PTD fill between slow & fast */}
                  {hasPTD && (() => {
                    const validIdx = last.map((_,i)=>i).filter(i=>last[i].ps!=null&&last[i].pf!=null);
                    if(validIdx.length<2) return null;
                    const fwdPts = validIdx.map(i=>`${midX(i)},${Y(last[i].ps)}`).join(' ');
                    const bwdPts = validIdx.slice().reverse().map(i=>`${midX(i)},${Y(last[i].pf)}`).join(' ');
                    return <polygon points={`${fwdPts} ${bwdPts}`}
                      fill={ptdUp ? 'rgba(0,255,65,0.07)' : 'rgba(255,69,96,0.07)'}/>;
                  })()}
                  {last.map((c,i)=>{
                    const bull=c.c>=c.o;
                    const col=bull?C.neon:C.red;
                    const mx=midX(i);
                    const bTop=Y(Math.max(c.o,c.c));
                    const bBot=Y(Math.min(c.o,c.c));
                    const bH=Math.max(1,bBot-bTop);
                    return <g key={c.t??i}>
                      <line x1={mx} y1={Y(c.h)} x2={mx} y2={bTop} stroke={col} strokeWidth="1"/>
                      <rect x={Cx(i)} y={bTop} width={bodyW} height={bH} fill={col}/>
                      <line x1={mx} y1={bBot} x2={mx} y2={Y(c.l)} stroke={col} strokeWidth="1"/>
                    </g>;
                  })}
                  {/* PTD slow line */}
                  {hasPTD && ptdSlowPts && <polyline points={ptdSlowPts} fill="none"
                    stroke={ptdUp?C.neon:C.red} strokeWidth="1.5" strokeOpacity="0.9"/>}
                  {/* PTD fast line (dotted) */}
                  {hasPTD && ptdFastPts && <polyline points={ptdFastPts} fill="none"
                    stroke={ptdUp?C.neon:C.red} strokeWidth="1" strokeDasharray="3 2" strokeOpacity="0.7"/>}
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
                  {/* PTD badge */}
                  {hasPTD && <g>
                    <rect x={padL} y={padT} width={44} height={14} rx="1"
                      fill={ptdUp?'rgba(0,255,65,0.15)':'rgba(255,69,96,0.15)'}
                      stroke={ptdUp?C.neon:C.red} strokeWidth="0.5"/>
                    <text x={padL+4} y={padT+10} fontSize="8" fontWeight="bold" fontFamily="monospace"
                      fill={ptdUp?C.neon:C.red}>PTD {ptdUp?'▲ UP':'▼ DN'}</text>
                  </g>}
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
                  { label:'RSI', value: data?.last_rsi != null ? `${Number(data.last_rsi).toFixed(1)}` : '--',
                    color: data?.last_rsi > 70 ? C.red : data?.last_rsi < 30 ? C.red : C.neon },
                  { label:'RSI RULE', value: data?.last_rsi > 70 ? 'SELL ONLY' : data?.last_rsi < 30 ? 'BUY ONLY' : 'FREE',
                    color: data?.last_rsi > 70 ? C.yellow : data?.last_rsi < 30 ? C.yellow : C.neon },
                  { label:'SPREAD', value: `${Math.round(data?.account?.spread || 0)}`,
                    color: (data?.account?.spread || 0) > (grxSettingsDraft.MaxSpread || 350) ? C.red : C.muted },
                  { label:'MAX SPREAD', value: `${grxSettingsDraft.MaxSpread ?? '--'}`,
                    color: C.muted },
                ].map(f => (
                  <div key={f.label} style={{flex:1, minWidth:60, textAlign:'center', padding:'6px 4px', background:C.faint}}>
                    <div style={{fontSize:8, color:C.muted, letterSpacing:'2px', marginBottom:2}}>{f.label}</div>
                    <div style={{fontSize:12, fontWeight:'bold', color:f.color}}>{f.value}</div>
                  </div>
                ))}
              </div>
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

        {/* ═══ GRX BOT SETTINGS ═══════════════════════════════ */}
        <div className="bcard" style={bCard({marginBottom:'1.25rem'})}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
            <div style={{fontSize:11, fontWeight:'bold', letterSpacing:'2px', color:'#f0b429'}}>◆ GOLD HFT SCALPER v3.00 — GRX_Settings.json</div>
            <div style={{display:'flex', gap:10, alignItems:'center'}}>
              {grxSaveMsg && <span style={{fontSize:9, color: grxSaveMsg.includes('ERROR')?C.red:'#f0b429', fontFamily:C.mono}}>{grxSaveMsg}</span>}
            </div>
          </div>
          {/* BOT ON/OFF */}
          <div style={{display:'flex', gap:10, alignItems:'center', marginBottom:14, flexWrap:'wrap'}}>
            <div style={{fontSize:9, color:C.muted, letterSpacing:'1px'}}>BOT</div>
            <button className="bbtn"
              onClick={()=>{ const v=(grxSettingsDraft.BotRunning??1)===1?0:1; setGrxSettingsDraft(d=>({...d,BotRunning:v})); saveGrxSingle('BotRunning',v); }}
              style={bBtn((grxSettingsDraft.BotRunning??1)===1,{padding:'5px 20px', borderColor:'#f0b429', color:(grxSettingsDraft.BotRunning??1)===1?'#000':'#f0b429'})}>
              {(grxSettingsDraft.BotRunning??1)===1?'▶ ON':'■ OFF'}
            </button>
            <div style={{fontSize:9, color:C.muted, marginLeft:12}}>
              صفقات مفتوحة: <span style={{color:C.neon, fontWeight:'bold'}}>{positions.length}</span>
              {' · '}MAX: <span style={{color:C.yellow}}>{grxSettingsDraft.MaxTrades??'--'}</span>
            </div>
          </div>
          {/* fields */}
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:8}}>
            {[
              {k:'BaseLot',     label:'BASE LOT',       step:0.01, min:0.01},
              {k:'TradeTP',     label:'TRADE TP $',     step:0.5,  min:0.5},
              {k:'TradeSL',     label:'TRADE SL $',     step:0.5,  min:0.5},
              {k:'MaxSpread',   label:'MAX SPREAD',     step:10,   min:10},
              {k:'CooldownBars',label:'COOLDOWN BARS',  step:1,    min:0},
              {k:'MaxTrades',   label:'MAX TRADES/DIR', step:1,    min:1},
            ].map(({k,label,step,min}) => (
              <div key={k} style={{display:'flex',flexDirection:'column',gap:3}}>
                <div style={bLabel({fontSize:9,color:'#f0b429'})}>{label}</div>
                <div style={{display:'flex',gap:4}}>
                  <input type="number" step={step} min={min}
                    value={grxSettingsDraft[k]??''}
                    onChange={e=>{grxSettingsDirty.current.add(k); setGrxSettingsDraft(d=>({...d,[k]:e.target.value===''?'':Number(e.target.value)}));}}
                    style={{width:80,background:C.bg,border:`1px solid #f0b429`,color:C.ink,fontFamily:C.mono,fontSize:12,padding:'6px 8px'}}
                  />
                  <button className="bbtn" onClick={()=>saveGrxSingle(k,grxSettingsDraft[k])} disabled={grxBusy}
                    style={{fontSize:9,padding:'4px 8px',border:`1px solid #f0b429`,color:'#f0b429',background:'transparent',fontFamily:C.mono,cursor:'pointer'}}>✓</button>
                </div>
              </div>
            ))}
          </div>
          <div style={{marginTop:10, fontSize:9, color:C.muted, lineHeight:1.6}}>
            ⚡ HFT Grid — يفتح BUY+SELL كل بار M1 · كل صفقة مستقلة · تُسكر لما تربح TradeTP$ أو تخسر TradeSL$ · RSI فلتر ({"<"}30=BUY only, {">"}70=SELL only)
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
              &gt; TRADE HISTORY · LAST {Math.min(history.filter(t=>histFilter==='ALL'||(t.symbol||'').toUpperCase().includes(histFilter)).length,50)}
            </span>
            <div style={{display:'flex',gap:6,alignItems:'center'}}>
              {[['ALL','ALL'],['XAU','XAU'],['BTC','BTC'],['JPY','JPY']].map(([k,lbl])=>(
                <button key={k} className="bbtn" onClick={()=>setHistFilter(k)}
                  style={{fontSize:9,padding:'3px 10px',letterSpacing:'1px',fontFamily:'monospace',cursor:'pointer',
                    border:`1px solid ${histFilter===k?C.neon:'#30363d'}`,
                    color:histFilter===k?'#0d1117':C.muted,
                    background:histFilter===k?C.neon:'transparent',
                    fontWeight:histFilter===k?'bold':'normal'}}>
                  {lbl}
                </button>
              ))}
              <button className="bbtn" onClick={()=>fetchHistory(true)} disabled={histLoading}
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
          {history.filter(t=>histFilter==='ALL'||(t.symbol||'').toUpperCase().includes(histFilter)).length===0 ? (
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
                  {history.filter(t=>histFilter==='ALL'||(t.symbol||'').toUpperCase().includes(histFilter)).slice(0,50).map((t,i)=>{
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
                        <td style={{padding:'7px 8px', fontVariantNumeric:'tabular-nums'}}>{t.price_open!=null?parseFloat(t.price_open.toFixed(5)):'--'}</td>
                        <td style={{padding:'7px 8px', fontVariantNumeric:'tabular-nums'}}>{t.price_close!=null?parseFloat(t.price_close.toFixed(5)):'--'}</td>
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
        {' · '}<span style={{color:C.yellow}}>TP ${grxSettingsDraft.TradeTP??'--'} · SL ${grxSettingsDraft.TradeSL??'--'}</span>
        {' · '}MAX {grxSettingsDraft.MaxTrades??'--'}/DIR
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
