"""Manual effect runner for the M5Stack HEX (37 SK6812 LEDs).

Cycles all effects from hex_effects_lib forever. Designed for hardware
diagnostics and as a standalone fallback when the HomeKit bridge is stopped.
SIGTERM/SIGHUP (sent by `screen -X quit`) trigger a clean blackout.

In production the deployed entrypoint is hex_homekit.py; this script is no
longer launched by update.sh.
"""
import signal
import threading

from hex_effects_lib import POWER_CAP, blackout, make_strip, run_effects_forever


def main():
    stop_event = threading.Event()

    def _stop(_signum, _frame):
        stop_event.set()

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGHUP, _stop)
    signal.signal(signal.SIGINT, _stop)

    strip = make_strip()
    try:
        run_effects_forever(strip, stop_event, brightness_provider=lambda: POWER_CAP)
    finally:
        blackout(strip)


if __name__ == "__main__":
    main()
