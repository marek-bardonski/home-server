"""Tiny LAN dashboard: a generic time-series graph over the single SQLite DB.

Generic by design — it lists whatever (device, metric) pairs exist in
`readings`, so CO2 works today and future metrics appear with no code change.
Served by a daemon thread from the same process as the HomeKit bridge.
"""
import logging
import os
import threading
import time

log = logging.getLogger("dashboard")

DASHBOARD_PORT = int(os.environ.get("DASHBOARD_PORT", "8080"))
_HTML_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.html")


def _make_app(db):
    from flask import Flask, jsonify, request, send_file

    app = Flask(__name__)

    @app.route("/")
    def index():
        return send_file(_HTML_PATH)

    @app.route("/api/metrics")
    def metrics():
        return jsonify(db.list_metrics())

    @app.route("/api/latest")
    def latest():
        return jsonify(db.latest())

    @app.route("/api/history")
    def history():
        device = request.args.get("device", "")
        metric = request.args.get("metric", "")
        hours = float(request.args.get("hours", "24"))
        since = time.time() - hours * 3600
        return jsonify(db.history(device, metric, since))

    return app


def start_dashboard(db):
    """Start the Flask dev server in a daemon thread. Best-effort: if Flask
    is not installed yet the HomeKit/LED bridge keeps running regardless."""
    try:
        app = _make_app(db)
    except ImportError:
        log.error("flask not installed; dashboard disabled "
                  "(pip install flask in the venv)")
        return None

    def _run():
        # Flask's dev server is adequate for a single-user LAN dashboard.
        app.run(host="0.0.0.0", port=DASHBOARD_PORT,
                threaded=True, use_reloader=False)

    t = threading.Thread(target=_run, daemon=True, name="Dashboard")
    t.start()
    log.info("dashboard on http://0.0.0.0:%d/", DASHBOARD_PORT)
    return t
