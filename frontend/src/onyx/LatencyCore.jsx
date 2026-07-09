import React, { useRef, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useTradingStore } from '../store/useTradingStore';

const EMERALD = new THREE.Color('#00E676');
const AMBER = new THREE.Color('#FFB000');
const CRIMSON = new THREE.Color('#FF3D00');

/* Rotation speed + color bound directly to real ping latency:
   <20ms  → smooth emerald spin
   20-50  → amber/emerald blend
   >50ms  → sluggish amber pulse
   null   → crimson (link down) */
function Node({ latRef }) {
  const grp = useRef();
  const mat = useRef();
  const tmp = useRef(new THREE.Color());

  useFrame((s, dt) => {
    const lat = latRef.current;
    const val = lat == null ? 999 : lat;
    const speed = val < 20 ? 0.7 : val > 50 ? 0.14 : 0.42;
    if (grp.current) { grp.current.rotation.y += speed * dt; grp.current.rotation.x += speed * 0.4 * dt; }

    const t = s.clock.elapsedTime;
    const pulse = val > 50 ? Math.sin(t * 6) * 0.5 + 0.5 : 0;
    let target;
    if (lat == null) target = CRIMSON;
    else if (val < 20) target = EMERALD;
    else if (val > 50) target = AMBER;
    else { tmp.current.copy(AMBER).lerp(EMERALD, (50 - val) / 30); target = tmp.current; }

    if (mat.current) {
      mat.current.color.lerp(target, 0.1);
      mat.current.opacity = 0.55 + pulse * 0.4;
    }
    if (grp.current) grp.current.scale.setScalar(1 + pulse * 0.07);
  });

  return (
    <group ref={grp}>
      <mesh>
        <icosahedronGeometry args={[1.35, 2]} />
        <meshBasicMaterial ref={mat} wireframe transparent color="#00E676" />
      </mesh>
      <mesh scale={0.55}>
        <icosahedronGeometry args={[1, 0]} />
        <meshBasicMaterial wireframe transparent opacity={0.25} color="#FFB000" />
      </mesh>
    </group>
  );
}

export default function LatencyCore() {
  const latRef = useRef(useTradingStore.getState().latencyMs);
  // subscribe ONCE; updates the ref without re-rendering the canvas, and
  // unsubscribes on unmount (no leaked listeners).
  useEffect(() => useTradingStore.subscribe((s) => { latRef.current = s.latencyMs; }), []);

  return (
    <Canvas camera={{ position: [0, 0, 4.2], fov: 55 }} dpr={[1, 2]} style={{ width: '100%', height: '100%' }}>
      <Node latRef={latRef} />
    </Canvas>
  );
}
