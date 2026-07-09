import React, { useState, useEffect, useRef } from 'react';

const API_URL = import.meta.env.VITE_API_URL || '';
const API_KEY = 'mysecretkey123';
const AUTH = { 'X-API-Key': API_KEY };
const AMBER = '#FFB000', EMERALD = '#00E676', CRIMSON = '#FF3D00', MUTED = '#6b7280';

/* Editable live GRX bot settings — wired to the real /api/settings/grx. */
const FIELDS = [
  { k: 'BaseLot', label: 'Base Lot', step: 0.01 },
  { k: 'RiskPct', label: 'Risk %', step: 0.1 },
  { k: 'BasketCount', label: 'Basket Count', step: 1 },
  { k: 'BasketTP', label: 'Basket TP $', step: 0.5 },
  { k: 'MaxDrawdown', label: 'Max Drawdown $', step: 1 },
  { k: 'MaxSpread', label: 'Max Spread', step: 10 },
  { k: 'LotBoost', label: 'Lot Boost', step: 0.1 },
  { k: 'CooldownBars', label: 'Cooldown Bars', step: 1 },
  { k: 'ADXMax', label: 'ADX Max', step: 1 },
  { k: 'SLMult', label: 'SL Mult', step: 0.1 },
  { k: 'ReverseStopUSD', label: 'Reverse Stop $', step: 0.5 },
];

export default function StrategyConfig() {
  const [draft, setDraft] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = useRef(new Set());

  useEffect(() => {
    let alive = true;
    fetch(`${API_URL}/api/settings/grx`, { headers: AUTH })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => { if (alive && s) { setDraft(s); setLoaded(true); } })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const post = async (body) => {
    const r = await fetch(`${API_URL}/api/settings/grx`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...AUTH }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error('bad');
    return r.json();
  };

  const set = (k, v) => { dirty.current.add(k); setDraft((d) => ({ ...d, [k]: v })); };

  const saveField = async (k) => {
    if (!dirty.current.has(k)) return;
    setBusy(true); setMsg(`SAVING ${k}…`);
    try { const d = await post({ ...draft, [k]: draft[k] }); if (d.settings) setDraft(d.settings); dirty.current.delete(k); setMsg(`✓ ${k}`); }
    catch { setMsg('✕ ERROR'); }
    setBusy(false); setTimeout(() => setMsg(''), 2000);
  };

  const saveAll = async () => {
    setBusy(true); setMsg('SAVING ALL…');
    try { const d = await post(draft); if (d.settings) setDraft(d.settings); dirty.current.clear(); setMsg('✓ ALL SAVED'); }
    catch { setMsg('✕ ERROR'); }
    setBusy(false); setTimeout(() => setMsg(''), 2500);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <span className="panel-title">Strategy Config · GRX</span>
        <span style={{ fontSize: 9, letterSpacing: 1, color: msg ? (msg.startsWith('✓') ? EMERALD : msg.startsWith('✕') ? CRIMSON : AMBER) : MUTED }}>
          {msg || (loaded ? '● SYNCED' : 'LOADING…')}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-5 gap-y-5 flex-1">
        {FIELDS.map((f) => (
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
        {busy ? '…' : 'APPLY PARAMETERS'}
      </button>
    </div>
  );
}
