"""
export_mt5_m5.py — يصدّر XAUUSDm M5 من MT5 مباشرة إلى data/XAUUSDm_M5.csv.

يشتغل على جهاز Windows اللي عليه MT5 (OpenClaw). يسحب أكبر تاريخ متاح،
يحسب السبريد الحقيقي لكل شمعة (من نقاط السبريد اللي يوفرها MT5)، ويكتب
الأعمدة اللي الباك-تست محتاجها بالظبط: time, open, high, low, close, volume, spread.

التشغيل:
    pip install MetaTrader5 pandas
    python export_mt5_m5.py                 # يصدّر فقط
    python export_mt5_m5.py --run           # يصدّر ثم يشغّل الباك-تست ويرفع

قبل التشغيل: افتح MT5 وسجّل دخول، وتأكد أن الرمز XAUUSDm ظاهر في Market Watch.
"""
import os
import sys
import subprocess
from pathlib import Path
from datetime import datetime, timezone

import pandas as pd

try:
    import MetaTrader5 as mt5
except ImportError:
    print("❌ محتاج تثبّت الحزمة:  pip install MetaTrader5")
    sys.exit(1)

# ————— إعدادات قابلة للتغيير —————
SYMBOL = os.environ.get("MT5_SYMBOL", "XAUUSDm")   # لو رمزك مختلف غيّره هنا أو بالمتغيّر
BARS   = int(os.environ.get("MT5_BARS", "200000"))  # عدد شموع M5 المطلوبة (كل ما زاد أفضل)
OUT    = Path(os.environ.get("BACKTEST_DATA", "data/XAUUSDm_M5.csv"))
OUT.parent.mkdir(parents=True, exist_ok=True)


def export():
    if not mt5.initialize():
        print(f"❌ فشل الاتصال بـ MT5: {mt5.last_error()}")
        print("   تأكد أن MetaTrader 5 مفتوح ومسجّل دخول.")
        sys.exit(1)

    # نلاقي رمز الذهب لوحده مهما كان اسمه (Standard=XAUUSDm, Raw/Zero=XAUUSD ...)
    global SYMBOL
    candidates = [SYMBOL, "XAUUSD", "XAUUSDm", "GOLD", "GOLDm",
                  "XAUUSD.raw", "XAUUSDz", "XAUUSD_z"]
    # نضيف أي رمز فيه XAU من قائمة البروكر
    for s in (mt5.symbols_get("*XAU*") or []):
        if s.name not in candidates:
            candidates.append(s.name)
    found = None
    for name in candidates:
        info = mt5.symbol_info(name)
        if info is not None:
            found = name
            break
    if found is None:
        print(f"❌ لم أجد رمز ذهب. الرموز المتاحة القريبة:",
              [s.name for s in (mt5.symbols_get("*XAU*") or [])][:10])
        mt5.shutdown(); sys.exit(1)
    if found != SYMBOL:
        print(f"ℹ️ رمز الذهب على هذا الحساب: {found} (بدل {SYMBOL})")
    SYMBOL = found
    if not mt5.symbol_info(SYMBOL).visible:
        mt5.symbol_select(SYMBOL, True)

    # نطلب كمية كبيرة، ولو ما رجّعش (التاريخ المخزّن أقل) نقلّل تلقائياً.
    rates = None
    for want in (BARS, 150_000, 100_000, 75_000, 50_000, 30_000, 20_000, 10_000, 5_000):
        print(f"محاولة سحب {want:,} شمعة M5 لـ {SYMBOL} ...")
        rates = mt5.copy_rates_from_pos(SYMBOL, mt5.TIMEFRAME_M5, 0, want)
        if rates is not None and len(rates) > 0:
            print(f"   ✓ رجع {len(rates):,} شمعة")
            break
        # محاولة بديلة بنطاق زمني من الآن للخلف
        rates = mt5.copy_rates_from(SYMBOL, mt5.TIMEFRAME_M5, datetime.now(timezone.utc), want)
        if rates is not None and len(rates) > 0:
            print(f"   ✓ رجع {len(rates):,} شمعة (بالنطاق الزمني)")
            break

    if rates is None or len(rates) == 0:
        err = mt5.last_error()
        mt5.shutdown()
        print(f"❌ لم تُرجَع بيانات حتى بأقل كمية. الخطأ: {err}")
        print("   الحل غالباً: افتح شارت XAUUSDm M5 في MT5، اسحب للخلف لتحميل التاريخ،")
        print("   ثم شغّل RUN_GOLD.bat من جديد.")
        sys.exit(1)
    mt5.shutdown()

    df = pd.DataFrame(rates)
    df["time"] = pd.to_datetime(df["time"], unit="s", utc=True)
    # MT5 يوفّر عمود spread بالنقاط لكل شمعة — نستخدمه مباشرة (سبريد بروكرك الحقيقي)
    out = pd.DataFrame({
        "time":   df["time"],
        "open":   df["open"],
        "high":   df["high"],
        "low":    df["low"],
        "close":  df["close"],
        "volume": df["tick_volume"],
        "spread": df["spread"],          # نقاط
    })
    out = out.dropna().drop_duplicates("time").sort_values("time")
    out.to_csv(OUT, index=False)
    print(f"✅ اتكتب {len(out):,} شمعة في {OUT}")
    print(f"   الفترة: {out['time'].iloc[0].date()} → {out['time'].iloc[-1].date()}")
    print(f"   السبريد الحقيقي: وسيط={out['spread'].median():.0f} نقطة  "
          f"متوسط={out['spread'].mean():.0f}  (min={out['spread'].min():.0f} max={out['spread'].max():.0f})")
    return out


def run_backtest():
    print("\n" + "=" * 55)
    print("تشغيل الباك-تست ورفع النتيجة للبوابة ...")
    print("=" * 55)
    script = Path(__file__).parent / "XAUUSDm_meanrev_backtest.py"
    # نمرّر نفس البيئة (BACKEND_URL / API_KEY / BACKTEST_DATA) للباك-تست
    subprocess.run([sys.executable, str(script)], check=False)


if __name__ == "__main__":
    export()
    if "--run" in sys.argv:
        if not (os.environ.get("BACKEND_URL") and os.environ.get("API_KEY")):
            print("\n⚠️ BACKEND_URL و API_KEY غير مضبوطين — الباك-تست هيشتغل لكن مش هيرفع.")
        run_backtest()
    else:
        print("\nخلص التصدير. لتشغيل الباك-تست والرفع:  python export_mt5_m5.py --run")
