"""
يطلّع ملخص صفقات حسابك من MT5 — تنسخه لكلود للتشخيص.
التشغيل (MT5 مفتوح ومسجّل دخول):  python trade_report.py
"""

def main():
    import MetaTrader5 as mt5
    from datetime import datetime, timedelta

    if not mt5.initialize():
        print("فشل الاتصال بـ MT5:", mt5.last_error()); return

    acc = mt5.account_info()
    to_date = datetime.now() + timedelta(days=1)
    from_date = datetime.now() - timedelta(days=60)   # آخر 60 يوم
    deals = mt5.history_deals_get(from_date, to_date)
    if deals is None:
        print("ما فيه صفقات / خطأ:", mt5.last_error()); mt5.shutdown(); return

    # صفقات الإغلاق فقط (الربح المحقّق)
    closed = [d for d in deals if d.entry == mt5.DEAL_ENTRY_OUT]

    by_sym = {}
    total_net = wins = losses = 0
    gross_win = gross_loss = 0.0
    for d in closed:
        net = d.profit + d.swap + d.commission
        total_net += net
        if net > 0: wins += 1; gross_win += net
        elif net < 0: losses += 1; gross_loss += -net
        s = d.symbol or "?"
        by_sym.setdefault(s, {"n": 0, "net": 0.0})
        by_sym[s]["n"] += 1; by_sym[s]["net"] += net

    n = wins + losses
    print("=" * 52)
    print("  تقرير صفقات MT5 — آخر 60 يوم")
    print("=" * 52)
    if acc:
        print(f"  الرصيد: {acc.balance:.2f} {acc.currency} | الإكويتي: {acc.equity:.2f}")
    print(f"  إجمالي الصفقات المغلقة: {n}")
    print(f"  رابحة: {wins}   خاسرة: {losses}   نسبة الفوز: {(100*wins/n if n else 0):.1f}%")
    print(f"  صافي الربح/الخسارة: {total_net:+.2f}")
    pf = (gross_win/gross_loss) if gross_loss > 0 else 0
    print(f"  عامل الربح (PF): {pf:.2f}")
    if wins: print(f"  متوسط الرابحة: {gross_win/wins:+.2f}")
    if losses: print(f"  متوسط الخاسرة: {-gross_loss/losses:+.2f}")
    print("-" * 52)
    print("  حسب الرمز:")
    for s, v in sorted(by_sym.items(), key=lambda x: x[1]["net"]):
        print(f"    {s:12} صفقات {v['n']:4d}   صافي {v['net']:+.2f}")
    print("=" * 52)
    print("  انسخ كل هذا وأرسله لكلود.")
    mt5.shutdown()

if __name__ == "__main__":
    try:
        main()
    except ModuleNotFoundError:
        print("!! مكتبة MetaTrader5 مو منصّبة. شغّل بنفس بايثون الأجنت.")
    except Exception as e:
        print("!! خطأ:", repr(e))
    try:
        input("\n--- اضغط Enter للإغلاق ---")
    except Exception:
        pass
