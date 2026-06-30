import { useEffect, useState } from "react";

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
    return (
      <div style={styles.page}>
        <div style={styles.errorBox}>{error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={styles.page}>
        <div style={styles.loading}>جاري التحميل...</div>
      </div>
    );
  }

  const { account, positions, history, stats, is_online } = data;

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div style={styles.statusRow}>
            <span
              style={{
                ...styles.dot,
                background: is_online ? "#4ADE80" : "#F87171",
              }}
            />
            <span style={styles.statusText}>
              {is_online ? "البوت متصل" : "البوت غير متصل"}
              {account?.server ? ` · ${account.server}` : ""}
            </span>
          </div>
        </div>

        <div style={styles.metricsGrid}>
          <MetricCard label="الرصيد" value={`$${account?.balance?.toFixed(2) ?? "—"}`} />
          <MetricCard label="الإكويتي" value={`$${account?.equity?.toFixed(2) ?? "—"}`} />
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
          <StatPill label="رابحة" value={stats?.wins ?? 0} color="#4ADE80" />
          <StatPill label="خاسرة" value={stats?.losses ?? 0} color="#F87171" />
          <StatPill
            label="صافي الربح"
            value={`$${stats?.total_profit ?? 0}`}
            color={stats?.total_profit >= 0 ? "#4ADE80" : "#F87171"}
          />
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, positive }) {
  return (
    <div style={styles.metricCard}>
      <p style={styles.metricLabel}>{label}</p>
      <p
        style={{
          ...styles.metricValue,
          color: positive === undefined ? "#FFFFFF" : positive ? "#4ADE80" : "#F87171",
        }}
      >
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
      <div style={{ ...styles.tableRow, ...styles.tableHeaderRow }}>
        {headers.map((h, i) => (
          <span key={i} style={styles.tableHeaderCell}>
            {h}
          </span>
        ))}
      </div>
      {rows.length === 0 ? (
        <div style={styles.emptyRow}>{empty}</div>
      ) : (
        rows.map((row, i) => (
          <div key={i} style={styles.tableRow}>
            {row.map((cell, j) => (
              <span key={j} style={styles.tableCell}>
                {cell}
              </span>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

function StatPill({ label, value, color = "#FFFFFF" }) {
  return (
    <div style={styles.statPill}>
      <p style={styles.statPillLabel}>{label}</p>
      <p style={{ ...styles.statPillValue, color }}>{value}</p>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#0B0B10",
    color: "#FFFFFF",
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    direction: "rtl",
    padding: "2rem 1rem",
  },
  container: { maxWidth: 900, margin: "0 auto" },
  header: { marginBottom: "1.5rem" },
  statusRow: { display: "flex", alignItems: "center", gap: 10 },
  dot: { width: 8, height: 8, borderRadius: "50%" },
  statusText: { fontSize: 14, color: "#9CA3AF" },
  metricsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 12,
    marginBottom: "2rem",
  },
  metricCard: {
    background: "#16161D",
    borderRadius: 12,
    padding: "1rem 1.25rem",
    border: "0.5px solid #2A2A33",
  },
  metricLabel: { fontSize: 13, color: "#9CA3AF", margin: "0 0 6px" },
  metricValue: { fontSize: 24, fontWeight: 500, margin: 0 },
  sectionTitle: { fontSize: 15, fontWeight: 500, margin: "1.5rem 0 8px" },
  tableWrap: {
    border: "0.5px solid #2A2A33",
    borderRadius: 12,
    overflow: "hidden",
  },
  tableRow: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    padding: "10px 14px",
    fontSize: 13,
    borderTop: "0.5px solid #2A2A33",
    alignItems: "center",
  },
  tableHeaderRow: {
    background: "#16161D",
    fontSize: 12,
    color: "#9CA3AF",
    borderTop: "none",
  },
  tableHeaderCell: {},
  tableCell: {},
  emptyRow: {
    padding: "1.5rem",
    textAlign: "center",
    color: "#6B7280",
    fontSize: 13,
  },
  statsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 12,
    marginTop: "1.5rem",
  },
  statPill: {
    background: "#16161D",
    borderRadius: 12,
    padding: "0.875rem 1rem",
    border: "0.5px solid #2A2A33",
    textAlign: "center",
  },
  statPillLabel: { fontSize: 12, color: "#9CA3AF", margin: "0 0 4px" },
  statPillValue: { fontSize: 18, fontWeight: 500, margin: 0 },
  loading: { textAlign: "center", padding: "4rem", color: "#9CA3AF" },
  errorBox: {
    textAlign: "center",
    padding: "2rem",
    background: "#1F1212",
    color: "#F87171",
    borderRadius: 12,
    maxWidth: 400,
    margin: "4rem auto",
  },
};
