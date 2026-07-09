import React, { useRef, useEffect, useState } from 'react';
import { NEON } from './effects';

const W = 340, H = 280;
const COLS = 8, ROWS = 3;
const A_W = 22, A_H = 16;

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

export default function InvadersGame() {
  const canvas = useRef(null);
  const g = useRef(null);
  const keys = useRef({});
  const playingRef = useRef(false);
  const raf = useRef(0);
  const [ui, setUi] = useState({ playing: false, over: false, win: false, score: 0 });

  function buildAliens() {
    const a = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        a.push({ x: 34 + c * 34, y: 26 + r * 28, alive: true, row: r });
    return a;
  }

  function newGame() {
    g.current = {
      player: { x: W / 2 - 14, y: H - 22, w: 28, h: 12, speed: 210 },
      bullets: [], aliens: buildAliens(),
      dir: 1, speed: 26, parts: [], shake: 0, lastShot: 0, wave: 1,
    };
  }

  function start() {
    newGame();
    playingRef.current = true;
    setUi({ playing: true, over: false, win: false, score: 0 });
  }

  function spawnParts(x, y, color) {
    const s = g.current;
    for (let i = 0; i < 12; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 30 + Math.random() * 90;
      s.parts.push({ x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, life: 0.45, max: 0.45, c: color });
    }
  }

  // keyboard
  useEffect(() => {
    const down = (e) => {
      keys.current[e.key] = true;
      if (playingRef.current && ['ArrowLeft', 'ArrowRight', 'ArrowUp', ' ', 'Spacebar'].includes(e.key)) e.preventDefault();
    };
    const up = (e) => { keys.current[e.key] = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  // game loop
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

  function step(dt) {
    const s = g.current;
    if (!s) return;

    // player
    if (keys.current['ArrowLeft']) s.player.x -= s.player.speed * dt;
    if (keys.current['ArrowRight']) s.player.x += s.player.speed * dt;
    s.player.x = Math.max(4, Math.min(W - s.player.w - 4, s.player.x));

    // shoot
    const space = keys.current[' '] || keys.current['Spacebar'];
    if (space && performance.now() - s.lastShot > 300) {
      s.bullets.push({ x: s.player.x + s.player.w / 2, y: s.player.y });
      s.lastShot = performance.now();
    }

    // bullets up
    s.bullets.forEach((b) => { b.y -= 400 * dt; });

    // alien swarm move
    const alive = s.aliens.filter((a) => a.alive);
    if (alive.length) {
      let minX = Infinity, maxX = -Infinity;
      alive.forEach((a) => { minX = Math.min(minX, a.x); maxX = Math.max(maxX, a.x + A_W); });
      const next = s.dir * s.speed * dt;
      let drop = false;
      if (maxX + next > W - 4 || minX + next < 4) { s.dir *= -1; drop = true; }
      alive.forEach((a) => { a.x += s.dir * s.speed * dt; if (drop) a.y += 12; });
    }

    // collisions
    s.bullets.forEach((b) => {
      for (const a of s.aliens) {
        if (a.alive && b.x > a.x && b.x < a.x + A_W && b.y > a.y && b.y < a.y + A_H) {
          a.alive = false; b.y = -999; s.shake = 6;
          spawnParts(a.x + A_W / 2, a.y + A_H / 2, a.row % 2 ? NEON.crimson : NEON.cyan);
          setUi((u) => ({ ...u, score: u.score + 10 }));
        }
      }
    });
    s.bullets = s.bullets.filter((b) => b.y > -10);

    // next wave
    if (s.aliens.every((a) => !a.alive)) {
      s.wave += 1; s.speed += 8; s.aliens = buildAliens();
    }

    // lose
    if (s.aliens.some((a) => a.alive && a.y + A_H >= s.player.y)) {
      playingRef.current = false;
      cancelAnimationFrame(raf.current);
      setUi((u) => ({ ...u, playing: false, over: true }));
      return;
    }

    // particles
    s.parts.forEach((p) => { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; });
    s.parts = s.parts.filter((p) => p.life > 0);
    if (s.shake > 0) s.shake -= 1;
  }

  function drawInvader(ctx, x, y, color) {
    ctx.fillStyle = color;
    for (let r = 0; r < INV.length; r++) {
      const row = INV[r];
      for (let c = 0; c < row.length; c++) {
        if (row[c] === '1') ctx.fillRect(x + c * 2, y + r * 2, 2, 2);
      }
    }
  }

  function draw(ctx) {
    const s = g.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const sh = s.shake > 0 ? Math.random() * 4 - 2 : 0;
    ctx.save();
    ctx.translate(sh, sh);

    // player cannon
    const p = s.player;
    ctx.fillStyle = NEON.green;
    ctx.shadowColor = NEON.green; ctx.shadowBlur = 8;
    ctx.fillRect(p.x, p.y + 4, p.w, p.h - 4);
    ctx.fillRect(p.x + p.w / 2 - 2, p.y, 4, 6);
    ctx.shadowBlur = 0;

    // bullets
    ctx.fillStyle = NEON.cyan;
    s.bullets.forEach((b) => ctx.fillRect(b.x - 1, b.y - 8, 2, 8));

    // aliens
    s.aliens.forEach((a) => { if (a.alive) drawInvader(ctx, a.x, a.y, a.row % 2 ? NEON.crimson : NEON.cyan); });

    // explosion particles
    s.parts.forEach((pt) => {
      ctx.globalAlpha = Math.max(0, pt.life / pt.max);
      ctx.fillStyle = pt.c;
      ctx.fillRect(pt.x - 1.5, pt.y - 1.5, 3, 3);
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  return (
    <div className="game-wrap">
      <div className="game-hud">
        <span>SCORE <b style={{ color: NEON.green }}>{ui.score}</b></span>
        <span>WAVE <b style={{ color: NEON.cyan }}>{g.current?.wave || 1}</b></span>
        <span style={{ color: '#5f7078' }}>← → MOVE · SPACE FIRE</span>
      </div>
      <canvas ref={canvas} width={W} height={H} className="game-canvas" />
      {!ui.playing && (
        <div className="game-overlay" onClick={start}>
          <div style={{ color: NEON.crimson, fontWeight: 800, letterSpacing: 4, textShadow: `0 0 12px ${NEON.crimson}` }}>
            {ui.over ? 'SYSTEM BREACH // GAME OVER' : 'PROVING GROUNDS'}
          </div>
          {ui.over && <div style={{ color: NEON.cyan, fontSize: 12 }}>FINAL SCORE: {ui.score}</div>}
          <div style={{ color: NEON.green, fontSize: 12, letterSpacing: 2, animation: 'blink 1s steps(1) infinite' }}>
            ▶ CLICK TO {ui.over ? 'RETRY' : 'INITIALIZE'}
          </div>
        </div>
      )}
    </div>
  );
}
