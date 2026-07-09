import React, { useRef, useEffect } from 'react';
import { useTradingStore } from '../store/useTradingStore';

/* Live log streamed from the MT5 Expert / agent (socket 'log' + /api/logs).
   Entries are { t: time, l: level, m: message }. */
const LVL = { err: '#FF3D00', warn: '#FFB000', ok: '#00E676', trade: '#e7d7b0', info: '#8a8f99', debug: '#6b7280' };
const MASK = 'linear-gradient(to bottom, transparent, #000 6%, #000 94%, transparent)';

export default function EngineLog() {
  const logs = useTradingStore((s) => s.logs);
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [logs]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between mb-2">
        <span className="section-label">Engine Log</span>
        <span className="micro">EA · LIVE</span>
      </div>
      <div ref={ref} className="flex-1 overflow-y-auto min-h-0" style={{ WebkitMaskImage: MASK, maskImage: MASK }}>
        {(!logs || logs.length === 0) && <div className="micro" style={{ padding: '10px 0' }}>AWAITING ENGINE LOG…</div>}
        {(logs || []).slice(-200).map((e, i) => {
          const entry = typeof e === 'string' ? { m: e } : e;
          const color = LVL[entry.l] || '#8a8f99';
          return (
            <div key={i} style={{ fontSize: 11, lineHeight: 1.5, color, wordBreak: 'break-word', textShadow: `0 0 6px ${color}22` }}>
              {entry.t && <span style={{ color: 'rgba(255,255,255,.22)' }}>{entry.t} </span>}
              {entry.m || ''}
            </div>
          );
        })}
      </div>
    </div>
  );
}
