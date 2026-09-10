#!/bin/sh
set -eu

: "${DSH_HOME:=/data/dsh}"
export DSH_HOME
mkdir -p "$DSH_HOME"

BIND_PATCH="/app/docker/web-bind.patch.yml"
# Set DSH_DOCKER_BIND_ALL=0 to keep the product loopback default (127.0.0.1).
BIND_ALL="${DSH_DOCKER_BIND_ALL:-1}"

needs_web_bind=0
if [ "$BIND_ALL" != "0" ] && [ -f "$BIND_PATCH" ]; then
  case "${1:-}" in
    web)
      needs_web_bind=1
      ;;
    --profile)
      if [ "${2:-}" = "web" ]; then
        needs_web_bind=1
      fi
      ;;
  esac
fi

if [ "$needs_web_bind" = 1 ]; then
  already=0
  for arg in "$@"; do
    if [ "$arg" = "$BIND_PATCH" ]; then
      already=1
      break
    fi
  done
  if [ "$already" = 0 ]; then
    if [ "${1:-}" = "web" ]; then
      shift
      set -- web --patch "$BIND_PATCH" "$@"
    else
      shift 2
      set -- --profile web --patch "$BIND_PATCH" "$@"
    fi
  fi
fi

# Optional company hostname for the /api browser-trust fence (compose: DSH_TRUSTED_HOST).
if [ -n "${DSH_TRUSTED_HOST:-}" ]; then
  case "${1:-}" in
    web|--profile)
      already_trust=0
      for arg in "$@"; do
        if [ "$arg" = "--trusted-host" ]; then
          already_trust=1
          break
        fi
      done
      if [ "$already_trust" = 0 ]; then
        set -- "$@" --trusted-host "$DSH_TRUSTED_HOST"
      fi
      ;;
  esac
fi

exec node /app/apps/cli/lib/bin.js "$@"
