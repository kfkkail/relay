#!/bin/sh
set -eu

worker_uid="${RELAY_HOST_UID:-1000}"
worker_gid="${RELAY_HOST_GID:-1000}"

if ! getent group "$worker_gid" >/dev/null 2>&1; then
  groupadd --gid "$worker_gid" relay-worker
fi

if ! getent passwd "$worker_uid" >/dev/null 2>&1; then
  useradd --no-create-home --uid "$worker_uid" --gid "$worker_gid" --key UID_MIN=0 relay-worker
fi

chown "$worker_uid:$worker_gid" /home/relay /home/relay/.codex

exec setpriv \
  --reuid="$worker_uid" \
  --regid="$worker_gid" \
  --init-groups \
  --inh-caps=-all \
  --bounding-set=-all \
  -- "$@"
