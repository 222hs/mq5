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
    "StrategyMode":   0,
    "GridLevels":     3,
    "GridStep":       50,
    "HedgeLotMult":   0.5,
    "ScaleStep":      30,
    "ScaleMult":      1.5,
    "MaxScales":      3,
}

BTC_DEFAULT_SETTINGS = {
    "LotSize":        0.01,
    "TP_USD":         20.0,
    "SL_USD":         10.0,
    "MaxSpread":      2000,
    "MaxPositions":   3,
    "CooldownSecs":   90,
    "MaxLossPerDay":  100.0,
    "MaxProfitPerDay":500.0,
    "TradeHoursStart":0,
    "TradeHoursEnd":  24,
    "BotRunning":     1,
    "OrderType":      0,
    "RiskMode":       0,
    "RiskPercent":    1.0,
    "RSIBuyMax":      65.0,
    "RSISellMin":     35.0,
    "UseH1Filter":    1,
    "StrategyMode":   0,
    "GridLevels":     3,
    "GridStep":       50,
    "HedgeLotMult":   0.5,
    "ScaleStep":      30,
    "ScaleMult":      1.5,
    "MaxScales":      3,
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
                profit      REAL,
                swap        REAL,
                commission  REAL,
                time        TEXT,
                comment     TEXT
            )
        """)
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


def upsert_history(trades):
    if not trades:
        return
    with get_db() as conn:
        conn.executemany("""
            INSERT OR IGNORE INTO trade_history
                (ticket, symbol, type, volume, price, profit, swap, commission, time, comment)
            VALUES
                (:ticket, :symbol, :type, :volume, :price, :profit, :swap, :commission, :time, :comment)
        """, trades)
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
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM trade_history ORDER BY time DESC LIMIT ?", (limit,)
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


def save_settings(new_settings, mark_user_saved=True):
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

        closed_trades = get_history(100)
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
            "history":        closed_trades[:50],
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


def auto_adjust_settings(losing_snaps, account):
    """
    Claude يحلل snapshots الخسائر ويقترح تعديلات محددة على الإعدادات.
    يكتب القيم الجديدة مباشرة في DB فيلتقطها الـ Agent في الدورة القادمة.
    """
    if not ANTHROPIC_API_KEY:
        return
    if not losing_snaps:
        return

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
        save_settings({
            "RSIBuyMax":  rsi_buy,
            "RSISellMin": rsi_sell,
            "SL_USD":     sl_usd,
            "TP_USD":     tp_usd,
        })
        msg = (f"🤖 AUTO-ADJ: RSI {current.get('RSIBuyMax',65):.0f}/{current.get('RSISellMin',35):.0f}"
               f" → {rsi_buy:.0f}/{rsi_sell:.0f}  SL ${sl_usd:.1f}  TP ${tp_usd:.1f} | {reason}")
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
        latest_data["positions"]      = payload.get("positions", [])
        latest_data["pending_orders"] = payload.get("pending_orders", [])
        latest_data["news_filter"]    = payload.get("news_filter", {"blocked": False, "title": ""})
        if payload.get("h1_bias_up") is not None:
            latest_data["h1_bias_up"] = payload.get("h1_bias_up")
        if payload.get("last_rsi") is not None:
            latest_data["last_rsi"]   = payload.get("last_rsi")
        latest_data["last_update"]    = now

        if latest_data["account"]:
            save_account(latest_data["account"], now)

        # لوج الصفقات الجديدة
        if history_payload:
            for t in (history_payload if isinstance(history_payload, list) else [history_payload]):
                profit = t.get("profit", 0)
                sym    = t.get("symbol", "")
                tp     = t.get("type", "")
                emoji  = "🟢" if profit > 0 else "🔴"
                push_log("trade", f"{emoji} TRADE #{t.get('ticket','')} {tp} {sym} P&L: ${profit:.2f}")

        pos = payload.get("positions", [])

        upsert_history(history_payload)

    # Claude checks
    settings = get_settings()
    claude_enabled = int(settings.get("ClaudeEnabled", 1)) == 1
    if claude_enabled and history_payload:
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
        save_settings(body, mark_user_saved=False)
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


@app.route("/api/snapshots/count", methods=["GET"])
def api_snapshots_count():
    with get_db() as conn:
        row = conn.execute("SELECT COUNT(*) as n FROM trade_snapshots").fetchone()
        n = row["n"] if row else 0
    return jsonify({"count": n})


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "time": datetime.now().isoformat()})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port)
