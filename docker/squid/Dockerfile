# syntax=docker/dockerfile:1

# Egress proxy for the company deployment. Built from the Ubuntu archive
# instead of ubuntu/squid, whose `latest` tag stopped receiving rebuilds and
# lacks the 2026 Squid security fixes; rebuild this image to pick up new ones.
# Drop-in for ubuntu/squid: same port, config path, and logs on stdout.
FROM ubuntu:24.04

RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get install -y --no-install-recommends squid tini \
  && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3128

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["-f", "/etc/squid/squid.conf", "-NYC"]
