import React, { useState, useEffect } from 'react';

const SYMS = ['XAUUSD', 'BTCUSD', 'ETHUSD', 'NAS100', 'US500', 'EURUSD', 'XAGUSD', 'GBPJPY'];
const rnd = (a, b) => a + Math.random() * (b - a);

function makeRow(id) {
  const sym = SYMS[Math.floor(Math.random() * SYMS.length)];
  const side = Math.random() > 0.5 ? 'BUY' : 'SELL';
  const pnl = +rnd(-140, 260).toFixed(2);
  return {
    id,
    sym,
    side,
    lot: +rnd(0.01, 2.5).toFixed(2),
    entry: +rnd(1, 68000).toFixed(2),
    pnl,
    ms: Math.floor(rnd(50, 4000)),
  };
}

export default function TradeTable() {
  const [rows, setRows] = useState(() => Array.from({ length: 9 }, (_, i) => makeRow(i)));

  useEffect(() => {
    let id = rows.length;
    const t = setInterval(() => {
      setRows((prev) => {
        const next = [makeRow(id++), ...prev];
        return next.slice(0, 9);
      });
    }, 1900);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="tt-wrap">
      <div className="tt-scan" />
      <table className="tt">
        <thead>
          <tr>
            <th>SYMBOL</th><th>SIDE</th><th>LOT</th><th>ENTRY</th><th>P&amp;L</th><th>LAT</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ color: '#d7e0e6', fontWeight: 700 }}>{r.sym}</td>
              <td className={r.side === 'BUY' ? 'buy' : 'sell'}>{r.side}</td>
              <td>{r.lot.toFixed(2)}</td>
              <td>{r.entry.toLocaleString()}</td>
              <td className={r.pnl >= 0 ? 'pos' : 'neg'}>{r.pnl >= 0 ? '+' : ''}{r.pnl.toFixed(2)}</td>
              <td style={{ color: '#5f7078' }}>{r.ms}ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
