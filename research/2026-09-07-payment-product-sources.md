# 付款记录与 settlement 设计：官方产品资料

研究日期：2026-09-07

## 结论

Splitwise 和 Tricount 的公开官方资料都支持“费用和付款都是持续累积的交易，余额随交易变化”的账本模型。它们仍然提供一个名为 Settle up / Transfer 的用户入口，但该入口更像是发起或记录一笔偿还，而不是把整个群组锁进一次不可变的 settlement 流程。

对 ShareTally，建议允许成员在群组仍可记账时，针对某位成员创建还款记录，并按用户提出的规则，在收款方确认后同时更新双方余额。官方资料不能单独证明“只有确认后才应改变余额”，这是本项目的产品选择。

## Splitwise：付款是独立交易，余额会随记录更新

- Splitwise 的入门说明写明：保存一笔 expense 后，所有人的余额会自动更新；准备好时点击 “Settle up”，可以还钱或记录已经收到钱。它允许记录应用外的现金/银行转账，也支持部分地区的应用内付款。来源：[How do I use Splitwise?](https://kb.splitwise.com/getting-started/how-do-i-use-splitwise)
- Splitwise 的付款说明把 “Settle Up” 描述为开始付款的入口；如果外部支付不可用，用户可以在应用外完成付款，然后使用 “Record a payment” 更新应用内余额。来源：[How do I send money to someone on Splitwise?](https://kb.splitwise.com/payment-integrations/how-do-i-send-money-to-someone-on-splitwise)
- Splitwise 的余额核对说明把“付款”列入逐行交易历史，并说明付款会影响每个人的余额；同一说明还说成员之后修改共享 expense 会造成余额变化。来源：[How can I double check my balances?](https://kb.splitwise.com/balances-and-expenses/how-can-i-double-check-my-balances)
- Splitwise 在跨群组的 “fully settled up” 情况下，会根据一笔 friendship payment 自动添加各群组的平衡条目，使各处余额归零；这说明付款记录是可被余额计算消费的账本事件，而不是只在某个静态结算批次中存在。该页同时警告：删除或编辑付款不会自动更新这些平衡条目，用户需要手动清理。这是一个实现风险：若采用动态模型，派生的清账效果必须与原付款保持可追踪关系。来源：[What does it mean if I'm 'fully settled up' with my friend?](https://kb.splitwise.com/balances-and-expenses/what-does-it-mean-if-im-fully-settled-up-with-my-friend)

## Tricount：转账/偿还是普通记录，余额持续同步

- Tricount 帮助中心说明：添加 reimbursement 的方式与添加 expense 类似，但要切换为 “transfer”；应用也可以在 Balance 页面把建议的 reimbursement 标为 “paid”。来源：[How can I manage my tricounts and expenses?](https://help.tricount.com/articles/how-can-i-manage-my-tricounts-and-expenses)
- Tricount FAQ 把流程拆成两步：先根据已记录的 expenses 判断谁多付、谁少付，再提出尽量减少交易次数的偿还方案；FAQ 也说明参与者可以共同添加 expense，并同步看到最新更新。来源：[tricount FAQs](https://help.tricount.com/articles/tricount-faqs)
- Tricount 官方术语表定义 Balance 为“所有 expense 之后的净位置”，Transfer 为“记录一笔转账以清除余额”，Transaction History 包含 expenses 和 settlements。这些定义直接支持“余额是交易历史的函数”。来源：[Glossary of Terms](https://tricount.com/glossary)
- Tricount 的官方帮助说明建议在 Expenses 或 Balance 页面下拉刷新以看到最新 expense 和余额，表明余额会因协作记录而持续更新。来源：[tricount FAQs](https://help.tricount.com/articles/tricount-faqs)

## 对 ShareTally 方案的具体启示

1. **可以保留“还款”动作，但不必保留“开启 settlement”这个群组级状态。** UI 可在某人的当前欠款旁提供“记录还款/发起还款”；后台把它写成一条有付款人、收款人、金额、时间、关联余额快照（可选）的 repayment 交易。
2. 当前净余额由已入账的账单和还款计算。新增未完成账单或单个人确认分摊不直接影响余额；具体入账条件由 ShareTally 定义。持续记账也不自动意味着旧账单可以随意修改。
3. 还款可设为 pending、confirmed 或 rejected。建议只有 confirmed 同时减少付款人的应付与收款人的应收，pending 单独展示。不能在同一套正式余额里只改变一方。官方资料没有证明跨用户确认协议。
4. **避免 Splitwise 式孤立派生条目。** 若为了跨群组归零而生成平衡条目，必须保留指向原 repayment 的关系，编辑、撤销或纠错时由系统重算；否则会出现官方文档所描述的“原付款改了，但平衡条目不会自动更新”的一致性问题。
5. **仍可提供“结算建议”视图。** Tricount 会根据当前余额提出少量转账方案，Splitwise 也有债务简化；这可以是一个随时重新计算的建议页面，而不是冻结账本的事务状态。

## 证据边界与限制

- 以上均为产品帮助中心或官网术语表，描述的是用户可见行为，不是其数据库事务或并发实现。
- 官方页面没有足够细节说明部分付款、付款编辑/撤回、重复确认、拒绝付款、离线冲突，以及收款方确认前余额应如何显示。
- Tricount 的帮助文章含有较多迁移到 bunq 后的旧/新内容，页面可能随产品更新；“mark as paid”不等同于跨账户收款方确认。
- Splitwise 的 “fully settled up” 说明明确提到派生平衡条目不会随原付款编辑自动更新；不能把该实现细节直接当作 ShareTally 的推荐方案。
- 这些资料支持动态交易账本的产品方向，但不能替代 ShareTally 对信任边界、确认权限和财务不可逆性的明确决策。

## ShareTally 的设计判断

以下是基于项目约束的建议，尚未替代现行规范。当前规则见 [ADR-0002](../docs/adr/0002-settlement-cannot-be-reversed.md) 和 [issue #1](https://github.com/SimianW/share-tally/issues/1)。

建议移除“开始全群结算”的必经步骤，保留“记录还款”和“确认收款”。群组持续记账，已完成账单和已确认还款共同决定当前余额。Settle up 可以只是还款入口的名字，这个词本身不要求冻结群组。

对经常一起去 Costco 的朋友，等全员完成一轮结算才能继续购物记账，会让收款确认变成群组的阻塞点。现行 ADR 明确承认这个阻塞可能无限持续。持续记账更适合 [项目简述](../docs/project-brief.md) 中的日常采购场景。一次性旅行、需要明确截止日期的对账才更有理由保留批次，不过这也不必禁止记录下一批开销。

### 建议的用户流程

1. 在某个群组选择收款成员，填写已经在应用外转出的金额，可附一条备注。入口文案用“记录还款”或“我已转账”，避免让人以为应用会发起银行转账。
2. 创建固定的还款记录，状态为“待收款确认”。记录群组、付款人、收款人、CAD 金额和时间。活动流显示“Simon 记录向 Jamie 还款 $30，待 Jamie 确认”。
3. Jamie 核对实际到账金额后点击“确认收到 $30”。这次确认只计入一次，付款人不能代收款人确认。
4. 更新余额和活动流。任何成员仍然可以记新账，其他还款也可以继续。

“准备付款”的建议和“已经转账”的记录要区分。前者可以随余额重算，后者的双方与金额固定。普通文本消息不能独自承担财务记录，活动流应展示结构化还款记录的状态。

这里的“随时给某个人还款”建议先限定为同一群组内的其他成员。跨群组抵销、非成员转账会引入额外归属问题，不属于这个建议的首版范围。

### 为什么不需要冻结余额

规定正余额表示应收，负余额表示应付。对每位成员：

```text
净余额 = 已入账采购垫付额 − 已入账个人分摊额
       + 已确认转出还款 − 已确认收到还款
```

这是建议模型的推导，不是对其他产品内部实现的描述。

例如，你原本欠 Jamie $100，记录已转 $30。确认之前，正式余额仍是欠 $100，同时显示“$30 待确认”。期间新增一笔你应承担 $20 的已完成账单，正式余额变成欠 $120。Jamie 确认收到原先的 $30 后，余额变为欠 $90。确认的金额始终是 $30，不会变成点击确认时的新余额。

所有成员的净余额之和应为零。还款让付款人的余额增加，让收款人的余额减少。同一采购账单可以一直保留在累计计算里，因为还款已经抵销其债务；不能再把“已还清”的账单移出同一累计计算，否则会重复抵销。

无需据此引入完整的事件溯源框架。普通关系表、明确的入账规则和事务可以承载这个设计。项目尚未批准具体 schema 和接口。

### 必须一起解决的边界

- **待确认款与重复转账。** 正式余额暂不扣款，但界面必须突出待确认金额，不能继续只提示“再付 $100”。重新生成群组还款建议时，需要考虑所有待确认转账的双方，或暂时不向涉及待确认款的成员提供自动建议。防重复请求只能防技术重试，不能防用户在银行重复转钱。
- **部分还款。** 欠 $100 可以先记录 $30，收款人确认整条 $30 记录。这允许部分偿债，同时暂不需要把单条 $30 记录拆成多次收款。它改变了现行“不追踪部分还款”的范围，必须在后续规范里明确。
- **旧建议与多付。** 新账单可能让旧建议过时。建议金额应在记录前刷新，但真实已转出的款即使大于当前欠款也不能丢掉。确认后允许余额反向，表示对方现在欠你。
- **确认失败与误操作。** 金额不符时，收款人不能直接修改金额再确认；可拒绝该记录并让付款人按实际金额重录。待确认记录的撤回或拒绝只影响应用记录，不代表银行退款。撤回与确认并发时只能有一个结果。已确认款不能静默编辑或删除，误确认的纠错方式需另定。
- **未完成账单。** 可以沿用“未完成账单不计入余额”，同时明确显示有几笔账单尚未计入。它们不再阻塞其他已完成账单的还款。
- **已入账账单修改。** 这是本次改动最重要的后续选择。当前规则会在重开账单时把它变回 incomplete，如果余额只汇总 complete 账单，原有债务就会暂时消失。需要选择稳定规则。保留修改能力时，我倾向于让旧的已确认版本继续入账，修订版全员确认后一次性替换。若首版时间不够，也可禁止修改已入账账单，但会失去当前已接受的纠错能力，不能偷偷改变。
- **账单状态。** 群组余额归零只能说明当时没有净债务，无法自动证明某笔还款对应哪张账单。首版可以展示“分摊已确认”和群组余额，取消逐张账单的 settled 推断。要标记某张账单已付清，需要额外的还款分配规则。

金额仍应遵守现行 CAD 和分精度要求。确认更新需要数据库事务、权限检查和重复请求保护；不冻结群组不意味着取消短暂的数据库并发控制。“动态”也不自动要求 WebSocket，首版可以在操作后刷新，再按实际需要增加轮询。

### 与现有仓库的关系

检查时，后端 [server/src/index.ts](../server/src/index.ts) 只有健康检查与身份接口。前端 [client/src/demo/data.ts](../client/src/demo/data.ts) 的余额来自演示账单，[DemoApp.tsx](../client/src/demo/DemoApp.tsx) 的收款确认只改变演示状态并添加活动消息，没有把还款纳入余额计算。因此当前界面不能证明任一财务流程已经实现。

如果采用本建议，需要同步修订以下现行来源：

- [CONTEXT.md](../CONTEXT.md) 中 Settlement、Repayment、Payment confirmation、Settled bill 和 Net balance 的定义。
- ADR-0002，通过后续决策明确取代其全群冻结规则，并审视 [ADR-0001](../docs/adr/0001-participants-own-their-bill-shares.md) 对账单重开和重新确认的规则。
- [规格 #1](https://github.com/SimianW/share-tally/issues/1)，以及 [#5](https://github.com/SimianW/share-tally/issues/5)、[#6](https://github.com/SimianW/share-tally/issues/6)、[#7](https://github.com/SimianW/share-tally/issues/7)、[#8](https://github.com/SimianW/share-tally/issues/8) 的纠错、还款、历史、待办及试用验收要求。
- 相关测试从“冻结与整轮完成”转为“累计余额、待确认款、重复确认、并发确认、过期建议、账单修订”。

[项目预算](../docs/project-brief.md) 上限为 30 小时。这个方案减少全群结算状态和解锁流程，但增加独立还款生命周期与动态建议的处理，不能据此断言总实现成本更低。应在上述账单修订规则选定后重新估算。

本次只形成研究建议，没有改动已接受的领域定义、ADR、GitHub issue 或应用实现。
