# raspberry-hex

Raspberry Pi Zero WH driving an M5Stack HEX (37 SK6812 RGB LEDs) over GPIO 18.

## Hardware

- **Board**: Raspberry Pi Zero WH (ARMv6, 512 MB RAM, single-core 1 GHz)
- **Display**: M5Stack HEX, 37 addressable SK6812 RGB LEDs in a hexagonal layout, single-wire data protocol (NeoPixel-compatible)
- **Power**: 5 V / 3 A USB charger (15 W total)
- **Connector**: HEX uses a 4-pin Grove HY2.0 cable; only 3 wires are used (5V, GND, DATA)

## Wiring

| HEX wire | Pi pin (physical) | Pi GPIO (BCM) |
|----------|-------------------|---------------|
| Red (5V) | 2 or 4            | 5V rail       |
| Black (GND) | 6              | GND           |
| White (DATA) | 12            | GPIO 18       |
| Yellow   | unused            | -             |

GPIO 18 is required because `rpi_ws281x` uses PWM on this pin to generate WS2812/SK6812 timing.

## Power budget

- Charger total: 15 W (5 V x 3 A)
- Safe working budget: ~12 W (80% of rated)
- Pi Zero WH draw: ~1.5 W average, ~2 W peak
- LED budget after Pi: ~10 W safe, ~13 W absolute max
- 37 SK6812 LEDs at full white: ~2.2 A (worst case, almost never hit in real animations)
- Typical colorful animation: ~1.5 W for the panel

The HomeKit bridge enforces a hard `POWER_CAP = 0.85` (in `hex_effects_lib.py`); brightness slider × 0.85 is the maximum that ever reaches the LEDs. Worst case at full brightness in effects mode: 0.85 × 2.2 A ≈ 1.87 A LEDs + ~0.4 A Pi peak ≈ 2.27 A total, ~0.7 A margin within 3 A. Watch for the lightning bolt icon or `vcgencmd get_throttled` returning anything other than `0x0`; that indicates undervoltage and `POWER_CAP` should be lowered.

## Pi-side setup (already done, documented for reference)

OS: Raspberry Pi OS Bookworm, Python 3.13.

One-time host configuration:

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y python3-pip python3-venv git
# Disable onboard audio to free up PWM for LED timing:
sudo nano /boot/firmware/config.txt   # set dtparam=audio=off
sudo reboot
```

Project setup:

```bash
mkdir ~/hexled && cd ~/hexled
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
# zeroconf is pinned because piwheels has not built the latest version
# for armv6l + cp313 yet; this avoids a long source compile on the Pi Zero.
TMPDIR=/dev/shm pip install --only-binary=:all: \
    "zeroconf<0.140" "HAP-python[QRCode]" \
    rpi_ws281x adafruit-circuitpython-neopixel
sudo apt install -y screen
```

`TMPDIR=/dev/shm` keeps pip's build directory in RAM, reducing SD card wear and slightly speeding things up.

Passwordless sudo is required so `update.sh` can stop the service, install the unit, reload systemd, and restart non-interactively. Add a sudoers drop-in for the `admin` user:

```bash
sudo tee /etc/sudoers.d/hexled > /dev/null <<'EOF'
admin ALL=(ALL) NOPASSWD: /bin/systemctl stop hexled.service, /bin/systemctl start hexled.service, /bin/systemctl restart hexled.service, /bin/systemctl enable hexled.service, /bin/systemctl disable hexled.service, /bin/systemctl daemon-reload, /usr/bin/install -m 644 -o root -g root /home/admin/hexled/hexled.service /etc/systemd/system/hexled.service
EOF
sudo chmod 440 /etc/sudoers.d/hexled
```

## Running the HomeKit bridge

The deployed entrypoint is `hex_homekit.py`, run as a systemd service named `hexled.service`. The service runs as root because `rpi_ws281x` needs PWM access.

`update.sh` (with `SYSTEMD_UNIT=hexled.service` in `device.conf`):

```text
1. ssh admin@raspberry.local 'sudo systemctl stop hexled.service'   # stop running bridge
2. rsync files/ -> remote (excludes hex_state.json so pairing survives)
3. ssh admin@raspberry.local 'sudo install -m 644 ... hexled.service /etc/systemd/system/'
4. ssh admin@raspberry.local 'sudo systemctl daemon-reload && enable && restart'
```

### Lamp UX

The saturation slider is repurposed as a **mode selector**:

| Saturation | Mode | Hue behavior |
|------------|------|--------------|
| 0–32%      | Plain yellow lamp | Tints +/-20° around hue 60° |
| 33–66%     | Plain red lamp    | Tints +/-20° around hue 0°  |
| 67–100%    | Effects (auto-cycle all 8) | Ignored |

Brightness scales linearly in all modes, hard-capped at 85% by `POWER_CAP`. Effects cycle: `solid_cycle → color_wipe → theater_chase → rainbow → rainbow_cycle → theater_chase_rainbow → pulse → sparkle`, ~60 s each.

### First-time pairing

```bash
ssh admin@raspberry.local 'sudo journalctl -u hexled -b | head -n 80'
```

Look for the setup payload / `X-HM://...` URI / ASCII QR. Open Apple Home → Add Accessory → scan QR or enter the 8-digit PIN. Pairing state lives in `/home/admin/hexled/hex_state.json` and survives both deploys (excluded from rsync) and reboots.

First pair on a Pi Zero takes 30–90 s due to slow ARMv6 crypto.

### Live logs

```bash
ssh admin@raspberry.local 'sudo journalctl -u hexled -f'
```

### Manual effects mode (diagnostics)

`hex_effects.py` is still runnable directly when the bridge is stopped:

```bash
ssh admin@raspberry.local
sudo systemctl stop hexled
sudo /home/admin/hexled/venv/bin/python /home/admin/hexled/hex_effects.py   # Ctrl-C to exit
sudo systemctl start hexled
```

### One-time migration (only needed once, before first SYSTEMD_UNIT deploy)

If a screen-based session from before the migration is still holding PWM, kill it first:

```bash
ssh admin@raspberry.local 'sudo screen -S hexled -X quit || true'
```

## Roadmap

- Named animation effects exposed as HomeKit modes (e.g., separate Switch accessories per effect)
