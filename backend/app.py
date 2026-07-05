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
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

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


def analyze_patterns():
    """يحلل trade snapshots ويستخرج patterns — يُستدعى كل 20 صفقة"""
    if not ANTHROPIC_API_KEY:
        return

    trades     = get_history(100)
    trade_map  = {t["ticket"]: t for t in trades}
    snaps      = get_snapshots(60)

    # ربط الـ snapshots بنتائج الصفقات
    enriched = []
    for s in snaps:
        t = trade_map.get(s.get("ticket"))
        if t:
            enriched.append({
                "rsi":       s.get("rsi"),
                "ema_up":    s.get("ema_up"),
                "atr":       s.get("atr"),
                "session":   s.get("session"),
                "direction": s.get("direction"),
                "profit":    t.get("profit", 0),
            })

    # fallback للـ comment-based إذا snapshots ناقصة
    if len(enriched) < 8:
        comment_trades = [t for t in trades if t.get("comment") and "RSI=" in (t.get("comment") or "")]
        if len(comment_trades) < 8:
            return
        wins  = [t for t in comment_trades if (t["profit"] or 0) > 0]
        loses = [t for t in comment_trades if (t["profit"] or 0) <= 0]
        def fmt_c(lst):
            return " | ".join([t["comment"] for t in lst[:8]])
        prompt = (
            f"XAUUSD M1 scalping. WIN ({len(wins)}): {fmt_c(wins)}\n"
            f"LOSS ({len(loses)}): {fmt_c(loses)}\n"
            f"RSI/EMA=U‑D/ATR/S=session. ONE pattern insight max 25 words."
        )
    else:
        wins  = [e for e in enriched if e["profit"] > 0]
        loses = [e for e in enriched if e["profit"] <= 0]

        def fmt_e(lst):
            return " | ".join(
                f"RSI={e['rsi']} EMA={'U' if e['ema_up'] else 'D'} ATR={e['atr']} S={e['session']}"
                for e in lst[:12]
            )

        prompt = (
            f"XAUUSD M1 scalping bot — {len(enriched)} trades with entry snapshots.\n"
            f"WINS ({len(wins)}): {fmt_e(wins)}\n"
            f"LOSSES ({len(loses)}): {fmt_e(loses)}\n\n"
            f"Analyze RSI levels, EMA direction (U=up/D=down), ATR volatility range, "
            f"and session timing vs trade outcomes.\n"
            f"ONE specific actionable insight max 25 words. Cite specific values."
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
            result = json.loads(resp.read())["content"][0]["text"].strip()
        with data_lock:
            latest_data["pattern_advice"] = result
            latest_data["pattern_time"]   = datetime.now().isoformat()
        socketio.emit("dashboard", build_dashboard_payload())
    except Exception:
        pass


# ---------- WebSocket events ----------
@socketio.on("connect")
def on_connect():
    """عند اتصال client جديد، يبعث له snapshot فوري"""
    try:
        payload = build_dashboard_payload()
        emit("dashboard", payload)
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
        latest_data["last_update"]    = now

        if latest_data["account"]:
            save_account(latest_data["account"], now)

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
                advice = call_claude(consecutive, recent, latest_data["account"] or {})
                with data_lock:
                    latest_data["claude_advice"] = advice
                    latest_data["claude_time"]   = now
        # 2) تحليل patterns كل 20 صفقة جديدة
        global _last_pattern_count
        total = len(get_history(1000))
        if total - _last_pattern_count >= 20:
            _last_pattern_count = total
            import threading
            threading.Thread(target=analyze_patterns, daemon=True).start()

    # بث التحديث لكل الـ clients المتصلين فوراً
    try:
        dashboard_payload = build_dashboard_payload()
        socketio.emit("dashboard", dashboard_payload)
    except Exception:
        pass

    return jsonify({"status": "ok"})


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
    # لا نرسل الشمعات الكاملة في كل مرة — ندار من الـ dashboard
    return jsonify(snap)


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


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "time": datetime.now().isoformat()})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port)
