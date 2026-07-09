import React from 'react';

const K = { green: '#00ff41', crimson: '#FF003C', cyan: '#00F0FF', yellow: '#f0b429', faint: '#12191d', muted: '#5f7078' };

export default function LiveChart({ candles = [], sessions = {}, positions = [] }) {
  const sessRow = (
    <div className="sess">
      {[{ n: 'TOKYO', k: 'tokyo', h: '00-09' }, { n: 'LONDON', k: 'london', h: '07-16' }, { n: 'NY', k: 'ny', h: '13-22' }].map((s) => (
        <span key={s.k} className="sess-b" style={{
          background: sessions[s.k] ? K.green : 'transparent',
          color: sessions[s.k] ? '#000' : K.muted,
          borderColor: sessions[s.k] ? K.green : K.faint,
          boxShadow: sessions[s.k] ? `0 0 10px ${K.green}66` : 'none',
        }}>
          {s.n}<em>{s.h}</em>
        </span>
      ))}
    </div>
  );

  if (!candles || candles.length < 2) {
    return (
      <div>
        {sessRow}
        <div className="empty" style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          AWAITING CANDLE DATA
          <span style={{ opacity: 0.5, fontSize: 10 }}>تأكد من تشغيل الـ Agent على MT5</span>
        </div>
      </div>
    );
  }

  const last = candles.slice(-60);
  const W = 660, H = 250, padL = 6, padR = 56, padT = 10, padB = 10;
  const cw = (W - padL - padR) / last.length;
  const bodyW = Math.max(1.6, cw - 1.4);
  const allH = last.flatMap((c) => [c.h, c.l]);
  const lo = Math.min(...allH), hi = Math.max(...allH);
  const range = Math.max(hi - lo, 0.1);
  const Y = (v) => padT + ((hi - v) / range) * (H - padT - padB);
  const Cx = (i) => padL + i * cw + (cw - bodyW) / 2;
  const midX = (i) => Cx(i) + bodyW / 2;
  const lc = last[last.length - 1];
  const pLabels = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * range);

  return (
    <div>
      {sessRow}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {pLabels.map((p, i) => {
          const y = Y(p);
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={K.faint} strokeWidth="0.5" strokeDasharray="3 3" />
              <text x={W - padR + 4} y={y + 3} fontSize="8" fill={K.muted} fontFamily="monospace">{p.toFixed(2)}</text>
            </g>
          );
        })}
        {last.map((c, i) => {
          const bull = c.c >= c.o;
          const col = bull ? K.green : K.crimson;
          const mx = midX(i);
          const bTop = Y(Math.max(c.o, c.c));
          const bBot = Y(Math.min(c.o, c.c));
          const bH = Math.max(1, bBot - bTop);
          return (
            <g key={i}>
              <line x1={mx} y1={Y(c.h)} x2={mx} y2={bTop} stroke={col} strokeWidth="1" />
              <rect x={Cx(i)} y={bTop} width={bodyW} height={bH} fill={col} />
              <line x1={mx} y1={bBot} x2={mx} y2={Y(c.l)} stroke={col} strokeWidth="1" />
            </g>
          );
        })}
        {positions.map((p, i) => {
          if (p.price_open == null) return null;
          const y = Y(p.price_open);
          if (y < padT || y > H - padB) return null;
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={K.yellow} strokeWidth="1" strokeDasharray="5 3" />
              <text x={W - padR + 4} y={y + 3} fontSize="8" fill={K.yellow} fontFamily="monospace" fontWeight="bold">{Number(p.price_open).toFixed(2)}</text>
            </g>
          );
        })}
        {(() => {
          const y = Y(lc.c);
          return (
            <g>
              <rect x={W - padR} y={y - 7} width={padR} height={14} fill={lc.c >= lc.o ? K.green : K.crimson} />
              <text x={W - padR + 3} y={y + 4} fontSize="8" fill="#000" fontFamily="monospace" fontWeight="900">{lc.c?.toFixed(2)}</text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}
