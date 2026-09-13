# Clerk 会话能力调查

调查日期：2026-09-12

2026-09-13 需求更新：项目负责人接受 7 天会话寿命，达到 7 天上限后重新登录可以接受，不再要求一个月。[规格 #1](https://github.com/SimianW/share-tally/issues/1) 和 [实现任务 #2](https://github.com/SimianW/share-tally/issues/2) 已同步更新。下文保留按原一个月要求开展的调查，因此其中“不满足要求”和升级 Pro 的讨论属于历史背景。7 天上限不再构成需求阻碍；实际部署配置、刷新和回访行为仍需验证，本次更新不代表这些验证已完成。

这份记录回答 ShareTally 的两个问题：同一浏览器能否至少一个月不例行重新登录，以及 Clerk 的会话过期、刷新、退出和撤销分别怎样工作。Google 登录已经由项目负责人在当前 Clerk 应用中验证成功；这里不重复做登录测试。

## 结论

当前 Hobby 套餐在生产环境只支持最长 7 天的登录会话，尚不满足“同一浏览器至少一个月不用重新登录”的要求。Clerk 当前公开价格页把 Hobby 的会话总寿命写成固定 7 天，把自定义会话寿命列为 Pro 功能。Clerk 的会话选项文档也说明，新实例默认启用 7 天的 Maximum lifetime，而生产环境自定义 Maximum lifetime 需要付费套餐。

用户提供的 Development 页面显示 Maximum lifetime 为 7 天，但粘贴文字没有保留开关状态。该上限启用时，即使用户每天打开 ShareTally，也会在登录后最长 7 天过期；退出、撤销或 Cookie 丢失可能使登录更早失效。把 Maximum lifetime 设为至少 35 天可以覆盖“一个月”这个自然语言要求，并给日期长度留出余量。若 Inactivity timeout 开启，它也必须设为至少 35 天；更简单的做法是关闭它。Clerk 要求 Maximum lifetime 和 Inactivity timeout 至少启用一个，所以可以保持 Maximum lifetime 开启、Inactivity timeout 关闭。

这只能保证 Clerk 配置允许这样的会话持续时间。用户主动退出、撤销会话、清除 Cookie、使用隐身窗口后关闭所有隐身窗口，或浏览器自行清理 Cookie，仍然会让用户重新登录。Clerk 还特别说明，Chrome 的 Cookie `Max-Age` 上限是 400 天。

## 当前项目和 Dashboard 观察

项目负责人提供的 Dashboard 观察值如下，属于当前账号界面的人工确认，不是我通过 Clerk 管理 API 读取的值：

| 项目 | 观察结果 | 判断 |
| --- | --- | --- |
| 应用/环境 | ShareTally，Development | 当前开发环境 |
| 计划 | Hobby | 生产环境不能使用自定义会话总寿命 |
| Maximum lifetime | 7 days；开关状态未保留；界面显示可选范围 5 minutes 至 10 years，并标有 Pro | 7 天不满足一个月；需要生产 Pro 才能选自定义值 |
| Inactivity timeout | 界面中的当前开关和时长没有被记录 | 必须确认它是关闭的，或把时长设为至少 35 天 |
| Reverification window | 10 minutes；界面显示范围 1 至 10 分钟 | 这是敏感操作重新验证窗口，不是会话总寿命 |
| Multi-session handling | 当前开关状态未记录 | 与一个浏览器同时登录多个账号有关，不影响单账号一个月会话要求 |

本地代码只把 publishable key 传给 `<ClerkProvider>`，没有在代码中覆盖会话选项。前端的 `<UserButton />` 提供 Clerk 的退出入口。`AccountCheck` 调用 `getToken()`，把返回的 session token 放进 Bearer header；Express 端用 `clerkMiddleware()` 和 `getAuth()` 验证请求。因此，Maximum lifetime、Inactivity timeout 和 Multi-session handling 的实际值都在 Clerk Dashboard，不在这个仓库里。当前代码没有实现自己的会话续期或会话状态查询。

## 过期设置和会话持续性

Clerk 有两个会话寿命设置：

* **Maximum lifetime** 是从登录开始计算的硬上限，不论用户是否一直活跃。新实例默认启用，默认值是 7 天。
* **Inactivity timeout** 是用户不活跃后过期的时间。Clerk 把“应用关闭”或“应用停止刷新 token”都视为不活跃。它默认关闭，但生产环境使用这项功能需要付费计划。

浏览器关闭后再打开时，短期 session token 可能已经过期。只要长期的客户端会话仍然有效，Clerk 的前端 SDK 会向 Clerk FAPI 请求新的 session token。对客户端渲染的应用，Clerk 文档描述的流程是：FAPI 验证浏览器里的 client token，有效时签发新的 session token，无效时转入登录流程。

这意味着“用户离开一个月后回来”受 Inactivity timeout 和 Maximum lifetime 共同约束。Maximum lifetime 设为 35 天、Inactivity timeout 关闭时，回访不会因为 inactivity 设置而过期，但仍会在登录后 35 天达到硬上限。

## Token 刷新设置

Clerk 返回给应用的 session token 是短期 JWT，有效期为 60 秒。前端 SDK 在后台每分钟刷新它，以保持用户体验连续。React `getToken()` 会使用缓存；Clerk React 文档说明缓存 TTL 为 1 分钟。`getToken({ skipCache: true })` 可以强制发起请求并签发新 token。

这个 60 秒是 token 的寿命，不是用户会话寿命。Clerk 把代表整个会话的 client token 与应用使用的 session token 分开，因而可以同时做到较长的登录会话和较短的 Bearer JWT。应用关闭时后台刷新不能运行，用户回来后由 SDK 重新向 FAPI 获取 token。

## 退出、撤销和短期窗口

Clerk 官方退出文档说明，`signOut()` 在单会话上下文中只退出当前会话，其他设备上的有效会话继续存在；多会话应用可以退出全部会话，也可以传入特定 `sessionId` 退出一个会话。项目现在使用的 `<UserButton />` 是官方预置退出 UI。

后端可以调用 `clerkClient.sessions.revokeSession(sessionId)`。官方 API 参考明确说，该调用会撤销指定会话，并让关联客户端退出。前端 `Session` 对象还提供：`end()` 将会话标记为 ended，`remove()` 将当前会话标记为 removed，后者不可撤销。官方对象参考把 expired、removed、replaced、ended、abandoned 会话都视为无效。

需要留意一个实现细节。Clerk 的架构文档指出，JWT 本身是自包含的，不能在本地被提前撤销；Clerk 通过长期 client token 保存会话状态，并让 session token 只有 60 秒寿命来缩短窗口。撤销后，客户端不能再用失效的 client token 刷出新的 session token，但一个已经发给应用、仍在 60 秒有效期内的 JWT，不能据此承诺“零延迟”失效。官方资料没有为 Bearer JWT 给出比这个 60 秒 token TTL 更精确的撤销传播保证。对 ShareTally 当前 `/api/me` 这种 `getToken()` 后发送 Bearer token 的请求，应把撤销视为会在当前短 token 到期或后续刷新时生效；如果将来保护高风险操作，需要另外决定是否在服务端查询会话状态，而不能只依赖本地 JWT 验签。

## 如以后需要满足一个月要求

如果目标只是开发环境试用，Clerk Development 可以使用付费功能来验证自定义时长。但正式部署时，Hobby 的固定 7 天会直接违反 ShareTally 的一个月会话要求。如决定保留一个月要求并继续使用 Clerk，可升级到支持自定义会话寿命的 Pro，并在 Dashboard 设置。此方案尚未实施：

1. Maximum lifetime：至少 35 days。
2. Inactivity timeout：关闭，或至少 35 days。
3. 保留至少一个寿命设置开启，符合 Clerk 的约束。
4. 用同一浏览器做一次实际回访测试，覆盖关闭标签页后重新打开、超过 60 秒 token 刷新，以及主动退出和 Dashboard 撤销。

这是“能做到”的条件；本次调查没有等待一个月，也没有替用户修改 Dashboard 设置，因此不能把长期实测结果写成已验证事实。

## 官方来源

以下页面于 2026-09-12 读取：

* [Clerk pricing](https://clerk.com/pricing)：Hobby 免费且固定 7 天；Pro 为每月 25 美元，按年付费每月 20 美元；Pro 提供自定义会话寿命。价格可能随 Clerk 调整。
* [Session options](https://clerk.com/docs/guides/secure/session-options)：Maximum lifetime、Inactivity timeout 的定义、默认值、必须至少启用一个、生产付费计划限制，以及浏览器 Cookie 行为。
* [How Clerk works](https://clerk.com/docs/guides/how-clerk-works/overview)：client token 与 60 秒 session token 的分工、每分钟刷新、关闭页面后的重新获取，以及 JWT 不能被本地提前撤销的限制。
* [React Session object](https://clerk.com/docs/react/reference/objects/session.md)：`getToken()` 的 1 分钟缓存、`end()`、`remove()` 和会话状态含义。
* [Build a custom sign-out flow](https://clerk.com/docs/guides/development/custom-flows/authentication/sign-out.md)：单会话、多会话和指定 session ID 的退出行为。
* [`revokeSession()`](https://clerk.com/docs/reference/backend/sessions/revoke-session.md)：后端撤销会话的 API 行为。
* [Instances / Environments](https://clerk.com/docs/guides/development/managing-environments.md)：Development 与 Production 的差异，以及开发环境使用独立会话架构的说明。
* [Add Google as a social connection](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google.md)：Google OAuth 社交登录的官方配置说明。
