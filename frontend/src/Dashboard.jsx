import React, { useState, useEffect, useRef } from 'react';

const API_URL = import.meta.env.VITE_API_URL || "";
const API_KEY = 'mysecretkey123';
const POLL_MS = 3000;

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
const panel = (extra = {}) => ({
  background: C.panel, border: `1px solid ${C.border}`, padding: 14, ...extra,
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
  const seenTickets = useRef(null);                  // Set of history tickets seen
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
  const R = 52, CIRC = 2 * Math.PI * R;

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

  return (
    <div style={{
      background: C.bg, minHeight: '100vh', fontFamily: C.mono, color: C.text,
      padding: '12px 16px 60px 16px', boxSizing: 'border-box',
    }}>
      <style>{`
        @keyframes popIn { from { transform: scale(0.7); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
        * { box-sizing: border-box; }
        .gsx-topbar { display:flex; justify-content:space-between; align-items:flex-start; }
        .gsx-hero { display:flex; gap:14px; }
        .gsx-hero-main { flex: 0 0 70%; min-width:0; }
        .gsx-hero-streak { flex:1; min-width:140px; }
        .gsx-pnl { font-size:80px; font-weight:900; letter-spacing:-3px; line-height:1.05; white-space:nowrap; }
        .gsx-row2 { display:flex; gap:14px; }
        .gsx-row2 > * { flex:1; min-width:0; }
        .gsx-row3 { display:flex; gap:14px; }
        .gsx-row3 > * { flex:1; min-width:0; }
        .gsx-pipeline { display:flex; gap:8px; }
        .gsx-pipeline > * { flex:1; min-width:0; }
        @media (max-width:900px) {
          .gsx-hero { flex-direction:column; }
          .gsx-hero-main { flex:none; width:100%; }
          .gsx-hero-streak { flex:none; width:100%; display:flex; flex-direction:row; align-items:center; gap:16px; padding:12px; }
          .gsx-pnl { font-size:clamp(36px, 10vw, 80px); }
          .gsx-row2 { flex-direction:column; }
          .gsx-row3 { flex-direction:column; }
          .gsx-pipeline { flex-wrap:wrap; }
          .gsx-pipeline > * { min-width:calc(33% - 8px); }
          .gsx-topbar { flex-wrap:wrap; gap:6px; }
        }
        @media (max-width:480px) {
          .gsx-pnl { font-size:clamp(28px, 12vw, 48px); }
          .gsx-pipeline > * { min-width:calc(50% - 8px); }
        }
      `}</style>

      {/* ============ 1. TOP BAR ============ */}
      <div className="gsx-topbar" style={{
        borderBottom: `1px solid ${C.border}`, paddingBottom: 8, marginBottom: 14,
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 2 }}>
            <Dot color={botRunning ? C.greenBright : C.amber} />
            GOLD SCALPER X · LIVE · {now.getUTCFullYear()}
          </div>
          <div style={label({ marginTop: 4 })}>
            XAUUSD · M1 SCALPER · CANDLE SIGNAL · LOT {settings.LotSize ?? '--'}
          </div>
        </div>
        <div style={{ fontSize: 12, letterSpacing: 2, color: isOnline ? C.green : C.red, fontWeight: 700, alignSelf: 'center' }}>
          <span style={isOnline ? { animation: 'blink 2s infinite' } : {}}>{isOnline ? '●' : '○'}</span>
          {' '}{isOnline ? 'ONLINE' : 'OFFLINE'}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 1 }}>{utc} UTC</div>
          <div style={label({ marginTop: 4 })}>{dateStr}</div>
        </div>
      </div>

      {/* ============ 2. HERO ============ */}
      <div className="gsx-hero" style={{ marginBottom: 14 }}>
        <div className="gsx-hero-main">
          <div style={label()}>
            TOTAL · REALIZED PNL&nbsp;&nbsp;
            <span style={{ color: C.greenBright }}>● LIVE</span>
          </div>
          <div className="gsx-pnl" style={{ color: pnlColor, margin: '6px 0 2px 0' }}>
            {bigPnl.neg ? '-$' : '$'}{bigPnl.dollars}
            <span style={{ fontSize: 34, fontWeight: 700, letterSpacing: 0, opacity: 0.7 }}>.{bigPnl.cents}</span>
          </div>
          <div style={{ fontSize: 13, color: C.sub, letterSpacing: 1 }}>
            <span style={{ color: pnlColor }}>{stats.total_profit >= 0 ? '▲' : '▼'}</span>
            {stats.total_trades.toLocaleString()} trades · {stats.win_rate}% win · {tradesPerDay.toFixed(1)}/day · avg {fmtMoney(avgPerTrade, true)}/trade
          </div>
          <div style={label({ marginTop: 6 })}>
            XAUUSD · M1 MARKETS · {now.getUTCFullYear()} · {fmtMoney(perSec, true)}/sec live
          </div>
        </div>

        {/* streak circle */}
        <div className="gsx-hero-streak" style={panel({
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', background: C.panelLight,
        })}>
          <svg width="130" height="130" viewBox="0 0 130 130">
            <circle cx="65" cy="65" r={R} fill="none" stroke={C.border} strokeWidth="7" />
            <circle
              cx="65" cy="65" r={R} fill="none"
              stroke={streak > 0 ? C.greenBright : C.dim} strokeWidth="7"
              strokeDasharray={`${CIRC * streakPct} ${CIRC}`}
              transform="rotate(-90 65 65)"
            />
            <text x="65" y="76" textAnchor="middle" fontSize="34" fontWeight="900"
              fontFamily={C.mono} fill={streak > 0 ? C.green : C.sub}>{streak}</text>
          </svg>
          <div style={label({ marginTop: 6, color: C.sub })}>WIN STREAK</div>
          <div style={label({ marginTop: 2 })}>+1 · STREAK {streak}</div>
        </div>
      </div>

      {/* ============ 3. PROGRESS SEGMENTS ============ */}
      <div style={{ marginBottom: 14 }}>
        <div style={label({ marginBottom: 5 })}>LAST {recent30.length} TRADES · OLDEST → NEWEST</div>
        <div style={{ display: 'flex', gap: 3 }}>
          {recent30.length === 0 && <div style={label()}>NO TRADE DATA YET</div>}
          {recent30.map((t, i) => (
            <div key={t.ticket ?? i} title={fmtMoney(netOf(t), true)} style={{
              flex: 1, height: 14, maxWidth: 30,
              background: netOf(t) > 0 ? C.greenBright : C.amber,
            }} />
          ))}
        </div>
      </div>

      {/* ============ 4. TWO CHART PANELS ============ */}
      <div className="gsx-row2" style={{ marginBottom: 14 }}>
        {/* LEFT: cash flow bars */}
        <div style={panel({ flex: 1, background: C.panelLight })}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div style={label()}>CASH FLOW · WIN STACK</div>
            <div style={{ fontSize: 16, fontWeight: 900, color: pnlColor }}>{fmtMoney(stats.total_profit, true)}</div>
          </div>
          <div style={label({ margin: '4px 0 10px 0' })}>
            {stats.total_trades} TRADES · {Math.ceil(spanDays)} DAYS · {stats.win_rate}% WIN RATE
          </div>
          <svg width="100%" height={Math.max(60, bars.length * 15)} style={{ display: 'block' }}>
            {bars.map((b, i) => {
              const w = (Math.abs(b.net) / maxAbs) * 40; // % of svg width per side
              const y = i * 15;
              const win = b.net > 0;
              return (
                <g key={b.ticket ?? i}>
                  <line x1="50%" y1={y} x2="50%" y2={y + 11} stroke={C.border} strokeWidth="1" />
                  <rect
                    x={win ? '50%' : `${50 - w}%`} y={y + 1} width={`${Math.max(0.4, w)}%`} height={9}
                    fill={win ? C.greenBright : C.red}
                  />
                  <text
                    x={win ? `${51.5 + w}%` : `${48.5 - w}%`} y={y + 9}
                    fontSize="9" fontFamily={C.mono}
                    fill={win ? C.green : C.red}
                    textAnchor={win ? 'start' : 'end'}
                  >{fmtMoney(b.net, true)}</text>
                </g>
              );
            })}
            {bars.length === 0 && (
              <text x="50%" y="30" textAnchor="middle" fontSize="10" fill={C.dim} fontFamily={C.mono} letterSpacing="2">NO CLOSED TRADES</text>
            )}
          </svg>
        </div>

        {/* RIGHT: 24h cumulative area */}
        <div style={panel({ flex: 1, background: C.panelLight })}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div style={label()}>24H PNL · LIVE</div>
            <div style={label()}>PEAK <span style={{ color: C.green, fontWeight: 700 }}>{fmtMoney(peak24, true)}</span></div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: cum >= 0 ? C.green : C.red, margin: '4px 0 8px 0' }}>
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
          {cumPts.length >= 2 && (
            <div style={{ textAlign: 'right', fontSize: 10, letterSpacing: 2, color: cum >= 0 ? C.green : C.red, fontWeight: 700 }}>
              {cum >= 0 ? 'PROFIT' : 'DRAWDOWN'}
            </div>
          )}
        </div>
      </div>

      {/* ============ 5. LIVE POSITIONS ============ */}
      <div style={panel({ marginBottom: 14, background: C.panelLight })}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 2 }}>
            <Dot color={positions.length ? C.greenBright : C.dim} />LIVE&nbsp;&nbsp;OPEN POSITIONS
          </span>
          <span style={label()}>
            · {positions.length} open · avg profit {fmtMoney(openAvg, true)} · total {fmtMoney(openTotal, true)}
          </span>
        </div>
        {positions.length === 0 ? (
          <div style={label({ padding: '10px 0', fontSize: 11 })}>NO OPEN POSITIONS · BOT MONITORING MARKET</div>
        ) : (
          <div>
            <div style={{ display: 'flex', ...label({ paddingBottom: 6, borderBottom: `1px solid ${C.border}` }) }}>
              <span style={{ flex: 2 }}>#TICKET</span><span style={{ flex: 1 }}>TYPE</span>
              <span style={{ flex: 1 }}>VOL</span><span style={{ flex: 2 }}>ENTRY</span>
              <span style={{ flex: 2 }}>PROFIT</span><span style={{ flex: 1 }}>AGE</span>
            </div>
            {positions.map((p, i) => {
              const buy = p.type === 'BUY';
              return (
                <div key={p.ticket ?? i} style={{
                  display: 'flex', fontSize: 12, padding: '6px 0 6px 8px',
                  borderBottom: `1px solid ${C.border}`,
                  borderLeft: `3px solid ${buy ? C.green : C.amber}`,
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

      {/* ============ 6. EXECUTION PIPELINE ============ */}
      <div className="gsx-pipeline" style={{ marginBottom: 14 }}>
        {pipeline.map(step => (
          <div key={step.n} style={panel({ flex: 1, padding: 10 })}>
            <div style={label({ fontSize: 9 })}>{step.n}</div>
            <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1, margin: '3px 0' }}>{step.t}</div>
            <div style={label({ fontSize: 9, textTransform: 'none' })}>{step.s}</div>
            <div style={{ fontSize: 10, letterSpacing: 1, marginTop: 6, fontWeight: 700, color: step.ok ? C.green : C.dim }}>
              <Dot color={step.ok ? C.greenBright : C.dim} size={6} />
              {step.active ? 'ACTIVE' : step.ok ? 'READY' : 'IDLE'}
            </div>
          </div>
        ))}
        {/* 06 CLOSE / LAST SETTLE — highlighted */}
        <div style={panel({
          flex: 1, padding: 10, background: C.panelLight,
          border: `2px solid ${lastProfit === null ? C.border : lastProfit >= 0 ? C.greenBright : C.amber}`,
        })}>
          <div style={label({ fontSize: 9 })}>06</div>
          <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1, margin: '3px 0' }}>CLOSE</div>
          <div style={label({ fontSize: 9, textTransform: 'none' })}>profit/loss settle</div>
          <div style={{
            fontSize: 14, marginTop: 6, fontWeight: 900,
            color: lastProfit === null ? C.dim : lastProfit >= 0 ? C.green : C.red,
          }}>
            LAST: {lastProfit === null ? '--' : fmtMoney(lastProfit, true)}
          </div>
        </div>
      </div>

      {/* ============ 7. BOTTOM STATS ROW ============ */}
      <div className="gsx-row3" style={{ marginBottom: 14 }}>
        {/* wins */}
        <div style={panel({ flex: 1, background: C.panelLight })}>
          <div style={label()}>WINS · TODAY / ALL TIME</div>
          <div style={{ fontSize: 42, fontWeight: 900, color: C.green, letterSpacing: -1, margin: '6px 0 2px 0' }}>
            {todayWins}<span style={{ fontSize: 16, color: C.dim, fontWeight: 400 }}> / {stats.wins}</span>
          </div>
          <div style={{ fontSize: 12, color: C.sub }}>
            {todayLosses} losses today · <span style={{ color: todayNet >= 0 ? C.green : C.red, fontWeight: 700 }}>{fmtMoney(todayNet, true)} net</span>
          </div>
        </div>

        {/* bot status */}
        <div style={panel({ flex: 1, background: C.panelLight, textAlign: 'center' })}>
          <div style={label()}>BOT STATUS</div>
          <div style={{
            fontSize: 36, fontWeight: 900, letterSpacing: 1, margin: '4px 0',
            color: botRunning ? C.green : C.red,
          }}>
            {botRunning ? 'UP ▲' : 'DOWN ▼'}
          </div>
          <div style={label({ marginBottom: 8 })}>
            LOT {settings.LotSize ?? '--'} · TP ${settings.TP_USD ?? '--'} · SL ${settings.SL_USD ?? '--'}
          </div>
          <button
            onClick={() => botControl(botRunning ? 'stop' : 'start')}
            disabled={busy}
            style={{
              fontFamily: C.mono, fontSize: 13, fontWeight: 900, letterSpacing: 3,
              padding: '8px 26px', cursor: busy ? 'wait' : 'pointer',
              background: botRunning ? C.red : C.green, color: '#fafaf8',
              border: 'none',
            }}
          >{botRunning ? 'STOP' : 'START'}</button>
        </div>

        {/* velocity */}
        <div style={panel({ flex: 1, background: C.panelLight })}>
          <div style={label()}>VELOCITY · 1H</div>
          <div style={{ fontSize: 42, fontWeight: 900, letterSpacing: -1, margin: '6px 0 2px 0' }}>
            {tradesLastHour}<span style={{ fontSize: 16, color: C.dim, fontWeight: 400 }}> trades/hr</span>
          </div>
          <div style={{ fontSize: 12, color: C.sub }}>
            pace {(tradesLastHour * 24).toLocaleString()}/day · lifetime {tradesPerDay.toFixed(1)}/day
          </div>
        </div>
      </div>

      {/* ============ SETTINGS (collapsible) ============ */}
      <div style={panel({ marginBottom: 14 })}>
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

      {/* ============ 8. TICKER BAR ============ */}
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 500,
        background: C.text, color: '#e8e4d9', fontFamily: C.mono,
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
          background: 'rgba(26,26,26,0.35)', zIndex: 1000,
        }}>
          <div style={{
            background: '#1a1a1a',
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
