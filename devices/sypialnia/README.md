# sypialnia

Arduino UNO R4 WiFi bedroom node. Reads the MH-Z19B CO2 sensor and publishes
it over MQTT to the central `raspberry-hex` hub (which exposes it to Apple Home
and the dashboard). Deployed **over Wi-Fi via Arduino OTA**, driven by
`../../update.sh` — OTA is this device's equivalent of the pipeline's rsync.

This firmware is a deliberately minimal slice of the reference `waku` project:
only CO2 read + MQTT publish + OTA + a temporary "alive" LED. Alarm, dawn
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
RGB LED, currently driving a temporary colorful heartbeat to show the box is
alive — see the fenced block in `files/sypialnia/sypialnia.ino`).

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

## OTA caveats (preserved from the original `waku`, still apply)

The ArduinoOTA library is finicky. Lessons carried over verbatim:

1. The ArduinoOTA binary does not work on Apple-Silicon Macs — there is no
   native release, the Intel build is used by default even on Apple Silicon,
   and that causes a hard-to-diagnose segmentation fault. Rosetta 2 did not
   help. A Linux/Windows VM (e.g. VMware) works for both wired flashing and
   wireless OTA; use proper electrical isolation or a backup device because of
   the (low) risk of shorting the USB-C port.
2. Download the latest `arduinoOTA` release binary from
   <https://github.com/arduino/arduinoOTA/releases> (1.4.1 was used) and
   replace the one shipped by the Arduino tooling — the shipped one lacks the
   `-t` (timeout) flag.
3. The board needs `platform.local.txt` from
   <https://github.com/JAndrassy/ArduinoOTA/tree/master/extras/renesas> placed
   next to `platform.txt` in the renesas core directory, with `-t 60` appended
   to all 4 upload patterns, e.g.:

   ```
   tools.arduino_ota.upload.pattern="{cmd}" -address "{upload.port.address}" -port 65280 -username arduino -password "{upload.field.password}" -sketch "{build.path}/{build.project_name}.bin" -upload /sketch -b -t 60
   ```

If OTA upload fails, confirm: the board is powered and on Wi-Fi, host and board
are on the same network, the firewall is not blocking, and the 60-second
timeout is configured. The Arduino IDE network port is the manual fallback
(Tools → Port → Network Ports → pick the board → upload normally).
