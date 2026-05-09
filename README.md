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
  - `SYSTEMD_UNIT` — optional; if set, names a systemd unit file (e.g. `hexled.service`) present in `files/`. On each deploy `update.sh` stops the unit, rsyncs, then `install`s the unit to `/etc/systemd/system/`, runs `daemon-reload`, `enable`, and `restart`. Requires NOPASSWD sudo for `systemctl stop|start|restart|enable|disable|daemon-reload` and the matching `install` command. Mutually exclusive with `SCREEN_NAME`. When set, `ENTRYPOINT` becomes documentary (it must match the unit's `ExecStart` but is not invoked by `update.sh`).
- `files/` — payload that gets `rsync`ed to `REMOTE_DIR` on the device
- `README.md` — device-specific notes (hardware, wiring, setup, roadmap)

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
| raspberry-hex | Raspberry Pi Zero WH | Drive an M5Stack HEX (37 SK6812 RGB LEDs) over GPIO 18 | [README](devices/raspberry-hex/README.md) |

### Future work

- manage cron entries
- run pre-deploy lint
- support per-device `pre_update.sh` and `post_update.sh` hooks
- support pulling secrets from a separate ignored file
- generic per-device `.deployignore` to consolidate rsync excludes (currently `venv/`, `.venv/`, and `hex_state.json` are hardcoded in `update.sh`)

Prospective devices:

raspberry-hex (central server, near router, also night light)