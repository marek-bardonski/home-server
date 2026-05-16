# home-server

Configuration and code deployment for the various home devices on my LAN — Raspberry Pis and other small servers — managed from a single repo.

## Home device management

Each device lives in its own subdirectory under `devices/`. A device folder has:

- `device.conf` — shell-sourced config defining the SSH target and execution parameters:
  - `SSH_TARGET` — `user@host` for `ssh` / `rsync`
  - `REMOTE_DIR` — where on the device to sync files
  - `VENV_PYTHON` — absolute path to the Python interpreter to invoke
  - `ENTRYPOINT` — script (relative to `REMOTE_DIR`) to run after sync
  - `RUN_AS_ROOT` — `true` to prefix the run command with `sudo`
  - `SCREEN_NAME` — optional; if set, the entrypoint runs inside a detached `screen` session of this name. On each update the previous session is killed before rsync and a fresh one is started afterward. Requires `screen` and (when combined with `RUN_AS_ROOT=true`) passwordless sudo on the device. Mutually exclusive with `SYSTEMD_UNIT`.
  - `SYSTEMD_UNIT` — optional; if set, names a systemd unit file (e.g. `hexled.service`) present in `files/`. On each deploy `update.sh` stops the unit, rsyncs, then `install`s the unit to `/etc/systemd/system/`, runs `daemon-reload`, `enable`, and `restart`. Requires NOPASSWD sudo for `systemctl stop|start|restart|enable|disable|daemon-reload` and the matching `install` command. Mutually exclusive with `SCREEN_NAME`. When set, `ENTRYPOINT` becomes documentary (it must match the unit's `ExecStart` but is not invoked by `update.sh`). If `MQTT_HOST` is set in `.env`, `update.sh` also installs a root-only `/etc/home-server.env` (from `.env`) over ssh for the unit to read via `EnvironmentFile=`; this needs a NOPASSWD entry for `install -m 600 -o root -g root /dev/stdin /etc/home-server.env`.
  - `ARDUINO_FQBN` / `ARDUINO_OTA_ADDRESS` / `ARDUINO_SKETCH` — optional; selects **Arduino mode** for microcontroller firmware (no SSH/rsync/systemd). `update.sh` generates `arduino_secrets.h` from `.env`, runs `arduino-cli compile`, then uploads — **automatically over USB if the board is plugged in, otherwise over Wi-Fi (OTA)** to `ARDUINO_OTA_ADDRESS` — and deletes the generated header (also on failure/Ctrl-C). USB is detected by matching `ARDUINO_FQBN` on a serial port in `arduino-cli board list`, so the same `./update.sh <device>` handles both the initial wired flash and all later wireless deploys with no manual steps. The OTA upload tool is chosen by the FQBN vendor: Renesas (`arduino:`) uses the bundled `arduinoOTA` on :65280; ESP32 (`esp32:`) uses the esp32 core's `espota.py` on :3232. `ARDUINO_SKETCH` is the sketch directory under `files/`. Mutually exclusive with `SCREEN_NAME`/`SYSTEMD_UNIT`. Requires `arduino-cli` on the host.
  - `ARDUINO_USB_MATCH` — optional; a looser substring used **only** to find the board's serial port in `arduino-cli board list` (defaults to `ARDUINO_FQBN`). ESP32-S3 native USB reports a generic FQBN (e.g. `esp32:esp32:esp32_family`), never the board-specific one, so such devices set e.g. `ARDUINO_USB_MATCH=esp32:esp32`; compile/upload still use the exact `ARDUINO_FQBN`. Existing devices that omit it are unaffected.
- `files/` — payload that gets `rsync`ed to `REMOTE_DIR` (or, in Arduino-OTA mode, the sketch tree compiled and flashed over Wi-Fi)
- `README.md` — device-specific notes (hardware, wiring, setup, roadmap)

Secrets are centralized in a single git-ignored `.env` at the repo root (shell
`KEY=VALUE`; quote values containing spaces). `update.sh` sources it and feeds
it to both deploy paths — Arduino compile-time `#define`s and the Pi
`EnvironmentFile`. Nothing secret is committed and the generated
`arduino_secrets.h` never persists. Keys: `SECRET_SSID`, `SECRET_PASS`,
`SECRET_OTA_PASS`, `MQTT_HOST`, `MQTT_PORT`, `DASHBOARD_PORT`.

### Adding a new device

1. Copy an existing device folder, e.g. `cp -r devices/raspberry-hex devices/<new-name>`.
2. Edit `device.conf` for the new SSH target, paths, and entrypoint.
3. Replace the contents of `files/` with the code that should run on the device.
4. Update the device's `README.md` with hardware/wiring/setup notes.
5. Add a row for it in the [Current devices](#current-devices) table below.

### Running updates

`update.sh` is the single entry point.

```bash
./update.sh                  # update every device under devices/
./update.sh raspberry-hex    # update one or more specific devices by folder name
./update.sh dev-a dev-b
```

For each device it sources `device.conf`, rsyncs `files/` to `REMOTE_DIR`, then runs the entrypoint over SSH (with `sudo` if `RUN_AS_ROOT=true`). Failures on one device do not stop the others; the script exits non-zero if any device failed.

### Current devices

| Name | Hardware | Purpose | Docs |
|------|----------|---------|------|
| raspberry-hex | Raspberry Pi Zero WH | M5Stack HEX night light (GPIO 18) **and** the central CO2 hub: MQTT broker, HomeKit CO2 sensor, time-series dashboard, single SQLite store | [README](devices/raspberry-hex/README.md) |
| sypialnia | Arduino UNO R4 WiFi | Read the MH-Z19B CO2 sensor and publish it over MQTT; deployed over Wi-Fi via Arduino OTA | [README](devices/sypialnia/README.md) |
| bathroom | M5Stack AtomS3 Lite (ESP32-S3) | mmWave (S3KM1110) presence → on-device dim night light on a Grove RGB LED Matrix. MQTT mirror: hub SQLite-logs presence, Apple Home disable switch, IP + heartbeat on the dashboard; ESP32 OTA | [README](devices/bathroom/README.md) |

### Future work

- manage cron entries
- run pre-deploy lint
- support per-device `pre_update.sh` and `post_update.sh` hooks
- generic per-device `.deployignore` to consolidate rsync excludes (currently `venv/`, `.venv/`, `hex_state.json`, and `home.db*` are hardcoded in `update.sh`)

Prospective devices:

* kuchnia (arduino uno Q 2GB, medicines counter)
* komputer (arduino uno R3 CH 340)
* gabinet (STM32L Discovery)