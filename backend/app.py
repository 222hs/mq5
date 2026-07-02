"""
MT5 Dashboard Backend
يستقبل البيانات من الـ Agent (Windows) ويوفرها للـ Dashboard (React)
"""

from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import os
import json
import sqlite3
from datetime import datetime
from threading import Lock

app = Flask(__name__, static_folder="static", static_url_path="")
CORS(app)

# ============== الإعدادات ==============
API_KEY = os.environ.get("API_KEY", "mysecretkey123")
_db_env = os.environ.get("DB_FILE", "mt5_data.db")
_db_dir = os.path.dirname(_db_env)
if _db_dir and not os.path.isdir(_db_dir):
    os.makedirs(_db_dir, exist_ok=True)
DB_FILE = _db_env
# ========================================

data_lock = Lock()

latest_data = {
    "account": None,
    "positions": [],
    "last_update": None,
}

DEFAULT_SETTINGS = {
    "LotSize":      0.01,
    "TP":           30,
    "SL":           40,
    "MaxSpread":    500,
    "MaxPositions": 3,
    "RSI_Period":   7,
    "EMA_Fast":     8,
    "EMA_Slow":     21,
    "CandleConf":   2,
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
        # إدراج الإعدادات الافتراضية إذا ما كانت موجودة
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


def save_settings(new_settings):
    with get_db() as conn:
        for k, v in new_settings.items():
            if k in DEFAULT_SETTINGS:
                conn.execute(
                    "INSERT INTO ea_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (k, str(v))
                )
        conn.commit()


# ---------- routes ----------
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

    with data_lock:
        latest_data["account"]     = payload.get("account")
        latest_data["positions"]   = payload.get("positions", [])
        latest_data["last_update"] = now

        if latest_data["account"]:
            save_account(latest_data["account"], now)

        upsert_history(payload.get("history"))

    return jsonify({"status": "ok"})


@app.route("/api/dashboard", methods=["GET"])
def get_dashboard():
    with data_lock:
        is_online = False
        if latest_data["last_update"]:
            last = datetime.fromisoformat(latest_data["last_update"])
            is_online = (datetime.now() - last).total_seconds() < 30

        closed_trades = get_history(500)
        wins   = [t for t in closed_trades if t["profit"] > 0]
        losses = [t for t in closed_trades if t["profit"] <= 0]
        win_rate     = (len(wins) / len(closed_trades) * 100) if closed_trades else 0
        total_profit = sum(
            t["profit"] + t.get("swap", 0) + t.get("commission", 0)
            for t in closed_trades
        )

        return jsonify({
            "account":     latest_data["account"],
            "positions":   latest_data["positions"],
            "history":     closed_trades[:50],
            "is_online":   is_online,
            "last_update": latest_data["last_update"],
            "stats": {
                "total_trades": len(closed_trades),
                "wins":         len(wins),
                "losses":       len(losses),
                "win_rate":     round(win_rate, 1),
                "total_profit": round(total_profit, 2),
            },
            "settings": get_settings(),
        })


@app.route("/api/settings", methods=["GET"])
def api_get_settings():
    try:
        return jsonify(get_settings())
    except Exception as e:
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
    return jsonify({"status": "ok", "settings": get_settings()})


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "time": datetime.now().isoformat()})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
