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
import urllib.request
import threading
from datetime import datetime, timezone

# ============== الإعدادات ==============
BACKEND_URL             = "https://mq5-production.up.railway.app"
API_KEY                 = "mysecretkey123"
UPDATE_INTERVAL         = 2    # ثواني بين كل تحديث للبيانات
SETTINGS_CHECK_INTERVAL = 15   # ثواني بين كل سحب للإعدادات
CANDLES_INTERVAL        = 10   # ثواني بين كل إرسال للشمعات
# ========================================

HEADERS = {"X-API-Key": API_KEY, "Content-Type": "application/json"}

# Session واحدة مع keep-alive — تجنب فتح TCP جديد كل مرة
_session = requests.Session()
_session.headers.update({"X-API-Key": API_KEY, "Content-Type": "application/json"})
_session.headers.update(HEADERS)
adapter = requests.adapters.HTTPAdapter(
    max_retries=0,
    pool_connections=2,
    pool_maxsize=4,
    pool_block=False,
)
_session.mount("https://", adapter)
_session.mount("http://",  adapter)

# مسار ملف الإعدادات في مجلد MT5 المشترك
_MT5_COMMON = os.path.join(
    os.environ.get("APPDATA", ""),
    "MetaQuotes", "Terminal", "Common", "Files"
)
SETTINGS_FILE   = os.path.join(_MT5_COMMON, "GSX_Settings.json")
CURRENT_FILE    = os.path.join(_MT5_COMMON, "GSX_Current.json")  # الإعدادات الفعلية التي يكتبها البوت
BTC_CURRENT_FILE = os.path.join(_MT5_COMMON, "BSX_Current.json")

# ── قاعدة بيانات محلية على جهاز Windows ─────────────────────────────
_LOCAL_DIR       = os.path.dirname(os.path.abspath(__file__))
_LOCAL_SNAPSHOTS = os.path.join(_LOCAL_DIR, "local_snapshots.json")
_LOCAL_HISTORY   = os.path.join(_LOCAL_DIR, "local_history.json")

def _load_local_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def _save_local_json(path, data):
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
    except Exception as e:
        print(f"⚠️ فشل حفظ {path}: {e}")

def save_local_snapshot(snap):
    """يحفظ snapshot محلياً بالـ ticket كـ key"""
    tk = str(snap.get("ticket", ""))
    if not tk:
        return
    db = _load_local_json(_LOCAL_SNAPSHOTS)
    db[tk] = snap
    # احتفظ بآخر 500 snapshot فقط
    if len(db) > 500:
        keys = sorted(db.keys())
        for k in keys[:len(db)-500]:
            del db[k]
    _save_local_json(_LOCAL_SNAPSHOTS, db)

def save_local_history(trades):
    """يحفظ الـ history محلياً"""
    if not trades:
        return
    db = _load_local_json(_LOCAL_HISTORY)
    for t in trades:
        tk = str(t.get("ticket", ""))
        if tk:
            db[tk] = t
    # احتفظ بآخر 2000 صفقة
    if len(db) > 2000:
        keys = sorted(db.keys())
        for k in keys[:len(db)-2000]:
            del db[k]
    _save_local_json(_LOCAL_HISTORY, db)

_LOCAL_SETTINGS = os.path.join(_LOCAL_DIR, "local_settings.json")

def save_local_settings(settings):
    """يحفظ الإعدادات محلياً — مصدر الحقيقة عند Railway redeploy"""
    _save_local_json(_LOCAL_SETTINGS, settings)

def _push_local_settings_direct():
    """داخلي فقط — لا تستدعه مباشرة، استخدم push_local_settings أدناه"""
    pass


def upload_local_snapshots():
    """عند startup: يرفع كل الـ snapshots المحلية للبكند"""
    db = _load_local_json(_LOCAL_SNAPSHOTS)
    if not db:
        return
    print(f"📤 رفع {len(db)} snapshot محلي للبكند ...")
    uploaded = 0
    for snap in db.values():
        try:
            r = _session.post(f"{BACKEND_URL}/api/trade_snapshot", json=snap, timeout=(5, 8))
            if r.status_code == 200:
                uploaded += 1
        except Exception:
            pass
    print(f"✅ تم رفع {uploaded}/{len(db)} snapshots")


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


def get_h1_bias(symbol):
    """يحسب H1 EMA21 bias — True=صاعد (BUY bias) / False=هابط (SELL bias)"""
    rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_H1, 0, 30)
    if rates is None or len(rates) < 25:
        return None
    closes = [float(r["close"]) for r in rates]
    ema = _calc_ema(closes, 21)
    # مقارنة EMA الحالية بالسابقة — حساب EMA على آخر 29 شمعة للمقارنة
    ema_prev = _calc_ema(closes[:-1], 21)
    return ema >= ema_prev


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
        response = _session.post(
            f"{BACKEND_URL}/api/update", json=data, timeout=(5, 8)
        )
        if response.status_code == 200:
            print(f"✅ {datetime.now().strftime('%H:%M:%S')} - تم إرسال البيانات")
        else:
            print(f"⚠️ خطأ بالإرسال: {response.status_code}")
    except requests.exceptions.Timeout:
        print(f"⏳ {datetime.now().strftime('%H:%M:%S')} - timeout")
    except Exception as e:
        print(f"⚠️ فشل الاتصال: {type(e).__name__}")


def send_candles():
    """يرسل الشمعات في background — لا يعطل الـ loop"""
    def _bg():
        try:
            symbol   = detect_gold_symbol()
            candles  = get_candles(symbol, mt5.TIMEFRAME_M1, 60)
            sessions = get_trading_sessions()
            response = _session.post(
                f"{BACKEND_URL}/api/candles",
                json={"candles": candles, "sessions": sessions},
                timeout=(5, 10)
            )
            if response.status_code == 200:
                print(f"🕯️  {datetime.now().strftime('%H:%M:%S')} - {symbol}: {len(candles)} شمعة")
        except Exception:
            pass  # شمعات اختيارية — تُعاد بعد 10s
    threading.Thread(target=_bg, daemon=True).start()


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
        r = _session.post(
            f"{BACKEND_URL}/api/settings/seed",
            json=local, timeout=(5, 10),
        )
        if r.status_code == 200:
            if r.json().get("applied"):
                print(f"📤 {datetime.now().strftime('%H:%M:%S')} - تم رفع إعدادات البوت الفعلية للداشبورد")
        elif r.status_code == 404:
            pass  # backend قديم — تجاهل
    except Exception:
        pass  # غير حرج — سيُعاد في الدورة القادمة


def push_grx_settings():
    """
    يدفع إعدادات GRX المحلية (GRX_Settings.json) للـ Backend.
    تُقبل فقط إذا كان الـ container جديداً (لم يحفظ المستخدم شيئاً بعد) —
    يمنع فقدان إعدادات GRX بعد كل Railway redeploy، ويمنع sync_grx_settings()
    من دهس النسخة المحلية الصحيحة بقيم افتراضية مُصفّرة.
    """
    grx_file = os.path.join(_MT5_COMMON, "GRX_Settings.json")
    if not os.path.exists(grx_file):
        return
    try:
        with open(grx_file, "r", encoding="utf-8") as f:
            local = json.load(f)
    except Exception:
        return
    try:
        r = _session.post(
            f"{BACKEND_URL}/api/settings/grx/seed",
            json=local, timeout=(5, 10),
        )
        if r.status_code == 200 and r.json().get("applied"):
            print(f"📤 {datetime.now().strftime('%H:%M:%S')} - تم رفع إعدادات GRX المحلية للداشبورد")
    except Exception:
        pass  # غير حرج — سيُعاد في الدورة القادمة


def push_hedge_settings():
    """يقرأ GSX_Hedge.json من MT5 Common ويرسله للـ backend."""
    hedge_file = os.path.join(_MT5_COMMON, "GSX_Hedge.json")
    if not os.path.exists(hedge_file):
        return
    try:
        with open(hedge_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        _session.post(f"{BACKEND_URL}/api/settings/hedge", json=data, timeout=(5, 10))
    except Exception:
        pass


_last_settings_hash     = None  # نتتبع التغييرات
_last_btc_settings_hash = None
_known_positions    = {}    # ticket -> position — لكشف الصفقات الجديدة
_snapped_tickets    = set() # tickets مفتوحة أُرسل لها snapshot
_snapped_history    = set() # tickets مغلقة أُرسل لها snapshot من history
_news_cache         = []    # آخر قائمة أخبار مجلوبة
_news_cache_time    = 0     # وقت آخر تحديث للأخبار


# ── فلتر الأخبار ─────────────────────────────────────────────────────
NEWS_BLOCK_BEFORE_MIN = 30   # دقائق قبل الخبر نوقف التداول
NEWS_BLOCK_AFTER_MIN  = 15   # دقائق بعد الخبر نوقف التداول
NEWS_CACHE_TTL        = 3600  # تحديث التقويم كل ساعة

def _fetch_news_calendar():
    """يجلب تقويم الأخبار من ForexFactory — يُخزّن للتذاكرة"""
    global _news_cache, _news_cache_time
    now = time.time()
    if now - _news_cache_time < NEWS_CACHE_TTL and _news_cache:
        return _news_cache
    try:
        url = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            events = json.loads(r.read())
        _news_cache = events
        _news_cache_time = now
        print(f"📰 {datetime.now().strftime('%H:%M:%S')} - تحديث تقويم الأخبار ({len(events)} حدث)")
    except Exception as e:
        print(f"⚠️  فشل جلب تقويم الأخبار: {e}")
    return _news_cache


def check_news_filter():
    """
    يتحقق من الأخبار العالية التأثير القادمة/الحديثة.
    يكتب GSX_NewsBlock.txt:
      '1|NFP -25min'  → محظور
      '0'             → مسموح
    يرسل حالة الأخبار للـ Backend.
    """
    events = _fetch_news_calendar()
    now_utc = datetime.now(timezone.utc)

    blocked = False
    block_title = ""

    high_countries = {"USD", "XAU"}

    for e in events:
        if e.get("impact") not in ("High",):
            continue
        if e.get("country") not in high_countries:
            continue
        try:
            # ForexFactory format: "2025-05-02T12:30:00-0400"
            raw = e["date"]
            # Python fromisoformat لا يدعم -0400 بدون ':'، نصلحه
            if len(raw) > 19 and raw[-5] in ('+', '-') and ':' not in raw[-6:]:
                raw = raw[:-2] + ':' + raw[-2:]
            t = datetime.fromisoformat(raw)
            if t.tzinfo is None:
                t = t.replace(tzinfo=timezone.utc)
            diff_min = (t - now_utc).total_seconds() / 60

            if -NEWS_BLOCK_AFTER_MIN <= diff_min <= NEWS_BLOCK_BEFORE_MIN:
                blocked = True
                sign = "+" if diff_min > 0 else ""
                block_title = f"{e.get('title','News')} {sign}{round(diff_min)}min"
                break
        except Exception:
            continue

    # كتابة ملف الحظر للـ EA
    news_file = os.path.join(_MT5_COMMON, "GSX_NewsBlock.txt")
    try:
        os.makedirs(os.path.dirname(news_file), exist_ok=True)
        with open(news_file, "w", encoding="ascii") as f:
            f.write(f"1|{block_title}" if blocked else "0")
    except Exception:
        pass

    if blocked:
        print(f"🚫 {datetime.now().strftime('%H:%M:%S')} - أخبار مرتفعة: {block_title} → تداول موقوف")
    return {"blocked": blocked, "title": block_title}


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


def _send_snapshot_bg(snapshot):
    """يحفظ snapshot محلياً ويرسله للبكند في background"""
    # حفظ محلي أولاً — يضمن البقاء حتى بعد Railway redeploy
    save_local_snapshot(snapshot)
    try:
        r = _session.post(
            f"{BACKEND_URL}/api/trade_snapshot",
            json=snapshot, timeout=(5, 10),
        )
        if r.status_code == 200:
            arrow = '↑' if snapshot.get('ema_up') else '↓'
            print(f"📸 {datetime.now().strftime('%H:%M:%S')} - snapshot #{snapshot['ticket']} "
                  f"RSI={snapshot['rsi']} EMA{arrow} ATR={snapshot['atr']} [{snapshot['session']}]")
    except Exception:
        pass  # snapshot اختياري — لا يعطل شي


def send_trade_snapshot(ticket, position, candles_list, sessions):
    """يبني snapshot ويرسله في background — لا يعطل الـ loop الرئيسي"""
    snapshot = _build_snapshot(ticket, position, candles_list, sessions)
    threading.Thread(target=_send_snapshot_bg, args=(snapshot,), daemon=True).start()

def detect_active_bots():
    """يكتشف البوتات النشطة من ملفات Current.json — معدّل خلال آخر 60 ثانية"""
    now = time.time()
    gold_active = False
    btc_active  = False
    for fpath, flag in [(CURRENT_FILE, "gold"), (BTC_CURRENT_FILE, "btc")]:
        if os.path.exists(fpath):
            try:
                age = now - os.path.getmtime(fpath)
                if age < 60:
                    if flag == "gold": gold_active = True
                    else:              btc_active  = True
            except Exception:
                pass
    return gold_active, btc_active


def sync_btc_settings():
    """يسحب إعدادات البتكوين من الصفحة ويكتبها لـ BSX_*.txt"""
    global _last_btc_settings_hash
    for attempt in range(2):
        try:
            r = _session.get(f"{BACKEND_URL}/api/settings/btc", timeout=(5, 12))
            if r.status_code != 200:
                return
            settings = r.json()
            import hashlib
            new_hash = hashlib.md5(json.dumps(settings, sort_keys=True).encode()).hexdigest()
            if new_hash == _last_btc_settings_hash:
                return  # لا تغييرات — صمت
            _last_btc_settings_hash = new_hash
            t = datetime.now().strftime('%H:%M:%S')
            ot = {0:'MARKET', 1:'LIMIT', 2:'STOP', 3:'BASKET'}.get(int(settings.get('OrderType', 0)), 'MARKET')
            print(f"\n{'='*55}")
            print(f"₿  [{t}] إعدادات بتكوين جديدة:")
            print(f"   Lot={settings.get('LotSize')}  TP$={settings.get('TP_USD')}  SL$={settings.get('SL_USD')}")
            print(f"   MaxSpread={settings.get('MaxSpread')}  MaxPos={settings.get('MaxPositions')}  CD={settings.get('CooldownSecs')}s")
            print(f"   OrderType={ot}  Bot={'ON' if settings.get('BotRunning') else 'OFF'}")
            btc_keys = [
                "LotSize", "TP_USD", "SL_USD", "MaxSpread", "MaxPositions",
                "CooldownSecs", "MaxLossPerDay", "MaxProfitPerDay",
                "TradeHoursStart", "TradeHoursEnd", "BotRunning",
                "OrderType", "RiskMode", "RiskPercent",
                "RSIBuyMax", "RSISellMin", "UseH1Filter",
                "StrategyMode", "GridLevels", "GridStep",
                "HedgeLotMult", "ScaleStep", "ScaleMult", "MaxScales",
            ]
            for k in btc_keys:
                if k in settings:
                    fpath = os.path.join(_MT5_COMMON, f"BSX_{k}.txt")
                    try:
                        with open(fpath, "w", encoding="ascii") as f:
                            f.write(str(settings[k]))
                    except Exception:
                        pass
            print(f"   📝 BSX_*.txt ✓")
            print(f"{'='*55}\n")
            return
        except Exception as e:
            print(f"⚠️ BTC sync: {type(e).__name__}")
            return


_log_positions = {}  # {filepath: byte_offset}

def tail_ea_logs():
    """يقرأ السطور الجديدة من ملفات لوق الـ EA ويرسلها للـ backend."""
    log_files = {
        os.path.join(_MT5_COMMON, "GSX_Log.txt"):       "gold",
        os.path.join(_MT5_COMMON, "BSX_Log.txt"):       "btc",
        os.path.join(_MT5_COMMON, "GSX_Hedge_Log.txt"): "hedge",
    }
    lines_to_send = []
    for fpath, source in log_files.items():
        if not os.path.exists(fpath):
            continue
        pos = _log_positions.get(fpath, 0)
        try:
            with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                f.seek(0, 2)
                size = f.tell()
                if size < pos:
                    pos = 0  # ملف جديد أو تم مسحه
                f.seek(pos)
                new_lines = f.readlines()
                _log_positions[fpath] = f.tell()
            for line in new_lines:
                line = line.strip()
                if not line:
                    continue
                # الشكل: "2026.07.06 12:34:56|message"
                if "|" in line:
                    _, msg = line.split("|", 1)
                else:
                    msg = line
                level = "err" if "FAIL" in msg or "No money" in msg else \
                        "trade" if any(x in msg for x in ["BUY_MKT","SELL_MKT","BUY_LMT","SELL_LMT","GRID","HEDGE","SCALE"]) else \
                        "info"
                lines_to_send.append({"level": level, "msg": f"[{source.upper()}] {msg}"})
        except Exception:
            pass

    if lines_to_send:
        try:
            _session.post(
                f"{BACKEND_URL}/api/ea_log",
                json={"lines": lines_to_send},
                headers={"X-API-KEY": API_KEY},
                timeout=(3, 5),
            )
        except Exception:
            pass


def sync_settings():
    """يسحب الإعدادات من الصفحة ويكتبها للبوت — مع retry تلقائي"""
    global _last_settings_hash
    for attempt in range(2):
        try:
            r = _session.get(
                f"{BACKEND_URL}/api/settings",
                timeout=(5, 12),
            )
            if r.status_code != 200:
                print(f"⚠️  /api/settings رجع {r.status_code}")
                return
            settings = r.json()

            # نتحقق أولاً — لا طباعة إذا لا تغيير
            import hashlib
            new_hash = hashlib.md5(json.dumps(settings, sort_keys=True).encode()).hexdigest()
            if new_hash == _last_settings_hash:
                return  # لا تغييرات — صمت تام
            _last_settings_hash = new_hash

            t = datetime.now().strftime('%H:%M:%S')
            print(f"\n{'='*55}")
            print(f"⚙️  [{t}] إعدادات جديدة من الداشبورد:")
            print(f"   Lot={settings.get('LotSize')}  TP$={settings.get('TP_USD')}  SL$={settings.get('SL_USD')}")
            print(f"   MaxPos={settings.get('MaxPositions')}  Spread={settings.get('MaxSpread')}  CD={settings.get('CooldownSecs')}s")
            ot  = {0:'MARKET', 1:'LIMIT', 2:'STOP', 3:'BASKET'}.get(int(settings.get('OrderType', 0)), 'MARKET')
            rm  = {0:'FIXED LOT', 1:'DYNAMIC %'}.get(int(settings.get('RiskMode', 0)), 'FIXED LOT')
            print(f"   Hours={settings.get('TradeHoursStart')}-{settings.get('TradeHoursEnd')}  Bot={'ON' if settings.get('BotRunning') else 'OFF'}  OrderType={ot}")
            print(f"   LotMode={rm}  RiskPct={settings.get('RiskPercent','?')}%")
            print(f"   RSI BuyMax={settings.get('RSIBuyMax','?')}  RSI SellMin={settings.get('RSISellMin','?')}  Claude={'ON' if settings.get('ClaudeEnabled',1) else 'OFF'}")
            print(f"   🔄 تغييرات مكتشفة — يُكتب الملف")

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

            # إعدادات الذهب (GSX_) — كل الإعدادات
            gold_keys = [
                "LotSize", "TP_USD", "SL_USD", "MaxSpread", "MaxPositions",
                "CooldownSecs", "MaxLossPerDay", "MaxProfitPerDay",
                "TradeHoursStart", "TradeHoursEnd", "BotRunning",
                "OrderType", "RiskMode", "RiskPercent",
                "RSIBuyMax", "RSISellMin", "UseH1Filter",
                "StrategyMode", "GridLevels", "GridStep",
                "HedgeLotMult", "ScaleStep", "ScaleMult", "MaxScales",
            ]
            for k in gold_keys:
                if k in settings:
                    fpath = os.path.join(_MT5_COMMON, f"GSX_{k}.txt")
                    try:
                        with open(fpath, "w", encoding="ascii") as f:
                            f.write(str(settings[k]))
                    except Exception:
                        pass

            # إعدادات البتكوين (BSX_) — فقط الإعدادات المشتركة التي لا تتعارض مع قيم الذهب
            # TP/SL/Lot/MaxSpread مختلفة لكل بوت — لا تُكتب من هنا
            btc_shared_keys = [
                "BotRunning", "OrderType", "TradeHoursStart", "TradeHoursEnd",
                "RiskMode", "RiskPercent",
                "RSIBuyMax", "RSISellMin", "UseH1Filter",
                "StrategyMode", "GridLevels", "GridStep",
                "HedgeLotMult", "ScaleStep", "ScaleMult", "MaxScales",
            ]
            for k in btc_shared_keys:
                if k in settings:
                    fpath = os.path.join(_MT5_COMMON, f"BSX_{k}.txt")
                    try:
                        with open(fpath, "w", encoding="ascii") as f:
                            f.write(str(settings[k]))
                    except Exception:
                        pass
            print(f"   📝 Gold GSX_*.txt ✓  |  BTC BSX_ (shared only) ✓")

            # حفظ محلي — يضمن بقاء الإعدادات بعد Railway redeploy
            save_local_settings(settings)

            print(f"{'='*55}\n")
            return

        except PermissionError:
            print("⚠️  خطأ صلاحيات عام — سيُعاد في الدورة القادمة")
            return
        except requests.exceptions.Timeout:
            print(f"⏳ مزامنة timeout (محاولة {attempt+1}/2)")
            if attempt < 1:
                time.sleep(3)
        except Exception as e:
            print(f"⚠️ مزامنة: {type(e).__name__}")
            return


_last_grx_settings_hash = None

def sync_grx_settings():
    """يسحب إعدادات GRX من الـ backend ويكتبها لـ GRX_Settings.json في MT5 Common."""
    global _last_grx_settings_hash
    try:
        r = _session.get(f"{BACKEND_URL}/api/settings/grx", timeout=(5, 10))
        if r.status_code != 200:
            return
        settings = r.json()
        new_hash = str(sorted(settings.items()))
        if new_hash == _last_grx_settings_hash:
            return
        _last_grx_settings_hash = new_hash

        grx_file = os.path.join(_MT5_COMMON, "GRX_Settings.json")
        tmp = grx_file + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(settings, f, separators=(',', ': '))
        os.replace(tmp, grx_file)

        t = datetime.now().strftime('%H:%M:%S')
        print(f"\n{'='*55}")
        print(f"📊 [{t}] إعدادات GRX جديدة:")
        print(f"   BaseLot={settings.get('BaseLot')}  BasketCount={settings.get('BasketCount')}  BasketTP=${settings.get('BasketTP')}")
        print(f"   MaxDD=${settings.get('MaxDrawdown')}  LotBoost={settings.get('LotBoost')}x")
        print(f"   📝 GRX_Settings.json ✓")
        print(f"{'='*55}\n")
    except Exception as e:
        print(f"⚠️ grx sync: {type(e).__name__}")


_last_hedge_settings_hash = None

def sync_hedge_settings():
    """يسحب إعدادات Hedge من الـ backend ويكتبها لـ GSX_Hedge.json في MT5 Common."""
    global _last_hedge_settings_hash
    try:
        r = _session.get(f"{BACKEND_URL}/api/settings/hedge", timeout=(5, 10))
        if r.status_code != 200:
            return
        settings = r.json()
        new_hash = str(sorted(settings.items()))
        if new_hash == _last_hedge_settings_hash:
            return
        _last_hedge_settings_hash = new_hash

        # اكتب الإعدادات كـ JSON في سطر واحد — ReadSetting() في MQL5 تقرأ سطر واحد فقط
        hedge_file = os.path.join(_MT5_COMMON, "GSX_Hedge.json")
        tmp = hedge_file + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(settings, f, separators=(',', ': '))
        os.replace(tmp, hedge_file)

        t = datetime.now().strftime('%H:%M:%S')
        print(f"\n{'='*55}")
        print(f"⚔  [{t}] إعدادات Hedge جديدة:")
        print(f"   BaseLot={settings.get('BaseLot')}  Mult={settings.get('LotMultiplier')}  HedgeDist=${settings.get('HedgeDistUSD')}")
        print(f"   BasketTP=${settings.get('BasketTP')}  MaxDD=${settings.get('MaxDrawdown')}  MaxLvl={settings.get('MaxLevels')}")
        print(f"   📝 GSX_Hedge.json ✓")
        print(f"{'='*55}\n")
    except Exception as e:
        print(f"⚠️ hedge sync: {type(e).__name__}")


def bootstrap_snapshots():
    """
    عند startup: يبني snapshots من MT5 history مباشرة ويرفعها للبكند.
    يشتغل مرة واحدة — يضمن وجود بيانات حتى لو local_snapshots.json فارغ.
    """
    # أولاً: رفع المحفوظات المحلية لو موجودة
    upload_local_snapshots()

    # ثانياً: تحقق كم عندنا في البكند
    try:
        rc = _session.get(f"{BACKEND_URL}/api/snapshots/count", timeout=(5, 8))
        if rc.status_code == 200 and rc.json().get("count", 0) >= 10:
            print(f"✅ البكند عنده {rc.json()['count']} snapshots — لا حاجة لـ bootstrap")
            return
    except Exception:
        pass

    print("🔄 bootstrap: يبني snapshots من MT5 history ...")
    history = get_recent_history(days=60)
    if not history:
        print("⚠️ bootstrap: لا يوجد history في MT5")
        return

    gold_sym    = detect_gold_symbol()
    c_list      = get_candles(gold_sym, mt5.TIMEFRAME_M1, 40)
    sess        = get_trading_sessions()
    sent        = 0

    for t in history[:50]:
        tk = t.get('ticket')
        if not tk:
            continue
        fake_pos = {
            'symbol':     t.get('symbol', gold_sym),
            'type':       t.get('type', 'BUY'),
            'price_open': t.get('price', 0),
        }
        snap = _build_snapshot(tk, fake_pos, c_list, sess)
        save_local_snapshot(snap)
        try:
            r = _session.post(f"{BACKEND_URL}/api/trade_snapshot", json=snap, timeout=(5, 8))
            if r.status_code == 200:
                sent += 1
        except Exception:
            pass

    print(f"✅ bootstrap: أرسل {sent}/{min(len(history),50)} snapshots")


def _build_snapshot(ticket, position, candles_list, sessions):
    """يبني snapshot dict بدون إرسال"""
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
    return {
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


def main():
    print("=" * 50)
    print("🚀 MT5 Dashboard Agent")
    print("=" * 50)

    if not connect_mt5():
        return

    # حذف ملفات BSX_ المتلوثة (TP/SL/Lot مختلفة لكل بوت — لا تُشارَك)
    _btc_exclusive = ["LotSize","TP_USD","SL_USD","MaxSpread","MaxPositions",
                      "CooldownSecs","MaxLossPerDay","MaxProfitPerDay"]
    for k in _btc_exclusive:
        fpath = os.path.join(_MT5_COMMON, f"BSX_{k}.txt")
        try:
            if os.path.exists(fpath):
                os.remove(fpath)
                print(f"🧹 حذف {os.path.basename(fpath)} (متلوث بقيم الذهب)")
        except Exception:
            pass

    # ارفع الإعدادات المحلية للـ backend فوراً عند الإقلاع (Railway redeploy recovery)
    # — وتتكرر لاحقاً كل SETTINGS_CHECK_INTERVAL داخل الحلقة الرئيسية
    push_local_settings()
    push_grx_settings()
    # لا نرفع hedge settings من الملف المحلي — الـ backend هو مصدر الحقيقة

    # بناء snapshots من MT5 history مباشرة ثم رفعها
    threading.Thread(target=bootstrap_snapshots, daemon=True).start()

    print(f"📡 يرسل بيانات كل {UPDATE_INTERVAL}s | يسحب إعدادات كل {SETTINGS_CHECK_INTERVAL}s")
    print(f"   Backend: {BACKEND_URL}")
    print("اضغط Ctrl+C للإيقاف\n")

    last_history_sync  = 0
    last_settings_sync = 0
    last_candles_sync  = 0
    last_news_sync     = 0
    news_status        = {"blocked": False, "title": ""}

    try:
        while True:
            now = time.time()

            if now - last_settings_sync >= SETTINGS_CHECK_INTERVAL:
                # يعيد رفع الإعدادات المحلية الحقيقية قبل السحب — لو Railway
                # عمل redeploy ومسح القاعدة بينما الإيجنت شغّال (بدون إعادة تشغيل)،
                # هذا يمنع تطبيق القيم الافتراضية المُصفّرة على البوت الحي.
                # لا تأثير له إذا كانت الداشبورد هي مصدر الحقيقة أصلاً (seed no-op).
                push_local_settings()
                push_grx_settings()
                sync_settings()          # الذهب دائماً — لا يُربط بكشف النشاط
                _, btc_active = detect_active_bots()
                if btc_active:
                    sync_btc_settings()
                sync_hedge_settings()    # Hedge settings — دائماً
                sync_grx_settings()      # GRX settings — دائماً
                last_settings_sync = now

            tail_ea_logs()  # إرسال لوق EA الجديدة للداشبورد

            # فلتر الأخبار كل دقيقة
            if now - last_news_sync >= 60:
                news_status = check_news_filter()
                last_news_sync = now

            # شمعات كل 10 ثواني (endpoint منفصل)
            if now - last_candles_sync >= CANDLES_INTERVAL:
                send_candles()
                last_candles_sync = now

            account    = get_account_info()
            positions  = get_open_positions()
            gold_sym   = detect_gold_symbol()
            h1_bias    = get_h1_bias(gold_sym)
            # RSI من آخر شمعة M1
            m1_rates   = mt5.copy_rates_from_pos(gold_sym, mt5.TIMEFRAME_M1, 0, 20)
            last_rsi   = None
            if m1_rates is not None and len(m1_rates) >= 16:
                closes_m1 = [float(r["close"]) for r in m1_rates]
                last_rsi  = _calc_rsi(closes_m1)

            # كشف الصفقات الجديدة وإرسال snapshot فوري
            for pos in positions:
                if pos['ticket'] not in _known_positions and pos['ticket'] not in _snapped_tickets:
                    sym      = pos.get('symbol', detect_gold_symbol())
                    c_list   = get_candles(sym, mt5.TIMEFRAME_M1, 40)
                    sessions = get_trading_sessions()
                    send_trade_snapshot(pos['ticket'], pos, c_list, sessions)
                    _snapped_tickets.add(pos['ticket'])
            _known_positions.clear()
            _known_positions.update({p['ticket']: p for p in positions})

            history = []
            if now - last_history_sync > 10:
                history = get_recent_history(days=30)
                last_history_sync = now
                # حفظ الـ history محلياً
                save_local_history(history)
                # snapshot للصفقات المغلقة الجديدة فقط
                gold_sym = detect_gold_symbol()
                c_list_snap = get_candles(gold_sym, mt5.TIMEFRAME_M1, 40)
                sess_snap   = get_trading_sessions()
                for t in history[:20]:
                    tk = t.get('ticket')
                    if tk and tk not in _snapped_history:
                        fake_pos = {
                            'symbol':     t.get('symbol', gold_sym),
                            'type':       t.get('type', 'BUY'),
                            'price_open': t.get('price', 0),
                        }
                        send_trade_snapshot(tk, fake_pos, c_list_snap, sess_snap)
                        _snapped_history.add(tk)

            pending = get_pending_orders()

            send_update({
                "account":        account,
                "positions":      positions,
                "pending_orders": pending,
                "news_filter":    news_status,
                "h1_bias_up":     h1_bias,
                "last_rsi":       last_rsi,
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
