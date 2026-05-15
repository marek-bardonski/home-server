#!/bin/sh
# provision.sh — one-time, non-interactive provisioning for raspberry-hex.
#
# Run from the host (the machine that runs update.sh), NOT on the Pi:
#
#     ./devices/raspberry-hex/provision.sh [user@host]
#
# Default target is admin@raspberry.local. It installs Mosquitto, opens it to
# the LAN, adds paho-mqtt/flask to the existing hexled venv, and installs the
# sudoers drop-in update.sh needs (including the /etc/home-server.env install).
#
# This file lives outside files/, so update.sh never rsyncs it to the device.
#
# Everything privileged runs via `sudo -S`. You are asked for the Pi sudo
# password once locally (leave empty if sudo is already NOPASSWD). The password
# is sent as the first stdin line of a single ssh call and exported on the
# remote — it never touches a command line, a file, or shell history. Set
# SUDO_PASS in the environment to skip the prompt. Re-running is safe.

set -eu

TARGET="${1:-admin@raspberry.local}"

if [ -n "${SUDO_PASS:-}" ]; then
    pass="$SUDO_PASS"
else
    printf 'sudo password for %s (empty if NOPASSWD): ' "$TARGET" >&2
    stty -echo 2>/dev/null || true
    IFS= read -r pass || true
    stty echo 2>/dev/null || true
    printf '\n' >&2
fi

echo "Provisioning $TARGET ..." >&2

{
    printf '%s\n' "$pass"
    cat <<'REMOTE'
set -eu
export DEBIAN_FRONTEND=noninteractive
# Run a privileged command, feeding the sudo password on its own pipe so the
# main script's stdin (this remote script) is untouched.
S() { echo "$SUDO_PASS" | sudo -S -p '' "$@"; }

VENV_PIP=/home/admin/hexled/venv/bin/pip
[ -x "$VENV_PIP" ] || { echo "ERROR: $VENV_PIP missing (hexled venv not bootstrapped?)" >&2; exit 1; }

echo "==> apt: mosquitto"
S apt-get update
S apt-get install -y mosquitto mosquitto-clients
S systemctl enable --now mosquitto

echo "==> mosquitto LAN listener"
cat > /tmp/lan.conf <<'CONF'
listener 1883 0.0.0.0
allow_anonymous true
CONF
S install -m 644 -o root -g root /tmp/lan.conf /etc/mosquitto/conf.d/lan.conf
rm -f /tmp/lan.conf
S systemctl restart mosquitto

echo "==> venv: paho-mqtt flask"
TMPDIR=/dev/shm "$VENV_PIP" install paho-mqtt flask

echo "==> sudoers drop-in"
cat > /tmp/hexled.sudoers <<'SUD'
admin ALL=(ALL) NOPASSWD: /bin/systemctl stop hexled.service, /bin/systemctl start hexled.service, /bin/systemctl restart hexled.service, /bin/systemctl enable hexled.service, /bin/systemctl disable hexled.service, /bin/systemctl daemon-reload, /usr/bin/install -m 644 -o root -g root /home/admin/hexled/hexled.service /etc/systemd/system/hexled.service, /usr/bin/install -m 600 -o root -g root /dev/stdin /etc/home-server.env
SUD
S visudo -cf /tmp/hexled.sudoers
S install -m 440 -o root -g root /tmp/hexled.sudoers /etc/sudoers.d/hexled
rm -f /tmp/hexled.sudoers
S visudo -c

echo "PROVISION OK"
REMOTE
} | ssh "$TARGET" 'IFS= read -r SUDO_PASS; export SUDO_PASS; bash -s'

echo "Done. Now deploy: ./update.sh raspberry-hex" >&2
