import React, { useState, useEffect, useRef } from 'react';

const API_URL = import.meta.env.VITE_API_URL || '';
const API_KEY = 'mysecretkey123';
const AUTH = { 'X-API-Key': API_KEY };
const AMBER = '#FFB000', EMERALD = '#00E676', CRIMSON = '#FF3D00', MUTED = '#6b7280';

/* Editable live FAST-GOLD (GSX) bot settings — POST /api/settings.
   Keys must match the GSX EA (fastest_gold.mq5) exactly. Grouped into sections. */

const AUTO_KEYS = ['LotSize', 'TP_USD', 'SL_USD']; // hidden while AUTO is ON

const SECTIONS = [
  { title: '⚙️ أساسي', items: [
    { k: 'AutoTPSL', t: 't', label: 'AUTO · Lot+TP+SL', hint: 'bot sizes lot/TP/SL from ATR + 1% risk' },
    { k: 'LotSize', t: 'n', label: 'Lot Size', step: 0.01, auto: true },
    { k: 'TP_USD', t: 'n', label: 'Take Profit $', step: 0.5, auto: true },
    { k: 'SL_USD', t: 'n', label: 'Stop Loss $', step: 0.5, auto: true },
    { k: 'MaxSpread', t: 'n', label: 'Max Spread', step: 10, int: true },
    { k: 'MaxPositions', t: 'n', label: 'Max Positions', step: 1, int: true },
    { k: 'CooldownSecs', t: 'n', label: 'Cooldown (s)', step: 5, int: true },
  ]},
  { title: '🎯 الخروج (TP / SL)', items: [
    { k: 'QuickTPUSD', t: 'n', label: 'Quick TP $ — close at profit', step: 0.5 },
    { k: 'TrailStartUSD', t: 'n', label: 'Trail Start $ (moving SL)', step: 0.5 },
    { k: 'TrailGiveUSD', t: 'n', label: 'Trail Give-back $', step: 0.1 },
    { k: 'PartialTP_R', t: 'n', label: 'Partial TP at R×', step: 0.1 },
    { k: 'PartialTP_Frac', t: 'n', label: 'Partial Close Fraction', step: 0.05 },
    { k: 'MaxHoldMin', t: 'n', label: 'Time Exit (min, 0=off)', step: 1, int: true },
    { k: 'LockProfitUSD', t: 'n', label: 'Lock Profit $ (0=off)', step: 0.1 },
    { k: 'StallSecs', t: 'n', label: 'Stall Seconds', step: 5, int: true },
    { k: 'SyncTPSL', t: 't', label: 'Write TP/SL on Trades', hint: 'real TP/SL on open positions, updated live' },
    { k: 'ExitOnReverse', t: 't', label: 'Cut Loss on Candle Reverse', hint: 'close a losing trade when the candle flips (≥40% of SL)' },
  ]},
  { title: '🔍 الفلاتر', items: [
    { k: 'UseM15Filter', t: 't', label: 'MTF Filter (15m + 1h)', hint: 'backtested edge — both trends aligned' },
    { k: 'UseH1Filter', t: 't', label: 'H1 Trend Filter', hint: 'trade only with the 1h trend' },
    { k: 'UseRSIFilter', t: 't', label: 'RSI Filter', hint: 'block entries at RSI extremes' },
    { k: 'RSIBuyMax', t: 'n', label: 'RSI Buy Max', step: 1, int: true },
    { k: 'RSISellMin', t: 'n', label: 'RSI Sell Min', step: 1, int: true },
    { k: 'UseATRFilter', t: 't', label: 'ATR Volatility Filter', hint: 'skip entries when ATR too high' },
    { k: 'MaxATRPoints', t: 'n', label: 'Max ATR (pts)', step: 5, int: true },
    { k: 'BlockRollover', t: 't', label: 'Block Rollover 21-22 GMT', hint: 'avoid stop-hunt window' },
    { k: 'TradeHoursStart', t: 'n', label: 'Trade Hour Start (UTC)', step: 1, int: true },
    { k: 'TradeHoursEnd', t: 'n', label: 'Trade Hour End (UTC)', step: 1, int: true },
  ]},
  { title: '🕸️ الشبكة (Grid)', items: [
    { k: 'StrategyMode', t: 'n', label: 'Strategy Mode (0=safe·1G·2H·4Scale)', step: 1, int: true },
    { k: 'GridLevels', t: 'n', label: 'Grid Orders (up to 100)', step: 1, int: true },
    { k: 'GridStep', t: 'n', label: 'Grid Step (points)', step: 5, int: true },
    { k: 'ClaudeGrid', t: 't', label: 'Claude Grid (AI order levels)', hint: 'Claude places grid orders at chart support/resistance' },
  ]},
  { title: '🛡️ الأمان', items: [
    { k: 'SplitLot', t: 't', label: 'Split Lot ÷ Positions', hint: 'divide lot across max positions' },
    { k: 'MaxConsecLosses', t: 'n', label: 'Max Consec Losses (halt)', step: 1, int: true },
    { k: 'TrendReverse', t: 't', label: 'Trend-Vote Reverse', hint: 'after N losses: follow M5/M15/H1 vote, pause if ranging' },
    { k: 'ReverseAfterLosses', t: 'n', label: 'Reverse After N Losses', step: 1, int: true },
  ]},
];

const INT = new Set(
  SECTIONS.flatMap((s) => s.items).filter((i) => i.int || i.t === 't').map((i) => i.k)
);

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
      if (d.settings) setDraft((prev) => mergeKeepDirty(d.settings, dirty.current, prev));
      setMsg(`✓ ${k}`);
    } catch { setMsg('✕ ERROR'); }
    setBusy(false); setTimeout(() => setMsg(''), 2200);
  };
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

  const numField = (f) => (
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
  );
  const toggle = (t) => {
    const on = Number(draft[t.k] ?? 0) > 0.5;
    return (
      <div key={t.k} style={S.toggleRow}>
        <div>
          <div style={S.toggleLabel}>{t.label}</div>
          <div style={S.toggleHint}>{t.hint}</div>
        </div>
        <button onClick={() => toggleSave(t.k)} disabled={!loaded || busy}
          style={{ ...S.sw, ...(on ? S.swOn : S.swOff) }}>{on ? 'ON' : 'OFF'}</button>
      </div>
    );
  };

  if (!loaded) return <div style={{ color: MUTED, padding: '2rem 0' }}>LOADING…</div>;
  const auto = Number(draft.AutoTPSL ?? 0) > 0.5;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <span className="panel-title">Strategy Config · GOLD</span>
        <span style={{ fontSize: 9, letterSpacing: 1, color: msg ? (msg.startsWith('✓') ? EMERALD : msg.startsWith('✕') ? CRIMSON : AMBER) : MUTED }}>
          {msg || '● SYNCED'}
        </span>
      </div>

      {auto && (
        <div style={S.autoNote}>✅ AUTO — bot manages Lot · TP · SL
          <span style={S.autoSub}>auto-split · 80% margin cap · SL 1.25×ATR · R:R 2.8</span>
        </div>
      )}

      {SECTIONS.map((sec) => {
        const nums = sec.items.filter((i) => i.t === 'n' && !(auto && i.auto && AUTO_KEYS.includes(i.k)));
        const tgls = sec.items.filter((i) => i.t === 't');
        return (
          <div key={sec.title} style={S.section}>
            <div style={S.secHead}>{sec.title}</div>
            {tgls.map(toggle)}
            {nums.length > 0 && <div className="grid grid-cols-2 gap-x-5 gap-y-4" style={{ marginTop: tgls.length ? 10 : 0 }}>{nums.map(numField)}</div>}
          </div>
        );
      })}

      <button onClick={saveAll} disabled={busy} className="grx-apply mt-5" style={{ opacity: loaded ? 1 : 0.5 }}>
        {busy ? '…' : 'APPLY ALL PARAMETERS'}
      </button>
    </div>
  );
}

const S = {
  autoNote: { padding: '10px 12px', marginBottom: 14, textAlign: 'center', fontSize: 12, fontWeight: 700,
              color: EMERALD, background: 'rgba(0,230,118,0.08)', border: '1px solid rgba(0,230,118,0.3)', borderRadius: 8 },
  autoSub: { display: 'block', fontSize: 10, fontWeight: 400, color: '#6EE7B7', marginTop: 4, letterSpacing: 1 },
  section: { marginBottom: 18 },
  secHead: { fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: AMBER, textTransform: 'uppercase',
             padding: '8px 0', marginBottom: 8, borderBottom: '1px solid rgba(255,176,0,0.18)' },
  toggleRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10 },
  toggleLabel: { fontSize: 12, fontWeight: 600, color: '#e5e7eb' },
  toggleHint: { fontSize: 10, color: MUTED, marginTop: 2 },
  sw: { border: 'none', borderRadius: 6, padding: '5px 16px', fontSize: 11, fontWeight: 700, letterSpacing: 1, cursor: 'pointer', minWidth: 52 },
  swOn: { background: EMERALD, color: '#04140a' },
  swOff: { background: 'rgba(255,255,255,0.08)', color: MUTED },
};
