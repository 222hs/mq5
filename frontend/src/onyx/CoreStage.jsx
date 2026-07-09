import React, { useRef, useEffect, useMemo, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { MeshDistortMaterial } from '@react-three/drei';
import * as THREE from 'three';
import OnyxArcade from './OnyxArcade.jsx';
import { useTradingStore } from '../store/useTradingStore';

/* ── Signal layer — amber idle, green/red = money ── */
const AMBER = new THREE.Color('#FFB000'), EMERALD = new THREE.Color('#00E676'), CRIMSON = new THREE.Color('#FF3D00');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const bal01 = (b) => clamp((Math.log10(Math.max(b || 1, 1)) - 2) / 3, 0, 1);
const sysTf = (pnl, bal) => clamp((pnl || 0) / (0.01 * Math.max(bal || 1, 1)), -1, 1);
const ddf = (pnl, bal) => clamp(Math.max(0, -(pnl || 0)) / (0.02 * Math.max(bal || 1, 1)), 0, 1);
const colFor = (t, out) => (t < 0 ? out.copy(AMBER).lerp(CRIMSON, -t) : t > 0 ? out.copy(AMBER).lerp(EMERALD, t) : out.copy(AMBER));
const env = (pulse, t) => { if (pulse.trigger) { pulse.at = t; pulse.trigger = false; } return Math.exp(-(t - pulse.at) / 0.22); };

/* ── SUPERNOVA — glowing distorted core in a vast particle halo ── */
function Supernova({ data, pulse }) {
  const core = useRef(); const cmat = useRef(); const halo = useRef(); const hmat = useRef(); const tmp = useMemo(() => new THREE.Color(), []);
  const pos = useMemo(() => { const N = 1800; const a = new Float32Array(N * 3); for (let i = 0; i < N; i++) { const r = 2.2 + Math.random() * 2.4; const th = Math.acos(2 * Math.random() - 1); const ph = Math.random() * Math.PI * 2; a[i * 3] = r * Math.sin(th) * Math.cos(ph); a[i * 3 + 1] = r * Math.sin(th) * Math.sin(ph); a[i * 3 + 2] = r * Math.cos(th); } return a; }, []);
  useFrame((s, dt) => {
    const d = data.current; const t = s.clock.elapsedTime; const k = env(pulse.current, t);
    const b01 = bal01(d.balance); const sysT = sysTf(d.pnlOpen, d.balance); const dd = ddf(d.pnlOpen, d.balance); const n = d.positions.length;
    if (core.current) { core.current.rotation.y += 0.16 * dt; core.current.rotation.x += 0.08 * dt; core.current.scale.setScalar(1.5 + 0.5 * b01 + 0.25 * k); }
    if (cmat.current) { cmat.current.color.lerp(colFor(sysT, tmp), 0.06); cmat.current.emissive.lerp(colFor(sysT, tmp), 0.06); cmat.current.distort = 0.3 + 0.55 * dd; cmat.current.speed = 1.5 + 2.5 * dd; cmat.current.emissiveIntensity = 1.0 + 0.7 * Math.abs(sysT); }
    if (halo.current) { halo.current.rotation.y -= 0.03 * dt; halo.current.geometry.setDrawRange(0, Math.floor(500 + 1300 * clamp(n / 8 * 0.5 + b01 * 0.5, 0, 1))); }
    if (hmat.current) { hmat.current.color.lerp(colFor(sysT, tmp), 0.05); hmat.current.size = 0.024 + 0.02 * b01; }
  });
  return (
    <group>
      <mesh ref={core}><icosahedronGeometry args={[1, 5]} /><MeshDistortMaterial ref={cmat} wireframe color="#FFB000" emissive="#FFB000" emissiveIntensity={1.1} distort={0.35} speed={1.8} roughness={0.3} metalness={0.5} /></mesh>
      <points ref={halo}><bufferGeometry><bufferAttribute attach="attributes-position" args={[pos, 3]} /></bufferGeometry><pointsMaterial ref={hmat} size={0.03} color="#FFB000" transparent opacity={0.8} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} /></points>
    </group>
  );
}

/* ── AURORA — a wide undulating particle sheet filling the frame ── */
function Aurora({ data, pulse }) {
  const ref = useRef(); const mat = useRef(); const tmp = useMemo(() => new THREE.Color(), []); const G = 52;
  const pos = useMemo(() => { const p = new Float32Array(G * G * 3); let n = 0; for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) { p[n * 3] = (i / (G - 1) - 0.5) * 8; p[n * 3 + 1] = 0; p[n * 3 + 2] = (j / (G - 1) - 0.5) * 8; n++; } return p; }, []);
  useFrame((s) => {
    const d = data.current; const t = s.clock.elapsedTime; const k = env(pulse.current, t);
    const dd = ddf(d.pnlOpen, d.balance); const sysT = sysTf(d.pnlOpen, d.balance); const b01 = bal01(d.balance);
    const amp = 0.28 + 0.7 * dd + 0.4 * k; const freq = 0.85 + 0.6 * dd;
    if (ref.current) { const arr = ref.current.geometry.attributes.position.array; for (let idx = 0; idx < G * G; idx++) { const x = arr[idx * 3], z = arr[idx * 3 + 2]; arr[idx * 3 + 1] = (Math.sin(x * freq + t) + Math.cos(z * freq + t * 0.8)) * amp; } ref.current.geometry.attributes.position.needsUpdate = true; ref.current.rotation.y = t * 0.05; }
    if (mat.current) { mat.current.color.lerp(colFor(sysT, tmp), 0.05); mat.current.size = 0.04 + 0.02 * b01; }
  });
  return <points ref={ref} rotation={[-0.72, 0, 0]} position={[0, -0.4, 0]}><bufferGeometry><bufferAttribute attach="attributes-position" args={[pos, 3]} /></bufferGeometry><pointsMaterial ref={mat} size={0.045} color="#FFB000" transparent opacity={0.9} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} /></points>;
}

/* ── HELIX — tall glowing double helix filling the frame ── */
function Helix({ data, pulse }) {
  const grp = useRef(); const m1 = useRef(); const m2 = useRef(); const tmp = useMemo(() => new THREE.Color(), []);
  const strands = useMemo(() => { const N = 260; const a = new Float32Array(N * 3), b = new Float32Array(N * 3); for (let i = 0; i < N; i++) { const tt = i / N; const y = (tt - 0.5) * 6.4; const ang = tt * Math.PI * 2 * 5; a[i * 3] = Math.cos(ang) * 1.1; a[i * 3 + 1] = y; a[i * 3 + 2] = Math.sin(ang) * 1.1; b[i * 3] = Math.cos(ang + Math.PI) * 1.1; b[i * 3 + 1] = y; b[i * 3 + 2] = Math.sin(ang + Math.PI) * 1.1; } return { a, b }; }, []);
  useFrame((s, dt) => {
    const d = data.current; const t = s.clock.elapsedTime; const k = env(pulse.current, t);
    const sysT = sysTf(d.pnlOpen, d.balance); const b01 = bal01(d.balance); const dd = ddf(d.pnlOpen, d.balance);
    if (grp.current) { grp.current.rotation.y += (0.3 + 0.9 * dd) * dt; grp.current.scale.setScalar(1 + 0.18 * b01 + 0.1 * k); }
    [m1, m2].forEach((m) => { if (m.current) { m.current.color.lerp(colFor(sysT, tmp), 0.05); m.current.size = 0.07 + 0.03 * b01 + 0.05 * k; } });
  });
  return (
    <group ref={grp}>
      <points><bufferGeometry><bufferAttribute attach="attributes-position" args={[strands.a, 3]} /></bufferGeometry><pointsMaterial ref={m1} size={0.09} color="#FFB000" transparent opacity={0.95} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} /></points>
      <points><bufferGeometry><bufferAttribute attach="attributes-position" args={[strands.b, 3]} /></bufferGeometry><pointsMaterial ref={m2} size={0.09} color="#FFB000" transparent opacity={0.6} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} /></points>
    </group>
  );
}

/* ── TUNNEL — glowing rings rushing toward you, fills the frame ── */
function Tunnel({ data, pulse }) {
  const rings = useRef([]); const tmp = useMemo(() => new THREE.Color(), []); const N = 22;
  useFrame((s, dt) => {
    const d = data.current; const t = s.clock.elapsedTime; const sysT = sysTf(d.pnlOpen, d.balance); const dd = ddf(d.pnlOpen, d.balance);
    const speed = 1.4 + 3.2 * dd;
    rings.current.forEach((r, i) => {
      if (!r) return;
      r.position.z += speed * dt; if (r.position.z > 3.5) r.position.z -= N * 0.7;
      r.rotation.z = t * 0.25 + i * 0.3;
      r.material.color.lerp(colFor(sysT, tmp), 0.05);
      r.material.opacity = Math.max(0, 0.7 * (1 - Math.abs(r.position.z - 1) / 6));
    });
  });
  return <group>{Array.from({ length: N }).map((_, i) => (<mesh key={i} ref={(el) => (rings.current[i] = el)} position={[0, 0, -i * 0.7 + 3]}><torusGeometry args={[1.7, 0.02, 8, 80]} /><meshBasicMaterial color="#FFB000" transparent opacity={0.6} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>))}</group>;
}

/* ── NEURAL — the Claude pattern engine; nodes light up with samples learned ── */
function Neural({ data, pulse }) {
  const grp = useRef(); const inst = useRef(); const dummy = useMemo(() => new THREE.Object3D(), []); const tmp = useMemo(() => new THREE.Color(), []);
  const { nodes, lines } = useMemo(() => {
    const layers = [7, 11, 11, 4]; const xs = [-2.1, -0.7, 0.7, 2.1]; const ns = [];
    layers.forEach((cnt, li) => { for (let i = 0; i < cnt; i++) ns.push({ x: xs[li], y: (i - (cnt - 1) / 2) * 0.5, z: (Math.random() - 0.5) * 0.3 }); });
    const start = []; let acc = 0; layers.forEach((c) => { start.push(acc); acc += c; });
    const lp = [];
    for (let li = 0; li < layers.length - 1; li++) for (let a = 0; a < layers[li]; a++) for (let b = 0; b < layers[li + 1]; b++) if (Math.random() < 0.5) { const na = ns[start[li] + a], nb = ns[start[li + 1] + b]; lp.push(na.x, na.y, na.z, nb.x, nb.y, nb.z); }
    return { nodes: ns, lines: new Float32Array(lp) };
  }, []);
  useFrame((s, dt) => {
    const d = data.current; const t = s.clock.elapsedTime; const k = env(pulse.current, t);
    const learn = clamp((d.snapshots || 0) / 60, 0, 1); const active = Math.round(nodes.length * learn);
    if (grp.current) grp.current.rotation.y = Math.sin(t * 0.18) * 0.5;
    if (inst.current) {
      inst.current.count = nodes.length;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]; const lit = i < active;
        dummy.position.set(n.x, n.y, n.z);
        dummy.scale.setScalar((lit ? 0.12 * (0.9 + 0.25 * Math.sin(t * 3 + i)) : 0.06) * (1 + 0.4 * k));
        dummy.updateMatrix(); inst.current.setMatrixAt(i, dummy.matrix);
        inst.current.setColorAt(i, lit ? EMERALD : AMBER);
      }
      inst.current.instanceMatrix.needsUpdate = true; if (inst.current.instanceColor) inst.current.instanceColor.needsUpdate = true;
    }
  });
  return (
    <group ref={grp}>
      <lineSegments><bufferGeometry><bufferAttribute attach="attributes-position" args={[lines, 3]} /></bufferGeometry><lineBasicMaterial color="#FFB000" transparent opacity={0.1} /></lineSegments>
      <instancedMesh ref={inst} args={[undefined, undefined, 40]}><sphereGeometry args={[1, 10, 10]} /><meshBasicMaterial toneMapped={false} /></instancedMesh>
    </group>
  );
}

function RimLight({ data }) {
  const ref = useRef(); const tmp = useMemo(() => new THREE.Color(), []);
  useFrame(() => {
    const lat = data.current.lat;
    const c = lat == null ? CRIMSON : lat < 20 ? EMERALD : lat > 50 ? AMBER : tmp.copy(AMBER).lerp(EMERALD, (50 - lat) / 30);
    if (ref.current) { ref.current.color.lerp(c, 0.08); ref.current.intensity = lat == null ? 1.4 : lat < 20 ? 3.0 : lat > 50 ? 1.4 : 2.2; }
  });
  return <pointLight ref={ref} position={[3, 3, 4]} intensity={2.2} color="#FFB000" />;
}

const MODES = [
  { k: 'supernova', label: 'SUPERNOVA' }, { k: 'aurora', label: 'AURORA' },
  { k: 'helix', label: 'HELIX' }, { k: 'tunnel', label: 'TUNNEL' },
  { k: 'neural', label: 'NEURAL' }, { k: 'arcade', label: 'ARCADE' },
];

export default function CoreStage() {
  const [mode, setMode] = useState('supernova');
  const data = useRef({ positions: [], balance: null, pnlOpen: 0, lat: null, snapshots: 0, patternTime: null, trades: 0 });
  const pulse = useRef({ trigger: false, at: -99 });
  const learnPulse = useRef({ trigger: false, at: -99 });
  const lastLen = useRef(useTradingStore.getState().positions.length);
  const lastPattern = useRef(useTradingStore.getState().patternTime);
  const snap = (s) => ({ positions: s.positions, balance: s.balance, pnlOpen: s.pnlOpen, lat: s.latencyMs, snapshots: s.snapshots, patternTime: s.patternTime, trades: s.stats.total_trades });
  useEffect(() => useTradingStore.subscribe((s) => {
    data.current = snap(s);
    if (s.positions.length !== lastLen.current) { lastLen.current = s.positions.length; pulse.current.trigger = true; }
    if (s.patternTime !== lastPattern.current) { lastPattern.current = s.patternTime; learnPulse.current.trigger = true; }
  }), []);
  data.current = snap(useTradingStore.getState());

  const patternAdvice = useTradingStore((s) => s.patternAdvice);
  const snapshots = useTradingStore((s) => s.snapshots);
  const trades = useTradingStore((s) => s.stats.total_trades);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <span className="section-label">Reactor Core</span>
        <div className="flex gap-1.5 flex-wrap" style={{ position: 'relative', zIndex: 5 }}>
          {MODES.map((m) => <button key={m.k} className="core-tab" data-on={mode === m.k} onClick={() => setMode(m.k)}>{m.label}</button>)}
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden" style={{ minHeight: 460 }}>
        {mode === 'arcade' ? (
          <OnyxArcade />
        ) : (
          <Canvas camera={{ position: [0, 0, 3.4], fov: 62 }} dpr={[1, 2]} style={{ width: '100%', height: '100%' }}>
            <ambientLight intensity={0.5} />
            <RimLight data={data} />
            <pointLight position={[-3, -2, -3]} intensity={1.0} color="#00E676" />
            {mode === 'supernova' && <Supernova data={data} pulse={pulse} />}
            {mode === 'aurora' && <Aurora data={data} pulse={pulse} />}
            {mode === 'helix' && <Helix data={data} pulse={pulse} />}
            {mode === 'tunnel' && <Tunnel data={data} pulse={pulse} />}
            {mode === 'neural' && <Neural data={data} pulse={learnPulse} />}
          </Canvas>
        )}

        {mode === 'neural' && (
          <div className="absolute left-4 bottom-4 right-4 pointer-events-none" style={{ zIndex: 3 }}>
            <div className="micro" style={{ color: '#FFB000' }}>COGNITION · CLAUDE PATTERN ENGINE</div>
            <div style={{ fontSize: 13, color: '#e7d7b0', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
              LEARNED <b style={{ color: '#00E676' }}>{snapshots}</b> SAMPLES · {trades || 0} TRADES · CYCLE {Math.floor((trades || 0) / 10)} · NEXT IN {10 - ((trades || 0) % 10)}
            </div>
            {patternAdvice && <div className="micro" style={{ marginTop: 4, color: 'rgba(255,255,255,.5)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>▸ {String(patternAdvice).replace(/\n/g, ' · ').slice(0, 96)}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
