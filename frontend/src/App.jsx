import { useState } from "react";
import Dashboard from "./Dashboard.jsx";
import Settings from "./Settings.jsx";
import Analysis from "./Analysis.jsx";
import AlgoryDashboard from "./algory/AlgoryDashboard.jsx";

const TABS = [
  { id: "dashboard", label: "DASHBOARD" },
  { id: "analysis",  label: "ANALYSIS"  },
  { id: "settings",  label: "SETTINGS"  },
  { id: "algory",    label: "ALGORY"    },
];

const TABS_STYLE = {
  bar: {
    display: "flex", gap: 4, padding: "10px 16px 0",
    background: "#1a1a18", borderBottom: "1px solid #2a2a24",
    direction: "ltr",
  },
  btn: {
    fontFamily: "'Courier New', monospace", fontSize: 12,
    fontWeight: 700, letterSpacing: 2, textTransform: "uppercase",
    padding: "8px 20px", cursor: "pointer", border: "none",
    background: "transparent", color: "#8a8580",
  },
  active: { color: "#f0ebe0", borderBottom: "2px solid #52b788" },
};

export default function App() {
  const [tab, setTab] = useState("dashboard");

  return (
    <div style={{ minHeight: "100vh", background: "#f0ebe0", direction: "ltr" }}>
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
        {tab === "dashboard" ? <Dashboard /> : tab === "analysis" ? <Analysis /> : tab === "algory" ? <AlgoryDashboard /> : <Settings />}
      </div>
    </div>
  );
}

const s = {};
