import React, { useRef, useEffect, useMemo, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { MeshDistortMaterial } from '@react-three/drei';
import * as THREE from 'three';
import InvadersGame from '../algory/InvadersGame.jsx';
import { useTradingStore } from '../store/useTradingStore';

const EMERALD = new THREE.Color('#00E676');
const AMBER = new THREE.Color('#FFB000');
const CRIMSON = new THREE.Color('#FF3D00');

const targetColor = (lat, tmp) => {
  if (lat == null) return CRIMSON;
  if (lat < 20) return EMERALD;
  if (lat > 50) return AMBER;
  return tmp.copy(AMBER).lerp(EMERALD, (50 - lat) / 30);
};
const spinOf = (lat) => { const v = lat == null ? 999 : lat; return v < 20 ? 0.5 : v > 50 ? 0.13 : 0.34; };

/* ── Form 1: organic morphing lattice ── */
function MorphForm({ latRef }) {
  const mesh = useRef(); const mat = useRef(); const tmp = useRef(new THREE.Color());
  useFrame((s, dt) => {
    const lat = latRef.current; const v = lat == null ? 999 : lat;
    if (mesh.current) { mesh.current.rotation.y += spinOf(lat) * dt; mesh.current.rotation.x += spinOf(lat) * 0.5 * dt; }
    if (mat.current) {
      mat.current.color.lerp(targetColor(lat, tmp.current), 0.07);
      if (mat.current.emissive) mat.current.emissive.lerp(targetColor(lat, tmp.current), 0.07);
      mat.current.distort = v > 50 ? 0.6 : v < 20 ? 0.3 : 0.42;
      mat.current.speed = v < 20 ? 3.2 : v > 50 ? 1.0 : 2.0;
    }
  });
  return (
    <mesh ref={mesh}>
      <icosahedronGeometry args={[1.35, 4]} />
      <MeshDistortMaterial ref={mat} wireframe color="#00E676" emissive="#00E676" emissiveIntensity={1.3} roughness={0.35} metalness={0.4} distort={0.42} speed={2} />
    </mesh>
  );
}

/* ── Form 2: intricate torus knot ── */
function KnotForm({ latRef }) {
  const mesh = useRef(); const mat = useRef(); const tmp = useRef(new THREE.Color());
  useFrame((s, dt) => {
    const lat = latRef.current;
    if (mesh.current) { mesh.current.rotation.x += spinOf(lat) * dt; mesh.current.rotation.y += spinOf(lat) * 0.7 * dt; }
    if (mat.current) mat.current.color.lerp(targetColor(lat, tmp.current), 0.08);
  });
  return (
    <mesh ref={mesh}>
      <torusKnotGeometry args={[1, 0.34, 200, 30, 2, 3]} />
      <meshBasicMaterial ref={mat} wireframe color="#FFB000" transparent opacity={0.9} />
    </mesh>
  );
}

/* ── Form 3: spiralling particle vortex ── */
function VortexForm({ latRef }) {
  const ref = useRef(); const mat = useRef(); const tmp = useRef(new THREE.Color());
  const positions = useMemo(() => {
    const N = 1000; const a = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const t = i / N; const ang = t * Math.PI * 2 * 14; const r = 1.7 * (1 - t * 0.55);
      a[i * 3] = Math.cos(ang) * r; a[i * 3 + 1] = (t - 0.5) * 3.2; a[i * 3 + 2] = Math.sin(ang) * r;
    }
    return a;
  }, []);
  useFrame((s, dt) => {
    if (ref.current) { ref.current.rotation.y += spinOf(latRef.current) * 1.6 * dt; }
    if (mat.current) mat.current.color.lerp(targetColor(latRef.current, tmp.current), 0.06);
  });
  return (
    <points ref={ref}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
      <pointsMaterial ref={mat} size={0.045} color="#FFB000" sizeAttenuation transparent opacity={0.85} depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

/* ── Form 4: undulating grid field ── */
function FieldForm({ latRef }) {
  const ref = useRef(); const mat = useRef(); const tmp = useRef(new THREE.Color());
  const G = 28;
  const positions = useMemo(() => {
    const p = new Float32Array(G * G * 3); let k = 0;
    for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) { p[k * 3] = (i / (G - 1) - 0.5) * 4.2; p[k * 3 + 1] = 0; p[k * 3 + 2] = (j / (G - 1) - 0.5) * 4.2; k++; }
    return p;
  }, []);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    if (ref.current) {
      const arr = ref.current.geometry.attributes.position.array;
      for (let idx = 0; idx < G * G; idx++) {
        const x = arr[idx * 3], z = arr[idx * 3 + 2];
        arr[idx * 3 + 1] = Math.sin(x * 1.4 + t) * 0.28 + Math.cos(z * 1.4 + t * 0.8) * 0.28;
      }
      ref.current.geometry.attributes.position.needsUpdate = true;
      ref.current.rotation.y = t * 0.12;
    }
    if (mat.current) mat.current.color.lerp(targetColor(latRef.current, tmp.current), 0.06);
  });
  return (
    <points ref={ref} rotation={[-0.55, 0, 0]}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
      <pointsMaterial ref={mat} size={0.055} color="#00E676" sizeAttenuation transparent opacity={0.9} depthWrite={false} />
    </points>
  );
}

const MODES = [
  { k: 'morph', label: 'MORPH' },
  { k: 'knot', label: 'KNOT' },
  { k: 'vortex', label: 'VORTEX' },
  { k: 'field', label: 'FIELD' },
  { k: 'arcade', label: 'ARCADE' },
];

export default function CoreStage() {
  const [mode, setMode] = useState('morph');
  const latRef = useRef(useTradingStore.getState().latencyMs);
  useEffect(() => useTradingStore.subscribe((s) => { latRef.current = s.latencyMs; }), []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <span className="section-label">Reactor Core</span>
        <span className="micro">{mode === 'arcade' ? 'TACTICAL SIM' : 'LATENCY-BOUND'}</span>
      </div>

      <div className="relative flex-1" style={{ minHeight: 300 }}>
        {mode === 'arcade' ? (
          <div className="flex items-center justify-center h-full"><InvadersGame /></div>
        ) : (
          <Canvas camera={{ position: [0, 0, 4.2], fov: 55 }} dpr={[1, 2]} style={{ width: '100%', height: '100%' }}>
            <ambientLight intensity={0.5} />
            <pointLight position={[3, 3, 4]} intensity={2.2} color="#FFB000" />
            <pointLight position={[-3, -2, -3]} intensity={1.1} color="#00E676" />
            {mode === 'morph' && <MorphForm latRef={latRef} />}
            {mode === 'knot' && <KnotForm latRef={latRef} />}
            {mode === 'vortex' && <VortexForm latRef={latRef} />}
            {mode === 'field' && <FieldForm latRef={latRef} />}
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
