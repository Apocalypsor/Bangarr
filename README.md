# Bangarr

将 Plex 的观看进度同步到 [Bangumi](https://bgm.tv/)，适合 NAS 自托管。使用 Bun + Elysia、React + Vite + shadcn，数据存储于 SQLite。

- Plex Webhook 即时同步，定时扫描补漏和导入已看历史。
- Plex 和 Bangumi 多账号，按账号多选绑定，各自保存 Token 和扫描设置。
- 支持季度、分割放送、特别篇和电影匹配，以及人工映射、集数偏移和歧义确认。
- 任务持久化、按账号去重、有限重试和重启恢复。
- 轻量 bangumi-data 标题索引，章节和作品关系按需在线查询。

同步方向为 **Plex → Bangumi**，不会因 Plex 标记未看而撤销 Bangumi 进度。“任务”只显示等待执行、执行中和等待重试的任务，结束后自动移出；“同步记录”保留每次同步的成功、失败、已忽略和待确认结果。失败重试会创建新任务，原记录保留；需要人工确认的作品在“匹配与映射”处理。

确认匹配时会列出待同步集数，可展开查看各集对应的 Plex 和 Bangumi 账号。候选项提供原名、放送日期和 Bangumi 链接，核对后再选择。

手动确认后按所选条目和集数偏移匹配，Plex 与 Bangumi 日期不一致不会再次触发确认；找不到对应章节时会提示检查条目或偏移。自定义映射开启“自动识别季度”时仍会沿系列关系匹配。

## 部署

镜像发布到 GHCR，支持 `amd64` / `arm64`。下载 [docker-compose.yaml](docker-compose.yaml) 和 [.env.example](.env.example)，然后运行：

```sh
cp .env.example .env
mkdir -p data
docker compose up -d
```

默认访问 `http://127.0.0.1:8000`。镜像以非 root 用户运行，确保 `data` 可由 `.env` 中的 `PUID` / `PGID` 写入（默认 `1000:1000`）。局域网访问可设置 `BIND_ADDRESS=0.0.0.0`；通过 HTTPS 反向代理时设置 `PUBLIC_ORIGIN` 和 `COOKIE_SECURE=true`。

镜像使用 Bun Alpine、Nginx 和 s6：Nginx 托管前端，Elysia 运行 API 和后台任务。运行日志可通过 `docker compose logs` 查看。

## 配置

1. 首次登录使用 **`admin / admin`**。进入“设置 → 管理员”修改用户名和密码，新密码至少 12 个字符。已有管理员账号不会被重置。
2. 在“设置 → Plex”添加账号，填写服务器地址、Token 和对应用户名。填写地址和 Token 后即可测试连接、获取媒体库，无需先保存。每个账号独立选择媒体库和扫描频率，默认每 15 分钟扫描，媒体库 ID 留空表示全部电影与剧集库。
3. 在“设置 → Bangumi 账号”添加 [个人 Token](https://next.bgm.tv/demo/access-token)，勾选一个或多个 Plex 账号。Token 过期后在这里更新。已有 Plex 配置和绑定会保留。
4. 点击“立即同步”导入已看历史；“重新核对全部已看”会重新检查远端进度。需要即时同步时，将页面提供的 Webhook 地址填入 Plex 的 Webhooks 设置（需要 Plex Pass）。

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
