"""MQTT bridge between sensor nodes (e.g. `sypialnia`) and the DB, HomeKit,
and the dashboard. Subscribes to inbound sensor topics and also publishes
outbound control commands (e.g. the HomeKit-driven LED).

Topics (home/<device>/<metric>):
    home/+/co2          JSON {"ppm": <int>, "valid": <bool>}  (in)
    home/+/status       "online" | "offline"  (Arduino LWT)   (in)
    home/sypialnia/led/set  JSON {"on": <bool>, "brightness": 0..100}
                            published retained by the HomeKit bridge  (out)

The broker runs locally on raspberry-hex, so MQTT_HOST defaults to localhost.
paho auto-reconnects via loop_forever(), so a node or broker restart is
handled without intervention.
"""
import json
import logging
import os
import threading

log = logging.getLogger("co2_mqtt")

MQTT_HOST = os.environ.get("MQTT_HOST", "localhost")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))


class CO2Mqtt(threading.Thread):
    def __init__(self, db, on_co2=None):
        """on_co2(device, ppm, valid) is called for each CO2 reading so the
        caller can push it to HomeKit. DB writes happen here."""
        super().__init__(daemon=True, name="CO2Mqtt")
        self._db = db
        self._on_co2 = on_co2
        self._client = None
        self._stop = threading.Event()

    def _make_client(self):
        import paho.mqtt.client as mqtt

        # paho-mqtt 2.x requires an explicit callback API version; keep the
        # classic v1 signatures so this works on 1.x and 2.x alike.
        try:
            client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1)
        except (AttributeError, TypeError):
            client = mqtt.Client()
        client.on_connect = self._on_connect
        client.on_message = self._on_message
        client.reconnect_delay_set(min_delay=1, max_delay=30)
        return client

    def _on_connect(self, client, userdata, flags, rc):
        log.info("MQTT connected (rc=%s); subscribing", rc)
        client.subscribe([("home/+/co2", 0), ("home/+/status", 1)])

    def _on_message(self, client, userdata, msg):
        parts = msg.topic.split("/")
        if len(parts) != 3:
            return
        _, device, metric = parts
        payload = msg.payload.decode("utf-8", "replace").strip()
        try:
            if metric == "status":
                self._db.set_state(device, "status", payload)
                return
            if metric == "co2":
                data = json.loads(payload)
                ppm = int(data.get("ppm", -1))
                valid = bool(data.get("valid", False)) and ppm > 0
                if valid:
                    self._db.insert_reading(device, "co2", ppm)
                if self._on_co2:
                    self._on_co2(device, ppm, valid)
        except (ValueError, KeyError, TypeError):
            log.exception("bad message on %s: %r", msg.topic, payload)

    def run(self):
        try:
            self._client = self._make_client()
        except ImportError:
            log.error("paho-mqtt not installed; CO2 ingestion disabled "
                      "(pip install paho-mqtt in the venv)")
            return
        while not self._stop.is_set():
            try:
                self._client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
                self._client.loop_forever(retry_first_connection=True)
            except Exception:
                if self._stop.is_set():
                    break
                log.exception("MQTT loop crashed; retrying in 5s")
                self._stop.wait(5)

    def publish(self, topic, payload, qos=1, retain=True):
        """Publish an outbound command. Thread-safe: paho's publish() may be
        called from another thread while loop_forever() runs. Best-effort —
        if the client is not connected yet the message is dropped (a retained
        command will simply be re-sent on the next HomeKit interaction)."""
        client = self._client
        if client is None or not client.is_connected():
            log.warning("MQTT not connected; dropping publish to %s", topic)
            return False
        try:
            client.publish(topic, payload, qos=qos, retain=retain)
            return True
        except Exception:
            log.exception("MQTT publish to %s failed", topic)
            return False

    def stop(self):
        self._stop.set()
        if self._client is not None:
            try:
                self._client.disconnect()
            except Exception:
                pass
