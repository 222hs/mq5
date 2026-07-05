"""
MT5 Agent - يشتغل على جهاز Windows اللي فيه MT5
يقرأ بيانات الحساب والصفقات ويرسلها للـ Backend
ويسحب إعدادات البوت من الـ Dashboard ويطبقها عبر MT5 Global Variables

التثبيت:
    pip install MetaTrader5 requests

التشغيل:
    python mt5_agent.py
"""

import MetaTrader5 as mt5
import requests
import time
import json
import os
from datetime import datetime

# ============== الإعدادات ==============
BACKEND_URL             = "https://mq5-production.up.railway.app"
API_KEY                 = "mysecretkey123"
UPDATE_INTERVAL         = 2    # ثواني بين كل تحديث للبيانات
SETTINGS_CHECK_INTERVAL = 15   # ثواني بين كل سحب للإعدادات
CANDLES_INTERVAL        = 10   # ثواني بين كل إرسال للشمعات
# ========================================

HEADERS = {"X-API-Key": API_KEY, "Content-Type": "application/json"}

# مسار ملف الإعدادات في مجلد MT5 المشترك
SETTINGS_FILE = os.path.join(
    os.environ.get("APPDATA", ""),
    "MetaQuotes", "Terminal", "Common", "Files", "GSX_Settings.json"
)


def connect_mt5():
    if not mt5.initialize():
        print(f"❌ فشل الاتصال بـ MT5: {mt5.last_error()}")
        return False
    print("✅ تم الاتصال بـ MT5 بنجاح")
    return True


def get_account_info():
    info = mt5.account_info()
    if info is None:
        return None
    return {
        "login":       info.login,
        "balance":     info.balance,
        "equity":      info.equity,
        "profit":      info.profit,
        "margin":      info.margin,
        "margin_free": info.margin_free,
        "currency":    info.currency,
        "server":      info.server,
        "leverage":    info.leverage,
    }


def get_open_positions():
    positions = mt5.positions_get()
    if positions is None:
        return []
    result = []
    for pos in positions:
        result.append({
            "ticket":        pos.ticket,
            "symbol":        pos.symbol,
            "type":          "BUY" if pos.type == mt5.ORDER_TYPE_BUY else "SELL",
            "volume":        pos.volume,
            "price_open":    pos.price_open,
            "price_current": pos.price_current,
            "sl":            pos.sl,
            "tp":            pos.tp,
            "profit":        pos.profit,
            "swap":          pos.swap,
            "time":          datetime.fromtimestamp(pos.time).isoformat(),
            "comment":       pos.comment,
        })
    return result


def detect_gold_symbol():
    """يكتشف رمز الذهب المتاح في الحساب تلقائياً"""
    candidates = ["XAUUSD", "XAUUSDm", "XAUUSD.", "GOLD", "XAUUSDc", "XAUUSD+"]
    for sym in candidates:
        info = mt5.symbol_info(sym)
        if info is not None and info.visible:
            return sym
    # إذا ما لقى، يجرب أي رمز فيه XAU
    all_symbols = mt5.symbols_get()
    if all_symbols:
        for s in all_symbols:
            if "XAU" in s.name or "GOLD" in s.name.upper():
                return s.name
    return "XAUUSD"


def get_candles(symbol="XAUUSD", timeframe=mt5.TIMEFRAME_M1, count=80):
    """يجلب آخر N شمعة M1"""
    rates = mt5.copy_rates_from_pos(symbol, timeframe, 0, count)
    if rates is None:
        return []
    result = []
    for r in rates:
        result.append({
            "t": int(r["time"]),
            "o": float(r["open"]),
            "h": float(r["high"]),
            "l": float(r["low"]),
            "c": float(r["close"]),
        })
    return result


def get_trading_sessions():
    """يرجع الوقت الحالي وحالة جلسات التداول"""
    now_utc = datetime.utcnow()
    h = now_utc.hour
    return {
        "utc_hour": h,
        "london":  7 <= h < 16,
        "ny":      13 <= h < 22,
        "tokyo":   0 <= h < 9,
        "active":  7 <= h < 22,
    }


def get_recent_history(days=30):
    from_date = datetime.now().timestamp() - (days * 24 * 60 * 60)
    deals = mt5.history_deals_get(datetime.fromtimestamp(from_date), datetime.now())
    if deals is None:
        return []
    result = []
    for deal in deals:
        if deal.entry == 1:
            result.append({
                "ticket":     deal.ticket,
                "symbol":     deal.symbol,
                "type":       "BUY" if deal.type == mt5.DEAL_TYPE_BUY else "SELL",
                "volume":     deal.volume,
                "price":      deal.price,
                "profit":     deal.profit,
                "swap":       deal.swap,
                "commission": deal.commission,
                "time":       datetime.fromtimestamp(deal.time).isoformat(),
                "comment":    deal.comment,
            })
    return result


def send_update(data):
    try:
        response = requests.post(
            f"{BACKEND_URL}/api/update", json=data, headers=HEADERS, timeout=20
        )
        if response.status_code == 200:
            print(f"✅ {datetime.now().strftime('%H:%M:%S')} - تم إرسال البيانات")
        else:
            print(f"⚠️ خطأ بالإرسال: {response.status_code}")
    except requests.exceptions.Timeout:
        print(f"⏳ {datetime.now().strftime('%H:%M:%S')} - timeout إرسال البيانات (Railway نائمة؟)")
    except Exception as e:
        print(f"❌ فشل الاتصال بالـ Backend: {e}")


def send_candles():
    try:
        symbol   = detect_gold_symbol()
        candles  = get_candles(symbol, mt5.TIMEFRAME_M1, 60)
        sessions = get_trading_sessions()
        response = requests.post(
            f"{BACKEND_URL}/api/candles",
            json={"candles": candles, "sessions": sessions},
            headers=HEADERS, timeout=20
        )
        if response.status_code == 200:
            print(f"🕯️  {datetime.now().strftime('%H:%M:%S')} - {symbol}: تم إرسال {len(candles)} شمعة")
    except requests.exceptions.Timeout:
        print("⏳ timeout إرسال الشمعات")
    except Exception as e:
        print(f"❌ فشل إرسال الشمعات: {e}")


def read_local_settings():
    """يقرأ الإعدادات الحالية من ملف البوت"""
    if not os.path.exists(SETTINGS_FILE):
        return None
    try:
        with open(SETTINGS_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return None


def push_local_settings():
    """
    يدفع الإعدادات المحلية (GSX_Settings.json) للـ Backend.
    الـ Backend يقبلها فقط إذا كان الـ container جديداً بعد Railway redeploy —
    هكذا لا تضيع الإعدادات أبداً حتى بدون Railway Volume.
    """
    local = read_local_settings()
    if not local:
        return
    try:
        r = requests.post(
            f"{BACKEND_URL}/api/settings/seed",
            json=local, headers=HEADERS, timeout=15,
        )
        if r.status_code == 200 and r.json().get("applied"):
            print(f"📤 {datetime.now().strftime('%H:%M:%S')} - Railway كان فارغاً — تم رفع الإعدادات المحلية")
        elif r.status_code == 404:
            pass  # backend قديم بدون endpoint — تجاهل
    except Exception:
        pass  # غير حرج — سيُعاد في الدورة القادمة


_last_settings_hash = None  # نتتبع التغييرات

def sync_settings():
    """يسحب الإعدادات من الصفحة ويكتبها للبوت — مع retry تلقائي"""
    global _last_settings_hash
    # أولاً: seed — إذا Railway انعمل له redeploy، نرجّع إعداداتنا قبل السحب
    push_local_settings()
    for attempt in range(3):
        try:
            r = requests.get(
                f"{BACKEND_URL}/api/settings",
                headers=HEADERS,
                timeout=30,
            )
            if r.status_code != 200:
                print(f"⚠️  /api/settings رجع {r.status_code}")
                return
            settings = r.json()

            # نطبع دائماً الإعدادات الحالية بشكل واضح
            t = datetime.now().strftime('%H:%M:%S')
            print(f"\n{'='*55}")
            print(f"⚙️  [{t}] إعدادات من الداشبورد:")
            print(f"   Lot={settings.get('LotSize')}  TP$={settings.get('TP_USD')}  SL$={settings.get('SL_USD')}")
            print(f"   MaxPos={settings.get('MaxPositions')}  Spread={settings.get('MaxSpread')}  CD={settings.get('CooldownSecs')}s")
            print(f"   MaxLoss$={settings.get('MaxLossPerDay')}  MaxProfit$={settings.get('MaxProfitPerDay')}")
            print(f"   Hours={settings.get('TradeHoursStart')}-{settings.get('TradeHoursEnd')}  Bot={'ON' if settings.get('BotRunning') else 'OFF'}")

            # نتحقق إذا تغيرت الإعدادات
            import hashlib
            new_hash = hashlib.md5(json.dumps(settings, sort_keys=True).encode()).hexdigest()
            if new_hash != _last_settings_hash:
                print(f"   🔄 تغييرات مكتشفة — يُكتب الملف")
                _last_settings_hash = new_hash
            else:
                print(f"   ✓ لا تغييرات")

            tmp = SETTINGS_FILE + ".tmp"
            os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(settings, f, indent=2)
            os.replace(tmp, SETTINGS_FILE)
            print(f"   📁 {SETTINGS_FILE}")
            print(f"{'='*55}\n")
            return

        except PermissionError:
            print("⚠️  الملف مقفل من MT5 — سيُعاد في الدورة القادمة")
            return
        except requests.exceptions.Timeout:
            wait = (attempt + 1) * 5
            print(f"⏳ مزامنة الإعدادات timeout (محاولة {attempt+1}/3) — انتظار {wait}s")
            if attempt < 2:
                time.sleep(wait)
        except Exception as e:
            print(f"❌ فشل مزامنة الإعدادات: {e}")
            return


def main():
    print("=" * 50)
    print("🚀 MT5 Dashboard Agent")
    print("=" * 50)

    if not connect_mt5():
        return

    print(f"📡 يرسل بيانات كل {UPDATE_INTERVAL}s | يسحب إعدادات كل {SETTINGS_CHECK_INTERVAL}s")
    print(f"   Backend: {BACKEND_URL}")
    print("اضغط Ctrl+C للإيقاف\n")

    last_history_sync  = 0
    last_settings_sync = 0
    last_candles_sync  = 0

    try:
        while True:
            now = time.time()

            if now - last_settings_sync >= SETTINGS_CHECK_INTERVAL:
                sync_settings()
                last_settings_sync = now

            # شمعات كل 10 ثواني (endpoint منفصل)
            if now - last_candles_sync >= CANDLES_INTERVAL:
                send_candles()
                last_candles_sync = now

            account   = get_account_info()
            positions = get_open_positions()

            history = []
            if now - last_history_sync > 60:
                history = get_recent_history(days=30)
                last_history_sync = now

            send_update({
                "account":   account,
                "positions": positions,
                "history":   history if history else None,
                "timestamp": datetime.now().isoformat(),
            })

            time.sleep(UPDATE_INTERVAL)

    except KeyboardInterrupt:
        print("\n⏹️  تم إيقاف الـ Agent")
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    main()
