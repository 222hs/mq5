"""
فحص: هل بروكرك يعطي فوليوم حقيقي (Real Volume) أو tick volume فقط؟
التشغيل (MT5 مفتوح ومسجّل دخول):  python check_volume.py
"""

def main():
    import MetaTrader5 as mt5   # داخل try عشان لو المكتبة مو منصّبة يبان الخطأ
    if not mt5.initialize():
        print("فشل الاتصال بـ MT5:", mt5.last_error())
        print("تأكد MT5 مفتوح ومسجّل دخول.")
        return
    gold = None
    for s in mt5.symbols_get():
        if "XAU" in s.name.upper():
            gold = s.name
            break
    if gold is None:
        print("ما لقيت رمز ذهب (XAU).")
        mt5.shutdown(); return
    mt5.symbol_select(gold, True)
    rates = mt5.copy_rates_from_pos(gold, mt5.TIMEFRAME_M1, 0, 30)
    if rates is None or len(rates) == 0:
        print("ما قدرت أسحب بيانات لـ", gold)
        mt5.shutdown(); return
    rv = [int(x['real_volume']) for x in rates]
    tv = [int(x['tick_volume']) for x in rates]
    print("=" * 45)
    print("Symbol:", gold)
    print("real_volume:", rv[:8])
    print("tick_volume:", tv[:8])
    print("-" * 45)
    if any(v > 0 for v in rv):
        print(">>> REAL VOLUME AVAILABLE  (فوليوم حقيقي متاح)")
    else:
        print(">>> NO REAL VOLUME - tick only  (تِك فقط)")
    print("=" * 45)
    mt5.shutdown()

if __name__ == "__main__":
    try:
        main()
    except ModuleNotFoundError:
        print("!! مكتبة MetaTrader5 مو منصّبة على هذا البايثون.")
        print("   نصّبها:  pip install MetaTrader5")
        print("   أو شغّل الملف بنفس بايثون الأجنت.")
    except Exception as e:
        print("!! خطأ:", repr(e))
    try:
        input("\n--- اضغط Enter للإغلاق ---")
    except Exception:
        pass
