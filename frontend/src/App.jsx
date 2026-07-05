import { useState } from "react";
import Dashboard from "./Dashboard.jsx";
import Settings from "./Settings.jsx";

const TABS = [
  { id: "dashboard", label: "📊 لوحة التحكم" },
  { id: "settings",  label: "⚙️ الإعدادات" },
];

export default function App() {
  const [tab, setTab] = useState("dashboard");

  return (
    <div style={s.page}>
      <div style={s.tabBar}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{ ...s.tabBtn, ...(tab === t.id ? s.tabActive : {}) }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div style={s.content}>
        {tab === "dashboard" ? <Dashboard /> : <Settings />}
      </div>
    </div>
  );
}

const s = {
  page: {
    minHeight: "100vh",
    background: "#0B0B10",
    color: "#fff",
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    direction: "rtl",
  },
  tabBar: {
    display: "flex",
    gap: 6,
    padding: "1.25rem 1.25rem 0",
    maxWidth: 940,
    margin: "0 auto",
  },
  tabBtn: {
    background: "#16161D",
    color: "#9CA3AF",
    border: "1px solid #2A2A33",
    borderBottom: "none",
    borderRadius: "10px 10px 0 0",
    padding: "9px 22px",
    fontSize: 14,
    cursor: "pointer",
    fontFamily: "inherit",
    fontWeight: 500,
  },
  tabActive: {
    background: "#1D4ED8",
    color: "#fff",
    borderColor: "#1D4ED8",
  },
  content: {
    maxWidth: 940,
    margin: "0 auto",
    padding: "1.5rem 1.25rem 3rem",
    background: "#0F0F16",
    border: "1px solid #2A2A33",
    borderRadius: "0 12px 12px 12px",
    minHeight: "80vh",
  },
};
