import React, { useRef, useEffect, useState } from 'react';

/* CUSTODIAN — reactor containment. Rotate the shield arc (mouse / A-D):
   absorb EMERALD credits into the core, BLOCK CRIMSON liabilities.
   Full 960x540, fills its 16:9 stage responsively. */
const W = 960, H = 540, CX = 480, CY = 270;
const AMBER = '#FFB000', EMERALD = '#00E676', CRIMSON = '#FF3D00', BONE = '#e7d7b0';
const HALF = 0.68; // 39° half-arc
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

export default function Custodian() {
  const canvas = useRef(null);
  const g = useRef(null);
  const keys = useRef({});
  const raf = useRef(0);
  const crt = useRef(null);
  const [ui, setUi] = useState({ state: 'menu', score: 0, over: false });

  useEffect(() => {
    const c = document.createElement('canvas'); c.width = W; c.height = H; const cx = c.getContext('2d');
    for (let y = 0; y < H; y += 4) { cx.fillStyle = 'rgba(255,255,255,.03)'; cx.fillRect(0, y, W, 1); }
    const rg = cx.createRadialGradient(CX, CY, 60, CX, CY, 560);
    rg.addColorStop(0, 'rgba(255,176,0,.04)'); rg.addColorStop(1, 'rgba(0,0,0,0)'); cx.fillStyle = rg; cx.fillRect(0, 0, W, H);
    crt.current = c;
  }, []);

  function reset() {
    g.current = { shieldAng: 0, shieldVel: 0, targetAng: 0, flux: [], parts: [], floats: [],
      integrity: 100, score: 0, combo: 1, t: 0, shake: 0, freeze: 0, timescale: 1, flash: 0,
      nextSpawn: 0, regime: 0, banner: 0, bannerTxt: '' };
  }
  function start() { reset(); g.current.state = 'run'; setUi({ state: 'run', score: 0, over: false }); }

  useEffect(() => {
    const down = (e) => { const k = e.key.toLowerCase(); keys.current[k] = true; if (['arrowleft', 'arrowright', 'a', 'd', 'r'].includes(k)) e.preventDefault(); if (k === 'r' && g.current?.state === 'dead') start(); };
    const up = (e) => { keys.current[e.key.toLowerCase()] = false; };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    reset(); g.current.state = 'menu';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cv = canvas.current; cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let prev = performance.now();
    const loop = (now) => { const dt = Math.min(0.05, (now - prev) / 1000); prev = now; step(dt); draw(ctx); raf.current = requestAnimationFrame(loop); };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onMove = (e) => {
    const r = canvas.current.getBoundingClientRect();
    const mx = (e.clientX - r.left) / r.width * W, my = (e.clientY - r.top) / r.height * H;
    if (g.current) g.current.targetAng = Math.atan2(my - CY, mx - CX);
  };

  function spawnParts(x, y, color, n, spd, toCore = false) {
    const s = g.current;
    for (let i = 0; i < n; i++) { const ang = Math.random() * Math.PI * 2, v = spd[0] + Math.random() * (spd[1] - spd[0]);
      let vx = Math.cos(ang) * v, vy = Math.sin(ang) * v;
      if (toCore) { const a2 = Math.atan2(CY - y, CX - x); vx = Math.cos(a2) * v; vy = Math.sin(a2) * v; }
      s.parts.push({ x, y, vx, vy, life: 0.5, max: 0.5, c: color }); }
  }

  function step(dt) {
    const s = g.current; if (!s || s.state !== 'run') return;
    if (s.freeze > 0) { s.freeze -= dt * 1000; return; }
    const ts = s.timescale; const d = dt * ts;
    s.t += d;
    if (s.timescale < 1) { s.timescale = Math.min(1, s.timescale + dt * 2.5); }

    // shield toward target (mouse) or keys
    if (keys.current['a'] || keys.current['arrowleft']) s.targetAng -= 3.6 * dt;
    if (keys.current['d'] || keys.current['arrowright']) s.targetAng += 3.6 * dt;
    const delta = angDiff(s.targetAng, s.shieldAng);
    s.shieldVel += (delta * 14 - s.shieldVel * 8) * dt; s.shieldVel = Math.max(-4.5, Math.min(4.5, s.shieldVel));
    s.shieldAng += s.shieldVel * dt;

    // regime banner
    const reg = Math.floor(s.t / 30);
    if (reg !== s.regime) { s.regime = reg; if (reg > 0) { s.banner = 0.9; s.bannerTxt = 'VOLATILITY REGIME ' + ['I', 'II', 'III', 'IV', 'V'][Math.min(reg, 4)]; } }
    if (s.banner > 0) s.banner -= dt;

    // spawn
    s.nextSpawn -= d * 1000;
    if (s.nextSpawn <= 0) {
      s.nextSpawn = Math.max(380, 1100 - s.t * 8);
      const ang = Math.random() * Math.PI * 2; const speed = Math.min(220, 90 + s.t * 1.4);
      const crimsonP = Math.min(0.65, 0.45 + s.t / 90 * 0.2); const bad = Math.random() < crimsonP;
      const splitter = bad && s.t > 30 && Math.random() < 0.15;
      const spiral = s.t > 60 && Math.random() < 0.2 ? (Math.random() < 0.5 ? 0.35 : -0.35) : 0;
      s.flux.push({ x: CX + Math.cos(ang) * 560, y: CY + Math.sin(ang) * 560, ang, speed, bad, splitter, spiral, rot: 0 });
    }

    // move + collide
    for (const f of s.flux) {
      if (f.dead) continue;
      if (f.spiral) f.ang += f.spiral * dt;
      const a = Math.atan2(CY - f.y, CX - f.x) + (f.spiral || 0) * 0.3;
      f.x += Math.cos(a) * f.speed * d; f.y += Math.sin(a) * f.speed * d; f.rot += 3 * d;
      const dx = f.x - CX, dy = f.y - CY; const r = Math.hypot(dx, dy); const fa = Math.atan2(dy, dx);
      // shield block band
      if (r >= 122 && r <= 138 && Math.abs(angDiff(fa, s.shieldAng)) < HALF) {
        if (f.bad) {
          f.dead = true; s.score += 10 * s.combo; s.combo += 1; s.shake = Math.max(s.shake, 3);
          spawnParts(f.x, f.y, CRIMSON, 18, [180, 320]);
          splitterFire(s, f); // splits into 2 if it was a splitter
          if (r <= 128) { s.timescale = 0.3; s.floats.push({ x: f.x, y: f.y, t: 'CLOSE CALL +50', c: AMBER, life: 0.8, max: 0.8 }); s.score += 50; } // last-tick clutch
        } else { f.dead = true; s.combo = 1; spawnParts(f.x, f.y, AMBER, 6, [60, 140]); }
        continue;
      }
      if (r < 40) {
        if (f.bad) { f.dead = true; s.integrity -= 20; s.combo = 1; s.shake = 18; s.freeze = 45; s.flash = 0.16; spawnParts(f.x, f.y, CRIMSON, 30, [120, 300]); if (s.integrity <= 0) { die(); return; } }
        else { f.dead = true; s.score += 25 * s.combo; s.combo += 1; s.integrity = Math.min(100, s.integrity + 2); spawnParts(CX, CY, EMERALD, 12, [40, 120], true); }
      }
    }
    s.flux = s.flux.filter((f) => !f.dead && Math.hypot(f.x - CX, f.y - CY) < 640);

    s.parts.forEach((p) => { p.x += p.vx * d; p.y += p.vy * d; p.life -= dt; }); s.parts = s.parts.filter((p) => p.life > 0);
    s.floats.forEach((f) => { f.y -= 30 * dt; f.life -= dt; }); s.floats = s.floats.filter((f) => f.life > 0);
    if (s.shake > 0.2) s.shake *= 0.85; else s.shake = 0;
    if (s.flash > 0) s.flash -= dt;
  }

  function splitterFire(s, f) {
    if (!f.splitter) return false;
    for (const off of [-0.61, 0.61]) { const a = f.ang + off; s.flux.push({ x: f.x, y: f.y, ang: a, speed: f.speed, bad: true, splitter: false, spiral: 0, rot: 0 }); }
    return true;
  }
  function die() { const s = g.current; s.state = 'dead'; setUi({ state: 'dead', score: s.score, over: true }); }

  function draw(ctx) {
    const s = g.current;
    ctx.fillStyle = '#07080A'; ctx.fillRect(0, 0, W, H);
    if (crt.current) ctx.drawImage(crt.current, 0, 0, W, H);

    const sh = s.shake > 0 ? (Math.random() * 2 - 1) * s.shake : 0;
    ctx.save(); ctx.translate(sh, sh);
    if (s.flash > 0) { ctx.fillStyle = `rgba(255,61,0,${(s.flash / 0.16 * 0.18).toFixed(3)})`; ctx.fillRect(0, 0, W, H); }

    // flux
    for (const f of s.flux) {
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot);
      if (f.bad && f.splitter) { ctx.strokeStyle = CRIMSON; ctx.lineWidth = 2; ctx.shadowColor = CRIMSON; ctx.shadowBlur = 8; ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * 16, Math.sin(a) * 16); } ctx.closePath(); ctx.stroke(); }
      else if (f.bad) { ctx.fillStyle = CRIMSON; ctx.shadowColor = CRIMSON; ctx.shadowBlur = 10; ctx.beginPath(); for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; const rr = i % 2 ? 8 : 13; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); }
      else { ctx.fillStyle = EMERALD; ctx.shadowColor = EMERALD; ctx.shadowBlur = 10; ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(8, 0); ctx.lineTo(0, 8); ctx.lineTo(-8, 0); ctx.closePath(); ctx.fill(); }
      ctx.restore();
    }
    ctx.shadowBlur = 0;

    // shield arc + combo echoes
    const moving = Math.abs(s.shieldVel) > 0.4;
    ctx.strokeStyle = moving ? '#FFC940' : AMBER; ctx.lineWidth = 5; ctx.shadowColor = AMBER; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(CX, CY, 130, s.shieldAng - HALF, s.shieldAng + HALF); ctx.stroke();
    if (s.combo >= 5) { ctx.strokeStyle = EMERALD; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(CX, CY, 136, s.shieldAng - HALF, s.shieldAng + HALF); ctx.stroke(); }
    if (s.combo >= 10) { ctx.beginPath(); ctx.arc(CX, CY, 142, s.shieldAng - HALF, s.shieldAng + HALF); ctx.stroke(); }
    ctx.shadowBlur = 0;

    // core hexagon (breathing)
    const rate = s.integrity < 40 ? 3.6 : 1.8; const bs = 1 + 0.03 * Math.sin(s.t * Math.PI * 2 / rate);
    const crimFlick = s.integrity < 40 && Math.random() < 0.08;
    ctx.strokeStyle = crimFlick ? CRIMSON : AMBER; ctx.lineWidth = 2; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 18;
    ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 - Math.PI / 2; ctx[i ? 'lineTo' : 'moveTo'](CX + Math.cos(a) * 34 * bs, CY + Math.sin(a) * 34 * bs); } ctx.closePath(); ctx.stroke(); ctx.shadowBlur = 0;
    // integrity glyphs
    const glyphs = Math.ceil(s.integrity / 25); ctx.fillStyle = AMBER;
    for (let i = 0; i < glyphs; i++) { const gy = CY - 8 + (i % 2) * 10, gx = CX - 8 + Math.floor(i / 2) * 16; ctx.beginPath(); ctx.moveTo(gx, gy + 5); ctx.lineTo(gx + 4, gy - 3); ctx.lineTo(gx + 8, gy + 5); ctx.closePath(); ctx.fill(); }

    // particles + floats
    s.parts.forEach((p) => { ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.c; ctx.fillRect(p.x - 1, p.y - 1, 2, 2); }); ctx.globalAlpha = 1;
    s.floats.forEach((f) => { ctx.globalAlpha = Math.max(0, f.life / f.max); ctx.fillStyle = f.c; ctx.font = '700 12px monospace'; ctx.fillText(f.t, f.x - 30, f.y); }); ctx.globalAlpha = 1;
    ctx.restore();

    // HUD
    ctx.font = '700 13px monospace'; ctx.textBaseline = 'top';
    ctx.fillStyle = EMERALD; ctx.fillText('SCORE ' + String(s.score).padStart(6, '0'), 18, 16);
    ctx.fillStyle = AMBER; ctx.fillText('×' + s.combo, 200, 16);
    ctx.fillStyle = BONE; ctx.fillText('INTEGRITY', 18, 38);
    const bars = 10; for (let i = 0; i < bars; i++) { ctx.fillStyle = i < Math.round(s.integrity / 10) ? (s.integrity < 40 ? CRIMSON : AMBER) : 'rgba(255,255,255,.1)'; ctx.fillRect(110 + i * 14, 38, 10, 12); }
    if (s.banner > 0) { ctx.globalAlpha = Math.min(1, s.banner * 2); ctx.fillStyle = AMBER; ctx.font = '700 20px monospace'; ctx.textAlign = 'center'; ctx.fillText(s.bannerTxt, CX, 80); ctx.textAlign = 'left'; ctx.globalAlpha = 1; }
  }

  const overlay = ui.state !== 'run';
  return (
    <div className="absolute inset-0 grid place-items-center overflow-hidden" onMouseMove={onMove}>
      <canvas ref={canvas} style={{ height: '100%', width: 'auto', aspectRatio: '16 / 9', maxWidth: '100%', display: 'block', border: '1px solid rgba(255,176,0,.12)' }} />
      {overlay && (
        <div className="absolute inset-0 grid place-items-center cursor-pointer" style={{ background: 'rgba(7,8,10,.72)' }} onClick={start}>
          <div className="text-center px-8 py-6" style={{ border: '1px solid rgba(255,176,0,.25)' }}>
            <div className="micro" style={{ color: AMBER }}>REACTOR // CONTAINMENT</div>
            <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '.35em', color: BONE, margin: '10px 0' }}>CUSTODIAN</div>
            {ui.over && <div style={{ color: CRIMSON, fontSize: 12, letterSpacing: 2, marginBottom: 8 }}>LIQUIDATED · SCORE {ui.score}</div>}
            <div className="micro" style={{ color: 'rgba(255,255,255,.45)', marginBottom: 4 }}>MOUSE / A-D · ROTATE SHIELD</div>
            <div className="micro" style={{ color: EMERALD, marginBottom: 2 }}>◆ ABSORB CREDITS</div>
            <div className="micro" style={{ color: CRIMSON, marginBottom: 10 }}>✦ BLOCK LIABILITIES</div>
            <div style={{ color: AMBER, fontSize: 13, letterSpacing: 2, animation: 'blink 1s steps(1) infinite' }}>▶ CLICK TO {ui.over ? 'RE-CAPITALIZE' : 'ENGAGE'}</div>
          </div>
        </div>
      )}
    </div>
  );
}
