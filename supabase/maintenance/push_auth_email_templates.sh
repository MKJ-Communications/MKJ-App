#!/usr/bin/env bash
# ============================================================
# MKJ OPS APP — PUSH BRANDED AUTH EMAIL TEMPLATES
# ============================================================
# Uploads supabase/templates/*.html to the live project's auth emails
# (Dashboard > Authentication > Emails). Subjects come from the build
# manifest, so they are defined once in build.mjs and never drift from here.
#
# This uses the Management API rather than `supabase config push` on purpose.
# `config push` writes the ENTIRE [auth] section from config.toml, so anything
# not spelled out there — site URL, redirect URLs, password policy, provider
# settings, rate limits — gets reset to CLI defaults on the remote project.
# The PATCH below touches exactly the mailer_* fields and leaves the rest alone.
#
# Usage — the token is read from the environment, never passed as an argument
# (arguments leak into shell history and `ps`):
#
#   export SUPABASE_ACCESS_TOKEN='sbp_...'   # supabase.com/dashboard/account/tokens
#   ./supabase/maintenance/push_auth_email_templates.sh              # all five
#   ./supabase/maintenance/push_auth_email_templates.sh recovery     # just one
#   ./supabase/maintenance/push_auth_email_templates.sh --show       # read-only
#
# Unset the variable afterwards. A personal access token can administer every
# project in the account — never commit it or put it in a .env file.
# ============================================================

set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-ujajblobqudgmdcterwe}"
API="https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEMPLATE_DIR="$REPO_ROOT/supabase/templates"

TOKEN="${SUPABASE_ACCESS_TOKEN:-}"
if [[ -z "$TOKEN" ]]; then
  echo "error: SUPABASE_ACCESS_TOKEN is not set." >&2
  echo "  export SUPABASE_ACCESS_TOKEN='sbp_...'   # supabase.com/dashboard/account/tokens" >&2
  exit 1
fi
command -v jq >/dev/null || { echo "error: jq is required (brew install jq)." >&2; exit 1; }
command -v node >/dev/null || { echo "error: node is required (the manifest comes from build.mjs)." >&2; exit 1; }

api_get() { curl -fsS -X GET "$API" -H "Authorization: Bearer $TOKEN"; }

MANIFEST="$(node "$TEMPLATE_DIR/build.mjs" --manifest)"
ALL_KEYS=($(jq -r '.emails[].key' <<<"$MANIFEST"))

# --- read-only mode -----------------------------------------------------
if [[ "${1:-}" == "--show" ]]; then
  LIVE="$(api_get)"
  for key in "${ALL_KEYS[@]}"; do
    jq -r --arg k "$key" '
      "\($k):",
      "  subject: \(.["mailer_subjects_" + $k] // "(Supabase default)")",
      "  content: \(if (.["mailer_templates_" + $k + "_content"] // "") == ""
                   then "(Supabase default)"
                   else "\(.["mailer_templates_" + $k + "_content"] | length) chars of custom HTML" end)"
    ' <<<"$LIVE"
  done
  exit 0
fi

# --- which templates are we pushing? ------------------------------------
if [[ $# -gt 0 ]]; then
  KEYS=("$@")
  for key in "${KEYS[@]}"; do
    [[ " ${ALL_KEYS[*]} " == *" $key "* ]] || {
      echo "error: unknown template '$key'. Known: ${ALL_KEYS[*]}" >&2; exit 1; }
  done
else
  KEYS=("${ALL_KEYS[@]}")
fi

# --- the committed HTML must match the layout it claims to come from ----
echo "checking templates are up to date with _layout.html"
node "$TEMPLATE_DIR/build.mjs" --check

# --- the header image has to be reachable, or every inbox shows alt text -
LOGO_URL="$(jq -r '.logoUrl' <<<"$MANIFEST")"
echo "checking header image: $LOGO_URL"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "$LOGO_URL")"
if [[ "$CODE" != "200" ]]; then
  echo "error: $LOGO_URL returned HTTP $CODE." >&2
  echo "  Deploy public/email-logo.png to production first, then re-run." >&2
  exit 1
fi
echo "  ok (200)"

LIVE="$(api_get)"

# --- the copy says "expires in N hours"; make sure the project agrees ----
EXPECTED_HOURS="$(jq -r '.expiryHours' <<<"$MANIFEST")"
ACTUAL_EXP="$(jq -r '.mailer_otp_exp // empty' <<<"$LIVE")"
if [[ -n "$ACTUAL_EXP" ]]; then
  ACTUAL_HOURS=$((ACTUAL_EXP / 3600))
  if [[ "$ACTUAL_HOURS" != "$EXPECTED_HOURS" ]]; then
    echo
    echo "warning: templates say links expire in ${EXPECTED_HOURS}h, but the project's" >&2
    echo "  mailer_otp_exp is ${ACTUAL_EXP}s (${ACTUAL_HOURS}h). Update EXPIRY_HOURS in" >&2
    echo "  supabase/templates/build.mjs, rebuild, and re-run — or the emails will lie." >&2
    echo
  else
    echo "link expiry: ${ACTUAL_HOURS}h, matches the templates"
  fi
fi

# --- show what is about to be replaced ----------------------------------
echo
echo "project: $PROJECT_REF"
echo
printf '%-16s %-34s %s\n' "TEMPLATE" "NEW SUBJECT" "CURRENTLY LIVE"
for key in "${KEYS[@]}"; do
  subject="$(jq -r --arg k "$key" '.emails[] | select(.key==$k) | .subject' <<<"$MANIFEST")"
  current="$(jq -r --arg k "$key" '
    if (.["mailer_templates_" + $k + "_content"] // "") == ""
    then "Supabase default"
    else "custom (\(.["mailer_templates_" + $k + "_content"] | length) chars)" end' <<<"$LIVE")"
  printf '%-16s %-34s %s\n' "$key" "$subject" "$current"
done
echo
read -r -p "Overwrite ${#KEYS[@]} live template(s)? [y/N] " reply
[[ "$reply" == "y" || "$reply" == "Y" ]] || { echo "aborted."; exit 0; }

# --- build one PATCH body for every template ----------------------------
# --arg with $(cat) rather than --rawfile: command substitution drops the file's
# trailing newline, so what lands on the remote is byte-identical to what the
# verification step below reads back through the same substitution.
PAYLOAD='{}'
for key in "${KEYS[@]}"; do
  file="$TEMPLATE_DIR/$key.html"
  [[ -f "$file" ]] || { echo "error: missing $file" >&2; exit 1; }
  subject="$(jq -r --arg k "$key" '.emails[] | select(.key==$k) | .subject' <<<"$MANIFEST")"
  PAYLOAD="$(jq -n \
    --argjson acc "$PAYLOAD" \
    --arg skey "mailer_subjects_$key" --arg subject "$subject" \
    --arg ckey "mailer_templates_${key}_content" --arg content "$(cat "$file")" \
    '$acc + {($skey): $subject, ($ckey): $content}')"
done

# Not -f: on a 4xx/5xx, -f discards the response body and leaves only a bare
# "curl: (22) ... 400" — exactly the case that needs the body, since that's
# where Supabase puts the actual validation message. Capture status and body
# separately and print the body ourselves on failure instead.
PATCH_BODY_FILE="$(mktemp)"
trap 'rm -f "$PATCH_BODY_FILE"' EXIT
HTTP_STATUS="$(curl -sS -o "$PATCH_BODY_FILE" -w '%{http_code}' -X PATCH "$API" \
  -H "Authorization: Bearer $TOKEN" \
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

# --- verify each remote template now matches its file -------------------
echo
AFTER="$(api_get)"
fail=0
for key in "${KEYS[@]}"; do
  remote="$(jq -r --arg k "$key" '.["mailer_templates_" + $k + "_content"]' <<<"$AFTER")"
  if [[ "$remote" == "$(cat "$TEMPLATE_DIR/$key.html")" ]]; then
    echo "  ok       $key"
  else
    echo "  MISMATCH $key — push returned OK but the remote content differs" >&2
    fail=1
  fi
done
[[ $fail -eq 0 ]] || exit 1
echo
echo "done — ${#KEYS[@]} template(s) live on $PROJECT_REF"
