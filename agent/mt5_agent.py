"""
MT5 Agent - يشتغل على جهاز Windows اللي فيه MT5
يقرأ بيانات الحساب والصفقات ويرسلها للـ Backend أونلاين

التثبيت على Windows:
    pip install MetaTrader5 requests

التشغيل:
    python mt5_agent.py
"""

import MetaTrader5 as mt5
import requests
import time
import json
from datetime import datetime

# ============== الإعدادات ==============
BACKEND_URL = "https://your-app.up.railway.app/api/update"  # غيّرها بعد نشر الـ Backend
API_KEY = "ضع-مفتاح-سري-هنا"  # نفس المفتاح المستخدم في الـ Backend
UPDATE_INTERVAL = 5  # ثواني بين كل تحديث
# ========================================


def connect_mt5():
    """الاتصال بـ MT5"""
    if not mt5.initialize():
        print(f"❌ فشل الاتصال بـ MT5: {mt5.last_error()}")
        return False
    print("✅ تم الاتصال بـ MT5 بنجاح")
    return True


def get_account_info():
    """جلب معلومات الحساب"""
    info = mt5.account_info()
    if info is None:
        return None
    return {
        "login": info.login,
        "balance": info.balance,
        "equity": info.equity,
        "profit": info.profit,
        "margin": info.margin,
        "margin_free": info.margin_free,
        "currency": info.currency,
        "server": info.server,
        "leverage": info.leverage,
    }


def get_open_positions():
    """جلب الصفقات المفتوحة"""
    positions = mt5.positions_get()
    if positions is None:
        return []

    result = []
    for pos in positions:
        result.append({
            "ticket": pos.ticket,
            "symbol": pos.symbol,
            "type": "BUY" if pos.type == mt5.ORDER_TYPE_BUY else "SELL",
            "volume": pos.volume,
            "price_open": pos.price_open,
            "price_current": pos.price_current,
            "sl": pos.sl,
            "tp": pos.tp,
            "profit": pos.profit,
            "swap": pos.swap,
            "time": datetime.fromtimestamp(pos.time).isoformat(),
            "comment": pos.comment,
        })
    return result


def get_recent_history(days=30):
    """جلب سجل الصفقات المغلقة"""
    from_date = datetime.now().timestamp() - (days * 24 * 60 * 60)
    deals = mt5.history_deals_get(datetime.fromtimestamp(from_date), datetime.now())

    if deals is None:
        return []

    result = []
    for deal in deals:
        if deal.entry == 1:  # خروج من صفقة فقط (إغلاق)
            result.append({
                "ticket": deal.ticket,
                "symbol": deal.symbol,
                "type": "BUY" if deal.type == mt5.DEAL_TYPE_BUY else "SELL",
                "volume": deal.volume,
                "price": deal.price,
                "profit": deal.profit,
                "swap": deal.swap,
                "commission": deal.commission,
                "time": datetime.fromtimestamp(deal.time).isoformat(),
                "comment": deal.comment,
            })
    return result


def get_active_eas():
    """جلب أسماء الـ EAs الشغالة على الشارتات المفتوحة"""
    # MT5 Python API ما يعطي اسم الـ EA مباشرة، نعتمد على comment الصفقات
    return []


def send_update(data):
    """إرسال البيانات للـ Backend"""
    try:
        headers = {"X-API-Key": API_KEY, "Content-Type": "application/json"}
        response = requests.post(BACKEND_URL, json=data, headers=headers, timeout=10)
        if response.status_code == 200:
            print(f"✅ {datetime.now().strftime('%H:%M:%S')} - تم الإرسال بنجاح")
        else:
            print(f"⚠️ خطأ بالإرسال: {response.status_code} - {response.text}")
    except Exception as e:
        print(f"❌ فشل الاتصال بالـ Backend: {e}")


def main():
    print("=" * 50)
    print("🚀 MT5 Dashboard Agent")
    print("=" * 50)

    if not connect_mt5():
        return

    print(f"📡 يرسل بيانات كل {UPDATE_INTERVAL} ثانية إلى:")
    print(f"   {BACKEND_URL}")
    print("اضغط Ctrl+C للإيقاف\n")

    last_history_sync = 0

    try:
        while True:
            account = get_account_info()
            positions = get_open_positions()

            # سجل الصفقات كل دقيقة فقط (مو كل تحديث، يوفر بيانات)
            history = []
            if time.time() - last_history_sync > 60:
                history = get_recent_history(days=30)
                last_history_sync = time.time()

            payload = {
                "account": account,
                "positions": positions,
                "history": history if history else None,
                "timestamp": datetime.now().isoformat(),
            }

            send_update(payload)
            time.sleep(UPDATE_INTERVAL)

    except KeyboardInterrupt:
        print("\n⏹️  تم إيقاف الـ Agent")
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    main()
