# 烟雨影视

移动优先的个人云端影视片库与站内播放器。支持资源检索与转存、片库更新、多用户目录隔离、播放历史、画质/音轨/字幕切换，以及 iPhone Web Clip 桌面入口。

项目不提供、内置或销售影视内容，请仅管理和播放自己有权使用的资源。

## 主要功能

- 电视剧、电影、综艺和动漫统一片库
- 自动识别剧集、更新集数并过滤非视频文件
- 高清、超高清、4K、音轨与字幕切换
- 续播、片头片尾跳过和自动下一集
- 宣传海报匹配、多用户登录及独立目录
- 单容器部署，对外只开放一个端口

## Docker Compose 部署

要求：Linux x86_64、Docker Engine 24+、Docker Compose v2。官方镜像为公开镜像，无需登录 GHCR。

```text
ghcr.io/holt230/misty-rain-video:amd64
```

下载仓库中的 `docker-compose.yml` 后执行：

```bash
docker compose pull
docker compose up -d
docker compose ps
curl http://127.0.0.1:5200/api/health
```

访问 `http://服务器IP:5200`。默认示例账号为 `admin / 666666`，正式开放前必须修改 `docker-compose.yml` 中的密码。

首次登录后，在“我的 → 播放认证”中提交已登录网盘网页的 Cookie，再执行片库更新。

### 可选环境变量

在 `docker-compose.yml` 同目录创建 `.env`：

```env
IMAGE_NAME=ghcr.io/holt230/misty-rain-video
IMAGE_TAG=amd64
TZ=Asia/Shanghai
APP_PUBLIC_URL=https://example.com/misty-rain/
QUARK_CONFIG_SECRET=
```

- `APP_PUBLIC_URL`：配置域名时填写完整 HTTPS 地址。
- `QUARK_CONFIG_SECRET`：可在首次认证前设置固定加密密钥；已有数据时不要随意修改。

### 多用户

用户在 `docker-compose.yml` 的 `APP_USERS_JSON` 中配置：

```yaml
APP_USERS_JSON: >-
  [
    {"username":"admin","password":"请修改密码","role":"admin","folder":"admin"},
    {"username":"family","password":"请修改密码","role":"user","folder":"family"}
  ]
```

`folder` 是用户在网盘片库中的稳定目录名。管理员可以维护播放认证，普通用户无法查看或修改认证信息。

## 数据持久化

Compose 使用唯一命名卷 `misty-rain-video-data` 持久化 `/app/data`，其中包含：

- 加密后的播放认证和密钥
- 用户片库设置及播放历史
- 海报、检索和播放缓存
- 登录会话签名密钥

更新或重建容器不会删除该数据卷。迁移服务器时应备份整个卷；删除该卷会永久清空所有运行数据。

网盘目录默认按用户隔离：

```text
烟雨影视/<用户目录>/电视剧/片名/视频文件
烟雨影视/<用户目录>/电影/片名/视频文件
烟雨影视/<用户目录>/综艺/片名/视频文件
烟雨影视/<用户目录>/动漫/片名/视频文件
```

不要把 Cookie、Token、真实密码或本地 `data/` 目录提交到 Git。

## 更新与日志

```bash
docker compose pull
docker compose up -d
docker compose logs -f --tail=200
```

`docker compose down` 只移除容器和网络，不删除命名卷。不要使用 `docker compose down -v`，除非确定要清空全部数据。

## Nginx 子路径代理

项目默认按 `/misty-rain/` 构建：

```nginx
location = /misty-rain {
    return 301 /misty-rain/;
}

location ^~ /misty-rain/ {
    proxy_pass http://127.0.0.1:5200/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Prefix /misty-rain;
    proxy_http_version 1.1;
    proxy_read_timeout 300s;
}
```

同时设置：

```env
APP_PUBLIC_URL=https://example.com/misty-rain/
```

## iPhone 桌面入口

登录页和“我的”页面提供 Web Clip 描述文件。请使用 iPhone Safari 下载，然后前往“设置 → 已下载描述文件”完成安装。生产环境建议使用 HTTPS。

## 本地开发

### 本机运行与临时外网访问

本地部署使用 Node.js，绑定 `127.0.0.1:5200`，通过 Cloudflare Quick Tunnel 提供临时 HTTPS 地址。适合先验证本人和家人的访问线路；临时服务没有可用性保证，重启后地址会变化，不作为长期视频分发方案。

首次准备需要安装依赖、构建前端，并将对应操作系统和架构的官方 `cloudflared` 可执行文件放入 `.local-runtime/cloudflared`。当前 Apple Silicon Mac 可执行：

```bash
pnpm install --frozen-lockfile
pnpm build
mkdir -p .local-runtime
curl -fL https://github.com/cloudflare/cloudflared/releases/download/2026.8.3/cloudflared-darwin-arm64.tgz -o .local-runtime/cloudflared.tgz
tar -xzf .local-runtime/cloudflared.tgz -C .local-runtime
./start-local.sh start
```

日常管理不会重复构建：

```bash
./start-local.sh start   # 后台启动；已运行时显示现有地址
./start-local.sh status  # 查看本地和临时外网地址
./start-local.sh stop   # 停止本地服务和穿透进程
```

环境配置和运行日志统一保存在项目的 `.local-runtime/` 目录。首次启动自动在 `.local-runtime/.env.local` 创建 `admin` 账号和随机密码，文件权限为仅当前用户可读写；修改密码后停止再启动。登录后仍需在“我的 → 播放认证”配置网盘 Cookie。本地 `data/` 与服务器数据独立，不会自动迁移。原生部署没有 Docker 镜像中的内置检索引擎，检索依赖远端备用源。

运行日志位于 `.local-runtime/service.log`，临时地址位于 `.local-runtime/public-url.txt`。整个 `.local-runtime/` 目录均不提交到 Git，也不进入 Docker 构建上下文。脚本不配置开机自启或防休眠；电脑需保持开机联网且不休眠。当前脚本面向 macOS/Linux，不支持 Windows 原生运行。

### 固定域名隧道

支持 Cloudflare 控制台管理的固定隧道。先完成域名接入和 Tunnel 路由配置，将隧道令牌保存到 `.local-runtime/tunnel-token.txt`（仅保存令牌本身，权限设为 `600`），然后在 `.local-runtime/.env.local` 中增加：

```env
CLOUDFLARE_TUNNEL_MODE=named
APP_PUBLIC_URL=https://linlunji.cn/misty/
APP_BASE_PATH=/misty/
```

隧道路由的源服务填写 `http://127.0.0.1:5200`，保留 `/misty` 请求路径；应用会处理此前缀并将 Cookie 限定在 `/misty/`。同一域名下的其他网站路径需要单独保留原有路由，不能直接覆盖整个域名的现有服务。

部署路径变化后需构建一次，再停止并启动本地服务：

```bash
APP_BASE_PATH=/misty/ pnpm build
./start-local.sh stop
# 等待本地服务停止后启动
./start-local.sh start
```

普通重启不会重新生成域名或隧道。固定隧道同样受 Cloudflare 视频分发政策约束。恢复临时隧道时将 `CLOUDFLARE_TUNNEL_MODE` 改为 `quick`，并移除 `APP_PUBLIC_URL`；可以保留当前子路径，若改回根路径则需同步重新构建。

### 开发模式

需要 Node.js 22 和 pnpm 10：

```bash
corepack enable
pnpm install
pnpm dev --host 127.0.0.1
```

生产构建：

```bash
pnpm build
pnpm start
```

## 免责声明

本项目仅供个人学习、技术研究和非商业用途，不提供、存储、上传、分发或销售任何影视作品及网盘资源。

- 使用者必须遵守当地法律法规、著作权规定及第三方服务协议，并确保处理的内容已获得合法授权。
- 因检索、转存、管理、播放或传播内容产生的法律责任由使用者自行承担。
- 本项目许可证只适用于项目代码，不授予影视作品、海报、字幕、音频、商标或第三方数据的使用许可。
- 第三方接口可能变更或停止服务；项目按“现状”提供，不承诺持续可用，也不对数据丢失、账号限制或服务中断负责。
- 本项目与相关平台、出品方及版权方不存在隶属、合作或授权关系。

下载、部署或使用本项目，即表示使用者理解并自行承担相应风险。

## 许可证

[Apache License 2.0](LICENSE)
