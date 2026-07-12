import StrategyConfig from './onyx/StrategyConfig.jsx';
import './onyx/onyx.css';

// الوضع الرابح المؤكّد للبتكوين (M5, PF 1.38 عبر 3 أثلاث) — ستوب 2.0×ATR
const BTC_WINNING = {
  AutoTPSL: 1, UseM15Filter: 1, UseH1Filter: 1, UseRSIFilter: 1,
  RSIBuyMax: 75, RSISellMin: 25, AutoSLATR: 2.0, AutoTPRR: 2.0,
  EarlyEntry: 0, StrategyMode: 0, MarginUsePct: 0, SplitLot: 0,
  ExitOnReverse: 0, TrendReverse: 0, SyncTPSL: 1,
  QuickTPUSD: 0, PartialTP_R: 0, TrailStartUSD: 0, LockProfitUSD: 0, MaxHoldMin: 0,
  UseATRFilter: 0, BlockRollover: 0, ClaudeGrid: 0,
  TradeHoursStart: 13, TradeHoursEnd: 18,
  MaxConsecLosses: 3, MaxPositions: 3, MaxSpread: 6000, CooldownSecs: 0,
};

export default function BtcConfig() {
  return (
    <div style={{ background: '#000', minHeight: '100vh', padding: '20px 16px', color: '#e5e7eb' }}>
      <div style={{ maxWidth: 620, margin: '0 auto' }}>
        <StrategyConfig endpoint="/api/settings/btc" winning={BTC_WINNING} title="Strategy Config · BTC ₿" />
      </div>
    </div>
  );
}
