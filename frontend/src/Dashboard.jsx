import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || "";
const API_KEY = 'mysecretkey123';
const DASH_VERSION = 'v2.1';

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
  const [saveMsg, setSaveMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [candleData, setCandleData] = useState({ candles: [], sessions: {} });
  const [tradePopup, setTradePopup] = useState(null); // trade detail popup
  const [tradeSnapshot, setTradeSnapshot] = useState(null); // entry snapshot
  const seenTickets = useRef(null);
  const prevPositions = useRef(null);
  const popupTimer = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const socket = io(API_URL || window.location.origin, {
      transports: ['websocket', 'polling'],
    });

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
      setData(d);
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

    return () => {
      socket.off('dashboard', handleDashboard);
      socket.off('candles');
      socket.off('settings');
      socket.disconnect();
      clearTimeout(popupTimer.current);
    };
  }, []);

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
      const r = await fetch(`${API_URL}/api/trade_snapshot/${trade.ticket}`);
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

  const settingKeys = ['LotSize','TP_USD','SL_USD','MaxSpread','MaxPositions','CooldownSecs','TrailUSD','MaxLossPerDay','MaxProfitPerDay','TradeHoursStart','TradeHoursEnd'];

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
                  { label:'SPREAD', value: data?.account ? `${Math.round((data.account.spread||0))}` : '--',
                    color: C.muted },
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
              <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:10, flexWrap:'wrap'}}>
                <span style={{fontSize:11, fontWeight:'bold', letterSpacing:'2px', color:'#ff9900'}}>◆ PATTERN_AI</span>
                {patternTime && <span style={{fontSize:9, color:C.muted}}>updated {new Date(patternTime).toLocaleTimeString()}</span>}
              </div>
              {patternAdvice ? (() => {
                // تحليل النص المنسّق وعرضه كبطاقات
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
                      <div style={bLabel({color:C.ink})}>&gt; BASKET MODE</div>
                      <div style={{fontSize:9, fontWeight:'bold', letterSpacing:'1px', color:C.neon}}>
                        ACTIVE: 3 ORDERS/SIGNAL
                      </div>
                    </div>
                    <div style={{
                      background: C.faint, border: C.border,
                      padding: '10px 12px', fontSize: 10, fontFamily: C.mono,
                      color: C.ink, lineHeight: 1.8, letterSpacing: '0.5px',
                    }}>
                      <div><span style={{color:C.neon}}>■</span> [0] MARKET  → دخول فوري</div>
                      <div><span style={{color:C.yellow}}>■</span> [1] STOP   → يصطاد كسر High/Low</div>
                      <div><span style={{color:'dodgerblue'}}>■</span> [2] LIMIT  → ينتظر pullback</div>
                      <div style={{color:C.muted, fontSize:9, marginTop:6}}>
                        كل إشارة = 3 أوردرات دفعة واحدة · كل أوردر بـ SL/TP مستقل
                      </div>
                    </div>
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
                    {['#TICKET','TYPE','VOL','ENTRY','PROFIT','AGE'].map(h=>(
                      <th key={h} style={{...bLabel({padding:'6px 8px', textAlign:'left', color:C.neon})}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p,i)=>{
                    const buy=p.type==='BUY';
                    return (
                      <tr key={p.ticket??i} className="hrow" style={{
                        borderBottom:`1px solid ${C.faint}`,
                        borderLeft:`4px solid ${buy?C.neon:C.red}`,
                        cursor:'pointer',
                      }} onClick={()=>openTradeDetail(p)}>
                        <td style={{padding:'8px 8px', color:C.muted}}>#{p.ticket}</td>
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
          {showSettings && settingsDraft && (
            <div style={{display:'flex', gap:12, marginTop:14, flexWrap:'wrap', alignItems:'flex-end'}}>
              {settingKeys.map(k=>(
                <div key={k} style={{display:'flex', flexDirection:'column', gap:4}}>
                  <div style={bLabel({fontSize:9, color:C.yellow})}>{k}</div>
                  <input
                    type="number" step="any"
                    value={settingsDraft[k]??''}
                    onChange={e=>{settingsDirty.current=true;setSettingsDraft(d=>({...d,[k]:e.target.value===''?'':Number(e.target.value)}));}}
                    style={{
                      fontFamily:C.mono, fontSize:12, width:88,
                      padding:'6px 8px', background:C.bg,
                      border:C.border, color:C.neon,
                    }}
                  />
                  <button className="bbtn"
                    onClick={()=>saveSingle(k,settingsDraft[k])}
                    disabled={busy}
                    style={bBtn(false,{fontSize:9,padding:'4px 6px',letterSpacing:'1px'})}>
                    SAVE
                  </button>
                </div>
              ))}
              {/* Claude toggle */}
              <div style={{display:'flex', flexDirection:'column', gap:4}}>
                <div style={bLabel({fontSize:9, color:C.yellow})}>CLAUDE AI</div>
                <button className="bbtn"
                  onClick={()=>{
                    const v=(settingsDraft.ClaudeEnabled??1)===1?0:1;
                    setSettingsDraft(d=>({...d,ClaudeEnabled:v}));
                    saveSingle('ClaudeEnabled',v);
                  }}
                  style={bBtn((settingsDraft.ClaudeEnabled??1)===1,{padding:'6px 14px'})}>
                  {(settingsDraft.ClaudeEnabled??1)===1?'ON':'OFF'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ═══ TRADE HISTORY (full width) ═════════════════════ */}
        <div className="bcard" style={bCard()}>
          <div style={{fontSize:12, fontWeight:'bold', letterSpacing:'2px', marginBottom:12, color:C.ink}}>
            &gt; TRADE HISTORY · LAST {Math.min(history.length,20)}
          </div>
          {history.length===0 ? (
            <div style={bLabel({padding:'12px 0', color:C.yellow})}>NO CLOSED TRADES YET_</div>
          ) : (
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:11, minWidth:560}}>
                <thead>
                  <tr style={{borderBottom:'1px solid #30363d'}}>
                    {['#','TIME','TYPE','VOL','ENTRY','EXIT','PROFIT','SWAP','NET'].map(h=>(
                      <th key={h} style={{...bLabel({padding:'6px 8px',textAlign:'left', color:C.neon})}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.slice(0,20).map((t,i)=>{
                    const net=netOf(t);
                    const buy=t.type==='BUY';
                    return (
                      <tr key={t.ticket??i} className="hrow"
                        style={{
                          borderBottom:`1px solid ${C.faint}`, cursor:'pointer',
                          background: i%2===0 ? '#000' : 'rgba(255,255,255,0.04)',
                        }}
                        onClick={()=>setTradePopup(t)}>
                        <td style={{padding:'7px 8px', color:C.muted, borderLeft:`3px solid ${net>=0?C.neon:C.red}`}}>
                          {i+1}
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
    </div>
  );
}
