#!/usr/bin/env bash
# Cluster PostgreSQL 16 local pour le développement, sans Docker.
# Usage : scripts/dev-postgres.sh start|stop|status
# Alternative recommandée si Docker est disponible : infra/docker-compose.yml
#
# Le mot de passe du superutilisateur local vaut "postgres" : ce cluster n'écoute que sur
# 127.0.0.1 et ne doit jamais contenir de données réelles.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGDATA_DIR="${DEV_PGDATA:-$ROOT/.data/pg}"
PGPORT="${DEV_PGPORT:-5432}"

find_bin() {
  if command -v "$1" >/dev/null 2>&1; then command -v "$1"; return; fi
  local candidate
  candidate="$(ls -d /usr/lib/postgresql/*/bin/"$1" 2>/dev/null | sort -V | tail -1 || true)"
  if [[ -z "$candidate" ]]; then echo "PostgreSQL introuvable ($1)" >&2; exit 1; fi
  echo "$candidate"
}

INITDB="$(find_bin initdb)"
PG_CTL="$(find_bin pg_ctl)"

# initdb et postgres refusent de tourner en root : on délègue alors à l'utilisateur postgres.
as_pg() {
  if [[ "$(id -u)" == "0" ]]; then runuser -u postgres -- "$@"; else "$@"; fi
}

init_cluster() {
  mkdir -p "$PGDATA_DIR"
  if [[ "$(id -u)" == "0" ]]; then chown -R postgres:postgres "$PGDATA_DIR"; fi
  local pwfile
  pwfile="$(mktemp)"
  echo "postgres" >"$pwfile"
  chmod 644 "$pwfile"
  as_pg "$INITDB" -D "$PGDATA_DIR" -U postgres --auth=scram-sha-256 --pwfile="$pwfile" \
    --encoding=UTF8 --locale=C.UTF-8 >/dev/null
  rm -f "$pwfile"
}

case "${1:-start}" in
  start)
    [[ -f "$PGDATA_DIR/PG_VERSION" ]] || init_cluster
    if as_pg "$PG_CTL" -D "$PGDATA_DIR" status >/dev/null 2>&1; then
      echo "PostgreSQL déjà démarré (port $PGPORT)"
    else
      as_pg "$PG_CTL" -D "$PGDATA_DIR" -l "$PGDATA_DIR/server.log" -w \
        -o "-p $PGPORT -c listen_addresses=127.0.0.1 -k /tmp" start >/dev/null
      echo "PostgreSQL démarré : postgres://postgres:postgres@127.0.0.1:$PGPORT/postgres"
    fi
    ;;
  stop)
    as_pg "$PG_CTL" -D "$PGDATA_DIR" -w stop >/dev/null && echo "PostgreSQL arrêté"
    ;;
  status)
    as_pg "$PG_CTL" -D "$PGDATA_DIR" status
    ;;
  *)
    echo "Usage : $0 start|stop|status" >&2
    exit 2
    ;;
esac
