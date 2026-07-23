"""
اختبارات بوابة الترقية. تشغيل:  python -m pytest backend/test_promotion_gate.py -q
أو بدون pytest:               python backend/test_promotion_gate.py
كلها منطق نقي — لا سيرفر ولا شبكة.
"""
import copy
from promotion_gate import evaluate, map_params, SAFETY_FLOORS

# مرشّح "مثالي" يعدّي كل الفحوصات — نبني منه الحالات السلبية بالتعديل.
GOOD = {
    "strategy": "fastest_gold", "symbol": "XAUUSDm", "timeframe": "M5",
    "validation": "walk_forward",
    "baseline":  {"net_usd": 10.0,  "profit_factor": 1.00, "max_drawdown_pct": -12.0, "sharpe": -0.1},
    "candidate": {
        "params": {"rsi_buy_max": 55, "rsi_sell_min": 30, "atr_mult": 1.2, "use_mtf": True},
        "trades": 220, "net_usd": 480.0, "profit_factor": 1.45,
        "max_drawdown_pct": -11.0, "sharpe": 0.62,
    },
}


def _mut(**over):
    """نسخة من GOOD مع تعديل حقول candidate."""
    p = copy.deepcopy(GOOD)
    p["candidate"].update(over)
    return p


def test_good_candidate_is_approved():
    r = evaluate(GOOD)
    assert r["approved"] is True, r["reasons"]
    assert r["applied_params"]["RSIBuyMax"] == 55.0
    assert r["applied_params"]["UseH1Filter"] == 1


def test_reject_when_not_out_of_sample():
    p = copy.deepcopy(GOOD); p["validation"] = "in_sample"
    r = evaluate(p)
    assert r["approved"] is False
    assert any("خارج العينة" in x for x in r["reasons"])


def test_reject_missing_validation_field_fail_closed():
    p = copy.deepcopy(GOOD); p.pop("validation")
    assert evaluate(p)["approved"] is False   # الغياب = رفض احترازي


def test_reject_too_few_trades():
    assert evaluate(_mut(trades=40))["approved"] is False


def test_reject_low_profit_factor():
    assert evaluate(_mut(profit_factor=1.05))["approved"] is False


def test_reject_deep_drawdown():
    assert evaluate(_mut(max_drawdown_pct=-45.0))["approved"] is False


def test_reject_negative_sharpe():
    assert evaluate(_mut(sharpe=-0.29))["approved"] is False


def test_reject_when_no_improvement_over_baseline():
    # يعدّي عتبات الأمان لكن لا يتفوّق على الحالي
    p = copy.deepcopy(GOOD)
    p["baseline"] = {"net_usd": 480.0, "profit_factor": 1.45, "max_drawdown_pct": -11.0, "sharpe": 0.6}
    r = evaluate(p)
    assert r["approved"] is False
    assert any("يتفوّق" in x for x in r["reasons"])


def test_reject_the_real_world_losing_candidate():
    # الحالة الفعلية من DEFAULT_BACKTEST_RESULT: مرشّح خسر -44% out-of-sample
    losing = {
        "validation": "walk_forward",
        "baseline":  {"net_usd": 10.14, "profit_factor": 1.00, "max_drawdown_pct": -104.54, "sharpe": -0.28},
        "candidate": {
            "params": {"rsi_buy_max": 55, "rsi_sell_min": 30, "atr_mult": 1.0, "use_mtf": True},
            "trades": 173, "net_usd": -4481.76, "profit_factor": 0.84,
            "max_drawdown_pct": -78.86, "sharpe": -0.29,
        },
    }
    assert evaluate(losing)["approved"] is False


def test_params_are_clamped_to_safe_ranges():
    # قيم متطرفة لازم تتقصّ على الحدود، مش تتطبّق كما هي
    applied, skipped = map_params({"rsi_buy_max": 999, "atr_mult": -5, "unknown_x": 1})
    assert applied["RSIBuyMax"] == 75.0     # القصّ للحد الأعلى
    assert applied["AutoSLATR"] == 0.5      # القصّ للحد الأدنى
    assert "unknown_x" in skipped           # المجهول يُتجاهَل بأمان


def test_unknown_params_only_means_no_apply():
    p = _mut(params={"totally_unknown": 1})
    r = evaluate(p)
    assert r["approved"] is False           # نجح التحقّق لكن لا شيء معروف لتطبيقه


if __name__ == "__main__":
    import traceback
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    for fn in fns:
        try:
            fn(); passed += 1; print(f"  ✅ {fn.__name__}")
        except Exception:
            print(f"  ❌ {fn.__name__}"); traceback.print_exc()
    print(f"\n{passed}/{len(fns)} اختبار نجح")
    raise SystemExit(0 if passed == len(fns) else 1)
