# 烟雨影视

个人云端影视片库与站内播放器，分别适配桌面导航与手机交互。支持资源检索与转存、片库更新、多用户目录隔离、播放历史、画质/音轨/字幕切换，以及 iPhone Web Clip 桌面入口。

项目不提供、内置或销售影视内容，请仅管理和播放自己有权使用的资源。

## 主要功能

- 首页自动展示公开热门影视目录与海报，空片库也能选片；频道支持按需加载更多，从详情返回后保留列表和位置；点击影片可自动找源、验证并加入个人片库播放
- 手机四栏导航、全页播放器、倍速与横屏锁定，兼顾桌面布局；实现范围与验证边界见 [内容首页与观影交互](docs/cinema-ui.md)
- 电视剧、电影、综艺和动漫统一片库
- 自动识别剧集、更新集数并过滤非视频文件
- 高清、超高清、4K、音轨与字幕切换
- 续播、片头片尾跳过和自动下一集
- 宣传海报匹配、多用户登录及独立目录
- 单容器部署，对外只开放一个端口
- 默认跟随系统颜色，可手动选择暗色或浅色并记住选择
- 删除影片时同步清理对应观看记录，包含旧格式记录

## 字幕与播放偏好

播放设置中可选择浏览器提供的内嵌字幕、HLS字幕轨道，以及影片同目录或字幕目录中的VTT、SRT、ASS、SSA文件。内嵌字幕是否可用取决于浏览器、文件编码和网盘转码流；ASS/SSA按文本字幕呈现。字幕文件最大2MB，支持UTF-8、UTF-16及GBK编码。

选集保存时会保留匹配的字幕文件，选择文件夹或全部保存时按正片存储规则保存影片及匹配字幕。SUB/IDX等文件也会随匹配视频保存，当前播放器支持上述文本格式。

片头和片尾时长可分别配置为0～600秒，0表示不跳过该部分。跳过与连续播放偏好按账户保存；自动跳过会保留超过60秒的正片内容。主题和字幕语言选择在当前浏览器保存。

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

小带宽服务器可在“我的 → 播放与片库 → 网盘直连”中追加 TV 扫码认证，让支持的渐进式视频及原生 HLS 直接从网盘加载。设备兼容性、验证边界、认证服务依赖和部署步骤见 [网盘直连播放](docs/direct-playback.md)。

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

### 正片存储与自动追更

新入库、手动换源和补集均递归识别正片，只转存视频文件到影片目录，不再复制原分享目录、图片、说明文档和可识别的花絮。识别到集数时使用 `第01集.mkv` 命名，有季数/分段时使用 `第02季 第01集（上）.mkv`，保留真实扩展名。不确定集数的文件保留原名。历史嵌套目录仍可读取，不自动整理或删除；重命名失败时已存视频保留原名。

生产服务启动约 1 分钟后开始后台维护，默认每轮间隔 30 分钟，每位用户每轮最多检查 20 部到期影片。使用原片源补充缺集，不替换已保存的同集视频。连续 3 次确认来源不可用后才搜索候选，每位用户每轮最多检索 2 部影片、每部验证 5 个候选；下一轮继续后续候选，不反复限定最前 5 条。网络错误、风控、认证失败不会触发换源，临时故障逐步退避，最长间隔 6 小时。来源已确认不可用后仍按正常间隔发现候选，候选检索失败不清除原来源的失效记录。检查进度保存在持久化数据卷中，关闭网页或重启服务不会丢失。

夸克在分享令牌或目录接口用 HTTP 400、404、410、422 明确返回“好友已取消了分享”等信息时，计入来源不可用；未知 HTTP 错误、限流、提取码问题和认证失败仍按临时故障处理。升级这项错误分类修复后，旧的异常记录在首次巡检重新检查，不沿用错误分类造成的长时间退避。“自动追更”会显示确认次数、每部影片的检查时间及下次自动复查时间。

自动关联要求能核对片名、已知年份、季数和已有剧集覆盖情况；有歧义的合集、无法识别集数的内容和电影不自动换源。关联只更新后台来源记录，保留影片目录 FID、已存视频、收藏和观看记录。已有电影也不会自动保存其他画质版本。上游未更新、来源无法确认或认证失效时，不能保证即时更新；“我的 → 播放与片库 → 自动追更”可查看具体状态。

仅对有精确目录 FID 元数据的片库条目执行自动维护，避免按同名标题错配历史目录。`pnpm dev` 不启动维护；生产 `node server.js` 启动。环境变量：

使用详情页选择部分剧集或文件夹时，也只平铺保存选中范围内的正片；后续补集遵守该范围。若这类来源失效，由于新分享的文件标识不同，后台保留选择范围等待恢复，不会自动换成“保存全部”。

- `LIBRARY_AUTO_MAINTENANCE=false`：关闭后台自动维护，保留手动操作。
- `LIBRARY_MAINTENANCE_MINUTES=30`：轮次间隔（15～1440 分钟）。

依赖有效的网盘 Cookie、可用的资源检索服务和足够的网盘空间，不需要追加 TV 扫码授权。转存由网盘内部完成，不把视频下载到应用服务器。多副本部署时只能在一个实例开启维护，同一网盘也不要同时启动多个维护服务；目录互斥锁仅保护单进程。更新镜像并重建容器后生效，保留 `misty-rain-video-data` 卷。

## 更新与日志

搜索默认并行请求内置引擎的插件和频道通道，先展示已返回的候选，再自动补充其余结果。首批结果/进度默认最多等待 8 秒（`RESOURCE_SEARCH_TIMEOUT_MS`），后台任务最多运行 30 秒，慢来源不会因为首屏已返回而被取消。内置引擎正常响应后，在约 5 秒、15 秒各读取一次其已补齐的缓存（受整轮 30 秒限制），新增候选会自动出现在页面。服务器查询失败、为空或仅取得部分结果时，恢复浏览器请求既有公共备用源的路径：不阻塞已有候选，按分享链接合并结果，服务器后续响应不能覆盖补充结果。浏览器与服务器的网络出口不同，这条路径用于补充服务器无法访问的索引，不要求生产直接访问 Telegram。

浏览器补查最多等待 10 秒，同关键词请求合并，成功结果复用 5 分钟，失败后至少等待 30 秒再尝试；不会发送本站 Cookie、认证头或 Referer，本站登录失效时不补查。备用源仍须对用户网络可达并允许跨域访问，不能保证任何时候都返回固定数量。

首批结果、服务器缓存补齐和浏览器备用结果统一按片名边界过滤。例如搜索“仙逆”会保留年番、剧场版和不同画质的相关版本，剔除因“剑仙逆世”“修仙逆袭记”等字样被上游误收的其他作品；支持片名中的空格、标点和不可见字符，不按任意位置的连续两字判断相关性。推荐、最新、4K 和完整列表均排除明确标注的沙雕版、解说和混剪内容；保存分类为动漫时不混入同名短剧。添加资源时仍会读取分享内的视频文件验证链接。

内置引擎固定为官方 2026-10-12 的 amd64 镜像，源码版本 `221665fb2c9279f22af4684ea2d8c0c331eac1cc`，使用不可变镜像摘要（见 `Dockerfile`）。不再使用停留在 5 月的 `search-amd64` 镜像。默认启用 `erxiaopan`、`wanou`、`quarktv`、`quark4k`、`quarksoo`、`pansearch`、`hunhepan`；移除新引擎已不注册的 `qupanshe`、`qupansou`、`hdr4k`、`jikepan`，防止配置存在但实际未加载。显式配置 `RESOURCE_SEARCH_PLUGINS` 时以管理员配置为准，需要将 `erxiaopan` 加入列表。

镜像构建会在生产运行环境中执行 `scripts/verify-search-runtime.mjs`，只验证启动和插件注册，不搜索或操作网盘；未加载 `erxiaopan` 或配置中的插件时不发布镜像。启动日志也会列出实际加载的插件及缺失项。新引擎使用 `data/search-cache-v2`，保留旧缓存目录方便回滚；应用的旧搜索缓存会重新核对，不需要删除整个数据卷。新来源是否能从生产服务器访问仍取决于站点和网络。

“重新搜索”先读取内置引擎已经补齐的结果，再传递 `refresh=true` 刷新并合并；不会因为重跑时只返回较快的插件结果，就丢掉已找到的正篇。后续补查不强制刷新，以便读取异步完成的结果。后台自动维护等待本轮检索结束后再选择来源。

内置引擎只通过容器内回环地址通信，禁用其响应压缩，并发送 `Accept-Encoding: identity`，避开部分 PanSou 版本压缩中间件重复写正文导致的 JSON 解析错误（如 `Unexpected non-whitespace character after JSON`）。外部来源和网站对外压缩不受影响；不会截取损坏响应中的第一段 JSON 冒充完整结果。

成功检索缓存保存在数据卷的 `resource_search_cache.json`，新鲜结果复用 5 分钟，12 小时内旧结果可先展示并后台刷新；界面会说明缓存或部分结果状态，转存时仍验证分享。空结果只短暂缓存 10 秒。自动追更检索保留严格刷新策略，并为手动搜索预留并发容量。检索仍依赖上游可达性，不能保证新关键词在所有来源故障时返回结果。

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
