# 用户身份 API 测试

在 `server` 目录运行：

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
```

需要 Node.js 24 和可访问的 Docker daemon。首次运行时，Testcontainers 会下载 `postgres:17.6-alpine` 镜像；已有镜像时直接复用镜像，但每次都会创建新的数据库容器。

测试不读取 `.env`，不使用开发环境的 `DATABASE_URL`。它将 `drizzle/` 中的迁移应用到临时数据库，再启动监听随机本地端口的 Node 子进程。测试结束后关闭应用、数据库连接和容器。用例按顺序运行，每个用例开始前只清空临时数据库的 `users` 表。

## 七个用例

1. 未认证请求返回 401，不创建用户。
2. 首次认证请求返回并保存应用 UUID 和对应 Clerk ID。
3. 重复请求保持相同 ID 和创建时间，数据库只有一行。
4. 六个并发首次请求全部成功，并返回同一应用身份。
5. 不同认证用户获得不同应用身份。
6. 关闭后端进程并启动新进程后，身份与创建时间保持不变。
7. query/header 中伪造的用户 ID 不能覆盖认证身份，未认证请求也不能借此登录。

## 如何读这些测试

`me.test.ts` 通过 HTTP 发起请求，并检查数据库的持久化结果。`account()` 同时检查成功响应只包含公开字段和 UUID，以及 `Cache-Control: no-store`。测试不 mock Drizzle、用户查询或 PostgreSQL。

并发用例在临时数据库建立一个 AFTER INSERT 触发器，用 advisory lock 暂停获胜的插入。测试通过 `pg_stat_activity` 确认一个请求等待 advisory lock、另外五个请求等待 transaction ID，然后释放锁。这保证测试实际覆盖未提交插入引发的唯一键竞争。触发器在 finally 中删除，不属于应用 migration。

`server-process.ts` 是测试专用入口，只识别两个固定 Bearer token。它将受控身份适配器传给 `createApp()`，替换外部认证服务。生产入口 `src/index.ts` 不传适配器，始终使用 Clerk。测试文件不包含在生产构建中，也不存在根据请求头或环境变量开启的生产认证绕过开关。

这些测试不能证明真实 Clerk token 的验签、Google 登录回调或 7 天会话配置正确；这些行为需要单独做真实认证验证。

`pnpm typecheck` 同时检查应用和测试代码。`pnpm build` 只构建 `src/`。
