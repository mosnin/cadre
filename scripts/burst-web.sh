#!/usr/bin/env bash
# Builds Burst's hosted web client from a pinned mosnin/burst commit and deploys it to Cloudflare
# Workers static assets. See docs/WEB.md.
#
#   scripts/burst-web.sh checkout <dir>   fetch the pinned Burst commit into a new directory
#   scripts/burst-web.sh build <dir>      build desktop/apps/web/dist and its security headers
#   scripts/burst-web.sh deploy <dir>     build, then deploy with Wrangler to T3CODE_HOSTED_APP_URL
#
# build and deploy need Burst's own Node.js and pnpm (desktop/package.json pins both).
set -euo pipefail

# The owner moves this pin deliberately, after reviewing the Burst changes it brings in.
BURST_COMMIT=6a7cc88db36f4281860883270724f33c51125b25
BURST_REPO=https://github.com/mosnin/burst.git
WRANGLER_VERSION=4.160.1

usage() {
  echo "Usage: $0 checkout|build|deploy <dir>" >&2
  exit 2
}

require() {
  local missing=() name
  for name in "$@"; do
    [[ -n "${!name:-}" ]] || missing+=("$name")
  done
  if ((${#missing[@]})); then
    echo "Missing settings: ${missing[*]}. See docs/WEB.md." >&2
    exit 1
  fi
}

command=${1:-}
dir=${2:-}
[[ -n "$command" && -n "$dir" ]] || usage

case "$command" in
  checkout)
    if [[ -e "$dir" && -n "$(ls -A "$dir")" ]]; then
      echo "$dir already exists and is not empty." >&2
      exit 1
    fi
    git init -q "$dir"
    git -C "$dir" fetch -q --depth 1 "$BURST_REPO" "$BURST_COMMIT"
    git -C "$dir" -c advice.detachedHead=false checkout -q FETCH_HEAD
    ;;
  build | deploy)
    require T3CODE_RELAY_URL T3CODE_HOSTED_APP_URL BURST_WEB_ENVIRONMENT_HOSTS
    if [[ "$command" == deploy ]]; then
      require CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
    fi
    actual=$(git -C "$dir" rev-parse HEAD)
    if [[ "$actual" != "$BURST_COMMIT" ]]; then
      echo "$dir is at $actual, not the pinned $BURST_COMMIT." >&2
      exit 1
    fi
    # The hosted client reaches every environment through the relay. A baked server URL would
    # point every visitor at one machine, so these must never be set for this build.
    unset VITE_HTTP_URL VITE_WS_URL VITE_HOSTED_APP_CHANNEL
    cd "$dir/desktop"
    pnpm install --frozen-lockfile
    pnpm --filter @t3tools/web run build:hosted
    if [[ "$command" == deploy ]]; then
      host=$(node -e 'console.log(new URL(process.argv[1]).host)' "$T3CODE_HOSTED_APP_URL")
      cd apps/web
      pnpm dlx "wrangler@$WRANGLER_VERSION" deploy --domain "$host"
    fi
    ;;
  *)
    usage
    ;;
esac
