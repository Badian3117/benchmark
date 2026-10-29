#!/usr/bin/env bash
# Connected-mode UI test: real Postgres schema + fake Supabase endpoints + built app + Playwright.
set -euo pipefail
cd "$(dirname "$0")/.."
eval "$(scripts/test-db.sh start)"
tests/server/reset.sh >/dev/null 2>&1
psql "$PGURL" -q -v ON_ERROR_STOP=1 -f tests/server/seed-e2e.sql
node tests/server/fake-supabase.mjs 54321 > /tmp/bm-fake.log 2>&1 &
FAKE=$!
VITE_BM_SUPABASE_URL=http://localhost:54321 VITE_BM_SUPABASE_ANON_KEY=anon-test-key-0123456789abcdef npx vite build --outDir dist-e2e >/dev/null 2>&1
npx vite preview --outDir dist-e2e --port 4174 --strictPort >/dev/null 2>&1 &
PREVIEW=$!
trap 'kill $FAKE $PREVIEW 2>/dev/null || true' EXIT
for i in $(seq 1 40); do curl -s localhost:4174 >/dev/null && curl -s -o /dev/null localhost:54321/rest/v1/x && break; sleep 0.5; done
node tests/e2e-connected.cjs "${1:-.}"
# the same data, from inside the Electron shell (needs a display: xvfb-run on Linux CI)
if command -v xvfb-run >/dev/null; then
  VITE_BM_SUPABASE_URL=http://localhost:54321 VITE_BM_SUPABASE_ANON_KEY=anon-test-key-0123456789abcdef npx vite build >/dev/null 2>&1
  xvfb-run -a node tests/e2e-electron.cjs
  npx vite build >/dev/null 2>&1   # leave dist/ as the standalone build
fi
