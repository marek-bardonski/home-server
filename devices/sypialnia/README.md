# sypialnia

Arduino UNO R4 WiFi bedroom node. Reads the MH-Z19B CO2 sensor and publishes
it over MQTT to the central `raspberry-hex` hub (which exposes it to Apple Home
and the dashboard). Deployed **over Wi-Fi via Arduino OTA**, driven by
`../../update.sh` — OTA is this device's equivalent of the pipeline's rsync.

This firmware is a deliberately minimal slice of the reference `waku` project:
only CO2 read + MQTT publish + OTA + a HomeKit-controlled RGB LED. Alarm, dawn
light, buzzer, OLED, RTC, button, LED matrix and the old HTTP client are
intentionally omitted. The complete original wiring is preserved below so the
unused peripherals can be brought back later without re-deriving the pinout.

## Hardware

- **Microcontroller:** Arduino UNO R4 WiFi (Renesas RA4M1)
- **Power:** USB-C (also used for the one-time initial flash)
- **Sensors:** MH-Z19B CO2 sensor (PWM output), MAX9814 microphone (unused)
- **Display:** OLED 0.91" (unused by this firmware)
- **Enclosure:** Wooden box (15x15x5 cm)

### Arduino pin connections (preserved verbatim from the original `waku`)

- **5V** → Breadboard 5V bus
- **GND** → Breadboard GND bus
- **PIN 2 (ADC)** → MH-Z19B CO2 sensor PWM output
- **PIN 3 (DIGITAL)** → Button → GND (Requires PULL-UP)
  - **Note:** Setting this pin as output may destroy the chip unless connected via a resistor.
- **PIN 9 (PWM)** → Resistor → LED #1 → 2N2222 base
- **PIN 10 (PWM)** → Resistor → LED #2 → 2N2222 base
- **PIN 11 (PWM)** → Resistor → LED #3 → 2N2222 base
- **PIN 12 (PWM)** → Buzzer -> 330 OHM -> GND
- **PIN 6 (PWM)** → Buzzer -> GND
- **PIN A0 (ADC)** → MAX9814 microphone out
- **SDA/SCL** → OLED 0.91"

This firmware only uses **PIN 2** (CO2) and **PINS 9/10/11** (the outward-facing
RGB LED, driven as a white dimmable HomeKit lamp).

## MQTT topics

Sensor data flows node → hub; the LED command flows hub → node:

| Topic | Dir | Payload |
|-------|-----|---------|
| `home/sypialnia/co2`     | out | `{"ppm":<int>,"valid":<bool>}` |
| `home/sypialnia/ip`      | out | dotted IPv4 (retained) — shown on the hub dashboard device panel |
| `home/sypialnia/status`  | out | `online` / `offline` (MQTT last-will) |
| `home/sypialnia/led/set` | in  | `{"on":<bool>,"brightness":0..100}`, **retained** |

The LED command is published **retained** by the raspberry-hex HomeKit bridge,
so the broker replays the last on/off + brightness to the node every time it
(re)connects — the physical LED survives a node reboot without HomeKit
re-issuing the command.

## Required libraries

Installable via the Arduino IDE Library Manager or `arduino-cli lib install`:

- `ArduinoOTA`
- `ArduinoMqttClient`

`WiFiS3` is bundled with the `arduino:renesas_uno` core.

## Secrets

There is no committed `arduino_secrets.h`. `update.sh` generates it from the
repo-root `.env` at compile time and **deletes it immediately after the
compile**, so no credentials ever persist on disk or in git. The `.env` keys
this device needs:

```
SECRET_SSID=...        # Wi-Fi SSID
SECRET_PASS=...        # Wi-Fi password
SECRET_OTA_PASS=...    # ArduinoOTA password (default in waku was "password")
MQTT_HOST=...          # broker host (raspberry.local)
MQTT_PORT=1883
```

## Deploying

```bash
./update.sh sypialnia
```

`device.conf` selects Arduino mode:

```
ARDUINO_FQBN=arduino:renesas_uno:unor4wifi
ARDUINO_OTA_ADDRESS=sypialnia.local   # or the board IP
ARDUINO_SKETCH=sypialnia
```

`update.sh` then: sources `.env` → writes `arduino_secrets.h` → `arduino-cli
compile` → uploads → deletes `arduino_secrets.h` (also on failure, via a trap).

### No manual first flash

The same `./update.sh sypialnia` handles both the initial flash and every
later deploy:

- **Board plugged in via USB** → `update.sh` finds it by matching the FQBN on a
  serial port (`arduino-cli board list`) and flashes over the cable.
- **Board not plugged in** → flashes over Wi-Fi (OTA) to `ARDUINO_OTA_ADDRESS`.

USB always wins when both are available, so the very first flash is just: plug
the board in, run `./update.sh sypialnia`. After that, unplug it and the same
command deploys wirelessly. If `sypialnia.local` does not resolve for the
wireless path, run `arduino-cli board list` (it lists network ports too) and
set `ARDUINO_OTA_ADDRESS` in `device.conf` to the board's IP.

## OTA caveats (Apple-Silicon Mac host — applied, working)

The ArduinoOTA toolchain is finicky. What actually makes wireless OTA work
from an Apple-Silicon (arm64) Mac — all of this is **already applied** on the
current host; reproduce it on any new host:

1. **Native arm64 uploader.** The old lore that "there is no native macOS
   release, so use a Linux/Windows VM" is **outdated**: `arduinoOTA` 1.4.1
   ships `arduinoOTA_1.4.1_macOS_ARM64.tar.gz`. The segfault happened only
   because the renesas core bundles the **Intel** `arduinoOTA` (it ran under
   Rosetta and crashed). Fix — replace the bundled binary with the native
   arm64 one (it also has the `-t` flag, so this covers the old caveat #2):

   ```bash
   DEST=~/Library/Arduino15/packages/arduino/tools/arduinoOTA/1.3.0/bin/arduinoOTA
   curl -fsSL https://github.com/arduino/arduinoOTA/releases/download/1.4.1/arduinoOTA_1.4.1_macOS_ARM64.tar.gz | tar xz
   cp "$DEST" "$DEST.x86_64.bak"            # keep the original
   cp arduinoOTA_osx_darwin_arm64/arduinoOTA "$DEST"
   chmod +x "$DEST"; xattr -d com.apple.quarantine "$DEST" 2>/dev/null || true
   file "$DEST"   # must say: Mach-O 64-bit executable arm64
   ```

2. **`-t 60` timeout patch.** `platform.local.txt` (from
   <https://github.com/JAndrassy/ArduinoOTA/tree/master/extras/renesas>) sits
   next to `platform.txt` in the renesas core
   (`~/Library/Arduino15/packages/arduino/hardware/renesas_uno/1.5.3/`) with
   ` -t 60` appended to all 4 upload patterns, e.g.:

   ```
   tools.arduino_ota.upload.pattern="{cmd}" -address "{upload.port.address}" -port 65280 -username arduino -password "{upload.field.password}" -sketch "{build.path}/{build.project_name}.bin" -upload /sketch -b -t 60
   ```

3. **Address, not name.** The board advertises its `_arduino._tcp` mDNS
   service (so `arduino-cli board list` finds it) but `sypialnia.local` does
   **not** resolve via the OS mDNS resolver on this LAN. So
   `ARDUINO_OTA_ADDRESS` in `device.conf` is the **IP**, not the hostname —
   pin it with a router DHCP reservation and re-check with
   `arduino-cli board list` if it ever changes.

If OTA still fails, confirm: the board is powered and on Wi-Fi (HomeKit/CO2
working proves this), host and board on the same network, firewall not
blocking UDP/mDNS + TCP 65280, and the installed `arduinoOTA` is arm64
(`file` check above). The Arduino IDE network port remains the manual
fallback (Tools → Port → Network Ports → pick the board → upload normally).
