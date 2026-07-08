// GRX Dashboard v3.48 — HUD Design
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || '';
const API_KEY = import.meta.env.VITE_API_KEY || 'mysecretkey123';
const DASH_VERSION = 'v3.48';

const RED = '#FF0033';
const CRIMSON = '#8B0000';
const GREEN = '#00FF41';
const AMBER = '#FF9900';
const MONO = "'Courier New', monospace";

const GLOBAL_CSS = `
  * { box-sizing: border-box; }
  html, body, #root { margin: 0; padding: 0; background: #000; }
  @keyframes grxPulse {
    0%, 100% { box-shadow: 0 0 4px rgba(255,0,51,0.35), inset 0 0 4px rgba(255,0,51,0.12); }
    50% { box-shadow: 0 0 14px rgba(255,0,51,0.75), inset 0 0 8px rgba(255,0,51,0.22); }
  }
  @keyframes grxPulseGreen {
    0%, 100% { box-shadow: 0 0 6px rgba(0,255,65,0.4); }
    50% { box-shadow: 0 0 18px rgba(0,255,65,0.9); }
  }
  @keyframes grxBlink {
    0%, 49% { opacity: 1; }
    50%, 100% { opacity: 0.15; }
  }
  @keyframes grxTicker {
    0% { transform: translateX(0); }
    100% { transform: translateX(-50%); }
  }
  @keyframes grxDraw {
    from { stroke-dashoffset: 1200; }
    to { stroke-dashoffset: 0; }
  }
  @keyframes grxDotPulse {
    0%, 100% { r: 3; opacity: 1; }
    50% { r: 6; opacity: 0.5; }
  }
  @keyframes grxFlash {
    0% { background-color: rgba(255,255,255,0.18); }
    100% { background-color: transparent; }
  }
  @keyframes grxStepPulse {
    0%, 100% { text-shadow: 0 0 4px rgba(0,255,65,0.6); }
    50% { text-shadow: 0 0 12px rgba(0,255,65,1); }
  }
  .grx-card { animation: grxPulse 3.2s ease-in-out infinite; }
  .grx-scanlines::after {
    content: '';
    position: fixed; inset: 0; z-index: 9999; pointer-events: none;
    background: repeating-linear-gradient(0deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2px, rgba(255,0,51,0.03) 3px, rgba(0,0,0,0.12) 4px);
  }
  .grx-blink { animation: grxBlink 1s step-end infinite; }
  .grx-ticker-inner { display: inline-flex; white-space: nowrap; animation: grxTicker 30s linear infinite; }
  .grx-equity-path { stroke-dasharray: 1200; animation: grxDraw 2.4s ease-out forwards; }
  .grx-endpoint { animation: grxDotPulse 1.4s ease-in-out infinite; }
  .grx-flash td { animation: grxFlash 0.7s ease-out; }
  .grx-step-active { animation: grxStepPulse 1.6s ease-in-out infinite; }
  .grx-save:hover { box-shadow: 0 0 16px rgba(255,0,51,0.9); }
  .grx-input:focus { outline: none; box-shadow: 0 0 8px rgba(255,0,51,0.7); }
  @media (max-width: 900px) { .grx-grid { grid-template-columns: 1fr !important; } }
`;

function fmt(n, d = 2) {
  if (n === null || n === undefined || isNaN(n)) return '--';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

// ── Animated counter hook ─────────────────────────────────────────
function useCountUp(target, duration = 800) {
  const [value, setValue] = useState(0);
  const prevRef = useRef(0);
  useEffect(() => {
    const t = Number(target) || 0;
    const from = prevRef.current;
    prevRef.current = t;
    if (from === t) { setValue(t); return; }
    let raf; const start = performance.now();
    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(from + (t - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

// ── UI atoms ──────────────────────────────────────────────────────
const cardStyle = {
  border: `1px solid ${RED}`,
  background: 'rgba(10,0,3,0.85)',
  padding: '14px 16px',
  fontFamily: MONO,
  position: 'relative',
};

function CardLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, letterSpacing: 2, color: RED, textTransform: 'uppercase',
      marginBottom: 8, textShadow: `0 0 6px ${RED}`,
    }}>{children}</div>
  );
}

function StatCard({ label, value, color }) {
  const v = useCountUp(value);
  return (
    <div className="grx-card" style={cardStyle}>
      <CardLabel>{label}</CardLabel>
      <div style={{ fontSize: 26, fontWeight: 'bold', color, textShadow: `0 0 10px ${color}` }}>
        {fmt(v)}
      </div>
    </div>
  );
}

// ── Space Invaders ────────────────────────────────────────────────
function SpaceInvaders() {
  const canvasRef = useRef(null);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;

    const state = {
      player: { x: W / 2 - 15, y: H - 22, w: 30, h: 12, speed: 4 },
      bullets: [],
      enemyBullets: [],
      enemies: [],
      dir: 1,
      enemySpeed: 0.5,
      keys: {},
      over: false,
      lastShot: 0,
      score: 0,
    };

    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 8; c++)
        state.enemies.push({ x: 30 + c * 42, y: 20 + r * 28, w: 24, h: 14, alive: true });

    const onKeyDown = (e) => {
      if (['ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      state.keys[e.key] = true;
    };
    const onKeyUp = (e) => { state.keys[e.key] = false; };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    let raf;
    const loop = (now) => {
      if (state.over) return;
      // player
      if (state.keys['ArrowLeft']) state.player.x = Math.max(0, state.player.x - state.player.speed);
      if (state.keys['ArrowRight']) state.player.x = Math.min(W - state.player.w, state.player.x + state.player.speed);
      if (state.keys[' '] && now - state.lastShot > 300) {
        state.bullets.push({ x: state.player.x + state.player.w / 2 - 1, y: state.player.y, w: 2, h: 8 });
        state.lastShot = now;
      }
      // bullets
      state.bullets.forEach(b => { b.y -= 6; });
      state.bullets = state.bullets.filter(b => b.y > -10);
      state.enemyBullets.forEach(b => { b.y += 3; });
      state.enemyBullets = state.enemyBullets.filter(b => b.y < H + 10);

      // enemies move
      const alive = state.enemies.filter(e => e.alive);
      let hitEdge = false;
      alive.forEach(e => {
        e.x += state.dir * state.enemySpeed;
        if (e.x < 4 || e.x + e.w > W - 4) hitEdge = true;
      });
      if (hitEdge) {
        state.dir *= -1;
        alive.forEach(e => { e.y += 10; });
        state.enemySpeed = Math.min(state.enemySpeed + 0.08, 2.5);
      }
      // enemy fire
      if (alive.length && Math.random() < 0.015) {
        const sh = alive[Math.floor(Math.random() * alive.length)];
        state.enemyBullets.push({ x: sh.x + sh.w / 2, y: sh.y + sh.h, w: 2, h: 8 });
      }
      // collisions: player bullets vs enemies
      state.bullets.forEach(b => {
        alive.forEach(e => {
          if (e.alive && b.x < e.x + e.w && b.x + b.w > e.x && b.y < e.y + e.h && b.y + b.h > e.y) {
            e.alive = false; b.y = -100;
            state.score += 10;
            setScore(state.score);
          }
        });
      });
      // enemy bullets vs player, enemies reach bottom
      const p = state.player;
      const dead = state.enemyBullets.some(b =>
        b.x < p.x + p.w && b.x + b.w > p.x && b.y < p.y + p.h && b.y + b.h > p.y
      ) || alive.some(e => e.y + e.h >= p.y);
      const won = state.enemies.every(e => !e.alive);
      if (dead || won) {
        state.over = true;
        setGameOver(true);
        if (won && !dead) { state.score += 100; setScore(state.score); }
      }

      // draw
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      // grid
      ctx.strokeStyle = 'rgba(139,0,0,0.15)';
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      // player
      ctx.fillStyle = GREEN;
      ctx.shadowColor = GREEN; ctx.shadowBlur = 8;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillRect(p.x + p.w / 2 - 3, p.y - 6, 6, 6);
      // enemies
      ctx.fillStyle = RED; ctx.shadowColor = RED;
      state.enemies.forEach(e => {
        if (!e.alive) return;
        ctx.fillRect(e.x, e.y, e.w, e.h);
        ctx.clearRect(e.x + 6, e.y + 4, 4, 4);
        ctx.clearRect(e.x + e.w - 10, e.y + 4, 4, 4);
      });
      // bullets
      ctx.fillStyle = GREEN; ctx.shadowColor = GREEN;
      state.bullets.forEach(b => ctx.fillRect(b.x, b.y, b.w, b.h));
      ctx.fillStyle = RED; ctx.shadowColor = RED;
      state.enemyBullets.forEach(b => ctx.fillRect(b.x, b.y, b.w, b.h));
      ctx.shadowBlur = 0;

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      state.over = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [runId]);

  const restart = () => { setScore(0); setGameOver(false); setRunId(id => id + 1); };

  return (
    <div className="grx-card" style={cardStyle}>
      <CardLabel>◆ KILL_ZONE // WHILE YOU WAIT</CardLabel>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
        <span style={{ color: GREEN }}>SCORE: {score}</span>
        <span style={{ color: AMBER }}>← → MOVE // SPACE FIRE</span>
      </div>
      <div style={{ position: 'relative', width: '100%', maxWidth: 400, margin: '0 auto' }}>
        <canvas
          ref={canvasRef}
          width={400}
          height={300}
          tabIndex={0}
          style={{ width: '100%', display: 'block', border: `1px solid ${CRIMSON}`, background: '#000' }}
        />
        {gameOver && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.8)',
            fontFamily: MONO,
          }}>
            <div style={{ color: RED, fontSize: 22, textShadow: `0 0 10px ${RED}`, marginBottom: 12 }}>
              ◆ GAME OVER ◆
            </div>
            <div style={{ color: GREEN, fontSize: 14, marginBottom: 16 }}>FINAL SCORE: {score}</div>
            <button onClick={restart} style={{
              fontFamily: MONO, background: '#000', color: RED, border: `1px solid ${RED}`,
              padding: '8px 24px', fontSize: 13, cursor: 'pointer', letterSpacing: 2,
              textShadow: `0 0 6px ${RED}`,
            }}>RESTART</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Equity curve ──────────────────────────────────────────────────
function EquityCurve({ points }) {
  const W = 600, H = 180, PAD = 10;
  const pts = points && points.length > 1 ? points : [0, 0];
  const min = Math.min(...pts), max = Math.max(...pts);
  const range = max - min || 1;
  const coords = pts.map((v, i) => [
    PAD + (i / (pts.length - 1)) * (W - 2 * PAD),
    H - PAD - ((v - min) / range) * (H - 2 * PAD),
  ]);
  const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ');
  const areaPath = `${path} L${coords[coords.length - 1][0].toFixed(1)},${H - PAD} L${coords[0][0].toFixed(1)},${H - PAD} Z`;
  const last = coords[coords.length - 1];
  const up = pts[pts.length - 1] >= pts[0];
  const lineColor = up ? GREEN : RED;

  return (
    <div className="grx-card" style={cardStyle}>
      <CardLabel>◆ EQUITY CURVE // TODAY</CardLabel>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <defs>
          <linearGradient id="grxFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.35" />
            <stop offset="100%" stopColor={RED} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#grxFill)" />
        <path className="grx-equity-path" d={path} fill="none" stroke={lineColor} strokeWidth="2"
          style={{ filter: `drop-shadow(0 0 4px ${lineColor})` }} />
        <circle className="grx-endpoint" cx={last[0]} cy={last[1]} r="3" fill={lineColor} />
      </svg>
      {(!points || points.length < 2) && (
        <div style={{ color: AMBER, fontSize: 11, textAlign: 'center', marginTop: 4 }}>
          AWAITING EQUITY DATA...
        </div>
      )}
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────
export default function Dashboard() {
  const [data, setData] = useState(null);
  const [connected, setConnected] = useState(false);
  const [botRunning, setBotRunning] = useState(false);
  const [grxSettings, setGrxSettings] = useState({});
  const [grxSettingsDraft, setGrxSettingsDraft] = useState({});
  const [grxDirty, setGrxDirty] = useState(false);
  const [grxBusy, setGrxBusy] = useState(false);
  const [clock, setClock] = useState('');
  const [equityHistory, setEquityHistory] = useState([]);
  const [flashKey, setFlashKey] = useState(0);
  const lastProfitRef = useRef(null);

  useEffect(() => {
    const socket = io(API_URL, { transports: ['websocket', 'polling'] });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('update', d => {
      setData(d);
      if (d && d.equity !== undefined) {
        setEquityHistory(h => [...h.slice(-199), Number(d.equity)]);
      }
      const totalPl = ((d && d.positions) || []).reduce((s, p) => s + (Number(p.profit) || 0), 0);
      if (lastProfitRef.current !== null && lastProfitRef.current !== totalPl) {
        setFlashKey(k => k + 1);
      }
      lastProfitRef.current = totalPl;
    });
    socket.on('grx_settings', s => { setGrxSettings(s); setGrxSettingsDraft(s); });
    socket.on('bot_status', b => setBotRunning(b.running));
    return () => socket.disconnect();
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setClock(new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC');
    }, 1000);
    return () => clearInterval(t);
  }, []);

  async function saveGrxSettings() {
    setGrxBusy(true);
    await fetch(`${API_URL}/api/settings/grx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
      body: JSON.stringify(grxSettingsDraft),
    });
    setGrxBusy(false);
    setGrxDirty(false);
  }

  async function botControl(action) {
    setGrxBusy(true);
    await fetch(`${API_URL}/api/bot/${action}`, {
      method: 'POST', headers: { 'X-API-Key': API_KEY },
    });
    setGrxBusy(false);
  }

  const updateDraft = useCallback((k, v) => {
    setGrxSettingsDraft(d => ({ ...d, [k]: v }));
    setGrxDirty(true);
  }, []);

  const acct = data || {};
  const positions = acct.positions || [];
  const history = (acct.history || []).slice(0, 20);
  const profitToday = Number(acct.profit_today ?? acct.profit ?? 0);
  const spread = acct.spread ?? '--';
  const lastTrade = acct.lastTrade || acct.last_trade || null;

  const pipelineSteps = ['HFT GRID', 'RSI FILTER', 'SPREAD CHECK', 'ENTRY', 'MONITOR', 'CLOSE'];
  const activeSteps = botRunning ? (positions.length > 0 ? 5 : 3) : 0;

  const settingsFields = ['BaseLot', 'TradeTP', 'TradeSL', 'MaxSpread', 'CooldownBars', 'MaxTrades'];

  const tickerText = [
    `BOT: ${botRunning ? 'ONLINE' : 'OFFLINE'}`,
    `EQUITY: ${fmt(acct.equity)}`,
    `BALANCE: ${fmt(acct.balance)}`,
    `P&L TODAY: ${fmt(profitToday)}`,
    `SPREAD: ${spread}`,
    `LOT: ${grxSettings.BaseLot ?? '--'}`,
    `TP: ${grxSettings.TradeTP ?? '--'}`,
    `SL: ${grxSettings.TradeSL ?? '--'}`,
    lastTrade ? `LAST TRADE: ${lastTrade.type || ''} ${fmt(lastTrade.profit)}` : 'NO TRADES YET',
    `XAUUSD // GOLD`,
    `GRX ${DASH_VERSION}`,
  ].join('  ◆  ') + '  ◆  ';

  const thStyle = {
    fontSize: 10, letterSpacing: 1, color: RED, textAlign: 'left',
    padding: '6px 8px', borderBottom: `1px solid ${CRIMSON}`,
  };
  const tdStyle = { fontSize: 12, padding: '6px 8px', borderBottom: `1px solid rgba(139,0,0,0.3)` };

  return (
    <div className="grx-scanlines" style={{
      minHeight: '100vh', background: '#000', color: '#ccc', fontFamily: MONO,
      backgroundImage: `linear-gradient(rgba(139,0,0,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(139,0,0,0.07) 1px, transparent 1px)`,
      backgroundSize: '40px 40px',
      paddingBottom: 50,
    }}>
      <style>{GLOBAL_CSS}</style>

      {/* 1. Header */}
      <div className="grx-card" style={{
        ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 10, margin: 0, borderLeft: 'none', borderRight: 'none', borderTop: 'none',
      }}>
        <div style={{ color: RED, fontSize: 16, fontWeight: 'bold', letterSpacing: 2, textShadow: `0 0 10px ${RED}` }}>
          ◆ GRX // GOLD SCALPER v3.00
        </div>
        <div style={{ color: AMBER, fontSize: 13, textShadow: `0 0 6px ${AMBER}` }}>{clock}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span className="grx-blink" style={{
            width: 10, height: 10, borderRadius: '50%',
            background: connected ? GREEN : RED,
            boxShadow: `0 0 8px ${connected ? GREEN : RED}`,
            display: 'inline-block',
          }} />
          <span style={{ color: connected ? GREEN : RED }}>{connected ? 'LINK OK' : 'NO LINK'}</span>
          <span style={{ color: CRIMSON }}>|</span>
          <span style={{ color: RED }}>{DASH_VERSION}</span>
        </div>
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* 2. Stats row */}
        <div className="grx-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          <StatCard label="BALANCE" value={acct.balance} color={GREEN} />
          <StatCard label="EQUITY" value={acct.equity}
            color={Number(acct.equity) >= Number(acct.balance) ? GREEN : RED} />
          <StatCard label="PROFIT // TODAY" value={profitToday}
            color={profitToday > 0 ? GREEN : profitToday < 0 ? RED : AMBER} />
          <StatCard label="MARGIN FREE" value={acct.margin_free ?? acct.free_margin} color={AMBER} />
        </div>

        {/* 3 + 4: Bot control + settings */}
        <div className="grx-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
          <div className="grx-card" style={cardStyle}>
            <CardLabel>◆ BOT CONTROL</CardLabel>
            <button
              disabled={grxBusy}
              onClick={() => botControl(botRunning ? 'stop' : 'start')}
              style={{
                width: '100%', padding: '18px 0', fontFamily: MONO, fontSize: 20, fontWeight: 'bold',
                letterSpacing: 4, cursor: grxBusy ? 'wait' : 'pointer', background: '#000',
                color: botRunning ? GREEN : 'rgba(255,0,51,0.5)',
                border: `2px solid ${botRunning ? GREEN : CRIMSON}`,
                textShadow: botRunning ? `0 0 12px ${GREEN}` : 'none',
                animation: botRunning ? 'grxPulseGreen 1.8s ease-in-out infinite' : 'none',
              }}>
              {botRunning ? '● BOT ON' : '○ BOT OFF'}
            </button>
            <div style={{ marginTop: 14, fontSize: 13, color: AMBER }}>SYMBOL: <span style={{ color: '#fff' }}>XAUUSD // GOLD</span></div>
            <div style={{ marginTop: 6, fontSize: 13, color: AMBER }}>SPREAD: <span style={{ color: Number(spread) > Number(grxSettings.MaxSpread || 999) ? RED : GREEN }}>{spread}</span></div>
          </div>

          <div className="grx-card" style={cardStyle}>
            <CardLabel>◆ GRX SETTINGS</CardLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
              {settingsFields.map(f => (
                <div key={f}>
                  <div style={{ fontSize: 10, color: RED, letterSpacing: 1, marginBottom: 3 }}>
                    {f.toUpperCase()} <span style={{ color: AMBER }}>[{grxSettings[f] ?? '--'}]</span>
                  </div>
                  <input
                    className="grx-input"
                    value={grxSettingsDraft[f] ?? ''}
                    onChange={e => updateDraft(f, e.target.value)}
                    style={{
                      width: '100%', background: '#0a0003', border: `1px solid ${RED}`,
                      color: GREEN, fontFamily: MONO, fontSize: 13, padding: '6px 8px',
                    }}
                  />
                </div>
              ))}
            </div>
            <button
              className="grx-save"
              disabled={grxBusy || !grxDirty}
              onClick={saveGrxSettings}
              style={{
                marginTop: 12, padding: '8px 30px', fontFamily: MONO, fontSize: 13, letterSpacing: 3,
                background: '#000', color: grxDirty ? RED : 'rgba(255,0,51,0.35)',
                border: `1px solid ${grxDirty ? RED : CRIMSON}`,
                cursor: grxBusy ? 'wait' : grxDirty ? 'pointer' : 'default',
                textShadow: grxDirty ? `0 0 8px ${RED}` : 'none',
                transition: 'box-shadow 0.2s',
              }}>
              {grxBusy ? 'SAVING...' : 'SAVE'}
            </button>
          </div>
        </div>

        {/* 5. Pipeline */}
        <div className="grx-card" style={cardStyle}>
          <CardLabel>◆ EXECUTION PIPELINE</CardLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            {pipelineSteps.map((s, i) => (
              <React.Fragment key={s}>
                <div className={i < activeSteps ? 'grx-step-active' : ''} style={{
                  border: `1px solid ${i < activeSteps ? GREEN : CRIMSON}`,
                  color: i < activeSteps ? GREEN : 'rgba(255,0,51,0.4)',
                  padding: '6px 12px', fontSize: 11, letterSpacing: 1,
                }}>{s}</div>
                {i < pipelineSteps.length - 1 && (
                  <span style={{ color: i < activeSteps - 1 ? GREEN : CRIMSON }}>→</span>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* 6 + 7: positions + equity */}
        <div className="grx-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="grx-card" style={cardStyle}>
            <CardLabel>◆ OPEN POSITIONS</CardLabel>
            {positions.length === 0 ? (
              <div style={{ color: AMBER, fontSize: 12, textAlign: 'center', padding: '24px 0' }}>
                NO ACTIVE POSITIONS // WAITING FOR SIGNAL
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    {['#', 'SYMBOL', 'TYPE', 'LOT', 'OPEN', 'CURRENT', 'P&L'].map(h => <th key={h} style={thStyle}>{h}</th>)}
                  </tr></thead>
                  <tbody key={flashKey} className="grx-flash">
                    {positions.map((p, i) => {
                      const pl = Number(p.profit) || 0;
                      const buy = String(p.type).toUpperCase().includes('BUY') || p.type === 0;
                      return (
                        <tr key={p.ticket || i}>
                          <td style={tdStyle}>{p.ticket || i + 1}</td>
                          <td style={tdStyle}>{p.symbol || 'XAUUSD'}</td>
                          <td style={{ ...tdStyle, color: buy ? GREEN : RED }}>{buy ? 'BUY' : 'SELL'}</td>
                          <td style={tdStyle}>{p.volume ?? p.lot}</td>
                          <td style={tdStyle}>{fmt(p.price_open ?? p.open)}</td>
                          <td style={tdStyle}>{fmt(p.price_current ?? p.current)}</td>
                          <td style={{ ...tdStyle, color: pl >= 0 ? GREEN : RED, textShadow: `0 0 6px ${pl >= 0 ? GREEN : RED}` }}>{fmt(pl)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <EquityCurve points={equityHistory} />
        </div>

        {/* 8 + 9: history + game */}
        <div className="grx-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="grx-card" style={cardStyle}>
            <CardLabel>◆ TRADE HISTORY // LAST 20</CardLabel>
            {history.length === 0 ? (
              <div style={{ color: AMBER, fontSize: 12, textAlign: 'center', padding: '24px 0' }}>
                NO CLOSED TRADES
              </div>
            ) : (
              <div style={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    {['TIME', 'TYPE', 'LOT', 'OPEN', 'CLOSE', 'P&L'].map(h => <th key={h} style={thStyle}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {history.map((t, i) => {
                      const pl = Number(t.profit) || 0;
                      const buy = String(t.type).toUpperCase().includes('BUY') || t.type === 0;
                      return (
                        <tr key={t.ticket || i} style={{ background: pl >= 0 ? 'rgba(0,255,65,0.06)' : 'rgba(255,0,51,0.08)' }}>
                          <td style={tdStyle}>{t.time || t.close_time || '--'}</td>
                          <td style={{ ...tdStyle, color: buy ? GREEN : RED }}>{buy ? 'BUY' : 'SELL'}</td>
                          <td style={tdStyle}>{t.volume ?? t.lot}</td>
                          <td style={tdStyle}>{fmt(t.price_open ?? t.open)}</td>
                          <td style={tdStyle}>{fmt(t.price_close ?? t.close)}</td>
                          <td style={{ ...tdStyle, color: pl >= 0 ? GREEN : RED }}>{fmt(pl)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <SpaceInvaders />
        </div>
      </div>

      {/* 10. Ticker */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, background: '#000',
        borderTop: `1px solid ${RED}`, overflow: 'hidden', height: 32,
        display: 'flex', alignItems: 'center', boxShadow: `0 0 12px rgba(255,0,51,0.4)`, zIndex: 100,
      }}>
        <div className="grx-ticker-inner">
          <span style={{ color: RED, fontSize: 12, letterSpacing: 1, textShadow: `0 0 5px ${RED}`, paddingRight: 40 }}>{tickerText}</span>
          <span style={{ color: RED, fontSize: 12, letterSpacing: 1, textShadow: `0 0 5px ${RED}`, paddingRight: 40 }}>{tickerText}</span>
        </div>
      </div>
    </div>
  );
}
