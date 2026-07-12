import { useState } from "react";
import Onyx from "./onyx/Onyx.jsx";
import Nexus from "./nexus/Nexus.jsx";
import Dashboard from "./Dashboard.jsx";
import Settings from "./Settings.jsx";
import Analysis from "./Analysis.jsx";
import BtcConfig from "./BtcConfig.jsx";

const TABS = [
  { id: "onyx",      label: "ONYX"     },
  { id: "nexus",     label: "NEXUS"    },
  { id: "analysis",  label: "ANALYSIS" },
  { id: "settings",  label: "GOLD" },
  { id: "btc",       label: "BTC ₿" },
  { id: "legacy",    label: "LEGACY"   },
];

const TABS_STYLE = {
  bar: {
    display: "flex", gap: 4, padding: "8px 16px 0",
    background: "#000", borderBottom: "1px solid rgba(0,240,255,0.18)",
    direction: "ltr",
  },
  btn: {
    fontFamily: "'JetBrains Mono','Courier New', monospace", fontSize: 11,
    fontWeight: 700, letterSpacing: 2, textTransform: "uppercase",
    padding: "8px 18px", cursor: "pointer", border: "none",
    background: "transparent", color: "#5f7078",
  },
  active: { color: "#00F0FF", borderBottom: "2px solid #00F0FF", textShadow: "0 0 8px rgba(0,240,255,0.6)" },
};

export default function App() {
  const [tab, setTab] = useState("onyx");

  return (
    <div style={{ minHeight: "100vh", background: "#000", direction: "ltr" }}>
      <div style={TABS_STYLE.bar}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{ ...TABS_STYLE.btn, ...(tab === t.id ? TABS_STYLE.active : {}) }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ width: "100%" }}>
        {tab === "onyx" ? <Onyx /> : tab === "nexus" ? <Nexus /> : tab === "analysis" ? <Analysis /> : tab === "legacy" ? <Dashboard /> : tab === "btc" ? <BtcConfig /> : <Settings />}
      </div>
    </div>
  );
}
