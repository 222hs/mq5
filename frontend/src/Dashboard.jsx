import { useEffect, useState, useRef } from "react";

const API_URL = import.meta.env.VITE_API_URL || "";

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`${API_URL}/api/dashboard`);
        if (!res.ok) throw new Error("Failed to fetch");
        const json = await res.json();
        setData(json);
        setError(null);
      } catch (e) {
        setError("تعذر الاتصال بالسيرفر");
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return <div style={styles.errorBox}>{error}</div>;
  }

  if (!data) {
    return <div style={styles.loading}>جاري التحميل...</div>;
  }

  const { account, positions, history, stats, is_online } = data;

  return (
    <div>
      <TradingSessions />

      <div style={styles.statusRow}>
        <span style={{ ...styles.dot, background: is_online ? "#4ADE80" : "#F87171" }} />
        <span style={styles.statusText}>
          {is_online ? "البوت متصل" : "البوت غير متصل"}
          {account?.server ? ` · ${account.server}` : ""}
        </span>
      </div>

      <div style={styles.metricsGrid}>
        <MetricCard label="الرصيد"             value={`$${account?.balance?.toFixed(2) ?? "—"}`} />
        <MetricCard label="الإكويتي"            value={`$${account?.equity?.toFixed(2) ?? "—"}`} />
        <MetricCard
          label="الربح/الخسارة الحالي"
          value={`$${account?.profit?.toFixed(2) ?? "0.00"}`}
          positive={account?.profit >= 0}
        />
        <MetricCard label="نسبة الفوز" value={`${stats?.win_rate ?? 0}%`} />
      </div>

      <SectionTitle>الصفقات المفتوحة</SectionTitle>
      <Table
        headers={["الرمز", "النوع", "الحجم", "سعر الفتح", "الربح/الخسارة"]}
        rows={(positions || []).map((p) => [
          p.symbol,
          p.type === "BUY" ? "شراء" : "بيع",
          p.volume,
          p.price_open,
          <span style={{ color: p.profit >= 0 ? "#4ADE80" : "#F87171" }}>
            ${p.profit?.toFixed(2)}
          </span>,
        ])}
        empty="لا توجد صفقات مفتوحة"
      />

      <SectionTitle>آخر الصفقات</SectionTitle>
      <Table
        headers={["الرمز", "النوع", "الحجم", "التاريخ", "الربح/الخسارة"]}
        rows={(history || []).slice(0, 10).map((h) => [
          h.symbol,
          h.type === "BUY" ? "شراء" : "بيع",
          h.volume,
          new Date(h.time).toLocaleDateString("ar"),
          <span style={{ color: h.profit >= 0 ? "#4ADE80" : "#F87171" }}>
            ${h.profit?.toFixed(2)}
          </span>,
        ])}
        empty="لا توجد صفقات سابقة"
      />

      <div style={styles.statsRow}>
        <StatPill label="إجمالي الصفقات" value={stats?.total_trades ?? 0} />
        <StatPill label="رابحة"           value={stats?.wins ?? 0}         color="#4ADE80" />
        <StatPill label="خاسرة"           value={stats?.losses ?? 0}       color="#F87171" />
        <StatPill
          label="صافي الربح"
          value={`$${stats?.total_profit ?? 0}`}
          color={stats?.total_profit >= 0 ? "#4ADE80" : "#F87171"}
        />
      </div>
    </div>
  );
}

function MetricCard({ label, value, positive }) {
  return (
    <div style={styles.metricCard}>
      <p style={styles.metricLabel}>{label}</p>
      <p style={{
        ...styles.metricValue,
        color: positive === undefined ? "#fff" : positive ? "#4ADE80" : "#F87171",
      }}>
        {value}
      </p>
    </div>
  );
}

function SectionTitle({ children }) {
  return <p style={styles.sectionTitle}>{children}</p>;
}

function Table({ headers, rows, empty }) {
  return (
    <div style={styles.tableWrap}>
      <div style={{ ...styles.tableRow, ...styles.tableHeader }}>
        {headers.map((h, i) => <span key={i}>{h}</span>)}
      </div>
      {rows.length === 0
        ? <div style={styles.emptyRow}>{empty}</div>
        : rows.map((row, i) => (
            <div key={i} style={styles.tableRow}>
              {row.map((cell, j) => <span key={j}>{cell}</span>)}
            </div>
          ))
      }
    </div>
  );
}

// ── Trading Sessions Widget ──────────────────────────────────────
const SESSIONS = [
  { name: "طوكيو",        open: 0,  close: 9,  color: "#818CF8", quality: "ضعيف للذهب" },
  { name: "لندن",         open: 8,  close: 17, color: "#34D399", quality: "جيد" },
  { name: "نيويورك",      open: 13, close: 22, color: "#F59E0B", quality: "جيد" },
  { name: "تداخل L+NY",  open: 13, close: 17, color: "#F97316", quality: "الأفضل للذهب" },
];

function TradingSessions() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const utcH = now.getUTCHours() + now.getUTCMinutes() / 60;

  const isActive = (open, close) => {
    if (open < close) return utcH >= open && utcH < close;
    return utcH >= open || utcH < close;
  };

  const nextOpen = (open) => {
    const diff = open > utcH ? open - utcH : 24 - utcH + open;
    const h = Math.floor(diff);
    const m = Math.round((diff - h) * 60);
    return h > 0 ? `${h}س ${m}د` : `${m}د`;
  };

  const utcStr = `${String(now.getUTCHours()).padStart(2,"0")}:${String(now.getUTCMinutes()).padStart(2,"0")} UTC`;

  return (
    <div style={ss.wrap}>
      <div style={ss.header}>
        <span style={ss.title}>أوقات التداول</span>
        <span style={ss.clock}>{utcStr}</span>
      </div>
      <div style={ss.grid}>
        {SESSIONS.map((s) => {
          const active = isActive(s.open, s.close);
          return (
            <div key={s.name} style={{ ...ss.card, borderColor: active ? s.color : "#2A2A33" }}>
              <div style={ss.cardTop}>
                <span style={{ ...ss.dot2, background: active ? s.color : "#374151" }} />
                <span style={{ ...ss.name, color: active ? s.color : "#9CA3AF" }}>{s.name}</span>
              </div>
              <div style={ss.time}>
                {String(s.open).padStart(2,"0")}:00 – {String(s.close).padStart(2,"0")}:00
              </div>
              <div style={{ ...ss.badge, background: active ? s.color + "22" : "#16161D",
                            color: active ? s.color : "#6B7280" }}>
                {active ? `نشط · ${s.quality}` : `يفتح بعد ${nextOpen(s.open)}`}
              </div>
            </div>
          );
        })}
      </div>
      <div style={ss.hint}>
        الأوقات بتوقيت UTC · أفضل وقت للذهب: <span style={{color:"#F97316",fontWeight:600}}>13:00–17:00 UTC</span>
      </div>
    </div>
  );
}

const ss = {
  wrap:   { background:"#0F0F16", border:"0.5px solid #2A2A33", borderRadius:14,
            padding:"1rem 1.25rem", marginBottom:"1.5rem" },
  header: { display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"0.75rem" },
  title:  { fontSize:14, fontWeight:600, color:"#fff" },
  clock:  { fontSize:12, color:"#6B7280", fontVariantNumeric:"tabular-nums" },
  grid:   { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:10 },
  card:   { background:"#16161D", borderRadius:10, padding:"0.75rem",
            border:"1px solid #2A2A33", transition:"border-color .3s" },
  cardTop:{ display:"flex", alignItems:"center", gap:6, marginBottom:4 },
  dot2:   { width:7, height:7, borderRadius:"50%", flexShrink:0 },
  name:   { fontSize:13, fontWeight:500 },
  time:   { fontSize:11, color:"#6B7280", marginBottom:6, fontVariantNumeric:"tabular-nums" },
  badge:  { fontSize:11, borderRadius:6, padding:"2px 8px", display:"inline-block" },
  hint:   { fontSize:11, color:"#6B7280", marginTop:"0.75rem", textAlign:"center" },
};
// ─────────────────────────────────────────────────────────────────

function StatPill({ label, value, color = "#fff" }) {
  return (
    <div style={styles.statPill}>
      <p style={styles.statLabel}>{label}</p>
      <p style={{ ...styles.statValue, color }}>{value}</p>
    </div>
  );
}

const styles = {
  statusRow:   { display: "flex", alignItems: "center", gap: 10, marginBottom: "1.5rem" },
  dot:         { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  statusText:  { fontSize: 14, color: "#9CA3AF" },
  metricsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: "2rem" },
  metricCard:  { background: "#16161D", borderRadius: 12, padding: "1rem 1.25rem", border: "0.5px solid #2A2A33" },
  metricLabel: { fontSize: 13, color: "#9CA3AF", margin: "0 0 6px" },
  metricValue: { fontSize: 24, fontWeight: 500, margin: 0 },
  sectionTitle:{ fontSize: 15, fontWeight: 500, margin: "1.5rem 0 8px" },
  tableWrap:   { border: "0.5px solid #2A2A33", borderRadius: 12, overflow: "hidden" },
  tableRow:    { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", padding: "10px 14px", fontSize: 13, borderTop: "0.5px solid #2A2A33", alignItems: "center" },
  tableHeader: { background: "#16161D", fontSize: 12, color: "#9CA3AF", borderTop: "none" },
  emptyRow:    { padding: "1.5rem", textAlign: "center", color: "#6B7280", fontSize: 13 },
  statsRow:    { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginTop: "1.5rem" },
  statPill:    { background: "#16161D", borderRadius: 12, padding: "0.875rem 1rem", border: "0.5px solid #2A2A33", textAlign: "center" },
  statLabel:   { fontSize: 12, color: "#9CA3AF", margin: "0 0 4px" },
  statValue:   { fontSize: 18, fontWeight: 500, margin: 0 },
  loading:     { textAlign: "center", padding: "4rem", color: "#9CA3AF" },
  errorBox:    { textAlign: "center", padding: "2rem", background: "#1F1212", color: "#F87171", borderRadius: 12, maxWidth: 400, margin: "4rem auto" },
};
