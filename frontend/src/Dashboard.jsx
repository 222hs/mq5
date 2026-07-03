import React, { useState, useEffect, useRef } from 'react';

const API_URL = import.meta.env.VITE_API_URL || "";
const API_KEY = 'mysecretkey123';
const POLL_MS = 1500;
const CANDLE_POLL_MS = 10000;

// ---------- palette : parchment terminal ----------
const C = {
  bg: '#f0ebe0',
  panel: '#f5f1e8',
  panelLight: '#fafaf8',
  border: '#d4cfc4',
  text: '#1a1a1a',
  sub: '#4a4a4a',
  dim: '#8a8580',
  green: '#2d6a4f',
  greenBright: '#52b788',
  red: '#b5451b',
  amber: '#e07b39',
  dark: '#1a1a18',
  cream: '#e8e4d9',
  mono: "'Courier New', monospace",
};

// ---------- helpers ----------
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
const label = (extra = {}) => ({
  fontSize: 10, letterSpacing: 2, textTransform: 'uppercase',
  color: C.dim, fontFamily: C.mono, ...extra,
});
function Dot({ color, size = 8 }) {
  return <span style={{
    display: 'inline-block', width: size, height: size, borderRadius: '50%',
    background: color, marginRight: 6, verticalAlign: 'middle',
  }} />;
}

// ---------- main component ----------
export default function Dashboard() {
  const [data, setData] = useState(null);
  const [now, setNow] = useState(new Date());
  const [popup, setPopup] = useState(null);          // { profit }
  const [showSettings, setShowSettings] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [saveMsg, setSaveMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [candleData, setCandleData] = useState({ candles: [], sessions: {} });
  const seenTickets = useRef(null);
  const popupTimer = useRef(null);

  // clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // poll dashboard
  useEffect(() => {
    let alive = true;
    const fetchData = async () => {
      try {
        const r = await fetch(`${API_URL}/api/dashboard`);
        if (!r.ok) return;
        const d = await r.json();
        if (!alive) return;

        // detect new closed trades -> popup
        const hist = Array.isArray(d.history) ? d.history : [];
        const tickets = new Set(hist.map(t => t.ticket));
        if (seenTickets.current !== null) {
          const fresh = hist.filter(t => !seenTickets.current.has(t.ticket));
          if (fresh.length > 0) {
            const t = fresh[0];
            setPopup({ profit: (t.profit || 0) + (t.swap || 0) + (t.commission || 0) });
            clearTimeout(popupTimer.current);
            popupTimer.current = setTimeout(() => setPopup(null), 3000);
          }
        }
        seenTickets.current = tickets;
        setData(d);
        setSettingsDraft(prev => (prev === null && d.settings) ? { ...d.settings } : prev);
      } catch (e) { /* network hiccup — keep last data */ }
    };
    fetchData();
    const t = setInterval(fetchData, POLL_MS);
    return () => { alive = false; clearInterval(t); clearTimeout(popupTimer.current); };
  }, []);

  // candle poll — separate, slower
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
    } catch (e) { }
    setBusy(false);
  };

  const saveSettings = async () => {
    if (!settingsDraft) return;
    setBusy(true);
    setSaveMsg('SAVING...');
    try {
      const r = await fetch(`${API_URL}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify(settingsDraft),
      });
      setSaveMsg(r.ok ? 'SAVED' : 'ERROR');
    } catch (e) { setSaveMsg('ERROR'); }
    setBusy(false);
    setTimeout(() => setSaveMsg(''), 2500);
  };

  // ---------- derive ----------
  const account = data?.account || null;
  const positions = Array.isArray(data?.positions) ? data.positions : [];
  const history = Array.isArray(data?.history) ? data.history : [];
  const stats = data?.stats || { total_trades: 0, wins: 0, losses: 0, win_rate: 0, total_profit: 0 };
  const settings = data?.settings || {};
  const isOnline = !!data?.is_online;
  const botRunning = !!data?.bot_running;
  const candles = candleData.candles || [];
  const sessions = candleData.sessions || {};

  const netOf = t => (t.profit || 0) + (t.swap || 0) + (t.commission || 0);

  // time span of visible history
  const times = history.map(t => new Date(t.time).getTime()).filter(x => !isNaN(x));
  const spanMs = times.length > 1 ? Math.max(...times) - Math.min(...times) : 0;
  const spanDays = Math.max(1, spanMs / 86400000);
  const tradesPerDay = stats.total_trades / spanDays;
  const avgPerTrade = stats.total_trades ? stats.total_profit / stats.total_trades : 0;
  const perSec = spanMs > 0 ? stats.total_profit / (spanMs / 1000) : 0;

  // win streak (history is newest first)
  let streak = 0;
  for (const t of history) { if (netOf(t) > 0) streak++; else break; }

  // today's stats
  const todayStr = new Date().toDateString();
  const todayTrades = history.filter(t => new Date(t.time).toDateString() === todayStr);
  const todayWins = todayTrades.filter(t => netOf(t) > 0).length;
  const todayLosses = todayTrades.length - todayWins;
  const todayNet = todayTrades.reduce((a, t) => a + netOf(t), 0);

  // velocity 1h
  const tradesLastHour = history.filter(t => new Date(t.time).getTime() > Date.now() - 3600000).length;

  // open positions aggregates
  const openTotal = positions.reduce((a, p) => a + (p.profit || 0), 0);
  const openAvg = positions.length ? openTotal / positions.length : 0;

  const lastTrade = history[0] || null;
  const lastProfit = lastTrade ? netOf(lastTrade) : null;

  const bigPnl = fmtBig(stats.total_profit);
  const pnlColor = stats.total_profit >= 0 ? C.green : C.red;

  // recent 30 trades segment row (oldest -> newest, left to right)
  const recent30 = history.slice(0, 30).slice().reverse();

  // cash flow bars: last 20 trades sorted by profit desc
  const bars = history.slice(0, 20).map(t => ({ ...t, net: netOf(t) })).sort((a, b) => b.net - a.net);
  const maxAbs = Math.max(1, ...bars.map(b => Math.abs(b.net)));

  // 24h cumulative pnl for area chart
  const dayTrades = history
    .filter(t => new Date(t.time).getTime() > Date.now() - 86400000)
    .slice().reverse(); // oldest first
  let cum = 0;
  const cumPts = dayTrades.map(t => (cum += netOf(t)));
  const peak24 = cumPts.length ? Math.max(...cumPts) : 0;

  // streak circle
  const streakPct = Math.min(1, streak / 20);
  const R = 50, CIRC = 2 * Math.PI * R;

  const utc = now.toISOString().slice(11, 19);
  const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const dateStr = `${monthNames[now.getUTCMonth()]} · ${String(now.getUTCDate()).padStart(2, '0')}`;

  const settingKeys = ['LotSize', 'TP_USD', 'SL_USD', 'MaxSpread', 'MaxPositions', 'CooldownSecs', 'TrailUSD'];

  const pipeline = [
    { n: '01', t: 'SIGNAL', s: 'candle dir', ok: botRunning },
    { n: '02', t: 'FILTER', s: `spread<${settings.MaxSpread ?? '--'}`, ok: botRunning },
    { n: '03', t: 'SIZE', s: `lot ${settings.LotSize ?? '--'}`, ok: botRunning },
    { n: '04', t: 'ENTRY', s: 'market ord', ok: botRunning },
    { n: '05', t: 'MANAGE', s: 'TP/SL mon', ok: positions.length > 0, active: positions.length > 0 },
  ];

  const card = (extra = {}) => ({
    background: C.panel, padding: 18, minWidth: 0, ...extra,
  });

  return (
    <div style={{
      background: C.bg, minHeight: '100vh', width: '100vw',
      fontFamily: C.mono, color: C.text, boxSizing: 'border-box',
      paddingBottom: 44, // space for fixed ticker
    }}>
      <style>{`
        * { box-sizing: border-box; }
        @keyframes popIn { from { transform: scale(0.7); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
        .gsx-grid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 1px;
          background: ${C.border};
          width: 100%;
        }
        .gsx-span2 { grid-column: span 2; }
        .gsx-span3 { grid-column: span 3; }
        .gsx-pipegrid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 1px;
          background: ${C.border};
        }
        @media (max-width: 900px) {
          .gsx-grid { grid-template-columns: 1fr 1fr; }
          .gsx-span2, .gsx-span3 { grid-column: span 2; }
          .gsx-pipegrid { grid-template-columns: 1fr 1fr; }
          .gsx-topbar { flex-wrap: wrap; gap: 6px; }
        }
        @media (max-width: 600px) {
          .gsx-grid { grid-template-columns: 1fr; }
          .gsx-span2, .gsx-span3 { grid-column: span 1; }
          .gsx-pipegrid { grid-template-columns: 1fr; }
        }
      `}</style>

      {/* ============ TOP BAR (outside grid) ============ */}
      <div className="gsx-topbar" style={{
        position: 'sticky', top: 0, zIndex: 600,
        background: C.dark, color: C.cream,
        padding: '10px 20px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 2 }}>
            <Dot color={botRunning ? C.greenBright : C.amber} />
            GOLD SCALPER X · LIVE · {now.getUTCFullYear()}
          </div>
          <div style={label({ marginTop: 3, color: '#8a8580' })}>
            XAUUSD · M1 SCALPER · LOT {settings.LotSize ?? '--'}
          </div>
        </div>
        <div style={{
          fontSize: 12, letterSpacing: 2, fontWeight: 700,
          color: isOnline ? C.greenBright : C.amber,
        }}>
          <span style={isOnline ? { animation: 'blink 2s infinite' } : {}}>{isOnline ? '●' : '○'}</span>
          {' '}{isOnline ? 'ONLINE' : 'OFFLINE'}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 1 }}>{utc} UTC</div>
          <div style={label({ marginTop: 3, color: '#8a8580' })}>{dateStr}</div>
        </div>
      </div>

      {/* ============ MAIN GRID ============ */}
      <div className="gsx-grid">

        {/* --- HERO PnL (span 2) --- */}
        <div className="gsx-span2" style={card({ background: C.panelLight })}>
          <div style={label()}>
            TOTAL · REALIZED PNL&nbsp;&nbsp;
            <span style={{ color: C.greenBright }}>● LIVE</span>
          </div>
          <div style={{
            fontSize: 'clamp(48px, 5vw, 80px)', fontWeight: 900, letterSpacing: -3,
            lineHeight: 1.05, color: pnlColor, margin: '6px 0 2px 0', whiteSpace: 'nowrap',
          }}>
            {bigPnl.neg ? '-$' : '$'}{bigPnl.dollars}
            <span style={{ fontSize: 32, fontWeight: 700, letterSpacing: 0, opacity: 0.7 }}>.{bigPnl.cents}</span>
          </div>
          <div style={{ fontSize: 13, color: C.sub, letterSpacing: 1 }}>
            <span style={{ color: pnlColor }}>{stats.total_profit >= 0 ? '▲' : '▼'}</span>
            {stats.total_trades.toLocaleString()} trades · {stats.win_rate}% win · {tradesPerDay.toFixed(1)}/day · avg {fmtMoney(avgPerTrade, true)}/trade
          </div>
          <div style={label({ marginTop: 6 })}>
            XAUUSD · M1 MARKETS · {now.getUTCFullYear()} · {fmtMoney(perSec, true)}/sec live
          </div>
          {/* last 30 trades segments */}
          <div style={{ display: 'flex', gap: 2, marginTop: 12 }}>
            {recent30.length === 0 && <div style={label()}>NO TRADE DATA YET</div>}
            {recent30.map((t, i) => (
              <div key={t.ticket ?? i} title={fmtMoney(netOf(t), true)} style={{
                flex: 1, height: 8, maxWidth: 26,
                background: netOf(t) > 0 ? C.greenBright : C.amber,
              }} />
            ))}
          </div>
        </div>

        {/* --- WIN STREAK (span 1) --- */}
        <div style={card({
          background: C.panel, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
        })}>
          <svg width="126" height="126" viewBox="0 0 126 126">
            <circle cx="63" cy="63" r={R} fill="none" stroke={C.border} strokeWidth="7" />
            <circle
              cx="63" cy="63" r={R} fill="none"
              stroke={streak > 0 ? C.greenBright : C.dim} strokeWidth="7"
              strokeDasharray={`${CIRC * streakPct} ${CIRC}`}
              strokeLinecap="butt"
              transform="rotate(-90 63 63)"
            />
            <text x="63" y="74" textAnchor="middle" fontSize="34" fontWeight="900"
              fontFamily={C.mono} fill={streak > 0 ? C.green : C.sub}>{streak}</text>
          </svg>
          <div style={label({ marginTop: 8, color: C.sub })}>WIN STREAK</div>
          <div style={label({ marginTop: 2 })}>STREAK {streak}</div>
        </div>

        {/* --- M1 CANDLESTICK CHART (span 1) --- */}
        <div style={card()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <div style={label()}>XAUUSD · M1 · LIVE</div>
            {candles.length > 0 && (
              <div style={{ fontSize: 13, fontWeight: 900, color: candles[candles.length-1]?.c >= candles[candles.length-1]?.o ? C.green : C.red }}>
                {candles[candles.length-1]?.c?.toFixed(2)}
              </div>
            )}
          </div>
          {/* Trading sessions */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {[
              { name: 'TOKYO', key: 'tokyo', hours: '00-09' },
              { name: 'LONDON', key: 'london', hours: '07-16' },
              { name: 'NY', key: 'ny', hours: '13-22' },
            ].map(s => (
              <div key={s.key} style={{
                flex: 1, textAlign: 'center', padding: '4px 2px',
                background: sessions[s.key] ? C.green : C.border,
                color: sessions[s.key] ? '#fff' : C.dim,
                fontSize: 9, letterSpacing: 1, fontFamily: C.mono,
              }}>
                <div style={{ fontWeight: 900 }}>{s.name}</div>
                <div style={{ opacity: 0.8 }}>{s.hours} UTC</div>
              </div>
            ))}
          </div>
          {/* Candlestick SVG */}
          {candles.length < 2 ? (
            <div style={label({ padding: '20px 0', textAlign: 'center' })}>AWAITING CANDLE DATA<br/>تأكد من تشغيل الـ Agent</div>
          ) : (() => {
            const last = candles.slice(-40); // آخر 40 شمعة — مناسب للعرض
            const W = 400, H = 220, padL = 4, padR = 50, padT = 6, padB = 6;
            const gap = 1;
            const cw = (W - padL - padR) / last.length;
            const bodyW = Math.max(1.5, cw - gap);
            const allH = last.flatMap(c => [c.h, c.l]);
            const lo = Math.min(...allH), hi = Math.max(...allH);
            const range = Math.max(hi - lo, 0.1);
            const Y = v => padT + ((hi - v) / range) * (H - padT - padB);
            const Cx = i => padL + i * cw + (cw - bodyW) / 2; // center x of body
            const entryPrices = positions.map(p => ({ price: p.price_open, type: p.type }));
            // 4 price labels on right
            const priceLabels = [0, 0.33, 0.66, 1].map(f => lo + f * range);
            return (
              <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
                {/* grid */}
                {priceLabels.map((price, i) => {
                  const y = Y(price);
                  return (
                    <g key={i}>
                      <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={C.border} strokeWidth="0.5" strokeDasharray="3 3" />
                      <text x={W - padR + 4} y={y + 3} fontSize="9" fill={C.dim} fontFamily={C.mono}>{price.toFixed(2)}</text>
                    </g>
                  );
                })}
                {/* candles */}
                {last.map((c, i) => {
                  const bull = c.c >= c.o;
                  const col = bull ? C.green : C.red;
                  const midX = Cx(i) + bodyW / 2;
                  const bodyTop = Y(Math.max(c.o, c.c));
                  const bodyBot = Y(Math.min(c.o, c.c));
                  const bodyH = Math.max(1, bodyBot - bodyTop);
                  return (
                    <g key={c.t ?? i}>
                      <line x1={midX} y1={Y(c.h)} x2={midX} y2={bodyTop} stroke={col} strokeWidth="1" />
                      <rect x={Cx(i)} y={bodyTop} width={bodyW} height={bodyH} fill={bull ? C.green : C.red} stroke={col} strokeWidth="0.3" />
                      <line x1={midX} y1={bodyBot} x2={midX} y2={Y(c.l)} stroke={col} strokeWidth="1" />
                    </g>
                  );
                })}
                {/* open position entry lines */}
                {entryPrices.map((ep, i) => {
                  const y = Y(ep.price);
                  if (y < padT || y > H - padB) return null;
                  return (
                    <g key={i}>
                      <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={C.amber} strokeWidth="1.2" strokeDasharray="5 3" />
                      <text x={W - padR + 4} y={y + 3} fontSize="9" fill={C.amber} fontFamily={C.mono} fontWeight="bold">{ep.price?.toFixed(2)}</text>
                    </g>
                  );
                })}
                {/* last price label */}
                {(() => {
                  const lc = last[last.length - 1];
                  const y = Y(lc.c);
                  const bull = lc.c >= lc.o;
                  return (
                    <g>
                      <rect x={W - padR} y={y - 7} width={padR} height={14} fill={bull ? C.green : C.red} />
                      <text x={W - padR + 3} y={y + 4} fontSize="9" fill="#fff" fontFamily={C.mono} fontWeight="bold">{lc.c?.toFixed(2)}</text>
                    </g>
                  );
                })()}
              </svg>
            );
          })()}
        </div>

        {/* --- 24H PNL CHART (span 2) --- */}
        <div className="gsx-span2" style={card({ background: C.panelLight })}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div style={label()}>24H PNL · LIVE</div>
            <div style={label()}>PEAK <span style={{ color: C.green, fontWeight: 700 }}>{fmtMoney(peak24, true)}</span></div>
          </div>
          <div style={{ fontSize: 26, fontWeight: 900, color: cum >= 0 ? C.green : C.red, margin: '4px 0 8px 0' }}>
            {fmtMoney(cum, true)}
          </div>
          <svg width="100%" height="150" viewBox="0 0 400 150" preserveAspectRatio="none" style={{ display: 'block' }}>
            {(() => {
              if (cumPts.length < 2) return (
                <text x="200" y="80" textAnchor="middle" fontSize="11" fill={C.dim} fontFamily={C.mono} letterSpacing="2">AWAITING 24H DATA</text>
              );
              const lo = Math.min(0, ...cumPts), hi = Math.max(0, ...cumPts);
              const range = Math.max(0.01, hi - lo);
              const X = i => (i / (cumPts.length - 1)) * 400;
              const Y = v => 140 - ((v - lo) / range) * 130;
              const line = cumPts.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
              const zeroY = Y(0);
              const pos = cum >= 0;
              return (
                <g>
                  <line x1="0" y1={zeroY} x2="400" y2={zeroY} stroke={C.border} strokeWidth="1" strokeDasharray="4 4" />
                  <path d={`${line} L400,${zeroY.toFixed(1)} L0,${zeroY.toFixed(1)} Z`}
                    fill={pos ? C.greenBright : C.amber} fillOpacity="0.25" />
                  <path d={line} fill="none" stroke={pos ? C.green : C.red} strokeWidth="2" />
                  <circle cx="398" cy={Y(cumPts[cumPts.length - 1])} r="3" fill={pos ? C.green : C.red} />
                </g>
              );
            })()}
          </svg>
        </div>

        {/* --- LIVE POSITIONS (span 3) --- */}
        <div className="gsx-span3" style={card({ background: C.panelLight })}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 2 }}>
              <Dot color={positions.length ? C.greenBright : C.dim} />LIVE&nbsp;&nbsp;OPEN POSITIONS
            </span>
            <span style={label()}>
              · {positions.length} open · avg {fmtMoney(openAvg, true)} · total {fmtMoney(openTotal, true)}
            </span>
          </div>
          {positions.length === 0 ? (
            <div style={label({ padding: '10px 0', fontSize: 11 })}>NO OPEN POSITIONS · BOT MONITORING MARKET</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <div style={{ display: 'flex', minWidth: 480, ...label({ paddingBottom: 6, borderBottom: `1px solid ${C.border}` }) }}>
                <span style={{ flex: 2 }}>#TICKET</span><span style={{ flex: 1 }}>TYPE</span>
                <span style={{ flex: 1 }}>VOL</span><span style={{ flex: 2 }}>ENTRY</span>
                <span style={{ flex: 2 }}>PROFIT</span><span style={{ flex: 1 }}>AGE</span>
              </div>
              {positions.map((p, i) => {
                const buy = p.type === 'BUY';
                return (
                  <div key={p.ticket ?? i} style={{
                    display: 'flex', minWidth: 480, fontSize: 12, padding: '6px 0 6px 8px',
                    borderBottom: `1px solid ${C.border}`,
                    borderLeft: `3px solid ${buy ? C.green : C.red}`,
                    alignItems: 'center',
                  }}>
                    <span style={{ flex: 2, color: C.sub }}>#{p.ticket}</span>
                    <span style={{ flex: 1, fontWeight: 900, color: buy ? C.green : C.red }}>{p.type}</span>
                    <span style={{ flex: 1 }}>{p.volume}</span>
                    <span style={{ flex: 2 }}>{p.price_open}</span>
                    <span style={{ flex: 2, fontWeight: 900, color: (p.profit || 0) >= 0 ? C.green : C.red }}>{fmtMoney(p.profit, true)}</span>
                    <span style={{ flex: 1, color: C.dim }}>{ageStr(p.time)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* --- PIPELINE (span 3 container, nested grid of 6) --- */}
        <div className="gsx-span3" style={{ background: C.border, minWidth: 0 }}>
          <div className="gsx-pipegrid">
            {pipeline.map(step => (
              <div key={step.n} style={card({ padding: 14 })}>
                <div style={label({ fontSize: 9 })}>{step.n}</div>
                <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1, margin: '3px 0' }}>{step.t}</div>
                <div style={label({ fontSize: 9, textTransform: 'none' })}>{step.s}</div>
                <div style={{ fontSize: 10, letterSpacing: 1, marginTop: 6, fontWeight: 700, color: step.ok ? C.green : C.dim }}>
                  <Dot color={step.ok ? C.greenBright : C.dim} size={6} />
                  {step.active ? 'ACTIVE' : step.ok ? 'READY' : 'IDLE'}
                </div>
              </div>
            ))}
            {/* 06 CLOSE — highlighted with last-trade accent */}
            <div style={card({
              padding: 14, background: C.panelLight,
              borderLeft: `3px solid ${lastProfit === null ? C.border : lastProfit >= 0 ? C.greenBright : C.amber}`,
            })}>
              <div style={label({ fontSize: 9 })}>06</div>
              <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1, margin: '3px 0' }}>CLOSE</div>
              <div style={label({ fontSize: 9, textTransform: 'none' })}>profit/loss settle</div>
              <div style={{
                fontSize: 13, marginTop: 6, fontWeight: 900,
                color: lastProfit === null ? C.dim : lastProfit >= 0 ? C.green : C.red,
              }}>
                LAST: {lastProfit === null ? '--' : fmtMoney(lastProfit, true)}
              </div>
            </div>
          </div>
        </div>

        {/* --- WINS (span 1) --- */}
        <div style={card({ background: C.panelLight })}>
          <div style={label()}>WINS · TODAY / ALL TIME</div>
          <div style={{ fontSize: 42, fontWeight: 900, color: C.green, letterSpacing: -1, margin: '6px 0 2px 0' }}>
            {todayWins}<span style={{ fontSize: 16, color: C.dim, fontWeight: 400 }}> / {stats.wins}</span>
          </div>
          <div style={{ fontSize: 12, color: C.sub }}>
            {todayLosses} losses today · <span style={{ color: todayNet >= 0 ? C.green : C.red, fontWeight: 700 }}>{fmtMoney(todayNet, true)} net</span>
          </div>
        </div>

        {/* --- BOT CONTROL (span 1) --- */}
        <div style={card({ textAlign: 'center' })}>
          <div style={label()}>BOT STATUS</div>
          <div style={{
            fontSize: 36, fontWeight: 900, letterSpacing: 1, margin: '4px 0',
            color: botRunning ? C.green : C.red,
          }}>
            {botRunning ? 'UP ▲' : 'DOWN ▼'}
          </div>
          <div style={label({ marginBottom: 10 })}>
            LOT {settings.LotSize ?? '--'} · TP ${settings.TP_USD ?? '--'} · SL ${settings.SL_USD ?? '--'}
          </div>
          <button
            onClick={() => botControl(botRunning ? 'stop' : 'start')}
            disabled={busy}
            style={{
              fontFamily: C.mono, fontSize: 13, fontWeight: 900, letterSpacing: 3,
              padding: '8px 26px', cursor: busy ? 'wait' : 'pointer',
              background: botRunning ? C.red : C.green, color: C.panelLight,
              border: 'none',
            }}
          >{botRunning ? 'STOP' : 'START'}</button>
        </div>

        {/* --- VELOCITY (span 1) --- */}
        <div style={card({ background: C.panelLight })}>
          <div style={label()}>VELOCITY · 1H</div>
          <div style={{ fontSize: 42, fontWeight: 900, letterSpacing: -1, margin: '6px 0 2px 0' }}>
            {tradesLastHour}<span style={{ fontSize: 16, color: C.dim, fontWeight: 400 }}> trades/hr</span>
          </div>
          <div style={{ fontSize: 12, color: C.sub }}>
            pace {(tradesLastHour * 24).toLocaleString()}/day · lifetime {tradesPerDay.toFixed(1)}/day
          </div>
        </div>

        {/* --- SETTINGS (span 3, collapsible) --- */}
        <div className="gsx-span3" style={card()}>
          <div
            onClick={() => setShowSettings(s => !s)}
            style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, letterSpacing: 2, userSelect: 'none' }}
          >
            ⚙ SETTINGS {showSettings ? '▾' : '▸'}
            <span style={label({ marginLeft: 10, color: saveMsg === 'ERROR' ? C.red : C.green })}>{saveMsg}</span>
          </div>
          {showSettings && settingsDraft && (
            <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {settingKeys.map(k => (
                <div key={k}>
                  <div style={label({ fontSize: 9, marginBottom: 4 })}>{k}</div>
                  <input
                    type="number" step="any"
                    value={settingsDraft[k] ?? ''}
                    onChange={e => setSettingsDraft(d => ({ ...d, [k]: e.target.value === '' ? '' : Number(e.target.value) }))}
                    style={{
                      fontFamily: C.mono, fontSize: 13, width: 90, padding: '6px 8px',
                      background: C.panelLight, border: `1px solid ${C.border}`, color: C.text,
                    }}
                  />
                </div>
              ))}
              <button
                onClick={saveSettings}
                disabled={busy}
                style={{
                  fontFamily: C.mono, fontSize: 12, fontWeight: 900, letterSpacing: 2,
                  padding: '8px 20px', background: C.text, color: C.bg, border: 'none',
                  cursor: busy ? 'wait' : 'pointer',
                }}
              >SAVE ALL</button>
            </div>
          )}
          {showSettings && !settingsDraft && <div style={label({ marginTop: 10 })}>LOADING SETTINGS...</div>}
        </div>
      </div>

      {/* ============ FIXED TICKER BAR (outside grid) ============ */}
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 500,
        background: C.dark, color: C.cream, fontFamily: C.mono,
        fontSize: 11, letterSpacing: 2, padding: '8px 16px',
        whiteSpace: 'nowrap', overflow: 'hidden', textTransform: 'uppercase',
      }}>
        BALANCE {account ? '$' + Number(account.balance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '--'}
        {' · '}EQUITY {account ? '$' + Number(account.equity ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '--'}
        {' · '}MARGIN {account ? '$' + Number(account.margin ?? 0).toFixed(2) : '--'}
        {' · '}FREE {account ? '$' + Number(account.margin_free ?? account.free_margin ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '--'}
        {' · '}SPREAD MAX {settings.MaxSpread ?? '--'}
        {' · '}TP ${settings.TP_USD ?? '--'} · SL ${settings.SL_USD ?? '--'}
        {' · '}MAX POS {settings.MaxPositions ?? '--'}
        {' · '}<span style={{ color: isOnline ? C.greenBright : C.amber }}>{isOnline ? '● FEED LIVE' : '○ FEED STALE'}</span>
      </div>

      {/* ============ PROFIT POPUP ============ */}
      {popup && (
        <div style={{
          position: 'fixed', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          background: 'rgba(26,26,24,0.45)', zIndex: 1000,
        }}>
          <div style={{
            background: C.dark,
            border: `3px solid ${popup.profit >= 0 ? C.greenBright : C.amber}`,
            padding: '36px 70px', textAlign: 'center',
            animation: 'popIn 0.25s ease-out',
            fontFamily: C.mono,
          }}>
            <div style={{
              fontSize: 64, fontWeight: 900, letterSpacing: -2,
              color: popup.profit >= 0 ? C.greenBright : C.amber,
            }}>
              {fmtMoney(popup.profit, true)}
            </div>
            <div style={{
              fontSize: 13, letterSpacing: 6, marginTop: 8, fontWeight: 700,
              color: popup.profit >= 0 ? C.greenBright : C.amber,
            }}>
              {popup.profit >= 0 ? 'PROFIT' : 'LOSS'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
