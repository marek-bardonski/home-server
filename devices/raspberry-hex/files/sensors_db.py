"""Single SQLite store for all home sensor data on raspberry-hex.

One DB file, generic schema, so future metrics (and a future MCP reader) need
no schema changes:

    readings(ts, device, metric, value)   -- time series, e.g. ('sypialnia','co2',812)
    device_state(device, key, value, ts)  -- latest scalar state, e.g. status='online'

The file lives next to this module (so it sits in REMOTE_DIR) and is excluded
from rsync --delete in update.sh, so history survives deploys. WAL mode lets
the dashboard read while the MQTT thread writes.
"""
import os
import sqlite3
import threading
import time

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "home.db")


class SensorsDB:
    def __init__(self, path=DB_PATH):
        self._lock = threading.Lock()
        # check_same_thread=False: the MQTT and Flask threads share one conn,
        # serialized by self._lock (volume is tiny — a few rows per minute).
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        with self._lock:
            self._conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS readings (
                    ts     INTEGER NOT NULL,
                    device TEXT    NOT NULL,
                    metric TEXT    NOT NULL,
                    value  REAL    NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_readings_dmt
                    ON readings(device, metric, ts);
                CREATE INDEX IF NOT EXISTS idx_readings_mt
                    ON readings(metric, ts);
                CREATE TABLE IF NOT EXISTS device_state (
                    device TEXT NOT NULL,
                    key    TEXT NOT NULL,
                    value  TEXT,
                    ts     INTEGER NOT NULL,
                    PRIMARY KEY (device, key)
                );
                """
            )
            self._conn.commit()

    def insert_reading(self, device, metric, value, ts=None):
        ts = int(ts if ts is not None else time.time())
        with self._lock:
            self._conn.execute(
                "INSERT INTO readings(ts, device, metric, value) VALUES (?,?,?,?)",
                (ts, device, metric, float(value)),
            )
            self._conn.commit()

    def set_state(self, device, key, value, ts=None):
        ts = int(ts if ts is not None else time.time())
        with self._lock:
            self._conn.execute(
                "INSERT INTO device_state(device, key, value, ts) VALUES (?,?,?,?) "
                "ON CONFLICT(device, key) DO UPDATE SET value=excluded.value, ts=excluded.ts",
                (device, key, str(value), ts),
            )
            self._conn.commit()

    def list_metrics(self):
        with self._lock:
            rows = self._conn.execute(
                "SELECT DISTINCT device, metric FROM readings ORDER BY device, metric"
            ).fetchall()
        return [{"device": d, "metric": m} for d, m in rows]

    def history(self, device, metric, since_ts):
        with self._lock:
            rows = self._conn.execute(
                "SELECT ts, value FROM readings "
                "WHERE device=? AND metric=? AND ts>=? ORDER BY ts",
                (device, metric, int(since_ts)),
            ).fetchall()
        return [{"ts": ts, "value": v} for ts, v in rows]

    def latest(self):
        with self._lock:
            readings = self._conn.execute(
                "SELECT device, metric, value, MAX(ts) FROM readings GROUP BY device, metric"
            ).fetchall()
            state = self._conn.execute(
                "SELECT device, key, value, ts FROM device_state"
            ).fetchall()
        return {
            "readings": [
                {"device": d, "metric": m, "value": v, "ts": ts}
                for d, m, v, ts in readings
            ],
            "state": [
                {"device": d, "key": k, "value": v, "ts": ts}
                for d, k, v, ts in state
            ],
        }
