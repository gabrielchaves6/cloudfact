#!/usr/bin/env bash
# Fake wrangler for the workers backend tests. Records its arguments in $FAKE_WRANGLER_LOG.
echo "$*" >> "${FAKE_WRANGLER_LOG:-/dev/null}"
case "$1" in
  deploy)
    name=""; assets=""; config=""
    while [ $# -gt 0 ]; do case "$1" in --name) name="$2"; shift;; --assets) assets="$2"; shift;; --config) config="$2"; shift;; esac; shift; done
    if [ -n "$config" ]; then
      name=$(python3 -c "import json,sys; d=json.load(open('$config')); print(d['name'])")
      assets="$(dirname "$config")/$(python3 -c "import json; print(json.load(open('$config'))['assets']['directory'])")"
    fi
    n=$(find "$assets" -type f | wc -l | tr -d ' ')
    echo "✨ Read $n files from the assets directory $assets"
    echo "Uploaded $name (1.00 sec)"
    echo "  https://$name.example-sub.workers.dev"
    echo "Current Version ID: 00000000-0000-4000-8000-000000000001"
    ;;
  secret) cat > /dev/null; echo "✨ Success! Uploaded secret $3";;
  delete) echo "Successfully deleted $3";;
  *) echo "unknown: $*" >&2; exit 1;;
esac
