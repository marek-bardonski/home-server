# bathroom

M5Stack **AtomS3 Lite** (ESP32-S3) bathroom presence node. End goal: a 24 GHz
mmWave radar (S3KM1110) drives a Grove RGB LED Matrix as a very dim night
light the instant someone enters, with the presence→light loop running
entirely **on the device** for a millisecond reaction, and MQTT only mirroring
state to the `raspberry-hex` hub (Apple Home + dashboard), same pattern as
[`sypialnia`](../sypialnia/README.md).

Built in phases so each hardware addition is verified in isolation:

| Phase | Scope | Status |
|-------|-------|--------|
| 0 | Scaffold + Grove RGB LED Matrix bring-up test | done |
| 1 | S3KM1110 radar wired, on-device night-light reflex (dark amber ~10%, instant on, 5 min hold, 30 s fade-out) | done |
| **2** | MQTT mirror: hub SQLite-logs every presence edge (A) + Apple Home "Bathroom Night Light" disable switch (B) | **done** |
| 3 | Future: night-window/NTP gating, ESP32 wireless OTA (espota) | planned |

The presence→light loop is wholly on-device and **network-independent** — the
night light keeps working with Wi-Fi or the hub down. MQTT is only a mirror.

## Hardware

- **Microcontroller:** M5Stack AtomS3 Lite (ESP32-S3, no LCD; status RGB LED + side button only)
- **Power:** USB-C from a 5 V 3 A supply (also the flash port)
- **Display / night light:** Grove RGB LED Matrix w/ Driver (Seeed 104020208), I2C, default address `0x65`
- **Presence (Phase 1):** Waveshare 26536 — S3KM1110 24 GHz mmWave human micro-motion radar, 5-pin pre-soldered header, digital presence output → one spare GPIO via Dupont
- **Carrier (Phase 1):** ATOM HUB DIY Proto Board Kit (Atom-side headers pre-soldered; proto area empty)

### Wiring

**Phase 0 — zero soldering:** plug the Grove RGB LED Matrix straight into the
AtomS3 Lite Grove port with the supplied Grove cable. That's the entire wiring
for this phase.

AtomS3 Lite Grove port: **SDA = GPIO2, SCL = GPIO1**, plus 5 V / GND. If the
matrix does not appear in the sketch's I2C scan, swap `GROVE_SDA`/`GROVE_SCL`
in `bathroom.ino` or reseat the Grove cable.

**Phase 1 — radar wired (current):** AtomS3 seated on the ATOM Hub Proto;
S3KM1110 connected **by label** via Dupont to a soldered proto header:

| S3KM1110 | AtomS3 | Note |
|----------|--------|------|
| `3V3` (VCC) | **3V3** | ⚠ module is 3.0–3.6 V only — never 5 V |
| `GND` | GND | |
| `OUT` | **G5 (GPIO5)** | active-high on presence, 3.3 V logic — direct, no level shifter |
| `TX` / `RX` | — | left unconnected (digital-only path; UART is a Phase 2 option) |

The LED matrix stays in the Hub Proto's Grove port (same G1/G2 I2C bus, no
soldering). Because the radar OUT is 3.3 V, it drives G5 directly — this is why
VCC **must** be the 3V3 rail (5 V would also push 5 V logic into a non-5 V-
tolerant ESP32-S3 pin).

## Toolchain setup

Both dependencies are **already present on the current host** — no install
needed:

- **Core:** `esp32:esp32` (3.3.8). The AtomS3 is a built-in variant
  (`esp32:esp32:m5stack_atoms3`), so the separate M5Stack board package is not
  required. Fallback FQBN if a future core drops the variant:
  `esp32:esp32:esp32s3`.
- **Library:** `Seeed_RGB_Led_Matrix` (1.0.0). It provides the lowercase
  header `grove_two_rgb_led_matrix.h` and class `GroveTwoRGBLedMatrixClass`.
  Note this library has **no `begin()`** — init is `Wire.begin()` then
  `matrix.scanGroveTwoRGBLedMatrixI2CAddress()`, which also auto-selects the
  `0x65` (default) vs `0x60` (older units) address. Source:
  <https://github.com/Seeed-Studio/Seeed_RGB_LED_Matrix>.

On a fresh host: `arduino-cli core install esp32:esp32` and
`arduino-cli lib install Seeed_RGB_Led_Matrix`.

## Secrets

From Phase 2 the sketch uses Wi-Fi/MQTT and `#include "arduino_secrets.h"`,
which `update.sh` generates from the repo-root `.env` at compile time and
deletes immediately after (never committed) — exactly as for `sypialnia`.
Keys used: `SECRET_SSID`, `SECRET_PASS`, `SECRET_OTA_PASS` (ESP32 OTA),
`MQTT_HOST`, `MQTT_PORT`.

## MQTT (mirror only — the light never depends on it)

`home/<device>/<metric>`, same conventions as `sypialnia`:

| Topic | Dir | Payload | Purpose |
|-------|-----|---------|---------|
| `home/bathroom/status` | out | `online` / `offline` (retained LWT + 30 s heartbeat) | liveness / last-seen |
| `home/bathroom/ip` | out | dotted IPv4 (retained) | shown on the dashboard device panel; the OTA target address |
| `home/bathroom/presence` | out | `{"present":true\|false}` on every radar OUT edge | **(A)** hub SQLite-logs it as `readings(metric="presence")` → usage history + auto-appears on the dashboard |
| `home/bathroom/enable/set` | in | `{"on":true\|false}` **retained** | **(B)** the Apple Home **"Bathroom Night Light"** switch; `false` = matrix stays dark even on motion (presence still detected/logged) |

The retained enable command means a node reboot keeps the user's choice (the
broker replays it). Default is enabled, so the night light works out of the
box. Hub side: presence ingest is in `raspberry-hex/files/co2_mqtt.py`; the
HomeKit switch is a service on the existing HEX accessory in `hex_homekit.py`
(no re-pair — a config-number bump, same as the CO2/Bedroom-LED services).

## Deploying

```bash
./update.sh bathroom        # AtomS3 plugged in over USB-C
```

`device.conf` sets `ARDUINO_USB_MATCH=esp32:esp32` so `update.sh` finds the
ESP32-S3 on its serial port (native USB reports a generic FQBN, never the
board-specific one) — it then generates `arduino_secrets.h` from `.env`,
compiles, USB-uploads, and wipes the header. If `upload` can't sync, hold the
AtomS3 side button while it connects (or tap reset for download mode), retry.

Watch serial:

```bash
arduino-cli monitor -p /dev/cu.usbmodem1101 -c baudrate=115200   # tap reset to see boot
```

### Wireless OTA (after the first USB flash)

The firmware runs the esp32-core OTA service (`bathroom` @ `<ip>:3232`). To
deploy without the cable: read the board's IP from the dashboard device panel
(or the `MQTT connected — IP …` serial line), set it in `device.conf`:

```
ARDUINO_OTA_ADDRESS=192.168.1.NN     # the bathroom node's IP (pin a DHCP lease)
```

then with the board **unplugged from USB**, `./update.sh bathroom` compiles
and pushes over the network via the esp32 core's `espota.py` (port 3232,
`SECRET_OTA_PASS`). USB still wins when plugged in. The Renesas OTA path
(sypialnia) is untouched — `update.sh` dispatches on the FQBN `esp32:` prefix.

**Brightness is hard-capped at ~10%** (`CAP` in `bathroom.ino`) — safe on a
current-limited laptop USB port and matches the dim night-light intent. This
library only exposes brightness via `displayColorBlock`'s RGB value, so the
light is a scaled colour block. Do not raise `CAP` without the 5 V 3 A supply.

**Expected:** serial prints the I2C scan, `matrix bound @ 0x65`, `MQTT
connected`, `armed`. The matrix stays **off** until the radar asserts OUT;
each OUT edge logs `RADAR ^/v …` and is published. On presence it snaps
instantly to dim dark amber, holds 5 min (`HOLD_MS`) after the last
detection, then fades out over 30 s (`FADE_OUT_MS`; re-entry mid-fade jumps
straight back up). Toggling the Home switch off logs `ENABLE cmd: night light
DISABLED` and the matrix fades out and stays dark on motion until re-enabled
— while `RADAR ^/v` + presence publishes continue.

`MCU reaction <N>us` is the firmware's latency contribution (radar edge →
first LED write); tens-to-hundreds of µs, so the felt delay is the radar's own
~100 ms detection cycle, not us.

## Future (Phase 3)

- Night-window / NTP gating (only light at night) — currently always-on.
