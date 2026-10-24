#!/bin/sh
set -eu

# Forward Squid's file logs to the container log, as ubuntu/squid does.
for log in access cache; do
  tail -F "/var/log/squid/$log.log" 2>/dev/null &
done

# Create missing cache directories, then run in the foreground with the given args.
/usr/sbin/squid -Nz "$@"
exec /usr/sbin/squid "$@"
