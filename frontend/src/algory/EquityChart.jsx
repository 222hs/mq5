import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { NEON } from './effects';

const SERIES = [
  { key: 'alpha', color: NEON.crimson, label: 'ALPHA-9' },
  { key: 'beta', color: NEON.green, label: 'BETA-7' },
  { key: 'gamma', color: NEON.cyan, label: 'GAMMA-3' },
];

function seed() {
  const data = [];
  const v = { alpha: 100, beta: 100, gamma: 100 };
  for (let i = 0; i < 42; i++) {
    v.alpha += (Math.random() - 0.42) * 6;
    v.beta += (Math.random() - 0.48) * 4;
    v.gamma += (Math.random() - 0.45) * 5;
    data.push({ t: i, alpha: +v.alpha.toFixed(1), beta: +v.beta.toFixed(1), gamma: +v.gamma.toFixed(1) });
  }
  return data;
}

function CyberTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'rgba(0,0,0,0.9)', border: '1px solid rgba(0,240,255,0.5)',
      padding: '6px 10px', fontSize: 10, letterSpacing: 1, boxShadow: '0 0 14px rgba(0,240,255,0.3)',
    }}>
      <div style={{ color: '#5f7078', marginBottom: 3 }}>GEN {label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color }}>{p.dataKey.toUpperCase()}: {p.value}</div>
      ))}
    </div>
  );
}

export default function EquityChart() {
  const [data, setData] = useState(seed);
  const vRef = useRef(null);

  useEffect(() => {
    vRef.current = { ...data[data.length - 1] };
    const id = setInterval(() => {
      setData((prev) => {
        const last = prev[prev.length - 1];
        const next = {
          t: last.t + 1,
          alpha: +(last.alpha + (Math.random() - 0.42) * 6).toFixed(1),
          beta: +(last.beta + (Math.random() - 0.48) * 4).toFixed(1),
          gamma: +(last.gamma + (Math.random() - 0.45) * 5).toFixed(1),
        };
        return [...prev.slice(1), next];
      });
    }, 1400);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', gap: 14, marginBottom: 6, flexWrap: 'wrap' }}>
        {SERIES.map((s) => (
          <span key={s.key} style={{ fontSize: 9, letterSpacing: 2, color: s.color, display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, background: s.color, boxShadow: `0 0 6px ${s.color}` }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="algory-chart" style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="t" tick={{ fontSize: 9 }} axisLine={{ stroke: 'rgba(0,240,255,0.2)' }} tickLine={false} />
            <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={40} domain={['auto', 'auto']} />
            <Tooltip content={<CyberTooltip />} cursor={{ stroke: 'rgba(0,240,255,0.3)' }} />
            {SERIES.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
