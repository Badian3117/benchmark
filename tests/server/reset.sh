#!/usr/bin/env bash
# Recreates the test database: Supabase stub + BenchMark migration.
set -euo pipefail
cd "$(dirname "$0")/../.."
psql "$PGURL" -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
drop schema if exists public cascade; drop schema if exists auth cascade; create schema public;
grant all on schema public to postgres;
SQL
psql "$PGURL" -q -v ON_ERROR_STOP=1 -f tests/server/supabase-stub.sql -f supabase/migrations/20261029000000_benchmark.sql 2>&1 | grep -v NOTICE || true
