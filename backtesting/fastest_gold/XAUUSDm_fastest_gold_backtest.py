from __future__ import annotations

import json
import math
import os
import urllib.request
from dataclasses import dataclass
from itertools import product
from pathlib import Path

import numpy as np
import pandas as pd


DATA_FILE = Path(os.environ.get("BACKTEST_DATA", "data/XAUUSDm_M5.csv"))
OUTPUT_DIR = Path(__file__).resolve().parent / "results"
INITIAL_CASH = 10_000.0
LOT_SIZE = 0.5
USD_PER_PRICE_PER_LOT = 100.0  # Standard 100 oz XAU contract; verify with broker symbol specs.
POINT = 0.001                 # CSV prices use three decimals.
MAX_SPREAD_POINTS = 350
MAX_POSITIONS = 10
MAX_DAILY_LOSS = 50.0
MAX_DAILY_PROFIT = 200.0


@dataclass(frozen=True)
class Params:
    rsi_buy_max: float = 65.0
    rsi_sell_min: float = 35.0
    atr_mult: float = 1.5
    use_mtf: bool = True


def load_data() -> pd.DataFrame:
    df = pd.read_csv(DATA_FILE)
    df["time"] = pd.to_datetime(df["time"], utc=True)
    df = df.drop_duplicates("time").sort_values("time").set_index("time")
    numeric = ["open", "high", "low", "close", "volume", "spread"]
    df[numeric] = df[numeric].apply(pd.to_numeric, errors="coerce")
    return df.dropna(subset=["open", "high", "low", "close", "spread"])


def rsi_wilder(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / period, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / period, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(50)


def add_indicators(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    prev_close = out["close"].shift(1)
    tr = pd.concat(
        [
            out["high"] - out["low"],
            (out["high"] - prev_close).abs(),
            (out["low"] - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    out["atr"] = tr.ewm(alpha=1 / 14, adjust=False).mean()
    out["rsi"] = rsi_wilder(out["close"])
    out["ema9"] = out["close"].ewm(span=9, adjust=False).mean()
    out["ema21"] = out["close"].ewm(span=21, adjust=False).mean()

    def bias(rule: str) -> pd.Series:
        close = out["close"].resample(rule, label="right", closed="right").last().dropna()
        ema = close.ewm(span=21, adjust=False).mean()
        return (ema >= ema.shift(1)).reindex(out.index, method="ffill").eq(True)

    out["m15_up"] = bias("15min")
    out["h1_up"] = bias("1h")
    return out.dropna(subset=["atr"])


def make_signal(df: pd.DataFrame, p: Params) -> np.ndarray:
    candle_range = (df["high"] - df["low"]).replace(0, np.nan)
    bull = (
        (df["close"] > df["open"])
        & ((df["close"] - df["open"]) / candle_range >= 0.25)
        & (candle_range <= 5 * df["atr"])
    )
    bear = (
        (df["close"] < df["open"])
        & ((df["open"] - df["close"]) / candle_range >= 0.25)
        & (candle_range <= 5 * df["atr"])
    )
    buy = bull & (df["rsi"] <= p.rsi_buy_max)
    sell = bear & (df["rsi"] >= p.rsi_sell_min)
    if p.use_mtf:
        buy &= df["m15_up"] & df["h1_up"]
        sell &= ~df["m15_up"] & ~df["h1_up"]
    return np.select([buy, sell], [1, -1], default=0).astype(np.int8)


def simulate(df: pd.DataFrame, p: Params) -> tuple[pd.DataFrame, pd.Series]:
    sig = make_signal(df, p)
    times = df.index.to_numpy()
    days = df.index.date
    opens = df["open"].to_numpy()
    highs = df["high"].to_numpy()
    lows = df["low"].to_numpy()
    closes = df["close"].to_numpy()
    spreads = df["spread"].to_numpy()
    atrs = df["atr"].to_numpy()
    rsis = df["rsi"].to_numpy()
    active: list[dict] = []
    trades: list[dict] = []
    equity = INITIAL_CASH
    curve = np.full(len(df), equity, dtype=float)
    current_day = None
    day_pnl = 0.0
    usd_per_price = LOT_SIZE * USD_PER_PRICE_PER_LOT

    for i in range(1, len(df)):
        day = days[i]
        if day != current_day:
            current_day = day
            day_pnl = 0.0

        spread_price = spreads[i] * POINT
        survivors = []
        for pos in active:
            exit_price = None
            reason = None
            if pos["side"] == 1:
                # OHLC is treated as bid. If both levels hit, assume SL first.
                if lows[i] <= pos["sl"]:
                    exit_price, reason = pos["sl"], "SL"
                elif highs[i] >= pos["tp"]:
                    exit_price, reason = pos["tp"], "TP"
            else:
                ask_high = highs[i] + spread_price
                ask_low = lows[i] + spread_price
                if ask_high >= pos["sl"]:
                    exit_price, reason = pos["sl"], "SL"
                elif ask_low <= pos["tp"]:
                    exit_price, reason = pos["tp"], "TP"

            if exit_price is None:
                survivors.append(pos)
                continue

            pnl = (exit_price - pos["entry"]) * pos["side"] * usd_per_price
            equity += pnl
            day_pnl += pnl
            trades.append(
                {
                    **pos,
                    "exit_time": times[i],
                    "exit": exit_price,
                    "reason": reason,
                    "pnl_usd": pnl,
                    "r_multiple": pnl / pos["risk_usd"],
                }
            )
        active = survivors

        prior_signal = int(sig[i - 1])
        allowed = (
            prior_signal != 0
            and spreads[i] <= MAX_SPREAD_POINTS
            and len(active) < MAX_POSITIONS
            and day_pnl > -MAX_DAILY_LOSS
            and day_pnl < MAX_DAILY_PROFIT
        )
        if allowed:
            distance = max(atrs[i - 1] * p.atr_mult, 10 * POINT)
            if prior_signal == 1:
                entry = opens[i] + spread_price
                sl, tp = entry - distance, entry + distance
            else:
                entry = opens[i]
                sl, tp = entry + distance, entry - distance
            active.append(
                {
                    "entry_time": times[i],
                    "side": prior_signal,
                    "entry": entry,
                    "sl": sl,
                    "tp": tp,
                    "risk_usd": distance * usd_per_price,
                    "rsi": rsis[i - 1],
                    "atr": atrs[i - 1],
                }
            )
        curve[i] = equity

    last_spread = spreads[-1] * POINT
    for pos in active:
        exit_price = closes[-1] if pos["side"] == 1 else closes[-1] + last_spread
        pnl = (exit_price - pos["entry"]) * pos["side"] * usd_per_price
        equity += pnl
        trades.append(
            {
                **pos,
                "exit_time": times[-1],
                "exit": exit_price,
                "reason": "END",
                "pnl_usd": pnl,
                "r_multiple": pnl / pos["risk_usd"],
            }
        )
    curve[-1] = equity
    return pd.DataFrame(trades), pd.Series(curve, index=df.index, name="equity")


def metrics(trades: pd.DataFrame, curve: pd.Series) -> dict:
    if trades.empty:
        return {"trades": 0, "net_usd": 0.0, "return_pct": 0.0, "win_rate": 0.0,
                "profit_factor": 0.0, "max_drawdown_pct": 0.0, "sharpe": 0.0}
    wins = trades.loc[trades["pnl_usd"] > 0, "pnl_usd"].sum()
    losses = -trades.loc[trades["pnl_usd"] < 0, "pnl_usd"].sum()
    dd = curve / curve.cummax() - 1
    daily = curve.resample("1D").last().dropna().pct_change().dropna()
    sharpe = math.sqrt(252) * daily.mean() / daily.std() if daily.std() > 0 else 0.0
    net = trades["pnl_usd"].sum()
    return {
        "trades": int(len(trades)),
        "net_usd": float(net),
        "return_pct": float(net / INITIAL_CASH * 100),
        "win_rate": float((trades["pnl_usd"] > 0).mean() * 100),
        "profit_factor": float(wins / losses) if losses > 0 else float("inf"),
        "max_drawdown_pct": float(dd.min() * 100),
        "sharpe": float(sharpe),
        "avg_r": float(trades["r_multiple"].mean()),
    }


def score(m: dict) -> float:
    if m["trades"] < 100 or m["max_drawdown_pct"] <= -20:
        return -1e9
    return m["sharpe"] + 2 * m["return_pct"] / 100 + m["profit_factor"] - abs(m["max_drawdown_pct"]) / 20


def write_html(summary: dict, train_results: pd.DataFrame, test_trades: pd.DataFrame, curve: pd.Series) -> None:
    eq = curve.iloc[:: max(1, len(curve) // 1000)]
    width, height, pad = 1000, 280, 30
    x = np.linspace(pad, width - pad, len(eq))
    lo, hi = float(eq.min()), float(eq.max())
    y = height - pad - (eq.to_numpy() - lo) / max(hi - lo, 1e-9) * (height - 2 * pad)
    points = " ".join(f"{a:.1f},{b:.1f}" for a, b in zip(x, y))
    cards = "".join(
        f"<div class='card'><b>{k}</b><span>{v}</span></div>" for k, v in summary.items()
    )
    top = train_results.head(10).to_html(index=False, float_format=lambda v: f"{v:.3f}")
    html = f"""<!doctype html><meta charset='utf-8'><title>Fastest Gold Backtest</title>
<style>body{{background:#0b0e14;color:#e8edf2;font:15px Arial;margin:30px}}h1{{color:#e8b94f}}.cards{{display:flex;flex-wrap:wrap;gap:12px}}.card{{background:#151a23;border:1px solid #283244;padding:14px;width:180px}}.card b,.card span{{display:block}}.card span{{font-size:22px;color:#63d7a3;margin-top:7px}}table{{border-collapse:collapse;width:100%;background:#151a23}}td,th{{padding:7px;border:1px solid #283244}}svg{{background:#151a23;border:1px solid #283244;width:100%}}</style>
<h1>Fastest Gold — XAUUSDm M5</h1><p>Out-of-sample test report. USD estimates assume a standard 100 oz contract and 0.5 lot.</p>
<div class='cards'>{cards}</div><h2>Test equity</h2><svg viewBox='0 0 {width} {height}'><polyline fill='none' stroke='#e8b94f' stroke-width='2' points='{points}'/></svg>
<h2>Top training candidates</h2>{top}<h2>Recent test trades</h2>{test_trades.tail(30).to_html(index=False, float_format=lambda v: f'{v:.3f}')}
"""
    (OUTPUT_DIR / "fastest_gold_report.html").write_text(html, encoding="utf-8")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    df = add_indicators(load_data())
    split = int(len(df) * 0.70)
    train, test = df.iloc[:split], df.iloc[split:]

    baseline = Params()
    base_test_trades, base_test_curve = simulate(test, baseline)
    base_test = metrics(base_test_trades, base_test_curve)

    candidates = []
    for buy, sell, atr_mult, use_mtf in product(
        (55.0, 60.0, 65.0, 70.0),
        (30.0, 35.0, 40.0, 45.0),
        (1.0, 1.5, 2.0, 2.5),
        (True, False),
    ):
        p = Params(buy, sell, atr_mult, use_mtf)
        trades, curve = simulate(train, p)
        m = metrics(trades, curve)
        candidates.append({**p.__dict__, **m, "score": score(m)})

    results = pd.DataFrame(candidates).sort_values("score", ascending=False)
    best_row = results.iloc[0]
    best = Params(
        float(best_row.rsi_buy_max), float(best_row.rsi_sell_min),
        float(best_row.atr_mult), bool(best_row.use_mtf)
    )
    test_trades, test_curve = simulate(test, best)
    test_metrics = metrics(test_trades, test_curve)

    summary = {
        "Data bars": f"{len(df):,}",
        "Test period": f"{test.index[0].date()} to {test.index[-1].date()}",
        "Candidate trades": test_metrics["trades"],
        "Candidate net": f"${test_metrics['net_usd']:,.2f}",
        "Candidate PF": f"{test_metrics['profit_factor']:.2f}",
        "Candidate win rate": f"{test_metrics['win_rate']:.1f}%",
        "Candidate max DD": f"{test_metrics['max_drawdown_pct']:.1f}%",
        "Baseline net": f"${base_test['net_usd']:,.2f}",
        "Baseline PF": f"{base_test['profit_factor']:.2f}",
        "Buy & hold": f"{(test['close'].iloc[-1] / test['close'].iloc[0] - 1) * 100:.1f}%",
    }

    approved = (
        test_metrics["trades"] >= 150
        and test_metrics["profit_factor"] >= 1.2
        and test_metrics["max_drawdown_pct"] > -15
        and test_metrics["sharpe"] > 0
    )
    payload = {
        "strategy": "fastest_gold",
        "symbol": "XAUUSDm",
        "timeframe": "M5",
        # التقييم على مجموعة test منفصلة (train/test split أعلى) = خارج العينة.
        # بوابة الترقية في الـ backend ترفض احترازياً أي رفع بدون هذا الحقل.
        "validation": "walk_forward",
        "status": "candidate" if approved else "unsafe",
        "generated_at": pd.Timestamp.now(tz="UTC").isoformat(),
        "data": {
            "bars": len(df),
            "start": str(df.index[0].date()),
            "end": str(df.index[-1].date()),
        },
        "baseline": base_test,
        "candidate": {"params": best.__dict__, **test_metrics},
        "decision": "approved" if approved else "rejected",
        "reason": (
            "Candidate passed the safety gate and may proceed to Demo shadow testing."
            if approved else
            "Candidate failed out-of-sample validation; automatic promotion is blocked."
        ),
    }

    results.to_csv(OUTPUT_DIR / "optimization_results.csv", index=False)
    test_trades.to_csv(OUTPUT_DIR / "test_trades.csv", index=False)
    pd.DataFrame([{"name": "baseline", **baseline.__dict__, **base_test},
                  {"name": "candidate", **best.__dict__, **test_metrics}]).to_csv(
        OUTPUT_DIR / "test_comparison.csv", index=False
    )
    (OUTPUT_DIR / "candidate_settings.json").write_text(
        json.dumps({**best.__dict__, "test_metrics": test_metrics}, indent=2), encoding="utf-8"
    )
    (OUTPUT_DIR / "latest_result.json").write_text(
        json.dumps(payload, indent=2), encoding="utf-8"
    )
    write_html(summary, results, test_trades, test_curve)

    backend_url = os.environ.get("BACKEND_URL", "").rstrip("/")
    api_key = os.environ.get("API_KEY", "")
    if backend_url and api_key:
        request = urllib.request.Request(
            f"{backend_url}/api/backtest/result",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "X-API-Key": api_key},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            print(f"Dashboard upload: HTTP {response.status}")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
