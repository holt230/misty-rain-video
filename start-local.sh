#!/bin/sh
set -eu
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "${PROJECT_DIR}/scripts/local-access.mjs" "${1:-start}"
