#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
IMAGE_NAME=${MSP_PYTHON_IMAGE:-msp-python-runtime:2026.09.07-1}

docker build --pull=false --tag "$IMAGE_NAME" "$SCRIPT_DIR"
docker run --rm --network none "$IMAGE_NAME" python -m pip check
