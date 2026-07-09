import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTradingStore } from '../store/useTradingStore';

const EMERALD = '#00E676', CRIMSON = '#FF3D00', AMBER = '#FFB000';
const netOf = (t) => (t.profit || 0) + (t.swap || 0) + (t.commission || 0);
const MASK = 'linear-gradient(to right, transparent 0%, rgba(0,0,0,.18) 30%, rgba(0,0,0,.55) 55%, #000 75%)';

/* "Ledger Pulse" — last-24h cumulative realized PnL as a step chart that
   runs behind the balance digits and dissolves under them via a left→right
   mask. Fills the monument's empty right half. */
export default function LedgerPulse() {
  const history = useTradingStore((s) => s.history);

  const g = useMemo(() => {
    const now = Date.now();
    const start = now - 86400000;
    const B = 48;
    const trades = history.filter((t) => { const tm = new Date(t.time).getTime(); return !isNaN(tm) && tm >= start; });
    const buckets = new Array(B).fill(0);
    trades.forEach((t) => {
      const tm = new Date(t.time).getTime();
      const idx = Math.min(B - 1, Math.max(0, Math.floor((tm - start) / (86400000 / B))));
      buckets[idx] += netOf(t);
    });
    let cum = 0;
    const cums = buckets.map((b) => (cum += b));
    const endNet = cum;
    const maxAbs = Math.max(1, ...cums.map((v) => Math.abs(v)));
    const X = (i) => (i / (B - 1)) * 1000;
    const Y = (v) => 120 - (v / maxAbs) * 104;
    let d = `M0,${Y(cums[0]).toFixed(1)}`;
    for (let i = 1; i < B; i++) d += `H${X(i).toFixed(1)}V${Y(cums[i]).toFixed(1)}`;
    d += 'H1000';
    return { path: d, area: `${d}V120H0Z`, endY: Y(cums[B - 1]), endNet, enough: trades.length >= 2 };
  }, [history]);

  const color = g.endNet >= 0 ? EMERALD : CRIMSON;

  return (
    <>
      <div className="hidden md:block" style={{
        position: 'absolute', top: '50%', right: 0, transform: 'translateY(-50%)',
        width: '78%', height: 'clamp(140px,15vw,230px)', zIndex: 0, pointerEvents: 'none',
        WebkitMaskImage: MASK, maskImage: MASK,
      }}>
        <svg viewBox="0 0 1000 240" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
          <defs>
            <linearGradient id="lpArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.14" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* hour ticks */}
          {Array.from({ length: 24 }).map((_, i) => (
            <line key={i} x1={(i / 23) * 1000} y1="112" x2={(i / 23) * 1000} y2="116" stroke="rgba(255,255,255,.06)" strokeWidth="1" />
          ))}
          {/* zero baseline — amber, structural */}
          <line x1="0" y1="120" x2="1000" y2="120" stroke="rgba(255,176,0,.18)" strokeWidth="1" strokeDasharray="2 6" />
          {g.enough && <path d={g.area} fill="url(#lpArea)" />}
          {g.enough && (
            <motion.path d={g.path} fill="none" stroke={color} strokeWidth="1.5" strokeOpacity="0.66"
              vectorEffect="non-scaling-stroke" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: 'easeOut' }} />
          )}
          {g.enough && <circle cx="1000" cy={g.endY} r="3" fill={color} style={{ filter: `drop-shadow(0 0 8px ${color})` }} />}
        </svg>
      </div>

      {/* annotation — in the open air, unmasked */}
      <div style={{ position: 'absolute', top: 16, right: 20, zIndex: 1, textAlign: 'right', pointerEvents: 'none' }}>
        <div className="micro">24H NET</div>
        <div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: g.enough ? color : 'rgba(255,255,255,.35)' }}>
          {g.enough ? `${g.endNet >= 0 ? '+' : '-'}$${Math.abs(g.endNet).toFixed(2)}` : 'NO EXECUTIONS'}
        </div>
      </div>
    </>
  );
}
