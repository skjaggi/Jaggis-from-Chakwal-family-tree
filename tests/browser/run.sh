#!/usr/bin/env bash
# Browser tests: preview mode (smoke.cjs) and signed-in member/admin screens
# against a fake backend (signedin.cjs). Needs Node and Playwright's Chromium.
#   tests/browser/run.sh
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -f .vendor/d3.esm.js ]; then
  # The site loads d3 and supabase-js from a CDN; tests serve local copies.
  mkdir -p .vendor && cd .vendor
  echo "{\"name\":\"vendor\",\"private\":true}" > package.json && npm i --silent d3@7.9.0 @supabase/supabase-js@2.89.0 esbuild >/dev/null
  npx esbuild --bundle --format=esm node_modules/d3/src/index.js --outfile=d3.esm.js --log-level=warning
  echo "export * from '@supabase/supabase-js';" > sb.js
  npx esbuild --bundle --format=esm sb.js --outfile=supabase.esm.js --log-level=warning
  cd ..
fi
(cd ../../site && python3 -m http.server 8765 >/dev/null 2>&1) & SERVER=$!
trap 'kill $SERVER' EXIT
sleep 1
if [ "${1:-}" = shots ]; then node help-shots.cjs; exit; fi  # retake the help page pictures
node smoke.cjs
node signedin.cjs
