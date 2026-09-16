# ShareTally Google 登录配置调查

调查日期：2026-09-15

本文针对 ShareTally 当前的 Clerk 集成，记录 Google 登录需要配置的控制台项目、开发/生产差异、URL 要求，以及用户截图中的 Google 错误（`Missing required parameter: client_id`）。资料只使用 Clerk、Google 官方文档和本仓库代码。

## 结论

ShareTally 不直接实现 Google OAuth。`@clerk/react` 的 `ClerkProvider` 使用 Clerk publishable key，`SignInButton` 触发 Clerk 的登录流程；Google OAuth 的 client ID 和 client secret 应配置在 Clerk Dashboard 的 Google social connection 中，而不是放进前端 `.env.local` 或生产 Compose 环境变量。代码证据见 [`client/src/main.tsx`](../client/src/main.tsx#L3-L17) 和 [`client/src/App.tsx`](../client/src/App.tsx#L15-L24)。

开发实例可以直接使用 Clerk 预配置的共享 Google OAuth credentials 和 redirect URIs，不需要自行创建 Google Cloud OAuth client。生产实例必须使用自定义 credentials：在 Clerk Dashboard 生成该实例的 Authorized Redirect URI，在 Google Cloud 创建 **Web application** OAuth client，把 Clerk URI 填入 Google 的 Authorized redirect URIs，再将 Google 返回的 Client ID 和 Client Secret 粘回 Clerk。Clerk 官方流程明确区分了这两种环境。[Clerk：Add Google as a social connection](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google)

截图中的 `Missing required parameter: client_id` 表示抵达 Google authorization endpoint 的请求缺少必需的 `client_id` 参数；它发生在 redirect URI 校验之前，不是典型的 `redirect_uri_mismatch`。结合 Clerk 的环境规则，最可能的原因是：

1. 当前使用的是 Clerk Production 实例（`pk_live_...`），但 Production Google connection 没有保存有效的自定义 Client ID/Client Secret；或
2. Clerk Dashboard 中打开了 **Use custom credentials**，但 Client ID 为空、粘贴错误或没有成功保存；或
3. 浏览器/部署使用了与预期不同的 Clerk 实例（例如把 `pk_live_...` 和 `pk_test_...`、或不同实例的 keys 混用）。

如果是在开发实例，先确认 Google connection 已启用，并让 Clerk 使用共享 credentials（不要在未填值时强制启用 custom credentials）。如果是在生产实例，按下面的生产步骤重新生成并保存 Web OAuth client，然后从 Clerk Dashboard 的 Account Portal 重新测试。不能仅凭前端已加载或页面显示了 Production key，推断 Google credentials、Clerk 域名、DNS 或回调已经完成。

## 仓库现状

| 位置 | 当前行为 | 配置含义 |
| --- | --- | --- |
| [`client/src/main.tsx`](../client/src/main.tsx#L7-L15) | 读取 `VITE_CLERK_PUBLISHABLE_KEY`，传给 `<ClerkProvider>` | 前端只需要 Clerk publishable key；没有 Google client ID 环境变量 |
| [`client/src/App.tsx`](../client/src/App.tsx#L15-L24) | 用 `SignInButton mode="modal"` / `SignUpButton mode="modal"` | Google provider 由 Clerk 登录界面提供；应用不拼 Google authorization URL |
| [`client/src/AccountCheck.tsx`](../client/src/AccountCheck.tsx#L14-L24) | `getToken()` 后以 Bearer token 请求 `/api/me` | 登录成功后由 Clerk SDK 取得 session token，再交给后端 |
| [`server/src/app.ts`](../server/src/app.ts#L10-L18) | `clerkMiddleware()` + `getAuth()` | 后端验证 Clerk token，不处理 Google 回调 |
| [`deploy/.env.production.example`](../deploy/.env.production.example#L3-L5) | `DATABASE_URL`、`CLERK_PUBLISHABLE_KEY`、`CLERK_SECRET_KEY` | 生产后端用同一 Production 实例的 Clerk keys；没有 Google OAuth secret |
| [`Dockerfile`](../Dockerfile#L29-L35) / [`deploy/publish.sh`](../deploy/publish.sh#L12-L15) | 构建时传入 `VITE_CLERK_PUBLISHABLE_KEY` | Vite 把公开 key 编进 web bundle；不要传 Clerk secret 或 Google secret |
| [`deploy/compose.yml`](../deploy/compose.yml#L19-L28) | Nginx 对外暴露宿主机 `127.0.0.1:11119` | 公开 HTTPS 域名/FRP 入口在 Compose 之外，必须确认它最终指向该端口 |

仓库的本地 key 以 `pk_test_` 开头，表示开发实例；生产示例使用 `pk_live_`。Clerk 官方说明 publishable key 的环境前缀分别对应 development/production，并且 key 用来定位应用的 Frontend API。[Clerk：How Clerk works](https://clerk.com/docs/guides/how-clerk-works/overview)

## 开发环境配置

1. 在 Clerk Dashboard 选择 **Development** 实例的 **SSO connections**。
2. 选择 **Add connection → For all users → Google**。
3. 确认 Google connection 已启用，且允许 sign-up and sign-in。
4. Development 实例保持 Clerk 的预配置共享 credentials；Clerk 官方说明开发实例使用共享 credentials 和 redirect URIs，无需 Google Cloud 额外配置。
5. 从 Clerk Dashboard 的 Account Portal 打开开发登录页测试。URL 形式类似 `https://<instance>.accounts.dev/sign-in`；以 Dashboard 显示的真实 URL 为准。[Clerk：Add Google as a social connection](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google)

本地 Vite 服务默认是 `http://localhost:5173`（见 [`client/vite.config.ts`](../client/vite.config.ts#L5-L15)）。当前实现没有把 `localhost` 作为 Google OAuth redirect URI 自己注册，因为开发时 redirect 由 Clerk 托管。若 Dashboard/Clerk 后续要求建立自定义 credentials，Google Cloud 的 JavaScript origin 应使用实际运行地址（例如 `http://localhost:5173`），但 Authorized redirect URI 仍必须复制 Clerk Dashboard 给出的完整 URI，而不是猜测应用的 `/sign-in` 或 Vite 地址。

## 生产环境配置

### A. Clerk Dashboard

1. 切换到 ShareTally 的 **Production** 实例。
2. **SSO connections → Add connection → For all users → Google**。
3. 打开 **Enable for sign-up and sign-in** 和 **Use custom credentials**。
4. 保存/复制 Clerk 显示的 **Authorized Redirect URI**。这是必须原样交给 Google Cloud 的值。

### B. Google Cloud Console

1. 选择现有 Google Cloud project，或创建专用于生产的 project。
2. 进入 **APIs & Services → Credentials → Create Credentials → OAuth client ID**。如 Google 要求，先完成 OAuth consent screen / Google Auth Platform 的应用注册。
3. Application type 选择 **Web application**。
4. **Authorized JavaScript origins** 添加真实的浏览器 origin，例如 `https://share.example.com`。每个不同的协议、主机名或端口都是不同 origin；如确实使用 `www`，另加 `https://www.example.com`。本地开发若使用该 client，则另加实际的 `http://localhost:5173`（按端口调整）。不要加路径、通配符或尾随 `/` 变体来代替正确 origin。[Clerk 官方 Google 配置](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google)；[Google：Get your Google API client ID](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid)
5. **Authorized redirect URIs** 粘贴步骤 A 保存的 Clerk Authorized Redirect URI，逐字符匹配。不要把应用首页、`http://localhost:5173`，或猜测的 `/oauth2callback` 当作 Clerk redirect URI。Google 要求 redirect URI 与 client 配置完全一致，包括 scheme（`http`/`https`）、大小写和尾随 slash；不一致会返回 `redirect_uri_mismatch`。[Google：Using OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)
6. 创建后保存 Google 生成的 **Client ID**（通常以 `.apps.googleusercontent.com` 结尾）和 **Client Secret**。

### C. 回填 Clerk 并测试

1. 回到 Clerk Dashboard 的同一个 Production Google connection。
2. 将 Google Web client 的 Client ID 和 Client Secret 分别粘入对应字段并 Save。
3. 从 Clerk Dashboard **Account Portal** 打开生产 sign-in 页面，URL 形如 `https://accounts.<your-domain>/sign-in`，再点击 Google 测试；Clerk 官方建议用 Account Portal 做最小连接测试。[Clerk：Add Google as a social connection](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google)
4. 部署 ShareTally 时确认前端 bundle 使用 Production `VITE_CLERK_PUBLISHABLE_KEY`，后端运行时 `CLERK_PUBLISHABLE_KEY` 和 `CLERK_SECRET_KEY` 属于同一个 Production 实例。生产 build 只从 Drone secret `VITE_CLERK_PUBLISHABLE_KEY` 注入公开 key，见 [`deploy/README.md`](../deploy/README.md#L29-L38)。
5. 通过实际公开 HTTPS 域名测试 ShareTally 的 Sign in、回到应用和 `/api/me`；`/api/health` 通过不等于 Google 登录已验证，仓库部署文档也明确指出二者不同。[`deploy/README.md`](../deploy/README.md#L82-L90)

## Development 与 Production 要求对照

| 项目 | Development | Production |
| --- | --- | --- |
| Clerk key | `pk_test_...` / `sk_test_...` | `pk_live_...` / `sk_live_...` |
| Google credentials | Clerk 预配置共享 credentials；通常无需 Google Cloud client | 必须自建 Google Cloud OAuth Web client |
| Clerk Google connection | 启用 Google；不要留下空的 custom credentials 配置 | 启用 Google + **Use custom credentials**，并保存 Client ID/Secret |
| Clerk 登录 URL | `https://<instance>.accounts.dev/sign-in` | `https://accounts.<production-domain>/sign-in` |
| Google redirect URI | 若使用 Clerk 默认共享配置，由 Clerk 管理 | 从 Clerk Dashboard 复制完整 Authorized Redirect URI；Google 中逐字粘贴 |
| 浏览器 origin | 本地 Vite `http://localhost:5173`（仅在自定义 Google client 需要时注册） | 真实公开 HTTPS origin；每个实际域名分别注册 |
| Consent screen | 可用于测试 | External 应用从 Testing 切到 In production；Google 说明 Testing 默认限制为最多 100 个 test users，并可能要求加入 test-user list |

Clerk 要求 Production app 使用对应的 Google OAuth app；Google Cloud 的 OAuth consent screen 发布状态需要切换到 **In production** 才适合公开用户。Clerk 官方还提醒生产 Google connection 应对应处于 In production 状态的 Google OAuth app。[Clerk：Add Google as a social connection](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google)

Google 官方 OAuth 政策还要求测试和生产使用分开的 Cloud projects，并要求 redirect URI 和 JavaScript origin 只使用自己拥有或获授权使用的域名；生产应用需要公开 homepage，且使用 HTTPS 等安全配置。[Google：OAuth 2.0 Policies](https://developers.google.com/identity/protocols/oauth2/policies)

## `client_id` 错误的排查顺序

1. **确认错误来自哪个 Clerk 环境。** 查看构建时使用的 key 前缀：本地应为 `pk_test_...`，正式部署应为 `pk_live_...`。不要把一个环境的前端 key、后端 key 或 Dashboard connection 混在一起。
2. **在同一环境的 Clerk Dashboard 打开 Google connection。** 检查 connection 已启用；Production 检查 **Use custom credentials** 下的 Client ID/Secret 均非空且已保存。开发环境若没有自定义 client，恢复使用 Clerk shared credentials。
3. **不要先改 redirect URI 来处理这个错误。** `client_id` 缺失表示授权请求缺少应用身份标识；Google 的 redirect URI 不匹配会是另一个 `redirect_uri_mismatch` 错误。先修正 Clerk credentials，再检查 URI。
4. **确认 Google client 类型和归属。** 使用 Google Cloud **Web application** client；Client ID/Secret 必须来自当前 Google project，并回填到同一个 Clerk connection。不要只创建 client 而忘记粘回 Clerk。
5. **如已重新配置仍报错，清理旧会话并重试。** 退出 Clerk、删除该站点的 Clerk/登录 cookie 或使用隐私窗口，然后从对应环境的 Account Portal/ShareTally 重新发起登录；避免使用旧标签页、旧 build 或缓存的登录链接。
6. **最后核对生产域名链路。** Clerk Production 域名、DNS/CNAME、HTTPS 终止和 FRP 必须完成；ShareTally 的 Nginx 只监听宿主机 `127.0.0.1:11119`，公开入口需正确代理到它。Clerk 的生产部署文档要求自有域名、可修改 DNS，以及生产 social sign-in credentials。[Clerk：Deploy your Clerk app to production](https://clerk.com/docs/guides/development/deployment/production)

如果按照第 2 步确认 Client ID 已保存、且请求仍缺少 `client_id`，应在 Clerk Dashboard 的 connection 详情和浏览器地址栏中记录实际环境/URL 后再进一步判断；仅凭截图无法区分“Production custom credentials 空值”和“前端使用了错误实例”这两个原因。

## 安全边界

- `VITE_CLERK_PUBLISHABLE_KEY` / Clerk publishable key 可以进入浏览器构建产物；Clerk Secret Key、Google Client Secret 不能进入前端或 Git。
- 本仓库 `.gitignore` 已忽略 `.env*`、`client_secret*.json` 等凭据文件；不要把 Google 下载的 `client_secret.json` 提交到仓库。Google 官方明确要求保护 client credentials，尤其是 client secret，并禁止提交到公开代码库。[Google：Using OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- 当前后端通过 Clerk middleware 验证 session token；没有必要为了 Google 登录再新增 `GOOGLE_CLIENT_ID` 或 `GOOGLE_CLIENT_SECRET` 环境变量。只有在未来绕过 Clerk、由应用自己实现 Google OAuth 时，才会是另一套架构和配置。

## 官方来源

- [Clerk — Add Google as a social connection](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google)：开发/生产差异、Dashboard 开关、自定义 credentials、Google Cloud Web client、origins、redirect URI、Account Portal 测试、Testing/In production。
- [Clerk — How Clerk works](https://clerk.com/docs/guides/how-clerk-works/overview)：publishable key 的用途和 development/production 实例区分。
- [Clerk — Deploy your Clerk app to production](https://clerk.com/docs/guides/development/deployment/production)：生产域名、DNS 和生产 OAuth credentials 前置条件。
- [Google — Using OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)：Web client、授权参数、redirect URI 精确匹配和 client credentials 安全。
- [Google — Get your Google API client ID](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid)：Web client 与 Authorized JavaScript origins 的配置。
- [Google — OAuth 2.0 Policies](https://developers.google.com/identity/protocols/oauth2/policies)：测试/生产 project 隔离、域名所有权、HTTPS、安全和 production app 要求。

