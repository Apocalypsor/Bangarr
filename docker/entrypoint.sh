#!/bin/sh
set -eu

# s6 writes supervision state here, allowing any non-root UID/GID.
services=/tmp/bangarr-services
mkdir -p "$services"
cp -R /etc/bangarr/services/. "$services/"
exec s6-svscan "$services"
