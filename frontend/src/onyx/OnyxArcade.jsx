import React, { useRef, useEffect, useState } from 'react';

/* PROVING GROUNDS — ONYX arcade. 960×540 logical, dpr-scaled, fills its
   stage responsively. Onyx & Amber palette, HUD inside the canvas. */
const W = 960, H = 540, HUD = 34;
const AMBER = '#FFB000', EMERALD = '#00E676', CRIMSON = '#FF3D00', BONE = '#e7d7b0';
const A_W = 33, A_H = 24, COLS = 12;
const HI_KEY = 'onyx_arcade_hi';

const INV_A = ['00100000100', '00010001000', '00111111100', '01101110110', '11111111111', '10111111101', '10100000101', '00011011000'];
const INV_B = ['00100000100', '10010001001', '10111111101', '11101110111', '11111111111', '01111111110', '00100000100', '01000000010'];

const loadHi = () => { try { return +(localStorage.getItem(HI_KEY) || 0); } catch { return 0; } };
const saveHi = (v) => { try { localStorage.setItem(HI_KEY, String(v)); } catch { /* ignore */ } };
const rowColor = (r, rows) => (r < 2 ? CRIMSON : r === rows - 1 ? AMBER : BONE);

export default function OnyxArcade() {
  const canvas = useRef(null);
  const g = useRef(null);
  const keys = useRef({});
  const playingRef = useRef(false);
  const raf = useRef(0);
  const crt = useRef(null);
  const stars = useRef([]);
  const [ui, setUi] = useState({ playing: false, over: false, score: 0, hi: loadHi(), wave: 1, lives: 3 });

  // build CRT overlay + starfield once
  useEffect(() => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const cx = c.getContext('2d');
    for (let y = HUD; y < H; y += 3) { cx.fillStyle = 'rgba(0,0,0,.16)'; cx.fillRect(0, y, W, 1); }
    const rg = cx.createRadialGradient(W / 2, H / 2, 140, W / 2, H / 2, 620);
    rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(0,0,0,.5)');
    cx.fillStyle = rg; cx.fillRect(0, 0, W, H);
    crt.current = c;
    const layers = [{ n: 30, s: 8, a: 0.12 }, { n: 34, s: 16, a: 0.22 }, { n: 26, s: 30, a: 0.38 }];
    const st = [];
    layers.forEach((L) => { for (let i = 0; i < L.n; i++) st.push({ x: Math.random() * W, y: HUD + Math.random() * (H - HUD), s: L.s, a: L.a }); });
    stars.current = st;
  }, []);

  function buildAliens(level) {
    const rows = Math.min(3 + Math.floor(level / 2), 5);
    const a = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < COLS; c++) a.push({ x: 70 + c * 68, y: 70 + r * 40, alive: true, row: r, rows });
    return a;
  }
  function newGame(level, score, lives) {
    g.current = {
      player: { x: W / 2 - 20, y: H - 46, w: 40, h: 20, speed: 520 },
      bullets: [], alienBullets: [], aliens: buildAliens(level), dir: 1, speed: 52 + level * 13,
      parts: [], rings: [], floats: [], shake: 0, flash: 0, muzzle: 0, thrust: [],
      lastShot: 0, lastAlienShot: 0, animT: 0, frame: 0, disp: score,
      level, score, lives, golden: null, nextGolden: performance.now() + 18000 + Math.random() * 12000,
    };
  }
  function start() { newGame(1, 0, 3); playingRef.current = true; setUi({ playing: true, over: false, score: 0, hi: loadHi(), wave: 1, lives: 3 }); }

  function burst(x, y, color, n = 16) {
    const s = g.current;
    for (let i = 0; i < n; i++) { const ang = Math.random() * Math.PI * 2, spd = 40 + Math.random() * 120; s.parts.push({ x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, life: 0.5, max: 0.5, c: color }); }
    s.rings.push({ x, y, r: 2, life: 0.28, max: 0.28, c: color });
  }

  useEffect(() => {
    const down = (e) => { const k = e.key.toLowerCase(); keys.current[k] = true; if (playingRef.current && ['arrowleft', 'arrowright', 'a', 'd', ' ', 'spacebar'].includes(k)) e.preventDefault(); };
    const up = (e) => { keys.current[e.key.toLowerCase()] = false; };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  useEffect(() => {
    if (!ui.playing) return undefined;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cv = canvas.current; cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let prev = performance.now();
    const loop = (now) => { const dt = Math.min(0.05, (now - prev) / 1000); prev = now; step(dt, now); draw(ctx); raf.current = requestAnimationFrame(loop); };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.playing]);

  function endGame() { const s = g.current; playingRef.current = false; cancelAnimationFrame(raf.current); const hi = Math.max(loadHi(), s.score); saveHi(hi); setUi((u) => ({ ...u, playing: false, over: true, hi })); }

  function step(dt, now) {
    const s = g.current; if (!s) return;
    s.animT += dt; if (s.animT > 0.5) { s.animT = 0; s.frame ^= 1; }
    s.disp += (s.score - s.disp) * 0.2;

    const p = s.player; const moving = keys.current['arrowleft'] || keys.current['a'] || keys.current['arrowright'] || keys.current['d'];
    if (keys.current['arrowleft'] || keys.current['a']) p.x -= p.speed * dt;
    if (keys.current['arrowright'] || keys.current['d']) p.x += p.speed * dt;
    p.x = Math.max(6, Math.min(W - p.w - 6, p.x));
    if (moving) s.thrust.push({ x: p.x + p.w / 2 + (Math.random() * 8 - 4), y: p.y + p.h, life: 0.25, max: 0.25 });

    if ((keys.current[' '] || keys.current['spacebar']) && now - s.lastShot > 260) { s.bullets.push({ x: p.x + p.w / 2, y: p.y }); s.lastShot = now; s.muzzle = 2; }
    s.bullets.forEach((b) => { b.y -= 950 * dt; });
    s.alienBullets.forEach((b) => { b.y += 480 * dt; });

    const alive = s.aliens.filter((a) => a.alive);
    if (alive.length) {
      let minX = Infinity, maxX = -Infinity; alive.forEach((a) => { minX = Math.min(minX, a.x); maxX = Math.max(maxX, a.x + A_W); });
      const sp = s.speed * (1 + (1 - alive.length / s.aliens.length) * 1.3);
      const nx = s.dir * sp * dt; let drop = false;
      if (maxX + nx > W - 8 || minX + nx < 8) { s.dir *= -1; drop = true; }
      alive.forEach((a) => { a.x += s.dir * sp * dt; if (drop) a.y += 26; });
      if (now - s.lastAlienShot > Math.max(360, 1100 - s.level * 90)) { const sh = alive[Math.floor(Math.random() * alive.length)]; s.alienBullets.push({ x: sh.x + A_W / 2, y: sh.y + A_H }); s.lastAlienShot = now; }
    }

    // golden tick
    if (!s.golden && now > s.nextGolden) s.golden = { x: -30, y: HUD + 22 };
    if (s.golden) { s.golden.x += 140 * dt; if (s.golden.x > W + 30) { s.golden = null; s.nextGolden = now + 18000 + Math.random() * 12000; } }

    // player bullets vs aliens + golden
    s.bullets.forEach((b) => {
      if (s.golden && b.x > s.golden.x - 18 && b.x < s.golden.x + 18 && b.y < s.golden.y + 10) { b.y = -999; s.score += 100; burst(s.golden.x, s.golden.y, AMBER, 22); s.floats.push({ x: s.golden.x, y: s.golden.y, t: '+100', c: AMBER, life: 0.6, max: 0.6 }); s.golden = null; s.nextGolden = now + 18000 + Math.random() * 12000; }
      for (const a of s.aliens) if (a.alive && b.x > a.x && b.x < a.x + A_W && b.y > a.y && b.y < a.y + A_H) { a.alive = false; b.y = -999; s.shake = 8; burst(a.x + A_W / 2, a.y + A_H / 2, rowColor(a.row, a.rows)); s.score += 10 * s.level; s.floats.push({ x: a.x + A_W / 2, y: a.y, t: '+' + (10 * s.level), c: EMERALD, life: 0.5, max: 0.5 }); }
    });
    s.bullets = s.bullets.filter((b) => b.y > -10);

    // alien bullets vs player
    for (const b of s.alienBullets) if (b.y > p.y && b.x > p.x && b.x < p.x + p.w) { b.y = H + 999; s.shake = 18; s.flash = 4; burst(p.x + p.w / 2, p.y, EMERALD, 20); s.lives -= 1; setUi((u) => ({ ...u, lives: s.lives })); if (s.lives <= 0) { endGame(); return; } }
    s.alienBullets = s.alienBullets.filter((b) => b.y < H + 10 && b.y > -10);

    if (s.aliens.every((a) => !a.alive)) { s.level += 1; s.aliens = buildAliens(s.level); s.speed = 52 + s.level * 13; s.bullets = []; s.alienBullets = []; s.dir = 1; setUi((u) => ({ ...u, wave: s.level })); }
    if (alive.some((a) => a.alive && a.y + A_H >= p.y)) { endGame(); return; }

    setUi((u) => (u.score !== s.score ? { ...u, score: s.score } : u));
    s.parts.forEach((q) => { q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt; }); s.parts = s.parts.filter((q) => q.life > 0);
    s.rings.forEach((r) => { r.life -= dt; r.r = 2 + (1 - r.life / r.max) * 12; }); s.rings = s.rings.filter((r) => r.life > 0);
    s.floats.forEach((f) => { f.y -= 48 * dt; f.life -= dt; }); s.floats = s.floats.filter((f) => f.life > 0);
    s.thrust.forEach((q) => { q.y += 60 * dt; q.life -= dt; }); s.thrust = s.thrust.filter((q) => q.life > 0);
    stars.current.forEach((st) => { st.y += st.s * dt; if (st.y > H) { st.y = HUD; st.x = Math.random() * W; } });
    if (s.shake > 0.2) s.shake *= 0.86; else s.shake = 0;
    if (s.flash > 0) s.flash -= 1; if (s.muzzle > 0) s.muzzle -= 1;
  }

  function glyph(ctx, x, y, color, frame) {
    ctx.fillStyle = color; const bmp = frame ? INV_B : INV_A;
    for (let r = 0; r < bmp.length; r++) { const row = bmp[r]; for (let c = 0; c < row.length; c++) if (row[c] === '1') ctx.fillRect(x + c * 3, y + r * 3, 3, 3); }
  }

  function draw(ctx) {
    const s = g.current;
    ctx.fillStyle = '#07080A'; ctx.fillRect(0, 0, W, H);
    // starfield
    stars.current.forEach((st) => { ctx.globalAlpha = st.a; ctx.fillStyle = BONE; ctx.fillRect(st.x, st.y, 1.5, 1.5); }); ctx.globalAlpha = 1;

    const sh = s.shake > 0 ? (Math.random() * 2 - 1) * s.shake : 0;
    ctx.save(); ctx.translate(sh, sh);

    if (s.flash > 0) { ctx.fillStyle = 'rgba(255,61,0,.14)'; ctx.fillRect(0, 0, W, H); }

    // golden tick
    if (s.golden) { ctx.fillStyle = AMBER; ctx.shadowColor = AMBER; ctx.shadowBlur = 14; ctx.beginPath(); ctx.ellipse(s.golden.x, s.golden.y, 16, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; }

    // aliens
    s.aliens.forEach((a) => { if (a.alive) glyph(ctx, a.x, a.y, rowColor(a.row, a.rows), s.frame); });

    // player ship (amber chevron)
    const p = s.player;
    ctx.fillStyle = AMBER; ctx.shadowColor = AMBER; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(p.x + p.w / 2, p.y); ctx.lineTo(p.x + p.w, p.y + p.h); ctx.lineTo(p.x + p.w * 0.66, p.y + p.h * 0.66); ctx.lineTo(p.x + p.w / 2, p.y + p.h); ctx.lineTo(p.x + p.w * 0.34, p.y + p.h * 0.66); ctx.lineTo(p.x, p.y + p.h); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
    if ((performance.now() / 125 | 0) % 2) { ctx.fillStyle = EMERALD; ctx.fillRect(p.x + p.w / 2 - 2, p.y + p.h - 2, 4, 3); }
    s.thrust.forEach((q) => { ctx.globalAlpha = q.life / q.max; ctx.fillStyle = EMERALD; ctx.fillRect(q.x, q.y, 2, 2); }); ctx.globalAlpha = 1;
    if (s.muzzle > 0) { ctx.fillStyle = '#fff'; ctx.fillRect(p.x + p.w / 2 - 2, p.y - 8, 4, 10); }

    // bullets
    ctx.fillStyle = AMBER; s.bullets.forEach((b) => ctx.fillRect(b.x - 1, b.y - 12, 2, 12));
    ctx.fillStyle = CRIMSON; s.alienBullets.forEach((b) => ctx.fillRect(b.x - 1, b.y, 2, 10));

    // rings + particles + floats
    s.rings.forEach((r) => { ctx.globalAlpha = Math.max(0, r.life / r.max); ctx.strokeStyle = r.c; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke(); });
    s.parts.forEach((q) => { ctx.globalAlpha = Math.max(0, q.life / q.max); ctx.fillStyle = q.c; ctx.fillRect(q.x - 1.5, q.y - 1.5, 3, 3); });
    ctx.globalAlpha = 1;
    s.floats.forEach((f) => { ctx.globalAlpha = Math.max(0, f.life / f.max); ctx.fillStyle = f.c; ctx.font = '10px monospace'; ctx.fillText(f.t, f.x - 8, f.y); }); ctx.globalAlpha = 1;

    ctx.restore();

    // CRT
    if (crt.current) ctx.drawImage(crt.current, 0, 0, W, H);

    // HUD (inside canvas, above everything)
    ctx.fillStyle = 'rgba(7,8,10,.9)'; ctx.fillRect(0, 0, W, HUD);
    ctx.strokeStyle = 'rgba(255,176,0,.3)'; ctx.beginPath(); ctx.moveTo(0, HUD); ctx.lineTo(W, HUD); ctx.stroke();
    ctx.font = '700 12px monospace'; ctx.textBaseline = 'middle';
    ctx.fillStyle = EMERALD; ctx.fillText('SCORE ' + String(Math.round(s.disp)).padStart(6, '0'), 16, HUD / 2);
    ctx.fillStyle = BONE; ctx.fillText('HI ' + String(ui.hi).padStart(6, '0'), 200, HUD / 2);
    ctx.fillStyle = AMBER; ctx.fillText('WAVE ' + String(s.level).padStart(2, '0'), 360, HUD / 2);
    for (let i = 0; i < 3; i++) { ctx.fillStyle = i < s.lives ? AMBER : 'rgba(255,255,255,.12)'; const lx = W - 90 + i * 26, ly = HUD / 2; ctx.beginPath(); ctx.moveTo(lx + 8, ly - 6); ctx.lineTo(lx + 16, ly + 6); ctx.lineTo(lx, ly + 6); ctx.closePath(); ctx.fill(); }
  }

  return (
    <div className="absolute inset-0">
      <canvas ref={canvas} style={{ width: '100%', height: '100%', display: 'block', imageRendering: 'pixelated' }} />
      {!ui.playing && (
        <div className="absolute inset-0 grid place-items-center cursor-pointer" style={{ background: 'rgba(7,8,10,.78)' }} onClick={start}>
          <div className="text-center px-8 py-6" style={{ border: '1px solid rgba(255,176,0,.25)' }}>
            <div className="micro" style={{ color: AMBER }}>REACTOR // ARCADE</div>
            <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '.35em', color: BONE, margin: '10px 0' }}>PROVING GROUNDS</div>
            {ui.over && <div style={{ color: CRIMSON, fontSize: 12, letterSpacing: 2, marginBottom: 8 }}>DRAWDOWN // SESSION TERMINATED · {ui.score}</div>}
            <div className="micro" style={{ color: 'rgba(255,255,255,.4)', marginBottom: 10 }}>← → / A D MOVE · SPACE FIRE</div>
            <div style={{ color: AMBER, fontSize: 13, letterSpacing: 2, animation: 'blink 1s steps(1) infinite' }}>▶ CLICK TO {ui.over ? 'RE-ARM' : 'INITIALIZE'}</div>
          </div>
        </div>
      )}
    </div>
  );
}
