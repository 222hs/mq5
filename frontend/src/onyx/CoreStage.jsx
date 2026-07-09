import React, { useRef, useEffect, useMemo, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { MeshDistortMaterial } from '@react-three/drei';
import * as THREE from 'three';
import OnyxArcade from './OnyxArcade.jsx';
import { useTradingStore } from '../store/useTradingStore';

/* ── ONE ORGANISM, FOUR BODIES ──────────────────────────────────
   Color = P&L sign. Energy = stress (drawdown). Mass = open
   exposure. Latency touches only the rim light. Idle = amber.
   ─────────────────────────────────────────────────────────────── */
const EMERALD = new THREE.Color('#00E676');
const AMBER = new THREE.Color('#FFB000');
const CRIMSON = new THREE.Color('#FF3D00');
const bodyColor = (sign) => (sign > 0 ? EMERALD : sign < 0 ? CRIMSON : AMBER);
const env = (pulse, t) => { if (pulse.trigger) { pulse.at = t; pulse.trigger = false; } return Math.exp(-(t - pulse.at) * 6); };

/* Rim light tinted by real ping latency. */
function RimLight({ vitals }) {
  const ref = useRef(); const tmp = useRef(new THREE.Color());
  useFrame(() => {
    const lat = vitals.current.lat;
    const c = lat == null ? CRIMSON : lat < 20 ? EMERALD : lat > 50 ? AMBER : tmp.current.copy(AMBER).lerp(EMERALD, (50 - lat) / 30);
    if (ref.current) { ref.current.color.lerp(c, 0.08); ref.current.intensity = lat == null ? 1.4 : lat < 20 ? 3.0 : lat > 50 ? 1.4 : 2.2; }
  });
  return <pointLight ref={ref} position={[3, 3, 4]} intensity={2.2} color="#FFB000" />;
}

function MorphForm({ vitals, pulse }) {
  const mesh = useRef(); const mat = useRef();
  useFrame((s, dt) => {
    const v = vitals.current; const t = s.clock.elapsedTime; const k = env(pulse.current, t);
    if (mesh.current) { mesh.current.rotation.y += (0.12 + 0.4 * v.stress) * dt; mesh.current.rotation.x += 0.06 * dt; mesh.current.scale.setScalar((1 + 0.22 * v.load) * (1 + 0.08 * k)); }
    if (mat.current) {
      mat.current.color.lerp(bodyColor(v.sign), 0.06);
      if (mat.current.emissive) mat.current.emissive.lerp(bodyColor(v.sign), 0.06);
      mat.current.distort = 0.25 + 0.55 * v.stress;
      mat.current.speed = 1.2 + 3.0 * v.stress;
      mat.current.emissiveIntensity = 0.9 + 0.8 * v.vigor;
    }
  });
  return (
    <mesh ref={mesh}>
      <icosahedronGeometry args={[1.35, 4]} />
      <MeshDistortMaterial ref={mat} wireframe color="#FFB000" emissive="#FFB000" emissiveIntensity={1.1} roughness={0.35} metalness={0.4} distort={0.3} speed={1.4} />
    </mesh>
  );
}

function KnotForm({ vitals, pulse }) {
  const mesh = useRef(); const mat = useRef();
  useFrame((s, dt) => {
    const v = vitals.current; const t = s.clock.elapsedTime; const k = env(pulse.current, t);
    const spin = 0.15 + 0.75 * v.stress;
    if (mesh.current) { mesh.current.rotation.x += spin * dt; mesh.current.rotation.y += spin * 0.7 * dt; mesh.current.scale.setScalar((1 + 0.20 * v.load) * (1 + 0.08 * k)); }
    if (mat.current) { mat.current.color.lerp(bodyColor(v.sign), 0.06); mat.current.opacity = (0.55 + 0.35 * v.vigor) + 0.1 * k; }
  });
  return (
    <mesh ref={mesh}>
      <torusKnotGeometry args={[1, 0.34, 200, 30, 2, 3]} />
      <meshBasicMaterial ref={mat} wireframe color="#FFB000" transparent opacity={0.8} />
    </mesh>
  );
}

function VortexForm({ vitals, pulse }) {
  const ref = useRef(); const mat = useRef();
  const positions = useMemo(() => {
    const N = 1000; const a = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { const tt = i / N; const ang = tt * Math.PI * 2 * 14; const r = 1.7 * (1 - tt * 0.55); a[i * 3] = Math.cos(ang) * r; a[i * 3 + 1] = (tt - 0.5) * 3.2; a[i * 3 + 2] = Math.sin(ang) * r; }
    return a;
  }, []);
  useFrame((s, dt) => {
    const v = vitals.current; const t = s.clock.elapsedTime; const k = env(pulse.current, t);
    if (ref.current) {
      ref.current.rotation.y += (0.3 + 1.8 * v.stress) * dt;
      ref.current.scale.setScalar((1 - 0.25 * v.stress) * (1 + 0.08 * k)); // contracts under drawdown
      ref.current.geometry.setDrawRange(0, 400 + Math.round(600 * v.load));
    }
    if (mat.current) { mat.current.color.lerp(bodyColor(v.sign), 0.06); mat.current.size = 0.038 + 0.02 * v.vigor; mat.current.opacity = 0.85 + 0.15 * k; }
  });
  return (
    <points ref={ref}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
      <pointsMaterial ref={mat} size={0.045} color="#FFB000" sizeAttenuation transparent opacity={0.85} depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

function FieldForm({ vitals, pulse }) {
  const ref = useRef(); const mat = useRef(); const G = 28;
  const positions = useMemo(() => {
    const p = new Float32Array(G * G * 3); let n = 0;
    for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) { p[n * 3] = (i / (G - 1) - 0.5) * 4.2; p[n * 3 + 1] = 0; p[n * 3 + 2] = (j / (G - 1) - 0.5) * 4.2; n++; }
    return p;
  }, []);
  useFrame((s) => {
    const v = vitals.current; const t = s.clock.elapsedTime; const k = env(pulse.current, t);
    const amp = 0.16 + 0.50 * v.stress + 0.3 * k;
    const freq = 1.4 + 1.2 * v.stress;
    const swell = 0.08 * v.vigor * Math.sin(t * 0.25 * Math.PI * 2);
    if (ref.current) {
      const arr = ref.current.geometry.attributes.position.array;
      for (let idx = 0; idx < G * G; idx++) {
        const x = arr[idx * 3], z = arr[idx * 3 + 2];
        arr[idx * 3 + 1] = (Math.sin(x * freq + t) + Math.cos(z * freq + t * 0.8)) * amp + swell;
      }
      ref.current.geometry.attributes.position.needsUpdate = true;
      ref.current.rotation.y = t * 0.12;
    }
    if (mat.current) { mat.current.color.lerp(bodyColor(v.sign), 0.06); mat.current.size = 0.055 + 0.02 * v.load; }
  });
  return (
    <points ref={ref} rotation={[-0.55, 0, 0]}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
      <pointsMaterial ref={mat} size={0.055} color="#FFB000" sizeAttenuation transparent opacity={0.9} depthWrite={false} />
    </points>
  );
}

const MODES = [
  { k: 'morph', label: 'MORPH' }, { k: 'knot', label: 'KNOT' },
  { k: 'vortex', label: 'VORTEX' }, { k: 'field', label: 'FIELD' }, { k: 'arcade', label: 'ARCADE' },
];

export default function CoreStage() {
  const [mode, setMode] = useState('morph');
  const vitals = useRef({ sign: 0, stress: 0, load: 0, vigor: 0.5, lat: null });
  const pulse = useRef({ trigger: false, at: -99 });
  const lastLen = useRef(useTradingStore.getState().positions.length);

  useEffect(() => useTradingStore.subscribe((s) => {
    const dd = Math.min(0, s.pnlOpen);
    vitals.current = {
      sign: s.pnlOpen > 0.01 ? 1 : s.pnlOpen < -0.01 ? -1 : 0,
      stress: Math.min(1, Math.abs(dd) / (0.02 * (s.balance || 1))),
      load: Math.min(1, s.positions.length / 8),
      vigor: (s.stats.win_rate ?? 50) / 100,
      lat: s.latencyMs,
    };
    if (s.positions.length !== lastLen.current) { lastLen.current = s.positions.length; pulse.current.trigger = true; }
  }), []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <span className="section-label">Reactor Core</span>
        <span className="micro">{mode === 'arcade' ? 'TACTICAL SIM' : 'VITALS-BOUND'}</span>
      </div>

      <div className="relative flex-1" style={{ minHeight: 320 }}>
        {mode === 'arcade' ? (
          <div className="absolute inset-0"><OnyxArcade /></div>
        ) : (
          <Canvas camera={{ position: [0, 0, 4.2], fov: 55 }} dpr={[1, 2]} style={{ width: '100%', height: '100%' }}>
            <ambientLight intensity={0.5} />
            <RimLight vitals={vitals} />
            <pointLight position={[-3, -2, -3]} intensity={1.1} color="#00E676" />
            {mode === 'morph' && <MorphForm vitals={vitals} pulse={pulse} />}
            {mode === 'knot' && <KnotForm vitals={vitals} pulse={pulse} />}
            {mode === 'vortex' && <VortexForm vitals={vitals} pulse={pulse} />}
            {mode === 'field' && <FieldForm vitals={vitals} pulse={pulse} />}
          </Canvas>
        )}
      </div>

      <div className="flex gap-1.5 mt-3 flex-wrap">
        {MODES.map((m) => (
          <button key={m.k} className="core-tab" data-on={mode === m.k} onClick={() => setMode(m.k)}>{m.label}</button>
        ))}
      </div>
    </div>
  );
}
