#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"
ACTION=${1:-start}

IMAGE_REF=''

compose() {
  docker compose --project-directory "${PROJECT_DIR}" -f "${COMPOSE_FILE}" "$@"
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "错误：服务器尚未安装 Docker。" >&2
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "错误：Docker 服务未运行，或当前用户没有访问权限。" >&2
    exit 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    echo "错误：缺少 Docker Compose 插件。" >&2
    exit 1
  fi
}

pull_image() {
  echo "正在拉取 ${IMAGE_REF} ..."
  compose pull
}

wait_for_health() {
  container_id=$(compose ps -q misty-rain-video)
  if [ -z "${container_id}" ]; then
    echo "错误：容器没有成功创建。" >&2
    compose ps
    exit 1
  fi

  attempt=0
  while [ "${attempt}" -lt 30 ]; do
    health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)
    case "${health}" in
      healthy|running)
        echo "烟雨影视已启动：http://${APP_BIND:-0.0.0.0}:${APP_PORT:-5200}"
        compose ps
        return 0
        ;;
      unhealthy|exited|dead)
        echo "错误：容器状态为 ${health}。" >&2
        compose logs --tail=120 misty-rain-video
        exit 1
        ;;
    esac
    attempt=$((attempt + 1))
    sleep 2
  done

  echo "错误：等待健康检查超时。" >&2
  compose logs --tail=120 misty-rain-video
  exit 1
}

start_service() {
  if [ "${SKIP_PULL:-0}" != '1' ]; then
    pull_image
  fi
  compose up -d --remove-orphans
  wait_for_health
}

require_docker
IMAGE_REF=$(compose config --images | sed -n '1p')
if [ -z "${IMAGE_REF}" ]; then
  echo "错误：无法从 docker-compose.yml 解析镜像名称。" >&2
  exit 1
fi

case "${ACTION}" in
  start)
    start_service
    ;;
  update)
    pull_image
    compose up -d --remove-orphans
    wait_for_health
    ;;
  restart)
    compose restart misty-rain-video
    wait_for_health
    ;;
  stop)
    compose down
    ;;
  status)
    compose ps
    ;;
  logs)
    compose logs -f --tail=200 misty-rain-video
    ;;
  *)
    echo "用法：$0 {start|update|restart|stop|status|logs}" >&2
    exit 2
    ;;
esac
