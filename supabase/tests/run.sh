#!/usr/bin/env bash
# Tests schema.sql + seed.sql on a local Postgres.
#   PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists jaggi_test" -c "create database jaggi_test"
P="psql -q -v ON_ERROR_STOP=1 -d jaggi_test"
$P -f supabase-stubs.sql
PGOPTIONS="-c client_min_messages=warning" $P -f ../schema.sql
PGOPTIONS="-c client_min_messages=warning" $P -f ../schema.sql   # re-running must work
$P -f ../seed.sql
$P -o /dev/null -f policy-tests.sql 2>&1 | sed -n "s/.*NOTICE:  //p"
echo "ALL DATABASE TESTS PASSED"
