#!/usr/bin/env bash
# Simula o wrangler para os testes do backend workers. Registra os argumentos em $FAKE_WRANGLER_LOG.
echo "$*" >> "${FAKE_WRANGLER_LOG:-/dev/null}"
case "$1" in
  deploy)
    name=""; assets=""
    while [ $# -gt 0 ]; do case "$1" in --name) name="$2"; shift;; --assets) assets="$2"; shift;; esac; shift; done
    n=$(find "$assets" -type f | wc -l | tr -d ' ')
    echo "✨ Read $n files from the assets directory $assets"
    echo "Uploaded $name (1.00 sec)"
    echo "  https://$name.example-sub.workers.dev"
    echo "Current Version ID: 00000000-0000-4000-8000-000000000001"
    ;;
  delete) echo "Successfully deleted $3";;
  *) echo "unknown: $*" >&2; exit 1;;
esac
