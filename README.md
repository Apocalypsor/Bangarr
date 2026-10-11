# Bangarr

将 Plex 的观看进度同步到 [Bangumi](https://bgm.tv/)，适合 NAS 自托管。使用 Bun + Elysia、React + Vite + shadcn，数据存储于 SQLite。

- Plex Webhook 即时同步，定时扫描补漏和导入已看历史。
- Plex 和 Bangumi 多账号，按账号多选绑定，各自保存 Token 和扫描设置。
- 支持季度、分割放送、特别篇和电影匹配，以及人工映射、集数偏移和歧义确认。
- 任务持久化、按账号去重、有限重试和重启恢复。
- 轻量 bangumi-data 标题索引，章节和作品关系按需在线查询。

## 部署

下载 [docker-compose.yaml](docker-compose.yaml) 和 [.env.example](.env.example)，然后运行：

```sh
cp .env.example .env
mkdir -p data
docker compose up -d
```

默认访问 `http://127.0.0.1:8000`。镜像以非 root 用户运行，确保 `data` 可由 `.env` 中的 `PUID` / `PGID` 写入（默认 `1000:1000`）。局域网访问可设置 `BIND_ADDRESS=0.0.0.0`；通过 HTTPS 反向代理时设置 `PUBLIC_ORIGIN` 和 `COOKIE_SECURE=true`。

## 配置

1. 首次登录使用 **`admin / admin`**。进入“设置 → 管理员”修改用户名和密码，新密码至少 12 个字符。已有管理员账号不会被重置。
2. 在“设置 → Plex”添加账号，填写服务器地址、Token 和对应用户名。填写地址和 Token 后即可测试连接、获取媒体库，无需先保存。每个账号独立选择媒体库和扫描频率，默认每 15 分钟扫描，媒体库 ID 留空表示全部电影与剧集库。
3. 在“设置 → Bangumi 账号”添加 [个人 Token](https://next.bgm.tv/demo/access-token)，勾选一个或多个 Plex 账号。Token 过期后在这里更新。已有 Plex 配置和绑定会保留。
4. 点击“立即同步”导入已看历史；“重新核对全部已看”会重新检查远端进度。需要即时同步时，将页面提供的 Webhook 地址填入 Plex 的 Webhooks 设置（需要 Plex Pass）。

## 开发

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

## 许可

[Apache License 2.0](LICENSE)
