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
_MT5_COMMON = os.path.join(
    os.environ.get("APPDATA", ""),
    "MetaQuotes", "Terminal", "Common", "Files"
)
SETTINGS_FILE = os.path.join(_MT5_COMMON, "GSX_Settings.json")
CURRENT_FILE  = os.path.join(_MT5_COMMON, "GSX_Current.json")  # الإعدادات الفعلية التي يكتبها البوت


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


def get_pending_orders():
    orders = mt5.orders_get()
    if orders is None:
        return []
    result = []
    type_map = {
        mt5.ORDER_TYPE_BUY_LIMIT:   "BUY LIMIT",
        mt5.ORDER_TYPE_SELL_LIMIT:  "SELL LIMIT",
        mt5.ORDER_TYPE_BUY_STOP:    "BUY STOP",
        mt5.ORDER_TYPE_SELL_STOP:   "SELL STOP",
    }
    for o in orders:
        result.append({
            "ticket":    o.ticket,
            "symbol":    o.symbol,
            "type":      type_map.get(o.type, str(o.type)),
            "volume":    o.volume_initial,
            "price":     o.price_open,
            "sl":        o.sl,
            "tp":        o.tp,
            "time":      datetime.fromtimestamp(o.time_setup).isoformat(),
            "expiry":    datetime.fromtimestamp(o.time_expiration).isoformat() if o.time_expiration else None,
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


def read_current_settings():
    """يقرأ الإعدادات الفعلية التي يكتبها البوت (GSX_Current.json)"""
    if not os.path.exists(CURRENT_FILE):
        return None
    try:
        with open(CURRENT_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return None


def push_local_settings():
    """
    يدفع إعدادات البوت الفعلية (GSX_Current.json) للـ Backend.
    يُقبل دائماً — يحدّث الداشبورد بالقيم الحقيقية التي يشتغل عليها البوت.
    إذا ما كان Current موجود، يرجع للـ Settings كبديل.
    """
    local = read_current_settings() or read_local_settings()
    if not local:
        return
    try:
        r = requests.post(
            f"{BACKEND_URL}/api/settings/seed",
            json=local, headers=HEADERS, timeout=15,
        )
        if r.status_code == 200:
            if r.json().get("applied"):
                print(f"📤 {datetime.now().strftime('%H:%M:%S')} - تم رفع إعدادات البوت الفعلية للداشبورد")
        elif r.status_code == 404:
            pass  # backend قديم — تجاهل
    except Exception:
        pass  # غير حرج — سيُعاد في الدورة القادمة


_last_settings_hash = None  # نتتبع التغييرات
_known_positions    = {}    # ticket -> position — لكشف الصفقات الجديدة


# ── حساب المؤشرات من الشمعات ────────────────────────────────────────
def _calc_rsi(closes, period=14):
    if len(closes) < period + 1:
        return 50.0
    gains, losses = [], []
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 1)


def _calc_ema(closes, period):
    if not closes:
        return 0.0
    if len(closes) < period:
        return closes[-1]
    k   = 2.0 / (period + 1)
    ema = sum(closes[:period]) / period
    for c in closes[period:]:
        ema = c * k + ema * (1 - k)
    return round(ema, 2)


def _calc_atr(candles, period=14):
    if len(candles) < period + 1:
        return 0.0
    trs = []
    for i in range(1, len(candles)):
        tr = max(
            candles[i]['h'] - candles[i]['l'],
            abs(candles[i]['h'] - candles[i - 1]['c']),
            abs(candles[i]['l'] - candles[i - 1]['c']),
        )
        trs.append(tr)
    return round(sum(trs[-period:]) / period, 2)


def send_trade_snapshot(ticket, position, candles_list, sessions):
    """يرسل snapshot كامل (شمعات + مؤشرات) فور فتح صفقة جديدة"""
    closes = [c['c'] for c in candles_list]
    rsi    = _calc_rsi(closes)
    ema9   = _calc_ema(closes, 9)
    ema21  = _calc_ema(closes, 21)
    atr    = _calc_atr(candles_list)
    h      = sessions.get('utc_hour', 0)
    if 7 <= h < 13:    sess = 'London'
    elif 13 <= h < 22: sess = 'NY'
    elif 0 <= h < 7:   sess = 'Tokyo'
    else:              sess = 'Off'

    snapshot = {
        "ticket":      ticket,
        "symbol":      position.get('symbol'),
        "direction":   position.get('type'),
        "entry_price": position.get('price_open'),
        "candles":     candles_list[-30:],
        "rsi":         rsi,
        "ema_fast":    ema9,
        "ema_slow":    ema21,
        "ema_up":      ema9 > ema21,
        "atr":         atr,
        "session":     sess,
        "time":        datetime.now().isoformat(),
    }
    try:
        r = requests.post(
            f"{BACKEND_URL}/api/trade_snapshot",
            json=snapshot, headers=HEADERS, timeout=15,
        )
        if r.status_code == 200:
            arrow = '↑' if ema9 > ema21 else '↓'
            print(f"📸 {datetime.now().strftime('%H:%M:%S')} - snapshot #{ticket} "
                  f"RSI={rsi} EMA{arrow} ATR={atr} [{sess}]")
    except Exception as e:
        print(f"❌ فشل إرسال snapshot: {e}")

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
            ot = {0:'MARKET', 1:'LIMIT', 2:'STOP'}.get(int(settings.get('OrderType', 0)), 'MARKET')
            print(f"   Hours={settings.get('TradeHoursStart')}-{settings.get('TradeHoursEnd')}  Bot={'ON' if settings.get('BotRunning') else 'OFF'}  OrderType={ot}")

            # نتحقق إذا تغيرت الإعدادات
            import hashlib
            new_hash = hashlib.md5(json.dumps(settings, sort_keys=True).encode()).hexdigest()
            if new_hash != _last_settings_hash:
                print(f"   🔄 تغييرات مكتشفة — يُكتب الملف")
                _last_settings_hash = new_hash
            else:
                print(f"   ✓ لا تغييرات")

            content = json.dumps(settings, indent=2, ensure_ascii=False)
            os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)

            # محاولة الكتابة مع 3 retries (MT5 قد يقفل الملف لحظياً)
            written = False
            for w in range(3):
                try:
                    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
                        f.write(content)
                    written = True
                    break
                except Exception as we:
                    if w < 2:
                        time.sleep(0.3)
                    else:
                        print(f"   ❌ فشل كتابة الملف بعد 3 محاولات: {we}")

            # كتابة ملفات individual (GSX_LotSize.txt وغيرها) — أبسط وأموثق للـ EA
            key_map = {
                "LotSize": "LotSize", "TP_USD": "TP_USD", "SL_USD": "SL_USD",
                "MaxSpread": "MaxSpread", "MaxPositions": "MaxPositions",
                "CooldownSecs": "CooldownSecs", "MaxLossPerDay": "MaxLossPerDay",
                "MaxProfitPerDay": "MaxProfitPerDay",
                "TradeHoursStart": "TradeHoursStart", "TradeHoursEnd": "TradeHoursEnd",
                "BotRunning": "BotRunning",
                "OrderType":  "OrderType",
            }
            for k in key_map:
                if k in settings:
                    fpath = os.path.join(_MT5_COMMON, f"GSX_{k}.txt")
                    try:
                        with open(fpath, "w", encoding="ascii") as f:
                            f.write(str(settings[k]))
                    except Exception:
                        pass
            print(f"   📝 Lot على الديسك={settings.get('LotSize')} (individual files)")

            print(f"{'='*55}\n")
            return

        except PermissionError:
            print("⚠️  خطأ صلاحيات عام — سيُعاد في الدورة القادمة")
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

            # كشف الصفقات الجديدة وإرسال snapshot فوري
            for pos in positions:
                if pos['ticket'] not in _known_positions:
                    sym      = pos.get('symbol', detect_gold_symbol())
                    c_list   = get_candles(sym, mt5.TIMEFRAME_M1, 40)
                    sessions = get_trading_sessions()
                    send_trade_snapshot(pos['ticket'], pos, c_list, sessions)
            _known_positions.clear()
            _known_positions.update({p['ticket']: p for p in positions})

            history = []
            if now - last_history_sync > 60:
                history = get_recent_history(days=30)
                last_history_sync = now

            pending = get_pending_orders()

            send_update({
                "account":        account,
                "positions":      positions,
                "pending_orders": pending,
                "history":        history if history else None,
                "timestamp":      datetime.now().isoformat(),
            })

            time.sleep(UPDATE_INTERVAL)

    except KeyboardInterrupt:
        print("\n⏹️  تم إيقاف الـ Agent")
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    main()
