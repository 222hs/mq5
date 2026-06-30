"""
AI Trade Filter - يقرأ إشارات MT5، يستشير Claude، وينفذ القرار

التثبيت على Windows:
    pip install MetaTrader5 anthropic requests

التشغيل:
    python ai_trade_filter.py
"""

import MetaTrader5 as mt5
import json
import time
import os
from datetime import datetime
from anthropic import Anthropic

# ============== الإعدادات ==============
ANTHROPIC_API_KEY = "ضع-مفتاح-Anthropic-API-هنا"
SIGNAL_FILE = os.path.join(
    os.environ.get("APPDATA", ""), "MetaQuotes", "Terminal", "Common", "Files", "signals.json"
)
CHECK_INTERVAL = 10  # ثواني
# ========================================

client = Anthropic(api_key=ANTHROPIC_API_KEY)


def connect_mt5():
    if not mt5.initialize():
        print(f"❌ فشل الاتصال بـ MT5: {mt5.last_error()}")
        return False
    print("✅ تم الاتصال بـ MT5")
    return True


def read_signal():
    """يقرأ الإشارة من الملف اللي يكتبه الـ EA"""
    if not os.path.exists(SIGNAL_FILE):
        return None
    try:
        with open(SIGNAL_FILE, "r") as f:
            content = f.read().strip()
        if not content:
            return None
        signal = json.loads(content)
        if signal.get("status") != "pending":
            return None
        return signal
    except Exception:
        return None


def mark_signal_processed():
    """يمسح الإشارة بعد معالجتها عشان ما تتكرر"""
    try:
        with open(SIGNAL_FILE, "w") as f:
            f.write("")
    except Exception as e:
        print(f"⚠️ خطأ بمسح الإشارة: {e}")


def ask_claude(signal):
    """يستشير Claude قبل تنفيذ الصفقة"""
    prompt = f"""أنت فلتر مخاطر لبوت تداول فوركس. لديك إشارة تداول تقنية وتحتاج تقرر هل تنفذها أو ترفضها.

الإشارة:
- الرمز: {signal['symbol']}
- الاتجاه: {signal['direction']}
- السعر: {signal['price']}
- الوقت: {signal['time']}

مهمتك: قيّم فقط عوامل المخاطرة العامة المعروفة (مثل: هل هذا وقت قريب من إغلاق/افتتاح الأسواق الكبرى بشكل يزيد التقلب، هل هذا نمط توقيت محفوف بالمخاطر بشكل عام). لا تحاول التنبؤ باتجاه السعر فعلياً - أنت لا تملك بيانات سوق حية.

رد بصيغة JSON فقط وبدون أي نص إضافي:
{{"approve": true أو false, "reason": "سبب مختصر بالعربي"}}"""

    try:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()
        text = text.replace("```json", "").replace("```", "").strip()
        decision = json.loads(text)
        return decision
    except Exception as e:
        print(f"⚠️ خطأ باستشارة Claude: {e}")
        # في حال فشل الاتصال، نرفض الصفقة احتياطاً
        return {"approve": False, "reason": "فشل الاتصال بـ Claude - تم الرفض احتياطاً"}


def execute_trade(signal):
    """ينفذ الصفقة فعلياً على MT5"""
    symbol = signal["symbol"]
    direction = signal["direction"]
    volume = signal["volume"]
    sl = signal["sl"]
    tp = signal["tp"]

    order_type = mt5.ORDER_TYPE_BUY if direction == "BUY" else mt5.ORDER_TYPE_SELL
    price = mt5.symbol_info_tick(symbol).ask if direction == "BUY" else mt5.symbol_info_tick(symbol).bid

    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": volume,
        "type": order_type,
        "price": price,
        "sl": sl,
        "tp": tp,
        "deviation": 20,
        "magic": 123456,
        "comment": "AI-approved",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }

    result = mt5.order_send(request)
    if result.retcode != mt5.TRADE_RETCODE_DONE:
        print(f"❌ فشل تنفيذ الصفقة: {result.comment}")
        return False
    print(f"✅ تم فتح صفقة {direction} على {symbol}")
    return True


def log_decision(signal, decision, executed):
    """يسجل القرار في ملف log"""
    log_entry = {
        "time": datetime.now().isoformat(),
        "signal": signal,
        "decision": decision,
        "executed": executed,
    }
    with open("trade_decisions.log", "a", encoding="utf-8") as f:
        f.write(json.dumps(log_entry, ensure_ascii=False) + "\n")


def main():
    print("=" * 50)
    print("🤖 AI Trade Filter")
    print("=" * 50)

    if not connect_mt5():
        return

    print(f"📂 يراقب: {SIGNAL_FILE}")
    print("اضغط Ctrl+C للإيقاف\n")

    try:
        while True:
            signal = read_signal()

            if signal:
                print(f"\n📨 إشارة جديدة: {signal['direction']} {signal['symbol']}")
                print("🧠 يستشير Claude...")

                decision = ask_claude(signal)
                print(f"   القرار: {'✅ موافق' if decision['approve'] else '❌ مرفوض'}")
                print(f"   السبب: {decision['reason']}")

                executed = False
                if decision["approve"]:
                    executed = execute_trade(signal)

                log_decision(signal, decision, executed)
                mark_signal_processed()

            time.sleep(CHECK_INTERVAL)

    except KeyboardInterrupt:
        print("\n⏹️  تم الإيقاف")
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    main()
