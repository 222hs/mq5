import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

const GREEN = '#00ff41', CRIMSON = '#FF003C', CYAN = '#00F0FF', YELLOW = '#f0b429', DIM = '#33424a';
const MAX_SAT = 14;

/* The reactive core. All visuals are driven by live bot data held in dataRef. */
function Core({ dataRef }) {
  const core = useRef();
  const wire = useRef();
  const ringA = useRef();
  const ringB = useRef();
  const sats = useRef();
  const coreMat = useRef();
  const wireMat = useRef();
  const ringAMat = useRef();

  const satData = useMemo(
    () => Array.from({ length: MAX_SAT }, (_, i) => ({
      r: 2.0 + (i % 4) * 0.28,
      speed: 0.35 + (i % 5) * 0.12,
      phase: (i / MAX_SAT) * Math.PI * 2,
      yamp: 0.3 + (i % 3) * 0.25,
    })),
    []
  );

  const tmpColor = useMemo(() => new THREE.Color(), []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const d = dataRef.current || {};
    const online = !!d.online;
    const profitPos = (d.profit ?? 0) >= 0;
    const winRate = d.winRate ?? 0;
    const velocity = Math.min(d.velocity ?? 0, 30);

    const stateColor = !online ? DIM : profitPos ? GREEN : CRIMSON;
    const pulseRate = 1 + velocity / 6;

    if (core.current) {
      core.current.scale.setScalar(1 + Math.sin(t * pulseRate) * 0.07);
      core.current.rotation.y = t * 0.3;
      core.current.rotation.x = t * 0.15;
    }
    if (coreMat.current) {
      tmpColor.set(stateColor);
      coreMat.current.color.lerp(tmpColor, 0.08);
      coreMat.current.emissive.lerp(tmpColor, 0.08);
      coreMat.current.emissiveIntensity = 1.1 + Math.sin(t * pulseRate) * 0.4;
    }
    if (wire.current) { wire.current.rotation.y = -t * 0.22; wire.current.rotation.z = t * 0.1; }
    if (wireMat.current) { tmpColor.set(online ? CYAN : DIM); wireMat.current.color.lerp(tmpColor, 0.08); }

    // ring A tint reflects win-rate quality (green >=50, crimson below)
    if (ringA.current) ringA.current.rotation.z = t * 0.5;
    if (ringAMat.current) { tmpColor.set(winRate >= 50 ? GREEN : CRIMSON); ringAMat.current.color.lerp(tmpColor, 0.06); }
    if (ringB.current) { ringB.current.rotation.x = t * 0.33; ringB.current.rotation.y = t * 0.12; }

    // satellites = live open positions
    if (sats.current) {
      const n = Math.min(d.positions ?? 0, MAX_SAT);
      sats.current.children.forEach((m, i) => {
        if (i < n) {
          m.visible = true;
          const sd = satData[i];
          const a = t * sd.speed + sd.phase;
          m.position.set(Math.cos(a) * sd.r, Math.sin(a * 1.3) * sd.yamp, Math.sin(a) * sd.r);
        } else {
          m.visible = false;
        }
      });
    }
  });

  return (
    <group>
      <mesh ref={core}>
        <icosahedronGeometry args={[1.0, 1]} />
        <meshStandardMaterial ref={coreMat} color={GREEN} emissive={GREEN} emissiveIntensity={1.3} roughness={0.25} metalness={0.7} flatShading />
      </mesh>
      <mesh ref={wire}>
        <icosahedronGeometry args={[1.65, 1]} />
        <meshBasicMaterial ref={wireMat} color={CYAN} wireframe transparent opacity={0.32} />
      </mesh>
      <mesh ref={ringA}>
        <torusGeometry args={[2.05, 0.018, 8, 96]} />
        <meshBasicMaterial ref={ringAMat} color={CYAN} transparent opacity={0.7} />
      </mesh>
      <mesh ref={ringB} rotation={[Math.PI / 2.4, 0, 0]}>
        <torusGeometry args={[2.4, 0.012, 8, 96]} />
        <meshBasicMaterial color={YELLOW} transparent opacity={0.4} />
      </mesh>
      <group ref={sats}>
        {Array.from({ length: MAX_SAT }).map((_, i) => (
          <mesh key={i}>
            <sphereGeometry args={[0.075, 12, 12]} />
            <meshBasicMaterial color={YELLOW} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function Stars() {
  const ref = useRef();
  const geo = useMemo(() => {
    const N = 420;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = 6 + Math.random() * 9;
      const th = Math.acos(2 * Math.random() - 1);
      const ph = Math.random() * Math.PI * 2;
      pos[i * 3] = r * Math.sin(th) * Math.cos(ph);
      pos[i * 3 + 1] = r * Math.sin(th) * Math.sin(ph);
      pos[i * 3 + 2] = r * Math.cos(th);
    }
    return pos;
  }, []);
  useFrame((s) => { if (ref.current) ref.current.rotation.y = s.clock.elapsedTime * 0.02; });
  return (
    <points ref={ref}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[geo, 3]} /></bufferGeometry>
      <pointsMaterial size={0.03} color="#2a3b44" sizeAttenuation transparent opacity={0.85} />
    </points>
  );
}

/* Props: online, botRunning, profit, equity, winRate, positions, velocity — all live. */
export default function CommandCore(props) {
  const dataRef = useRef(props);
  dataRef.current = props;
  const profitPos = (props.profit ?? 0) >= 0;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas camera={{ position: [0, 0, 6.3], fov: 55 }} dpr={[1, 2]}>
        <color attach="background" args={['#000000']} />
        <ambientLight intensity={0.45} />
        <pointLight position={[4, 4, 4]} intensity={1.3} color={CYAN} />
        <pointLight position={[-4, -2, -3]} intensity={0.9} color={CRIMSON} />
        <Stars />
        <Core dataRef={dataRef} />
        <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.5} enableDamping dampingFactor={0.08} />
      </Canvas>
      {/* live readout overlaid dead-center (pointer-events off so drag still works) */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <div style={{ fontSize: 9, letterSpacing: 3, color: '#5f7078' }}>EQUITY</div>
        <div style={{
          fontSize: 24, fontWeight: 'bold',
          color: profitPos ? GREEN : CRIMSON, textShadow: '0 0 16px currentColor',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {props.equity != null ? '$' + Number(props.equity).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '--'}
        </div>
        <div style={{ fontSize: 9, letterSpacing: 2, marginTop: 5, color: props.online ? GREEN : CRIMSON }}>
          {props.online ? '◉ CORE ONLINE' : '◎ CORE OFFLINE'}
        </div>
      </div>
    </div>
  );
}
