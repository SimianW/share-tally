# SSE 续接的真实实现参照

研究日期：2026-10-03。**本文是研究背景，不是已接受需求或设计决策。** ShareTally 的约束以 [issue #19](https://github.com/SimianW/share-tally/issues/19)、项目简报和已接受 ADR 为准。以下三个案例来自不同项目；它们只证明各自公开协议或所引源码版本的行为，不能据此声称“业界标准”。

## 对 ShareTally 的判断

在当前单个 Node API 进程、每组最多 16 人、SSE 只发送失效通知而由 REST 读取权威快照的条件下，“先打开新流，收到 `ready` 再关闭旧流”是合理的可选交接方式；Twitch 有类似的交接时点。不过 Twitch 拥有专用重连 URL、服务端迁移订阅的协议保证，ShareTally 没有。ShareTally 的正确性仍须依靠新流订阅后读取快照，以及跨两条流共用的读取协调器。固定在第 29 秒开新流、第 30 秒关旧流，不能保证新流在这一秒内完成鉴权、建连并收到 `ready`。

当前服务器把流的截止时间设为 `min(已验证 JWT 的 exp, 建连时刻 + 30 秒)`，到期关闭；新流是携带 Bearer token 的新 HTTP 请求。[本地服务端路由](../../server/src/app.ts)、[事件发布器](../../server/src/realtime/group-events.ts)。研究时、实施本 PR 之前，客户端每个 `connect()` 各自维护 `reading`、`dirty` 和 `AbortController`，并在 `ready` / `changed` 后读取快照；可见、联网和手动重试会先中断旧连接。[本地客户端](../../client/src/shared/api/group-sync.ts)。若直接允许两个 `connect()` 重叠，两次 REST 读取可能并发，较旧快照较晚返回而覆盖较新快照；重复通知虽没有金融写入，仍可能造成额外读取。issue #19 要求旧响应不得覆盖新状态、健康状态只在最新读取成功后恢复，因此读取序列与“脏”标记须跨连接共享。

建议先修复已确认的恢复行为：服务端明确区分正常续期和意外断线，正常续期可立即重连，真正故障保留有界退避；读取未成功或恢复失败时仍按 issue #19 显示陈旧状态。在同一压测条件下比较立即重连与有界重叠，若前者已消除约一秒的离群延迟且残余空窗符合产品目标，优先采用较简单的实现。若需要进一步消除正常前台续期的通知空窗，则采用重叠交接。现有证据支持交接机制可行，尚未证明其在本项目优于立即重连的幅度。

采用双流时，旧流保留到新流 `ready`，随后立即关闭旧流并启动或合并一次快照读取；无须为了等快照最多 15 秒而继续占用双连接。新流若迟迟未就绪，旧流也只能保留到自身的服务端截止时间，之后以重试与快照恢复，界面显示陈旧状态。可从实际截止前 3–5 秒尝试续接，再通过公网入口、包括 FRP 的故障测试调整余量；这个数值是实验起点，没有来源证明它适合所有网络。后台冻结时计时器和 fetch 回调可能暂停；返回前台时立刻重连并读取快照比假设第 29 秒计时器准时执行可靠。此段是对本项目约束的工程建议，不是外部案例的直接结论。

## 重叠实现的必要约束

- 由服务端已验证 JWT 和流上限决定实际截止时间，并提前通知续期。若缓存 token 剩余寿命不足，强制刷新并限制并发刷新，避免同一 `exp` 的短命流连续重开。
- 每个同步实例最多一个工作流和一个候选流。候选流只有收到 `ready` 后才成为工作流；随后关闭旧流，旧流的取消不能触发全局故障状态或新的重试。读取有独立于连接交接的生命周期，所有通知共用读取串行化、失效标记和过期结果检查。
- `ready` 表示订阅就绪，不表示页面数据已恢复到最新。切换必须废弃交接前过期读取，包含共享缓存里的过期请求结果，重新取得快照；读取期间的通知仍需补读。已有陈旧提示只在最新读取成功后清除。重复失效通知可合并，不需要引入金融事件重播。
- 网络或服务临时失败时，候选流失败不应影响仍健康的旧流；旧流到自身截止时间必须结束。401 应结合强制刷新是否成功区分令牌过期和登录失效；确认无访问权、组删除、退出登录或离开页面时，取消工作流、候选流、读取和续期任务，不以旧连接继续存在为理由保留访问。

“WebSocket never renewed”仅是压测条件，不能直接替代认证生命周期。Firebase 例子说明永久 transport 可以配合协议内重新鉴权，但本项目没有这个协议；当前通知加快照语义也不需要它。

## 案例一：Twitch EventSub WebSocket 的有协议保证交接

Twitch 官方 [Getting Events Using WebSockets，Reconnect message](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/#reconnect-message)（页面标注 2026-07-31，2026-10-03 读取）规定：边缘服务器更换前 30 秒发送 `session_reconnect`，给出不可修改的 `reconnect_url`；客户端立即建立新 WebSocket，但在新连接收到 `session_welcome` 前保持旧连接。新 URL 自动继承旧订阅，旧连接在新 welcome 前继续收到事件；按此流程可避免交接期间丢消息。若未及时连接新 URL 或未关闭旧连接，旧流可收到 4004 关闭帧。其 [WebSocket Messages 参考文档](https://dev.twitch.tv/docs/eventsub/websocket-reference/#notification-message)还明确说通知是至少一次投递、相同 `message_id` 可能重发，所以无缝交接并不意味恰好一次消费。

同一指南明确区分普通断线：新会话必须重新订阅，断线到重订阅期间的消息没有 replay。这是 Twitch 自己公开的边界。可借鉴的是**先确认新流已被服务端接纳、再关闭旧流**的时点；不能把 Twitch 的订阅迁移、无消息丢失保证移植到 ShareTally 的独立 SSE GET。ShareTally 的 `ready` 在服务器把响应加入订阅集合后写出；随后 REST 快照才能覆盖交接前遗漏的状态。[本地 `openEvents()`](../../server/src/realtime/group-events.ts)。

## 案例二：Firebase JavaScript SDK 在原 transport 上更新鉴权

Firebase JS SDK `@firebase/database` 源码快照 `410d6208d7f9e150bc5918e72184701229838f8d`（提交于 2026-10-02；该提交中 package 版本 `1.1.5`）的 [`PersistentConnection.ts` 第 333–408 行](https://github.com/firebase/firebase-js-sdk/blob/410d6208d7f9e150bc5918e72184701229838f8d/packages/database/src/core/PersistentConnection.ts#L333-L408)：`refreshAuthToken()` 储存新 token，已连接且 token 非空时调用 `tryAuth()`，由 `sendRequest('auth'/'gauth', {cred: token}, …)` 在现有连接上重新鉴权；清空 token 时发送 `unauth`。回调只在 token 仍是发请求时的值时处理结果，避免旧鉴权响应覆盖新状态。若鉴权失败，[第 985–1004 行](https://github.com/firebase/firebase-js-sdk/blob/410d6208d7f9e150bc5918e72184701229838f8d/packages/database/src/core/PersistentConnection.ts#L985-L1004) 关闭 transport、强制下次取新 token；真正重连时，[第 855–884 行](https://github.com/firebase/firebase-js-sdk/blob/410d6208d7f9e150bc5918e72184701229838f8d/packages/database/src/core/PersistentConnection.ts#L855-L884)先取得 token 再建立连接。[第 1035–1045 行](https://github.com/firebase/firebase-js-sdk/blob/410d6208d7f9e150bc5918e72184701229838f8d/packages/database/src/core/PersistentConnection.ts#L1035-L1045)恢复监听。

这个源码证明该 SDK 版本的连接协议能在原连接上发送鉴权命令，因此通常无需因 token 更新而拆除 transport；它不证明所有 Firebase 部署的端到端时延，也不适用于 ShareTally 当前的 HTTP SSE：ShareTally 只在新 GET 的 `Authorization` 头验证 token，没有连接内 `auth` 命令。它提醒我们：续接调度应依据**实际新 token 的有效期及服务端响应**，不能仅凭固定的 30 秒上限推断新请求可再活 30 秒。Clerk 官方 [Core 3 升级指南](https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3)说明在到期前 15 秒内，普通 `getToken()` 可立即返回缓存 token 并在后台刷新；[强制刷新指南](https://clerk.com/docs/guides/sessions/force-token-refresh)给出 `getToken({ skipCache: true })`。若旧 JWT 在第 30 秒到期，第 29 秒续接拿到同一 `exp`，新流也只剩约一秒；继续按“新流到期前一秒”续接可能密集循环。是否强制刷新，应结合服务端认证结果、Clerk SDK 当前版本和前台实测决定。研究时、实施本 PR 之前，项目的 `getToken()` 无参数，`@clerk/react` 为 6.15.1；这里引用 Clerk 文档仅作风险说明，不把它当作已完成本地实验。

Firebase 同文件 [第 742–756 行](https://github.com/firebase/firebase-js-sdk/blob/410d6208d7f9e150bc5918e72184701229838f8d/packages/database/src/core/PersistentConnection.ts#L742-L756)还在窗口重新可见且重连退避已到上限时缩短退避、必要时安排连接。它说明恢复路径可以利用可见性信号；具体策略与 ShareTally 的认证窗口不同。

## 案例三：Microsoft `fetch-event-source` 的可见性与重试策略

Microsoft `@microsoft/fetch-event-source` 源码快照 `a0529492576e094374602f24d5e64b3a271b4576`（提交于 2023-02-03；该提交 package 版本 `2.0.1`）的 [`src/fetch.ts` 第 45–84 行](https://github.com/Azure/fetch-event-source/blob/a0529492576e094374602f24d5e64b3a271b4576/src/fetch.ts#L45-L84)定义 `openWhenHidden`：默认页面隐藏即 abort 请求，重新可见时新建请求；传 `true` 才继续保持隐藏页的请求。[第 102–139 行](https://github.com/Azure/fetch-event-source/blob/a0529492576e094374602f24d5e64b3a271b4576/src/fetch.ts#L102-L139)用 fetch 建流，记录事件 `id` 并在下次重试携带 `last-event-id`；错误由 `onerror` 决定重试间隔，默认一秒。正常流结束则调用 `onclose` 并 resolve；若应用希望服务器主动关闭后继续重试，必须让 `onclose` 抛错。[README](https://github.com/Azure/fetch-event-source/blob/a0529492576e094374602f24d5e64b3a271b4576/README.md)说明它因支持自定义请求头而适用于 Bearer token 的 fetch 流。

此库展示的是客户端控制重试、可见性和事件 ID 的机制，没有保证服务端会保存历史、识别 `Last-Event-ID` 或 replay。[第 68–72、105–108 行](https://github.com/Azure/fetch-event-source/blob/a0529492576e094374602f24d5e64b3a271b4576/src/fetch.ts#L68-L72)也显示请求头只在调用开始时复制一次，之后原样用于重试；如果调用者传入 Bearer token，库本身不会重新取 token。ShareTally 的 group `changed` 没有事件 ID，也不保留历史；适用的恢复办法仍是每次新流 `ready` 后 REST 快照。研究时、实施本 PR 之前的客户端只在重新可见时主动 `retry()`，并没有隐藏时立刻中止；这是可选择的资源策略，非协议正确性缺陷。Chrome 官方 [Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)说明 frozen 页的可冻结任务（包括计时器和 fetch 回调）暂停，所以第 29 秒回调只能是前台正常运行时的近似安排。

## 需要验证的边界

1. 同一 JWT 到期前重开：记录旧、新 JWT `exp`、新流 `ready` 时间和实际截止时间；检查是否出现短寿命流或续接循环。
2. 在新流鉴权、`ready`、REST 读取的不同阶段断网或使请求延迟，验证旧流只在新流 `ready` 后关闭；两条流通知和旧 REST 响应不能覆盖最新快照。特别检查读取成功前的陈旧状态提示。
3. 后台冻结、恢复可见、服务器 30 秒到期与公网 FRP 入口的组合：验证恢复后快照补齐缺失通知、组删除与无权限响应保持访问边界。正常前台流的约一秒可见更新是目标而非传输保证。

外部材料的证据边界：Twitch 文档证明其公开协议；Firebase 与 Microsoft 链接证明指定源码提交的实现。它们都不证明 ShareTally 线上网络的延迟分布或交接成功率，这需要本项目的故障测试与观测。

本次仅评估与查阅资料，没有重新运行基准测试。对话引用的 `/tmp/rt-direct.json`、`/tmp/rt-nginx.json` 及 `server/benchmark/realtime/` 在当前环境中均不存在，因此引用的延迟和事件计数来自用户提供的结果。后续测量应同时记录遗漏通知和页面最终是否收敛到数据库最新状态；失效通知未收到不等于金融数据丢失。
