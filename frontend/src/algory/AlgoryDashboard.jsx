import React, { useState, Suspense } from 'react';
import './algory.css';
import { GlitchText, NavItem, CyberButton, HexFeed, Panel, NEON } from './effects';
import NeuralMap from './NeuralMap';
import InvadersGame from './InvadersGame';
import EquityChart from './EquityChart';
import TradeTable from './TradeTable';

const TABS = ['OVERVIEW', 'STRATEGIES', 'NEURAL', 'LEDGER', 'SYSTEM'];

export default function AlgoryDashboard() {
  const [tab, setTab] = useState('OVERVIEW');
  const [engine, setEngine] = useState(true);

  return (
    <div className="algory-root">
      <div className="algory-scanlines" />
      <div className="algory-vignette" />

      {/* ── TOP NAV ─────────────────────────────────────────── */}
      <nav className="algory-nav">
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
          <GlitchText text="ALGORY" pulse className="algory-logo" />
          <span style={{ fontSize: 10, letterSpacing: 3, color: NEON.green, textShadow: `0 0 8px ${NEON.green}` }}>
            ● AI ENGINE {engine ? 'ONLINE' : 'STANDBY'}
          </span>
        </div>
        <div className="algory-nav-tabs">
          {TABS.map((t) => <NavItem key={t} label={t} active={tab === t} onClick={() => setTab(t)} />)}
        </div>
      </nav>

      {/* ── BODY ────────────────────────────────────────────── */}
      <div className="algory-grid">

        {/* SIDEBAR */}
        <aside className="algory-side">
          <div className="holo" style={{ padding: 14 }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: '#5f7078', marginBottom: 12 }}>&gt; CONTROL</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <CyberButton color={engine ? NEON.crimson : NEON.green} onClick={() => setEngine((e) => !e)}>
                {engine ? '■ HALT ENGINE' : '▶ IGNITE ENGINE'}
              </CyberButton>
              <CyberButton color={NEON.cyan}>◇ DEPLOY MODEL</CyberButton>
              <CyberButton color={NEON.green}>⟳ SYNC LEDGER</CyberButton>
            </div>
          </div>

          <Panel title="LIVE ENGINE FEED" tag="/dev/tty0">
            <HexFeed />
          </Panel>
        </aside>

        {/* WIDGET GRID */}
        <main className="algory-widgets">
          <Panel title="GENERATION EQUITY CURVE" tag="RECHARTS ∙ LIVE">
            <EquityChart />
          </Panel>

          <Panel title="3D HOLOGRAPHIC NEURAL MAP" tag="R3F ∙ DRAG TO ROTATE" bodyStyle={{ padding: 0, height: 256 }}>
            <Suspense fallback={<div style={{ padding: 20, color: NEON.cyan, fontSize: 11 }}>BOOTING NEURAL CORE…</div>}>
              <NeuralMap />
            </Suspense>
          </Panel>

          <Panel title="PROVING GROUNDS" tag="EXEC ∙ PLAYABLE">
            <InvadersGame />
          </Panel>

          <Panel title="LIVE TRADE DATA" tag="STREAM ∙ MT5">
            <TradeTable />
          </Panel>
        </main>
      </div>
    </div>
  );
}
