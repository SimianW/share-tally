# Clerk 用户与应用 users 表研究

研究日期：2026-09-12。本文记录实现前的资料和建议。带有“现状”的内容来自当前仓库，带有“建议”的内容尚未实现，也没有执行安装、迁移或数据库操作。

## 问题范围

Issue #2 要求用户用 Google 登录，在部署后的应用中看到自己的账号，并让后端把认证身份映射到持久的应用用户。重复登录必须得到同一个应用身份。API 测试应使用隔离的真实 PostgreSQL 和受控测试身份，浏览器测试另行走真实登录流程。

项目已接受 TypeScript、Express、PostgreSQL、Drizzle ORM 与 Drizzle Kit。项目简报还规定所有者亲自掌握 schema、迁移、查询和事务边界。这份笔记因此只给出可审阅的最小设计。

## 当前仓库的证据

- `server/src/index.ts` 已调用 `clerkMiddleware()`，并在 `/api/me` 中调用 `getAuth(req)`。
- 未认证请求返回 401。已认证请求目前只返回 `{ clerkUserId: userId }`，还没有数据库查询或创建。
- `client/src/AccountCheck.tsx` 在用户点击按钮后调用 `getToken()`，把 token 放入 `Authorization: Bearer ...`，然后请求 `/api/me`。登录成功本身不会自动调用该端点，因此当前创建时机是用户点击检查按钮。
- 仓库没有 `db`、Drizzle schema、`drizzle.config` 或迁移目录。`server/package.json` 的 `dev` 和 `start` 脚本使用 Node `--env-file=.env`，但这不等于单独运行 Drizzle Kit 时会加载该文件。

## 一手资料

以下链接在研究日访问，均为维护相应行为的官方文档。

1. Clerk 的 [`clerkMiddleware()` 参考](https://clerk.com/docs/reference/express/clerk-middleware.md) 说它检查请求 cookie 和 header 中的 session JWT，把 Auth 对象附加到 request，并且必须放在其他 middleware 之前。该页示例把它与 `getAuth()` 一起使用。
2. Clerk 的 [`getAuth()` 参考](https://clerk.com/docs/reference/express/get-auth.md) 说明 helper 从 request 取认证状态，示例以 `auth.isAuthenticated` 保护 Express 路由并在未登录时返回 401。认证对象提供 `userId`，可作为应用数据库的外部身份键。
3. PostgreSQL 的[事务隔离文档](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED)说明 Read Committed 是默认级别。每条 SELECT 在命令开始时取得快照，连续两条 SELECT 可以看到不同数据；`INSERT ... ON CONFLICT DO NOTHING` 可能因另一事务的结果而不插入，即使该结果对 INSERT 的快照不可见。
4. PostgreSQL 的 [`INSERT` 参考](https://www.postgresql.org/docs/current/sql-insert.html#SQL-ON-CONFLICT)说明 `ON CONFLICT DO NOTHING` 避免唯一冲突的插入，`DO UPDATE` 更新冲突行；`RETURNING` 只返回该命令实际插入或更新的行。
5. PostgreSQL 的 [`WITH` 查询文档](https://www.postgresql.org/docs/current/queries-with.html#QUERIES-WITH-MODIFYING)说明数据修改 CTE 与主查询使用同一快照，不能从目标表互相看到效果，只有 `RETURNING` 输出能传递变更。这个规则会使“插入后在同一 CTE 中从表 SELECT”无法可靠地取到并发创建的旧行。
6. PostgreSQL 的[约束文档](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-UNIQUE-CONSTRAINTS)说明 UNIQUE 约束保证一列或一组列在表内唯一，并自动创建唯一 B-tree 索引；主键列同时被强制为 NOT NULL。
7. Drizzle Kit 的 [`generate` 文档](https://orm.drizzle.team/docs/drizzle-kit-generate)说明该命令根据 Drizzle schema 生成 SQL migration，并要求 dialect 与 schema 路径或 config。Drizzle Kit 的 [`migrate` 文档](https://orm.drizzle.team/docs/drizzle-kit-migrate)说明该命令应用已生成的 SQL migration。两页都展示了 `--config` 用法。
8. Drizzle 的 [`config file` 文档](https://orm.drizzle.team/docs/drizzle-config-file)提供 `defineConfig` 配置入口。PostgreSQL 连接 URL 应由运行环境提供，不应写入提交的 schema 或 migration 文件。
9. Drizzle Kit 的 [`check` 文档](https://orm.drizzle.team/docs/drizzle-kit-check)说明该命令检查已生成 SQL migration 历史的一致性，并展示了 `--config` 用法。

## 建议的最小模型

这部分是建议，不是已完成 schema。建议表名采用 `users`，应用自己的 UUID 主键与 Clerk 的字符串身份分开。这样业务表只依赖内部 `users.id`，以后更换认证服务时不必改每个外键。

```sql
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

`clerk_user_id` 应保存 Clerk 返回的 `userId`，而不是邮箱。邮箱可能变化，也不是当前路由完成身份映射所需的数据。`NOT NULL UNIQUE` 同时防止缺少外部身份和一个 Clerk 用户生成多个应用用户。PostgreSQL 对唯一约束的行为见上面的约束文档。

现代 PostgreSQL 内置 `gen_random_uuid()`，无需为了这个默认值安装 `pgcrypto`。见 [PostgreSQL UUID 函数文档](https://www.postgresql.org/docs/current/functions-uuid.html)。实施前确认实际数据库版本。

对应的 Drizzle schema 建议如下，字段 API 见 [PostgreSQL column types](https://orm.drizzle.team/docs/column-types/pg) 和 [constraints](https://orm.drizzle.team/docs/indexes-constraints)：

```ts
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  clerkUserId: text('clerk_user_id').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
```

建议 `/api/me` 成功响应只返回应用需要的字段，例如：

```json
{
  "id": "application-user-uuid",
  "clerkUserId": "user_..."
}
```

不要把 Clerk token、secret key 或完整认证对象写入数据库或响应。认证由 Clerk middleware 校验，应用表只保存稳定的关联键。

## 建议的 `/api/me` 读写流程

先让 `clerkMiddleware()` 尽早注册，然后在路由中保留现有 `isAuthenticated` 检查。取到 `userId` 后执行以下两个数据库命令，最好封装成单一的 `getOrCreateUser(clerkUserId)` 函数：

```sql
INSERT INTO users (clerk_user_id)
VALUES ($1)
ON CONFLICT (clerk_user_id) DO NOTHING
RETURNING id, clerk_user_id, created_at;
```

1. 如果 `RETURNING` 有一行，当前请求创建了用户，直接使用它。
2. 如果没有返回行，执行独立的 SELECT：

```sql
SELECT id, clerk_user_id, created_at
FROM users
WHERE clerk_user_id = $1;
```

3. 若独立 SELECT 仍没有行，返回服务器错误并记录异常。正常的并发竞争不应走到这里。
4. 将结果映射成 API JSON。后续业务路由从应用 `users.id` 做授权查询。

在 PostgreSQL 默认 Read Committed 下，并发请求会由唯一索引仲裁。输掉竞争的 INSERT 可能因获胜事务而不返回行，随后独立 SELECT 作为新命令取得新快照并读到已提交的用户。这里依赖的是 PostgreSQL 对每条命令取快照的定义。不要把 INSERT 与 SELECT 合并进“数据修改 CTE 后从目标表读取”的写法，因为 CTE 与主查询共用一个快照。

Drizzle 的等价写法应使用 `onConflictDoNothing({ target: users.clerkUserId })` 与 `returning`，再用 `select().where(eq(...)).limit(1)` 补读。见 [Drizzle insert 文档](https://orm.drizzle.team/docs/insert)。实现时要检查返回数组是否为空，并保留参数化查询。此方案假定没有并发删除用户或修改关联键。若使用显式事务，默认隔离级别仍应是 Read Committed；若改用 Repeatable Read，可能出现序列化失败，需重试整个事务。

## `DO UPDATE` 方案及取舍

另一种建议是无意义更新：

```sql
INSERT INTO users (clerk_user_id)
VALUES ($1)
ON CONFLICT (clerk_user_id)
DO UPDATE SET clerk_user_id = EXCLUDED.clerk_user_id
RETURNING id, clerk_user_id, created_at;
```

它在冲突时更新现有行，所以可以直接依赖 `RETURNING` 得到创建或已有用户。PostgreSQL 文档明确把 `DO UPDATE` 描述为冲突行的更新，并说明在 Read Committed 下每个 proposed row 会得到 INSERT 或 UPDATE 结果。

代价是每次已存在用户访问 `/api/me` 都成为一次 UPDATE，可能产生行锁、WAL、触发器和更新时间副作用。若将来加入 `updated_at`、审计触发器或敏感权限，这些副作用会变得明显。当前低流量试用可以选择它来简化代码，但本文更建议 `DO NOTHING` 加独立 SELECT，因为它避免了无必要的写入，也把并发行为展示得更清楚。

## 建议的 generate、check、migrate 流程

以下是待执行的工作流，命令仅作记录：

1. 先准备 PostgreSQL 数据库。在 `server` 目录安装运行依赖 `pnpm add drizzle-orm pg dotenv`，以及开发依赖 `pnpm add -D drizzle-kit @types/pg`。建议采用 [node-postgres 连接方式](https://orm.drizzle.team/docs/get-started-postgresql)，在 `src/db/index.ts` 建立一个供请求复用的连接池。在 `server/src/db/schema.ts` 写完并审阅 `users` 定义，在 `server/drizzle.config.ts` 用 `defineConfig` 指定 `dialect: 'postgresql'`、schema 路径、migration 输出目录和数据库凭据。当前后端采用 NodeNext，内部模块导入沿用编译后可解析的 `.js` 扩展名。
2. 为 Drizzle Kit 配置明确的环境加载方式。当前 `server` 的 Node 脚本带 `--env-file=.env`，但 `pnpm exec drizzle-kit` 不会继承父脚本的 Node 启动参数。建议由 config 显式加载环境变量，或在 shell/CI 中注入 `DATABASE_URL`，并避免把真实值提交到仓库。
3. 在 `server` 目录执行 `pnpm exec drizzle-kit generate --config=drizzle.config.ts`。检查生成的 SQL，确认 `clerk_user_id` 的 `NOT NULL`、唯一约束和主键定义。
4. 在 `server` 目录执行 `pnpm exec drizzle-kit check --config=drizzle.config.ts`，检查已生成 migration 历史的一致性。它不能代替 SQL 审阅或验证目标数据库。确认 SQL 只创建预期表和约束，没有意外 DROP，也无需再为 `clerk_user_id` 建一个重复的普通索引。
5. 审阅通过后，先在隔离 PostgreSQL 上执行 `pnpm exec drizzle-kit migrate --config=drizzle.config.ts`，检查表和约束并完成下面的验证，再在目标环境按同一 migration 流程执行。重复运行 migrate 应无待执行变更。将 schema、生成 SQL 和 migration 元数据一起提交；本任务使用 generate/migrate，不用 push 代替可审阅迁移。本次研究没有执行这些命令。

## 验证计划

这些是建议的验收测试，不是本次研究已运行的测试：

- 未带 token、无效 token、过期 token 的 `/api/me` 都返回 401，不能创建 `users` 行。
- 同一个受控 Clerk `userId` 连续请求返回同一个应用 `id`，数据库只有一行。
- 两个并发首次请求使用同一个受控身份。两次响应都成功且 `id` 相同，唯一约束仍只有一行。测试应覆盖一个 INSERT 输掉唯一索引竞争并走独立 SELECT 的路径。
- 两个不同 Clerk `userId` 必须得到两行不同应用用户。
- 应用重启后同一身份仍映射到原行。真实浏览器测试再验证 Google 登录、返回浏览器和至少一个月的 session 配置，单次登录不能证明该要求。
- 检查日志和响应中没有 token、secret key 或无关 Clerk 私有字段。

## 尚未决定的事项

认证服务的最终选择、Google OAuth 配置、公开 HTTPS/FRP 路由、session 期限、数据库连接池、备份恢复和生产环境环境变量仍要在实现与部署阶段确认。本文只验证 Clerk Express 当前集成方式和 PostgreSQL/Drizzle 的用户持久化路径，不把这些部署结果写成已完成工作。
