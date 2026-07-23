"""
XAUUSDm_meanrev_backtest.py — استراتيجية العودة للمتوسط (mean-reversion) للذهب.

الخلفية (بالدليل، من معمل الاختبار):
    الاستراتيجية القديمة (momentum: تشتري القوة) حافتها سالبة على ذهب M5 —
    قياس الحافة الخام أظهر أن السعر يرتدّ ضد إشارة الشراء خلال 3–6 شموع.
    الذهب على الفريمات القصيرة يعود للمتوسط. فهذه النسخة تعكس الاتجاه:
    تشتري التشبّع البيعي (RSI منخفض) وتبيع التشبّع الشرائي (RSI عالي).

منهجية صارمة ضد الـ overfitting:
    * walk-forward: نبحث عن الإعداد على train (أول 60%)، ونتحقّق مرة واحدة
      فقط على test (آخر 40%) — لا تلصّص على العيّنة.
    * robustness: نطبع أداء أفضل 5 إعدادات على test، لا الأفضل وحده — لو
      كلهم قريبين فالحافة حقيقية (هضبة)، لو الأفضل شاذّ فهو صدفة (شوكة).
    * baseline = المنطق القديم (momentum) بالظبط، للمقارنة الشريفة.
    * القرار النهائي تحكمه بوابة الترقية في الـ backend، لا هذا السكربت.

التشغيل (على OpenClaw/Windows بعد تصدير XAUUSDm M5 من MT5):
    set BACKEND_URL=https://mq5-production.up.railway.app
    set API_KEY=<نفس مفتاح Railway>
    set BACKTEST_DATA=data\\XAUUSDm_M5.csv
    python XAUUSDm_meanrev_backtest.py
"""
import os, json, math, itertools, urllib.request
from dataclasses import dataclass, asdict
from pathlib import Path
import numpy as np
import pandas as pd

# ————— ثوابت السوق (مطابقة للسكربت الإنتاجي القديم) —————
POINT = 0.01
LOT_SIZE = 0.5
USD_PER_PRICE_PER_LOT = 100.0
INITIAL_CASH = 10_000.0
MAX_SPREAD_POINTS = 350
MAX_POSITIONS = 5
MAX_DAILY_LOSS = 50.0
MAX_DAILY_PROFIT = 200.0

DATA_FILE = Path(os.environ.get("BACKTEST_DATA", "data/XAUUSDm_M5.csv"))
TIMEFRAME = os.environ.get("BACKTEST_TF", "5min")   # 5min أو 15min
OUTPUT_DIR = Path("results"); OUTPUT_DIR.mkdir(exist_ok=True)


@dataclass(frozen=True)
class Params:
    # دخول عودة-للمتوسط
    rsi_os: float = 30.0        # اشترِ تحت هذا (تشبّع بيعي)
    rsi_ob: float = 70.0        # بِع فوق هذا (تشبّع شرائي)
    atr_mult: float = 1.5       # مسافة الـ SL = ATR × هذا
    tp_rr: float = 1.0          # TP = SL × هذا
    trend_filter: bool = False  # لو True: لا تشترِ إلا فوق EMA200 والعكس (اختياري)


# ————————————————— تحميل البيانات —————————————————
def load_data() -> pd.DataFrame:
    df = pd.read_csv(DATA_FILE)
    cols = set(df.columns)
    # صيغة Dukascopy (bid/ask): نبني OHLC من bid والسبريد الحقيقي من ask−bid.
    if {"bid_close", "ask_close"} <= cols:
        df["time"] = pd.to_datetime(df["timestamp"], utc=True)
        df = df.set_index("time").sort_index()
        df = df[(df["bid_close"] > 0) & (df["ask_close"] >= df["bid_close"])]
        out = pd.DataFrame({
            "open": df["bid_open"], "high": df["bid_high"], "low": df["bid_low"],
            "close": df["bid_close"], "volume": df["bid_volume"],
            "spread": (df["ask_close"] - df["bid_close"]) / POINT,
        })
    else:
        # صيغة تصدير MT5 القياسية: time, open, high, low, close, volume, spread
        tcol = "time" if "time" in cols else "timestamp"
        df["time"] = pd.to_datetime(df[tcol], utc=True)
        df = df.set_index("time").sort_index()
        num = ["open", "high", "low", "close", "volume", "spread"]
        df[num] = df[num].apply(pd.to_numeric, errors="coerce")
        out = df[num].dropna(subset=["open", "high", "low", "close", "spread"])
    out = out[~out.index.duplicated(keep="first")]
    # إعادة العيّنة للفريم المطلوب لو أكبر من M5
    if TIMEFRAME not in ("5min", "5T"):
        out = out.resample(TIMEFRAME).agg(
            {"open": "first", "high": "max", "low": "min", "close": "last",
             "volume": "sum", "spread": "mean"}).dropna()
    return out


def rsi_wilder(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / period, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / period, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(50)


def add_indicators(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    pc = out["close"].shift(1)
    tr = pd.concat([out["high"] - out["low"], (out["high"] - pc).abs(),
                    (out["low"] - pc).abs()], axis=1).max(axis=1)
    out["atr"] = tr.ewm(alpha=1 / 14, adjust=False).mean()
    out["rsi"] = rsi_wilder(out["close"])
    out["ema200"] = out["close"].ewm(span=200, adjust=False).mean()
    return out.dropna(subset=["atr"])


# ————————————————— الإشارة والمحاكاة —————————————————
def make_signal(df: pd.DataFrame, p: Params) -> np.ndarray:
    buy = df["rsi"] <= p.rsi_os          # اشترِ التشبّع البيعي
    sell = df["rsi"] >= p.rsi_ob         # بِع التشبّع الشرائي
    if p.trend_filter:                    # اختياري: لا تعاند الاتجاه الكبير
        buy &= df["close"] >= df["ema200"]
        sell &= df["close"] <= df["ema200"]
    return np.select([buy, sell], [1, -1], default=0).astype(np.int8)


def simulate(df: pd.DataFrame, p: Params):
    sig = make_signal(df, p)
    times = df.index.to_numpy(); days = df.index.date
    o = df["open"].to_numpy(); h = df["high"].to_numpy()
    l = df["low"].to_numpy(); c = df["close"].to_numpy()
    sp = df["spread"].to_numpy(); atr = df["atr"].to_numpy()
    active, trades = [], []
    equity = INITIAL_CASH; curve = np.full(len(df), equity, float)
    cur_day, day_pnl = None, 0.0
    upp = LOT_SIZE * USD_PER_PRICE_PER_LOT
    for i in range(1, len(df)):
        d = days[i]
        if d != cur_day:
            cur_day, day_pnl = d, 0.0
        spx = sp[i] * POINT; surv = []
        for pos in active:
            side = pos["side"]; ex = None; reason = None
            if side == 1:
                if l[i] <= pos["sl"]: ex, reason = pos["sl"], "SL"
                elif h[i] >= pos["tp"]: ex, reason = pos["tp"], "TP"
            else:
                if h[i] + spx >= pos["sl"]: ex, reason = pos["sl"], "SL"
                elif l[i] + spx <= pos["tp"]: ex, reason = pos["tp"], "TP"
            if ex is None:
                surv.append(pos); continue
            pnl = (ex - pos["entry"]) * side * upp
            equity += pnl; day_pnl += pnl
            trades.append({"side": side, "pnl_usd": pnl, "risk_usd": pos["risk_usd"],
                           "r": pnl / pos["risk_usd"], "reason": reason})
        active = surv
        ps = int(sig[i - 1])
        ok = (ps != 0 and sp[i] <= MAX_SPREAD_POINTS and len(active) < MAX_POSITIONS
              and -MAX_DAILY_LOSS < day_pnl < MAX_DAILY_PROFIT)
        if ok:
            dist = max(atr[i - 1] * p.atr_mult, 10 * POINT)
            if ps == 1:
                entry = o[i] + spx; sl = entry - dist; tp = entry + dist * p.tp_rr
            else:
                entry = o[i]; sl = entry + dist; tp = entry - dist * p.tp_rr
            active.append({"side": ps, "entry": entry, "sl": sl, "tp": tp,
                           "risk_usd": dist * upp})
        curve[i] = equity
    for pos in active:
        ex = c[-1] if pos["side"] == 1 else c[-1] + sp[-1] * POINT
        pnl = (ex - pos["entry"]) * pos["side"] * upp; equity += pnl
        trades.append({"side": pos["side"], "pnl_usd": pnl, "risk_usd": pos["risk_usd"],
                       "r": pnl / pos["risk_usd"], "reason": "END"})
    curve[-1] = equity
    return pd.DataFrame(trades), pd.Series(curve, index=df.index)


def metrics(trades: pd.DataFrame, curve: pd.Series) -> dict:
    if trades.empty:
        return {"trades": 0, "net_usd": 0.0, "return_pct": 0.0, "win_rate": 0.0,
                "profit_factor": 0.0, "max_drawdown_pct": 0.0, "sharpe": 0.0}
    wins = trades.loc[trades.pnl_usd > 0, "pnl_usd"].sum()
    losses = -trades.loc[trades.pnl_usd < 0, "pnl_usd"].sum()
    dd = curve / curve.cummax() - 1
    daily = curve.resample("1D").last().dropna().pct_change().dropna()
    sharpe = math.sqrt(252) * daily.mean() / daily.std() if daily.std() > 0 else 0.0
    net = float(trades.pnl_usd.sum())
    return {"trades": int(len(trades)), "net_usd": net,
            "return_pct": float(net / INITIAL_CASH * 100),
            "win_rate": float((trades.pnl_usd > 0).mean() * 100),
            "profit_factor": float(wins / losses) if losses > 0 else 99.9,
            "max_drawdown_pct": float(dd.min() * 100), "sharpe": float(sharpe)}


def robust_score(m: dict) -> float:
    """درجة اختيار على train: تعاقب قلّة الصفقات والتراجع العميق."""
    if m["trades"] < 80 or m["max_drawdown_pct"] <= -25:
        return -1e9
    return m["sharpe"] + m["profit_factor"] + m["return_pct"] / 100 - abs(m["max_drawdown_pct"]) / 20


# —— المنطق القديم (momentum) للمقارنة الشريفة كـ baseline ——
def momentum_signal(df: pd.DataFrame) -> np.ndarray:
    rng = (df["high"] - df["low"]).replace(0, np.nan)
    bull = (df["close"] > df["open"]) & ((df["close"] - df["open"]) / rng >= 0.25) & (rng <= 5 * df["atr"])
    bear = (df["close"] < df["open"]) & ((df["open"] - df["close"]) / rng >= 0.25) & (rng <= 5 * df["atr"])
    return np.select([bull & (df["rsi"] <= 65), bear & (df["rsi"] >= 35)], [1, -1], default=0).astype(np.int8)


def simulate_baseline(df: pd.DataFrame):
    global make_signal
    saved = make_signal
    make_signal = lambda _df, _p: momentum_signal(_df)
    try:
        return simulate(df, Params())
    finally:
        make_signal = saved


def main():
    df = add_indicators(load_data())
    n = len(df); split = int(n * 0.6)
    train, test = df.iloc[:split], df.iloc[split:]
    print(f"بيانات {DATA_FILE.name} [{TIMEFRAME}]: {n:,} شمعة  "
          f"({df.index[0].date()} → {df.index[-1].date()})  train={len(train):,} test={len(test):,}")
    print(f"السبريد: وسيط={df['spread'].median():.0f} نقطة  متوسط={df['spread'].mean():.0f}\n")

    # 1) شبكة بحث على train فقط
    grid = [Params(rsi_os=os_, rsi_ob=ob, atr_mult=am, tp_rr=rr, trend_filter=tf)
            for os_, ob in [(25, 75), (30, 70), (35, 65)]
            for am in (1.0, 1.5, 2.0)
            for rr in (1.0, 1.5, 2.0)
            for tf in (False, True)]
    ranked = []
    for p in grid:
        m_tr = metrics(*simulate(train, p))
        ranked.append((robust_score(m_tr), p, m_tr))
    ranked.sort(key=lambda x: x[0], reverse=True)
    best_score, best_p, best_train = ranked[0]

    # 2) تحقّق نظيف: أفضل 5 إعدادات على test (لكشف الصدفة مقابل الهضبة)
    print("═══ robustness: أفضل 5 إعدادات (اختيار على train) وأداؤها على test ═══")
    top_tests = []
    for sc, p, m_tr in ranked[:5]:
        m_te = metrics(*simulate(test, p))
        top_tests.append(m_te)
        print(f"  os{p.rsi_os:.0f}/ob{p.rsi_ob:.0f} atr{p.atr_mult} rr{p.tp_rr} trend{int(p.trend_filter)}"
              f"  →  test: net=${m_te['net_usd']:>7.0f} PF={m_te['profit_factor']:.2f} "
              f"DD={m_te['max_drawdown_pct']:.1f}% Sharpe={m_te['sharpe']:.2f}")
    med_pf = float(np.median([m["profit_factor"] for m in top_tests]))
    print(f"  → وسيط PF لأفضل 5 على test = {med_pf:.2f}  "
          f"({'هضبة — حافة حقيقية' if med_pf >= 1.1 else 'ضعيف/غير مستقر'})\n")

    # 3) القرار على أفضل إعداد، test خارج العينة
    cand_test = metrics(*simulate(test, best_p))
    base_test = metrics(*simulate_baseline(test))
    print("═══ التحقّق النهائي (test خارج العينة) ═══")
    for name, m in [("baseline (momentum القديم)", base_test), ("candidate (mean-reversion)", cand_test)]:
        print(f"  {name:<28} net=${m['net_usd']:>7.0f}  win={m['win_rate']:.1f}%  "
              f"PF={m['profit_factor']:.2f}  DD={m['max_drawdown_pct']:.1f}%  Sharpe={m['sharpe']:.2f}")

    approved = (cand_test["trades"] >= 150 and cand_test["profit_factor"] >= 1.3
                and cand_test["max_drawdown_pct"] > -20 and cand_test["sharpe"] > 0.3
                and med_pf >= 1.1)
    payload = {
        "strategy": "meanrev_gold", "symbol": "XAUUSDm", "timeframe": TIMEFRAME,
        "validation": "walk_forward",
        "status": "candidate" if approved else "unsafe",
        "generated_at": pd.Timestamp.now(tz="UTC").isoformat(),
        "data": {"bars": n, "start": str(df.index[0].date()), "end": str(df.index[-1].date())},
        "baseline": base_test,
        "candidate": {"params": {
            "rsi_buy_max": best_p.rsi_os,    # يُطبَّق كـ RSIBuyMax في الـ EA
            "rsi_sell_min": best_p.rsi_ob,   # يُطبَّق كـ RSISellMin
            "atr_mult": best_p.atr_mult,
        }, **cand_test},
        "decision": "approved" if approved else "rejected",
        "reason": (f"Mean-reversion candidate passed walk-forward (test PF={cand_test['profit_factor']:.2f}, "
                   f"top-5 median PF={med_pf:.2f})." if approved else
                   f"Candidate not robust enough (test PF={cand_test['profit_factor']:.2f} < 1.3 "
                   f"or top-5 median={med_pf:.2f}); promotion blocked by gate."),
    }
    (OUTPUT_DIR / "meanrev_result.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    print(f"\n→ قرار السكربت: {payload['decision'].upper()}  |  {payload['reason']}")

    backend_url = os.environ.get("BACKEND_URL", "").rstrip("/")
    api_key = os.environ.get("API_KEY", "")
    if backend_url and api_key:
        req = urllib.request.Request(f"{backend_url}/api/backtest/result",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "X-API-Key": api_key}, method="POST")
        with urllib.request.urlopen(req, timeout=30) as r:
            print(f"رفع للداشبورد: HTTP {r.status} — بوابة الترقية هي الحَكَم النهائي.")
    else:
        print("(لم يُرفع: BACKEND_URL/API_KEY غير مضبوطين — شغّلهما على OpenClaw للرفع.)")


if __name__ == "__main__":
    main()
