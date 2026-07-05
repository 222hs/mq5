import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "";

export default function Analysis() {
  const [history, setHistory] = useState([]);

  useEffect(() => {
    fetch(`${API_URL}/api/dashboard`)
      .then((r) => r.json())
      .then((d) => setHistory(d.history || []));
  }, []);

  if (!history.length)
    return <div style={s.empty}>لا توجد بيانات كافية للتحليل</div>;

  // ── تجميع حسب الساعة (UTC) ──
  const hourly = Array.from({ length: 24 }, (_, i) => ({
    hour: i, wins: 0, losses: 0, profit: 0,
  }));

  history.forEach((t) => {
    const h = new Date(t.time).getUTCHours();
    if (t.profit > 0) hourly[h].wins++;
    else              hourly[h].losses++;
    hourly[h].profit += t.profit || 0;
  });

  // فلتر الساعات اللي فيها صفقات فقط
  const active = hourly.filter((h) => h.wins + h.losses > 0);
  const maxTrades = Math.max(...active.map((h) => h.wins + h.losses), 1);

  const sessionOf = (h) => {
    if (h >= 13 && h < 17) return { label: "L+NY", color: "#F97316" };
    if (h >= 13 && h < 22) return { label: "NY",   color: "#F59E0B" };
    if (h >=  8 && h < 17) return { label: "لندن", color: "#34D399" };
    if (h >=  0 && h <  9) return { label: "طوكيو",color: "#818CF8" };
    return { label: "—", color: "#6B7280" };
  };

  // ── ملخص أفضل وأسوأ ساعة ──
  const sorted = [...active].sort((a, b) => {
    const wr = (x) => x.wins / (x.wins + x.losses);
    return wr(b) - wr(a);
  });
  const best  = sorted[0];
  const worst = sorted[sorted.length - 1];

  return (
    <div>
      <p style={s.title}>📈 تحليل أداء البوت حسب الوقت (UTC)</p>
      <p style={s.sub}>بناءً على {history.length} صفقة مسجلة</p>

      {/* ملخص */}
      <div style={s.summaryRow}>
        {best && (
          <div style={{ ...s.summaryCard, borderColor: "#4ADE80" }}>
            <p style={s.summaryLabel}>✅ أفضل ساعة</p>
            <p style={{ ...s.summaryVal, color: "#4ADE80" }}>
              {String(best.hour).padStart(2,"0")}:00 – {String(best.hour+1).padStart(2,"0")}:00
            </p>
            <p style={s.summaryNote}>
              {best.wins}ر / {best.losses}خ · {Math.round(best.wins/(best.wins+best.losses)*100)}% فوز
            </p>
          </div>
        )}
        {worst && (
          <div style={{ ...s.summaryCard, borderColor: "#F87171" }}>
            <p style={s.summaryLabel}>❌ أسوأ ساعة</p>
            <p style={{ ...s.summaryVal, color: "#F87171" }}>
              {String(worst.hour).padStart(2,"0")}:00 – {String(worst.hour+1).padStart(2,"0")}:00
            </p>
            <p style={s.summaryNote}>
              {worst.wins}ر / {worst.losses}خ · {Math.round(worst.wins/(worst.wins+worst.losses)*100)}% فوز
            </p>
          </div>
        )}
      </div>

      {/* جدول الساعات */}
      <div style={s.tableWrap}>
        <div style={{ ...s.row, ...s.header }}>
          <span>الوقت (UTC)</span>
          <span>الجلسة</span>
          <span>رابحة / خاسرة</span>
          <span>نسبة الفوز</span>
          <span>الربح الكلي</span>
          <span>الأداء</span>
        </div>

        {active
          .sort((a, b) => a.hour - b.hour)
          .map((h) => {
            const total  = h.wins + h.losses;
            const wr     = Math.round((h.wins / total) * 100);
            const sess   = sessionOf(h.hour);
            const barW   = Math.round((total / maxTrades) * 100);
            const winW   = Math.round((h.wins / total) * barW);
            const lossW  = barW - winW;
            const good   = wr >= 60;
            const bad    = wr < 40;

            return (
              <div key={h.hour} style={s.row}>
                {/* وقت */}
                <span style={s.timeCell}>
                  {String(h.hour).padStart(2,"0")}:00
                  <span style={s.timeSub}>– {String(h.hour+1).padStart(2,"0")}:00</span>
                </span>

                {/* جلسة */}
                <span style={{ ...s.badge, background: sess.color+"22", color: sess.color }}>
                  {sess.label}
                </span>

                {/* رابحة/خاسرة */}
                <span>
                  <span style={{ color:"#4ADE80" }}>{h.wins}ر</span>
                  {" / "}
                  <span style={{ color:"#F87171" }}>{h.losses}خ</span>
                </span>

                {/* نسبة */}
                <span style={{ color: good?"#4ADE80": bad?"#F87171":"#F59E0B", fontWeight:600 }}>
                  {wr}%
                </span>

                {/* ربح كلي */}
                <span style={{ color: h.profit>=0?"#4ADE80":"#F87171", fontSize:12 }}>
                  {h.profit>=0?"+":""}{h.profit.toFixed(2)}$
                </span>

                {/* بار */}
                <span style={s.barWrap}>
                  <span style={{ ...s.barFill, width: winW+"%",  background:"#4ADE80" }} />
                  <span style={{ ...s.barFill, width: lossW+"%", background:"#F87171" }} />
                </span>
              </div>
            );
          })}
      </div>

      <p style={s.hint}>
        🟢 ≥60% فوز · 🟡 40–59% · 🔴 &lt;40% · الأعمدة تمثل حجم النشاط
      </p>
    </div>
  );
}

const s = {
  title:       { fontSize:16, fontWeight:600, margin:"0 0 4px" },
  sub:         { fontSize:12, color:"#6B7280", margin:"0 0 1.25rem" },
  empty:       { textAlign:"center", padding:"4rem", color:"#6B7280" },
  summaryRow:  { display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:"1.5rem" },
  summaryCard: { background:"#16161D", border:"1px solid", borderRadius:12,
                 padding:"1rem 1.25rem" },
  summaryLabel:{ fontSize:13, color:"#9CA3AF", margin:"0 0 6px" },
  summaryVal:  { fontSize:22, fontWeight:600, margin:"0 0 4px", fontVariantNumeric:"tabular-nums" },
  summaryNote: { fontSize:12, color:"#6B7280", margin:0 },
  tableWrap:   { border:"0.5px solid #2A2A33", borderRadius:12, overflow:"hidden" },
  row:         { display:"grid",
                 gridTemplateColumns:"1fr 0.7fr 1fr 0.7fr 0.9fr 1.5fr",
                 padding:"9px 14px", fontSize:13,
                 borderTop:"0.5px solid #2A2A33", alignItems:"center", gap:4 },
  header:      { background:"#16161D", fontSize:11, color:"#9CA3AF", borderTop:"none" },
  timeCell:    { fontVariantNumeric:"tabular-nums", fontWeight:500 },
  timeSub:     { color:"#6B7280", fontSize:11, marginRight:2 },
  badge:       { borderRadius:5, padding:"2px 7px", fontSize:11, display:"inline-block" },
  barWrap:     { display:"flex", height:8, borderRadius:4, overflow:"hidden",
                 background:"#1F1F2E" },
  barFill:     { height:"100%", transition:"width .3s" },
  hint:        { fontSize:11, color:"#6B7280", textAlign:"center", marginTop:"0.75rem" },
};
