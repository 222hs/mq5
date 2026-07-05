import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import Dashboard from "./Dashboard.jsx";
import Settings from "./Settings.jsx";

function App() {
  const [tab, setTab] = useState("dashboard");

  return (
    <div style={{ minHeight: "100vh", background: "#0B0B10", color: "#fff",
                  fontFamily: "'Segoe UI', system-ui, sans-serif", direction: "rtl" }}>
      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, padding: "1rem 1rem 0",
                    maxWidth: 900, margin: "0 auto" }}>
        {[
          { id: "dashboard", label: "📊 لوحة التحكم" },
          { id: "settings",  label: "⚙️ الإعدادات" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: tab === t.id ? "#1D4ED8" : "#16161D",
              color: tab === t.id ? "#fff" : "#9CA3AF",
              border: "0.5px solid #2A2A33",
              borderRadius: "10px 10px 0 0",
              padding: "8px 20px",
              fontSize: 13,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 1rem 2rem",
                    background: "#0F0F16", borderRadius: "0 12px 12px 12px",
                    border: "0.5px solid #2A2A33" }}>
        {tab === "dashboard" ? <Dashboard embedded /> : <Settings />}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
