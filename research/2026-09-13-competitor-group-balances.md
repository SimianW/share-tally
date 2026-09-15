# 群组余额与跨群组结算：竞品官方资料

访问日期：2026-09-13

本文只记录竞品官方帮助文档、官方产品页、官方 API 文档和官方博客中的明确说法。资料没有描述的功能记为“公开资料未确认”，不把搜索不到当成“不支持”。“组内”指一个 Tricount、Settle Up group 或 Kitty；它不等同于用户账户的全部关系。

## 结论与证据范围

本次为官方文档研究，未注册账号、录入竞品账目或执行真实付款。帮助页可能随产品版本更新；没有标更新时间的页面按本次访问时内容记录。

| 产品 | 已确认的余额展示/简化方式 | 同一对人跨组展示或付清 |
| --- | --- | --- |
| Splitwise | 好友总余额，可展开各组及非群组明细；组内可开启 Simplify Debts | 官方明确支持：好友净额完全付清后，自动在相关组补记调整条目 [S1][S2][S3] |
| Tricount | 在一个 tricount 内展示余额、建议还款并记录 transfer [T1][T2] | 本次官方资料未确认 |
| Settle Up | 组内余额圈与债务列表；可关闭简化，只偿还直接债务 [U1][U2] | 本次官方资料未确认 |
| Kittysplit | 一个 Kitty 内计算还款路径，费用新增/修改后重算；支持标记结清 [K1] | 本次官方资料未确认 |

需要分开讨论三件事：跨组按人汇总显示、同一对好友跨组付款并同步结清、跨组让第三人接收付款。第一件不必依赖后两件；Splitwise 的好友净额付清，也不能当作任意跨组多人债务重排的证据。

对 ShareTally 的设计建议，而非已批准需求：可以保留 group，同时提供按人汇总和按组展开。第一版是否提供跨组净额付款应单独决定，尤其当前项目要求固定结算指令、收款人确认全额、已结算记录不可修改。竞品允许动态重算或编辑付款的流程不能直接套用。若暂不支持跨组付款，总览应清楚区分参考净额与真正需要执行的组内还款指令。

“在同一组”不是“彼此认识”的证明。如果不能接受向原本不直接欠款的人付款，需明确允许的收付款关系，或提供类似 Settle Up 的关闭简化选项；这仍需用户作产品决定。[U1]

## Splitwise：好友总余额和群组明细同时存在

当前官方帮助中心说明，网页 Dashboard 顶部显示所有好友及群组的待付、待收总额，下方按好友显示余额。点击好友后，可以看到余额由哪些共同群组及非群组费用组成。不同币种不直接合并；Dashboard 每位好友显示其最大的单币种余额，并用星号提示其他币种余额。[S1]

这直接回答了 A、B 同时在多个组的问题：总览回答“我和 B 总体还差多少”，明细回答“分别来自哪些组”，不要求用户二选一。[S1]

### 同一对好友可以跨组付清

官方给出的例子是：组 A 中你欠好友 $20，组 B 中好友欠你 $5，总体你欠好友 $15。在好友页面记录 $15 的付款后，Splitwise 会在共同群组和好友账目中自动生成 balancing entries，把双方相关余额结清。这不表示组内其他成员的债务也全部清零。[S2]

因此，在我们的同币种例子中，Costco 里 A 应付 B $30，旅行里 B 应付 A $20，按该机制可以让 A 付给 B 净额 $10，并通过组内对应的调整记录抵消余额。这里的 $30/$20/$10 是对官方 $20/$5/$15 例子的等价应用，不是本次实机测试。[S2]

边界：官方描述的是付款完全清除双方跨所有共同群组及非群组费用的余额。不能把它推广为任意部分付款都会自动按组分配。官方还提醒：删除或修改原付款，不会自动修改已生成的 balancing entries，需要手动删除相关条目。这说明跨组结清涉及可追踪的记账记录和修改规则，不能只算一个总数。[S2]

### 组内简化和跨组好友结清是两件事

Simplify Debts 在组内重新安排谁向谁付款，不改变每个人的总净余额。新增费用或付款时会重新简化，因此某两人之间的金额可能变化。不同币种分别处理。任何组员均可在群组设置中开关该功能，切换会出现在活动记录中。[S3]

这不同于 ShareTally 当前约定的“开始结算后固定还款指令”。不能直接把 Splitwise 的动态余额行为视为当前项目已批准的流程。

### 群组不是所有费用的必填项

Splitwise 当前文档也明确支持非群组费用，例如同一旅行组中两个人之间的私人借款。因此，好友总览、群组分类和非群组记账可以共存。它并没有为了提供按好友汇总就移除群组。[S5]

### 历史资料不当作当前功能证明

2012 年的官方文章还介绍过组外多人 debt shuffle，并列出“不能让用户欠一个原本不欠的人”等约束。这证明限制转账关系并不只有 group 一种办法，但本次没有验证这个高级功能在当前版本中的可用入口。不能据旧文章断言目前所有客户端都支持。[S4]

当前帮助中心已明确记载完全付清后的自动调整记录；旧反馈帮助页中“好友已清但群组仍有余额”的说明不应覆盖当前文档，也不能据此宣布现在不能跨组结清。

### Splitwise 来源

- [S1] [Can you help me understand my dashboard balances on the web app?](https://kb.splitwise.com/balances-and-expenses/can-you-help-me-understand-my-dashboard-balances-on-the-web-app)，当前官方帮助页，未标发布日期，访问于 2026-09-13。
- [S2] [What does it mean if I'm fully settled up with my friend?](https://kb.splitwise.com/balances-and-expenses/what-does-it-mean-if-im-fully-settled-up-with-my-friend)，当前官方帮助页，未标发布日期，访问于 2026-09-13。
- [S3] [What is Simplify Debts?](https://kb.splitwise.com/balances-and-expenses/what-is-simplify-debts)，当前官方帮助页，未标发布日期，访问于 2026-09-13。
- [S4] [Debts Made Simple](https://blog.splitwise.com/2012/09/14/debts-made-simple/)，官方博客，2012-09-14，仅作历史设计背景。

- [S5] [Why do I have a non-group expenses group?](https://kb.splitwise.com/groups/why-do-i-have-a-non-group-expenses-group)，当前官方帮助页，未标发布日期，访问于 2026-09-13。

## Tricount

### 余额和简化范围

Tricount 的 FAQ 把 reimbursement 计算写成两步：根据一个 tricount 中记录的费用找出多付和少付的人，再提出分配这些余额的方式，目标是减少参与者之间的付款次数。[T1] 官方帮助页也把 transfer 定义为“给定 tricount 的参与者之间”的转账，并说明建议的 reimbursement 可以在 Balances 页面直接标记为已付。[T2] 这两页支持“每个 tricount 内计算、简化并结算”的判断。

官方 FAQ 没有说明同一对人参加多个 tricount 时是否有账户级合并余额，也没有说明跨 tricount 付款会不会按多个组自动生成调整记录。因而目前只能确认组内模型，不能据此断言 Tricount 不支持跨组总额。

### 还款记录

用户可以把还款作为新的 expense 输入，再把类型切换为 transfer；也可以在 Balances 页面把应用建议的 reimbursement 直接点为 “Mark as paid”。[T2] FAQ 还说明 reimbursement 不计入 “My Total” 和 “Expenses total”，而 transfer 是参与者之间的资金转移。[T1] 这表明 Tricount 把“建议的债务”和“已发生的还款”区分开来，但公开资料没有说明标记已付后是否保留一条可编辑的独立结算记录。

### 资料来源

- [T1] [tricount FAQs](https://help.tricount.com/articles/tricount-faqs)，官方 Help Center，未标发布日期，访问于 2026-09-13。包含 reimbursement 简化逻辑、组内总额和 expense/transfer/income 定义。
- [T2] [How can I manage my tricounts and expenses?](https://help.tricount.com/articles/how-can-i-manage-my-tricounts-and-expenses)，官方 Help Center，未标发布日期，访问于 2026-09-13。包含单个 tricount 的参与人数、transfer 录入和 “Mark as paid” 步骤。
- [T3] [Glossary of terms](https://tricount.com/en-us/glossary)，tricount 官方产品页，页面版权标为 2026，访问于 2026-09-13。将 debt simplification 定义为用最少付款次数完成结算，并将 transaction history 定义为组内费用和结算的完整列表。

## Settle Up

### 余额和债务简化范围

Settle Up 的官方 Tips 页面以 group circles 展示“组内”的余额，并说其算法通过转移债务来减少人与人之间的交易次数，因此用户可能会付给自己没有直接欠过的人。用户可以在 Edit group 中关闭 debt minimization，改为只支付 direct debts。[U1] 这是明确的组内债务简化，而且简化是可按组设置的产品行为。

Settle Up 的官方 API 文档把数据分为 “Group data” 和 “User data”。文档明确写着 group data 是 “Everything related to a single group”；members 是“unique per group”；自动生成的 debts 存在 `/debts/<group_id>` 下，transactions 也按 `/transactions/<group_id>` 存放。group 对象还包含 `minimizeDebts` 设置。[U2] 因此公开数据模型明确支持多个 group，但每个 group 的参与者、交易和债务计算各有边界。

官方资料没有描述“同一对用户跨多个 group 的总余额”或跨 group 自动净额付款。API 中存在 `userGroups`，只说明用户属于哪些 group；它没有给出跨组 debts 端点或跨组结算规则。[U2] 所以对于 ShareTally 要问的跨组总额，当前结论是公开官方资料未确认，不能写成 Settle Up 一定没有该功能。

### 还款记录

API 的 transaction 类型可以是 `expense` 或 `transfer`，而 debts 是服务器自动生成的建议列表。[U2] 官方 Tips 说旧的、债务已经结清的 group 可以 archive，并建议先在 Edit group 中确认 debts 已 settled。[U1] 官方翻译项目中的英文源字符串还要求用户在 mobile 或 web app 中把 debt 标为 paid，并描述“在组内添加 transfer”的流程。[U3] 这说明产品有组内 transfer 和已结清债务的用户流程；公开主帮助页没有解释标记 paid 是否创建一条新的结算交易，或修改结算后如何重算其他 group 的余额。

### 资料来源

- [U1] [Settle Up Tips](https://settleup.io/tips)，官方产品 Tips，页脚版权 2025，访问于 2026-09-13。包含组内余额圈、债务简化开关和结清后归档。
- [U2] [Data entities](https://api.settleup.io/entities/)，Settle Up 官方 Public API 文档，未标发布日期，访问于 2026-09-13。包含按 group 存放的 members、transactions、debts，以及 `minimizeDebts` 和 `userGroups`。
- [U3] [Settle Up/Emails](https://translate.settleup.io/projects/settle-up/emails/)，Settle Up 官方 Weblate 翻译项目，英文源字符串，访问于 2026-09-13。作为产品文案证据使用，不把翻译项目当作独立功能规格。

## Kittysplit

### 余额和债务简化范围

Kittysplit 官方帮助页说明，它计算“一个组的所有债务”的最简单结算方式，并把中间清算后得到的净余额直接分配给参与者。它明确允许最终付款人向自己原本没有直接支付或借款的人付款，因为这种安排仍能让每个人支付或收到正确的总额。[K1] 官方给出的例子是：Naomi 分别欠 Jamal 和 Ella 10 欧元，Jamal 又欠 Ella 10 欧元；三笔付款可简化为 Naomi 向 Ella 支付 20 欧元。[K1]

该列表在费用新增或修改时重新计算。[K1] 所有这些说明的单位都是一个 Kitty。当前帮助页没有描述跨 Kitty 的账户级合并余额，也没有说明同一对人参加多个 Kitty 时是否会合并。因此只能确认组内简化，跨组能力未知。

Kittysplit 支持把一个 participant 设为 couple、family 或其他人数群组，并用 default shares 计算该 Kitty 中的费用。[K1] 这解决的是同一 Kitty 内的参与者建模，不是多个 Kitty 之间的好友总余额。官方 2023 年博客也明确说，若不使用该 grouped participant 选项，家庭成员会在最终计算中各自拥有余额。[K2] 这是一篇旧的官方产品公告，适合作为功能背景，当前行为仍以帮助页为准。

### 还款记录

Kittysplit 的帮助页区分三类输入：group expense、participant 间 transfer、group income；transfer 在 “Transfer” 标签中录入。[K1] 用户实际还清建议债务后，可以点击 “Mark as settled”。这会把该债务从 debt list 移除，并向 expense list 加入一条记录；官方说明这个动作只是跟踪谁已经付款。[K1] 这比单纯显示净余额更接近可审计的结算事件，该帮助页描述的是当前 Kitty 内的操作，公开资料没有说明跨 Kitty 的调整规则。

### 资料来源

- [K1] [Help](https://www.kittysplit.com/en/help)，Kittysplit 官方帮助页，未标发布日期，访问于 2026-09-13。包含组内债务简化、重算、transfer 和 “Mark as settled” 的明确说明。
- [K2] [Calculating expenses of couples or families with shared balances](https://blog.kittysplit.com/families-and-couples-with-shared-expenses/)，Kittysplit 官方博客，2023-03-03，访问于 2026-09-13。说明 grouped participants/default shares 的背景和限制，作为历史产品资料引用。
- [K3] [Easy splitting of group expenses](https://www.kittysplit.com/en/)，Kittysplit 官方产品页，未标发布日期，访问于 2026-09-13。概括“每个人欠谁”和组内 settle up 的产品流程。

## 横向记录（不作产品决策）

三家的公开资料都把债务简化描述为某个组或某个账本内的计算。Tricount 用 “given tricount”，Settle Up 的 API 直接按 `group_id` 存 debts，Kittysplit 则用一个 Kitty 作为结算单位。Tricount 和 Kittysplit 明确记录还款动作，Settle Up 的公开 API 明确记录 transfer transaction，但公开页面没有完整说明“标记已付”后如何影响其他组。以上是文档证据的边界，不是对实现能力的否定。
