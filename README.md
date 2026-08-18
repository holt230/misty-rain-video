# 烟雨影视

移动优先的个人云端影视片库与站内播放器。片库以个人网盘目录为唯一事实来源；网页只补充海报等元信息，不把本地 JSON 当作影视列表。系统使用 Docker Compose 配置的本地账号登录，不提供注册入口。

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

```bash
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

## Docker

服务器只需要复制 `docker-compose.yml`。搜索服务已集成到主应用容器。如果镜像仓库为私有仓库，先登录，然后直接启动：

```bash
export IMAGE_NAME=registry.example.com/your-namespace/misty-rain-video
docker login registry.example.com
docker compose up -d
```

服务器不需要源码、Dockerfile、Node、pnpm 或启动脚本。Compose 会直接拉取 `IMAGE_NAME` 指定的镜像，并使用 `misty-rain-video-data` 命名卷持久化登录密钥、播放认证、加密密钥和用户片库元数据。默认访问地址为 `http://服务器IP:5200`。

更新和运维：

```bash
docker compose pull
docker compose up -d
docker compose ps
docker compose logs -f --tail=200
docker compose down
```

`docker compose down` 不会删除数据卷。除非确认要清空认证和元数据，否则不要执行 `docker compose down -v`。

服务器管理命令：

```bash
./scripts/server.sh status   # 查看状态
./scripts/server.sh logs     # 跟踪日志
./scripts/server.sh restart  # 重启现有容器
./scripts/server.sh update   # 拉取最新镜像并滚动到新版本
./scripts/server.sh stop     # 停止并移除容器，保留 data 数据
```

Compose 默认使用本地镜像 `misty-rain-video:latest`。生产部署应通过 `.env` 或环境变量设置 `IMAGE_NAME`、`IMAGE_TAG`、`APP_PUBLIC_URL`；配置文件不包含任何个人域名或私有仓库地址。Compose 使用只读根文件系统、移除 Linux capabilities、限制日志大小，并只把命名数据卷挂载为可写目录。

生产镜像默认按 `/misty-rain/` 子路径构建。Nginx 反向代理使用前缀剥离，并把公开前缀传给播放器：

```nginx
location = /misty-rain {
    return 301 /misty-rain/;
}

location ^~ /misty-rain/ {
    proxy_pass http://host.docker.internal:5200/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Prefix /misty-rain;
}
```

开发机发布 AMD64 与 ARM64 多架构镜像：

```bash
export IMAGE_NAME=registry.example.com/your-namespace/misty-rain-video
export RESOURCE_SEARCH_IMAGE=registry.example.com/your-namespace/misty-rain-video:search-amd64
docker login registry.example.com
./scripts/publish-image.sh latest
```

登录时请使用镜像仓库提供的访问凭据，不要把密码写进 `.env`、脚本或提交记录。`RESOURCE_SEARCH_IMAGE` 是包含内置检索程序的构建依赖，默认使用同一镜像仓库的 `search-amd64` 标签。

迁移已经认证过的环境时，必须备份整个 `misty-rain-video-data` 数据卷。夸克认证至少依赖以下两个文件，缺一不可：

```text
data/quark_config.json
data/.quark_key
```

修改程序代码后先在开发机运行 `./scripts/publish-image.sh latest`，再在服务器运行 `./scripts/server.sh update`。修改认证密钥环境变量后需要重启服务；只修改夸克目录内容不需要重启，网页会定时重新扫描片库。
