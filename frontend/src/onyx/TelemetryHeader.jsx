import React, { useEffect } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';
import { useTradingStore } from '../store/useTradingStore';

const AMBER = '#FFB000', EMERALD = '#00E676', CRIMSON = '#FF3D00', MUTED = '#6b7280';

/* Hardware-accelerated number ticker via a Framer Motion spring. */
function Ticker({ value, prefix = '', decimals = 2, color }) {
  const sv = useSpring(value || 0, { stiffness: 90, damping: 20, mass: 0.6 });
  useEffect(() => { sv.set(value || 0); }, [value, sv]);
  const text = useTransform(sv, (v) => prefix + Number(v).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
  return <motion.span className="tick-num" style={{ color }}>{text}</motion.span>;
}

function Node({ label, status }) {
  return (
    <span className="flex items-center gap-1.5" title={`${label}: ${status}`}>
      <span className={`node ${status}`} />
      <span style={{ fontSize: 9, letterSpacing: 1.5, color: MUTED }}>{label}</span>
    </span>
  );
}

export default function TelemetryHeader() {
  const balance = useTradingStore((s) => s.balance);
  const equity = useTradingStore((s) => s.equity);
  const totalPnl = useTradingStore((s) => s.stats.total_profit);
  const latency = useTradingStore((s) => s.latencyMs);
  const connections = useTradingStore((s) => s.connections);
  const pnlPos = (totalPnl ?? 0) >= 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: -24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="telemetry-pill"
    >
      <div className="flex items-baseline gap-2">
        <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: 4, color: AMBER, textShadow: '0 0 16px rgba(255,176,0,0.5)' }}>222s</span>
        <span style={{ fontSize: 9, letterSpacing: 2, color: MUTED }}>ONYX</span>
      </div>

      <div className="hidden sm:flex flex-col leading-tight">
        <span style={{ fontSize: 9, letterSpacing: 2, color: MUTED }}>BALANCE</span>
        <span style={{ fontSize: 15, fontWeight: 700 }}><Ticker value={balance} prefix="$" color="#e7d7b0" /></span>
      </div>

      <div className="flex flex-col leading-tight">
        <span style={{ fontSize: 9, letterSpacing: 2, color: MUTED }}>LIVE PNL</span>
        <span style={{ fontSize: 15, fontWeight: 800, textShadow: `0 0 14px ${pnlPos ? EMERALD : CRIMSON}55` }}>
          <Ticker value={totalPnl} prefix={pnlPos ? '+$' : '-$'} decimals={2} color={pnlPos ? EMERALD : CRIMSON} />
        </span>
      </div>

      <div className="hidden md:flex flex-col leading-tight">
        <span style={{ fontSize: 9, letterSpacing: 2, color: MUTED }}>EQUITY</span>
        <span style={{ fontSize: 13, fontWeight: 700 }}><Ticker value={equity} prefix="$" color="#a9b0bd" /></span>
      </div>

      <div className="flex flex-col leading-tight items-end">
        <span style={{ fontSize: 9, letterSpacing: 2, color: MUTED }}>LATENCY</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: latency == null ? CRIMSON : latency < 20 ? EMERALD : latency > 50 ? AMBER : '#cdd3dc' }}>
          {latency == null ? '—' : `${latency}ms`}
        </span>
      </div>

      <div className="flex items-center gap-3 pl-3" style={{ borderLeft: '1px solid rgba(255,176,0,0.14)' }}>
        <Node label="MT5" status={connections.mt5} />
        <Node label="BINANCE" status={connections.binance} />
        <Node label="FIREBASE" status={connections.firebase} />
      </div>
    </motion.div>
  );
}
