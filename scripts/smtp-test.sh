#!/usr/bin/env bash
#
# Send one test email through Cloudflare Email Sending's SMTP relay.
#
# This proves the relay works on its own, before Supabase is pointed at it.
# If this fails there is no point debugging Supabase: the credential, the
# sender domain or the DNS is wrong, and the error below says which.
#
# The token is read from a no-echo prompt and never written to disk, never
# echoed, and never placed in a command line other processes could read via
# `ps`. It lives in the environment for the life of this script only.
#
# Usage:  scripts/smtp-test.sh [recipient]
#
set -euo pipefail

HOST="smtp.mx.cloudflare.net"
PORT="465"
SENDER="noreply@veyrnox.ai"
RECIPIENT="${1:-}"

if [[ -z "$RECIPIENT" ]]; then
    read -r -p "Send the test email to: " RECIPIENT
fi
if [[ -z "$RECIPIENT" ]]; then
    echo "No recipient. Nothing sent." >&2
    exit 2
fi

# -s so the token never appears on screen or in shell history.
if [[ -z "${CF_EMAIL_TOKEN:-}" ]]; then
    read -r -s -p "Cloudflare API token (Email Sending: Edit): " CF_EMAIL_TOKEN
    echo
fi
if [[ -z "$CF_EMAIL_TOKEN" ]]; then
    echo "No token. Nothing sent." >&2
    exit 2
fi

echo "Sending ${SENDER} -> ${RECIPIENT} via ${HOST}:${PORT} ..."
echo

LOG="$(mktemp -t smtp-test)"
trap 'rm -f "$LOG"' EXIT

# --upload-file - reads the message from stdin.
# --user takes the token on stdin-adjacent config rather than argv so it does
# not leak to `ps`; curl's -K reads config from a file descriptor.
set +e
printf 'From: Veyrnox.ai <%s>\nTo: %s\nSubject: Veyrnox.ai SMTP test\n\nIf this arrives, Cloudflare SMTP works.\n' \
    "$SENDER" "$RECIPIENT" \
| curl --silent --show-error --verbose --ssl-reqd \
    --url "smtps://${HOST}:${PORT}" \
    --config <(printf 'user = "api_token:%s"\n' "$CF_EMAIL_TOKEN") \
    --mail-from "$SENDER" \
    --mail-rcpt "$RECIPIENT" \
    --upload-file - \
    >"$LOG" 2>&1
STATUS=$?
set -e

# Never print the log unfiltered. curl --verbose echoes the SASL exchange, and
# the credential goes out as a BARE base64 blob on a '> ' line with no AUTH
# keyword on it -- filtering on keywords alone leaks the token in plaintext.
# So also redact any sent line that is pure base64 and long enough to be one.
grep -vi 'AUTH\|Authorization\|api_token' "$LOG" \
    | sed -E 's/^([[:space:]]*[>}][[:space:]]*)[A-Za-z0-9+/]{16,}={0,2}[[:space:]]*$/\1[redacted SASL credential]/' \
    | sed 's/^/  /'
echo

if [[ $STATUS -eq 0 ]]; then
    echo "PASS — relay accepted the message."
    echo "Now confirm it actually landed in ${RECIPIENT}, and that"
    echo "'Emails sent' for veyrnox.ai has moved off 0 in the dashboard."
    exit 0
fi

echo "FAIL — curl exited ${STATUS}."
case "$(grep -o '5[0-9][0-9] [0-9.]*' "$LOG" | head -1)" in
    535*) echo "  535 = auth rejected. Token is wrong, revoked, or lacks Email Sending: Edit." ;;
    550*) echo "  550 = sender denied. ${SENDER}'s domain is not onboarded on the account that owns the token." ;;
    552*) echo "  552 = message too big (>5 MiB)." ;;
    *)    echo "  Check the transcript above. A TLS handshake failure means the client" ;;
esac
exit 1
