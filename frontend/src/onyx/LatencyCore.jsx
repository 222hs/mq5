import React, { useRef, useEffect, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { MeshDistortMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { useTradingStore } from '../store/useTradingStore';

const EMERALD = new THREE.Color('#00E676');
const AMBER = new THREE.Color('#FFB000');
const CRIMSON = new THREE.Color('#FF3D00');

/* Organic morphing lattice — warps + breathes continuously. Distortion
   intensity, spin and color all bound to real ping latency:
   <20ms → calm emerald · 20-50 → amber blend · >50ms → agitated amber ·
   null → crimson (link down). */
function Morph({ latRef }) {
  const mesh = useRef();
  const mat = useRef();
  const tmp = useRef(new THREE.Color());

  useFrame((s, dt) => {
    const lat = latRef.current;
    const val = lat == null ? 999 : lat;
    const spin = val < 20 ? 0.5 : val > 50 ? 0.13 : 0.34;
    if (mesh.current) {
      mesh.current.rotation.y += spin * dt;
      mesh.current.rotation.x += spin * 0.5 * dt;
    }
    let target;
    if (lat == null) target = CRIMSON;
    else if (val < 20) target = EMERALD;
    else if (val > 50) target = AMBER;
    else target = tmp.current.copy(AMBER).lerp(EMERALD, (50 - val) / 30);

    if (mat.current) {
      mat.current.color.lerp(target, 0.07);
      if (mat.current.emissive) mat.current.emissive.lerp(target, 0.07);
      // agitate the surface when latency is high
      mat.current.distort = val > 50 ? 0.6 : val < 20 ? 0.3 : 0.42;
      mat.current.speed = val < 20 ? 3.2 : val > 50 ? 1.0 : 2.0;
    }
  });

  return (
    <mesh ref={mesh}>
      <icosahedronGeometry args={[1.35, 4]} />
      <MeshDistortMaterial
        ref={mat}
        wireframe
        color="#00E676"
        emissive="#00E676"
        emissiveIntensity={1.3}
        roughness={0.35}
        metalness={0.4}
        distort={0.42}
        speed={2}
      />
    </mesh>
  );
}

/* An offset orbital ring of amber particles for depth. */
function Ring() {
  const ref = useRef();
  const positions = useMemo(() => {
    const N = 140;
    const a = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      const r = 2.15 + Math.sin(t * 7) * 0.06;
      a[i * 3] = Math.cos(t) * r;
      a[i * 3 + 1] = Math.sin(t * 3) * 0.22;
      a[i * 3 + 2] = Math.sin(t) * r;
    }
    return a;
  }, []);
  useFrame((s) => { if (ref.current) { ref.current.rotation.y = s.clock.elapsedTime * 0.16; ref.current.rotation.z = s.clock.elapsedTime * 0.05; } });
  return (
    <points ref={ref}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
      <pointsMaterial size={0.032} color="#FFB000" transparent opacity={0.75} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

export default function LatencyCore() {
  const latRef = useRef(useTradingStore.getState().latencyMs);
  useEffect(() => useTradingStore.subscribe((s) => { latRef.current = s.latencyMs; }), []);

  return (
    <Canvas camera={{ position: [0, 0, 4], fov: 55 }} dpr={[1, 2]} style={{ width: '100%', height: '100%' }}>
      <ambientLight intensity={0.5} />
      <pointLight position={[3, 3, 4]} intensity={2.2} color="#FFB000" />
      <pointLight position={[-3, -2, -3]} intensity={1.1} color="#00E676" />
      <Morph latRef={latRef} />
      <Ring />
    </Canvas>
  );
}
