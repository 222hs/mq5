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
from datetime import datetime

# ============== الإعدادات ==============
BACKEND_URL             = "https://mq5-production.up.railway.app"
API_KEY                 = "mysecretkey123"
UPDATE_INTERVAL         = 5    # ثواني بين كل تحديث للبيانات
SETTINGS_CHECK_INTERVAL = 15   # ثواني بين كل سحب للإعدادات
# ========================================

HEADERS = {"X-API-Key": API_KEY, "Content-Type": "application/json"}

# بادئة Global Variables في MT5 (نفسها في الـ EA)
GV_PREFIX = "GSX_"


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
            f"{BACKEND_URL}/api/update", json=data, headers=HEADERS, timeout=10
        )
        if response.status_code == 200:
            print(f"✅ {datetime.now().strftime('%H:%M:%S')} - تم إرسال البيانات")
        else:
            print(f"⚠️ خطأ بالإرسال: {response.status_code}")
    except Exception as e:
        print(f"❌ فشل الاتصال بالـ Backend: {e}")


def fetch_and_apply_settings():
    """يسحب الإعدادات من الـ Dashboard ويكتبها في MT5 Global Variables"""
    try:
        response = requests.get(
            f"{BACKEND_URL}/api/settings", headers=HEADERS, timeout=10
        )
        if response.status_code != 200:
            return
        settings = response.json()

        changed = []
        for key, value in settings.items():
            gv_name  = GV_PREFIX + key
            exists   = mt5.global_variable_check(gv_name)
            current  = mt5.global_variable_get(gv_name) if exists else None
            new_val  = float(value)
            if not exists or current is None or abs(current - new_val) > 1e-9:
                mt5.global_variable_set(gv_name, new_val)
                changed.append(f"{key}={value}")

        if changed:
            print(f"⚙️  إعدادات جديدة طُبِّقت: {', '.join(changed)}")

    except Exception as e:
        print(f"❌ فشل سحب الإعدادات: {e}")


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

    try:
        while True:
            now = time.time()

            if now - last_settings_sync >= SETTINGS_CHECK_INTERVAL:
                fetch_and_apply_settings()
                last_settings_sync = now

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
