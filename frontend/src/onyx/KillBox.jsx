import React, { useState, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTradeExecution } from '../store/useLiveConnection';

const EMERALD = '#00E676', AMBER = '#FFB000', CRIMSON = '#FF3D00', MUTED = '#6b7280';

/* Tactile emergency control center. EXECUTE/HALT hit the real
   /api/bot/control endpoint. LIQUIDATE (close-all) has no backend
   endpoint yet, so it HALTS as a real failsafe and says so. */
export default function KillBox({ onFire }) {
  const { execute, botRunning, positions } = useTradeExecution();
  const [toast, setToast] = useState(null);
  const [pending, setPending] = useState(null);
  const rippleId = useRef(0);
  const [ripples, setRipples] = useState([]);

  const flash = (msg, color) => { setToast({ msg, color }); setTimeout(() => setToast(null), 3200); };

  const spawnRipple = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const id = rippleId.current++;
    setRipples((rs) => [...rs, { id, x: e.clientX - r.left, y: e.clientY - r.top }]);
    setTimeout(() => setRipples((rs) => rs.filter((x) => x.id !== id)), 650);
  };

  const fire = async (kind, e) => {
    spawnRipple(e);
    onFire?.();
    setPending(kind);
    if (kind === 'execute') {
      const ok = await execute('start');
      flash(ok ? '▶ ENGINE IGNITED' : '✕ IGNITE FAILED', ok ? EMERALD : CRIMSON);
    } else if (kind === 'halt') {
      const ok = await execute('stop');
      flash(ok ? '■ ENGINE HALTED' : '✕ HALT FAILED', ok ? AMBER : CRIMSON);
    } else if (kind === 'liquidate') {
      // No close-all endpoint on backend — HALT as the real failsafe.
      const ok = await execute('stop');
      flash(ok ? `⚠ FAILSAFE: ENGINE HALTED (${positions.length} pos still open — needs /api/positions/close_all)` : '✕ FAILSAFE FAILED', ok ? CRIMSON : CRIMSON);
    }
    setTimeout(() => setPending(null), 500);
  };

  const Btn = ({ kind, cls, children }) => (
    <button className={`kill-btn ${cls}`} disabled={pending === kind} onMouseDown={(e) => fire(kind, e)}>
      {children}
      <AnimatePresence>
        {ripples.map((r) => (
          <motion.span key={r.id} className="ripple" style={{ left: r.x, top: r.y }}
            initial={{ width: 0, height: 0, opacity: 0.5 }}
            animate={{ width: 480, height: 480, opacity: 0 }}
            exit={{ opacity: 0 }} transition={{ duration: 0.6, ease: 'easeOut' }} />
        ))}
      </AnimatePresence>
    </button>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <span className="panel-title">Tactical Override</span>
        <span style={{ fontSize: 9, letterSpacing: 2, color: botRunning ? EMERALD : CRIMSON }}>
          {botRunning ? '● ARMED' : '● SAFE'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 flex-1">
        {botRunning
          ? <Btn kind="halt" cls="kill-halt">■ HALT ENGINE</Btn>
          : <Btn kind="execute" cls="kill-execute">▶ EXECUTE</Btn>}
        <Btn kind="liquidate" cls="kill-liquidate">⚠ LIQUIDATE</Btn>
      </div>

      <div className="mt-3 h-5 text-center">
        <AnimatePresence mode="wait">
          {toast && (
            <motion.span key={toast.msg} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              style={{ fontSize: 10, letterSpacing: 1, color: toast.color }}>
              {toast.msg}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
