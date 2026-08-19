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
