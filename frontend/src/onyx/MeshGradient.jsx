import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/* Full-screen fragment shader — a very slow, subtle onyx→amber mesh
   gradient. Fills clip space directly (camera-independent). */
const vertex = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const fragment = /* glsl */`
  precision highp float;
  uniform float uTime;
  varying vec2 vUv;
  // cheap flowing value field
  float field(vec2 p, float t){
    float a = sin(p.x * 2.4 + t) * 0.5 + 0.5;
    float b = sin(p.y * 1.9 - t * 0.7) * 0.5 + 0.5;
    float c = sin((p.x + p.y) * 1.3 + t * 0.4) * 0.5 + 0.5;
    return (a * b + c) / 2.0;
  }
  void main(){
    vec2 uv = vUv;
    float t = uTime * 0.045;
    float m = smoothstep(0.25, 0.95, field(uv * 2.0, t));
    vec3 onyx  = vec3(0.027, 0.031, 0.039);
    vec3 amber = vec3(1.0, 0.69, 0.0);
    vec3 col = mix(onyx, amber, m * 0.10);           // amber stays a whisper
    col += amber * pow(m, 3.0) * 0.02;
    float d = distance(uv, vec2(0.5, 0.42));
    col *= smoothstep(1.15, 0.15, d);                 // soft vignette
    gl_FragColor = vec4(col, 1.0);
  }
`;

function Plane() {
  const ref = useRef();
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  useFrame((s) => { if (ref.current) ref.current.material.uniforms.uTime.value = s.clock.elapsedTime; });
  return (
    <mesh ref={ref}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial vertexShader={vertex} fragmentShader={fragment} uniforms={uniforms} depthTest={false} depthWrite={false} />
    </mesh>
  );
}

export default function MeshGradient() {
  return (
    <Canvas
      style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}
      gl={{ antialias: false, powerPreference: 'low-power' }}
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 1] }}
    >
      <Plane />
    </Canvas>
  );
}
