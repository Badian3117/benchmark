#!/usr/bin/env bash
# Starts a throw-away PostgreSQL 16 cluster for the server tests and prints its URL.
#   eval "$(scripts/test-db.sh start)"   …   scripts/test-db.sh stop
set -euo pipefail
BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
DIR=${PG_TEST_DIR:-/tmp/bm-pg}
PORT=${PG_TEST_PORT:-54329}
RUN="runuser -u postgres --"
[ "$(id -u)" = 0 ] || RUN=""
case "${1:-start}" in
  start)
    if [ ! -d "$DIR/data" ]; then
      mkdir -p "$DIR"; [ -n "$RUN" ] && chown postgres "$DIR"
      $RUN "$BIN/initdb" -D "$DIR/data" -U postgres --auth=trust >/dev/null
    fi
    $RUN "$BIN/pg_ctl" -D "$DIR/data" status >/dev/null 2>&1 ||
      $RUN "$BIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null
    echo "export PGURL='postgresql://postgres@/postgres?host=$DIR&port=$PORT'"
    ;;
  stop) $RUN "$BIN/pg_ctl" -D "$DIR/data" -m fast stop >/dev/null ;;
esac
