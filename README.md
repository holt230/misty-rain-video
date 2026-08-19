# 烟雨影视

烟雨影视是一个移动优先的个人云端影视片库与站内播放器。它把个人网盘中的电视剧、电影、综艺和动漫整理为统一片库，支持资源检索、转存、剧集更新、播放历史、画质/音轨/字幕切换，以及 iPhone Web Clip 桌面入口。

片库以个人网盘目录为唯一事实来源，网页只保存海报、分类、播放历史等辅助元数据。系统使用 Docker Compose 配置的本地账号登录，不提供公开注册入口，也不内置或售卖任何影视内容。请只管理和播放自己有权使用的资源。

## 免责声明

本项目仅供个人学习、技术研究和非商业用途，不提供、存储、上传、分发或销售任何影视作品及网盘资源，也不鼓励以任何方式获取或传播未经授权的内容。

- 使用者应遵守所在国家或地区的法律法规、著作权规定，以及相关网盘、数据源和第三方服务的用户协议。
- 使用者必须确保其检索、转存、管理和播放的内容已经获得合法授权；因使用者导入、转存、播放或传播内容产生的版权及其他法律责任，由使用者自行承担。
- 本项目的开源许可证只适用于本项目自身代码，不授予任何影视作品、海报、字幕、音频、商标、服务名称或第三方数据的版权及使用许可。
- 项目中涉及的第三方名称、接口和服务，其权利归相应权利人所有。本项目与相关平台、影视出品方及版权方不存在隶属、合作或授权关系。
- 第三方接口可能随时变更、限制或停止服务。本项目按“现状”提供，不承诺功能持续可用，也不对数据丢失、账号限制、服务中断或其他使用后果提供保证。
- 如你认为本项目中的代码、说明或相关内容侵犯了合法权益，请通过仓库 Issue 提供权利证明和具体信息，维护者核实后会及时处理。

下载、部署或使用本项目，即表示使用者已经阅读并同意自行承担相应风险。本说明不构成法律意见；对版权或合规要求存在疑问时，应咨询专业法律人士。

## 主要能力

- 移动端优先的片库、搜索、账户和全屏播放器界面。
- 搜索分享资源并转存到每个用户独立的网盘目录。
- 自动扫描真实剧集、识别最新集数并过滤非视频文件。
- HLS 同源代理播放，支持高清、超高清、4K、音轨和字幕切换。
- 播放历史、自动续播、片头片尾跳过和自动下一集。
- 自动匹配影视宣传海报，并在服务端持久化缓存。
- 多用户登录和目录隔离；管理员统一维护播放认证。
- Docker 单容器部署，内置资源检索程序，对外只暴露一个端口。

## 运行环境

推荐使用 Docker Compose 部署，服务器不需要安装 Node.js 或 pnpm。

| 项目 | 要求 |
| --- | --- |
| 操作系统 | Linux；生产环境主要面向阿里云 Linux 等常见发行版 |
| CPU 架构 | `linux/amd64`（x86_64） |
| Docker | Docker Engine 24+，并安装 Docker Compose v2 |
| 建议资源 | 1 核 CPU、1 GB 内存、至少 2 GB 可用磁盘 |
| 服务端口 | 容器内 `5173`，Compose 默认映射为主机 `5200` |
| 持久化 | 必须持久化 `/app/data` |
| 公网访问 | 推荐配置 HTTPS；iPhone 描述文件和安全会话也建议使用 HTTPS |

服务器需要能够访问 GHCR、网盘接口、资源检索源，以及海报匹配所需的豆瓣/Bangumi 服务。若服务器存在防火墙或出口代理，需要允许相关 HTTPS 请求。

## 官方镜像

| 镜像 | 平台 | 用途 |
| --- | --- | --- |
| `ghcr.io/holt230/misty-rain-video:amd64` | `linux/amd64` | 可直接运行的主应用镜像，已包含前端、API 和检索程序 |

ARM64 服务器不能直接原生运行当前镜像；需要自行构建 ARM64 主应用镜像，或启用平台模拟。生产环境建议使用 x86_64 Linux。

## Docker Compose 快速启动

服务器只需要下载仓库中的 `docker-compose.yml`，默认会拉取 `ghcr.io/holt230/misty-rain-video:amd64`，无需额外创建 `.env`。

如需覆盖镜像、时区、公开地址或固定加密密钥，可在同一目录创建可选的 `.env`：

```env
IMAGE_NAME=ghcr.io/holt230/misty-rain-video
IMAGE_TAG=amd64
TZ=Asia/Shanghai
APP_PUBLIC_URL=
QUARK_CONFIG_SECRET=
```

直接通过 `http://服务器IP:5200` 访问时可暂时留空 `APP_PUBLIC_URL`；配置域名和反向代理后，应改为实际的完整 HTTPS 地址。

官方 GHCR 主应用镜像已公开，无需登录即可拉取。如果服务器以前使用无效 Token 登录过 GHCR，可先清除旧凭证：

```bash
docker logout ghcr.io
```

确认 Compose 最终解析出的镜像地址：

```bash
docker compose config | grep 'image:'
```

正常应显示：

```text
image: ghcr.io/holt230/misty-rain-video:amd64
```

然后启动服务：

```bash
docker compose pull
docker compose up -d
docker compose ps
curl http://127.0.0.1:5200/api/health
```

默认访问地址为 `http://服务器IP:5200`。正式开放访问前，请修改 `docker-compose.yml` 中 `APP_USERS_JSON` 的默认密码；默认示例账号仅用于首次启动：

```text
账号：admin
密码：666666
```

首次登录后，进入“我的 → 播放认证”，提交已登录网盘网页的 Cookie，然后执行片库更新。Cookie 只会在服务端加密保存，不会写入镜像或浏览器存储。

> 不要把 Cookie、GitHub Token、真实密码或 `data/` 目录提交到 Git。项目已默认忽略这些运行数据。

## 登录与用户隔离

用户由 `docker-compose.yml` 中的 `APP_USERS_JSON` 配置：

```yaml
APP_USERS_JSON: >-
  [
    {"username":"admin","password":"666666","role":"admin","folder":"admin"},
    {"username":"family","password":"请改成独立密码","role":"user","folder":"family"}
  ]
```

- `role=admin` 可以配置共享的播放服务凭证；普通用户不能查看或修改凭证。
- `folder` 是该用户在云端片库中的稳定目录名。修改用户名时可保持 `folder` 不变。
- 登录使用服务端签名的 `HttpOnly` Cookie，不把密码或会话令牌写入浏览器存储。
- 连续登录失败会触发 15 分钟限流；修改用户密码并重建容器后，旧会话自动失效。
- 删除 Compose 中的用户不会自动删除其网盘目录或持久化元数据。
- 明文密码会出现在 Compose 配置和 `docker inspect` 中；具备 Docker 管理权限的用户本身等同于服务器管理员，公网部署仍应使用独立强密码。

## 片库规则

生产环境由 `LIBRARY_ROOT_FOLDER` 指定根目录，默认配置为 `烟雨影视`。旧部署也可在运行时使用 `data/library_config.json`；开源仓库不包含真实运行数据，初始配置如下：

```json
{
  "rootFolderName": "烟雨视频",
  "rootShareUrl": ""
}
```

目录结构固定为：

```text
烟雨影视/
├── admin/
│   ├── 电视剧/片名/视频文件
│   ├── 电影/片名/视频文件
│   ├── 综艺/片名/视频文件
│   ├── 动漫/片名/视频文件
│   └── _临时播放/
└── family/
    ├── 电视剧/片名/视频文件
    ├── 电影/片名/视频文件
    ├── 综艺/片名/视频文件
    ├── 动漫/片名/视频文件
    └── _临时播放/
```

搜索和播放链路：

```text
搜索片名 → 选择真实夸克分享 → 转存到 类型/片名
         → 重新扫描夸克目录 → 网页生成片库卡片
         → 点击卡片 → 读取目录内全部剧集 → 站内播放
```

- 根分享链接只用于定位片库，接口会拒绝把它当成单部影视资源转存。
- 搜索结果只有成功转存后才会进入网页列表。
- 直接粘贴普通分享链接时，服务端读取夸克分享标题作为片名，避免生成“我的网盘库”等无意义目录。
- 已入库内容播放时直接读取个人网盘，不会重复转存。
- 同一片名即使误放到多个类型目录，网页也只展示一张卡片；用户可以直接在卡片上修改展示分类，选择结果持久化到 `data/users/<folder>/library_view.json`。此操作不会移动、合并或删除网盘中的原始目录。
- 旧版 `烟雨视频/电视剧|电影|综艺|动漫` 目录只对管理员兼容可见；新转存统一进入 `烟雨影视/<用户>/类型/片名`，程序不会自动移动旧网盘目录。

## 资源检索

- 浏览器只访问本站 `/api/resource-search`，不再直接请求公共检索站或公共 CORS 代理。
- 检索引擎已直接合入主镜像，并在容器内通过回环地址工作，不依赖第二个容器、Docker DNS 或额外公网端口。
- 本站服务只保留可直接加入片库的分享结果，并负责去重、数量限制、请求超时、内存缓存和公共源兜底。
- 搜索服务缓存保存在现有 `/app/data/search-cache` 中，随 `misty-rain-video-data` 命名卷持久化。

## 宣传海报

- 网页会按“影视类型 + 片名”自动匹配影视资料库收录的宣传海报；动漫优先使用 Bangumi，其余类型优先使用豆瓣影视建议。
- 匹配和下载均由服务端完成，浏览器不会跳转到第三方页面，也没有跨域依赖。
- 海报会缓存到 `data/posters/`，匹配记录保存在 `data/media_posters.json`；Docker 部署时会随 `/app/data` 命名卷持久化。
- 首次扫描需要服务器能够访问 `api.bgm.tv`、`lain.bgm.tv`、`movie.douban.com` 和 `*.doubanio.com`。下载成功后不再依赖外部图片地址。

## 播放能力

- 移动端全屏播放器，支持 `playsinline`，不会跳转到夸克页面或离开当前系统。
- HLS 清单和视频分片通过本站同源代理访问，支持 Range 请求与短效地址自动刷新。
- 剧集、画质、分辨率、编码、音轨和字幕全部取自夸克真实响应。
- 默认优先“超高清”以控制手机流量；用户可手动切到 4K，切换时保留播放进度。
- 只有上游实际返回多个音轨时才显示音轨切换；不会伪造杜比、Atmos 或高级音频能力。
- 支持设备端音效处理：原声、对白增强、影院和夜间模式。音效使用浏览器 Web Audio 实时处理；不支持的设备自动隐藏或退回原声，用户选择会保存在浏览器本地。

## 夸克认证与数据安全

首次使用需在“夸克播放认证”中提交已登录夸克账号的 Cookie。服务端会先验证账号，再使用 AES-256-GCM 加密保存；浏览器端不会读取或返回 Cookie。

- `data/quark_config.json`：加密后的认证配置。
- `data/.quark_key`：本机生成的加密密钥。
- 生产环境可设置 `QUARK_CONFIG_SECRET`，用于派生固定密钥。
- Docker 部署必须持久化整个 `/app/data`，否则容器重建后旧凭证可能无法解密。

用户数据同时保存在：

```text
data/.auth_key
data/users/<folder>/media_cards.json
data/users/<folder>/library_view.json
data/users/<folder>/quark_playback_cache.json
```

`.auth_key` 用于签名登录会话。它和网盘凭证密钥一样必须随整个 `/app/data` 卷持久化。

## iPhone 桌面版

登录页和账户菜单提供 Apple Web Clip 描述文件：

```text
https://example.com/misty-rain/install/ios.mobileconfig
```

在 iPhone Safari 下载后，进入“设置 → 已下载描述文件 → 安装”。桌面会出现“烟雨影视”图标，之后以无 Safari 地址栏的全屏 Web Clip 启动。描述文件默认未签名；如需系统显示“已验证”，需额外使用 S/MIME 或 MDM 签名证书。

## 本地开发

源码开发环境建议使用 Node.js 22 和 pnpm 10；项目锁定的 pnpm 版本为 `10.28.1`。

```bash
corepack enable
pnpm install
pnpm dev --host 127.0.0.1
```

访问 `http://127.0.0.1:5173`。Vite 开发服务和生产服务复用同一套 `server/api.js`，避免两套接口行为不一致。

轻量校验：

```bash
pnpm exec vue-tsc --noEmit --project tsconfig.json
pnpm run verify:quark
```

本项目机器资源有限时不建议频繁执行完整构建。生产部署前再执行：

```bash
pnpm build
pnpm start
```

## Docker 部署与运维

主应用镜像已经包含前端静态文件、Node.js API 和资源检索程序。运行时只有一个容器，不需要单独启动检索服务，也不需要向公网开放检索端口。

### 更新与日志

```bash
docker compose pull
docker compose up -d
docker compose ps
docker compose logs -f --tail=200
docker compose down
```

`docker compose down` 只删除容器和网络，不会删除命名数据卷。除非明确要清空认证、片库元数据和播放历史，否则不要执行 `docker compose down -v`。

如果服务器同时保存了仓库脚本，也可以使用：

```bash
./scripts/server.sh status   # 查看状态
./scripts/server.sh logs     # 跟踪日志
./scripts/server.sh restart  # 重启现有容器
./scripts/server.sh update   # 拉取最新镜像并滚动到新版本
./scripts/server.sh stop     # 停止并移除容器，保留 data 数据
```

### 镜像拉取故障排查

如果错误地址包含 `registry-1.docker.io`，说明 Compose 没有使用 GHCR 镜像，通常是服务器上的 `docker-compose.yml` 仍是旧版，或者 shell/`.env` 中的 `IMAGE_NAME` 覆盖了默认值：

```bash
unset IMAGE_NAME IMAGE_TAG
docker compose config | grep 'image:'
```

更新为仓库最新的 `docker-compose.yml` 后，解析结果必须是：

```text
ghcr.io/holt230/misty-rain-video:amd64
```

如果 GHCR 返回 `unauthorized`，官方镜像本身不要求授权，优先清除服务器上已经失效的旧登录凭证：

```bash
docker logout ghcr.io
docker pull ghcr.io/holt230/misty-rain-video:amd64
```

如果返回连接超时、TLS 或 `connection reset`，则属于服务器到 GHCR 的网络、DNS、防火墙或代理问题，不是账号权限问题。可以分别检查：

```bash
curl -I https://ghcr.io/v2/
docker info
```

`https://ghcr.io/v2/` 返回 `401 Unauthorized` 是 Registry 未携带令牌时的标准响应，不代表公开镜像无法拉取；最终应以 `docker pull` 结果为准。

### 直接使用 Docker 启动

推荐使用 Compose。若只做临时测试，也可以直接运行主镜像：

```bash
docker run -d \
  --name misty-rain-video \
  --restart unless-stopped \
  --init \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  -p 5200:5173 \
  -e TZ=Asia/Shanghai \
  -e HOST=0.0.0.0 \
  -e PORT=5173 \
  -e LIBRARY_ROOT_FOLDER=烟雨影视 \
  -e 'APP_USERS_JSON=[{"username":"admin","password":"请修改密码","role":"admin","folder":"admin"}]' \
  -v misty-rain-video-data:/app/data \
  ghcr.io/holt230/misty-rain-video:amd64
```

直接运行和 Compose 使用同一个 `misty-rain-video-data` 命名卷；不要同时启动两个占用 `5200` 端口的实例。

### 数据持久化

所有运行数据都保存在 `/app/data`，Compose 将其映射为 `misty-rain-video-data` 命名卷，包括：

- 登录会话签名密钥；
- 加密后的播放认证与对应加密密钥；
- 每个用户的片库分类和播放历史；
- 海报、检索及短效播放缓存。

更新或重建容器不会清空命名卷。迁移服务器时必须备份整个数据卷，而不是只复制某一个 JSON 文件。认证至少依赖以下两个文件，缺一不可：

```text
data/quark_config.json
data/.quark_key
```

`misty-rain-video-data` 是当前应用唯一使用的命名数据卷，升级和重建容器时必须保留。资源检索缓存也保存在该数据卷的 `/app/data/search-cache` 目录中。

只有确定要彻底初始化系统、永久删除 Cookie、密钥、片库元数据和播放历史时，才可以执行：

```bash
docker compose down
docker volume rm misty-rain-video-data
```

`misty-rain-video-data` 删除后无法恢复。正常更新项目时不要删除该数据卷。

### Nginx 子路径代理

生产镜像默认按 `/misty-rain/` 子路径构建。Nginx 反向代理使用前缀剥离，并把公开前缀传给播放器：

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

同时将 `.env` 中的公开地址设置为完整 HTTPS 子路径：

```env
APP_PUBLIC_URL=https://example.com/misty-rain/
```

修改反向代理或环境变量后需要重新加载 Nginx 并重建容器；只修改网盘目录内容不需要重启，网页会重新扫描片库。

### 自行构建和发布镜像

开发机需要 Docker Buildx。下面示例构建 `linux/amd64` 主镜像：

```bash
export IMAGE_NAME=ghcr.io/<your-github-name>/misty-rain-video
docker login ghcr.io
./scripts/publish-image.sh amd64
```

`IMAGE_NAME` 是你自己的目标仓库。GHCR 登录使用具有 `write:packages` 权限的 GitHub Token，不要把 Token、Cookie 或密码写进 `.env`、脚本和提交记录。
