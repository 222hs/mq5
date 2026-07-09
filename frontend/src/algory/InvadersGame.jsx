import React, { useRef, useEffect, useState } from 'react';
import { NEON } from './effects';

const W = 420, H = 320;
const A_W = 22, A_H = 16;
const HISCORE_KEY = 'algory_invaders_hi';

/* Classic 11×8 invader bitmap. */
const INV = [
  '00100000100',
  '00010001000',
  '00111111100',
  '01101110110',
  '11111111111',
  '10111111101',
  '10100000101',
  '00011011000',
];

function loadHi() { try { return +(localStorage.getItem(HISCORE_KEY) || 0); } catch { return 0; } }
function saveHi(v) { try { localStorage.setItem(HISCORE_KEY, String(v)); } catch { /* ignore */ } }

export default function InvadersGame() {
  const canvas = useRef(null);
  const g = useRef(null);
  const keys = useRef({});
  const playingRef = useRef(false);
  const raf = useRef(0);
  const [ui, setUi] = useState({ playing: false, over: false, score: 0, lives: 3, level: 1, hi: loadHi() });

  function buildAliens(level) {
    const cols = 9, rows = Math.min(3 + Math.floor(level / 2), 5);
    const a = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        a.push({ x: 30 + c * 40, y: 24 + r * 26, alive: true, row: r });
    return a;
  }

  function newGame(level = 1, score = 0, lives = 3) {
    g.current = {
      player: { x: W / 2 - 14, y: H - 22, w: 28, h: 12, speed: 240 },
      bullets: [], alienBullets: [], aliens: buildAliens(level),
      dir: 1, speed: 24 + level * 6, parts: [], shake: 0, flash: 0,
      lastShot: 0, lastAlienShot: 0, level, score, lives,
    };
  }

  function start() {
    newGame(1, 0, 3);
    playingRef.current = true;
    setUi({ playing: true, over: false, score: 0, lives: 3, level: 1, hi: loadHi() });
  }

  function spawnParts(x, y, color, n = 12) {
    const s = g.current;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 30 + Math.random() * 110;
      s.parts.push({ x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, life: 0.5, max: 0.5, c: color });
    }
  }

  // keyboard (WASD + arrows + space)
  useEffect(() => {
    const down = (e) => {
      const k = e.key.toLowerCase();
      keys.current[k] = true;
      if (playingRef.current && ['arrowleft', 'arrowright', 'a', 'd', ' ', 'spacebar'].includes(k)) e.preventDefault();
    };
    const up = (e) => { keys.current[e.key.toLowerCase()] = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  // main loop
  useEffect(() => {
    if (!ui.playing) return;
    const ctx = canvas.current.getContext('2d');
    let prev = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      step(dt);
      draw(ctx);
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.playing]);

  function endGame() {
    const s = g.current;
    playingRef.current = false;
    cancelAnimationFrame(raf.current);
    const hi = Math.max(loadHi(), s.score);
    saveHi(hi);
    setUi((u) => ({ ...u, playing: false, over: true, hi }));
  }

  function step(dt) {
    const s = g.current;
    if (!s) return;
    const now = performance.now();

    // player
    if (keys.current['arrowleft'] || keys.current['a']) s.player.x -= s.player.speed * dt;
    if (keys.current['arrowright'] || keys.current['d']) s.player.x += s.player.speed * dt;
    s.player.x = Math.max(4, Math.min(W - s.player.w - 4, s.player.x));

    // shoot
    if ((keys.current[' '] || keys.current['spacebar']) && now - s.lastShot > 280) {
      s.bullets.push({ x: s.player.x + s.player.w / 2, y: s.player.y });
      s.lastShot = now;
    }
    s.bullets.forEach((b) => { b.y -= 420 * dt; });

    // alien swarm
    const alive = s.aliens.filter((a) => a.alive);
    if (alive.length) {
      let minX = Infinity, maxX = -Infinity;
      alive.forEach((a) => { minX = Math.min(minX, a.x); maxX = Math.max(maxX, a.x + A_W); });
      const speed = s.speed * (1 + (1 - alive.length / s.aliens.length) * 1.2); // speeds up as they thin out
      const next = s.dir * speed * dt;
      let drop = false;
      if (maxX + next > W - 4 || minX + next < 4) { s.dir *= -1; drop = true; }
      alive.forEach((a) => { a.x += s.dir * speed * dt; if (drop) a.y += 12; });

      // alien fire
      if (now - s.lastAlienShot > Math.max(360, 1100 - s.level * 90)) {
        const shooter = alive[Math.floor(Math.random() * alive.length)];
        s.alienBullets.push({ x: shooter.x + A_W / 2, y: shooter.y + A_H });
        s.lastAlienShot = now;
      }
    }
    s.alienBullets.forEach((b) => { b.y += 220 * dt; });

    // player bullets vs aliens
    s.bullets.forEach((b) => {
      for (const a of s.aliens) {
        if (a.alive && b.x > a.x && b.x < a.x + A_W && b.y > a.y && b.y < a.y + A_H) {
          a.alive = false; b.y = -999; s.shake = 6;
          spawnParts(a.x + A_W / 2, a.y + A_H / 2, a.row % 2 ? NEON.crimson : NEON.cyan);
          s.score += 10 * s.level;
          setUi((u) => ({ ...u, score: s.score }));
        }
      }
    });
    s.bullets = s.bullets.filter((b) => b.y > -10);

    // alien bullets vs player
    for (const b of s.alienBullets) {
      if (b.y > s.player.y && b.x > s.player.x && b.x < s.player.x + s.player.w) {
        b.y = H + 999; s.shake = 12; s.flash = 6;
        spawnParts(s.player.x + s.player.w / 2, s.player.y, NEON.green, 18);
        s.lives -= 1;
        setUi((u) => ({ ...u, lives: s.lives }));
        if (s.lives <= 0) { endGame(); return; }
      }
    }
    s.alienBullets = s.alienBullets.filter((b) => b.y < H + 10 && b.y > -10);

    // next level
    if (s.aliens.every((a) => !a.alive)) {
      s.level += 1;
      newLevelKeepStats(s);
      setUi((u) => ({ ...u, level: s.level }));
    }

    // aliens reached the floor
    if (alive.some((a) => a.alive && a.y + A_H >= s.player.y)) { endGame(); return; }

    // particles
    s.parts.forEach((p) => { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; });
    s.parts = s.parts.filter((p) => p.life > 0);
    if (s.shake > 0) s.shake -= 1;
    if (s.flash > 0) s.flash -= 1;
  }

  function newLevelKeepStats(s) {
    s.aliens = buildAliens(s.level);
    s.speed = 24 + s.level * 6;
    s.bullets = []; s.alienBullets = [];
    s.dir = 1;
  }

  function drawInvader(ctx, x, y, color) {
    ctx.fillStyle = color;
    for (let r = 0; r < INV.length; r++) {
      const row = INV[r];
      for (let c = 0; c < row.length; c++) if (row[c] === '1') ctx.fillRect(x + c * 2, y + r * 2, 2, 2);
    }
  }

  function draw(ctx) {
    const s = g.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    if (s.flash > 0) { ctx.fillStyle = 'rgba(255,0,60,0.18)'; ctx.fillRect(0, 0, W, H); }

    const sh = s.shake > 0 ? Math.random() * 5 - 2.5 : 0;
    ctx.save();
    ctx.translate(sh, sh);

    // player ship
    const p = s.player;
    ctx.fillStyle = NEON.green; ctx.shadowColor = NEON.green; ctx.shadowBlur = 9;
    ctx.fillRect(p.x, p.y + 5, p.w, p.h - 5);
    ctx.fillRect(p.x + p.w / 2 - 6, p.y + 2, 12, 5);
    ctx.fillRect(p.x + p.w / 2 - 2, p.y - 3, 4, 6);
    ctx.shadowBlur = 0;

    // bullets
    ctx.fillStyle = NEON.cyan;
    s.bullets.forEach((b) => ctx.fillRect(b.x - 1, b.y - 9, 2, 9));
    ctx.fillStyle = NEON.crimson;
    s.alienBullets.forEach((b) => ctx.fillRect(b.x - 1, b.y, 2, 8));

    // aliens
    s.aliens.forEach((a) => { if (a.alive) drawInvader(ctx, a.x, a.y, a.row % 2 ? NEON.crimson : NEON.cyan); });

    // particles
    s.parts.forEach((pt) => { ctx.globalAlpha = Math.max(0, pt.life / pt.max); ctx.fillStyle = pt.c; ctx.fillRect(pt.x - 1.5, pt.y - 1.5, 3, 3); });
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  const cur = g.current;
  return (
    <div className="game-wrap">
      <div className="game-hud">
        <span>SCORE <b style={{ color: NEON.green }}>{ui.score}</b></span>
        <span>HI <b style={{ color: NEON.cyan }}>{ui.hi}</b></span>
        <span>LVL <b style={{ color: NEON.cyan }}>{ui.level}</b></span>
        <span>{'▲'.repeat(Math.max(0, cur?.lives ?? ui.lives))}<span style={{ color: '#33424a' }}>{'▲'.repeat(Math.max(0, 3 - (cur?.lives ?? ui.lives)))}</span></span>
      </div>
      <canvas ref={canvas} width={W} height={H} className="game-canvas" />
      {!ui.playing && (
        <div className="game-overlay" onClick={start}>
          <div style={{ color: NEON.crimson, fontWeight: 800, letterSpacing: 4, textShadow: `0 0 12px ${NEON.crimson}` }}>
            {ui.over ? 'SYSTEM BREACH // GAME OVER' : 'PROVING GROUNDS'}
          </div>
          {ui.over && <div style={{ color: NEON.cyan, fontSize: 12 }}>SCORE {ui.score} · HI {ui.hi} · LVL {ui.level}</div>}
          <div style={{ color: '#5f7078', fontSize: 10, letterSpacing: 1 }}>← → / A D MOVE · SPACE FIRE</div>
          <div style={{ color: NEON.green, fontSize: 12, letterSpacing: 2, animation: 'blink 1s steps(1) infinite' }}>
            ▶ CLICK TO {ui.over ? 'RETRY' : 'INITIALIZE'}
          </div>
        </div>
      )}
    </div>
  );
}
