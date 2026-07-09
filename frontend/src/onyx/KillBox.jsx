import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTradeExecution } from '../store/useLiveConnection';

const EMERALD = '#00E676', AMBER = '#FFB000', CRIMSON = '#FF3D00', MUTED = 'rgba(255,255,255,.35)';
const HOLD_MS = 800;

/* Floating physical control. EXECUTE = single press (start bot).
   HALT = press-and-hold 800ms (safety) → stop bot. Both hit the
   real /api/bot/control. Ripple + screen-shake on fire. */
export default function KillBox({ onFire }) {
  const { execute, botRunning } = useTradeExecution();
  const [toast, setToast] = useState(null);
  const [progress, setProgress] = useState(0);
  const [ripples, setRipples] = useState([]);
  const holdRaf = useRef(0);
  const holdStart = useRef(0);
  const rid = useRef(0);

  const flash = (msg, color) => { setToast({ msg, color }); setTimeout(() => setToast(null), 3000); };

  const ripple = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const id = rid.current++;
    setRipples((rs) => [...rs, { id, x: e.clientX - r.left, y: e.clientY - r.top }]);
    setTimeout(() => setRipples((rs) => rs.filter((x) => x.id !== id)), 650);
  };

  const doExecute = async (e) => {
    ripple(e); onFire?.();
    const ok = await execute('start');
    flash(ok ? '▶ ENGINE IGNITED' : '✕ IGNITE FAILED', ok ? EMERALD : CRIMSON);
  };

  const startHold = (e) => {
    ripple(e);
    holdStart.current = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - holdStart.current) / HOLD_MS);
      setProgress(p);
      if (p >= 1) { fireHalt(); return; }
      holdRaf.current = requestAnimationFrame(tick);
    };
    holdRaf.current = requestAnimationFrame(tick);
  };
  const cancelHold = () => { cancelAnimationFrame(holdRaf.current); if (progress < 1) setProgress(0); };
  const fireHalt = async () => {
    cancelAnimationFrame(holdRaf.current);
    setProgress(0);
    onFire?.();
    const ok = await execute('stop');
    flash(ok ? '■ ENGINE HALTED' : '✕ HALT FAILED', ok ? AMBER : CRIMSON);
  };

  const Ripples = () => (
    <AnimatePresence>
      {ripples.map((r) => (
        <motion.span key={r.id} className="ripple" style={{ position: 'absolute', left: r.x, top: r.y, borderRadius: '50%', background: 'rgba(255,255,255,.4)', transform: 'translate(-50%,-50%)', pointerEvents: 'none' }}
          initial={{ width: 0, height: 0, opacity: 0.5 }} animate={{ width: 420, height: 420, opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }} />
      ))}
    </AnimatePresence>
  );

  return (
    <div className="kill-cluster">
      <div className="corner tl" style={{ position: 'absolute', top: 6, left: 6 }} />
      <div className="corner br" style={{ position: 'absolute', bottom: 6, right: 6 }} />

      <div className="flex items-center justify-between mb-3">
        <span className="section-label">Tactical Override</span>
        <span style={{ fontSize: 10, letterSpacing: 2, color: botRunning ? EMERALD : CRIMSON }}>{botRunning ? '● SYSTEM ARMED' : '● SYSTEM HALTED'}</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button className="kbtn kbtn-exec" onMouseDown={doExecute}>EXECUTE<Ripples /></button>
        <button
          className="kbtn kbtn-halt hazard"
          onMouseDown={startHold} onMouseUp={cancelHold} onMouseLeave={cancelHold}
          onTouchStart={startHold} onTouchEnd={cancelHold}
        >
          {progress > 0 && progress < 1 ? 'HOLD…' : 'HALT'}
          <motion.span className="kbtn-progress" style={{ scaleX: progress }} />
          <Ripples />
        </button>
      </div>

      <div className="mt-2" style={{ height: 16, textAlign: 'center' }}>
        <AnimatePresence mode="wait">
          {toast && (
            <motion.span key={toast.msg} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              style={{ fontSize: 10, letterSpacing: 1, color: toast.color }}>{toast.msg}</motion.span>
          )}
        </AnimatePresence>
      </div>
      <div className="micro" style={{ textAlign: 'center', marginTop: 2 }}>HOLD HALT 0.8s TO CONFIRM</div>
    </div>
  );
}
