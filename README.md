# Bangarr

将 Plex 的观看进度同步到 [Bangumi](https://bgm.tv/)，适合 NAS 自托管。使用 Bun + Elysia、React + Vite + shadcn，数据存储于 SQLite。

- Plex Webhook 即时同步，定时扫描补漏和导入已看历史。
- Bangumi 多账号与 Plex 用户绑定，使用个人 Token。
- 支持季度、分割放送、特别篇和电影匹配，以及人工映射、集数偏移和歧义确认。
- 任务持久化、按账号去重、有限重试和重启恢复。
- 轻量 bangumi-data 标题索引，章节和作品关系按需在线查询。

同步方向为 **Plex → Bangumi**，不会因 Plex 标记未看而撤销 Bangumi 进度。界面只有同步记录、匹配与映射、设置三个入口。

## 部署

镜像发布到 GHCR，支持 `amd64` / `arm64`。下载 [compose.yaml](compose.yaml) 和 [.env.example](.env.example)，然后运行：

```sh
cp .env.example .env
mkdir -p data
docker compose up -d
```

默认访问 `http://127.0.0.1:8000`。镜像以非 root 用户运行，确保 `data` 可由 `.env` 中的 `PUID` / `PGID` 写入（默认 `1000:1000`）。局域网访问可设置 `BIND_ADDRESS=0.0.0.0`；通过 HTTPS 反向代理时设置 `PUBLIC_ORIGIN` 和 `COOKIE_SECURE=true`。

镜像使用 Bun Alpine、Nginx 和 s6：Nginx 托管前端，Elysia 运行 API 和后台任务。运行日志可通过 `docker compose logs` 查看。

## 配置

1. 首次打开页面创建管理员，密码至少 12 个字符。
2. 在“设置 → Bangumi 账号”添加 [个人 Token](https://next.bgm.tv/demo/access-token)，绑定 Plex 用户名。Token 过期后在这里更新。
3. 在“设置 → Plex”填写地址、Token 和用户名，保存后测试连接、选择媒体库并启用主动同步。默认每 15 分钟扫描，媒体库 ID 留空表示所有电影与剧集库。
4. 点击“立即同步”导入已看历史；“重新核对全部已看”会重新检查远端进度。需要即时同步时，将页面提供的 Webhook 地址填入 Plex 的 Webhooks 设置（需要 Plex Pass）。

主动扫描读取 **Plex Token 所属用户** 的观看状态，填写用户名不会切换 Token 身份。Webhook 按事件中的用户名分发。

匹配不确定时，在“匹配与映射”确认或修正。映射季度 `-1` 表示全部季度，`0` 表示特别篇；集数偏移先应用到 Plex 集数。失败原因和重试入口位于同步记录，扫描与索引更新状态位于设置页。

标题索引首次启用后自动建立，默认每 7 天更新，失败时保留旧索引。匹配阈值、扫描频率、时区和同步策略均可在设置中修改；部署环境变量见 [.env.example](.env.example)。

## 数据与备份

数据库、标题索引和凭据加密密钥保存在 `data`（可通过 `DATA_DIR` 调整）。**停止服务后备份整个目录，包括 `secret.key`**；只备份数据库无法恢复已加密的 Token。

## 开发

Bun 版本由根目录 `package.json` 的 `packageManager` 指定，CI 和镜像构建使用同一版本。

```sh
bun install --frozen-lockfile
bun dev
```

访问 `http://127.0.0.1:5173`。Vite 代理 `/api` 到本地 Elysia；`bun start` 仅启动后端。修改数据库定义后运行 `bun db:generate` 更新初始化 SQL。

```sh
bun check
bun typecheck
bun test
bun run build
```

开发规范见 [AGENTS.md](AGENTS.md)。测试使用临时数据库和模拟接口，不修改真实 Plex / Bangumi 数据。

## 发布

GitHub Actions 使用 `GITHUB_TOKEN` 发布到 `ghcr.io/<所有者>/<仓库名>`：推送 `main` 更新 `latest`，发布 Release 使用与 Release tag 同名的镜像标签，不更新 `latest`。Actions 使用主版本标签。

通过 `.env` 的 `BANGARR_TAG` 固定版本，`BANGARR_IMAGE` 指定 fork 镜像。首次发布后，需要在 GitHub Packages 将包设为公开，或登录 GHCR 拉取私有镜像。

## 许可

[Apache License 2.0](LICENSE)。匹配参考样本的来源与版权见[样本说明](apps/server/src/modules/matching/fixtures/README.md)。
