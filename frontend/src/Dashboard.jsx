import React, { useState, useEffect, useRef } from 'react';

const API_URL = import.meta.env.VITE_API_URL || "";
const API_KEY = 'mysecretkey123';
const POLL_MS = 1500;
const CANDLE_POLL_MS = 10000;

// ── Brutalist palette ──────────────────────────────────────────────
const C = {
  bg:      '#f5f5f0',
  surface: '#ffffff',
  ink:     '#000000',
  muted:   '#6b6b6b',
  faint:   '#d4d4cc',
  neon:    '#00e65b',
  neonDim: 'rgba(0,230,91,0.12)',
  red:     '#ff2a2a',
  blue:    '#2563eb',
  blueDim: '#dbeafe',
  dark:    '#0a0a0f',
  darkSurf:'#12121a',
  amber:   '#f59e0b',
  mono:    "'JetBrains Mono','Cascadia Code','Fira Code','Consolas',monospace",
  shadow:  '4px 4px 0px 0px #000',
  border:  '2px solid #000',
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
  padding: '1.25rem',
  minWidth: 0,
  fontFamily: C.mono,
  ...extra,
});

const bLabel = (extra = {}) => ({
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: C.muted,
  fontFamily: C.mono,
  fontWeight: 700,
  ...extra,
});

const bBtn = (active, extra = {}) => ({
  fontFamily: C.mono,
  fontWeight: 900,
  fontSize: 12,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  padding: '8px 18px',
  border: C.border,
  boxShadow: '3px 3px 0 0 #000',
  cursor: 'pointer',
  background: active ? C.ink : C.surface,
  color: active ? C.surface : C.ink,
  transition: 'box-shadow 0.1s, transform 0.1s',
  ...extra,
});

// ── Main ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const [data, setData] = useState(null);
  const [now, setNow] = useState(new Date());
  const [popup, setPopup] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [saveMsg, setSaveMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [candleData, setCandleData] = useState({ candles: [], sessions: {} });
  const [tradePopup, setTradePopup] = useState(null); // trade detail popup
  const seenTickets = useRef(null);
  const popupTimer = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let alive = true;
    const fetchData = async () => {
      try {
        const r = await fetch(`${API_URL}/api/dashboard`);
        if (!r.ok) return;
        const d = await r.json();
        if (!alive) return;
        const hist = Array.isArray(d.history) ? d.history : [];
        const tickets = new Set(hist.map(t => t.ticket));
        if (seenTickets.current !== null) {
          const fresh = hist.filter(t => !seenTickets.current.has(t.ticket));
          if (fresh.length > 0) {
            const t = fresh[0];
            const net = (t.profit || 0) + (t.swap || 0) + (t.commission || 0);
            setPopup({ profit: net });
            clearTimeout(popupTimer.current);
            popupTimer.current = setTimeout(() => setPopup(null), 3500);
          }
        }
        seenTickets.current = tickets;
        setData(d);
        setSettingsDraft(prev => (prev === null && d.settings) ? { ...d.settings } : prev);
      } catch (e) {}
    };
    fetchData();
    const t = setInterval(fetchData, POLL_MS);
    return () => { alive = false; clearInterval(t); clearTimeout(popupTimer.current); };
  }, []);

  useEffect(() => {
    let alive = true;
    const fetchCandles = async () => {
      try {
        const r = await fetch(`${API_URL}/api/candles`);
        if (!r.ok || !alive) return;
        const d = await r.json();
        setCandleData(d);
      } catch (e) {}
    };
    fetchCandles();
    const t = setInterval(fetchCandles, CANDLE_POLL_MS);
    return () => { alive = false; clearInterval(t); };
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

  const saveSingle = async (key, value) => {
    setBusy(true);
    setSaveMsg(`SAVING ${key}...`);
    try {
      const r = await fetch(`${API_URL}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify({ [key]: value }),
      });
      setSaveMsg(r.ok ? `✓ ${key} SAVED` : 'ERROR');
    } catch (e) { setSaveMsg('ERROR'); }
    setBusy(false);
    setTimeout(() => setSaveMsg(''), 2500);
  };

  // ── derive ─────────────────────────────────────────────────────
  const account   = data?.account || null;
  const positions = Array.isArray(data?.positions) ? data.positions : [];
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
  const bigPnl    = fmtBig(stats.total_profit);
  const pnlPos    = stats.total_profit >= 0;

  const recent30  = history.slice(0, 30).slice().reverse();

  const dayTrades = history.filter(t => new Date(t.time).getTime() > Date.now() - 86400000).slice().reverse();
  let cum = 0;
  const cumPts = dayTrades.map(t => (cum += netOf(t)));
  const peak24 = cumPts.length ? Math.max(...cumPts) : 0;

  const R = 44, CIRC = 2 * Math.PI * R;
  const streakPct = Math.min(1, streak / 20);

  const allNets   = history.map(t => netOf(t));
  const bestTrade = allNets.length ? Math.max(...allNets) : null;
  const worstTrade= allNets.length ? Math.min(...allNets) : null;

  const utc     = now.toISOString().slice(11, 19);
  const months  = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const dateStr = `${months[now.getUTCMonth()]} ${String(now.getUTCDate()).padStart(2,'0')} ${now.getUTCFullYear()}`;
  const claudeAdvice = data?.claude_advice || null;
  const claudeTime   = data?.claude_time   || null;

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
      backgroundImage: 'radial-gradient(#c8c8c0 1px, transparent 1px)',
      backgroundSize: '20px 20px',
      minHeight: '100vh',
      color: C.ink,
      paddingBottom: 52,
    }}>
      <style>{`
        * { box-sizing: border-box; }
        @keyframes popIn  { from { transform: scale(0.8) translateY(20px); opacity: 0; } to { transform: scale(1) translateY(0); opacity: 1; } }
        @keyframes blink  { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes spin   { to { transform: rotate(360deg); } }
        @keyframes slideUp{ from{transform:translateY(40px);opacity:0} to{transform:translateY(0);opacity:1} }
        .bcard:hover { box-shadow: 6px 6px 0 0 #000; }
        .bbtn:hover  { box-shadow: 6px 6px 0 0 #000; transform: translate(-1px,-1px); }
        .bbtn:active { box-shadow: 1px 1px 0 0 #000; transform: translate(2px,2px); }
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
        input:focus,select:focus{border-color:#000!important;}
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-thumb{background:#000}
      `}</style>

      {/* ═══ TOP BAR ═════════════════════════════════════════════ */}
      <header style={{
        position:'sticky', top:0, zIndex:600,
        background:C.dark, color:'#f0f0f0',
        padding:'10px 20px', borderBottom:'2px solid #00e65b',
        display:'flex', justifyContent:'space-between', alignItems:'center',
        flexWrap:'wrap', gap:'8px',
      }}>
        <div>
          <div style={{fontSize:13, fontWeight:900, letterSpacing:'0.15em'}}>
            <span style={{
              display:'inline-block', width:8, height:8, borderRadius:'50%',
              background: botRunning ? C.neon : C.amber, marginRight:8,
              animation: botRunning ? 'blink 2s infinite' : 'none',
            }}/>
            GOLD SCALPER X
            <span style={{fontSize:10, opacity:0.5, marginLeft:12, letterSpacing:'0.1em'}}>XAUUSD · M1</span>
          </div>
        </div>
        <div style={{textAlign:'center'}}>
          <div style={{
            fontSize:11, fontWeight:700, letterSpacing:'0.1em',
            color: isOnline ? C.neon : C.amber,
          }}>
            {isOnline ? '● LIVE FEED' : '○ OFFLINE'}
          </div>
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{fontSize:20, fontWeight:900, letterSpacing:'-0.03em', fontVariantNumeric:'tabular-nums'}}>{utc}</div>
          <div style={{fontSize:10, color:'#666', letterSpacing:'0.1em'}}>{dateStr} UTC</div>
        </div>
      </header>

      <div style={{padding:'1.25rem'}}>

        {/* ═══ ROW 1: PNL + STREAK ════════════════════════════ */}
        <div className="g4" style={{marginBottom:'1.25rem'}}>

          {/* PNL Hero */}
          <div className="s3 bcard" style={bCard({ background:C.surface })}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:8}}>
              <div style={bLabel()}>
                Total Realized PNL
                <span style={{marginLeft:10, color:C.neon, letterSpacing:'0.08em'}}>● LIVE</span>
              </div>
              <span style={{
                fontSize:10, fontWeight:700, background:C.ink, color:C.surface,
                padding:'3px 10px', letterSpacing:'0.1em',
              }}>XAU/USD · M1</span>
            </div>
            <div style={{
              fontSize:'clamp(44px,6vw,80px)', fontWeight:900, letterSpacing:'-0.04em',
              color: pnlPos ? C.neon : C.red,
              textShadow: pnlPos ? '0 0 30px rgba(0,230,91,0.3)' : '0 0 30px rgba(255,42,42,0.3)',
              lineHeight:1, margin:'8px 0 4px', fontVariantNumeric:'tabular-nums',
            }}>
              {bigPnl.neg ? '-$' : '$'}{bigPnl.dollars}
              <span style={{fontSize:'30%', opacity:0.7}}>.{bigPnl.cents}</span>
            </div>
            <div style={{fontSize:12, color:C.muted, letterSpacing:'0.05em'}}>
              <span style={{color: pnlPos ? C.neon : C.red, fontWeight:900}}>{pnlPos?'▲':'▼'}</span>
              {' '}{stats.total_trades.toLocaleString()} trades · {stats.win_rate}% win · {tradesPerDay.toFixed(1)}/day · avg {fmtMoney(avgPerTrade, true)}/trade
            </div>
            {/* Mini trade strip */}
            <div style={{display:'flex', gap:2, marginTop:14}}>
              {recent30.length === 0
                ? <div style={bLabel()}>NO DATA YET</div>
                : recent30.map((t,i) => (
                    <div key={t.ticket??i} title={fmtMoney(netOf(t),true)} style={{
                      flex:1, height:10, maxWidth:28,
                      background: netOf(t)>0 ? C.neon : C.red,
                      cursor:'pointer',
                    }} onClick={() => setTradePopup(t)} />
                  ))
              }
            </div>
          </div>

          {/* Win Streak */}
          <div className="bcard" style={bCard({
            display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8,
          })}>
            <svg width="108" height="108" viewBox="0 0 108 108">
              <circle cx="54" cy="54" r={R} fill="none" stroke={C.faint} strokeWidth="6"/>
              <circle cx="54" cy="54" r={R} fill="none"
                stroke={streak>0 ? C.neon : C.faint} strokeWidth="6"
                strokeDasharray={`${CIRC*streakPct} ${CIRC}`}
                transform="rotate(-90 54 54)" strokeLinecap="butt"/>
              <text x="54" y="62" textAnchor="middle"
                fontSize="32" fontWeight="900" fontFamily={C.mono}
                fill={streak>0 ? C.ink : C.muted}>{streak}</text>
            </svg>
            <div style={bLabel()}>Win Streak</div>
            <div style={{
              fontSize:10, fontWeight:700, background:C.blueDim, color:C.blue,
              border:`1px solid ${C.blue}`, padding:'2px 10px', letterSpacing:'0.1em',
            }}>
              {streak > 0 ? `${streak} IN A ROW` : 'NO STREAK'}
            </div>
          </div>
        </div>

        {/* ═══ ROW 2: CHART + 24H PNL ════════════════════════ */}
        <div className="g2" style={{marginBottom:'1.25rem'}}>

          {/* M1 Chart */}
          <div className="bcard" style={bCard()}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8}}>
              <div style={bLabel()}>XAUUSD · M1 · LIVE</div>
              {candles.length > 0 && (
                <div style={{
                  fontSize:14, fontWeight:900,
                  color: (candles[candles.length-1]?.c >= candles[candles.length-1]?.o) ? C.neon : C.red,
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
                  background: sessions[s.key] ? C.neon : C.faint,
                  color: sessions[s.key] ? C.ink : C.muted,
                  fontSize:9, fontWeight:900, letterSpacing:'0.08em',
                  border: sessions[s.key] ? `2px solid ${C.ink}` : `2px solid ${C.faint}`,
                }}>
                  <div>{s.name}</div>
                  <div style={{fontWeight:400, opacity:0.8}}>{s.h} UTC</div>
                </div>
              ))}
            </div>
            {candles.length < 2 ? (
              <div style={{...bLabel(), padding:'30px 0', textAlign:'center'}}>
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
                <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'auto',display:'block'}}>
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
                      <line x1={padL} y1={y} x2={W-padR} y2={y} stroke={C.amber} strokeWidth="1.5" strokeDasharray="5 3"/>
                      <text x={W-padR+4} y={y+3} fontSize="8" fill={C.amber} fontFamily={C.mono} fontWeight="bold">{p.price_open?.toFixed(2)}</text>
                    </g>;
                  })}
                  {(()=>{
                    const lc=last[last.length-1];
                    const y=Y(lc.c);
                    return <g>
                      <rect x={W-padR} y={y-7} width={padR} height={14} fill={lc.c>=lc.o?C.neon:C.red}/>
                      <text x={W-padR+3} y={y+4} fontSize="8" fill={C.ink} fontFamily={C.mono} fontWeight="900">{lc.c?.toFixed(2)}</text>
                    </g>;
                  })()}
                </svg>
              );
            })()}
          </div>

          {/* 24H PNL Chart */}
          <div className="bcard" style={bCard({ background:C.surface })}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
              <div style={bLabel()}>24H PNL · CURVE</div>
              <div style={bLabel()}>PEAK <span style={{color:C.neon, fontWeight:900}}>{fmtMoney(peak24,true)}</span></div>
            </div>
            <div style={{
              fontSize:32, fontWeight:900, letterSpacing:'-0.03em',
              color: cum>=0 ? C.neon : C.red, margin:'6px 0 12px',
            }}>{fmtMoney(cum,true)}</div>
            <svg width="100%" height="160" viewBox="0 0 400 160" preserveAspectRatio="none" style={{display:'block'}}>
              {cumPts.length < 2 ? (
                <text x="200" y="85" textAnchor="middle" fontSize="11" fill={C.muted} fontFamily={C.mono} letterSpacing="3">AWAITING DATA</text>
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
                    fill={pos?C.neon:C.red} fillOpacity="0.15"/>
                  <path d={line} fill="none" stroke={pos?C.neon:C.red} strokeWidth="2.5"/>
                  <circle cx={X(cumPts.length-1)} cy={Y(cumPts[cumPts.length-1])} r="4"
                    fill={pos?C.neon:C.red} stroke={C.ink} strokeWidth="1.5"/>
                </g>;
              })()}
            </svg>
            {/* Today stats */}
            <div style={{display:'flex', gap:20, marginTop:12, flexWrap:'wrap'}}>
              {[
                {l:'Today Trades', v: todayTrades.length},
                {l:'Today Wins',   v: todayWins,    c: C.neon},
                {l:'Today Losses', v: todayLosses,  c: C.red},
                {l:'Today Net',    v: fmtMoney(todayNet,true), c: todayNet>=0?C.neon:C.red},
              ].map(x=>(
                <div key={x.l}>
                  <div style={bLabel({fontSize:9})}>{x.l}</div>
                  <div style={{fontSize:18, fontWeight:900, color: x.c||C.ink}}>{x.v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ═══ ROW 3: STATS CHIPS ═════════════════════════════ */}
        <div className="g4" style={{marginBottom:'1.25rem'}}>
          {[
            { l:'WIN RATE',    v: `${stats.win_rate}%`,          c: stats.win_rate>=50?C.neon:C.red },
            { l:'BEST TRADE',  v: bestTrade!==null?fmtMoney(bestTrade,true):'--', c:C.neon },
            { l:'WORST TRADE', v: worstTrade!==null?fmtMoney(worstTrade,true):'--', c:C.red },
            { l:'1H VELOCITY', v: `${tradesLastHour} trades`,    c:C.ink },
          ].map(x=>(
            <div key={x.l} className="bcard" style={bCard({padding:'1rem'})}>
              <div style={bLabel()}>{x.l}</div>
              <div style={{fontSize:28, fontWeight:900, color:x.c, letterSpacing:'-0.03em', marginTop:4}}>{x.v}</div>
            </div>
          ))}
        </div>

        {/* ═══ ROW 4: OPEN POSITIONS ══════════════════════════ */}
        <div className="bcard" style={{...bCard({padding:'1rem', marginBottom:'1.25rem'})}}>
          <div style={{display:'flex', gap:12, alignItems:'baseline', marginBottom:10, flexWrap:'wrap'}}>
            <span style={{fontSize:12, fontWeight:900, letterSpacing:'0.12em'}}>
              <span style={{
                display:'inline-block', width:8, height:8, borderRadius:'50%', marginRight:8,
                background: positions.length?C.neon:C.faint,
                animation: positions.length?'blink 2s infinite':'none',
              }}/>
              OPEN POSITIONS
            </span>
            <span style={bLabel()}>{positions.length} open · total {fmtMoney(openTotal,true)}</span>
          </div>
          {positions.length === 0 ? (
            <div style={bLabel({padding:'12px 0'})}>NO OPEN POSITIONS · MONITORING MARKET</div>
          ) : (
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:520}}>
                <thead>
                  <tr style={{borderBottom:`2px solid ${C.ink}`}}>
                    {['#TICKET','TYPE','VOL','ENTRY','PROFIT','AGE'].map(h=>(
                      <th key={h} style={{...bLabel({padding:'6px 8px', textAlign:'left'})}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p,i)=>{
                    const buy=p.type==='BUY';
                    return (
                      <tr key={p.ticket??i} style={{
                        borderBottom:`1px solid ${C.faint}`,
                        borderLeft:`4px solid ${buy?C.neon:C.red}`,
                        cursor:'pointer',
                      }} onClick={()=>setTradePopup(p)}>
                        <td style={{padding:'8px 8px', color:C.muted}}>#{p.ticket}</td>
                        <td style={{padding:'8px 8px', fontWeight:900, color:buy?C.neon:C.red}}>{p.type}</td>
                        <td style={{padding:'8px 8px'}}>{p.volume}</td>
                        <td style={{padding:'8px 8px', fontVariantNumeric:'tabular-nums'}}>{p.price_open}</td>
                        <td style={{padding:'8px 8px', fontWeight:900, color:(p.profit||0)>=0?C.neon:C.red, fontVariantNumeric:'tabular-nums'}}>
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

        {/* ═══ ROW 5: PIPELINE ════════════════════════════════ */}
        <div className="bcard" style={{...bCard({marginBottom:'1.25rem', padding:'1rem'})}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, flexWrap:'wrap', gap:8}}>
            <div style={{fontSize:12, fontWeight:900, letterSpacing:'0.12em'}}>6-CYCLE EXECUTION PIPELINE</div>
            <div style={bLabel()}>
              Cycle <span style={{color:C.neon, fontWeight:900}}>+{stats.total_trades}</span> · avg {tradesPerDay.toFixed(1)}/day
            </div>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))', gap:'0.5rem'}}>
            {pipeline.map((step,idx)=>{
              const isActive = step.active;
              const isDone   = step.ok && !isActive;
              return (
                <div key={step.n} style={{
                  border: isDone||isActive ? C.border : `2px solid ${C.faint}`,
                  padding:'0.75rem 0.5rem',
                  textAlign:'center',
                  opacity: isDone||isActive ? 1 : 0.45,
                  background: isActive ? C.ink : isDone ? C.neonDim : C.surface,
                  position:'relative',
                }}>
                  {isActive && (
                    <div style={{
                      position:'absolute', top:4, right:4, width:7, height:7,
                      borderRadius:'50%', background:C.neon,
                      animation:'blink 1s infinite',
                    }}/>
                  )}
                  <div style={bLabel({fontSize:9, color: isActive?'#666':C.muted})}>{step.n}</div>
                  <div style={{
                    fontSize:11, fontWeight:900, letterSpacing:'0.1em',
                    color: isActive ? C.neon : C.ink, margin:'4px 0',
                  }}>{step.t}</div>
                  <div style={bLabel({fontSize:9, textTransform:'none', color:isActive?'#888':C.muted})}>{step.s}</div>
                  <div style={{
                    fontSize:10, marginTop:6, fontWeight:900,
                    color: step.last !== undefined
                      ? (step.last===null?C.muted:step.last>=0?C.neon:C.red)
                      : isActive?C.neon:isDone?C.neon:C.muted,
                  }}>
                    {step.last !== undefined
                      ? (step.last===null?'LAST: --':`LAST: ${fmtMoney(step.last,true)}`)
                      : isActive?'● ACTIVE':isDone?'✓ READY':'IDLE'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ═══ ROW 6: BOT CONTROL + DIRECTION ════════════════ */}
        <div className="g3" style={{marginBottom:'1.25rem'}}>

          {/* Bot Control */}
          <div className="bcard" style={bCard({textAlign:'center'})}>
            <div style={bLabel({marginBottom:8})}>BOT STATUS</div>
            <div style={{
              fontSize:42, fontWeight:900, letterSpacing:'-0.03em',
              color: botRunning ? C.neon : C.red, margin:'4px 0 12px',
            }}>
              {botRunning ? 'UP ▲' : 'DOWN ▼'}
            </div>
            <div style={bLabel({marginBottom:12})}>
              LOT {settings.LotSize??'--'} · TP ${settings.TP_USD??'--'} · SL ${settings.SL_USD??'--'}
            </div>
            <button
              className="bbtn"
              onClick={() => botControl(botRunning?'stop':'start')}
              disabled={busy}
              style={bBtn(botRunning, { background: botRunning?C.red:C.neon, color:C.ink, borderColor:C.ink })}
            >
              {botRunning ? 'STOP BOT' : 'START BOT'}
            </button>
          </div>

          {/* Direction */}
          <div className="bcard" style={bCard()}>
            <div style={bLabel({marginBottom:8})}>DIRECTION FILTER</div>
            {settingsDraft && (
              <div style={{display:'flex', flexDirection:'column', gap:8}}>
                <select
                  value={settingsDraft.Direction??0}
                  onChange={e=>setSettingsDraft(d=>({...d,Direction:Number(e.target.value)}))}
                  style={{
                    fontFamily:C.mono, fontSize:12, fontWeight:700,
                    padding:'8px 10px', background:C.surface,
                    border:C.border, color:C.ink, cursor:'pointer',
                  }}
                >
                  <option value={0}>FREE (BUY + SELL)</option>
                  <option value={1}>BUY ONLY ▲</option>
                  <option value={-1}>SELL ONLY ▼</option>
                </select>
                <button className="bbtn"
                  onClick={()=>saveSingle('Direction',settingsDraft.Direction??0)}
                  disabled={busy}
                  style={bBtn(true)}>SAVE DIRECTION</button>
              </div>
            )}
          </div>

          {/* Claude AI */}
          <div className="bcard" style={bCard({ background:C.dark, color:'#f0f0f0', border:'2px solid #00e65b' })}>
            <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:10}}>
              <span style={{fontSize:11, fontWeight:900, letterSpacing:'0.15em', color:C.neon}}>◆ CLAUDE AI</span>
              {claudeTime && <span style={{fontSize:9, color:'#666'}}>{new Date(claudeTime).toLocaleTimeString()}</span>}
            </div>
            {claudeAdvice ? (
              <div style={{fontSize:13, fontWeight:700, color:'#e8e8e8', lineHeight:1.6}}>
                "{claudeAdvice}"
              </div>
            ) : (
              <div style={{fontSize:10, color:'#555', letterSpacing:'0.08em', lineHeight:1.6}}>
                MONITORING · WILL ADVISE<br/>AFTER 5 CONSECUTIVE LOSSES
              </div>
            )}
          </div>
        </div>

        {/* ═══ ROW 7: SETTINGS ════════════════════════════════ */}
        <div className="bcard" style={bCard({marginBottom:'1.25rem'})}>
          <div
            onClick={()=>setShowSettings(s=>!s)}
            style={{cursor:'pointer', fontSize:12, fontWeight:900, letterSpacing:'0.12em', userSelect:'none', display:'flex', alignItems:'center', gap:12}}
          >
            ⚙ SETTINGS {showSettings?'▾':'▸'}
            {saveMsg && (
              <span style={{
                fontSize:10, fontWeight:700,
                color: saveMsg.includes('ERROR')?C.red:C.neon,
                letterSpacing:'0.1em',
              }}>{saveMsg}</span>
            )}
          </div>
          {showSettings && settingsDraft && (
            <div style={{display:'flex', gap:12, marginTop:14, flexWrap:'wrap', alignItems:'flex-end'}}>
              {settingKeys.map(k=>(
                <div key={k} style={{display:'flex', flexDirection:'column', gap:4}}>
                  <div style={bLabel({fontSize:9})}>{k}</div>
                  <input
                    type="number" step="any"
                    value={settingsDraft[k]??''}
                    onChange={e=>setSettingsDraft(d=>({...d,[k]:e.target.value===''?'':Number(e.target.value)}))}
                    style={{
                      fontFamily:C.mono, fontSize:12, width:88,
                      padding:'6px 8px', background:C.surface,
                      border:C.border, color:C.ink,
                    }}
                  />
                  <button className="bbtn"
                    onClick={()=>saveSingle(k,settingsDraft[k])}
                    disabled={busy}
                    style={bBtn(false,{fontSize:9,padding:'4px 6px',letterSpacing:'0.08em'})}>
                    SAVE
                  </button>
                </div>
              ))}
              {/* Claude toggle */}
              <div style={{display:'flex', flexDirection:'column', gap:4}}>
                <div style={bLabel({fontSize:9})}>CLAUDE AI</div>
                <button className="bbtn"
                  onClick={()=>{
                    const v=(settingsDraft.ClaudeEnabled??1)===1?0:1;
                    setSettingsDraft(d=>({...d,ClaudeEnabled:v}));
                    saveSingle('ClaudeEnabled',v);
                  }}
                  style={bBtn((settingsDraft.ClaudeEnabled??1)===1,{
                    background:(settingsDraft.ClaudeEnabled??1)===1?C.neon:C.faint,
                    color:C.ink, padding:'6px 14px',
                  })}>
                  {(settingsDraft.ClaudeEnabled??1)===1?'ON':'OFF'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ═══ ROW 8: TRADE HISTORY ═══════════════════════════ */}
        <div className="bcard" style={bCard()}>
          <div style={{fontSize:12, fontWeight:900, letterSpacing:'0.12em', marginBottom:12}}>
            TRADE HISTORY · LAST {Math.min(history.length,50)}
          </div>
          {history.length===0 ? (
            <div style={bLabel({padding:'12px 0'})}>NO CLOSED TRADES YET</div>
          ) : (
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:11, minWidth:560}}>
                <thead>
                  <tr style={{borderBottom:`2px solid ${C.ink}`}}>
                    {['#','TIME','TYPE','VOL','ENTRY','EXIT','PROFIT','SWAP','NET'].map(h=>(
                      <th key={h} style={{...bLabel({padding:'6px 8px',textAlign:'left'})}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.slice(0,50).map((t,i)=>{
                    const net=netOf(t);
                    const buy=t.type==='BUY';
                    return (
                      <tr key={t.ticket??i}
                        style={{borderBottom:`1px solid ${C.faint}`, cursor:'pointer'}}
                        onClick={()=>setTradePopup(t)}>
                        <td style={{padding:'7px 8px', color:C.muted, borderLeft:`3px solid ${net>=0?C.neon:C.red}`}}>
                          {i+1}
                        </td>
                        <td style={{padding:'7px 8px', color:C.muted, fontVariantNumeric:'tabular-nums'}}>
                          {t.time ? new Date(t.time).toLocaleTimeString() : '--'}
                        </td>
                        <td style={{padding:'7px 8px', fontWeight:900, color:buy?C.neon:C.red}}>{t.type??'--'}</td>
                        <td style={{padding:'7px 8px'}}>{t.volume??'--'}</td>
                        <td style={{padding:'7px 8px', fontVariantNumeric:'tabular-nums'}}>{t.price_open??'--'}</td>
                        <td style={{padding:'7px 8px', fontVariantNumeric:'tabular-nums'}}>{t.price_close??'--'}</td>
                        <td style={{padding:'7px 8px', fontVariantNumeric:'tabular-nums', color:(t.profit||0)>=0?C.neon:C.red}}>
                          {fmtMoney(t.profit,true)}
                        </td>
                        <td style={{padding:'7px 8px', color:C.muted, fontVariantNumeric:'tabular-nums'}}>
                          {fmtMoney(t.swap??0,true)}
                        </td>
                        <td style={{padding:'7px 8px', fontWeight:900, fontVariantNumeric:'tabular-nums', color:net>=0?C.neon:C.red}}>
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
        background:C.dark, color:'#f0f0f0', fontFamily:C.mono,
        fontSize:11, letterSpacing:'0.1em', padding:'8px 16px',
        whiteSpace:'nowrap', overflow:'hidden', borderTop:'2px solid #222',
        fontVariantNumeric:'tabular-nums',
      }}>
        BAL {account?'$'+Number(account.balance??0).toLocaleString('en-US',{minimumFractionDigits:2}):'--'}
        {' · '}EQ {account?'$'+Number(account.equity??0).toLocaleString('en-US',{minimumFractionDigits:2}):'--'}
        {' · '}FREE {account?'$'+Number(account.margin_free??account.free_margin??0).toLocaleString('en-US',{minimumFractionDigits:2}):'--'}
        {' · '}TP ${settings.TP_USD??'--'} · SL ${settings.SL_USD??'--'}
        {' · '}MAX POS {settings.MaxPositions??'--'}
        {' · '}<span style={{color:isOnline?C.neon:C.amber}}>{isOnline?'● LIVE':'○ STALE'}</span>
      </div>

      {/* ═══ PROFIT POPUP (trade close) ══════════════════════ */}
      {popup && (
        <div style={{
          position:'fixed', inset:0, display:'flex',
          alignItems:'center', justifyContent:'center',
          background:'rgba(0,0,0,0.6)', zIndex:1000,
        }} onClick={()=>setPopup(null)}>
          <div style={{
            background:C.surface,
            border:`4px solid ${popup.profit>=0?C.neon:C.red}`,
            boxShadow: `8px 8px 0 0 ${popup.profit>=0?C.neon:C.red}`,
            padding:'40px 60px', textAlign:'center',
            animation:'popIn 0.25s ease-out',
            fontFamily:C.mono,
          }}>
            <div style={bLabel({marginBottom:8})}>TRADE CLOSED</div>
            <div style={{
              fontSize:72, fontWeight:900, letterSpacing:'-0.04em',
              color: popup.profit>=0 ? C.neon : C.red,
              textShadow: popup.profit>=0 ? '0 0 40px rgba(0,230,91,0.5)' : '0 0 40px rgba(255,42,42,0.5)',
              fontVariantNumeric:'tabular-nums',
            }}>
              {fmtMoney(popup.profit,true)}
            </div>
            <div style={{
              fontSize:14, fontWeight:900, letterSpacing:'0.2em', marginTop:8,
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
          background:'rgba(0,0,0,0.55)', zIndex:999,
        }} onClick={()=>setTradePopup(null)}>
          <div style={{
            background:C.surface, border:C.border,
            boxShadow:C.shadow, padding:'28px 32px',
            fontFamily:C.mono, minWidth:280,
            animation:'slideUp 0.2s ease-out',
          }} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:11, fontWeight:900, letterSpacing:'0.15em', marginBottom:16}}>
              TRADE DETAIL · #{tradePopup.ticket}
            </div>
            {[
              ['Type',      tradePopup.type??'--'],
              ['Volume',    tradePopup.volume??'--'],
              ['Entry',     tradePopup.price_open??'--'],
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
                  fontSize:12, fontWeight:700,
                  color: k==='Net' ? (netOf(tradePopup)>=0?C.neon:C.red) : C.ink,
                  fontVariantNumeric:'tabular-nums',
                }}>{v}</span>
              </div>
            ))}
            <button className="bbtn"
              onClick={()=>setTradePopup(null)}
              style={bBtn(true,{width:'100%',marginTop:16})}>CLOSE</button>
          </div>
        </div>
      )}
    </div>
  );
}
