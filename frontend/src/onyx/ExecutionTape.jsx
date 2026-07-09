import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTradeExecution } from '../store/useLiveConnection';

const AMBER = '#FFB000', EMERALD = '#00E676', CRIMSON = '#FF3D00', MUTED = '#6b7280';

const sideOf = (p) => {
  if (p.type === 0 || p.type === 'BUY' || p.type === 'buy') return 'BUY';
  if (p.type === 1 || p.type === 'SELL' || p.type === 'sell') return 'SELL';
  return typeof p.type === 'string' ? p.type.toUpperCase() : '—';
};

export default function ExecutionTape() {
  const { positions } = useTradeExecution();

  return (
    <div className="flex flex-col h-full">
      <div className="tape-row tape-head">
        <span>SYMBOL</span><span>SIDE</span><span>VOL</span><span>ENTRY</span><span className="text-right">P&amp;L</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence initial={false}>
          {positions.length === 0 ? (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="text-center py-8" style={{ color: MUTED, fontSize: 11, letterSpacing: 2 }}>
              NO ACTIVE EXECUTIONS
            </motion.div>
          ) : positions.map((p, i) => {
            const side = sideOf(p);
            const pnl = p.profit || 0;
            return (
              <motion.div
                key={p.ticket ?? `${p.symbol}-${i}`}
                layout
                initial={{ opacity: 0, y: -18, filter: 'blur(6px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, height: 0, filter: 'blur(6px)' }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="tape-row"
              >
                <span style={{ color: '#e7d7b0', fontWeight: 700 }}>{p.symbol || '—'}</span>
                <span style={{ color: side === 'BUY' ? EMERALD : side === 'SELL' ? CRIMSON : MUTED, fontWeight: 700 }}>{side}</span>
                <span style={{ color: MUTED }}>{p.volume != null ? Number(p.volume).toFixed(2) : '—'}</span>
                <span style={{ color: '#a9b0bd' }}>{p.price_open != null ? Number(p.price_open).toFixed(2) : '—'}</span>
                <span className="text-right" style={{ color: pnl >= 0 ? EMERALD : CRIMSON, fontWeight: 800, textShadow: `0 0 12px ${pnl >= 0 ? EMERALD : CRIMSON}44` }}>
                  {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
