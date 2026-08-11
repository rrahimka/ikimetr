#!/usr/bin/env bash
set -euo pipefail

umask 077

readonly SCANNER_PATH=/home/rahim/.local/bin/gitleaks-v8.30.1
readonly SCANNER_SHA256=88f91962aa2f93ac6ab281d553b9e125f5197bbbce38f9f2437f7299c32e5509
readonly -a SCANNER_FIXED_ARGS=(
  dir
  --no-banner
  --no-color
  --redact
  --report-format
  json
  --report-path
)
fail() {
  printf 'secret scan: %s\n' "$1" >&2
  exit 2
}

[[ -f "$SCANNER_PATH" && -x "$SCANNER_PATH" && ! -L "$SCANNER_PATH" ]] || fail 'pinned scanner binary is unavailable or unsafe'
hash_record=$(sha256sum -- "$SCANNER_PATH") || fail 'could not hash pinned scanner binary'
live_hash=${hash_record%% *}
[[ "$live_hash" == "$SCANNER_SHA256" ]] || fail 'pinned scanner binary hash mismatch'

if [[ "${1-}" == -- ]]; then
  shift
fi
(( $# > 0 )) || fail 'at least one regular-file path is required'

report_path=''
cleanup_report() {
  local candidate=${report_path:-}
  [[ -n "$candidate" ]] || return 0
  case "$candidate" in
    /tmp/ikimetr-gitleaks-report-????????.json) ;;
    *) printf '%s\n' 'secret scan: refusing unsafe report cleanup path' >&2; return 2 ;;
  esac
  if [[ -e "$candidate" || -L "$candidate" ]]; then
    [[ -f "$candidate" && ! -L "$candidate" ]] || {
      printf '%s\n' 'secret scan: report path became unsafe' >&2
      return 2
    }
    [[ "$(realpath -- "$candidate")" == "$candidate" ]] || {
      printf '%s\n' 'secret scan: report path is not canonical' >&2
      return 2
    }
    rm -f -- "$candidate"
  fi
}

for source_path in "$@"; do
  [[ -e "$source_path" ]] || fail "path does not exist: $source_path"
  [[ -f "$source_path" && ! -L "$source_path" ]] || fail "path is not a regular, nonsymlink file: $source_path"

  report_path=''
  trap cleanup_report EXIT
  report_path=$(mktemp /tmp/ikimetr-gitleaks-report-XXXXXXXX.json)
  [[ "$(realpath -- "$report_path")" == "$report_path" ]] || fail 'report path is not canonical'
  chmod 0600 "$report_path"
  [[ "$(stat -c '%a' "$report_path")" == 600 ]] || fail 'report is not private'

  set +e
  "$SCANNER_PATH" "${SCANNER_FIXED_ARGS[@]}" "$report_path" -- "$source_path"
  scanner_status=$?
  set -e

  cleanup_report
  report_path=''
  trap - EXIT

  case "$scanner_status" in
    0) ;;
    1) exit 1 ;;
    *) exit "$scanner_status" ;;
  esac
done
