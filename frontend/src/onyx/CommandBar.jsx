import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useTradingStore } from '../store/useTradingStore';
import { useTradeExecution } from '../store/useLiveConnection';

const AMBER = '#FFB000', EMERALD = '#00E676', CRIMSON = '#FF3D00', MUTED = '#6b7280';

function Node({ label, status }) {
  return (
    <span className="flex items-center gap-1.5" title={`${label}: ${status}`}>
      <span className={`node ${status}`} />
      <span style={{ fontSize: 9, letterSpacing: 1.5, color: MUTED }}>{label}</span>
    </span>
  );
}

/* Full-width professional command bar. */
export default function CommandBar() {
  const isOnline = useTradingStore((s) => s.isOnline);
  const latency = useTradingStore((s) => s.latencyMs);
  const connections = useTradingStore((s) => s.connections);
  const pair = useTradingStore((s) => s.pair);
  const price = useTradingStore((s) => s.price);
  const { botRunning, execute } = useTradeExecution();
  const [now, setNow] = useState(new Date());
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const utc = now.toISOString().slice(11, 19);
  const toggle = async () => { setBusy(true); await execute(botRunning ? 'stop' : 'start'); setTimeout(() => setBusy(false), 700); };

  return (
    <motion.header
      initial={{ opacity: 0, y: -22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="glass flex items-center justify-between gap-5 flex-wrap px-6 py-4"
    >
      {/* brand */}
      <div className="flex items-center gap-4">
        <span style={{ fontSize: 32, fontWeight: 900, letterSpacing: 7, color: AMBER, textShadow: '0 0 24px rgba(255,176,0,0.55)' }}>222s</span>
        <div className="flex flex-col leading-none gap-1">
          <span style={{ fontSize: 12, letterSpacing: 5, color: '#e7d7b0' }}>ONYX COMMAND</span>
          <span style={{ fontSize: 9, letterSpacing: 2, color: MUTED }}>ALGORITHMIC EXECUTION TERMINAL</span>
        </div>
        <span className="px-3 py-1 rounded-full ml-1" style={{
          fontSize: 10, fontWeight: 700, letterSpacing: 2,
          color: isOnline ? EMERALD : CRIMSON,
          border: `1px solid ${isOnline ? 'rgba(0,230,118,.4)' : 'rgba(255,61,0,.4)'}`,
          background: isOnline ? 'rgba(0,230,118,.06)' : 'rgba(255,61,0,.06)',
        }}>● {isOnline ? 'LIVE' : 'OFFLINE'}</span>
      </div>

      {/* right cluster */}
      <div className="flex items-center gap-5 flex-wrap">
        <div className="hidden md:flex flex-col items-end leading-none">
          <span style={{ fontSize: 9, letterSpacing: 2, color: MUTED }}>{pair}</span>
          <span style={{ fontSize: 15, fontWeight: 800, color: '#e7d7b0' }}>{price != null ? '$' + Number(price).toFixed(2) : '--'}</span>
        </div>
        <div className="flex items-center gap-3 px-4 py-2 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,176,0,0.12)' }}>
          <Node label="MT5" status={connections.mt5} />
          <Node label="BINANCE" status={connections.binance} />
          <Node label="FIREBASE" status={connections.firebase} />
        </div>
        <div className="flex flex-col items-end leading-none">
          <span style={{ fontSize: 9, letterSpacing: 2, color: MUTED }}>LATENCY</span>
          <span style={{ fontSize: 15, fontWeight: 800, color: latency == null ? CRIMSON : latency < 20 ? EMERALD : latency > 50 ? AMBER : '#cdd3dc' }}>{latency == null ? '—' : latency + 'ms'}</span>
        </div>
        <div className="flex flex-col items-end leading-none">
          <span style={{ fontSize: 9, letterSpacing: 2, color: MUTED }}>UTC</span>
          <span style={{ fontSize: 22, fontWeight: 800, color: AMBER, fontVariantNumeric: 'tabular-nums', textShadow: '0 0 12px rgba(255,176,0,0.4)' }}>{utc}</span>
        </div>
        <button onClick={toggle} disabled={busy} className="px-6 py-3 rounded-xl" style={{
          fontWeight: 800, letterSpacing: 2, fontSize: 13, cursor: 'pointer', border: 'none',
          color: botRunning ? '#1a0500' : '#04140a',
          background: botRunning ? 'linear-gradient(180deg,#FF3D00,#a82600)' : 'linear-gradient(180deg,#00E676,#00933f)',
          boxShadow: '0 6px 0 rgba(0,0,0,0.45), 0 12px 24px rgba(0,0,0,0.4)',
        }}>{busy ? '…' : botRunning ? '■ HALT' : '▶ IGNITE'}</button>
      </div>
    </motion.header>
  );
}
