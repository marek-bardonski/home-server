#!/bin/sh
# update.sh — single entry point for deploying and running code on home devices.
# POSIX sh; works under both `./update.sh` and `sh update.sh`.
#
# Future work:
#   - install systemd unit on remote
#   - manage cron entries
#   - run pre-deploy lint
#   - support per-device pre_update.sh and post_update.sh hooks
#   - support pulling secrets from a separate ignored file

set -eu
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEVICES_DIR="$ROOT_DIR/devices"

list_all_devices() {
    for d in "$DEVICES_DIR"/*/; do
        [ -d "$d" ] || continue
        [ -f "$d/device.conf" ] || continue
        basename "$d"
    done
}

update_device() {
    name="$1"
    dir="$DEVICES_DIR/$name"
    conf="$dir/device.conf"

    echo
    echo "================================================================"
    echo "  Device: $name"
    echo "================================================================"

    if [ ! -f "$conf" ]; then
        echo "  ERROR: $conf not found" >&2
        return 1
    fi
    if [ ! -d "$dir/files" ]; then
        echo "  ERROR: $dir/files/ not found" >&2
        return 1
    fi

    SSH_TARGET=""; REMOTE_DIR=""; VENV_PYTHON=""; ENTRYPOINT=""; RUN_AS_ROOT="false"; SCREEN_NAME=""; SYSTEMD_UNIT=""
    # shellcheck disable=SC1090
    . "$conf"

    if [ -n "$SCREEN_NAME" ] && [ -n "$SYSTEMD_UNIT" ]; then
        echo "  ERROR: SCREEN_NAME and SYSTEMD_UNIT are mutually exclusive" >&2
        return 1
    fi

    echo "  Target:    $SSH_TARGET"
    echo "  RemoteDir: $REMOTE_DIR"
    echo "  Entry:     $ENTRYPOINT (root=$RUN_AS_ROOT, screen=${SCREEN_NAME:-no}, systemd=${SYSTEMD_UNIT:-no})"

    sudo_prefix=""
    [ "$RUN_AS_ROOT" = "true" ] && sudo_prefix="sudo "

    # Pre-stop the running process BEFORE rsyncing, so we don't replace files
    # under a live interpreter. Both stop paths swallow the "not running" case.
    if [ -n "$SCREEN_NAME" ]; then
        echo "  -> kill screen '$SCREEN_NAME' on remote"
        ssh -t "$SSH_TARGET" "${sudo_prefix}screen -S $SCREEN_NAME -X quit 2>/dev/null || true"
    elif [ -n "$SYSTEMD_UNIT" ]; then
        echo "  -> systemctl stop $SYSTEMD_UNIT"
        ssh -t "$SSH_TARGET" "sudo systemctl stop $SYSTEMD_UNIT 2>/dev/null || true"
    fi

    echo "  -> rsync $dir/files/ -> $SSH_TARGET:$REMOTE_DIR/"
    # Excludes protect remote-only state from --delete. venv/.venv hold the
    # Python virtualenv, bootstrapped once per device (see device README);
    # without these excludes, --delete wipes the venv on every deploy.
    # hex_state.json holds the HomeKit pairing keys for raspberry-hex; wiping
    # it forces re-pairing from the iPhone on every deploy.
    rsync -az --delete \
        --exclude='venv/' --exclude='.venv/' \
        --exclude='hex_state.json' \
        -e ssh "$dir/files/" "$SSH_TARGET:$REMOTE_DIR/"

    if [ -n "$SYSTEMD_UNIT" ]; then
        unit_remote_path="$REMOTE_DIR/$SYSTEMD_UNIT"
        target_unit_path="/etc/systemd/system/$SYSTEMD_UNIT"
        echo "  -> install unit $SYSTEMD_UNIT -> $target_unit_path"
        ssh -t "$SSH_TARGET" "sudo install -m 644 -o root -g root '$unit_remote_path' '$target_unit_path' && sudo systemctl daemon-reload && sudo systemctl enable '$SYSTEMD_UNIT' && sudo systemctl restart '$SYSTEMD_UNIT'"
        return 0
    fi

    inner="$VENV_PYTHON $REMOTE_DIR/$ENTRYPOINT"

    if [ -n "$SCREEN_NAME" ]; then
        cmd="${sudo_prefix}screen -dmS $SCREEN_NAME $inner"
        echo "  -> screen: $cmd"
        # -t lets sudo prompt for a password if NOPASSWD isn't set; screen
        # detaches immediately, so the ssh call returns right away.
        ssh -t "$SSH_TARGET" "$cmd"
    else
        cmd="${sudo_prefix}$inner"
        ssh_opts=""
        # -t allocates a TTY so sudo can prompt for password on our terminal.
        [ "$RUN_AS_ROOT" = "true" ] && ssh_opts="-t"
        echo "  -> run:    $cmd"
        ssh $ssh_opts "$SSH_TARGET" "$cmd"
    fi
}

main() {
    if [ "$#" -eq 0 ]; then
        # Word-split intentional; device names are directory names we control.
        set -- $(list_all_devices)
    fi
    if [ "$#" -eq 0 ]; then
        echo "No devices found in $DEVICES_DIR" >&2
        exit 1
    fi

    ok=0; fail=0; failed_names=""
    for name in "$@"; do
        if update_device "$name"; then
            ok=$((ok + 1))
        else
            fail=$((fail + 1))
            failed_names="${failed_names}${name} "
        fi
    done

    echo
    echo "================================================================"
    echo "  Summary: $ok succeeded, $fail failed"
    if [ "$fail" -gt 0 ]; then
        echo "  Failed:  $failed_names"
    fi
    echo "================================================================"

    [ "$fail" -eq 0 ]
}

main "$@"
