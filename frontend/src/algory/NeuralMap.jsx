import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

/* Soft round glow sprite so particles read as neon dots, not squares. */
function makeSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function Brain() {
  const group = useRef();
  const points = useRef();

  const { positions, colors, lines, sprite } = useMemo(() => {
    const N = 74;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const cyan = new THREE.Color('#00F0FF');
    const red = new THREE.Color('#FF003C');
    const verts = [];
    for (let i = 0; i < N; i++) {
      const r = 1.5 + Math.random() * 1.0;
      const theta = Math.acos(2 * Math.random() - 1);
      const phi = Math.random() * Math.PI * 2;
      const x = r * Math.sin(theta) * Math.cos(phi);
      const y = r * Math.sin(theta) * Math.sin(phi);
      const z = r * Math.cos(theta);
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      const c = Math.random() > 0.5 ? cyan : red;
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      verts.push(new THREE.Vector3(x, y, z));
    }
    const lp = [];
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        if (verts[i].distanceTo(verts[j]) < 1.15) {
          lp.push(verts[i].x, verts[i].y, verts[i].z, verts[j].x, verts[j].y, verts[j].z);
        }
      }
    }
    return { positions: pos, colors: col, lines: new Float32Array(lp), sprite: makeSprite() };
  }, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (group.current) group.current.rotation.y += 0.0016;
    if (points.current) {
      points.current.material.size = 0.15 + Math.sin(t * 2) * 0.045;
      points.current.material.opacity = 0.78 + Math.sin(t * 3) * 0.2;
    }
  });

  return (
    <group ref={group}>
      <points ref={points}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          vertexColors
          transparent
          map={sprite}
          alphaTest={0.02}
          size={0.16}
          sizeAttenuation
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[lines, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#00F0FF" transparent opacity={0.16} blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>
    </group>
  );
}

export default function NeuralMap() {
  return (
    <Canvas camera={{ position: [0, 0, 5.2], fov: 60 }} dpr={[1, 2]} style={{ width: '100%', height: '100%' }}>
      <color attach="background" args={['#000000']} />
      <Brain />
      <OrbitControls
        enableZoom={false}
        enablePan={false}
        autoRotate
        autoRotateSpeed={0.6}
        enableDamping
        dampingFactor={0.08}
      />
    </Canvas>
  );
}
