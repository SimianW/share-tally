# ShareTally Drone 部署

## 当前配置

每个仓库 push 都运行后端类型检查、构建和七个 PostgreSQL 集成测试，以及前端 lint/build。只有 `main` 的 push 会发布镜像和部署。功能分支不会修改生产服务；此流水线没有启用 pull request 事件。

部署沿用本机其他项目的 Drone Docker runner → GHCR → 宿主机 Compose 流程。镜像标签使用完整 commit SHA。流水线串行执行，避免两个 migration 同时运行。测试与部署失败都会让构建失败。

Dockerfile 使用 Public ECR 上的 Docker Official Images。验证时本机 Docker Hub mirror 返回 manifest 大小校验错误，改用这个地址后构建成功；未修改宿主机 Docker 全局配置。

服务布局：

| 服务 | 位置 |
| --- | --- |
| 前端 | Nginx 容器，宿主机 `127.0.0.1:11119` |
| 后端 | Node 容器，内部端口 3000，不发布宿主机端口 |
| 数据库 | 现有 PostgreSQL 服务中的 `share_tally_production` |
| 数据库账号 | 建议 `share_tally_app`，拥有该数据库 |
| 运行配置 | `/opt/repo/share-tally/.env.production` |
| Compose | `/opt/repo/share-tally/compose.yml` |
| 最近健康版本 | `/opt/repo/share-tally/.release.env` |

Nginx 提供 Vite 构建产物，并将 `/api/` 转发给后端，保持同源访问。域名和 HTTPS/FRP 由已有入口转发至 `127.0.0.1:11119`；如 FRP 客户端在容器中，这个 loopback 地址需要按其网络模式另行接入。本次没有修改域名、DNS 或 FRP。

## 首次准备

以下是上线前准备清单。配置文件存在不代表这些操作已执行。

1. 用户已确认 Drone 仓库和 Clerk Production keys 准备好。管理员还需确认 Drone 中 `SimianW/share-tally` 为 Trusted，配置文件路径为 `.drone.yml`。Host Docker socket 和 host volume 需要这个设置。仓库必须只允许可信人员推送，这种 runner 可以控制宿主机 Docker。
2. 在 Drone 仓库设置以下 secrets，保持名称与 `.drone.yml` 一致：

   | Secret | 用途 |
   | --- | --- |
   | `GHCR_USERNAME` | 有权发布 `ghcr.io/simianw` 镜像的账号 |
   | `GHCR_TOKEN` | GHCR packages 读写权限；私有仓库按实际访问需要授权 |
   | `VITE_CLERK_PUBLISHABLE_KEY` | ShareTally Production 的 `pk_live_...` 公开 key |

   Clerk secret key 不用于镜像构建，不放进前端变量。不要开启 PR 获取这些 secrets 的权限。

3. 用 PostgreSQL 管理账号创建独立账号和数据库。在已有 PostgreSQL 的管理会话中执行，先确认同名对象尚不存在：

   ```sql
   CREATE ROLE share_tally_app LOGIN;
   ```

   在 `psql` 使用交互命令设置密码，避免把密码留在 shell 历史：

   ```text
   \password share_tally_app
   ```

   再执行：

   ```sql
   CREATE DATABASE share_tally_production OWNER share_tally_app;
   REVOKE CONNECT ON DATABASE share_tally_production FROM PUBLIC;
   ```

   这个账号不需要 SUPERUSER 或 CREATEDB 权限。生产数据库不使用开发库的数据，也不运行测试的 TRUNCATE。

   当前项目负责人选择保留原数据库所有者，使用非超级用户 `share_tally_app`。这种方式同样可用，但管理员需在 `share_tally_production` 中授予表创建权限，并确认账号有数据库 CREATE 权限供 Drizzle 创建迁移 schema：

   ```sql
   GRANT CREATE ON DATABASE share_tally_production TO share_tally_app;
   GRANT USAGE, CREATE ON SCHEMA public TO share_tally_app;
   ```

   已确认该账号有数据库 CREATE 权限，并补上 public schema 的 USAGE/CREATE；未改变数据库所有者或运行生产 migration。

4. 准备宿主机配置目录和文件：

   ```bash
   sudo install -d -m 750 /opt/repo/share-tally
   sudo install -m 600 deploy/.env.production.example /opt/repo/share-tally/.env.production
   sudoedit /opt/repo/share-tally/.env.production
   ```

   上面复制命令仅用于首次准备，已有真实配置时直接编辑，避免覆盖。填写专用数据库密码、Clerk Production publishable key 和 secret key。数据库密码需 URL 编码。前后端 Clerk keys 必须属于同一个 Production 实例。

5. 确认现有 PostgreSQL 仍连接 `1panel-network`，服务名为 `1Panel-postgresql-kXBk`。API 通过这个 Docker 网络连接数据库；容器中的 `127.0.0.1` 指向自身。Compose 不创建或接管 PostgreSQL 服务。

6. 创建生产用户之前确认 Clerk Production 的 Google OAuth 和域名配置已完成。截图中出现 Production key 并不证明 Google 回调或 DNS 已完成。域名配置仍由项目负责人管理。

## 执行顺序

`deploy/check.sh` 构建测试镜像，再以 host network 和 Docker socket 运行七个测试。镜像中已有代码，不把 Drone 的 `/drone/src` 当作宿主机路径挂载。Testcontainers 创建的数据库端口通过 `TESTCONTAINERS_HOST_OVERRIDE=127.0.0.1` 访问，只适用于这里的 Linux host-network 方案。

`deploy/publish.sh` 构建 API 和 Web 镜像，前端公开 key 在构建时注入，然后推送 SHA 标签到 GHCR。后端镜像只含生产依赖、构建代码和 migration；测试身份入口不在生产镜像中。

`deploy/deploy.sh` 从当前 Drone checkout 复制 Compose 文件，拉取 SHA 镜像，运行 `node dist/migrate.js`，最后 `docker compose up --detach --wait`。migration 失败时不会更新应用容器。健康检查包括经过 Nginx 的 `/api/health`，但不等同于真实 Google 登录测试。健康检查通过后记录 `.release.env`。

已有应用运行期间执行的 migration 应兼容旧版本。此初始 migration 只创建用户表。后续破坏性 schema 变更需另行设计上线顺序。

## 查看状态和恢复旧版本

在宿主机：

```bash
cd /opt/repo/share-tally
docker compose --env-file .release.env ps
docker compose --env-file .release.env logs --tail=100 api web
curl --fail http://127.0.0.1:11119/api/health
```

恢复应用版本时，选择已经构建且与当前数据库兼容的旧 SHA：

```bash
export IMAGE_TAG=<previous-tested-commit-sha>
docker compose pull
docker compose up --detach --wait --wait-timeout 120
printf 'IMAGE_TAG=%s\n' "$IMAGE_TAG" > .release.env
```

镜像回退不会撤销数据库 migration。数据库备份、恢复演练和公开域名真实登录验证仍是 Issue #2 的剩余验收工作。

## 本地检查

```bash
drone lint --trusted .drone.yml
sh -n deploy/check.sh deploy/publish.sh deploy/deploy.sh
sh deploy/check.sh
```

`deploy/check.sh` 不需要生产密钥；前端检查使用无法登录的合成公开 key。实际发布需要 Drone secrets。不要在本地执行 publish/deploy 脚本来代替配置验证，除非当前任务确实要求发布或部署。

2026-09-13 已验证：Drone lint、Compose 配置解析、shell 语法、后端类型检查和构建、前端 lint/build、容器内七个 API 测试。API/Web 生产镜像在隔离数据库中通过启动检查，连续执行两次 migration 只有一条迁移记录；Nginx 的 `/` 和 `/api/health` 返回 200，未登录 `/api/me` 返回 401。临时容器已清理。尚未执行 GHCR 发布、真实 Drone 构建或生产部署。
