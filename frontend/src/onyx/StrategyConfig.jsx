import React, { useState, useEffect, useRef } from 'react';

const API_URL = import.meta.env.VITE_API_URL || '';
const API_KEY = 'mysecretkey123';
const AUTH = { 'X-API-Key': API_KEY };
const AMBER = '#FFB000', EMERALD = '#00E676', CRIMSON = '#FF3D00', MUTED = '#6b7280';

/* Editable live FAST-GOLD (GSX) bot settings — POST /api/settings. The Windows
   agent pulls these every 15s and writes GSX_*.txt for the EA (fastest_gold.mq5). */
// exact keys read by the GSX EA (fastest_gold.mq5) — do not rename
const FIELDS = [
  { k: 'LotSize', label: 'Lot Size', step: 0.01 },
  { k: 'TP_USD', label: 'Take Profit $', step: 0.5 },
  { k: 'SL_USD', label: 'Stop Loss $', step: 0.5 },
  { k: 'MaxSpread', label: 'Max Spread', step: 10, int: true },
  { k: 'MaxPositions', label: 'Max Positions', step: 1, int: true },
  { k: 'CooldownSecs', label: 'Cooldown (s)', step: 5, int: true },
];
// hidden while AUTO mode is ON (bot computes them itself)
const AUTO_KEYS = ['LotSize', 'TP_USD', 'SL_USD'];
// scalping sliders shown under the toggles
const SCALP_FIELDS = [
  { k: 'MaxATRPoints', label: 'Max ATR (pts)', step: 5, int: true },
  { k: 'MaxConsecLosses', label: 'Max Consec Losses', step: 1, int: true },
];
// ON/OFF switches
const TOGGLES = [
  { k: 'AutoTPSL', label: 'AUTO · Lot+TP+SL', hint: 'bot sizes everything from ATR + 1% risk' },
  { k: 'UseM15Filter', label: 'MTF Filter (15m + 1h)', hint: 'backtested edge — trade only with both trends aligned' },
  { k: 'SplitLot', label: 'Split Lot ÷ Positions', hint: 'divides lot across max positions' },
  { k: 'UseATRFilter', label: 'ATR Volatility Filter', hint: 'skip entries when ATR too high' },
  { k: 'BlockRollover', label: 'Block Rollover 21-22 GMT', hint: 'avoid stop-hunt window' },
];
const INT = new Set([
  ...FIELDS.filter((f) => f.int).map((f) => f.k),
  ...SCALP_FIELDS.filter((f) => f.int).map((f) => f.k),
  ...TOGGLES.map((t) => t.k),
]);

// keep any field the user is still editing from being overwritten by the server echo
const mergeKeepDirty = (server, dirty, prev) => {
  const m = { ...server };
  dirty.forEach((k) => { if (prev && Object.prototype.hasOwnProperty.call(prev, k)) m[k] = prev[k]; });
  return m;
};

export default function StrategyConfig() {
  const [draft, setDraft] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = useRef(new Set());

  useEffect(() => {
    let alive = true;
    fetch(`${API_URL}/api/settings`, { headers: AUTH })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => { if (alive && s) { setDraft(s); setLoaded(true); } })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // build the payload: coerce ints, and never send BotRunning (that is
  // owned by the IGNITE/HALT control, not the settings form)
  const payload = (over = {}) => {
    const p = { ...draft, ...over };
    delete p.BotRunning;
    Object.keys(p).forEach((k) => { if (INT.has(k) && typeof p[k] === 'number') p[k] = Math.round(p[k]); });
    return p;
  };
  const post = async (body) => {
    const r = await fetch(`${API_URL}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...AUTH }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('bad');
    return r.json();
  };

  const set = (k, v) => { dirty.current.add(k); setDraft((d) => ({ ...d, [k]: v })); };

  const saveField = async (k) => {
    if (!dirty.current.has(k)) return;
    setBusy(true); setMsg(`SAVING ${k}…`);
    try {
      const d = await post(payload());
      dirty.current.delete(k);
      if (d.settings) setDraft((prev) => mergeKeepDirty(d.settings, dirty.current, prev)); // keep other in-progress edits
      setMsg(`✓ ${k}`);
    } catch { setMsg('✕ ERROR'); }
    setBusy(false); setTimeout(() => setMsg(''), 2200);
  };

  // toggle a 0/1 switch and save immediately
  const toggleSave = async (k) => {
    const nv = Number(draft[k] ?? 0) > 0.5 ? 0 : 1;
    set(k, nv);
    setBusy(true); setMsg(`SAVING ${k}…`);
    try {
      const d = await post(payload({ [k]: nv }));
      dirty.current.delete(k);
      if (d.settings) setDraft((prev) => mergeKeepDirty(d.settings, dirty.current, prev));
      setMsg(`✓ ${k}`);
    } catch { setMsg('✕ ERROR'); }
    setBusy(false); setTimeout(() => setMsg(''), 2200);
  };

  const saveAll = async () => {
    setBusy(true); setMsg('SAVING ALL…');
    try { const d = await post(payload()); dirty.current.clear(); if (d.settings) setDraft(d.settings); setMsg('✓ SAVED · BOT SYNCS ≤15s'); }
    catch { setMsg('✕ ERROR'); }
    setBusy(false); setTimeout(() => setMsg(''), 3000);
  };

  const auto = Number(draft.AutoTPSL ?? 0) > 0.5;
  const visibleFields = FIELDS.filter((f) => !(auto && AUTO_KEYS.includes(f.k)));

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <span className="panel-title">Strategy Config · GOLD</span>
        <span style={{ fontSize: 9, letterSpacing: 1, color: msg ? (msg.startsWith('✓') ? EMERALD : msg.startsWith('✕') ? CRIMSON : AMBER) : MUTED }}>
          {msg || (loaded ? '● SYNCED' : 'LOADING…')}
        </span>
      </div>

      {auto && (
        <div style={S.autoNote}>
          ✅ AUTO — bot manages Lot · TP · SL
          <span style={S.autoSub}>lot auto-split · 80% margin cap · SL 1.0×ATR · R:R 2.0 (backtested PF 1.66)</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-5 gap-y-5">
        {visibleFields.map((f) => (
          <label key={f.k} className="grx-field">
            <span className="micro">{f.label}</span>
            <input
              type="number" step={f.step}
              value={draft[f.k] ?? ''}
              disabled={!loaded}
              onChange={(e) => set(f.k, e.target.value === '' ? '' : Number(e.target.value))}
              onBlur={() => saveField(f.k)}
              className="grx-input"
            />
          </label>
        ))}
      </div>

      <div style={S.toggles}>
        {TOGGLES.map((t) => {
          const on = Number(draft[t.k] ?? 0) > 0.5;
          return (
            <div key={t.k} style={S.toggleRow}>
              <div>
                <div style={S.toggleLabel}>{t.label}</div>
                <div style={S.toggleHint}>{t.hint}</div>
              </div>
              <button
                onClick={() => toggleSave(t.k)}
                disabled={!loaded || busy}
                style={{ ...S.sw, ...(on ? S.swOn : S.swOff) }}
              >
                {on ? 'ON' : 'OFF'}
              </button>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-x-5 gap-y-5 mt-4">
        {SCALP_FIELDS.map((f) => (
          <label key={f.k} className="grx-field">
            <span className="micro">{f.label}</span>
            <input
              type="number" step={f.step}
              value={draft[f.k] ?? ''}
              disabled={!loaded}
              onChange={(e) => set(f.k, e.target.value === '' ? '' : Number(e.target.value))}
              onBlur={() => saveField(f.k)}
              className="grx-input"
            />
          </label>
        ))}
      </div>

      <button onClick={saveAll} disabled={busy || !loaded} className="grx-apply mt-6" style={{ opacity: loaded ? 1 : 0.5 }}>
        {busy ? '…' : 'APPLY ALL PARAMETERS'}
      </button>
    </div>
  );
}

const S = {
  autoNote: { padding: '10px 12px', marginBottom: 14, textAlign: 'center',
              fontSize: 12, fontWeight: 700, color: EMERALD,
              background: 'rgba(0,230,118,0.08)', border: '1px solid rgba(0,230,118,0.3)', borderRadius: 8 },
  autoSub: { display: 'block', fontSize: 10, fontWeight: 400, color: '#6EE7B7', marginTop: 4, letterSpacing: 1 },
  toggles: { marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12,
             paddingTop: 16, borderTop: '1px solid rgba(255,176,0,0.15)' },
  toggleRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  toggleLabel: { fontSize: 12, fontWeight: 600, color: '#e5e7eb' },
  toggleHint: { fontSize: 10, color: MUTED, marginTop: 2 },
  sw: { border: 'none', borderRadius: 6, padding: '5px 16px', fontSize: 11,
        fontWeight: 700, letterSpacing: 1, cursor: 'pointer', minWidth: 52 },
  swOn: { background: EMERALD, color: '#04140a' },
  swOff: { background: 'rgba(255,255,255,0.08)', color: MUTED },
};
