import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "";

const n = (value, digits = 2) => Number(value ?? 0).toFixed(digits);

function Metric({ label, value, tone = "neutral" }) {
  const color = tone === "good" ? "#4ADE80" : tone === "bad" ? "#F87171" : "#F8C15C";
  return (
    <div style={s.metric}>
      <span style={s.metricLabel}>{label}</span>
      <strong style={{ ...s.metricValue, color }}>{value}</strong>
    </div>
  );
}

function ResultPanel({ title, result }) {
  if (!result) return null;
  const safe = Number(result.profit_factor) >= 1.2 && Number(result.max_drawdown_pct) > -15;
  return (
    <section style={s.panel}>
      <div style={s.panelHead}>
        <h2 style={s.panelTitle}>{title}</h2>
        <span style={{ ...s.badge, color: safe ? "#4ADE80" : "#F87171" }}>
          {safe ? "مقبول مبدئياً" : "غير آمن"}
        </span>
      </div>
      <div style={s.metrics}>
        <Metric label="عدد الصفقات" value={result.trades ?? 0} />
        <Metric label="صافي النتيجة" value={`$${n(result.net_usd)}`} tone={result.net_usd >= 0 ? "good" : "bad"} />
        <Metric label="العائد" value={`${n(result.return_pct)}%`} tone={result.return_pct >= 0 ? "good" : "bad"} />
        <Metric label="نسبة الفوز" value={`${n(result.win_rate, 1)}%`} />
        <Metric label="Profit Factor" value={n(result.profit_factor)} tone={result.profit_factor >= 1.2 ? "good" : "bad"} />
        <Metric label="أقصى تراجع" value={`${n(result.max_drawdown_pct, 1)}%`} tone={result.max_drawdown_pct > -15 ? "good" : "bad"} />
        <Metric label="Sharpe" value={n(result.sharpe)} tone={result.sharpe > 0 ? "good" : "bad"} />
      </div>
    </section>
  );
}

export default function Backtest() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`${API_URL}/api/backtest/latest`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (active) { setData(payload); setError(""); }
      } catch (e) {
        if (active) setError(`تعذر تحميل النتيجة: ${e.message}`);
      }
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  if (error) return <main style={s.page}><div style={s.error}>{error}</div></main>;
  if (!data) return <main style={s.page}><div style={s.loading}>جاري تحميل نتائج الباك تست...</div></main>;

  const candidate = data.candidate || {};
  const decisionOk = data.decision === "approved";
  return (
    <main style={s.page} dir="rtl">
      <header style={s.hero}>
        <div>
          <div style={s.kicker}>FASTEST GOLD / WALK-FORWARD</div>
          <h1 style={s.title}>{data.symbol} · {data.timeframe}</h1>
          <p style={s.subtitle}>
            {data.data?.bars?.toLocaleString?.() || data.data?.bars || "—"} شمعة
            {data.data?.start ? ` · ${data.data.start} إلى ${data.data.end}` : ""}
          </p>
        </div>
        <div style={{ ...s.decision, borderColor: decisionOk ? "#4ADE80" : "#F87171" }}>
          <span style={s.decisionLabel}>قرار النظام</span>
          <strong style={{ color: decisionOk ? "#4ADE80" : "#F87171" }}>
            {decisionOk ? "مقبول للاختبار التجريبي" : "مرفوض — لن يطبّق على البوت"}
          </strong>
        </div>
      </header>

      <div style={s.notice}>{data.reason || "لا يوجد تفسير مسجل."}</div>
      <ResultPanel title="الإعدادات الحالية" result={data.baseline} />
      <ResultPanel title="الإعدادات المرشحة" result={candidate} />

      {candidate.params && (
        <section style={s.panel}>
          <h2 style={s.panelTitle}>الإعدادات التي تم اختبارها</h2>
          <div style={s.params}>
            {Object.entries(candidate.params).map(([key, value]) => (
              <div key={key} style={s.param}><span>{key}</span><b>{String(value)}</b></div>
            ))}
          </div>
        </section>
      )}
      <p style={s.foot}>آخر تحديث: {data.stored_at || data.generated_at || "—"} · التطبيق التلقائي معطّل</p>
    </main>
  );
}

const s = {
  page: { minHeight: "100vh", background: "#07090D", color: "#E6EAF0", padding: "28px", fontFamily: "Arial, sans-serif" },
  loading: { color: "#7F8A9A", padding: 40, textAlign: "center" },
  error: { color: "#F87171", padding: 20, border: "1px solid #7F1D1D", background: "#1F0A0A" },
  hero: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, flexWrap: "wrap", marginBottom: 18 },
  kicker: { color: "#F8C15C", font: "700 11px monospace", letterSpacing: 2 },
  title: { margin: "8px 0", fontSize: 30 },
  subtitle: { margin: 0, color: "#7F8A9A" },
  decision: { minWidth: 260, border: "1px solid", background: "#10141C", padding: "14px 18px" },
  decisionLabel: { display: "block", color: "#7F8A9A", fontSize: 11, marginBottom: 6 },
  notice: { borderRight: "3px solid #F8C15C", background: "#15120B", color: "#F6D88E", padding: 14, marginBottom: 18 },
  panel: { background: "#10141C", border: "1px solid #242B38", padding: 18, marginBottom: 16 },
  panelHead: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  panelTitle: { fontSize: 16, margin: "0 0 14px" },
  badge: { fontSize: 11, fontWeight: 700 },
  metrics: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))", gap: 10 },
  metric: { background: "#0A0D12", border: "1px solid #202634", padding: 12 },
  metricLabel: { color: "#7F8A9A", fontSize: 11, display: "block", marginBottom: 7 },
  metricValue: { font: "700 18px monospace" },
  params: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 },
  param: { display: "flex", justifyContent: "space-between", background: "#0A0D12", padding: 10, color: "#9AA4B3" },
  foot: { color: "#5F6876", fontSize: 11, marginTop: 18 },
};
