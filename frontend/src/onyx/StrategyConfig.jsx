import React, { useState, useEffect, useRef } from 'react';

const API_URL = import.meta.env.VITE_API_URL || '';
const API_KEY = 'mysecretkey123';
const AUTH = { 'X-API-Key': API_KEY };
const AMBER = '#FFB000', EMERALD = '#00E676', CRIMSON = '#FF3D00', MUTED = '#6b7280';

/* Editable live GRX bot settings — POST /api/settings/grx. The Windows
   agent pulls these every 15s and writes GRX_Settings.json for the EA. */
// exact keys read by the GRX EA (gold_range_scalper.mq5) — do not rename
const FIELDS = [
  { k: 'BaseLot', label: 'Base Lot', step: 0.01 },
  { k: 'TradeTP', label: 'Take Profit $', step: 0.5 },
  { k: 'TradeSL', label: 'Stop Loss $', step: 0.5 },
  { k: 'MaxSpread', label: 'Max Spread', step: 10, int: true },
  { k: 'CooldownBars', label: 'Cooldown Bars', step: 1, int: true },
  { k: 'MaxTrades', label: 'Max Trades', step: 1, int: true },
];
const INT = new Set(FIELDS.filter((f) => f.int).map((f) => f.k));

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
    fetch(`${API_URL}/api/settings/grx`, { headers: AUTH })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => { if (alive && s) { setDraft(s); setLoaded(true); } })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // build the payload: coerce ints, and never send BotRunning (that is
  // owned by the IGNITE/HALT control, not the settings form)
  const payload = (over = {}) => {
    const p = { ...draft, ...over };
    delete p.BotRunning; delete p.grx_user_saved;
    Object.keys(p).forEach((k) => { if (INT.has(k) && typeof p[k] === 'number') p[k] = Math.round(p[k]); });
    return p;
  };
  const post = async (body) => {
    const r = await fetch(`${API_URL}/api/settings/grx`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...AUTH }, body: JSON.stringify(body) });
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

  const saveAll = async () => {
    setBusy(true); setMsg('SAVING ALL…');
    try { const d = await post(payload()); dirty.current.clear(); if (d.settings) setDraft(d.settings); setMsg('✓ SAVED · BOT SYNCS ≤15s'); }
    catch { setMsg('✕ ERROR'); }
    setBusy(false); setTimeout(() => setMsg(''), 3000);
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
        {busy ? '…' : 'APPLY ALL PARAMETERS'}
      </button>
    </div>
  );
}
