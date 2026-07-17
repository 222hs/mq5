"""
فحص: هل بروكرك يعطي فوليوم حقيقي (Real Volume) أو tick volume فقط؟
يقرّر إذا استراتيجية Order Flow / Volume Profile تستاهل على حسابك.

التشغيل (MT5 لازم يكون مفتوح ومسجّل دخول):
    python check_volume.py
"""
import MetaTrader5 as mt5

def main():
    if not mt5.initialize():
        print("❌ فشل الاتصال بـ MT5:", mt5.last_error())
        print("   تأكد MT5 مفتوح ومسجّل دخول.")
        return

    # يلقى رمز الذهب تلقائياً (XAU...)
    gold = None
    for s in mt5.symbols_get():
        if "XAU" in s.name.upper():
            gold = s.name
            break
    if gold is None:
        print("⚠️ ما لقيت رمز ذهب (XAU). جرّب رمز ثاني يدوياً.")
        mt5.shutdown()
        return

    mt5.symbol_select(gold, True)
    rates = mt5.copy_rates_from_pos(gold, mt5.TIMEFRAME_M1, 0, 30)
    if rates is None or len(rates) == 0:
        print("⚠️ ما قدرت أسحب بيانات لـ", gold)
        mt5.shutdown()
        return

    rv = [int(x['real_volume']) for x in rates]
    tv = [int(x['tick_volume']) for x in rates]

    print("=" * 50)
    print("الرمز:", gold)
    print("real_volume (آخر 8):", rv[:8])
    print("tick_volume (آخر 8):", tv[:8])
    print("-" * 50)
    if any(v > 0 for v in rv):
        print("✅ REAL VOLUME AVAILABLE — فوليوم حقيقي متاح")
        print("   → استراتيجية Order Flow ممكن نجرّبها.")
    else:
        print("❌ NO REAL VOLUME — tick volume فقط")
        print("   → استراتيجية Order Flow ضعيفة على بروكرك، ما تستاهل.")
    print("=" * 50)

    mt5.shutdown()

if __name__ == "__main__":
    main()
