"""
MT5 Dashboard Backend — WebSocket edition
يستقبل البيانات من الـ Agent (Windows) ويبثها فوراً للـ Dashboard عبر Socket.IO
"""

from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from flask_socketio import SocketIO, emit
import os
import json
import sqlite3
from datetime import datetime
from threading import Lock
import urllib.request
import promotion_gate

# علم تفعيل التعديل الذاتي الحي من الخسائر المتتالية (auto_adjust_settings).
# افتراضياً OFF: التعديل من 10 صفقات خاسرة بدون تحقّق out-of-sample يطارد الضوضاء
# ويخسر فلوس. التعديلات الآمنة تمرّ عبر promotion_gate فقط. فعّله بوعي عبر:
#   LIVE_AUTOTUNE_ENABLED=1
LIVE_AUTOTUNE_ENABLED = os.environ.get("LIVE_AUTOTUNE_ENABLED", "0") == "1"

app = Flask(__name__, static_folder="static", static_url_path="")
CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="eventlet",
    ping_interval=20,
    ping_timeout=60,
)

# ============== Live Log ==============
_log_buffer   = []          # آخر 200 رسالة
_log_lock     = Lock()
_log_seen     = set()       # dedup: منع تكرار نفس الرسالة خلال 30 ثانية
_log_seen_ts  = {}          # msg -> timestamp

def push_log(level, msg):
    """يبث رسالة للداشبورد — مع dedup لمنع التكرار"""
    import time as _time
    now_ts = _time.time()
    # أنظف القديم كل مرة
    expired = [k for k, t in _log_seen_ts.items() if now_ts - t > 30]
    for k in expired:
        _log_seen.discard(k)
        del _log_seen_ts[k]
    # تجاهل لو نفس الرسالة ظهرت خلال 30 ثانية
    key = f"{level}:{msg}"
    if key in _log_seen:
        return
    _log_seen.add(key)
    _log_seen_ts[key] = now_ts

    entry = {"t": datetime.now().strftime("%H:%M:%S"), "l": level, "m": msg}
    with _log_lock:
        _log_buffer.append(entry)
        if len(_log_buffer) > 200:
            _log_buffer.pop(0)
    try:
        socketio.emit("log", entry)
    except Exception:
        pass

# ============== الإعدادات ==============
API_KEY           = os.environ.get("API_KEY", "mysecretkey123")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
_db_env = os.environ.get("DB_FILE", "mt5_data.db")
_db_dir = os.path.dirname(_db_env)
if _db_dir and not os.path.isdir(_db_dir):
    os.makedirs(_db_dir, exist_ok=True)
DB_FILE = _db_env
# ملف JSON للإعدادات — يُقرأ عند startup إذا كان DB جديداً
SETTINGS_BACKUP = os.path.join(_db_dir if _db_dir else ".", "ea_settings_backup.json")
# ========================================

data_lock = Lock()

latest_data = {
    "account": None,
    "positions": [],
    "pending_orders": [],
    "news_filter": {"blocked": False, "title": ""},
    "h1_bias_up": None,
    "last_rsi": None,
    "last_update": None,
    "candles": [],
    "sessions": {},
    "claude_advice": None,
    "claude_time": None,
    "pattern_advice": None,
    "pattern_time": None,
}
_last_pattern_count = 0
_logged_trade_tickets = set()   # tickets already pushed to live log

DEFAULT_SETTINGS = {
    "LotSize":        0.5,
    "TP_USD":         4.0,
    "SL_USD":         2.0,
    "TP_Points":      100,
    "SL_Points":      200,
    "MaxSpread":      350,
    "MaxPositions":   5,
    "CooldownSecs":   0,
    "TrailUSD":       0.0,
    "BotRunning":     1,
    "Direction":      0,
    "MaxLossPerDay":  50.0,
    "MaxProfitPerDay":200.0,
    "TradeHoursStart":0,
    "TradeHoursEnd":  24,
    "ClaudeEnabled":  1,
    "OrderType":      0,
    "RiskMode":       0,
    "RiskPercent":    1.0,
    "RSIBuyMax":      65.0,
    "RSISellMin":     35.0,
    "UseH1Filter":    1,
    "UseM15Filter":   1,
    "UseRSIFilter":   1,
    "StrategyMode":   0,
    "GridLevels":     3,
    "GridStep":       50,
    "ClaudeGrid":     0,
    "HedgeLotMult":   0.5,
    "ScaleStep":      30,
    "ScaleMult":      1.5,
    "MaxScales":      3,
    "UseATRFilter":   0,
    "MaxATRPoints":   80,
    "BlockRollover":  0,
    "MaxConsecLosses":0,
    "AutoTPSL":       0,
    "SplitLot":       0,
    "MarginUsePct":   0.0,
    "AutoSLATR":      1.0,
    "AutoTPRR":       2.5,
    "MaxHoldMin":     0,
    "LockProfitUSD":  0.0,
    "StallSecs":      60,
    "SyncTPSL":       0,
    "ExitOnReverse":  0,
    "ExitRevProfit":  0,
    "QuickTPUSD":     0.0,
    "TrailStartUSD":  0.0,
    "TrailGiveUSD":   0.5,
    "TrendReverse":   0,
    "ReverseAfterLosses": 3,
    "EarlyEntry":     0,
    "EarlyMomATR":    0.3,
    "PartialTP_R":    0.0,
    "PartialTP_Frac": 0.5,
}

# أول نتيجة مرجعية من اختبار XAUUSDm M5 على 100,000 شمعة. تُعرض حتى يرفع
# OpenClaw/Windows نتيجة أحدث عبر /api/backtest/result.
DEFAULT_BACKTEST_RESULT = {
    "strategy": "fastest_gold",
    "symbol": "XAUUSDm",
    "timeframe": "M5",
    "status": "unsafe",
    "generated_at": "2026-07-23T00:27:00+04:00",
    "data": {"bars": 100000, "start": "2025-02-20", "end": "2026-07-22"},
    "baseline": {
        "trades": 221, "net_usd": 10.14, "return_pct": 0.10,
        "win_rate": 46.15, "profit_factor": 1.00,
        "max_drawdown_pct": -104.54, "sharpe": -0.28,
    },
    "candidate": {
        "params": {"rsi_buy_max": 55, "rsi_sell_min": 30, "atr_mult": 1.0, "use_mtf": True},
        "trades": 173, "net_usd": -4481.76, "return_pct": -44.82,
        "win_rate": 43.93, "profit_factor": 0.84,
        "max_drawdown_pct": -78.86, "sharpe": -0.29,
    },
    "decision": "rejected",
    "reason": "Candidate failed out-of-sample validation; automatic promotion is blocked.",
}

# البتكوين: نفس كل مفاتيح الذهب + تعديلات خاصة بالبتكوين (ستوب أوسع 2.0xATR)
BTC_DEFAULT_SETTINGS = {
    **DEFAULT_SETTINGS,
    "LotSize":        0.01,
    "TP_USD":         20.0,
    "SL_USD":         10.0,
    "MaxSpread":      6000,
    "MaxPositions":   3,
    "CooldownSecs":   0,
    "MaxLossPerDay":  100.0,
    "MaxProfitPerDay":500.0,
    "AutoSLATR":      2.0,     # البتكوين يحتاج ستوب أوسع (مؤكّد بالباك-تيست)
    "AutoTPRR":       2.5,
    "RSIBuyMax":      75.0,
    "RSISellMin":     25.0,
    "TradeHoursStart":13,
    "TradeHoursEnd":  18,
    "MaxConsecLosses":3,
}

HEDGE_DEFAULT_SETTINGS = {
    "BaseLot":       0.01,
    "LotMultiplier": 1.5,
    "HedgeDistUSD":  3.0,
    "BasketTP":      2.0,
    "MaxDrawdown":   50.0,
    "MaxLevels":     4,
    "MaxSpread":     350,
    "BotRunning":    1,
    "TrailPct":      30.0,
    "PartialPct":    50.0,
}

# مطابقة تماماً لمفاتيح إكسبرت GRX (gold_range_scalper.mq5) — لا تغيّر الأسماء
GRX_DEFAULT_SETTINGS = {
    "BaseLot":      0.11,
    "TradeTP":      3.0,
    "TradeSL":      5.0,
    "MaxSpread":    350,
    "CooldownBars": 1,
    "MaxTrades":    20,
    "BotRunning":   1,
}


# ---------- SQLite ----------
def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS trade_history (
                ticket      INTEGER PRIMARY KEY,
                symbol      TEXT,
                type        TEXT,
                volume      REAL,
                price       REAL,
                price_open  REAL,
                price_close REAL,
                profit      REAL,
                swap        REAL,
                commission  REAL,
                time        TEXT,
                comment     TEXT
            )
        """)
        # migration: أضف الأعمدة الجديدة لو DB قديمة
        # settings_version: نسخة الإعدادات التي جرت تحتها الصفقة (سجل التعلم)
        # mfe/mae: أقصى ربح/خسارة عائمة بالدولار خلال عمر الصفقة (من الـ agent)
        for col in ("price_open REAL", "price_close REAL",
                    "settings_version INTEGER", "mfe REAL", "mae REAL"):
            try:
                conn.execute(f"ALTER TABLE trade_history ADD COLUMN {col}")
            except Exception:
                pass
        # سجل نسخ الإعدادات — كل تغيير فعلي للإعدادات يُسجَّل كنسخة مرقّمة،
        # والصفقات تُربط بالنسخة النشطة وقتها، فيمكن قياس أثر كل تعديل والتراجع عنه
        conn.execute("""
            CREATE TABLE IF NOT EXISTS settings_versions (
                version    INTEGER PRIMARY KEY AUTOINCREMENT,
                params     TEXT NOT NULL,
                source     TEXT NOT NULL,
                reason     TEXT,
                applied_at TEXT NOT NULL,
                evaluated  INTEGER DEFAULT 0,
                reverted   INTEGER DEFAULT 0,
                outcome    TEXT
            )
        """)
        # لا نحذف التاريخ — يتراكم عبر الأيام؛ يُستعاد محلياً من الويندوز بعد أي Railway redeploy
        conn.commit()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS account_snapshot (
                id          INTEGER PRIMARY KEY CHECK (id = 1),
                data        TEXT,
                last_update TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ea_settings (
                key   TEXT PRIMARY KEY,
                value TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS trade_snapshots (
                ticket      INTEGER PRIMARY KEY,
                symbol      TEXT,
                direction   TEXT,
                entry_price REAL,
                data        TEXT,
                time        TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS backtest_results (
                id         INTEGER PRIMARY KEY CHECK (id = 1),
                data       TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        # سجل تدقيق دائم لكل قرار ترقية: مقبول أو مرفوض، مع الأسباب والباراميترات.
        # لا يُمسح مع redeploy لو DB_FILE على volume — عشان نراجع تاريخ التعلّم.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS promotions (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                approved   INTEGER NOT NULL,
                strategy   TEXT,
                symbol     TEXT,
                reasons    TEXT,
                applied    TEXT,
                checks     TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS btc_settings (
                key   TEXT PRIMARY KEY,
                value TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS hedge_settings (
                key   TEXT PRIMARY KEY,
                value TEXT
            )
        """)
        # استعادة إعدادات BTC من الـ backup
        _btc_backup = os.path.join(_db_dir if _db_dir else ".", "btc_settings_backup.json")
        saved_btc = {}
        if os.path.exists(_btc_backup):
            try:
                with open(_btc_backup, "r") as f:
                    saved_btc = json.load(f)
            except Exception:
                saved_btc = {}
        for k, v in saved_btc.items():
            if k in BTC_DEFAULT_SETTINGS:
                conn.execute(
                    "INSERT OR REPLACE INTO btc_settings (key, value) VALUES (?, ?)",
                    (k, str(v))
                )
        if saved_btc.get("_btc_user_saved"):
            conn.execute(
                "INSERT OR REPLACE INTO btc_settings (key, value) VALUES ('btc_user_saved', '1')"
            )
        for k, v in BTC_DEFAULT_SETTINGS.items():
            conn.execute(
                "INSERT OR IGNORE INTO btc_settings (key, value) VALUES (?, ?)",
                (k, str(v))
            )
        for k, v in HEDGE_DEFAULT_SETTINGS.items():
            conn.execute(
                "INSERT OR IGNORE INTO hedge_settings (key, value) VALUES (?, ?)",
                (k, str(v))
            )
        conn.execute("""
            CREATE TABLE IF NOT EXISTS grx_settings (
                key   TEXT PRIMARY KEY,
                value TEXT
            )
        """)
        for k, v in GRX_DEFAULT_SETTINGS.items():
            conn.execute(
                "INSERT OR IGNORE INTO grx_settings (key, value) VALUES (?, ?)",
                (k, str(v))
            )
        # استعادة إعدادات GRX من backup (مثل BTC تماماً)
        _grx_backup = os.path.join(_db_dir if _db_dir else ".", "grx_settings_backup.json")
        saved_grx = {}
        if os.path.exists(_grx_backup):
            try:
                with open(_grx_backup, "r") as f:
                    saved_grx = json.load(f)
            except Exception:
                saved_grx = {}
        for k, v in saved_grx.items():
            if k in GRX_DEFAULT_SETTINGS:
                conn.execute(
                    "INSERT OR REPLACE INTO grx_settings (key, value) VALUES (?, ?)",
                    (k, str(v))
                )
        if saved_grx.get("_grx_user_saved"):
            conn.execute(
                "INSERT OR REPLACE INTO grx_settings (key, value) VALUES ('grx_user_saved', '1')"
            )
        # استعادة الإعدادات من الـ backup أولاً (يتجاوز الافتراضية)
        saved = {}
        if os.path.exists(SETTINGS_BACKUP):
            try:
                with open(SETTINGS_BACKUP, "r") as f:
                    saved = json.load(f)
            except Exception:
                saved = {}
        # استعادة إعدادات المستخدم من الـ backup
        for k, v in saved.items():
            if k in DEFAULT_SETTINGS:
                conn.execute(
                    "INSERT OR REPLACE INTO ea_settings (key, value) VALUES (?, ?)",
                    (k, str(v))
                )
        # استعادة علامة _user_saved من الـ backup
        if saved.get("_user_saved"):
            conn.execute(
                "INSERT OR REPLACE INTO ea_settings (key, value) VALUES ('_user_saved', '1')"
            )
        # الافتراضية فقط للمفاتيح الناقصة
        for k, v in DEFAULT_SETTINGS.items():
            conn.execute(
                "INSERT OR IGNORE INTO ea_settings (key, value) VALUES (?, ?)",
                (k, str(v))
            )
        conn.commit()


init_db()


def load_latest_account():
    global latest_data
    with get_db() as conn:
        row = conn.execute(
            "SELECT data, last_update FROM account_snapshot WHERE id=1"
        ).fetchone()
        if row:
            latest_data["account"]     = json.loads(row["data"]) if row["data"] else None
            latest_data["last_update"] = row["last_update"]


load_latest_account()


def check_api_key():
    return request.headers.get("X-API-Key") == API_KEY


def save_account(account, last_update):
    with get_db() as conn:
        conn.execute("""
            INSERT INTO account_snapshot (id, data, last_update) VALUES (1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET data=excluded.data, last_update=excluded.last_update
        """, (json.dumps(account), last_update))
        conn.commit()


def _version_for_time(versions, trade_time):
    """آخر نسخة إعدادات كانت نشطة وقت الصفقة — حتى لا تُنسب صفقات قديمة
    (مستعادة بعد redeploy) للنسخة الحالية خطأً. تقريبي لو اختلفت المناطق الزمنية."""
    if not versions or not trade_time:
        return None
    ver = None
    for v, applied_at in versions:  # مرتبة تصاعدياً
        if applied_at <= trade_time:
            ver = v
        else:
            break
    return ver


def upsert_history(trades):
    if not trades:
        return
    with get_db() as conn:
        versions = [
            (r["version"], r["applied_at"])
            for r in conn.execute(
                "SELECT version, applied_at FROM settings_versions ORDER BY version ASC"
            ).fetchall()
        ]
        rows = [{
            'ticket':      t.get('ticket'),
            'symbol':      t.get('symbol'),
            'type':        t.get('type'),
            'volume':      t.get('volume'),
            'price':       t.get('price_close') or t.get('price'),
            'price_open':  t.get('price_open'),
            'price_close': t.get('price_close') or t.get('price'),
            'profit':      t.get('profit'),
            'swap':        t.get('swap'),
            'commission':  t.get('commission'),
            'time':        t.get('time'),
            'comment':     t.get('comment'),
            'settings_version': _version_for_time(versions, t.get('time')),
        } for t in trades]
        # ON CONFLICT بدل REPLACE — حتى لا تُدهس settings_version/mfe/mae
        # المسجّلة سابقاً مع كل full-sync من الـ agent
        conn.executemany("""
            INSERT INTO trade_history
                (ticket, symbol, type, volume, price, price_open, price_close,
                 profit, swap, commission, time, comment, settings_version)
            VALUES
                (:ticket, :symbol, :type, :volume, :price, :price_open, :price_close,
                 :profit, :swap, :commission, :time, :comment, :settings_version)
            ON CONFLICT(ticket) DO UPDATE SET
                symbol=excluded.symbol, type=excluded.type, volume=excluded.volume,
                price=excluded.price, price_open=excluded.price_open,
                price_close=excluded.price_close, profit=excluded.profit,
                swap=excluded.swap, commission=excluded.commission,
                time=excluded.time, comment=excluded.comment,
                settings_version=COALESCE(trade_history.settings_version, excluded.settings_version)
        """, rows)
        conn.commit()


def save_snapshot(snap):
    ticket = snap.get("ticket")
    if not ticket:
        return
    with get_db() as conn:
        conn.execute("""
            INSERT OR IGNORE INTO trade_snapshots
                (ticket, symbol, direction, entry_price, data, time)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            ticket,
            snap.get("symbol"),
            snap.get("direction"),
            snap.get("entry_price"),
            json.dumps(snap),
            snap.get("time", datetime.now().isoformat()),
        ))
        conn.commit()


def get_snapshot(ticket):
    with get_db() as conn:
        row = conn.execute(
            "SELECT data FROM trade_snapshots WHERE ticket=?", (ticket,)
        ).fetchone()
        if row:
            try:
                return json.loads(row["data"])
            except Exception:
                return None
    return None


def get_snapshots(limit=50):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT data FROM trade_snapshots ORDER BY time DESC LIMIT ?", (limit,)
        ).fetchall()
        result = []
        for r in rows:
            try:
                result.append(json.loads(r["data"]))
            except Exception:
                pass
        return result


def get_history(limit=500):
    # التاريخ الكامل (يتراكم عبر الأيام) — مرتّب من الأحدث
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM trade_history ORDER BY time DESC LIMIT ?",
            (limit,)
        ).fetchall()
        return [dict(r) for r in rows]


def get_settings():
    with get_db() as conn:
        rows = conn.execute("SELECT key, value FROM ea_settings").fetchall()
        result = dict(DEFAULT_SETTINGS)
        for row in rows:
            k, v = row["key"], row["value"]
            if k in DEFAULT_SETTINGS:
                try:
                    result[k] = type(DEFAULT_SETTINGS[k])(v)
                except Exception:
                    result[k] = v
        return result


def save_settings(new_settings, mark_user_saved=True, source="user", reason=""):
    with get_db() as conn:
        for k, v in new_settings.items():
            if k in DEFAULT_SETTINGS:
                conn.execute(
                    "INSERT INTO ea_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (k, str(v))
                )
        if mark_user_saved:
            # علامة أن المستخدم حفظ إعدادات في عمر هذا الـ container —
            # تمنع الـ agent seed من دهسها. تُمسح تلقائياً مع كل redeploy (وهذا مقصود)
            conn.execute(
                "INSERT OR REPLACE INTO ea_settings (key, value) VALUES ('_user_saved', '1')"
            )
        conn.commit()
    _write_settings_backup()
    _record_settings_version(source, reason)


# مفاتيح لا تدخل سجل نسخ التعلم: تشغيل/إيقاف البوت ليس تغيير استراتيجية،
# ولا يجوز أن يشتّت عينات التقييم أو أن يعيده التراجع التلقائي
_VERSION_IGNORED_KEYS = {"BotRunning"}


def _record_settings_version(source, reason=""):
    """يسجّل نسخة جديدة في سجل التعلم — فقط إذا تغيّرت القيم فعلياً"""
    try:
        cur = {k: v for k, v in get_settings().items() if k not in _VERSION_IGNORED_KEYS}
        cur_json = json.dumps(cur, sort_keys=True)
        with get_db() as conn:
            row = conn.execute(
                "SELECT params FROM settings_versions ORDER BY version DESC LIMIT 1"
            ).fetchone()
            if row and row["params"] == cur_json:
                return
            conn.execute(
                "INSERT INTO settings_versions (params, source, reason, applied_at) VALUES (?, ?, ?, ?)",
                (cur_json, source, (reason or "")[:300], datetime.now().isoformat())
            )
            conn.commit()
    except Exception:
        pass


def get_active_settings_version():
    with get_db() as conn:
        row = conn.execute(
            "SELECT version FROM settings_versions ORDER BY version DESC LIMIT 1"
        ).fetchone()
        return row["version"] if row else None


def is_user_saved():
    with get_db() as conn:
        row = conn.execute(
            "SELECT value FROM ea_settings WHERE key='_user_saved'"
        ).fetchone()
        return row is not None


def _write_settings_backup():
    try:
        current = get_settings()
        # احفظ علامة _user_saved حتى تبقى بعد كل redeploy
        current["_user_saved"] = 1 if is_user_saved() else 0
        tmp = SETTINGS_BACKUP + ".tmp"
        with open(tmp, "w") as f:
            json.dump(current, f, indent=2)
        os.replace(tmp, SETTINGS_BACKUP)
    except Exception:
        pass


def get_btc_settings():
    with get_db() as conn:
        rows = conn.execute("SELECT key, value FROM btc_settings").fetchall()
        result = dict(BTC_DEFAULT_SETTINGS)
        for row in rows:
            k, v = row["key"], row["value"]
            if k in BTC_DEFAULT_SETTINGS:
                try:
                    result[k] = type(BTC_DEFAULT_SETTINGS[k])(v)
                except Exception:
                    result[k] = v
        return result


def save_btc_settings(new_settings, mark_user_saved=True):
    with get_db() as conn:
        for k, v in new_settings.items():
            if k in BTC_DEFAULT_SETTINGS:
                conn.execute(
                    "INSERT INTO btc_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (k, str(v))
                )
        if mark_user_saved:
            conn.execute(
                "INSERT OR REPLACE INTO btc_settings (key, value) VALUES ('btc_user_saved', '1')"
            )
        conn.commit()
    _write_btc_settings_backup()


def get_hedge_settings():
    result = dict(HEDGE_DEFAULT_SETTINGS)
    with get_db() as conn:
        rows = conn.execute("SELECT key, value FROM hedge_settings").fetchall()
        for row in rows:
            k, v = row["key"], row["value"]
            if k in HEDGE_DEFAULT_SETTINGS:
                try:
                    result[k] = type(HEDGE_DEFAULT_SETTINGS[k])(v)
                except Exception:
                    result[k] = v
    return result


def save_hedge_settings(new_settings):
    with get_db() as conn:
        for k, v in new_settings.items():
            if k in HEDGE_DEFAULT_SETTINGS:
                conn.execute(
                    "INSERT INTO hedge_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (k, str(v))
                )
        conn.commit()


def is_btc_user_saved():
    with get_db() as conn:
        row = conn.execute(
            "SELECT value FROM btc_settings WHERE key='btc_user_saved'"
        ).fetchone()
        return row is not None


def _write_btc_settings_backup():
    _btc_backup = os.path.join(_db_dir if _db_dir else ".", "btc_settings_backup.json")
    try:
        current = get_btc_settings()
        current["_btc_user_saved"] = 1 if is_btc_user_saved() else 0
        tmp = _btc_backup + ".tmp"
        with open(tmp, "w") as f:
            json.dump(current, f, indent=2)
        os.replace(tmp, _btc_backup)
    except Exception:
        pass


def build_dashboard_payload():
    """بناء payload الداشبورد الكامل — يُستخدم للـ REST والـ WebSocket"""
    with data_lock:
        is_online = False
        if latest_data["last_update"]:
            last = datetime.fromisoformat(latest_data["last_update"])
            is_online = (datetime.now() - last).total_seconds() < 30

        closed_trades = get_history(1000)
        wins   = [t for t in closed_trades if t["profit"] > 0]
        losses = [t for t in closed_trades if t["profit"] <= 0]
        win_rate     = (len(wins) / len(closed_trades) * 100) if closed_trades else 0
        total_profit = sum(
            t["profit"] + t.get("swap", 0) + t.get("commission", 0)
            for t in closed_trades
        )
        s = get_settings()

        return {
            "account":        latest_data["account"],
            "positions":      latest_data["positions"],
            "pending_orders": latest_data["pending_orders"],
            "news_filter":    latest_data["news_filter"],
            "h1_bias_up":     latest_data["h1_bias_up"],
            "last_rsi":       latest_data["last_rsi"],
            "block_reason":   latest_data.get("block_reason"),
            "history":        closed_trades[:200],
            "is_online":    is_online,
            "last_update":  latest_data["last_update"],
            "stats": {
                "total_trades": len(closed_trades),
                "wins":         len(wins),
                "losses":       len(losses),
                "win_rate":     round(win_rate, 1),
                "total_profit": round(total_profit, 2),
            },
            "settings":     s,
            "btc_settings": get_btc_settings(),
            "bot_running":  int(s.get("BotRunning", 1)) == 1,
            "candles":      latest_data["candles"],
            "sessions":     latest_data["sessions"],
            "claude_advice":  latest_data["claude_advice"],
            "claude_time":    latest_data["claude_time"],
            "pattern_advice": latest_data["pattern_advice"],
            "pattern_time":   latest_data["pattern_time"],
        }


# ---------- Claude AI ----------
def call_claude(consecutive_losses, recent_trades, account):
    if not ANTHROPIC_API_KEY:
        return "Claude API key not configured"
    try:
        trades_summary = ", ".join([
            f"{'WIN' if t['profit']>0 else 'LOSS'} ${t['profit']:.2f}"
            for t in recent_trades[:10]
        ])
        prompt = (
            f"You are a gold trading advisor. The XAUUSD M1 scalping bot has just had "
            f"{consecutive_losses} consecutive losses.\n"
            f"Account balance: ${account.get('balance', 0):.2f}, "
            f"Equity: ${account.get('equity', 0):.2f}\n"
            f"Last 10 trades: {trades_summary}\n\n"
            f"Give ONE short actionable sentence (max 20 words) about what to do next. "
            f"Be direct. No fluff."
        )
        body = json.dumps({
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 80,
            "messages": [{"role": "user", "content": prompt}]
        }).encode()
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=body,
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
            return data["content"][0]["text"].strip()
    except Exception as e:
        return f"Claude error: {str(e)[:60]}"


# ============== نظام التعلم من الخسائر ==============
# المبدأ: الخسائر الأخيرة لا تعدّل الإعدادات الحية مباشرة أبداً.
# أي اقتراح تعديل يمر بثلاث بوابات: عينة كافية → تحقق replay على الصفقات
# التاريخية → تطبيق مُوثَّق كنسخة. وبعد عدد كافٍ من الصفقات تُقيَّم النسخة
# ويُتراجع عنها تلقائياً إذا كانت أسوأ من سابقتها.
REPLAY_MIN_SAMPLE    = 30    # أقل عدد صفقات بسنابشوت قبل قبول أي تعديل تلقائي
AUTO_ADJUST_COOLDOWN = 3600  # ثانية بين تعديل تلقائي وآخر
EVAL_MIN_TRADES      = 20    # صفقات مطلوبة تحت النسخة قبل تقييمها
_last_auto_adjust_ts = [0.0]


def _trades_with_context(limit=200):
    """التاريخ + snapshot لكل صفقة إن وُجد — أساس الـ replay والتقارير"""
    trades = [t for t in get_history(limit) if t.get("profit") is not None]
    snap_map = {s.get("ticket"): s for s in get_snapshots(limit)}
    for t in trades:
        t["snap"] = snap_map.get(t.get("ticket"))
    return trades


def replay_candidate(cand, trades):
    """
    يعيد تشغيل الصفقات التاريخية تحت الإعدادات المرشحة (تقريبياً):
    - فلتر RSI: صفقة كانت سترفض تحت الحد الجديد تُحسب صفراً
    - SL/TP بالدولار: عبر MFE/MAE — لو الخسارة العائمة وصلت SL الجديد
      فالنتيجة -SL، ولو الربح العائم وصل TP الجديد فالنتيجة +TP
    تقريب معلن: لو الهدفان تحققا معاً، نفترض أن نتيجة الصفقة الفعلية
    تدل على أيهما ضُرب أولاً.
    """
    sl = float(cand["SL_USD"])
    tp = float(cand["TP_USD"])
    rsi_buy_max  = float(cand["RSIBuyMax"])
    rsi_sell_min = float(cand["RSISellMin"])
    actual_pnl = sim_pnl = 0.0
    blocked = sample = 0
    for t in trades:
        profit = float(t.get("profit") or 0)
        actual_pnl += profit
        sample += 1
        snap = t.get("snap")
        if snap:
            rsi = float(snap.get("rsi", 50))
            d   = (t.get("type") or snap.get("direction") or "").upper()
            if (d == "BUY" and rsi > rsi_buy_max) or (d == "SELL" and rsi < rsi_sell_min):
                blocked += 1
                continue  # الصفقة كانت سترفض — لا تضيف شيئاً للمحاكاة
        mfe = t.get("mfe")
        mae = t.get("mae")
        hit_tp = mfe is not None and float(mfe) >= tp
        hit_sl = mae is not None and float(mae) <= -sl
        if hit_tp and hit_sl:
            sim_pnl += tp if profit > 0 else -sl
        elif hit_tp:
            sim_pnl += tp
        elif hit_sl:
            sim_pnl += -sl
        else:
            sim_pnl += profit  # ما وصل لأي هدف جديد — النتيجة الفعلية أقرب تقدير
    return {
        "sample":     sample,
        "blocked":    blocked,
        "actual_pnl": round(actual_pnl, 2),
        "sim_pnl":    round(sim_pnl, 2),
    }


def loss_attribution(limit=200):
    """
    يصنّف كل خسارة قبل أي علاج — لأن العلاج يختلف جذرياً حسب النوع:
    دخول خاطئ → فلاتر دخول | انعكاس بعد ربح → خروج/trailing |
    بدون MFE → نحتاج بيانات أكثر قبل الحكم
    """
    settings = get_settings()
    tp = float(settings.get("TP_USD", 4))
    trades = _trades_with_context(limit)
    losers = [t for t in trades if float(t.get("profit") or 0) < 0]
    classes = {"bad_entry": 0, "reversal_after_profit": 0, "mixed": 0, "no_mfe_data": 0}
    by_session = {}
    by_hour = {}
    detail = []
    for t in losers:
        mfe = t.get("mfe")
        if mfe is None:
            cls = "no_mfe_data"
        elif float(mfe) >= 0.6 * tp:
            cls = "reversal_after_profit"
        elif float(mfe) <= max(0.5, 0.15 * tp):
            cls = "bad_entry"
        else:
            cls = "mixed"
        classes[cls] += 1
        snap = t.get("snap") or {}
        sess = snap.get("session", "?")
        by_session[sess] = by_session.get(sess, 0) + 1
        tm = t.get("time") or ""
        hour = tm[11:13] if len(tm) >= 13 else "?"
        by_hour[hour] = by_hour.get(hour, 0) + 1
        detail.append({
            "ticket": t.get("ticket"), "profit": t.get("profit"),
            "mfe": mfe, "mae": t.get("mae"), "class": cls,
            "rsi": snap.get("rsi"), "session": sess,
            "settings_version": t.get("settings_version"),
        })
    return {
        "sample":       len(trades),
        "losses":       len(losers),
        "classes":      classes,
        "by_session":   by_session,
        "by_hour":      dict(sorted(by_hour.items())),
        "detail":       detail[:50],
    }


def evaluate_settings_versions():
    """
    التعلم الحقيقي: تقييم أثر كل تعديل تلقائي بعد EVAL_MIN_TRADES صفقة.
    متوسط ربح الصفقة تحت النسخة الجديدة يُقارن بمتوسط آخر 50 صفقة قبلها —
    لو أسوأ، يُتراجع تلقائياً للنسخة السابقة وتُوسم reverted.
    """
    revert_params = None
    try:
        with get_db() as conn:
            v = conn.execute(
                "SELECT * FROM settings_versions WHERE source='auto' AND evaluated=0 "
                "ORDER BY version DESC LIMIT 1"
            ).fetchone()
            if not v:
                return
            cur = conn.execute(
                "SELECT COUNT(*) c, COALESCE(AVG(profit),0) a, COALESCE(SUM(profit),0) s "
                "FROM trade_history WHERE settings_version=? AND profit IS NOT NULL",
                (v["version"],)
            ).fetchone()
            if cur["c"] < EVAL_MIN_TRADES:
                return
            prev = conn.execute(
                "SELECT COUNT(*) c, COALESCE(AVG(profit),0) a FROM ("
                "  SELECT profit FROM trade_history"
                "  WHERE settings_version < ? AND profit IS NOT NULL"
                "  ORDER BY time DESC LIMIT 50)",
                (v["version"],)
            ).fetchone()
            worse = prev["c"] >= EVAL_MIN_TRADES and cur["a"] < prev["a"]
            outcome = {
                "trades": cur["c"], "avg_pnl": round(cur["a"], 2),
                "net_pnl": round(cur["s"], 2),
                "prev_avg_pnl": round(prev["a"], 2), "prev_sample": prev["c"],
                "verdict": "worse-reverted" if worse else "kept",
            }
            conn.execute(
                "UPDATE settings_versions SET evaluated=1, reverted=?, outcome=? WHERE version=?",
                (1 if worse else 0, json.dumps(outcome), v["version"])
            )
            conn.commit()
            if worse:
                pv = conn.execute(
                    "SELECT params FROM settings_versions WHERE version < ? "
                    "ORDER BY version DESC LIMIT 1", (v["version"],)
                ).fetchone()
                if pv:
                    revert_params = json.loads(pv["params"])
        if revert_params:
            save_settings(
                {k: v2 for k, v2 in revert_params.items() if k in DEFAULT_SETTINGS},
                source="revert",
                reason=f"v{v['version']} أسوأ: avg ${outcome['avg_pnl']} مقابل ${outcome['prev_avg_pnl']}",
            )
            push_log("warn", f"↩️ LEARN: تعديل v{v['version']} فشل بالتقييم "
                             f"(avg ${outcome['avg_pnl']} < ${outcome['prev_avg_pnl']}) — رجعنا للإعدادات السابقة")
            socketio.emit("settings", get_settings())
        else:
            push_log("ok", f"📈 LEARN: تعديل v{v['version']} نجح بالتقييم "
                           f"(avg ${outcome['avg_pnl']} على {outcome['trades']} صفقة) — يثبت")
    except Exception as e:
        push_log("err", f"LEARN eval: {str(e)[:60]}")


def auto_adjust_settings(losing_snaps, account):
    """
    Claude يحلل snapshots الخسائر ويقترح تعديلات — لكن الاقتراح لا يُطبَّق
    إلا بعد اجتياز بوابات التحقق: cooldown + عينة كافية + replay يثبت تحسناً.
    """
    if not LIVE_AUTOTUNE_ENABLED:
        # المسار ده بيغيّر باراميترات حية من 10 صفقات خاسرة بدون تحقّق out-of-sample
        # = مطاردة ضوضاء في قاع الـ drawdown. معطّل افتراضياً. التعلّم الآمن يمرّ
        # عبر promotion_gate (نتيجة باك-تست موثّقة). فعّله بـ LIVE_AUTOTUNE_ENABLED=1.
        push_log("info", "🛡️ AUTO-ADJ معطّل (LIVE_AUTOTUNE_ENABLED=0) — التعلّم عبر بوابة الترقية فقط.")
        return
    if not ANTHROPIC_API_KEY:
        return
    if not losing_snaps:
        return
    import time as _time
    if _time.time() - _last_auto_adjust_ts[0] < AUTO_ADJUST_COOLDOWN:
        return  # تعديل واحد كحد أقصى بالساعة — يمنع التذبذب

    samples = []
    for s in losing_snaps[:10]:
        samples.append(
            f"RSI={s.get('rsi',50):.1f} EMA={'UP' if s.get('ema_up') else 'DN'} "
            f"ATR={s.get('atr',0):.2f} dir={s.get('direction','?')} "
            f"P&L=${s.get('profit',0):.2f}"
        )

    current = get_settings()
    prompt = (
        "You are a quant tuning an XAUUSD M1 scalping bot.\n"
        f"Account: balance=${account.get('balance',0):.2f} equity=${account.get('equity',0):.2f}\n"
        f"Current RSI filter: BUY only when RSI<={current.get('RSIBuyMax',65)}, "
        f"SELL only when RSI>={current.get('RSISellMin',35)}\n"
        f"Current SL=${current.get('SL_USD',2)}, TP=${current.get('TP_USD',4)}\n\n"
        f"These {len(samples)} losing trades just closed:\n"
        + "\n".join(samples) + "\n\n"
        "Respond with ONLY valid JSON, no commentary:\n"
        '{"RSIBuyMax": <40-70>, "RSISellMin": <30-60>, "SL_USD": <1-10>, "TP_USD": <1-20>, '
        '"reason": "<one sentence max 20 words>"}\n'
        "Tighten RSI range if losses happen at extreme RSI. Widen SL if stopped out early."
    )
    try:
        body = json.dumps({
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 120,
            "messages": [{"role": "user", "content": prompt}]
        }).encode()
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=body,
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            text = json.loads(resp.read())["content"][0]["text"].strip()
        # استخراج JSON من الرد
        start = text.find("{")
        end   = text.rfind("}") + 1
        if start == -1 or end == 0:
            push_log("err", "AUTO-ADJ: رد غير صالح من Claude")
            return
        adj = json.loads(text[start:end])
        # تحقق من نطاقات معقولة
        rsi_buy  = max(40.0, min(75.0, float(adj.get("RSIBuyMax",  current.get("RSIBuyMax",  65)))))
        rsi_sell = max(25.0, min(60.0, float(adj.get("RSISellMin", current.get("RSISellMin", 35)))))
        sl_usd   = max(1.0,  min(20.0, float(adj.get("SL_USD",     current.get("SL_USD",      2)))))
        tp_usd   = max(1.0,  min(40.0, float(adj.get("TP_USD",     current.get("TP_USD",      4)))))
        reason   = adj.get("reason", "")[:100]

        # ── بوابة التحقق: الاقتراح لا يُطبَّق إلا إذا أثبت الـ replay تحسناً ──
        cand = {"RSIBuyMax": rsi_buy, "RSISellMin": rsi_sell,
                "SL_USD": sl_usd, "TP_USD": tp_usd}
        trades = _trades_with_context(200)
        with_snap = [t for t in trades if t.get("snap")]
        if len(with_snap) < REPLAY_MIN_SAMPLE:
            push_log("warn", f"🧪 AUTO-ADJ: عينة غير كافية ({len(with_snap)}/{REPLAY_MIN_SAMPLE} "
                             f"صفقة بسنابشوت) — الاقتراح مرفوض: {reason}")
            return
        rep = replay_candidate(cand, trades)
        if rep["sim_pnl"] <= rep["actual_pnl"]:
            push_log("warn", f"🧪 AUTO-ADJ: الـ replay رفض الاقتراح — محاكاة ${rep['sim_pnl']} "
                             f"≤ فعلي ${rep['actual_pnl']} على {rep['sample']} صفقة | {reason}")
            return

        _last_auto_adjust_ts[0] = __import__("time").time()
        save_settings(cand, source="auto",
                      reason=f"{reason} | replay {rep['sample']} صفقة: "
                             f"${rep['actual_pnl']} → ${rep['sim_pnl']} (حظر {rep['blocked']})")
        msg = (f"🤖 AUTO-ADJ: RSI {current.get('RSIBuyMax',65):.0f}/{current.get('RSISellMin',35):.0f}"
               f" → {rsi_buy:.0f}/{rsi_sell:.0f}  SL ${sl_usd:.1f}  TP ${tp_usd:.1f}"
               f" | replay: ${rep['actual_pnl']}→${rep['sim_pnl']} | {reason}")
        push_log("ok", msg)
        socketio.emit("settings", get_settings())
    except Exception as e:
        push_log("err", f"AUTO-ADJ: فشل — {str(e)[:60]}")


def analyze_patterns():
    """
    تحليل كلود الشامل — يُستدعى كل 10 صفقات مغلقة.
    يبني صورة كاملة من snapshots + نتائج ويرجع 4 insights مفصّلة:
      1. أفضل وقت (session)
      2. RSI range الأمثل للدخول
      3. EMA + اتجاه الفلتر
      4. توصية فورية للإعدادات
    """
    if not ANTHROPIC_API_KEY:
        push_log("warn", "PATTERN_AI: ANTHROPIC_API_KEY غير موجود")
        return
    push_log("info", "PATTERN_AI: بدأ التحليل ...")

    trades    = get_history(200)
    trade_map = {t["ticket"]: t for t in trades}
    snaps     = get_snapshots(100)

    # ─── ربط الـ snapshots بنتائج الصفقات ───────────────────────────
    enriched = []
    for s in snaps:
        t = trade_map.get(s.get("ticket"))
        if not t:
            continue
        profit = t.get("profit", 0) + t.get("swap", 0) + t.get("commission", 0)
        enriched.append({
            "rsi":       s.get("rsi", 50),
            "ema_up":    s.get("ema_up", True),
            "atr":       s.get("atr", 0),
            "session":   s.get("session", "Unknown"),
            "direction": s.get("direction", "BUY"),
            "profit":    round(profit, 2),
            "win":       profit > 0,
        })

    # ─── fallback: comment-based إذا snapshots ناقصة ────────────────
    if len(enriched) < 5:
        comment_trades = [
            t for t in trades
            if t.get("comment") and "RSI=" in (t.get("comment") or "")
        ]
        if len(comment_trades) < 5:
            return
        wins  = [t for t in comment_trades if (t.get("profit", 0)) > 0]
        loses = [t for t in comment_trades if (t.get("profit", 0)) <= 0]
        prompt = (
            f"XAUUSD M1 scalping bot. {len(comment_trades)} closed trades.\n"
            f"WIN ({len(wins)}): " + " | ".join(t["comment"] for t in wins[:10]) + "\n"
            f"LOSS ({len(loses)}): " + " | ".join(t["comment"] for t in loses[:10]) + "\n\n"
            "Format your response EXACTLY as:\n"
            "BEST SESSION: [answer]\n"
            "BEST RSI: [answer]\n"
            "EMA RULE: [answer]\n"
            "ACTION: [one sentence]\n"
            "Be specific with numbers. Max 12 words per line."
        )
    else:
        wins  = [e for e in enriched if e["win"]]
        loses = [e for e in enriched if not e["win"]]

        def summarize(lst, label):
            if not lst:
                return f"{label}: no data"
            sessions = {}
            rsi_sum  = 0
            ema_up_c = 0
            for e in lst:
                sessions[e["session"]] = sessions.get(e["session"], 0) + 1
                rsi_sum  += e["rsi"]
                ema_up_c += 1 if e["ema_up"] else 0
            best_sess = max(sessions, key=sessions.get)
            avg_rsi   = round(rsi_sum / len(lst), 1)
            ema_pct   = round(ema_up_c / len(lst) * 100)
            samples   = " | ".join(
                f"RSI={e['rsi']} EMA={'↑' if e['ema_up'] else '↓'} S={e['session']} P=${e['profit']}"
                for e in lst[:8]
            )
            return (
                f"{label} ({len(lst)}): best_session={best_sess} avg_rsi={avg_rsi} "
                f"ema_up={ema_pct}% | samples: {samples}"
            )

        win_rate = round(len(wins) / len(enriched) * 100, 1) if enriched else 0
        total_pnl = round(sum(e["profit"] for e in enriched), 2)

        prompt = (
            f"XAUUSD M1 scalping bot analysis. {len(enriched)} trades, "
            f"win_rate={win_rate}%, total_pnl=${total_pnl}\n\n"
            f"{summarize(wins,  'WINS')}\n"
            f"{summarize(loses, 'LOSSES')}\n\n"
            "Based on this data, format your response EXACTLY as:\n"
            "BEST SESSION: [which session wins most and %]\n"
            "BEST RSI: [optimal RSI range at entry e.g. 40-60]\n"
            "EMA RULE: [should EMA be up or down for BUY/SELL]\n"
            "ACTION: [one specific setting change to improve win rate]\n"
            "Be specific with numbers from the data. Max 15 words per line."
        )

    try:
        body = json.dumps({
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 200,
            "messages": [{"role": "user", "content": prompt}]
        }).encode()
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=body,
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }
        )
        with urllib.request.urlopen(req, timeout=25) as resp:
            result = json.loads(resp.read())["content"][0]["text"].strip()
        with data_lock:
            latest_data["pattern_advice"] = result
            latest_data["pattern_time"]   = datetime.now().isoformat()
        push_log("ok", "PATTERN_AI: ✅ تحليل جاهز")
        socketio.emit("dashboard", build_dashboard_payload())
    except Exception as e:
        push_log("err", f"PATTERN_AI: فشل — {str(e)[:60]}")
        print(f"Claude pattern error: {e}")


# ---------- WebSocket events ----------
@socketio.on("connect")
def on_connect():
    """عند اتصال client جديد، يبعث له snapshot فوري + سجل الأحداث"""
    try:
        payload = build_dashboard_payload()
        emit("dashboard", payload)
        # إرسال آخر 50 رسالة من الـ buffer
        with _log_lock:
            history = list(_log_buffer[-50:])
        emit("log_history", history)
    except Exception:
        pass


@socketio.on("disconnect")
def on_disconnect():
    pass


# ---------- HTTP routes ----------
@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def index(path):
    static_dir = os.path.join(os.path.dirname(__file__), "static")
    file_path  = os.path.join(static_dir, path)
    if path and os.path.exists(file_path):
        return app.send_static_file(path)
    index_file = os.path.join(static_dir, "index.html")
    if os.path.exists(index_file):
        with open(index_file) as f:
            return Response(f.read(), mimetype="text/html")
    return jsonify({"status": "ok", "message": "MT5 Dashboard API is running"})


@app.route("/api/update", methods=["POST"])
def update_data():
    if not check_api_key():
        return jsonify({"error": "Unauthorized"}), 401

    payload = request.get_json()
    now = datetime.now().isoformat()

    history_payload = payload.get("history")
    with data_lock:
        latest_data["account"]        = payload.get("account")
        # حماية من التذبذب: لو مصدر ثانٍ (وكيل مكرر / قديم) يرسل positions فارغة،
        # نتجاهل الإفراغ العابر ونبقي آخر صفقات معروفة — لا نُفرّغ إلا بعد 8 ثوانٍ
        # بلا أي تحديث فيه صفقات (إغلاق فعلي).
        import time as _t
        _pos_in = payload.get("positions", [])
        _pnow = _t.time()
        if _pos_in:
            latest_data["positions"] = _pos_in
            latest_data["_pos_ts"]   = _pnow
        elif _pnow - latest_data.get("_pos_ts", 0) > 8:
            latest_data["positions"] = []
        latest_data["pending_orders"] = payload.get("pending_orders", [])
        latest_data["news_filter"]    = payload.get("news_filter", {"blocked": False, "title": ""})
        if payload.get("h1_bias_up") is not None:
            latest_data["h1_bias_up"] = payload.get("h1_bias_up")
        if payload.get("last_rsi") is not None:
            latest_data["last_rsi"]   = payload.get("last_rsi")
        if payload.get("block_reason") is not None:
            latest_data["block_reason"] = payload.get("block_reason")
        latest_data["last_update"]    = now

        if latest_data["account"]:
            save_account(latest_data["account"], now)

        # لوج الصفقات الجديدة فقط (تجاهل المكررة)
        _new_trades = False
        if history_payload:
            for t in (history_payload if isinstance(history_payload, list) else [history_payload]):
                ticket = t.get("ticket", "")
                if ticket in _logged_trade_tickets:
                    continue
                _logged_trade_tickets.add(ticket)
                _new_trades = True
                profit = t.get("profit", 0)
                sym    = t.get("symbol", "")
                tp     = t.get("type", "")
                emoji  = "🟢" if profit > 0 else "🔴"
                push_log("trade", f"{emoji} TRADE #{ticket} {tp} {sym} P&L: ${profit:.2f}")

        pos = payload.get("positions", [])

        upsert_history(history_payload)

        # بث الـ history فوراً عند أي صفقة جديدة
        if _new_trades:
            try:
                socketio.emit("history", get_history(200))
            except Exception:
                pass
            # تقييم آخر تعديل تلقائي (وتراجع إن كان أسوأ) — يعمل دائماً،
            # no-op إذا لا توجد نسخ auto غير مقيّمة
            import threading
            threading.Thread(target=evaluate_settings_versions, daemon=True).start()

    # Claude checks
    settings = get_settings()
    claude_enabled = int(settings.get("ClaudeEnabled", 1)) == 1
    # تحليل كلود للصفقات الخاسرة (تعديل تلقائي) — معطّل بطلب المستخدم؛
    # يُفعّل فقط لو ClaudeLossAdjust=1 صراحةً.
    claude_loss_adjust = int(settings.get("ClaudeLossAdjust", 0)) == 1
    if claude_loss_adjust and claude_enabled and history_payload:
        recent = get_history(20)
        # 1) تحذير خسائر متتالية
        consecutive = 0
        for t in recent:
            if t["profit"] <= 0:
                consecutive += 1
            else:
                break
        if consecutive >= 5:
            last_claude = latest_data.get("claude_time")
            if last_claude is None or consecutive == 5:
                push_log("warn", f"⚠️ CLAUDE: {consecutive} خسائر متتالية — يحلل ...")
                advice = call_claude(consecutive, recent, latest_data["account"] or {})
                with data_lock:
                    latest_data["claude_advice"] = advice
                    latest_data["claude_time"]   = now
                push_log("ok", "✅ CLAUDE: توصية جاهزة")
                # تعديل إعدادات تلقائي بناءً على snapshots الخسائر
                losing_snaps = []
                all_snaps = get_snapshots(50)
                snap_map  = {s.get("ticket"): s for s in all_snaps}
                for t in recent[:consecutive]:
                    s = snap_map.get(t.get("ticket"))
                    if s:
                        s["profit"] = t.get("profit", 0)
                        losing_snaps.append(s)
                if losing_snaps:
                    import threading
                    threading.Thread(
                        target=auto_adjust_settings,
                        args=(losing_snaps, latest_data["account"] or {}),
                        daemon=True
                    ).start()
        # 2) تحليل patterns كل 10 صفقات جديدة
        global _last_pattern_count
        total = len(get_history(1000))
        if total - _last_pattern_count >= 10:
            _last_pattern_count = total
            push_log("info", f"🔄 PATTERN_AI: {total} صفقة — يبدأ التحليل تلقائياً")
            import threading
            threading.Thread(target=analyze_patterns, daemon=True).start()

    # بث التحديث لكل الـ clients المتصلين فوراً
    try:
        dashboard_payload = build_dashboard_payload()
        socketio.emit("dashboard", dashboard_payload)
    except Exception:
        pass

    return jsonify({"status": "ok"})


@app.route("/api/ea_log", methods=["POST"])
def ea_log():
    """Receive log lines from mt5_agent and push to dashboard."""
    data = request.get_json(silent=True) or {}
    lines = data.get("lines", [])
    for item in lines:
        level = item.get("level", "info")
        msg   = item.get("msg", "")
        if msg:
            push_log(level, msg)
    return jsonify({"ok": True, "count": len(lines)})


@app.route("/api/logs", methods=["GET"])
def api_get_logs():
    since = int(request.args.get("since", 0))  # index — أرجع فقط ما بعده
    with _log_lock:
        buf = list(_log_buffer)
    if since > 0 and since < len(buf):
        buf = buf[since:]
    return jsonify({"logs": buf, "total": len(_log_buffer)})


@app.route("/api/ping", methods=["GET"])
def ping():
    return jsonify({"ok": True})


@app.route("/api/dashboard", methods=["GET"])
def get_dashboard():
    return jsonify(build_dashboard_payload())


@app.route("/api/settings", methods=["GET"])
def api_get_settings():
    try:
        return jsonify(get_settings())
    except Exception:
        return jsonify(DEFAULT_SETTINGS), 200


@app.route("/api/settings", methods=["POST"])
def api_save_settings():
    if not check_api_key():
        return jsonify({"error": "Unauthorized"}), 401
    body = request.get_json()
    if not body:
        return jsonify({"error": "No data"}), 400
    try:
        save_settings(body)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # بث الإعدادات الجديدة لكل الـ clients
    try:
        socketio.emit("settings", get_settings())
    except Exception:
        pass

    return jsonify({"status": "ok", "settings": get_settings()})


@app.route("/api/settings/seed", methods=["POST"])
def api_seed_settings():
    """
    الـ Agent يدفع إعداداته المحلية (GSX_Settings.json) هنا.
    تُقبل فقط إذا كان الـ container جديداً (لم يحفظ المستخدم شيئاً بعد) —
    هكذا تُستعاد الإعدادات الحقيقية بعد كل Railway redeploy،
    ولا يستطيع ملف agent قديم أن يدهس حفظاً جديداً من الداشبورد.
    """
    if not check_api_key():
        return jsonify({"error": "Unauthorized"}), 401
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "No data"}), 400
    # لا تقبل الـ seed إذا المستخدم سبق وحفظ إعدادات — داشبورد له الأولوية
    if is_user_saved():
        return jsonify({"status": "ok", "applied": False, "settings": get_settings()})
    try:
        save_settings(body, mark_user_saved=False, source="seed", reason="agent seed after redeploy")
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    try:
        socketio.emit("settings", get_settings())
    except Exception:
        pass
    return jsonify({"status": "ok", "applied": True, "settings": get_settings()})


@app.route("/api/settings/btc", methods=["GET"])
def api_get_btc_settings():
    if not check_api_key():
        return jsonify({"error": "Unauthorized"}), 401
    return jsonify(get_btc_settings()), 200


@app.route("/api/settings/btc", methods=["POST"])
def api_save_btc_settings():
    if not check_api_key():
        return jsonify({"error": "Unauthorized"}), 401
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "No data"}), 400
    save_btc_settings(body)
    try:
        socketio.emit("btc_settings", get_btc_settings())
    except Exception:
        pass
    return jsonify({"status": "ok", "settings": get_btc_settings()})


@app.route("/api/settings/btc/seed", methods=["POST"])
def api_seed_btc_settings():
    if not check_api_key():
        return jsonify({"error": "Unauthorized"}), 401
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "No data"}), 400
    if is_btc_user_saved():
        return jsonify({"status": "ok", "applied": False, "settings": get_btc_settings()})
    save_btc_settings(body, mark_user_saved=False)
    try:
        socketio.emit("btc_settings", get_btc_settings())
    except Exception:
        pass
    return jsonify({"status": "ok", "applied": True, "settings": get_btc_settings()})


def is_grx_user_saved():
    with get_db() as conn:
        row = conn.execute(
            "SELECT value FROM grx_settings WHERE key='grx_user_saved'"
        ).fetchone()
        return row is not None and row["value"] == "1"


def _save_grx_backup(settings):
    _grx_backup = os.path.join(_db_dir if _db_dir else ".", "grx_settings_backup.json")
    try:
        with open(_grx_backup, "w") as f:
            json.dump({**settings, "_grx_user_saved": True}, f)
    except Exception:
        pass


def get_grx_settings():
    result = dict(GRX_DEFAULT_SETTINGS)
    with get_db() as conn:
        rows = conn.execute("SELECT key, value FROM grx_settings").fetchall()
        for row in rows:
            k, v = row["key"], row["value"]
            if k in GRX_DEFAULT_SETTINGS:
                try:
                    result[k] = type(GRX_DEFAULT_SETTINGS[k])(v)
                except Exception:
                    result[k] = v
    return result


def save_grx_settings(new_settings, mark_user_saved=True):
    with get_db() as conn:
        for k, v in new_settings.items():
            if k in GRX_DEFAULT_SETTINGS:
                conn.execute(
                    "INSERT INTO grx_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (k, str(v))
                )
        if mark_user_saved:
            conn.execute(
                "INSERT OR REPLACE INTO grx_settings (key, value) VALUES ('grx_user_saved', '1')"
            )
        conn.commit()
    if mark_user_saved:
        _save_grx_backup(get_grx_settings())


@app.route("/api/settings/grx", methods=["GET"])
def api_get_grx_settings():
    if not check_api_key():
        return jsonify({"error": "Unauthorized"}), 401
    return jsonify(get_grx_settings()), 200


@app.route("/api/settings/grx", methods=["POST"])
def api_save_grx_settings():
    if not check_api_key():
        return jsonify({"error": "Unauthorized"}), 401
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "No data"}), 400
    save_grx_settings(body)
    try:
        socketio.emit("grx_settings", get_grx_settings())
    except Exception:
        pass
    return jsonify({"status": "ok", "settings": get_grx_settings()})


@app.route("/api/settings/grx/seed", methods=["POST"])
def api_seed_grx_settings():
    if not check_api_key():
        return jsonify({"error": "Unauthorized"}), 401
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "No data"}), 400
    if is_grx_user_saved():
        return jsonify({"status": "ok", "applied": False, "settings": get_grx_settings()})
    save_grx_settings(body, mark_user_saved=False)
    try:
        socketio.emit("grx_settings", get_grx_settings())
    except Exception:
        pass
    return jsonify({"status": "ok", "applied": True, "settings": get_grx_settings()})


@app.route("/api/settings/hedge", methods=["GET"])
def api_get_hedge_settings():
    if not check_api_key():
        return jsonify({"error": "Unauthorized"}), 401
    return jsonify(get_hedge_settings()), 200


@app.route("/api/settings/hedge", methods=["POST"])
def api_save_hedge_settings():
    if not check_api_key():
        return jsonify({"error": "Unauthorized"}), 401
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "No data"}), 400
    save_hedge_settings(body)
    try:
        socketio.emit("hedge_settings", get_hedge_settings())
    except Exception:
        pass
    return jsonify({"status": "ok", "settings": get_hedge_settings()})


@app.route("/api/trade_snapshot", methods=["POST"])
def api_save_snapshot():
    if not check_api_key():
        return jsonify({"error": "Unauthorized"}), 401
    snap = request.get_json(silent=True)
    if not snap or not snap.get("ticket"):
        return jsonify({"error": "No data"}), 400
    save_snapshot(snap)
    return jsonify({"status": "ok"})


@app.route("/api/trade_excursion", methods=["POST"])
def api_trade_excursion():
    """MFE/MAE من الـ agent عند إغلاق كل صفقة — يقبل صفقة واحدة أو دفعة"""
    if not check_api_key():
        return jsonify({"error": "Unauthorized"}), 401
    body = request.get_json(silent=True) or {}
    items = body.get("excursions") or ([body] if body.get("ticket") else [])
    updated = 0
    with get_db() as conn:
        for it in items:
            try:
                tk = int(it["ticket"])
                mfe = float(it.get("mfe", 0))
                mae = float(it.get("mae", 0))
            except (KeyError, TypeError, ValueError):
                continue
            # لو الصفقة لم تصل بعد عبر history sync، يُنشأ صف ناقص
            # يكتمل لاحقاً بالـ upsert (الذي لا يدهس mfe/mae)
            conn.execute("""
                INSERT INTO trade_history (ticket, mfe, mae) VALUES (?, ?, ?)
                ON CONFLICT(ticket) DO UPDATE SET mfe=excluded.mfe, mae=excluded.mae
            """, (tk, mfe, mae))
            updated += 1
        conn.commit()
    return jsonify({"status": "ok", "updated": updated})


@app.route("/api/learning/journal", methods=["GET"])
def api_learning_journal():
    """سجل التعلم: كل نسخة إعدادات مع عدد صفقاتها ونتيجتها الصافية"""
    limit = int(request.args.get("limit", 50))
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM settings_versions ORDER BY version DESC LIMIT ?", (limit,)
        ).fetchall()
        out = []
        for r in rows:
            stats = conn.execute(
                "SELECT COUNT(*) c, COALESCE(SUM(profit),0) s, COALESCE(AVG(profit),0) a "
                "FROM trade_history WHERE settings_version=? AND profit IS NOT NULL",
                (r["version"],)
            ).fetchone()
            out.append({
                "version":    r["version"],
                "source":     r["source"],
                "reason":     r["reason"],
                "applied_at": r["applied_at"],
                "evaluated":  r["evaluated"],
                "reverted":   r["reverted"],
                "outcome":    json.loads(r["outcome"]) if r["outcome"] else None,
                "params":     json.loads(r["params"]),
                "trades":     stats["c"],
                "net_pnl":    round(stats["s"], 2),
                "avg_pnl":    round(stats["a"], 2),
            })
    return jsonify(out)


@app.route("/api/learning/report", methods=["GET"])
def api_learning_report():
    """تقرير تصنيف الخسائر (attribution) على آخر N صفقة"""
    limit = int(request.args.get("limit", 200))
    return jsonify(loss_attribution(limit))


@app.route("/api/trade_snapshot/<int:ticket>", methods=["GET"])
def api_get_snapshot(ticket):
    snap = get_snapshot(ticket)
    if not snap:
        return jsonify({"error": "not found"}), 404
    return jsonify(snap)


@app.route("/api/snapshots", methods=["GET"])
def api_get_snapshots():
    limit = int(request.args.get("limit", 50))
    snaps = get_snapshots(limit)
    result = []
    for s in snaps:
        result.append({
            "ticket":      s.get("ticket"),
            "symbol":      s.get("symbol"),
            "direction":   s.get("direction"),
            "entry_price": s.get("entry_price"),
            "rsi":         s.get("rsi"),
            "atr":         s.get("atr"),
            "ema_up":      s.get("ema_up"),
            "session":     s.get("session"),
            "candles":     s.get("candles", [])[-30:],
        })
    return jsonify(result)


@app.route("/api/export/trades", methods=["GET"])
def api_export_trades():
    history   = get_history(10000)
    snapshots = get_snapshots(10000)
    snap_map  = {s.get("ticket"): s for s in snapshots if s.get("ticket")}

    trades = []
    for t in history:
        ticket = t.get("ticket")
        snap   = snap_map.get(ticket, {})
        trades.append({
            "ticket":      ticket,
            "symbol":      t.get("symbol"),
            "type":        t.get("type"),
            "volume":      t.get("volume"),
            "entry_price": t.get("price"),
            "profit":      t.get("profit"),
            "swap":        t.get("swap"),
            "commission":  t.get("commission"),
            "open_time":   t.get("time"),
            "comment":     t.get("comment"),
            "rsi_at_entry":   snap.get("rsi"),
            "atr_at_entry":   snap.get("atr"),
            "ema_up":         snap.get("ema_up"),
            "session":        snap.get("session"),
            "candles_before": snap.get("candles", [])[-20:],
        })

    export = {
        "exported_at": datetime.now().isoformat(),
        "total_trades": len(trades),
        "summary": {
            "wins":   len([x for x in trades if (x["profit"] or 0) > 0]),
            "losses": len([x for x in trades if (x["profit"] or 0) <= 0]),
            "total_pnl": round(sum((x["profit"] or 0) for x in trades), 2),
        },
        "trades": trades,
    }

    from flask import Response
    return Response(
        json.dumps(export, ensure_ascii=False, indent=2),
        mimetype="application/json",
        headers={"Content-Disposition": "attachment; filename=trades_export.json"}
    )


@app.route("/api/candles", methods=["POST"])
def update_candles():
    if not check_api_key():
        return jsonify({"error": "Unauthorized"}), 401
    payload = request.get_json()
    with data_lock:
        if payload.get("candles"):
            latest_data["candles"] = payload["candles"]
        if payload.get("sessions"):
            latest_data["sessions"] = payload["sessions"]

    # بث الشمعات فوراً
    try:
        socketio.emit("candles", {
            "candles":  latest_data["candles"],
            "sessions": latest_data["sessions"],
        })
    except Exception:
        pass

    return jsonify({"status": "ok"})


@app.route("/api/candles", methods=["GET"])
def get_candles():
    with data_lock:
        return jsonify({
            "candles":  latest_data["candles"],
            "sessions": latest_data["sessions"],
        })


# ── GRID-AI: كلود يحدّد أماكن أوردرات الشبكة من الشارت (دعم/مقاومة) ──
_grid_cache = {"buys": [], "sells": [], "ts": 0.0}

def compute_grid_levels():
    """كلود يحلل آخر الشموع ويرجّع مستويات دعم (للشراء) ومقاومة (للبيع)."""
    import time as _t, urllib.request
    if not ANTHROPIC_API_KEY:
        return _grid_cache
    with data_lock:
        candles = list(latest_data.get("candles") or [])[-40:]
    if len(candles) < 20:
        return _grid_cache
    cur = candles[-1].get("c")
    rows = "\n".join(f"{c.get('o')},{c.get('h')},{c.get('l')},{c.get('c')}" for c in candles)
    prompt = (
        "You place a grid of pending orders on XAUUSD (gold).\n"
        f"Current price: {cur}\n"
        "Recent M1 candles as open,high,low,close (oldest first):\n" + rows + "\n\n"
        "From swing highs/lows and level clustering, pick key SUPPORT prices BELOW "
        "current (for BUY-limit orders) and key RESISTANCE prices ABOVE current (for "
        "SELL-limit orders). Return ONLY compact JSON, no words:\n"
        '{"buys":[up to 4 support prices below current, nearest first],'
        '"sells":[up to 4 resistance prices above current, nearest first]}'
    )
    try:
        body = json.dumps({"model": "claude-haiku-4-5-20251001", "max_tokens": 200,
                           "messages": [{"role": "user", "content": prompt}]}).encode()
        req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body,
              headers={"x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01",
                       "content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=20) as r:
            txt = json.loads(r.read())["content"][0]["text"]
        s = txt.find("{"); e = txt.rfind("}") + 1
        obj = json.loads(txt[s:e])
        buys  = [round(float(x), 2) for x in obj.get("buys", [])  if float(x) < cur][:4]
        sells = [round(float(x), 2) for x in obj.get("sells", []) if float(x) > cur][:4]
        _grid_cache.update(buys=buys, sells=sells, ts=_t.time())
        push_log("ok", f"🧮 GRID-AI: {len(buys)} دعم / {len(sells)} مقاومة")
    except Exception as ex:
        push_log("err", f"GRID-AI: {str(ex)[:50]}")
    return _grid_cache


@app.route("/api/grid_levels", methods=["GET"])
def api_grid_levels():
    import time as _t
    s = get_settings()
    if int(s.get("ClaudeGrid", 0)) == 1 and (_t.time() - _grid_cache["ts"] > 180):
        compute_grid_levels()
    return jsonify({"buys": _grid_cache["buys"], "sells": _grid_cache["sells"],
                    "age": int(_t.time() - _grid_cache["ts"])})


@app.route("/api/analyze/run", methods=["POST"])
def api_run_analyze():
    if not check_api_key():
        return jsonify({"error": "Unauthorized"}), 401
    push_log("info", "⚡ PATTERN_AI: تشغيل يدوي من الداشبورد")
    import threading
    threading.Thread(target=analyze_patterns, daemon=True).start()
    return jsonify({"status": "started"})


@app.route("/api/bot/control", methods=["POST"])
def bot_control():
    if not check_api_key():
        return jsonify({"error": "Unauthorized"}), 401
    body = request.get_json()
    action = body.get("action")
    if action not in ("start", "stop"):
        return jsonify({"error": "action must be start or stop"}), 400
    save_settings({"BotRunning": 1 if action == "start" else 0})

    try:
        socketio.emit("settings", get_settings())
    except Exception:
        pass

    return jsonify({"status": "ok", "BotRunning": 1 if action == "start" else 0})


@app.route("/api/history", methods=["GET"])
def api_get_history():
    limit = int(request.args.get("limit", 200))
    trades = get_history(limit)
    return jsonify(trades)


@app.route("/api/history/import", methods=["POST"])
def api_import_history():
    """يستقبل تاريخ الصفقات المحفوظ محلياً على الويندوز ويعيد إدخاله (redeploy recovery)."""
    if not check_api_key():
        return jsonify({"error": "Unauthorized"}), 401
    body = request.get_json(silent=True) or {}
    trades = body.get("trades") if isinstance(body, dict) else body
    if not isinstance(trades, list):
        return jsonify({"error": "trades must be a list"}), 400
    upsert_history(trades)
    return jsonify({"status": "ok", "imported": len(trades)})


@app.route("/api/history/clear", methods=["POST"])
def api_clear_history():
    if not check_api_key():
        return jsonify({"error": "Unauthorized"}), 401
    with get_db() as conn:
        conn.execute("DELETE FROM trade_history")
        conn.commit()
    return jsonify({"status": "ok", "message": "history cleared"})


@app.route("/api/debug/history", methods=["GET"])
def api_debug_history():
    """debug: أحدث 5 صفقات + إجمالي العدد"""
    with get_db() as conn:
        total = conn.execute("SELECT COUNT(*) FROM trade_history").fetchone()[0]
        rows  = conn.execute(
            "SELECT ticket, symbol, time, profit FROM trade_history ORDER BY time DESC LIMIT 5"
        ).fetchall()
    return jsonify({"total": total, "latest5": [dict(r) for r in rows]})


@app.route("/api/snapshots/count", methods=["GET"])
def api_snapshots_count():
    with get_db() as conn:
        row = conn.execute("SELECT COUNT(*) as n FROM trade_snapshots").fetchone()
        n = row["n"] if row else 0
    return jsonify({"count": n})


@app.route("/api/backtest/latest", methods=["GET"])
def api_backtest_latest():
    """آخر نتيجة باك تست مرفوعة من جهاز MT5/OpenClaw."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT data, created_at FROM backtest_results WHERE id = 1"
        ).fetchone()
    if not row:
        return jsonify(DEFAULT_BACKTEST_RESULT)
    try:
        payload = json.loads(row["data"])
    except (TypeError, json.JSONDecodeError):
        payload = DEFAULT_BACKTEST_RESULT.copy()
    payload["stored_at"] = row["created_at"]
    return jsonify(payload)


@app.route("/api/backtest/result", methods=["POST"])
def api_backtest_result():
    """
    يستقبل نتيجة باك-تست من OpenClaw/Windows، يمرّرها على بوابة الترقية،
    وإذا اجتازت كل فحوصات الأمان (out-of-sample + عتبات + تفوّق على الحالي)
    يطبّق الباراميترات على البوت أوتوماتيك. غير ذلك: يخزّن ويرفض بدون لمس البوت.
    كل قرار يُسجَّل في جدول promotions للتدقيق.
    """
    if not check_api_key():
        return jsonify({"error": "Unauthorized"}), 401
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "JSON object required"}), 400
    required = {"strategy", "symbol", "timeframe", "baseline", "candidate", "decision"}
    missing = sorted(required - payload.keys())
    if missing:
        return jsonify({"error": "Missing fields", "fields": missing}), 400
    if len(json.dumps(payload)) > 250_000:
        return jsonify({"error": "Payload too large"}), 413

    # التحقّق المستقل — لا نثق في حقل decision القادم من المُرسِل، نحكم بأنفسنا.
    verdict = promotion_gate.evaluate(payload)
    payload["gate_decision"] = "approved" if verdict["approved"] else "rejected"
    payload["gate_reasons"]  = verdict["reasons"]

    applied_params = {}
    if verdict["approved"]:
        applied_params = verdict["applied_params"]
        save_settings(applied_params, mark_user_saved=True)   # يلتقطه الـ agent الدورة القادمة
        socketio.emit("settings", get_settings())
        push_log("ok", f"🎯 PROMOTION: تم تطبيق {len(applied_params)} إعداد بعد اجتياز التحقّق — "
                       + "، ".join(f"{k}={v}" for k, v in applied_params.items()))
    else:
        push_log("warn", "🛡️ PROMOTION: مرشّح مرفوض — " + " | ".join(verdict["reasons"][:2]))

    now = datetime.now().isoformat()
    with get_db() as conn:
        conn.execute(
            """INSERT INTO backtest_results (id, data, created_at) VALUES (1, ?, ?)
               ON CONFLICT(id) DO UPDATE SET data=excluded.data, created_at=excluded.created_at""",
            (json.dumps(payload), now),
        )
        conn.execute(
            """INSERT INTO promotions (created_at, approved, strategy, symbol, reasons, applied, checks)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (now, 1 if verdict["approved"] else 0,
             payload.get("strategy"), payload.get("symbol"),
             json.dumps(verdict["reasons"], ensure_ascii=False),
             json.dumps(applied_params), json.dumps(verdict["checks"], ensure_ascii=False)),
        )
        conn.commit()

    socketio.emit("backtest_result", payload)
    return jsonify({
        "status": "ok", "stored_at": now,
        "approved": verdict["approved"],
        "applied_params": applied_params,
        "reasons": verdict["reasons"],
    })


@app.route("/api/backtest/promotions", methods=["GET"])
def api_backtest_promotions():
    """سجل تدقيق آخر 50 قرار ترقية/رفض — للمراجعة من الداشبورد."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT created_at, approved, strategy, symbol, reasons, applied "
            "FROM promotions ORDER BY id DESC LIMIT 50"
        ).fetchall()
    out = []
    for r in rows:
        out.append({
            "created_at": r["created_at"],
            "approved":   bool(r["approved"]),
            "strategy":   r["strategy"],
            "symbol":     r["symbol"],
            "reasons":    json.loads(r["reasons"] or "[]"),
            "applied":    json.loads(r["applied"] or "{}"),
        })
    return jsonify({"promotions": out})


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "time": datetime.now().isoformat()})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port)
