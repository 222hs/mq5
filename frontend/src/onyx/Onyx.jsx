import React from 'react';
import { motion, useMotionValue, useAnimationControls } from 'framer-motion';
import './onyx.css';
import { useLiveConnection } from '../store/useLiveConnection';
import { useTradingStore } from '../store/useTradingStore';
import MeshGradient from './MeshGradient.jsx';
import LatencyCore from './LatencyCore.jsx';
import MomentumRadar from './MomentumRadar.jsx';
import ExecutionTape from './ExecutionTape.jsx';
import TelemetryHeader from './TelemetryHeader.jsx';
import KillBox from './KillBox.jsx';

const AMBER = '#FFB000', EMERALD = '#00E676', CRIMSON = '#FF3D00', MUTED = '#6b7280';

const container = { hidden: {}, show: { transition: { staggerChildren: 0.09, delayChildren: 0.15 } } };
const panel = {
  hidden: { opacity: 0, y: 34, filter: 'blur(10px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } },
};

function PanelHead({ title, tag, accent = AMBER, dotStatus }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <span className="flex items-center gap-2">
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent, boxShadow: `0 0 8px ${accent}` }} />
        <span className="panel-title">{title}</span>
      </span>
      {tag && <span className="panel-label">{tag}</span>}
      {dotStatus && <span style={{ fontSize: 9, letterSpacing: 2, color: MUTED }}>{dotStatus}</span>}
    </div>
  );
}

export default function Onyx() {
  useLiveConnection(); // mount every live source; auto-torn-down on unmount

  const rsi = useTradingStore((s) => s.rsi);
  const macd = useTradingStore((s) => s.macd);
  const latency = useTradingStore((s) => s.latencyMs);
  const isOnline = useTradingStore((s) => s.isOnline);
  const pair = useTradingStore((s) => s.pair);
  const price = useTradingStore((s) => s.price);

  const shake = useAnimationControls();
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const onMove = (e) => {
    px.set((e.clientX / window.innerWidth - 0.5) * 14);
    py.set((e.clientY / window.innerHeight - 0.5) * 14);
  };
  const doShake = () => shake.start({ x: [0, -11, 9, -7, 5, -2, 0], y: [0, 5, -4, 2, -1, 0], transition: { duration: 0.5 } });

  return (
    <div className="onyx-root" onMouseMove={onMove}>
      <MeshGradient />
      <div className="grain" />

      {/* Floating telemetry header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 30, display: 'flex', justifyContent: 'center', padding: '18px 12px 0' }}>
        <TelemetryHeader />
      </div>

      {/* Spatial content (shake layer → parallax layer) */}
      <motion.div animate={shake} style={{ position: 'relative', zIndex: 10 }}>
        <motion.div style={{ x: px, y: py }} className="px-4 md:px-8 pb-16 pt-8 max-w-[1500px] mx-auto">
          <motion.div className="grid grid-cols-12 gap-5" variants={container} initial="hidden" animate="show">

            {/* A · Momentum Radar */}
            <motion.section variants={panel} className="col-span-12 lg:col-span-7 glass glass-hover p-5" style={{ minHeight: 380 }}>
              <PanelHead title="The Momentum Radar" tag={`${pair} · M1`} dotStatus={price != null ? `$${Number(price).toFixed(2)}` : ''} />
              <div style={{ height: 320 }}><MomentumRadar /></div>
            </motion.section>

            {/* C · 3D Network Latency Core */}
            <motion.section variants={panel} className="col-span-12 lg:col-span-5 glass glass-hover p-5 flex flex-col" style={{ minHeight: 380, transform: 'translateY(26px)' }}>
              <PanelHead title="Network Latency Core" tag="MT5 · PING RTT" accent={EMERALD} />
              <div style={{ flex: 1, minHeight: 210, position: 'relative' }}>
                <LatencyCore />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                  <span style={{ fontSize: 34, fontWeight: 800, color: latency == null ? CRIMSON : latency < 20 ? EMERALD : latency > 50 ? AMBER : '#cdd3dc', textShadow: '0 0 20px currentColor' }}>
                    {latency == null ? '—' : latency}
                  </span>
                  <span style={{ fontSize: 10, letterSpacing: 3, color: MUTED }}>MILLISECONDS</span>
                </div>
              </div>
              <div className="flex justify-around mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,176,0,0.12)', fontSize: 11 }}>
                <span>RSI <b style={{ color: rsi == null ? MUTED : rsi > 70 || rsi < 30 ? AMBER : EMERALD }}>{rsi != null ? Number(rsi).toFixed(1) : '—'}</b></span>
                <span title="Backend does not emit MACD yet">MACD <b style={{ color: MUTED }}>{macd != null ? Number(macd).toFixed(2) : '—'}</b></span>
                <span>LINK <b style={{ color: isOnline ? EMERALD : CRIMSON }}>{isOnline ? 'LIVE' : 'DOWN'}</b></span>
              </div>
            </motion.section>

            {/* B · Execution Tape */}
            <motion.section variants={panel} className="col-span-12 lg:col-span-5 glass glass-hover p-5 flex flex-col" style={{ minHeight: 300, transform: 'translateY(-4px)' }}>
              <PanelHead title="Execution Tape" tag="ACTIVE ORDERS" />
              <div className="flex-1"><ExecutionTape /></div>
            </motion.section>

            {/* D · Tactical Override (Kill Box) */}
            <motion.section variants={panel} className="col-span-12 lg:col-span-7 glass glass-hover p-6" style={{ minHeight: 300, transform: 'translateY(18px)' }}>
              <KillBox onFire={doShake} />
            </motion.section>

          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}
