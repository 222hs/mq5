import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './nexus.css';
import { useLiveData } from '../lib/useLiveData';
import CommandCore from '../CommandCore.jsx';
import InvadersGame from '../algory/InvadersGame.jsx';
import LiveChart from './LiveChart.jsx';
import AnimatedNumber from './AnimatedNumber.jsx';

const C = { green: '#00ff41', crimson: '#FF003C', cyan: '#00F0FF', yellow: '#f0b429', ink: '#dbe6ec', muted: '#5f7078' };

const container = { hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.08 } } };
const item = {
  hidden: { opacity: 0, y: 26, filter: 'blur(8px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
};

function Tile({ area, className = '', style = {}, children }) {
  return (
    <motion.section variants={item} className={`tile ${className}`} style={{ ...(area ? { gridArea: area } : {}), ...style }}>
      {children}
    </motion.section>
  );
}

function TitleBar({ title, tag, accent = C.cyan }) {
  return (
    <div className="tile-title">
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="tdot" style={{ background: accent, boxShadow: `0 0 8px ${accent}` }} />
        <span className="glx" data-text={title}>{title}</span>
      </span>
      {tag != null && <span className="ttag">{tag}</span>}
    </div>
  );
}

const netOf = (t) => (t.profit || 0) + (t.swap || 0) + (t.commission || 0);
const fmt = (v, sign = false) => {
  if (v == null || isNaN(v)) return '--';
  const n = Number(v);
  return (n < 0 ? '-' : sign && n > 0 ? '+' : '') + '$' + Math.abs(n).toFixed(2);
};
function ageStr(iso) {
  if (!iso) return '';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  return Math.floor(s / 3600) + 'h';
}
function symIcon(sym = '') {
  const s = (sym || '').toUpperCase();
  if (s.includes('XAU') || s.includes('GOLD')) return '🥇';
  if (s.includes('BTC')) return '₿';
  if (s.includes('ETH')) return 'Ξ';
  if (s.includes('XAG') || s.includes('SILVER')) return '🥈';
  if (s.includes('US100') || s.includes('NAS')) return '📈';
  if (s.includes('US500') || s.includes('SPX')) return '📊';
  return '◈';
}
const pillStyle = (on, col = C.green) => ({ color: on ? col : C.crimson, borderColor: on ? 'rgba(0,255,65,.4)' : 'rgba(255,0,60,.4)', background: on ? 'rgba(0,255,65,.06)' : 'rgba(255,0,60,.06)' });

function LogBox({ logs }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [logs]);
  const line = (e) => (typeof e === 'string' ? e : e?.msg || e?.message || e?.text || JSON.stringify(e));
  return (
    <div className="logbox" ref={ref}>
      {(logs || []).slice(-120).map((e, i) => <div key={i} className="logline">{line(e)}</div>)}
      {(!logs || logs.length === 0) && <div className="empty">AWAITING ENGINE LOG…</div>}
    </div>
  );
}

export default function Nexus() {
  const L = useLiveData();
  const { account, positions, history, stats, isOnline, botRunning, candles, sessions, lastRsi, logs, connState, botControl } = L;
  const [now, setNow] = useState(new Date());
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const balance = account?.balance ?? null;
  const equity = account?.equity ?? null;
  const todayStr = new Date().toDateString();
  const todayNet = history.filter((t) => new Date(t.time).toDateString() === todayStr).reduce((a, t) => a + netOf(t), 0);
  const tradesLastHour = history.filter((t) => new Date(t.time).getTime() > Date.now() - 3600000).length;
  const openTotal = positions.reduce((a, p) => a + (p.profit || 0), 0);
  const winRate = stats.win_rate ?? 0;
  const totalPnl = stats.total_profit ?? 0;
  const avgPerTrade = stats.total_trades ? totalPnl / stats.total_trades : 0;
  const utc = now.toISOString().slice(11, 19);
  const recent = history.slice(0, 14);

  const doControl = async (a) => { setBusy(true); await botControl(a); setTimeout(() => setBusy(false), 700); };

  return (
    <div className="nexus-root">
      <div className="nx-bg" /><div className="nx-grid" /><div className="nx-scan" /><div className="nx-vig" />

      <motion.div className="nexus-grid" variants={container} initial="hidden" animate="show">

        {/* HEADER */}
        <Tile className="tile-header">
          <div className="hdr-left">
            <span className="brand glx neon-pulse" data-text="222s">222s</span>
            <span className="brand-sub">// ALGORITHMIC COMMAND NEXUS</span>
          </div>
          <div className="hdr-mid">
            <span className="chip" style={{ color: C.yellow, borderColor: 'rgba(240,180,41,.4)' }}>XAUUSD · M1</span>
            <span className="kv"><i>BAL </i>{balance != null ? '$' + Number(balance).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '--'}</span>
            <span className="kv"><i>EQ </i><b style={{ color: C.green }}>{equity != null ? '$' + Number(equity).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '--'}</b></span>
          </div>
          <div className="hdr-right">
            <span className="pill" style={pillStyle(isOnline)}>● {isOnline ? 'LIVE' : 'OFFLINE'}</span>
            <span className="pill" style={pillStyle(connState === 'connected', C.cyan)}>WS {connState === 'connected' ? '●' : '◌'}</span>
            <div className="clock">{utc}<span>UTC</span></div>
          </div>
        </Tile>

        {/* HERO — 3D CORE */}
        <Tile className="tile-hero" style={{ padding: 0 }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <CommandCore online={isOnline} botRunning={botRunning} profit={totalPnl} equity={equity} winRate={winRate} positions={positions.length} velocity={tradesLastHour} />
          </div>
          <div className="hero-cap">
            <span className="glx" data-text="NEURAL COMMAND CORE">NEURAL COMMAND CORE</span>
            <span style={{ color: C.muted }}>DRAG TO ROTATE · LIVE TELEMETRY</span>
          </div>
        </Tile>

        {/* KPIs */}
        <Tile area="kpi1" className="kpi">
          <div className="kpi-l">Balance</div>
          <AnimatedNumber className="kpi-v" value={balance || 0} prefix="$" decimals={2} style={{ color: C.ink }} />
          <div className="kpi-s">{(stats.total_trades || 0).toLocaleString()} TRADES</div>
        </Tile>
        <Tile area="kpi2" className="kpi">
          <div className="kpi-l">Total P&amp;L</div>
          <AnimatedNumber className="kpi-v" value={totalPnl} prefix={totalPnl >= 0 ? '+$' : '-$'} absolute decimals={2} style={{ color: totalPnl >= 0 ? C.green : C.crimson, textShadow: `0 0 18px ${totalPnl >= 0 ? C.green : C.crimson}66` }} />
          <div className="kpi-s">AVG {fmt(avgPerTrade, true)}</div>
        </Tile>
        <Tile area="kpi3" className="kpi">
          <div className="kpi-l">Win Rate</div>
          <AnimatedNumber className="kpi-v" value={winRate} suffix="%" decimals={1} style={{ color: winRate >= 50 ? C.green : C.crimson }} />
          <div className="kpi-s">{stats.wins || 0}W / {stats.losses || 0}L</div>
        </Tile>
        <Tile area="kpi4" className="kpi">
          <div className="kpi-l">Today Net</div>
          <AnimatedNumber className="kpi-v" value={todayNet} prefix={todayNet >= 0 ? '+$' : '-$'} absolute decimals={2} style={{ color: todayNet >= 0 ? C.green : C.crimson }} />
          <div className="kpi-s">{tradesLastHour}/H VELOCITY</div>
        </Tile>

        {/* CONTROL */}
        <Tile className="tile-ctrl">
          <TitleBar title="ENGINE" tag="MT5" accent={botRunning ? C.green : C.crimson} />
          <button className={`big-btn ${botRunning ? 'stop' : 'start'}`} disabled={busy} onClick={() => doControl(botRunning ? 'stop' : 'start')}>
            {busy ? '…' : botRunning ? '■ HALT' : '▶ IGNITE'}
          </button>
          <div className="ctrl-rows">
            <div><span>BOT</span><b style={{ color: botRunning ? C.green : C.crimson }}>{botRunning ? 'RUNNING' : 'HALTED'}</b></div>
            <div><span>LINK</span><b style={{ color: connState === 'connected' ? C.green : C.yellow }}>{connState.toUpperCase()}</b></div>
            <div><span>RSI</span><b style={{ color: C.cyan }}>{lastRsi != null ? Number(lastRsi).toFixed(1) : '--'}</b></div>
            <div><span>OPEN P&amp;L</span><b style={{ color: openTotal >= 0 ? C.green : C.crimson }}>{fmt(openTotal, true)}</b></div>
          </div>
        </Tile>

        {/* CHART */}
        <Tile area="chart">
          <TitleBar title="XAUUSD · M1 FEED" tag="LIVE" />
          <LiveChart candles={candles} sessions={sessions} positions={positions} />
        </Tile>

        {/* POSITIONS */}
        <Tile area="pos">
          <TitleBar title="Open Positions" tag={String(positions.length)} accent={positions.length ? C.green : C.muted} />
          <div className="list">
            <AnimatePresence>
              {positions.length === 0
                ? <div className="empty" key="empty">NO OPEN POSITIONS</div>
                : positions.map((p, i) => (
                  <motion.div key={p.ticket ?? i} layout initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="prow">
                    <span>{symIcon(p.symbol)} {p.symbol || '—'}</span>
                    <span style={{ color: C.muted }}>{p.price_open ? Number(p.price_open).toFixed(2) : ''}</span>
                    <b style={{ color: (p.profit || 0) >= 0 ? C.green : C.crimson }}>{fmt(p.profit || 0, true)}</b>
                  </motion.div>
                ))}
            </AnimatePresence>
          </div>
        </Tile>

        {/* ARCADE (big, integrated) */}
        <Tile className="tile-arcade">
          <TitleBar title="Proving Grounds" tag="TACTICAL SIM" accent={C.crimson} />
          <div className="arcade-inner"><InvadersGame /></div>
        </Tile>

        {/* TRADE STREAM */}
        <Tile area="feed">
          <TitleBar title="Trade Stream" tag="RECENT" />
          <div className="list">
            <AnimatePresence>
              {recent.length === 0
                ? <div className="empty" key="empty">AWAITING TRADES</div>
                : recent.map((t, i) => {
                  const n = netOf(t);
                  return (
                    <motion.div key={t.ticket ?? i} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="prow">
                      <span>{symIcon(t.symbol)} {t.symbol || '—'}</span>
                      <span style={{ color: C.muted }}>{ageStr(t.time)}</span>
                      <b style={{ color: n >= 0 ? C.green : C.crimson }}>{fmt(n, true)}</b>
                    </motion.div>
                  );
                })}
            </AnimatePresence>
          </div>
        </Tile>

        {/* ENGINE LOG */}
        <Tile area="log">
          <TitleBar title="Engine Log" tag="/dev/tty" />
          <LogBox logs={logs} />
        </Tile>

      </motion.div>
    </div>
  );
}
