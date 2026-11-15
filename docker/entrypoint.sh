#!/bin/sh
set -eu

: "${DSH_HOME:=/data/dsh}"
export DSH_HOME
mkdir -p "$DSH_HOME"

# Optional SSH keys for git over SSH (compose: DSH_SSH_DIR, mounted read-only at
# /run/dsh-ssh). Windows bind mounts show every file as 0777, which ssh rejects,
# and ssh reads the passwd home (/root, or /home/node for uid 1000), not $HOME,
# so copy them there with strict modes.
if [ -d /run/dsh-ssh ] && [ -n "$(ls -A /run/dsh-ssh 2>/dev/null)" ]; then
  ssh_home="$(getent passwd "$(id -u)" | cut -d: -f6)"
  ssh_dir="${ssh_home:-$HOME}/.ssh"
  if mkdir -p "$ssh_dir" 2>/dev/null && cp -R /run/dsh-ssh/. "$ssh_dir/"; then
    chmod 700 "$ssh_dir"
    find "$ssh_dir" -type f -exec chmod 600 {} +
  else
    echo "entrypoint: cannot copy SSH keys to $ssh_dir; git over SSH is unavailable" >&2
  fi
fi

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
