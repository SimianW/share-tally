# ShareTally

和朋友一起买东西，分清每个人的费用，再算出谁该还谁多少钱。适合 Costco 拼单、聚餐和日常合购。

**在线使用：[sharetally.app](https://sharetally.app)**

## 怎么用

1. 登录后创建群组，通过邀请链接让朋友加入。
2. 添加账单。可以手动填写金额，也可以上传小票，识别商品后检查、修改，再发布。
3. 每个人填写并确认自己的费用，或认领商品的全部或一部分。
4. 账单完成后，查看群组余额和还款建议。
5. 在外部完成转账后，付款人记录还款，收款人确认收到，余额随之更新。

ShareTally 不代收或转移资金。目前仅支持加元 CAD，每组最多 16 人。已完成的账单不可修改；只有收款人确认的还款才会影响余额。

## 界面截图

以下为本地运行截图，使用 Alice、Bob 和 Carol 的示例数据。

### 群组账单与余额

![群组中的账单、当前余额和还款建议](docs/images/group-desktop.png)

### 手机端

<img src="docs/images/group-mobile.png" alt="手机端的群组账单与余额" width="390">

## 技术栈

- 前端：React、TypeScript、Vite、TanStack Query。
- 后端：Node.js、Express、PostgreSQL、Drizzle ORM。
- 登录：Clerk，支持 Google 登录。
- 小票：Azure Document Intelligence 识别，兼容 OpenAI 的接口辅助整理商品名称。
- 部署：Docker Compose、Nginx、Drone CI。

## 本地运行

需要 Node.js 24、pnpm 12.3.4、PostgreSQL，以及一个启用了 Google 登录的 Clerk 应用。

安装依赖：

```bash
pnpm --dir server install --frozen-lockfile
pnpm --dir client install --frozen-lockfile
```

创建 `server/.env`，填入本地数据库连接和同一个 Clerk 应用的密钥：

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/share_tally
CLERK_PUBLISHABLE_KEY=pk_test_REPLACE_ME
CLERK_SECRET_KEY=sk_test_REPLACE_ME
```

创建 `client/.env.local`：

```dotenv
VITE_CLERK_PUBLISHABLE_KEY=pk_test_REPLACE_ME
```

先创建数据库，再运行迁移：

```bash
cd server
pnpm db:migrate
pnpm dev
```

在另一个终端启动前端：

```bash
cd client
pnpm dev
```

打开 <http://localhost:5173>。前端会将 `/api` 请求转发到本地的 `3000` 端口。

小票识别还需要 Azure 和商品名称服务的配置，变量见 [生产环境配置示例](deploy/.env.production.example)。将对应的小票配置加入 `server/.env`。密钥只放在服务端，不要放入 `VITE_*` 变量或提交到 Git。

## 检查与测试

```bash
pnpm --dir client lint
pnpm --dir client build
pnpm --dir server typecheck
pnpm --dir server test
```

后端测试需要 Docker，会自动创建独立的 PostgreSQL 测试容器。浏览器测试同样需要 Docker，并需先安装 Chromium：

```bash
cd client
pnpm exec playwright install chromium
pnpm test:groups
pnpm test:receipts
```

## 项目资料

- [项目背景与开发约定](docs/project-brief.md)
- [业务术语](CONTEXT.md)
- [技术与业务决策](docs/adr/)
- [产品需求](https://github.com/SimianW/share-tally/issues/1)
- [小票识别与商品认领需求](https://github.com/SimianW/share-tally/issues/26)

线上地址为 **https://sharetally.app**。当前部署流程见 [Drone 配置](.drone.yml) 和 [Docker Compose 配置](deploy/compose.yml)。
