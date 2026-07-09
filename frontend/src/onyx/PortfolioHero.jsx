import React from 'react';
import { motion } from 'framer-motion';
import { useTradingStore } from '../store/useTradingStore';
import Ticker from './Ticker.jsx';

const AMBER = '#FFB000', EMERALD = '#00E676', CRIMSON = '#FF3D00', MUTED = '#6b7280';
const netOf = (t) => (t.profit || 0) + (t.swap || 0) + (t.commission || 0);

function Stat({ label, value, color, prefix = '', suffix = '', absolute = false, decimals = 2, sub }) {
  return (
    <div className="flex flex-col gap-1 min-w-[120px]">
      <span style={{ fontSize: 10, letterSpacing: 2, color: MUTED }}>{label}</span>
      <span style={{ fontSize: 'clamp(22px,2.4vw,34px)', fontWeight: 800, color, lineHeight: 1 }}>
        <Ticker value={value} prefix={prefix} suffix={suffix} absolute={absolute} decimals={decimals} />
      </span>
      {sub && <span style={{ fontSize: 9, letterSpacing: 1, color: MUTED }}>{sub}</span>}
    </div>
  );
}

export default function PortfolioHero() {
  const balance = useTradingStore((s) => s.balance);
  const equity = useTradingStore((s) => s.equity);
  const stats = useTradingStore((s) => s.stats);
  const pnlOpen = useTradingStore((s) => s.pnlOpen);
  const positions = useTradingStore((s) => s.positions);
  const history = useTradingStore((s) => s.history);

  const totalPnl = stats.total_profit ?? 0;
  const winRate = stats.win_rate ?? 0;
  const todayStr = new Date().toDateString();
  const todayNet = history.filter((t) => new Date(t.time).toDateString() === todayStr).reduce((a, t) => a + netOf(t), 0);
  const balPos = (balance ?? 0) >= 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className="glass glass-hover p-6 md:p-9 flex flex-col xl:flex-row xl:items-center gap-8"
    >
      {/* ── the huge balance ── */}
      <div className="flex flex-col">
        <span style={{ fontSize: 12, letterSpacing: 5, color: AMBER }}>TOTAL BALANCE</span>
        <div style={{
          fontSize: 'clamp(54px,8vw,110px)', fontWeight: 800, lineHeight: 0.95,
          color: balPos ? '#f4e6c0' : CRIMSON, textShadow: '0 0 55px rgba(255,176,0,0.30)',
        }}>
          <Ticker value={balance} prefix="$" decimals={2} />
        </div>
        <span style={{ fontSize: 12, letterSpacing: 2, color: MUTED, marginTop: 8 }}>
          {(stats.total_trades || 0).toLocaleString()} TRADES · EQUITY{' '}
          <b style={{ color: EMERALD }}>{equity != null ? '$' + Number(equity).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '--'}</b>
          {' · '}OPEN <b style={{ color: pnlOpen >= 0 ? EMERALD : CRIMSON }}>{pnlOpen >= 0 ? '+' : ''}${Math.abs(pnlOpen).toFixed(2)}</b>
        </span>
      </div>

      {/* ── secondary stat cluster ── */}
      <div className="flex flex-wrap gap-x-9 gap-y-5 xl:ml-auto">
        <Stat label="TOTAL P&L" value={totalPnl} absolute prefix={totalPnl >= 0 ? '+$' : '-$'} color={totalPnl >= 0 ? EMERALD : CRIMSON} sub={`AVG ${stats.total_trades ? (totalPnl / stats.total_trades).toFixed(2) : '--'}`} />
        <Stat label="TODAY NET" value={todayNet} absolute prefix={todayNet >= 0 ? '+$' : '-$'} color={todayNet >= 0 ? EMERALD : CRIMSON} sub={`${positions.length} OPEN`} />
        <Stat label="WIN RATE" value={winRate} suffix="%" decimals={1} color={winRate >= 50 ? EMERALD : CRIMSON} sub={`${stats.wins || 0}W / ${stats.losses || 0}L`} />
      </div>
    </motion.section>
  );
}
