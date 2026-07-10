import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "";
const API_KEY = "mysecretkey123";

const FIELDS = [
  { key: "LotSize",      label: "حجم اللوت",            unit: "",   min: 0.01, max: 5,    step: 0.01, decimals: 2 },
  { key: "TP_USD",       label: "Take Profit",           unit: "$",  min: 0.5,  max: 20,   step: 0.5,  decimals: 1 },
  { key: "SL_USD",       label: "Stop Loss",             unit: "$",  min: 0.5,  max: 10,   step: 0.5,  decimals: 1 },
  { key: "MaxSpread",    label: "أقصى سبريد (نقطة)",     unit: "pts",min: 50,   max: 1000, step: 10,   decimals: 0 },
  { key: "MaxPositions", label: "أقصى صفقات مفتوحة",     unit: "",   min: 1,    max: 15,   step: 1,    decimals: 0 },
  { key: "CooldownSecs", label: "وقت الانتظار بين الصفقات",unit:"s", min: 0,    max: 300,  step: 5,    decimals: 0 },
  { key: "TrailUSD",    label: "Trailing Stop (تراجع من الذروة)", unit: "$", min: 0, max: 10, step: 0.5, decimals: 1 },
];

// أزرار تشغيل/إيقاف — فلاتر السكالبينج
const TOGGLES = [
  { key: "UseATRFilter",  label: "فلتر التقلب (ATR)",        hint: "يمنع الدخول وقت التقلب العالي" },
  { key: "BlockRollover", label: "إيقاف وقت الرول-أوفر",     hint: "يوقف التداول 21:00–22:00 GMT (صيد الستوبات)" },
];

// سلايدرات إضافية تظهر فقط تحت قسم السكالبينج
const SCALP_FIELDS = [
  { key: "MaxATRPoints",    label: "أقصى ATR مسموح",         unit: "pts", min: 20, max: 200, step: 5, decimals: 0 },
  { key: "MaxConsecLosses", label: "حد الخسائر المتتالية (0=معطّل)", unit: "", min: 0, max: 10, step: 1, decimals: 0 },
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
        setMsg({ ok: true, text: "✅ تم الحفظ — ستُطبَّق على البوت خلال 15 ثانية" });
      } else {
        setMsg({ ok: false, text: "❌ فشل الحفظ" });
      }
    } catch {
      setMsg({ ok: false, text: "❌ تعذر الاتصال بالسيرفر" });
    }
    setSaving(false);
  };

  const renderSlider = (f) => {
    const val = settings[f.key] ?? f.min;
    const pct = ((val - f.min) / (f.max - f.min)) * 100;
    return (
      <div key={f.key} style={s.row}>
        <div style={s.labelRow}>
          <span style={s.label}>{f.label}</span>
          <span style={s.valBadge}>
            {Number(val).toFixed(f.decimals)}{f.unit}
          </span>
        </div>
        <div style={s.inputRow}>
          <div style={s.trackWrap}>
            <div style={{ ...s.trackFill, width: pct + "%" }} />
            <input
              type="range"
              min={f.min} max={f.max} step={f.step}
              value={val}
              onChange={(e) => handleChange(f.key, parseFloat(e.target.value))}
              style={{ ...s.range, direction: "ltr" }}
            />
          </div>
          <input
            type="number"
            min={f.min} max={f.max} step={f.step}
            value={val}
            onChange={(e) => handleChange(f.key, parseFloat(e.target.value))}
            style={s.numInput}
          />
        </div>
      </div>
    );
  };

  if (!settings) return <div style={s.loading}>جاري تحميل الإعدادات...</div>;

  return (
    <div style={s.wrap}>
      <p style={s.title}>⚙️ إعدادات البوت</p>
      <p style={s.hint}>التغييرات تُطبَّق تلقائياً على الـ EA خلال 15 ثانية</p>

      {FIELDS.map(renderSlider)}

      <div style={s.sectionHead}>⚡ فلاتر السكالبينج</div>

      {TOGGLES.map((t) => {
        const on = Number(settings[t.key] ?? 0) > 0.5;
        return (
          <div key={t.key} style={s.toggleRow}>
            <div>
              <div style={s.label}>{t.label}</div>
              <div style={s.toggleHint}>{t.hint}</div>
            </div>
            <button
              onClick={() => handleChange(t.key, on ? 0 : 1)}
              style={{ ...s.toggle, ...(on ? s.toggleOn : s.toggleOff) }}
            >
              {on ? "ON" : "OFF"}
            </button>
          </div>
        );
      })}

      {SCALP_FIELDS.map(renderSlider)}

      <button onClick={handleSave} disabled={saving} style={s.btn}>
        {saving ? "جاري الحفظ..." : "💾 حفظ الإعدادات"}
      </button>

      {msg && (
        <p style={{ ...s.msg, color: msg.ok ? "#4ADE80" : "#F87171" }}>{msg.text}</p>
      )}
    </div>
  );
}

const s = {
  wrap:      { padding: "1.5rem 0" },
  title:     { fontSize: 16, fontWeight: 600, margin: "0 0 4px" },
  hint:      { fontSize: 12, color: "#6B7280", margin: "0 0 1.5rem" },
  loading:   { color: "#9CA3AF", padding: "2rem 0" },
  row:       { marginBottom: "1.5rem" },
  labelRow:  { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  label:     { fontSize: 13, color: "#9CA3AF" },
  valBadge:  { fontSize: 13, fontWeight: 600, color: "#3B82F6",
               background: "#1e2a3a", borderRadius: 6, padding: "2px 10px" },
  inputRow:  { display: "flex", alignItems: "center", gap: 12 },
  trackWrap: { flex: 1, position: "relative", height: 6, borderRadius: 3,
               background: "#2A2A33", direction: "ltr" },
  trackFill: { position: "absolute", top: 0, left: 0, height: "100%",
               background: "#3B82F6", borderRadius: 3, pointerEvents: "none" },
  range:     { position: "absolute", top: -5, left: 0, width: "100%",
               opacity: 0, cursor: "pointer", height: 16, margin: 0 },
  numInput:  {
    width: 72, background: "#16161D",
    border: "0.5px solid #2A2A33", borderRadius: 8,
    color: "#fff", padding: "5px 8px", fontSize: 13, textAlign: "center",
  },
  btn: {
    marginTop: "1rem", background: "#3B82F6", color: "#fff",
    border: "none", borderRadius: 10, padding: "11px 28px",
    fontSize: 14, fontWeight: 500, cursor: "pointer", width: "100%",
  },
  msg: { marginTop: "0.75rem", fontSize: 13, textAlign: "center" },
  sectionHead: { fontSize: 13, fontWeight: 600, color: "#F59E0B",
                 margin: "0.5rem 0 1.25rem", paddingTop: "1rem",
                 borderTop: "0.5px solid #2A2A33" },
  toggleRow: { display: "flex", justifyContent: "space-between",
               alignItems: "center", marginBottom: "1.25rem", gap: 12 },
  toggleHint: { fontSize: 11, color: "#6B7280", marginTop: 3 },
  toggle: { border: "none", borderRadius: 8, padding: "6px 18px",
            fontSize: 12, fontWeight: 700, cursor: "pointer",
            minWidth: 58, letterSpacing: 0.5 },
  toggleOn:  { background: "#4ADE80", color: "#052e16" },
  toggleOff: { background: "#2A2A33", color: "#9CA3AF" },
};
