import React, { useState, useRef, useEffect } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

export const NEON = { void: '#000000', crimson: '#FF003C', green: '#00FF41', cyan: '#00F0FF' };

/* Glitchy RGB-split text. Pass `pulse` for a continuous neon breathe. */
export function GlitchText({ text, pulse = false, color, className = '', style = {} }) {
  return (
    <span
      className={`glx ${pulse ? 'neon-pulse' : ''} ${className}`}
      data-text={text}
      style={{ color, ...style }}
    >
      {text}
    </span>
  );
}

/* Holographic panel — tilts in 3D toward the cursor via Framer Motion. */
export function HoloPanel({ children, className = '', style = {}, tilt = 8 }) {
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const rotateX = useSpring(useTransform(my, [0, 1], [tilt, -tilt]), { stiffness: 150, damping: 16 });
  const rotateY = useSpring(useTransform(mx, [0, 1], [-tilt, tilt]), { stiffness: 150, damping: 16 });

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    mx.set((e.clientX - r.left) / r.width);
    my.set((e.clientY - r.top) / r.height);
  };
  const onLeave = () => { mx.set(0.5); my.set(0.5); };

  return (
    <motion.div
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ transformPerspective: 1000, rotateX, rotateY, ...style }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* Full holographic widget: tilt + header + body. */
export function Panel({ title, tag, children, bodyStyle = {}, className = '' }) {
  return (
    <HoloPanel className={`holo ${className}`}>
      <div className="holo-head">
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="dot" />
          <GlitchText text={title} />
        </span>
        {tag && <span className="holo-tag">{tag}</span>}
      </div>
      <div className="holo-body" style={bodyStyle}>{children}</div>
    </HoloPanel>
  );
}

/* Cyberpunk polygon button with a sweeping light reflection on hover. */
export function CyberButton({ children, onClick, color = NEON.cyan }) {
  return (
    <button className="cyber-btn" style={{ '--cb': color }} onClick={onClick}>
      <span>{children}</span>
    </button>
  );
}

/* Nav tab whose label rapidly re-types on hover. */
export function NavItem({ label, active, onClick }) {
  const [txt, setTxt] = useState(label);
  const timer = useRef(null);
  const type = () => {
    clearInterval(timer.current);
    let i = 0;
    setTxt('');
    timer.current = setInterval(() => {
      i += 1;
      setTxt(label.slice(0, i));
      if (i >= label.length) clearInterval(timer.current);
    }, 32);
  };
  const reset = () => { clearInterval(timer.current); setTxt(label); };
  useEffect(() => () => clearInterval(timer.current), []);
  return (
    <button className={`nav-item ${active ? 'on' : ''}`} onMouseEnter={type} onMouseLeave={reset} onClick={onClick}>
      {txt}<span className="caret">_</span>
    </button>
  );
}

/* Rapidly scrolling hex terminal, fading into the void top & bottom. */
function hexByte() { return Math.floor(Math.random() * 256).toString(16).toUpperCase().padStart(2, '0'); }
function hexLine() {
  const seg = () => Array.from({ length: 4 }, hexByte).join('');
  const tag = ['ACK', 'EXE', 'TX', 'RX', 'SIG', 'OK', 'SYN', '>>'][Math.floor(Math.random() * 8)];
  return `0x${hexByte()}${hexByte()}  ${seg()} ${seg()}  ${tag}`;
}
export function HexFeed() {
  const [lines, setLines] = useState(() => Array.from({ length: 22 }, hexLine));
  const box = useRef(null);
  useEffect(() => {
    const id = setInterval(() => {
      setLines((p) => {
        const n = [...p, hexLine()];
        return n.length > 90 ? n.slice(-90) : n;
      });
    }, 110);
    return () => clearInterval(id);
  }, []);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [lines]);
  return (
    <div className="hexfeed">
      <div className="hexfeed-inner" ref={box}>
        {lines.map((l, i) => <div className="hexline" key={i}>{l}</div>)}
      </div>
    </div>
  );
}
