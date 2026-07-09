import React, { useRef, useEffect, useMemo, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import Custodian from './Custodian.jsx';
import { useTradingStore } from '../store/useTradingStore';

/* ── Shared signal layer — one organism; amber idle, green/red = money ── */
const AMBER = new THREE.Color('#FFB000'), EMERALD = new THREE.Color('#00E676'), CRIMSON = new THREE.Color('#FF3D00');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const bal01 = (b) => clamp((Math.log10(Math.max(b || 1, 1)) - 2) / 3, 0, 1);
const sysTf = (pnl, bal) => clamp((pnl || 0) / (0.01 * Math.max(bal || 1, 1)), -1, 1);
const posTf = (p, bal) => clamp((p || 0) / (0.005 * Math.max(bal || 1, 1)), -1, 1);
const ddf = (pnl, bal) => clamp(Math.max(0, -(pnl || 0)) / (0.02 * Math.max(bal || 1, 1)), 0, 1);
const colFor = (t, out) => (t < 0 ? out.copy(AMBER).lerp(CRIMSON, -t) : t > 0 ? out.copy(AMBER).lerp(EMERALD, t) : out.copy(AMBER));
const hash01 = (s) => { let h = 0; const str = s || ''; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0; return (h % 1000) / 1000; };
const env = (pulse, t) => { if (pulse.trigger) { pulse.at = t; pulse.trigger = false; } return Math.exp(-(t - pulse.at) / 0.22); };
const X_AXIS = new THREE.Vector3(1, 0, 0);

/* ── FORM 1 · SENTINEL — one orbiting satellite per open position ── */
function Sentinel({ data, pulse }) {
  const grp = useRef(); const nucleus = useRef(); const nmat = useRef(); const shell = useRef();
  const inst = useRef(); const dummy = useMemo(() => new THREE.Object3D(), []); const tmp = useMemo(() => new THREE.Color(), []);
  useFrame((s, dt) => {
    const d = data.current; const t = s.clock.elapsedTime; const k = env(pulse.current, t);
    const b01 = bal01(d.balance); const sysT = sysTf(d.pnlOpen, d.balance); const dd = ddf(d.pnlOpen, d.balance);
    const idle = d.positions.length === 0;
    if (nucleus.current) nucleus.current.scale.setScalar(0.8 + 0.5 * b01 + 0.06 * Math.sin(t * 1.2) + 0.35 * k);
    if (nmat.current) { nmat.current.emissive.lerp(colFor(sysT, tmp), 0.08); nmat.current.emissiveIntensity = (0.35 + 0.9 * Math.abs(sysT) + 1.5 * k) * (1 - 0.3 * dd * Math.random()); }
    if (shell.current) shell.current.rotation.y -= 0.15 * dt;
    if (inst.current) {
      const n = Math.min(d.positions.length, 32); inst.current.count = n;
      for (let i = 0; i < n; i++) {
        const p = d.positions[i]; const pt = posTf(p.profit, d.balance);
        const r = 1.35 + 0.22 * i; const tilt = i * 0.42; const phase = hash01(p.symbol) * Math.PI * 2;
        const dir = pt < 0 ? -1 : 1; const a = phase + dir * (0.5 + 0.9 * Math.abs(pt)) * t;
        dummy.position.set(Math.cos(a) * r, 0, Math.sin(a) * r).applyAxisAngle(X_AXIS, tilt);
        dummy.position.x += (Math.random() - 0.5) * 0.1 * dd; dummy.position.y += (Math.random() - 0.5) * 0.1 * dd;
        const sc = 0.7 + 0.6 * Math.abs(pt) + 0.3 * b01; dummy.scale.setScalar(sc); dummy.updateMatrix();
        inst.current.setMatrixAt(i, dummy.matrix); inst.current.setColorAt(i, colFor(pt, tmp));
      }
      inst.current.instanceMatrix.needsUpdate = true; if (inst.current.instanceColor) inst.current.instanceColor.needsUpdate = true;
    }
    if (grp.current) grp.current.rotation.y += (idle ? 0.05 : 0.12) * dt;
  });
  return (
    <group ref={grp}>
      <mesh ref={nucleus}><icosahedronGeometry args={[0.55, 1]} /><meshStandardMaterial ref={nmat} flatShading color="#0B0C0F" emissive="#FFB000" emissiveIntensity={0.5} /></mesh>
      <mesh ref={shell} scale={1.18}><icosahedronGeometry args={[0.55, 1]} /><meshBasicMaterial wireframe transparent opacity={0.22} color="#FFB000" /></mesh>
      <instancedMesh ref={inst} args={[undefined, undefined, 32]}><octahedronGeometry args={[0.09, 0]} /><meshBasicMaterial toneMapped={false} /></instancedMesh>
    </group>
  );
}

/* ── FORM 2 · ARMILLARY — one gyro ring per open position ── */
function Armillary({ data, pulse }) {
  const rings = useRef([]); const core = useRef(); const cmat = useRef(); const tmp = useMemo(() => new THREE.Color(), []);
  useFrame((s, dt) => {
    const d = data.current; const t = s.clock.elapsedTime; const k = env(pulse.current, t);
    const b01 = bal01(d.balance); const sysT = sysTf(d.pnlOpen, d.balance); const dd = ddf(d.pnlOpen, d.balance);
    const n = Math.min(d.positions.length, 12);
    if (core.current) core.current.scale.setScalar(0.22 + 0.3 * b01 + 0.5 * k);
    if (cmat.current) cmat.current.color.lerp(colFor(sysT, tmp), 0.08);
    rings.current.forEach((ring, i) => {
      if (!ring) return;
      if (i < n || (n === 0 && i === 0)) {
        ring.visible = true; const p = d.positions[i]; const pt = p ? posTf(p.profit, d.balance) : 0;
        const dir = pt < 0 ? -1 : 1; ring.rotation.y += (0.6 + 1.4 * Math.abs(pt)) * dir * dt;
        const tx = pt >= 0 ? 0.15 * i : 0.15 * i - pt * 0.9; ring.rotation.x += (tx - ring.rotation.x) * Math.min(1, dt * 4);
        ring.rotation.z = 0.4 * Math.sin(t * 2 + i) * (dd + (pt < 0 ? 0.3 : 0));
        ring.scale.setScalar((1 + 0.15 * b01) * (1 + 0.06 * k));
        ring.material.color.lerp(p ? colFor(pt, tmp) : AMBER, 0.08); ring.material.opacity = 0.85 - 0.25 * dd * (Math.sin(t * 18 + i) * 0.5 + 0.5);
      } else ring.visible = false;
    });
  });
  return (
    <group>
      <mesh ref={core}><sphereGeometry args={[1, 16, 16]} /><meshBasicMaterial ref={cmat} color="#FFB000" /></mesh>
      {Array.from({ length: 12 }).map((_, i) => (
        <mesh key={i} ref={(el) => (rings.current[i] = el)}><torusGeometry args={[0.7 + 0.28 * i, 0.018, 8, 96]} /><meshBasicMaterial transparent color="#FFB000" opacity={0.85} /></mesh>
      ))}
    </group>
  );
}

/* ── FORM 3 · SPIRES — one skyline spire per open position ── */
function Spires({ data, pulse }) {
  const inst = useRef(); const dummy = useMemo(() => new THREE.Object3D(), []); const tmp = useMemo(() => new THREE.Color(), []); const scan = useRef();
  useFrame((s, dt) => {
    const d = data.current; const t = s.clock.elapsedTime; const k = env(pulse.current, t);
    const b01 = bal01(d.balance); const dd = ddf(d.pnlOpen, d.balance); const flick = (Math.floor(t * 12) % 2) === 0;
    const n = Math.min(d.positions.length, 32);
    if (inst.current) {
      inst.current.count = n; const cross = 0.09 * (0.8 + 0.6 * b01);
      for (let i = 0; i < n; i++) {
        const p = d.positions[i]; const pt = posTf(p.profit, d.balance);
        let h = 0.15 + 1.3 * Math.abs(pt); if (dd > 0 && flick) h *= 1 + (Math.random() - 0.5) * 0.2 * dd;
        h *= (i === n - 1 ? (1 + 0.5 * k) : 1);
        const x = (i - (n - 1) / 2) * 0.28; const y = pt >= 0 ? h / 2 : -h / 2;
        dummy.position.set(x, y, 0); dummy.scale.set(cross / 0.09, h, cross / 0.09); dummy.updateMatrix();
        inst.current.setMatrixAt(i, dummy.matrix); inst.current.setColorAt(i, colFor(pt, tmp));
      }
      inst.current.instanceMatrix.needsUpdate = true; if (inst.current.instanceColor) inst.current.instanceColor.needsUpdate = true;
    }
    if (scan.current) { scan.current.visible = n === 0; scan.current.position.x = ((t % 3) / 3 - 0.5) * 4; }
  });
  return (
    <group rotation={[0.35, 0.5, 0]}>
      <gridHelper args={[4, 16, '#FFB000', '#1A1C20']} />
      <instancedMesh ref={inst} args={[undefined, undefined, 32]}><boxGeometry args={[0.09, 1, 0.09]} /><meshBasicMaterial toneMapped={false} /></instancedMesh>
      <mesh ref={scan} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.02, 4]} /><meshBasicMaterial color="#FFB000" transparent opacity={0.25} /></mesh>
    </group>
  );
}

/* ── FORM 4 · DEEPSCAN — sonar disc, one blip per open position ── */
function Deepscan({ data, pulse }) {
  const sweep = useRef(); const blips = useRef([]); const tmp = useMemo(() => new THREE.Color(), []); const grp = useRef();
  useFrame((s, dt) => {
    const d = data.current; const t = s.clock.elapsedTime;
    const b01 = bal01(d.balance); const sysT = sysTf(d.pnlOpen, d.balance); const dd = ddf(d.pnlOpen, d.balance);
    const n = Math.min(d.positions.length, 24);
    if (grp.current) grp.current.scale.setScalar(0.8 + 0.5 * b01);
    if (sweep.current) sweep.current.rotation.z += (0.8 + 0.6 * Math.abs(sysT) + 1.2 * dd) * dt;
    const sa = sweep.current ? sweep.current.rotation.z : 0;
    blips.current.forEach((pin, i) => {
      if (!pin) return;
      if (i < n) {
        pin.visible = true; const p = d.positions[i]; const pt = posTf(p.profit, d.balance);
        const th = hash01(p.symbol) * Math.PI * 2; const rho = 0.4 + 1.0 * Math.abs(pt);
        const h = 0.12 + 0.5 * Math.abs(pt);
        pin.position.set(Math.cos(th) * rho, Math.sin(th) * rho, pt >= 0 ? h / 2 : -h / 2);
        pin.scale.set(1, 1, h / 0.5);
        const ignite = 0.35 + 0.65 * Math.pow(Math.max(0, Math.cos(th - sa)), 8);
        pin.material.color.lerp(colFor(pt, tmp), 0.1); pin.material.opacity = ignite;
      } else pin.visible = false;
    });
  });
  return (
    <group ref={grp} rotation={[-0.96, 0, 0]}>
      {[0.4, 0.8, 1.2, 1.6].map((r, i) => (
        <mesh key={i}><torusGeometry args={[r, 0.006, 6, 96]} /><meshBasicMaterial color="#FFB000" transparent opacity={0.22} /></mesh>
      ))}
      <group ref={sweep}><mesh position={[0.8, 0, 0]}><boxGeometry args={[1.6, 0.012, 0.012]} /><meshBasicMaterial color="#FFB000" transparent opacity={0.55} /></mesh></group>
      {Array.from({ length: 24 }).map((_, i) => (
        <mesh key={i} ref={(el) => (blips.current[i] = el)}><cylinderGeometry args={[0.02, 0.02, 0.5, 6]} /><meshBasicMaterial transparent color="#FFB000" opacity={0.6} /></mesh>
      ))}
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
  { k: 'sentinel', label: 'SENTINEL' }, { k: 'armillary', label: 'ARMILLARY' },
  { k: 'spires', label: 'SPIRES' }, { k: 'deepscan', label: 'DEEPSCAN' }, { k: 'arcade', label: 'ARCADE' },
];

export default function CoreStage() {
  const [mode, setMode] = useState('sentinel');
  const data = useRef({ positions: [], balance: null, pnlOpen: 0, lat: null });
  const pulse = useRef({ trigger: false, at: -99 });
  const lastLen = useRef(useTradingStore.getState().positions.length);
  useEffect(() => useTradingStore.subscribe((s) => {
    data.current = { positions: s.positions, balance: s.balance, pnlOpen: s.pnlOpen, lat: s.latencyMs };
    if (s.positions.length !== lastLen.current) { lastLen.current = s.positions.length; pulse.current.trigger = true; }
  }), []);
  // seed initial
  data.current = { positions: useTradingStore.getState().positions, balance: useTradingStore.getState().balance, pnlOpen: useTradingStore.getState().pnlOpen, lat: useTradingStore.getState().latencyMs };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <span className="section-label">Reactor Core</span>
        <div className="flex gap-1.5 flex-wrap" style={{ position: 'relative', zIndex: 5 }}>
          {MODES.map((m) => <button key={m.k} className="core-tab" data-on={mode === m.k} onClick={() => setMode(m.k)}>{m.label}</button>)}
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden" style={{ minHeight: 320 }}>
        {mode === 'arcade' ? (
          <Custodian />
        ) : (
          <Canvas camera={{ position: [0, 0, 4.6], fov: 55 }} dpr={[1, 2]} style={{ width: '100%', height: '100%' }}>
            <ambientLight intensity={0.5} />
            <RimLight data={data} />
            <pointLight position={[-3, -2, -3]} intensity={1.0} color="#00E676" />
            {mode === 'sentinel' && <Sentinel data={data} pulse={pulse} />}
            {mode === 'armillary' && <Armillary data={data} pulse={pulse} />}
            {mode === 'spires' && <Spires data={data} pulse={pulse} />}
            {mode === 'deepscan' && <Deepscan data={data} pulse={pulse} />}
          </Canvas>
        )}
      </div>
    </div>
  );
}
