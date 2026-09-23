#!/usr/bin/env bash
# ============================================================
# MKJ OPS APP — CONFIGURE CUSTOM SMTP (Resend)
# ============================================================
# Points the live project's auth mailer at Resend instead of Supabase's
# built-in sender. This exists to fix two problems at once, confirmed
# directly against Supabase's own error message and docs:
#
#   1. Auth email templates cannot be edited via the Management API on a
#      free-tier project while it's using the default mailer — pushing
#      confirmation.html fails with HTTP 400: "Email template modification
#      is not available for free tier projects using the default email
#      provider. Please upgrade your plan or configure a custom SMTP
#      provider." This script is the "configure a custom SMTP provider" path.
#   2. The default mailer refuses to deliver to any address that isn't on
#      the project's Team page ("Email address not authorized") — so real
#      registrants get nothing at all today, branded template or not.
#      https://supabase.com/docs/guides/auth/auth-smtp
#
# Field names (smtp_admin_email / smtp_host / smtp_port / smtp_user /
# smtp_pass / smtp_sender_name) are Supabase's own documented Management
# API fields — there is no separate "enable custom SMTP" boolean; setting
# smtp_host non-empty is what takes the project off the default mailer.
# Resend's specific values (host, port, username) are from Resend's own
# integration guide: https://resend.com/docs/send-with-supabase-smtp
#
# Prerequisites — both are yours to do, not this script's:
#   - A Resend account and an API key (resend.com/api-keys), starts with "re_".
#   - A domain VERIFIED in Resend (resend.com/domains). Resend requires this
#     for SMTP sending — there is no unverified-domain fallback for this path.
#     This script checks verification status via Resend's API before
#     touching Supabase, so it won't wire in a domain that won't work yet.
#
# Usage — both tokens are read from the environment, never passed as
# arguments (arguments leak into shell history and `ps`):
#
#   export SUPABASE_ACCESS_TOKEN='sbp_...'   # supabase.com/dashboard/account/tokens
#   export RESEND_API_KEY='re_...'           # resend.com/api-keys
#   export SMTP_FROM_EMAIL='no-reply@yourverifieddomain.com'
#   export SMTP_FROM_NAME='MKJ Ops'          # optional, defaults below
#
#   ./supabase/maintenance/configure_smtp.sh          # preview + confirm + apply
#   ./supabase/maintenance/configure_smtp.sh --show   # read-only: current config
#
# Unset the variables afterwards. SUPABASE_ACCESS_TOKEN administers every
# project on the account; RESEND_API_KEY can send mail as your domain.
# Never commit either or put them in a .env file.
# ============================================================

set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-ujajblobqudgmdcterwe}"
AUTH_API="https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth"
RESEND_API="https://api.resend.com"

# Resend's documented values for the Supabase SMTP integration — not
# configurable, since they're fixed by Resend, not by this project.
SMTP_HOST="smtp.resend.com"
SMTP_PORT="465"
SMTP_USER="resend"

SMTP_FROM_NAME="${SMTP_FROM_NAME:-MKJ Ops}"

SUPABASE_TOKEN="${SUPABASE_ACCESS_TOKEN:-}"
RESEND_KEY="${RESEND_API_KEY:-}"
FROM_EMAIL="${SMTP_FROM_EMAIL:-}"

if [[ -z "$SUPABASE_TOKEN" ]]; then
  echo "error: SUPABASE_ACCESS_TOKEN is not set." >&2
  echo "  export SUPABASE_ACCESS_TOKEN='sbp_...'   # supabase.com/dashboard/account/tokens" >&2
  exit 1
fi
command -v jq >/dev/null || { echo "error: jq is required (brew install jq)." >&2; exit 1; }

auth_api_get() { curl -fsS -X GET "$AUTH_API" -H "Authorization: Bearer $SUPABASE_TOKEN"; }

# --- read-only mode: no Resend key needed, just show what's live today ---
if [[ "${1:-}" == "--show" ]]; then
  LIVE="$(auth_api_get)"
  jq -r '
    "smtp_host:        \(.smtp_host // "(not set — using Supabase default mailer)")",
    "smtp_port:        \(.smtp_port // "-")",
    "smtp_user:        \(.smtp_user // "-")",
    "smtp_admin_email: \(.smtp_admin_email // "-")",
    "smtp_sender_name: \(.smtp_sender_name // "-")",
    "smtp_pass:        \(if .smtp_pass then "(set, hidden)" else "(not set)" end)"
  ' <<<"$LIVE"
  exit 0
fi

# --- from here on we're actually changing something, so need both creds -
if [[ -z "$RESEND_KEY" ]]; then
  echo "error: RESEND_API_KEY is not set." >&2
  echo "  export RESEND_API_KEY='re_...'   # resend.com/api-keys" >&2
  exit 1
fi
if [[ -z "$FROM_EMAIL" ]]; then
  echo "error: SMTP_FROM_EMAIL is not set." >&2
  echo "  export SMTP_FROM_EMAIL='no-reply@yourverifieddomain.com'" >&2
  echo "  Must be an address on a domain verified in Resend (resend.com/domains)." >&2
  exit 1
fi
FROM_DOMAIN="${FROM_EMAIL#*@}"
if [[ -z "$FROM_DOMAIN" || "$FROM_DOMAIN" == "$FROM_EMAIL" ]]; then
  echo "error: SMTP_FROM_EMAIL '$FROM_EMAIL' doesn't look like an email address." >&2
  exit 1
fi

# --- confirm the sending domain is actually verified with Resend --------
# Skipping this and just PATCHing Supabase would "succeed" (200) but every
# email would then bounce or get rejected at Resend's side — a failure mode
# that's invisible from here, so it's worth the extra call to catch first.
echo "checking Resend domain verification: $FROM_DOMAIN"
DOMAINS_BODY_FILE="$(mktemp)"
trap 'rm -f "$DOMAINS_BODY_FILE"' EXIT
DOMAINS_STATUS="$(curl -sS -o "$DOMAINS_BODY_FILE" -w '%{http_code}' -X GET "$RESEND_API/domains" \
  -H "Authorization: Bearer $RESEND_KEY")"
if [[ "$DOMAINS_STATUS" -ge 400 ]]; then
  echo "error: Resend API returned HTTP $DOMAINS_STATUS while listing domains." >&2
  echo "--- response body ---" >&2
  cat "$DOMAINS_BODY_FILE" >&2
  echo >&2
  echo "Check that RESEND_API_KEY is correct." >&2
  exit 1
fi

DOMAIN_STATUS="$(jq -r --arg d "$FROM_DOMAIN" '.data[] | select(.name == $d) | .status' "$DOMAINS_BODY_FILE")"
if [[ -z "$DOMAIN_STATUS" ]]; then
  echo "error: '$FROM_DOMAIN' is not registered in this Resend account at all." >&2
  echo "  Add it at https://resend.com/domains, then add the DNS records it gives you." >&2
  exit 1
fi
if [[ "$DOMAIN_STATUS" != "verified" ]]; then
  # Resend also has partially_verified / partially_failed states where sending
  # might already work (e.g. the send capability is verified but receive isn't).
  # Requiring the plain "verified" status is the conservative read — it means
  # occasionally waiting a little longer, never wiring in a domain that bounces.
  echo "error: '$FROM_DOMAIN' is registered in Resend but not verified yet (status: $DOMAIN_STATUS)." >&2
  echo "  Add the DNS records Resend shows at https://resend.com/domains and wait for" >&2
  echo "  verification — it can take a few minutes to a few hours depending on your DNS host." >&2
  echo "  Sending from an unverified domain will bounce, so this script stops here." >&2
  exit 1
fi
echo "  ok — '$FROM_DOMAIN' is verified"

# --- preview -------------------------------------------------------------
LIVE="$(auth_api_get)"
echo
echo "project: $PROJECT_REF"
echo
printf '%-18s %-30s %s\n' "FIELD" "CURRENTLY LIVE" "NEW VALUE"
printf '%-18s %-30s %s\n' "smtp_host" "$(jq -r '.smtp_host // "(default mailer)"' <<<"$LIVE")" "$SMTP_HOST"
printf '%-18s %-30s %s\n' "smtp_port" "$(jq -r '.smtp_port // "-"' <<<"$LIVE")" "$SMTP_PORT"
printf '%-18s %-30s %s\n' "smtp_user" "$(jq -r '.smtp_user // "-"' <<<"$LIVE")" "$SMTP_USER"
printf '%-18s %-30s %s\n' "smtp_admin_email" "$(jq -r '.smtp_admin_email // "-"' <<<"$LIVE")" "$FROM_EMAIL"
printf '%-18s %-30s %s\n' "smtp_sender_name" "$(jq -r '.smtp_sender_name // "-"' <<<"$LIVE")" "$SMTP_FROM_NAME"
printf '%-18s %-30s %s\n' "smtp_pass" "$(jq -r 'if .smtp_pass then "(set, hidden)" else "(not set)" end' <<<"$LIVE")" "(new key, hidden)"
echo
echo "This switches the project off Supabase's default mailer — its rate limit and"
echo "'team members only' delivery restriction stop applying once this is live."
echo
read -r -p "Apply this SMTP configuration? [y/N] " reply
[[ "$reply" == "y" || "$reply" == "Y" ]] || { echo "aborted."; exit 0; }

# --- apply -----------------------------------------------------------------
PAYLOAD="$(jq -n \
  --arg host "$SMTP_HOST" \
  --argjson port "$SMTP_PORT" \
  --arg user "$SMTP_USER" \
  --arg pass "$RESEND_KEY" \
  --arg admin_email "$FROM_EMAIL" \
  --arg sender_name "$SMTP_FROM_NAME" \
  '{
    smtp_host: $host,
    smtp_port: $port,
    smtp_user: $user,
    smtp_pass: $pass,
    smtp_admin_email: $admin_email,
    smtp_sender_name: $sender_name
  }')"

PATCH_BODY_FILE="$(mktemp)"
trap 'rm -f "$DOMAINS_BODY_FILE" "$PATCH_BODY_FILE"' EXIT
HTTP_STATUS="$(curl -sS -o "$PATCH_BODY_FILE" -w '%{http_code}' -X PATCH "$AUTH_API" \
  -H "Authorization: Bearer $SUPABASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")"
if [[ "$HTTP_STATUS" -ge 400 ]]; then
  echo
  echo "error: PATCH failed with HTTP $HTTP_STATUS" >&2
  echo "--- response body ---" >&2
  cat "$PATCH_BODY_FILE" >&2
  echo >&2
  echo "---------------------" >&2
  exit 1
fi

# --- verify: re-read and check the non-secret fields landed --------------
# smtp_pass is never compared — the API has no reason to echo a secret back,
# and may return it masked or omitted entirely.
AFTER="$(auth_api_get)"
fail=0
check() {
  local field="$1" expected="$2"
  local actual
  actual="$(jq -r --arg f "$field" '.[$f] // empty' <<<"$AFTER")"
  if [[ "$actual" == "$expected" ]]; then
    echo "  ok       $field = $actual"
  else
    echo "  MISMATCH $field = '$actual' (expected '$expected')" >&2
    fail=1
  fi
}
echo
check smtp_host "$SMTP_HOST"
check smtp_port "$SMTP_PORT"
check smtp_user "$SMTP_USER"
check smtp_admin_email "$FROM_EMAIL"
check smtp_sender_name "$SMTP_FROM_NAME"
[[ $fail -eq 0 ]] || exit 1

echo
echo "done — custom SMTP is live on $PROJECT_REF"
echo
echo "Next: push the templates now that the free-tier block is lifted:"
echo "  ./supabase/maintenance/push_auth_email_templates.sh"
echo
echo "Then send yourself a real test — sign up (or resend confirmation) with an"
echo "address that is NOT on the project's Team page, to confirm delivery works"
echo "for people who aren't you."
