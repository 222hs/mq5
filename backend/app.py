"""
MT5 Dashboard Backend
يستقبل البيانات من الـ Agent (Windows) ويوفرها للـ Dashboard (React)
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import json
import time
from datetime import datetime
from threading import Lock

app = Flask(__name__, static_folder="static", static_url_path="")
CORS(app)

# ============== الإعدادات ==============
API_KEY = os.environ.get("API_KEY", "ضع-مفتاح-سري-هنا")
DATA_FILE = "latest_data.json"
HISTORY_FILE = "history_data.json"
# ========================================

data_lock = Lock()

# تخزين مؤقت في الذاكرة (يُحفظ أيضاً بملف عشان ما يضيع عند إعادة التشغيل)
latest_data = {
    "account": None,
    "positions": [],
    "last_update": None,
}

trade_history = []


def load_data():
    global latest_data, trade_history
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r") as f:
            latest_data = json.load(f)
    if os.path.exists(HISTORY_FILE):
        with open(HISTORY_FILE, "r") as f:
            trade_history = json.load(f)


def save_data():
    with open(DATA_FILE, "w") as f:
        json.dump(latest_data, f)
    with open(HISTORY_FILE, "w") as f:
        json.dump(trade_history[-500:], f)  # آخر 500 صفقة فقط


load_data()


def check_api_key():
    key = request.headers.get("X-API-Key")
    return key == API_KEY


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def index(path):
    static_dir = os.path.join(os.path.dirname(__file__), "static")
    file_path = os.path.join(static_dir, path)
    if path and os.path.exists(file_path):
        return app.send_static_file(path)
    index_file = os.path.join(static_dir, "index.html")
    if os.path.exists(index_file):
        with open(index_file) as f:
            from flask import Response
            return Response(f.read(), mimetype="text/html")
    return jsonify({"status": "ok", "message": "MT5 Dashboard API is running"})


@app.route("/api/update", methods=["POST"])
def update_data():
    """يستقبل البيانات من الـ Agent"""
    if not check_api_key():
        return jsonify({"error": "Unauthorized"}), 401

    payload = request.get_json()

    with data_lock:
        latest_data["account"] = payload.get("account")
        latest_data["positions"] = payload.get("positions", [])
        latest_data["last_update"] = datetime.now().isoformat()

        new_history = payload.get("history")
        if new_history:
            existing_tickets = {h["ticket"] for h in trade_history}
            for trade in new_history:
                if trade["ticket"] not in existing_tickets:
                    trade_history.append(trade)
            trade_history.sort(key=lambda x: x["time"], reverse=True)

        save_data()

    return jsonify({"status": "ok"})


@app.route("/api/dashboard", methods=["GET"])
def get_dashboard():
    """يوفر كل البيانات لواجهة React"""
    with data_lock:
        is_online = False
        if latest_data["last_update"]:
            last = datetime.fromisoformat(latest_data["last_update"])
            is_online = (datetime.now() - last).total_seconds() < 30

        # حساب إحصائيات بسيطة
        closed_trades = trade_history
        wins = [t for t in closed_trades if t["profit"] > 0]
        losses = [t for t in closed_trades if t["profit"] <= 0]
        win_rate = (len(wins) / len(closed_trades) * 100) if closed_trades else 0
        total_profit = sum(t["profit"] for t in closed_trades)

        return jsonify({
            "account": latest_data["account"],
            "positions": latest_data["positions"],
            "history": closed_trades[:50],
            "is_online": is_online,
            "last_update": latest_data["last_update"],
            "stats": {
                "total_trades": len(closed_trades),
                "wins": len(wins),
                "losses": len(losses),
                "win_rate": round(win_rate, 1),
                "total_profit": round(total_profit, 2),
            }
        })


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "time": datetime.now().isoformat()})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
