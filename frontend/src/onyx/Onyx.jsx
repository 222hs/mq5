import React, { useState, useEffect } from 'react';
import { motion, useSpring, useTransform, useMotionValue, useAnimationControls } from 'framer-motion';
import './onyx.css';
import { useLiveConnection } from '../store/useLiveConnection';
import { useTradingStore } from '../store/useTradingStore';
import MeshGradient from './MeshGradient.jsx';
import MomentumRadar from './MomentumRadar.jsx';
import CoreStage from './CoreStage.jsx';
import LedgerPulse from './LedgerPulse.jsx';
import EngineLog from './EngineLog.jsx';
import ExecutionTape from './ExecutionTape.jsx';
import KillBox from './KillBox.jsx';
import StrategyConfig from './StrategyConfig.jsx';

const AMBER = '#FFB000', EMERALD = '#00E676', CRIMSON = '#FF3D00', MUTED = 'rgba(255,255,255,.35)';
const netOf = (t) => (t.profit || 0) + (t.swap || 0) + (t.commission || 0);

/* Giant balance — ignition spring count-up from 0, dollars huge, cents small. */
function BigBalance({ value }) {
  const sv = useSpring(0, { stiffness: 55, damping: 22, mass: 1 });
  useEffect(() => { sv.set(value || 0); }, [value, sv]);
  const dollars = useTransform(sv, (v) => Math.floor(Math.abs(v)).toLocaleString('en-US'));
  const cents = useTransform(sv, (v) => (Math.abs(v) % 1).toFixed(2).slice(1));
  return (
    <div className="balance-num">
      <span className="balance-cur">$</span>
      <motion.span>{dollars}</motion.span>
      <motion.span className="balance-cents">{cents}</motion.span>
    </div>
  );
}

/* Naked stat separated by vertical hairlines — no boxes. */
function Stat({ label, value, color, sub, progress }) {
  const sv = useSpring(0, { stiffness: 70, damping: 20 });
  useEffect(() => { sv.set(value || 0); }, [value, sv]);
  const txt = useTransform(sv, (v) => (typeof value === 'string' ? value : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })));
  return (
    <div className="flex flex-col gap-2 min-w-[120px]">
      <span className="micro">{label}</span>
      <span className="stat-num" style={{ color }}><motion.span>{txt}</motion.span></span>
      {progress != null && <div style={{ width: 60, height: 2, background: 'rgba(255,255,255,.1)' }}><div style={{ width: `${Math.min(100, progress)}%`, height: '100%', background: AMBER }} /></div>}
      {sub && <span className="micro" style={{ letterSpacing: '.15em' }}>{sub}</span>}
    </div>
  );
}

function TickerStrip() {
  const balance = useTradingStore((s) => s.balance);
  const stats = useTradingStore((s) => s.stats);
  const latency = useTradingStore((s) => s.latencyMs);
  const positions = useTradingStore((s) => s.positions);
  const botRunning = useTradingStore((s) => s.botRunning);
  const items = [
    ['BALANCE', balance != null ? '$' + Number(balance).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '--'],
    ['TOTAL PNL', (stats.total_profit >= 0 ? '+$' : '-$') + Math.abs(stats.total_profit || 0).toFixed(2)],
    ['WIN', (stats.win_rate ?? 0) + '%'],
    ['PING', latency == null ? '—' : latency + 'MS'],
    ['POSITIONS', positions.length],
    ['GRX', botRunning ? 'ACTIVE' : 'HALTED'],
    ['TRADES', stats.total_trades || 0],
  ];
  const seq = [...items, ...items];
  return (
    <div className="ticker-strip">
      <div className="ticker-track">
        {seq.map(([k, v], i) => (
          <span className="ticker-item" key={i}>
            <span className="ticker-sep">▸ </span>{k} <b>{v}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function Node({ label, status }) {
  return (
    <span className="flex items-center gap-1.5" title={`${label}: ${status}`}>
      <span className={`node ${status}`} /><span className="micro">{label}</span>
    </span>
  );
}

export default function Onyx() {
  useLiveConnection();

  const balance = useTradingStore((s) => s.balance);
  const equity = useTradingStore((s) => s.equity);
  const stats = useTradingStore((s) => s.stats);
  const pnlOpen = useTradingStore((s) => s.pnlOpen);
  const positions = useTradingStore((s) => s.positions);
  const history = useTradingStore((s) => s.history);
  const isOnline = useTradingStore((s) => s.isOnline);
  const latency = useTradingStore((s) => s.latencyMs);
  const rsi = useTradingStore((s) => s.rsi);
  const pair = useTradingStore((s) => s.pair);
  const price = useTradingStore((s) => s.price);
  const connections = useTradingStore((s) => s.connections);

  const totalPnl = stats.total_profit ?? 0;
  const winRate = stats.win_rate ?? 0;
  const todayStr = new Date().toDateString();
  const todayNet = history.filter((t) => new Date(t.time).toDateString() === todayStr).reduce((a, t) => a + netOf(t), 0);

  const [drawer, setDrawer] = useState(false);
  const shake = useAnimationControls();
  const px = useMotionValue(0), py = useMotionValue(0);
  const onMove = (e) => { px.set((e.clientX / window.innerWidth - 0.5) * 10); py.set((e.clientY / window.innerHeight - 0.5) * 10); };
  const doShake = () => shake.start({ x: [0, -12, 10, -7, 4, 0], y: [0, 5, -4, 2, 0], transition: { duration: 0.5 } });

  return (
    <div className="onyx-root" onMouseMove={onMove}>
      <MeshGradient />
      <div className="grain" /><div className="vignette" />
      <div className="scanline" />
      <div className="corner tl" /><div className="corner tr" /><div className="corner bl" /><div className="corner br" />

      <motion.div animate={shake} style={{ position: 'relative', zIndex: 10 }}>
        {/* Z1 — ticker strip */}
        <TickerStrip />
        <div className="hair-h" />

        {/* Z2 — floating header (transparent, hairline only) */}
        <motion.header initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}
          className="flex items-center justify-between px-6 md:px-10" style={{ height: 64 }}>
          <div className="flex items-center gap-3">
            <span style={{ width: 7, height: 7, background: AMBER, boxShadow: `0 0 10px ${AMBER}` }} />
            <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: '.35em', color: '#f0e6cf' }}>ONYX</span>
          </div>
          <div className="flex items-center gap-6">
            <div className="hidden md:flex items-center gap-3 px-3 py-1.5" style={{ border: '1px solid rgba(255,176,0,.12)' }}>
              <Node label="MT5 AGENT" status={isOnline ? 'connected' : 'disconnected'} />
              <Node label="SOCKET" status={connections.mt5} />
              <Node label="API" status={latency != null ? 'connected' : 'connecting'} />
            </div>
            <span style={{ fontSize: 12, letterSpacing: 2, color: latency == null ? CRIMSON : latency < 20 ? EMERALD : latency > 50 ? AMBER : '#cdd3dc' }}>
              PING {latency == null ? '—' : latency + 'MS'}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: isOnline ? EMERALD : CRIMSON }}>{isOnline ? '● LIVE' : '● OFFLINE'}</span>
          </div>
        </motion.header>
        <div className="hair-h" />

        {/* Z3 — the monument (full width) */}
        <motion.div style={{ x: px, y: py }} className="relative">
          <LedgerPulse />
          <div className="relative" style={{ padding: 'clamp(28px,5vw,72px)', paddingBottom: 34, zIndex: 2 }}>
            <div className="rule" />
            <div className="eyebrow" style={{ marginBottom: 10 }}>Total Balance</div>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }}>
              <BigBalance value={balance} />
            </motion.div>
            <div style={{ fontSize: 12, letterSpacing: 2, color: MUTED, marginTop: 14 }}>
              {(stats.total_trades || 0).toLocaleString()} TRADES · EQUITY{' '}
              <b style={{ color: EMERALD }}>{equity != null ? '$' + Number(equity).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '--'}</b>
              {' · '}OPEN <b style={{ color: pnlOpen >= 0 ? EMERALD : CRIMSON }}>{pnlOpen >= 0 ? '+' : ''}${Math.abs(pnlOpen).toFixed(2)}</b>
            </div>
            <div className="flex items-end gap-6 md:gap-9 mt-8 flex-wrap">
              <Stat label="Total P&L" value={typeof totalPnl === 'number' ? Math.abs(totalPnl) : 0} color={totalPnl >= 0 ? EMERALD : CRIMSON}
                sub={`${totalPnl >= 0 ? '+' : '−'} · avg ${stats.total_trades ? (totalPnl / stats.total_trades).toFixed(2) : '--'}`} />
              <div className="hair-v" style={{ height: 42 }} />
              <Stat label="Today Net" value={Math.abs(todayNet)} color={todayNet >= 0 ? EMERALD : CRIMSON} sub={`${todayNet >= 0 ? '+' : '−'} · ${positions.length} open`} />
              <div className="hair-v" style={{ height: 42 }} />
              <Stat label="Win Rate" value={`${winRate}%`} color="#f0e6cf" progress={winRate} sub={`${stats.wins || 0}w / ${stats.losses || 0}l`} />
            </div>
          </div>
        </motion.div>
        <div className="hair-h" />

        {/* Z4 — switchable reactor core + execution tape */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px]">
          <div className="px-6 py-5" style={{ minHeight: 560 }}>
            <CoreStage />
          </div>
          <div className="flex">
            <div className="hair-v hidden lg:block" />
            <div className="flex-1 min-w-0 px-4 py-5 flex flex-col gap-4" style={{ maxHeight: 560 }}>
              <div style={{ flex: '1 1 0', minHeight: 0 }}><ExecutionTape /></div>
              <div className="hair-h" />
              <div style={{ flex: '1 1 0', minHeight: 0 }}><EngineLog /></div>
            </div>
          </div>
        </div>

        <div className="hair-h-amber" />

        {/* Z5 — momentum radar (full-bleed) with floating kill box */}
        <div className="relative" style={{ minHeight: 360 }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <MomentumRadar />
          </div>
          {/* chart HUD */}
          <div className="absolute top-4 left-6 pointer-events-none" style={{ zIndex: 2 }}>
            <div className="section-label">Momentum Radar</div>
            <div style={{ fontSize: 13, letterSpacing: 1, color: '#e7d7b0', marginTop: 4 }}>
              {pair} <span style={{ color: MUTED }}>·</span> {price != null ? '$' + Number(price).toFixed(2) : '--'}
              <span style={{ marginLeft: 12, color: rsi == null ? MUTED : rsi > 70 || rsi < 30 ? AMBER : EMERALD }}>RSI {rsi != null ? Number(rsi).toFixed(1) : '—'}</span>
            </div>
          </div>
          {/* floating kill box */}
          <div className="absolute bottom-6 left-6" style={{ zIndex: 3 }}>
            <KillBox onFire={doShake} />
          </div>
        </div>
      </motion.div>

      {/* Z7 — GRX strategy drawer */}
      <button className="grx-tab" onClick={() => setDrawer(true)}>GRX · STRATEGY</button>
      {drawer && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDrawer(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,.5)' }} />
          <motion.div initial={{ x: 440 }} animate={{ x: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 30 }} className="grx-drawer">
            <div className="flex items-center justify-between mb-6">
              <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: 3, color: AMBER }}>GRX PARAMETERS</span>
              <button onClick={() => setDrawer(false)} style={{ background: 'transparent', border: '1px solid rgba(255,61,0,.5)', color: CRIMSON, padding: '4px 12px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>✕</button>
            </div>
            <StrategyConfig />
          </motion.div>
        </>
      )}
    </div>
  );
}
