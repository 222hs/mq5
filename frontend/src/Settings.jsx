import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "";
const API_KEY = "mysecretkey123";

const FIELDS = [
  { key: "LotSize",      label: "حجم اللوت",          min: 0.01, max: 1,    step: 0.01, decimals: 2 },
  { key: "TP",           label: "Take Profit (نقاط)",  min: 5,    max: 200,  step: 1,    decimals: 0 },
  { key: "SL",           label: "Stop Loss (نقاط)",    min: 5,    max: 200,  step: 1,    decimals: 0 },
  { key: "MaxSpread",    label: "أقصى سبريد",           min: 50,   max: 2000, step: 10,   decimals: 0 },
  { key: "MaxPositions", label: "أقصى صفقات",           min: 1,    max: 10,   step: 1,    decimals: 0 },
  { key: "CandleConf",   label: "تأكيد الشمعات",        min: 1,    max: 5,    step: 1,    decimals: 0 },
];

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState(null);

  useEffect(() => {
    fetch(`${API_URL}/api/settings`)
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => setMsg({ ok: false, text: "تعذر تحميل الإعدادات" }));
  }, []);

  const handleChange = (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_URL}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        setMsg({ ok: true, text: "✅ تم حفظ الإعدادات — ستُطبَّق على البوت خلال 15 ثانية" });
      } else {
        setMsg({ ok: false, text: "❌ فشل الحفظ" });
      }
    } catch {
      setMsg({ ok: false, text: "❌ تعذر الاتصال بالسيرفر" });
    }
    setSaving(false);
  };

  if (!settings) {
    return <div style={s.loading}>جاري تحميل الإعدادات...</div>;
  }

  return (
    <div style={s.wrap}>
      <p style={s.title}>⚙️ إعدادات البوت</p>
      <p style={s.hint}>التغييرات تُطبَّق تلقائياً على الـ EA خلال 15 ثانية</p>

      {FIELDS.map((f) => (
        <div key={f.key} style={s.row}>
          <label style={s.label}>{f.label}</label>
          <div style={s.inputRow}>
            <input
              type="range"
              min={f.min}
              max={f.max}
              step={f.step}
              value={settings[f.key] ?? f.min}
              onChange={(e) => handleChange(f.key, parseFloat(e.target.value))}
              style={s.range}
            />
            <input
              type="number"
              min={f.min}
              max={f.max}
              step={f.step}
              value={settings[f.key] ?? f.min}
              onChange={(e) => handleChange(f.key, parseFloat(e.target.value))}
              style={s.numInput}
            />
          </div>
        </div>
      ))}

      <button onClick={handleSave} disabled={saving} style={s.btn}>
        {saving ? "جاري الحفظ..." : "حفظ الإعدادات"}
      </button>

      {msg && (
        <p style={{ ...s.msg, color: msg.ok ? "#4ADE80" : "#F87171" }}>{msg.text}</p>
      )}
    </div>
  );
}

const s = {
  wrap:     { padding: "1.5rem 0" },
  title:    { fontSize: 16, fontWeight: 600, margin: "0 0 4px" },
  hint:     { fontSize: 12, color: "#6B7280", margin: "0 0 1.5rem" },
  loading:  { color: "#9CA3AF", padding: "2rem 0" },
  row:      { marginBottom: "1.25rem" },
  label:    { display: "block", fontSize: 13, color: "#9CA3AF", marginBottom: 6 },
  inputRow: { display: "flex", alignItems: "center", gap: 12 },
  range:    { flex: 1, accentColor: "#3B82F6" },
  numInput: {
    width: 70,
    background: "#16161D",
    border: "0.5px solid #2A2A33",
    borderRadius: 8,
    color: "#fff",
    padding: "4px 8px",
    fontSize: 13,
    textAlign: "center",
  },
  btn: {
    marginTop: "0.5rem",
    background: "#3B82F6",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "10px 28px",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    width: "100%",
  },
  msg: { marginTop: "0.75rem", fontSize: 13, textAlign: "center" },
};
