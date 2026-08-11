#!/usr/bin/env bash
set -euo pipefail

umask 077

fail() {
  printf 'secret-scanner generator: %s\n' "$1" >&2
  exit 2
}

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
repo_root=$(cd -- "$script_dir/../.." && pwd -P)
env_file="$repo_root/docs/superpowers/plans/artifacts/phase-a0-scanner.env"
target="$script_dir/scan.sh"

[[ -f "$env_file" && ! -L "$env_file" ]] || fail 'scanner env must be a regular, nonsymlink file'

declare -A config=()
line_number=0
while IFS= read -r line || [[ -n "$line" ]]; do
  line_number=$((line_number + 1))
  [[ -n "$line" ]] || fail "blank line at $line_number"
  [[ "$line" != *$'\r'* ]] || fail "carriage return at line $line_number"
  [[ "$line" =~ ^([A-Z0-9_]+)=(.*)$ ]] || fail "invalid data at line $line_number"
  key=${BASH_REMATCH[1]}
  value=${BASH_REMATCH[2]}
  case "$key" in
    SCANNER_KIND|SCANNER_TAG|SCANNER_PATH|SCANNER_SHA256|\
    SCANNER_FIXED_ARG_1|SCANNER_FIXED_ARG_2|SCANNER_FIXED_ARG_3|\
    SCANNER_FIXED_ARG_4|SCANNER_FIXED_ARG_5|SCANNER_FIXED_ARG_6|\
    SCANNER_FIXED_ARG_7) ;;
    *) fail "unexpected key $key" ;;
  esac
  [[ -z "${config[$key]+present}" ]] || fail "duplicate key $key"
  config["$key"]=$value
done < "$env_file"

required_keys=(
  SCANNER_KIND
  SCANNER_TAG
  SCANNER_PATH
  SCANNER_SHA256
  SCANNER_FIXED_ARG_1
  SCANNER_FIXED_ARG_2
  SCANNER_FIXED_ARG_3
  SCANNER_FIXED_ARG_4
  SCANNER_FIXED_ARG_5
  SCANNER_FIXED_ARG_6
  SCANNER_FIXED_ARG_7
)

[[ "${#config[@]}" -eq "${#required_keys[@]}" ]] || fail 'scanner env key count mismatch'
for key in "${required_keys[@]}"; do
  [[ -n "${config[$key]+present}" ]] || fail "missing key $key"
done

[[ "${config[SCANNER_KIND]}" == gitleaks ]] || fail 'unsupported scanner kind'
[[ "${config[SCANNER_TAG]}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'invalid scanner tag'
scanner_path=${config[SCANNER_PATH]}
[[ "$scanner_path" =~ ^/[A-Za-z0-9._/+:-]+$ ]] || fail 'scanner path must be absolute and literal'
[[ -f "$scanner_path" && -x "$scanner_path" && ! -L "$scanner_path" ]] || fail 'scanner binary is unavailable or unsafe'
[[ "$(realpath -- "$scanner_path")" == "$scanner_path" ]] || fail 'scanner path must be canonical'
[[ "$(basename -- "$scanner_path")" == "gitleaks-${config[SCANNER_TAG]}" ]] || fail 'scanner path and tag disagree'
[[ "${config[SCANNER_SHA256]}" =~ ^[0-9a-f]{64}$ ]] || fail 'invalid scanner hash'

hash_record=$(sha256sum -- "$scanner_path") || fail 'could not hash scanner binary'
live_hash=${hash_record%% *}
[[ "$live_hash" == "${config[SCANNER_SHA256]}" ]] || fail 'scanner binary hash mismatch'

expected_args=(dir --no-banner --no-color --redact --report-format json --report-path)
for index in "${!expected_args[@]}"; do
  key="SCANNER_FIXED_ARG_$((index + 1))"
  [[ "${config[$key]}" == "${expected_args[$index]}" ]] || fail "unsafe fixed argument at $key"
done

if [[ -e "$target" || -L "$target" ]]; then
  [[ -f "$target" && ! -L "$target" ]] || fail 'wrapper target is not a regular, nonsymlink file'
fi

target_tmp=$(mktemp "$script_dir/.scan.sh.tmp.XXXXXXXX")
target_tmp_real=$(realpath -- "$target_tmp")
case "$target_tmp_real" in
  "$script_dir"/.scan.sh.tmp.*) ;;
  *) fail 'invalid wrapper temporary path' ;;
esac

cleanup() {
  case "${target_tmp_real:-}" in
    "$script_dir"/.scan.sh.tmp.*) rm -f -- "$target_tmp_real" ;;
    '') return 0 ;;
    *) return 2 ;;
  esac
}
trap cleanup EXIT

{
  printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' '' 'umask 077' ''
  printf 'readonly SCANNER_PATH=%q\n' "$scanner_path"
  printf 'readonly SCANNER_SHA256=%q\n' "${config[SCANNER_SHA256]}"
  printf '%s\n' 'readonly -a SCANNER_FIXED_ARGS=('
  for index in "${!expected_args[@]}"; do
    key="SCANNER_FIXED_ARG_$((index + 1))"
    printf '  %q\n' "${config[$key]}"
  done
  printf '%s\n' ')'
  sed -n '/^__WRAPPER_BODY__$/,$p' "$0" | sed '1d'
} > "$target_tmp"

chmod 0755 "$target_tmp"
mv -f -- "$target_tmp" "$target"
trap - EXIT
exit 0

__WRAPPER_BODY__
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
