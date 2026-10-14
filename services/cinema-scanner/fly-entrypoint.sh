#!/bin/sh
set -eu

cleanup() {
    trap - EXIT
    kill "${worker_pid:-}" "${clamd_pid:-}" "${freshclam_pid:-}" 2>/dev/null || true
    wait 2>/dev/null || true
}
stopping=0
terminate() {
    stopping=1
    if [ -n "${worker_pid:-}" ]; then
        kill -TERM "$worker_pid" 2>/dev/null || true
    else
        kill -TERM "${clamd_pid:-}" "${freshclam_pid:-}" 2>/dev/null || true
    fi
}
trap terminate TERM INT
trap cleanup EXIT

chown -R clamav:clamav /var/lib/clamav /run/clamav
chown scanner:scanner /quarantine
rm -f /tmp/clamd.sock

# The pinned image contains a current database. FreshClam keeps it current in
# the running Machine; clamd reloads it through NotifyClamd.
freshclam --checks="${FRESHCLAM_CHECKS:-24}" --daemon --foreground --stdout --user=clamav &
freshclam_pid=$!
clamd --foreground --config-file=/etc/clamav/clamd.conf &
clamd_pid=$!

# Never claim a queued object before the antivirus daemon can scan it.
clamdscan --ping 600:1 --config-file=/etc/clamav/clamd.conf >/dev/null
# FreshClam and clamd start together. Reload once after readiness so a database
# update completed during boot is active before the worker claims anything.
clamdscan --reload --config-file=/etc/clamav/clamd.conf >/dev/null
expected_database="$(freshclam --version | cut -d/ -f2)"
reload_attempt=0
while [ "$(clamdscan --version --config-file=/etc/clamav/clamd.conf | cut -d/ -f2)" != "$expected_database" ]; do
    reload_attempt="$((reload_attempt + 1))"
    if [ "$reload_attempt" -ge 600 ]; then
        echo "ClamAV database reload did not complete" >&2
        exit 1
    fi
    sleep 1
done

su-exec scanner node services/cinema-scanner/worker.mjs &
worker_pid=$!

# BusyBox ash supports wait -n. If any of the three required processes exits,
# stop the others and let Fly's on-failure policy replace the Machine.
set +e
wait -n "$freshclam_pid" "$clamd_pid" "$worker_pid"
status=$?
if [ "$stopping" -eq 1 ]; then
    wait "$worker_pid"
    status=$?
else
    status=1
fi
set -e
exit "$status"
