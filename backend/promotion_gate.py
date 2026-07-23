"""
promotion_gate.py — بوابة الترقية الآمنة للتعلّم الأوتوماتيكي.

القاعدة الوحيدة التي لا تُخالَف أبداً:
    لا يُطبَّق أي إعداد مرشّح على البوت الحي إلا إذا تحقّقت كل الشروط الآتية:
      1) نتيجة الباك-تست خارج العينة (out-of-sample / walk-forward) — لا داخل العينة.
      2) تجاوز المرشّح كل عتبات الأمان المطلقة (عدد صفقات، profit factor، تراجع، sharpe).
      3) تفوّق على الإعداد الحالي (baseline) بهامش حقيقي.
      4) تحقّق الـ backend من ذلك بنفسه — لا يثق في حقل `decision` القادم من المُرسِل.

الفلسفة: fail-closed. أي شكّ = رفض. الرفض آمن؛ الترقية الخاطئة تخسر فلوس حقيقية.

الموديول نقي تماماً: لا Flask، لا شبكة، لا قاعدة بيانات — عشان يكون قابلاً للاختبار
بالكامل بدون تشغيل السيرفر. الربط مع app.py يحصل عبر دالة evaluate() فقط.
"""

# ————————————————— عتبات الأمان المطلقة —————————————————
# مرشّح لا يحقّق كل هذه يُرفض فوراً مهما قال المُرسِل.
SAFETY_FLOORS = {
    "min_trades":         150,    # أقل من كده = عيّنة صغيرة، النتيجة ضوضاء مش إشارة
    "min_profit_factor":  1.30,   # هامش فوق 1.0 يمتص السبريد/الانزلاق الحي
    "max_drawdown_floor": -20.0,  # max_drawdown_pct لازم يكون أكبر من (أقل عمقاً من) ده
    "min_sharpe":         0.30,   # عائد معدّل بالمخاطرة موجب وذو معنى
}

# هامش التفوّق المطلوب على الإعداد الحالي — عشان ما نرقّيش على تحسّن وهمي داخل الضوضاء.
IMPROVEMENT = {
    "min_net_gain_usd":      1.0,   # لازم يكسب أكثر من الحالي بمقدار ملموس
    "min_pf_gain":           0.05,  # أو على الأقل profit factor أعلى بهامش
    "max_drawdown_worsening": 2.0,  # ممنوع يعمّق التراجع أكثر من نقطتين مئويتين
}

# القيم المسموح بها للتحقّق خارج العينة — أي قيمة غير هذه تُعامَل كـ "غير موثّقة" = رفض.
VALID_OOS = {"walk_forward", "out_of_sample", "oos", "cross_validated"}

# خريطة أسماء باراميترات الباك-تست → مفاتيح إعدادات الـ EA، مع حدود قصوى/دنيا آمنة.
# (backtest_param): (ea_key, lo, hi, cast)
# أي باراميتر مش في الخريطة دي يُتجاهَل بأمان — ما بنطبّقش حاجة مش فاهمينها.
PARAM_RULES = {
    "rsi_buy_max":  ("RSIBuyMax",  40.0, 75.0, float),
    "rsi_sell_min": ("RSISellMin", 25.0, 60.0, float),
    "atr_mult":     ("AutoSLATR",  0.5,  5.0,  float),
    "sl_atr_mult":  ("AutoSLATR",  0.5,  5.0,  float),
    "tp_rr":        ("AutoTPRR",   1.0,  5.0,  float),
    "sl_usd":       ("SL_USD",     1.0,  20.0, float),
    "tp_usd":       ("TP_USD",     1.0,  40.0, float),
    "use_mtf":      ("UseH1Filter", 0,   1,    lambda v: 1 if v else 0),
}


def _num(value, default=None):
    """تحويل آمن لرقم؛ يرجّع default لو القيمة ناقصة أو غير صالحة."""
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _clamp(value, lo, hi):
    return max(lo, min(hi, value))


def map_params(raw_params):
    """
    تحوّل باراميترات الباك-تست لمفاتيح EA مع القصّ على الحدود الآمنة.
    ترجّع (applied, skipped): applied = dict جاهز لـ save_settings،
    skipped = أسماء الباراميترات اللي اتجاهلت (مش في الخريطة).
    """
    applied, skipped = {}, []
    for name, val in (raw_params or {}).items():
        rule = PARAM_RULES.get(name)
        if rule is None:
            skipped.append(name)
            continue
        ea_key, lo, hi, cast = rule
        try:
            casted = cast(val)
        except (TypeError, ValueError):
            skipped.append(name)
            continue
        applied[ea_key] = _clamp(casted, lo, hi)
    return applied, skipped


def evaluate(payload):
    """
    القلب: تقيّم نتيجة باك-تست وتقرّر هل تُرقّى (تُطبَّق) أوتوماتيك أم تُرفض.

    payload: dict فيه على الأقل baseline, candidate, وحقل تحقّق out-of-sample.
             candidate يُتوقّع أن يحوي params + المقاييس (trades, net_usd,
             profit_factor, max_drawdown_pct, sharpe).

    ترجّع dict:
      {
        "approved": bool,
        "reasons":  [str, ...],   # سبب الرفض، أو سبب القبول
        "applied_params": {EA_KEY: value},   # فاضي لو مرفوض
        "checks":   {name: bool/value, ...},  # تفاصيل لكل فحص (للتدقيق)
      }
    """
    reasons, checks = [], {}
    candidate = payload.get("candidate") or {}
    baseline  = payload.get("baseline") or {}

    # (0) لازم يكون خارج العينة — fail-closed لو الحقل ناقص.
    oos = str(payload.get("validation") or payload.get("oos") or "").lower()
    checks["validation"] = oos
    if oos not in VALID_OOS:
        reasons.append(
            f"التحقّق ليس خارج العينة (validation={oos!r}) — "
            f"المسموح: {sorted(VALID_OOS)}. رفض احترازي."
        )
        return {"approved": False, "reasons": reasons, "applied_params": {}, "checks": checks}

    # (1) عتبات الأمان المطلقة على المرشّح.
    trades = _num(candidate.get("trades"))
    pf     = _num(candidate.get("profit_factor"))
    dd     = _num(candidate.get("max_drawdown_pct"))
    sharpe = _num(candidate.get("sharpe"))
    checks.update({"trades": trades, "profit_factor": pf,
                   "max_drawdown_pct": dd, "sharpe": sharpe})

    if trades is None or trades < SAFETY_FLOORS["min_trades"]:
        reasons.append(f"عدد الصفقات {trades} < الحد الأدنى {SAFETY_FLOORS['min_trades']} — عيّنة غير كافية.")
    if pf is None or pf < SAFETY_FLOORS["min_profit_factor"]:
        reasons.append(f"Profit factor {pf} < {SAFETY_FLOORS['min_profit_factor']}.")
    if dd is None or dd < SAFETY_FLOORS["max_drawdown_floor"]:
        reasons.append(f"أقصى تراجع {dd}% أعمق من الحد {SAFETY_FLOORS['max_drawdown_floor']}%.")
    if sharpe is None or sharpe < SAFETY_FLOORS["min_sharpe"]:
        reasons.append(f"Sharpe {sharpe} < {SAFETY_FLOORS['min_sharpe']}.")

    # (2) لازم يتفوّق على الإعداد الحالي بهامش حقيقي.
    b_net = _num(baseline.get("net_usd"), 0.0)
    c_net = _num(candidate.get("net_usd"), 0.0)
    b_pf  = _num(baseline.get("profit_factor"), 0.0)
    b_dd  = _num(baseline.get("max_drawdown_pct"), 0.0)
    net_gain = (c_net or 0.0) - (b_net or 0.0)
    pf_gain  = (pf or 0.0) - (b_pf or 0.0)
    checks.update({"net_gain_usd": net_gain, "pf_gain": pf_gain})

    beats_net = net_gain >= IMPROVEMENT["min_net_gain_usd"]
    beats_pf  = pf_gain  >= IMPROVEMENT["min_pf_gain"]
    if not (beats_net or beats_pf):
        reasons.append(
            f"لا يتفوّق على الحالي: ربح صافٍ +${net_gain:.2f} (يلزم ≥${IMPROVEMENT['min_net_gain_usd']}) "
            f"و PF {pf_gain:+.2f} (يلزم ≥{IMPROVEMENT['min_pf_gain']})."
        )
    # ممنوع يعمّق التراجع بشكل ملحوظ حتى لو كسب أكثر.
    if dd is not None and b_dd is not None and (b_dd - dd) > IMPROVEMENT["max_drawdown_worsening"]:
        reasons.append(
            f"يعمّق التراجع: من {b_dd:.1f}% إلى {dd:.1f}% "
            f"(أكثر من {IMPROVEMENT['max_drawdown_worsening']} نقطة)."
        )

    if reasons:
        return {"approved": False, "reasons": reasons, "applied_params": {}, "checks": checks}

    # (3) نجح كل الفحوصات → جهّز الباراميترات للتطبيق.
    applied, skipped = map_params(candidate.get("params"))
    checks["skipped_params"] = skipped
    if not applied:
        reasons.append("نجح التحقّق لكن لا توجد باراميترات معروفة قابلة للتطبيق.")
        return {"approved": False, "reasons": reasons, "applied_params": {}, "checks": checks}

    reasons.append(
        f"مقبول: {int(trades)} صفقة، PF {pf:.2f}، تراجع {dd:.1f}%، "
        f"Sharpe {sharpe:.2f}؛ يتفوّق على الحالي بـ +${net_gain:.2f}."
    )
    return {"approved": True, "reasons": reasons, "applied_params": applied, "checks": checks}
