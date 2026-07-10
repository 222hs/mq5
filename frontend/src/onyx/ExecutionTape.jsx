import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTradingStore } from '../store/useTradingStore';

const EMERALD = '#00E676', CRIMSON = '#FF3D00', MUTED = 'rgba(255,255,255,.35)';

const sideOf = (p) => {
  if (p.type === 0 || p.type === 'BUY' || p.type === 'buy') return 'BUY';
  if (p.type === 1 || p.type === 'SELL' || p.type === 'sell') return 'SELL';
  return typeof p.type === 'string' ? p.type.toUpperCase() : '—';
};

// subscribe ONLY to positions + botRunning (not history/clock) so the tape
// re-renders solely when open positions actually change — no per-poll flicker
function ExecutionTape() {
  const positions = useTradingStore((s) => s.positions);
  const botRunning = useTradingStore((s) => s.botRunning);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-1">
        <span className="section-label">Execution Tape</span>
        <span className="flex items-center gap-1.5">
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: botRunning ? EMERALD : CRIMSON, boxShadow: `0 0 8px ${botRunning ? EMERALD : CRIMSON}`, animation: botRunning ? 'nodepulse 1.2s infinite' : 'none' }} />
          <span className="micro">{botRunning ? 'ARMED' : 'HALTED'}</span>
        </span>
      </div>

      <div className="xrow xhead" style={{ height: 28 }}>
        <span>SYMBOL</span><span>SIDE</span><span>VOL</span><span>ENTRY</span><span style={{ textAlign: 'right' }}>P&amp;L</span>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ maskImage: 'linear-gradient(to bottom, black 88%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, black 88%, transparent)' }}>
        <AnimatePresence initial={false}>
          {positions.length === 0 ? (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="micro" style={{ padding: '28px 4px', textAlign: 'center' }}>
              NO ACTIVE EXECUTIONS
            </motion.div>
          ) : positions.map((p, i) => {
            const side = sideOf(p);
            const edge = side === 'BUY' ? EMERALD : side === 'SELL' ? CRIMSON : '#6b7280';
            const pnl = p.profit || 0;
            return (
              <motion.div
                key={p.ticket ?? `${p.symbol}-${i}`}
                layout
                initial={{ opacity: 0, x: 24, backgroundColor: 'rgba(255,255,255,0.06)' }}
                animate={{ opacity: 1, x: 0, backgroundColor: 'rgba(255,255,255,0)' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="xrow" style={{ '--edge': edge }}
              >
                <span style={{ color: '#e7d7b0', fontWeight: 700 }}>{p.symbol || '—'}</span>
                <span style={{ color: edge, fontWeight: 700 }}>{side}</span>
                <span style={{ color: MUTED }}>{p.volume != null ? Number(p.volume).toFixed(2) : '—'}</span>
                <span style={{ color: 'rgba(255,255,255,.7)' }}>{p.price_open != null ? Number(p.price_open).toFixed(2) : '—'}</span>
                <span style={{ textAlign: 'right', color: pnl >= 0 ? EMERALD : CRIMSON, fontWeight: 800 }}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default React.memo(ExecutionTape);
