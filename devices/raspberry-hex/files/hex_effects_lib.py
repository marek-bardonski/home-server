"""Effect functions and helpers shared by hex_effects.py and hex_homekit.py.

Effects take (strip, stop_event, brightness_scale):
    - stop_event: a threading.Event; effects MUST use stop_event.wait(t) instead
      of time.sleep(t) and check stop_event.is_set() in outer loops so that
      cancellation is sub-100 ms.
    - brightness_scale: float in [0.0, 1.0], already including POWER_CAP.
      Every per-pixel RGB must be passed through scale_rgb() before Color().
"""
import random
import time

from rpi_ws281x import Color, PixelStrip

LED_COUNT = 37
LED_PIN = 18
LED_FREQ_HZ = 800000
LED_DMA = 10
LED_BRIGHTNESS = 80
LED_INVERT = False
LED_CHANNEL = 0

EFFECT_DURATION = 60.0

# Hard power cap for the 5V/3A USB charger:
# 0.85 * 2.2A worst-case LEDs + ~0.4A Pi peak ~= 2.27A, fits within 3A.
POWER_CAP = 0.85


def make_strip():
    strip = PixelStrip(LED_COUNT, LED_PIN, LED_FREQ_HZ, LED_DMA,
                       LED_INVERT, LED_BRIGHTNESS, LED_CHANNEL)
    strip.begin()
    return strip


def wheel(pos):
    pos = pos & 255
    if pos < 85:
        return (pos * 3, 255 - pos * 3, 0)
    if pos < 170:
        pos -= 85
        return (255 - pos * 3, 0, pos * 3)
    pos -= 170
    return (0, pos * 3, 255 - pos * 3)


def scale_rgb(r, g, b, scale):
    s = max(0.0, min(1.0, scale))
    return int(r * s), int(g * s), int(b * s)


def fill(strip, color):
    for i in range(strip.numPixels()):
        strip.setPixelColor(i, color)
    strip.show()


def blackout(strip):
    for i in range(strip.numPixels()):
        strip.setPixelColor(i, Color(0, 0, 0))
    strip.show()


def _deadline():
    return time.monotonic() + EFFECT_DURATION


# --- effects ---------------------------------------------------------------

def effect_solid_cycle(strip, stop_event, brightness_scale):
    palette = [
        (255, 0, 0), (0, 255, 0), (0, 0, 255),
        (255, 255, 0), (0, 255, 255), (255, 0, 255),
        (255, 255, 255),
    ]
    end = _deadline()
    i = 0
    while time.monotonic() < end and not stop_event.is_set():
        r, g, b = scale_rgb(*palette[i % len(palette)], brightness_scale)
        fill(strip, Color(r, g, b))
        i += 1
        if stop_event.wait(2.0):
            return


def effect_color_wipe(strip, stop_event, brightness_scale):
    palette = [(255, 0, 0), (0, 255, 0), (0, 0, 255)]
    end = _deadline()
    while time.monotonic() < end and not stop_event.is_set():
        for color in palette:
            r, g, b = scale_rgb(*color, brightness_scale)
            c = Color(r, g, b)
            for i in range(strip.numPixels()):
                if time.monotonic() >= end or stop_event.is_set():
                    return
                strip.setPixelColor(i, c)
                strip.show()
                if stop_event.wait(0.05):
                    return


def effect_theater_chase(strip, stop_event, brightness_scale):
    end = _deadline()
    r, g, b = scale_rgb(127, 127, 127, brightness_scale)
    color = Color(r, g, b)
    n = strip.numPixels()
    while time.monotonic() < end and not stop_event.is_set():
        for q in range(3):
            for i in range(0, n - q, 3):
                strip.setPixelColor(i + q, color)
            strip.show()
            if stop_event.wait(0.1):
                return
            for i in range(0, n - q, 3):
                strip.setPixelColor(i + q, 0)


def effect_rainbow(strip, stop_event, brightness_scale):
    end = _deadline()
    j = 0
    n = strip.numPixels()
    while time.monotonic() < end and not stop_event.is_set():
        for i in range(n):
            r, g, b = scale_rgb(*wheel((i + j) & 255), brightness_scale)
            strip.setPixelColor(i, Color(r, g, b))
        strip.show()
        if stop_event.wait(0.02):
            return
        j += 1


def effect_rainbow_cycle(strip, stop_event, brightness_scale):
    end = _deadline()
    j = 0
    n = strip.numPixels()
    while time.monotonic() < end and not stop_event.is_set():
        for i in range(n):
            r, g, b = scale_rgb(*wheel((int(i * 256 / n) + j) & 255),
                                brightness_scale)
            strip.setPixelColor(i, Color(r, g, b))
        strip.show()
        if stop_event.wait(0.02):
            return
        j += 1


def effect_theater_chase_rainbow(strip, stop_event, brightness_scale):
    end = _deadline()
    j = 0
    n = strip.numPixels()
    while time.monotonic() < end and not stop_event.is_set():
        for q in range(3):
            for i in range(0, n - q, 3):
                r, g, b = scale_rgb(*wheel((i + j) & 255), brightness_scale)
                strip.setPixelColor(i + q, Color(r, g, b))
            strip.show()
            if stop_event.wait(0.1):
                return
            for i in range(0, n - q, 3):
                strip.setPixelColor(i + q, 0)
        j = (j + 1) & 255


def effect_pulse(strip, stop_event, brightness_scale):
    """Brightness-modulated solid color whose hue drifts each pulse."""
    end = _deadline()
    period_steps = 90  # ~3s per full breath at 30ms/step
    t = 0
    while time.monotonic() < end and not stop_event.is_set():
        phase = (t % period_steps) / period_steps
        bright = 1.0 - abs(phase * 2.0 - 1.0)
        hue = (t // period_steps) * 23
        r0, g0, b0 = wheel(hue & 255)
        r, g, b = scale_rgb(int(r0 * bright), int(g0 * bright),
                            int(b0 * bright), brightness_scale)
        fill(strip, Color(r, g, b))
        if stop_event.wait(0.03):
            return
        t += 1


def effect_sparkle(strip, stop_event, brightness_scale):
    end = _deadline()
    n = strip.numPixels()
    # keep a soft buffer so sparkles fade rather than blink
    buf = [(0, 0, 0)] * n
    while time.monotonic() < end and not stop_event.is_set():
        for _ in range(2):
            idx = random.randrange(n)
            buf[idx] = wheel(random.randint(0, 255))
        for i in range(n):
            r, g, b = buf[i]
            buf[i] = (max(0, r - 12), max(0, g - 12), max(0, b - 12))
            sr, sg, sb = scale_rgb(*buf[i], brightness_scale)
            strip.setPixelColor(i, Color(sr, sg, sb))
        strip.show()
        if stop_event.wait(0.04):
            return


EFFECTS = [
    ("solid_cycle", effect_solid_cycle),
    ("color_wipe", effect_color_wipe),
    ("theater_chase", effect_theater_chase),
    ("rainbow", effect_rainbow),
    ("rainbow_cycle", effect_rainbow_cycle),
    ("theater_chase_rainbow", effect_theater_chase_rainbow),
    ("pulse", effect_pulse),
    ("sparkle", effect_sparkle),
]


def run_effects_forever(strip, stop_event, brightness_provider):
    """Cycle EFFECTS until stop_event is set.

    brightness_provider() -> float in [0, 1] (already power-capped) is called
    once per effect entry so brightness changes apply at effect boundaries.
    """
    i = 0
    while not stop_event.is_set():
        name, fn = EFFECTS[i % len(EFFECTS)]
        scale = brightness_provider()
        print(f"[{time.strftime('%H:%M:%S')}] effect: {name} "
              f"(scale={scale:.2f})", flush=True)
        fn(strip, stop_event, scale)
        i += 1
