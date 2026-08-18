#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
IMAGE_NAME=${IMAGE_NAME:-}
if [ -z "${IMAGE_NAME}" ]; then
  echo "错误：请先设置 IMAGE_NAME，例如 registry.example.com/your-namespace/misty-rain-video。" >&2
  exit 1
fi
IMAGE_TAG=${1:-${IMAGE_TAG:-amd64}}
IMAGE_REF="${IMAGE_NAME}:${IMAGE_TAG}"
PLATFORM=${PLATFORM:-linux/amd64}
RESOURCE_SEARCH_IMAGE=${RESOURCE_SEARCH_IMAGE:-${IMAGE_NAME}:search-amd64}
REGISTRY_HOST=${REGISTRY_HOST:-${IMAGE_NAME%%/*}}

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "错误：Docker 服务不可用。" >&2
  exit 1
fi

echo "发布前请确认已经执行："
echo "docker login ${REGISTRY_HOST}"

echo "正在构建并推送 ${IMAGE_REF}（${PLATFORM}）..."
docker buildx build \
  --platform "${PLATFORM}" \
  --pull \
  --build-arg "RESOURCE_SEARCH_IMAGE=${RESOURCE_SEARCH_IMAGE}" \
  --provenance=false \
  --sbom=false \
  --tag "${IMAGE_REF}" \
  --push \
  "${PROJECT_DIR}"

docker buildx imagetools inspect "${IMAGE_REF}"
echo "镜像发布完成：${IMAGE_REF}"
