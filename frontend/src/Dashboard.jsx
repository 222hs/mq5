import React, { useState, useEffect, useRef } from 'react';

const API_KEY = 'mysecretkey123';
const POLL_MS = 3000;

const C = {
  bg: '#0d0d0d',
  panel: '#141412',
  border: '#2a2a26',
  text: '#e8e4d9',
  dim: '#8a8678',
  green: '#4a7c59',
  greenBright: '#6fbf85',
  amber: '#c8762a',
  mono: "'Courier New', monospace",
};

function fmtUsd(v, sign = true) {
  if (v === null || v === undefined || isNaN(v)) return '--';
  const s = sign && v > 0 ? '+' : '';
  return s + '$' + Number(v).toFixed(2);
}

function ageSecs(iso) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Math.max(0, Math.floor((Date.now() - t) / 1000));
}

// ---------- small building blocks ----------

function Panel({ title, children, style }) {
  return (
    <div style={{
      background: C.panel, border: `1px solid ${C.border}`,
      padding: 16, ...style,
    }}>
      {title && (
        <div style={{
          fontSize: 11, letterSpacing: 2, color: C.dim,
          textTransform: 'uppercase', marginBottom: 12,
          borderBottom: `1px solid ${C.border}`, paddingBottom: 8,
        }}>{title}</div>
      )}
      {children}
    </div>
  );
}

function StatusDot({ online }) {
  return (
    <span style={{
      display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
      background: online ? C.greenBright : C.amber,
      boxShadow: online ? `0 0 8px ${C.greenBright}` : `0 0 8px ${C.amber}`,
      marginRight: 8,
    }} />
  );
}

// ---------- charts (pure SVG) ----------

function WinLossBars({ history }) {
  const recent = (history || []).slice(-20).slice().sort((a, b) => b.profit - a.profit);
  if (recent.length === 0) {
    return <div style={{ color: C.dim, fontSize: 12 }}>NO TRADE HISTORY</div>;
  }
  const maxAbs = Math.max(...recent.map(t => Math.abs(t.profit)), 0.01);
  const rowH = 14;
  const W = 420, mid = W / 2;
  const H = recent.length * rowH;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <line x1={mid} y1={0} x2={mid} y2={H} stroke={C.border} strokeWidth={1} />
      {recent.map((t, i) => {
        const w = (Math.abs(t.profit) / maxAbs) * (mid - 60);
        const win = t.profit >= 0;
        const y = i * rowH + 2;
        return (
          <g key={t.ticket ?? i}>
            <rect
              x={win ? mid : mid - w} y={y}
              width={Math.max(w, 2)} height={rowH - 4}
              fill={win ? C.green : C.amber}
            />
            <text
              x={win ? mid + w + 6 : mid - w - 6} y={y + rowH - 6}
              textAnchor={win ? 'start' : 'end'}
              fontSize={9} fill={C.dim} fontFamily={C.mono}
            >{fmtUsd(t.profit)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function CumulativePnl({ history }) {
  const hist = history || [];
  if (hist.length === 0) {
    return <div style={{ color: C.dim, fontSize: 12 }}>NO TRADE HISTORY</div>;
  }
  const cum = [];
  let run = 0;
  for (const t of hist) { run += t.profit || 0; cum.push(run); }
  const W = 420, H = 280, pad = 24;
  const min = Math.min(0, ...cum), max = Math.max(0, ...cum);
  const span = max - min || 1;
  const x = i => pad + (i / Math.max(cum.length - 1, 1)) * (W - pad * 2);
  const y = v => H - pad - ((v - min) / span) * (H - pad * 2);
  const pts = cum.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const area = `${x(0)},${y(0)} ${pts} ${x(cum.length - 1)},${y(0)}`;
  const last = cum[cum.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <line x1={pad} y1={y(0)} x2={W - pad} y2={y(0)} stroke={C.border} strokeWidth={1} strokeDasharray="4 4" />
      <polygon points={area} fill={last >= 0 ? C.green : C.amber} opacity={0.15} />
      <polyline points={pts} fill="none" stroke={last >= 0 ? C.greenBright : C.amber} strokeWidth={2} />
      <circle cx={x(cum.length - 1)} cy={y(last)} r={4} fill={last >= 0 ? C.greenBright : C.amber} />
      <text x={W - pad} y={y(last) - 8} textAnchor="end" fontSize={12} fill={C.text} fontFamily={C.mono}>
        {fmtUsd(last)}
      </text>
    </svg>
  );
}

// ---------- main component ----------

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [clock, setClock] = useState(new Date());
  const [busy, setBusy] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const timerRef = useRef(null);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/dashboard');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    fetchData();
    timerRef.current = setInterval(fetchData, POLL_MS);
    const clk = setInterval(() => setClock(new Date()), 1000);
    return () => { clearInterval(timerRef.current); clearInterval(clk); };
  }, []);

  const botControl = async (action) => {
    setBusy(true);
    try {
      await fetch('/api/bot/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify({ action }),
      });
      await fetchData();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const saveSettings = async () => {
    if (!settingsDraft) return;
    setSavingSettings(true);
    try {
      const payload = {};
      for (const [k, v] of Object.entries(settingsDraft)) payload[k] = Number(v);
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify(payload),
      });
      setSettingsDraft(null);
      await fetchData();
    } catch (e) { setError(e.message); }
    setSavingSettings(false);
  };

  const acct = data?.account || {};
  const stats = data?.stats || {};
  const positions = data?.positions || [];
  const history = data?.history || [];
  const settings = data?.settings || {};
  const online = !!data?.is_online;
  const running = !!data?.bot_running;

  // win streak: count consecutive wins from most recent trade backwards
  let streak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if ((history[i].profit || 0) > 0) streak++;
    else break;
  }

  // trades/day estimate from history span
  let tradesPerDay = '--';
  if (history.length > 1) {
    const t0 = new Date(history[0].time).getTime();
    const t1 = new Date(history[history.length - 1].time).getTime();
    const days = Math.max((t1 - t0) / 86400000, 1 / 24);
    tradesPerDay = (history.length / days).toFixed(1);
  }

  const totalPnl = stats.total_profit ?? 0;
  const pnlColor = totalPnl >= 0 ? C.greenBright : C.amber;

  const labelStyle = { fontSize: 10, letterSpacing: 2, color: C.dim, textTransform: 'uppercase' };
  const bigStyle = { fontSize: 22, fontWeight: 'bold', color: C.text };

  return (
    <div style={{
      minHeight: '100vh', background: C.bg, color: C.text,
      fontFamily: C.mono, padding: 20, boxSizing: 'border-box', direction: 'ltr',
    }}>
      {/* HEADER */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: `2px solid ${C.border}`, paddingBottom: 14, marginBottom: 20,
        flexWrap: 'wrap', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ fontSize: 24, fontWeight: 'bold', letterSpacing: 4 }}>
            GOLD SCALPER <span style={{ color: C.greenBright }}>X</span>
          </div>
          <div style={{ fontSize: 12, color: online ? C.greenBright : C.amber }}>
            <StatusDot online={online} />{online ? 'ONLINE' : 'OFFLINE'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
          <div>
            <div style={labelStyle}>UTC TIME</div>
            <div style={{ fontSize: 16 }}>{clock.toISOString().slice(11, 19)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={labelStyle}>BALANCE</div>
            <div style={{ fontSize: 28, fontWeight: 'bold', color: C.text }}>
              ${Number(acct.balance ?? 0).toFixed(2)}
            </div>
          </div>
          <button
            onClick={() => botControl(running ? 'stop' : 'start')}
            disabled={busy}
            style={{
              fontFamily: C.mono, fontSize: 16, fontWeight: 'bold', letterSpacing: 3,
              padding: '14px 28px', cursor: busy ? 'wait' : 'pointer',
              background: running ? 'transparent' : C.green,
              color: running ? C.amber : C.text,
              border: `2px solid ${running ? C.amber : C.green}`,
            }}
          >
            {busy ? '...' : running ? 'STOP BOT' : 'START BOT'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ color: C.amber, fontSize: 12, marginBottom: 12 }}>
          [!] API ERROR: {error}
        </div>
      )}

      {/* HERO */}
      <div style={{
        display: 'flex', gap: 20, marginBottom: 20, flexWrap: 'wrap', alignItems: 'stretch',
      }}>
        <Panel style={{ flex: '2 1 380px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={labelStyle}>TOTAL P&amp;L</div>
          <div style={{
            fontSize: 84, fontWeight: 'bold', color: pnlColor, lineHeight: 1.05,
            letterSpacing: 6,
            textShadow: `0 0 24px ${pnlColor}44, 3px 3px 0 #000`,
          }}>
            {fmtUsd(totalPnl)}
          </div>
          <div style={{ fontSize: 12, color: C.dim, marginTop: 6 }}>
            XAUUSD SCALPING &middot; LAST UPDATE {data?.last_update ? new Date(data.last_update).toISOString().slice(11, 19) : '--'} UTC
          </div>
        </Panel>

        <Panel style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{
            width: 130, height: 130, borderRadius: '50%',
            border: `4px solid ${C.greenBright}`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 0 20px ${C.greenBright}33 inset, 0 0 20px ${C.greenBright}22`,
          }}>
            <div style={{ fontSize: 44, fontWeight: 'bold', color: C.greenBright }}>{streak}</div>
            <div style={{ fontSize: 9, letterSpacing: 2, color: C.dim }}>WIN STREAK</div>
          </div>
        </Panel>

        <Panel style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', justifyContent: 'space-around', gap: 10 }}>
          <div>
            <div style={labelStyle}>TOTAL TRADES</div>
            <div style={bigStyle}>{stats.total_trades ?? '--'}</div>
          </div>
          <div>
            <div style={labelStyle}>WIN RATE</div>
            <div style={{ ...bigStyle, color: C.greenBright }}>
              {stats.win_rate != null ? stats.win_rate.toFixed(1) + '%' : '--'}
              <span style={{ fontSize: 12, color: C.dim, marginLeft: 8 }}>
                ({stats.wins ?? 0}W / {stats.losses ?? 0}L)
              </span>
            </div>
          </div>
          <div>
            <div style={labelStyle}>TRADES / DAY</div>
            <div style={bigStyle}>{tradesPerDay}</div>
          </div>
        </Panel>
      </div>

      {/* CHARTS */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 20, flexWrap: 'wrap' }}>
        <Panel title="WIN / LOSS — LAST 20 TRADES" style={{ flex: '1 1 400px' }}>
          <WinLossBars history={history} />
        </Panel>
        <Panel title="CUMULATIVE P&L" style={{ flex: '1 1 400px' }}>
          <CumulativePnl history={history} />
        </Panel>
      </div>

      {/* POSITIONS */}
      <Panel title={`LIVE POSITIONS [${positions.length}]`} style={{ marginBottom: 20 }}>
        {positions.length === 0 ? (
          <div style={{ color: C.dim, fontSize: 12 }}>NO OPEN POSITIONS — WAITING FOR SIGNAL...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: C.dim, fontSize: 10, letterSpacing: 2, textAlign: 'left' }}>
                {['TICKET', 'TYPE', 'VOLUME', 'ENTRY', 'PROFIT', 'AGE'].map(h => (
                  <th key={h} style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {positions.map(p => (
                <tr key={p.ticket}>
                  <td style={{ padding: '8px', borderBottom: `1px solid ${C.border}` }}>#{p.ticket}</td>
                  <td style={{
                    padding: '8px', borderBottom: `1px solid ${C.border}`, fontWeight: 'bold',
                    color: p.type === 'BUY' ? C.greenBright : C.amber,
                  }}>{p.type}</td>
                  <td style={{ padding: '8px', borderBottom: `1px solid ${C.border}` }}>{p.volume}</td>
                  <td style={{ padding: '8px', borderBottom: `1px solid ${C.border}` }}>{Number(p.price).toFixed(2)}</td>
                  <td style={{
                    padding: '8px', borderBottom: `1px solid ${C.border}`, fontWeight: 'bold',
                    color: p.profit >= 0 ? C.greenBright : C.amber,
                  }}>{fmtUsd(p.profit)}</td>
                  <td style={{ padding: '8px', borderBottom: `1px solid ${C.border}`, color: C.dim }}>
                    {ageSecs(p.time)}s
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {/* SETTINGS */}
      <Panel title="BOT SETTINGS" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {['LotSize', 'TP_USD', 'SL_USD', 'MaxSpread', 'MaxPositions', 'CooldownSecs', 'TrailUSD'].map(key => (
            <div key={key}>
              <div style={labelStyle}>{key}</div>
              <input
                type="number"
                step="any"
                value={settingsDraft ? settingsDraft[key] : (settings[key] ?? '')}
                onChange={e => setSettingsDraft({
                  ...(settingsDraft || { ...settings }),
                  [key]: e.target.value,
                })}
                style={{
                  fontFamily: C.mono, fontSize: 14, width: 100, marginTop: 4,
                  background: C.bg, color: C.text, border: `1px solid ${C.border}`,
                  padding: '6px 8px', outline: 'none',
                }}
              />
            </div>
          ))}
          <button
            onClick={saveSettings}
            disabled={!settingsDraft || savingSettings}
            style={{
              fontFamily: C.mono, fontSize: 13, fontWeight: 'bold', letterSpacing: 2,
              padding: '9px 20px',
              cursor: settingsDraft ? 'pointer' : 'default',
              background: settingsDraft ? C.green : 'transparent',
              color: settingsDraft ? C.text : C.dim,
              border: `1px solid ${settingsDraft ? C.green : C.border}`,
            }}
          >
            {savingSettings ? 'SAVING...' : 'SAVE SETTINGS'}
          </button>
          {settingsDraft && (
            <button
              onClick={() => setSettingsDraft(null)}
              style={{
                fontFamily: C.mono, fontSize: 13, letterSpacing: 2, padding: '9px 14px',
                background: 'transparent', color: C.dim, border: `1px solid ${C.border}`,
                cursor: 'pointer',
              }}
            >CANCEL</button>
          )}
        </div>
      </Panel>

      {/* STATS BAR */}
      <div style={{
        display: 'flex', gap: 0, border: `1px solid ${C.border}`, background: C.panel,
        flexWrap: 'wrap',
      }}>
        {[
          ['EQUITY', '$' + Number(acct.equity ?? 0).toFixed(2)],
          ['FLOATING P&L', fmtUsd(acct.profit ?? 0)],
          ['MARGIN', '$' + Number(acct.margin ?? 0).toFixed(2)],
          ['FREE MARGIN', '$' + Number(acct.free_margin ?? 0).toFixed(2)],
          ['MAX SPREAD', settings.MaxSpread ?? '--'],
          ['LOT SIZE', settings.LotSize ?? '--'],
          ['TP', '$' + Number(settings.TP_USD ?? 0).toFixed(2)],
          ['SL', '$' + Number(settings.SL_USD ?? 0).toFixed(2)],
        ].map(([label, val], i) => (
          <div key={label} style={{
            flex: '1 1 110px', padding: '12px 16px',
            borderLeft: i === 0 ? 'none' : `1px solid ${C.border}`,
          }}>
            <div style={labelStyle}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 'bold', marginTop: 4 }}>{val}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16, fontSize: 10, color: C.dim, letterSpacing: 2, textAlign: 'center' }}>
        GOLD SCALPER X &middot; XAUUSD &middot; MT5 BRIDGE &middot; POLLING EVERY {POLL_MS / 1000}S
      </div>
    </div>
  );
}
