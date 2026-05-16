"""HomeKit bridge for the M5Stack HEX (37 SK6812 LEDs).

Exposes the panel as an Apple Home Lightbulb. The saturation slider chooses
the *mode*, not traditional HSV saturation:

    sat <= 32  -> YELLOW solid lamp (hue tints it within +/-20 deg of 60)
    sat <= 66  -> RED solid lamp    (hue tints it within +/-20 deg of 0)
    sat >  66  -> EFFECTS (auto-cycle all 8 effects, ~60s each, hue ignored)

Brightness scales output linearly in all modes, with a hard cap at POWER_CAP
(0.85) so the 5V/3A supply stays inside budget.

Runs as root because rpi_ws281x requires PWM access on GPIO 18.
"""
import colorsys
import json
import logging
import signal
import threading

from pyhap.accessory import Accessory
from pyhap.accessory_driver import AccessoryDriver
from pyhap.const import CATEGORY_LIGHTBULB
from rpi_ws281x import Color

from hex_effects_lib import (
    EFFECTS,
    POWER_CAP,
    blackout,
    fill,
    make_strip,
    scale_rgb,
)
from co2_mqtt import CO2Mqtt
from dashboard import start_dashboard
from sensors_db import SensorsDB

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("hex_homekit")

PERSIST_FILE = "/home/admin/hexled/hex_state.json"
HAP_PORT = 51826
BRIDGE_NAME = "HEX Lamp"
CO2_DETECT_PPM = 1000  # CarbonDioxideDetected flips above this (waku threshold)

# The sypialnia node's outward RGB LED, exposed here as a separate Lightbulb
# service. Setter callbacks publish a retained command the Arduino subscribes
# to, so the physical LED also survives a node reboot (broker replays it).
SYPIALNIA_LED_CMD_TOPIC = "home/sypialnia/led/set"
SYPIALNIA_LED_NAME = "Bedroom LED"

# Bathroom night-light enable, exposed as a Switch on the same accessory. ON =
# the matrix reacts to mmWave presence; OFF = it stays dark even with motion
# (presence is still detected and logged on the node). The setter publishes a
# retained command, so a node reboot keeps the user's choice.
BATHROOM_ENABLE_CMD_TOPIC = "home/bathroom/enable/set"
BATHROOM_ENABLE_NAME = "Bathroom Night Light"

YELLOW_CENTER_HUE = 60.0
RED_CENTER_HUE = 0.0
TINT_HALF_WIDTH = 20.0


def mode_from_saturation(sat):
    if sat <= 32:
        return "YELLOW"
    if sat <= 66:
        return "RED"
    return "EFFECTS"


def compute_solid_rgb(mode, user_hue):
    """Tint the mode's base color with the user's hue, clamped to +/-20 deg."""
    base = YELLOW_CENTER_HUE if mode == "YELLOW" else RED_CENTER_HUE
    delta = ((user_hue - base + 180.0) % 360.0) - 180.0
    delta = max(-TINT_HALF_WIDTH, min(TINT_HALF_WIDTH, delta))
    effective_hue = (base + delta) % 360.0
    rf, gf, bf = colorsys.hsv_to_rgb(effective_hue / 360.0, 1.0, 1.0)
    return int(rf * 255), int(gf * 255), int(bf * 255)


class LampState:
    def __init__(self, on=False, hue=60.0, saturation=20.0, brightness=80):
        self._lock = threading.Lock()
        self.on = on
        self.hue = hue
        self.saturation = saturation
        self.brightness = brightness

    def update(self, **kwargs):
        with self._lock:
            for k, v in kwargs.items():
                setattr(self, k, v)

    def snapshot(self):
        with self._lock:
            return (self.on, self.hue, self.saturation, self.brightness)


class EffectsThread(threading.Thread):
    def __init__(self, strip, state):
        super().__init__(daemon=True, name="EffectsThread")
        self.strip = strip
        self.state = state
        self.change_event = threading.Event()
        self.stop_event = threading.Event()
        self._effect_idx = 0

    def notify(self):
        self.change_event.set()

    def shutdown(self):
        self.stop_event.set()
        self.change_event.set()
        self.join(timeout=2.0)

    def run(self):
        log.info("EffectsThread started")
        while not self.stop_event.is_set():
            on, hue, sat, brightness = self.state.snapshot()
            scale = (brightness / 100.0) * POWER_CAP if on else 0.0

            if not on or scale == 0.0:
                blackout(self.strip)
                self.change_event.wait()
                self.change_event.clear()
                continue

            mode = mode_from_saturation(sat)

            if mode in ("YELLOW", "RED"):
                r, g, b = compute_solid_rgb(mode, hue)
                sr, sg, sb = scale_rgb(r, g, b, scale)
                fill(self.strip, Color(sr, sg, sb))
                self.change_event.wait()
                self.change_event.clear()
                continue

            # EFFECTS: clear before running so a state change during the
            # effect aborts it via change_event.
            self.change_event.clear()
            name, fn = EFFECTS[self._effect_idx % len(EFFECTS)]
            log.info("effect: %s (scale=%.2f)", name, scale)
            try:
                fn(self.strip, self.change_event, scale)
            except Exception:
                log.exception("effect %s raised", name)
            self._effect_idx += 1

        blackout(self.strip)
        log.info("EffectsThread exiting")


class HexLamp(Accessory):
    category = CATEGORY_LIGHTBULB

    def __init__(self, driver, state, effects_thread, *args, **kwargs):
        super().__init__(driver, BRIDGE_NAME, *args, **kwargs)
        self._state = state
        self._effects = effects_thread
        self._mqtt = None  # set via set_mqtt() once CO2Mqtt exists
        self._led = {"on": False, "brightness": 100}

        serv = self.add_preload_service(
            "Lightbulb", chars=["On", "Brightness", "Hue", "Saturation"])
        on, hue, sat, brightness = state.snapshot()
        self.char_on = serv.configure_char(
            "On", value=on, setter_callback=self._set_on)
        self.char_brightness = serv.configure_char(
            "Brightness", value=brightness, setter_callback=self._set_brightness)
        self.char_hue = serv.configure_char(
            "Hue", value=hue, setter_callback=self._set_hue)
        self.char_saturation = serv.configure_char(
            "Saturation", value=sat, setter_callback=self._set_saturation)

        # CO2 is a second service on this *same* accessory (not a Bridge), so
        # the existing hex_state.json pairing is preserved — Home just shows a
        # new sensor tile under the same accessory (a config-number bump, no
        # manual re-pair).
        co2 = self.add_preload_service(
            "CarbonDioxideSensor",
            chars=["CarbonDioxideDetected", "CarbonDioxideLevel"])
        self.char_co2_detected = co2.configure_char(
            "CarbonDioxideDetected", value=0)
        self.char_co2_level = co2.configure_char(
            "CarbonDioxideLevel", value=0)

        # The sypialnia RGB LED as a third service on this same accessory
        # (same pairing-preservation rationale as the CO2 sensor above). On +
        # Brightness only — it is driven as a plain white dimmable lamp.
        led = self.add_preload_service(
            "Lightbulb", chars=["On", "Brightness", "Name"])
        led.configure_char("Name", value=SYPIALNIA_LED_NAME)
        self.char_led_on = led.configure_char(
            "On", value=self._led["on"], setter_callback=self._set_led_on)
        self.char_led_brightness = led.configure_char(
            "Brightness", value=self._led["brightness"],
            setter_callback=self._set_led_brightness)

        # Bathroom night-light enable as a Switch on this same accessory
        # (same pairing-preservation rationale as the services above).
        # Default ON so the night light works out of the box; HomeKit is the
        # source of truth, replayed to the node via the retained command.
        self._bath_enabled = True
        sw = self.add_preload_service("Switch", chars=["On", "Name"])
        sw.configure_char("Name", value=BATHROOM_ENABLE_NAME)
        self.char_bath_enable = sw.configure_char(
            "On", value=self._bath_enabled,
            setter_callback=self._set_bath_enable)

    def set_mqtt(self, mqtt):
        """Wire the MQTT publisher (CO2Mqtt) used by the LED setters. Called
        from main() after CO2Mqtt is constructed."""
        self._mqtt = mqtt

    def _publish_led(self):
        if self._mqtt is None:
            log.warning("LED command dropped: MQTT publisher not wired yet")
            return
        # Compact JSON so the Arduino's substring parser stays simple.
        payload = json.dumps(
            {"on": self._led["on"], "brightness": self._led["brightness"]},
            separators=(",", ":"))
        self._mqtt.publish(SYPIALNIA_LED_CMD_TOPIC, payload,
                           qos=1, retain=True)

    def _publish_bath_enable(self):
        if self._mqtt is None:
            log.warning("enable command dropped: MQTT publisher not wired yet")
            return
        payload = json.dumps({"on": self._bath_enabled},
                             separators=(",", ":"))
        self._mqtt.publish(BATHROOM_ENABLE_CMD_TOPIC, payload,
                           qos=1, retain=True)

    def _set_bath_enable(self, value):
        self._bath_enabled = bool(value)
        log.info("Bathroom night light %s",
                 "ENABLED" if self._bath_enabled else "DISABLED")
        self._publish_bath_enable()

    def _set_led_on(self, value):
        self._led["on"] = bool(value)
        self._publish_led()

    def _set_led_brightness(self, value):
        self._led["brightness"] = int(value)
        self._publish_led()

    def update_co2(self, device, ppm, valid):
        """Called from the MQTT thread for each valid CO2 reading."""
        if not valid or ppm <= 0:
            return
        self.char_co2_level.set_value(min(int(ppm), 100000))
        self.char_co2_detected.set_value(1 if ppm > CO2_DETECT_PPM else 0)

    def _set_on(self, value):
        self._state.update(on=bool(value))
        self._effects.notify()

    def _set_brightness(self, value):
        self._state.update(brightness=int(value))
        self._effects.notify()

    def _set_hue(self, value):
        self._state.update(hue=float(value))
        self._effects.notify()

    def _set_saturation(self, value):
        self._state.update(saturation=float(value))
        self._effects.notify()


def main():
    strip = make_strip()
    state = LampState()
    effects_thread = EffectsThread(strip, state)

    driver = AccessoryDriver(port=HAP_PORT, persist_file=PERSIST_FILE)
    lamp = HexLamp(driver, state, effects_thread)
    driver.add_accessory(accessory=lamp)

    signal.signal(signal.SIGTERM, driver.signal_handler)
    signal.signal(signal.SIGINT, driver.signal_handler)

    # Single SQLite store + MQTT ingestion + LAN dashboard, sharing this
    # process. CO2Mqtt/start_dashboard are best-effort: a missing optional
    # dep disables only its own feature; the LED bridge keeps running.
    db = SensorsDB()
    co2_mqtt = CO2Mqtt(db, on_co2=lamp.update_co2)
    lamp.set_mqtt(co2_mqtt)  # LED setters publish through this client
    co2_mqtt.start()
    start_dashboard(db)

    effects_thread.start()
    try:
        driver.start()
    finally:
        co2_mqtt.stop()
        effects_thread.shutdown()
        blackout(strip)


if __name__ == "__main__":
    main()
