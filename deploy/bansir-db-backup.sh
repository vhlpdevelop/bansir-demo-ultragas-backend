#!/bin/sh
set -eu
umask 077
target="/var/backups/bansir/bansir-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump -Fc --file="$target" bansir
test -s "$target"
find /var/backups/bansir -maxdepth 1 -type f -name 'bansir-*.dump' -mtime +14 -delete
