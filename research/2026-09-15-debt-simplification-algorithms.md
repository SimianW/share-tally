# Splitwise 债务简化算法：公开资料与设计边界

访问日期：2026-09-15

本文为 issue #6 的设计说明提供研究依据。优先记录 Splitwise 官方当前帮助页、官方博客及官方人员回复；数学复杂度引用研究该问题本身的一手论文/题解。没有把第三方对 Splitwise 内部实现的猜测写成产品事实。

## 已由 Splitwise 当前资料确认的行为

当前帮助页 [S1] 将 Simplify Debts 定义为：在一个 group 内“restructures who owes whom ... to minimize the total number of payments needed for everyone to settle up”。它同时明确说“never changes anyone's total balance — it only optimizes the payment paths”。官方例子是 Anna 欠 Bob $20、Bob 欠 Charlie $20，建议 Anna 直接付 Charlie $20，Bob 归零，付款笔数少一笔。

同一页还确认：

- 新增 expense 或 payment 后会自动重新简化；所以具体两人之间的金额可能被重新安排，用户应看 total balance。
- 多币种分别在各 currency 内处理，不合并或换算。
- 任何 group member 都可以在 group settings 中切换开关；开关会记录在 Recent Activity。
- 关闭简化可能恢复原来的支付路径；如果已经按简化路径付款，之后可能需要把钱重新付给正确的人。官方说不会因此导致 overpay，但流程会混乱。

这些文字公开了目标和可观察行为，没有公开伪代码、排序规则、数据结构、时间复杂度，也没有说每个输入都得到数学意义上的全局最少笔数。因此不能据此断言当前 Splitwise 使用“最大债务人配最大债权人”的贪心算法，也不能断言它保证最优。

## 历史官方资料披露了什么

2012 年官方博客 [S2] 说，group 内的功能会把 Anna→Bob、Bob→Cathy 这样的链改成 Anna→Cathy，并以 “Fewer payments” 说明产品动机。该文还描述过两种历史能力：把同一人的多个 group 欠款合并到 one-on-one account，以及对一批不在同一 group 的好友做一次性 “debt shuffle”。文章不能证明这些旧入口仍存在于当前版本。

旧文章对跨好友的一次性 shuffle 给出三条规则：

1. Everyone owes the same net amount at the end。
2. No one owes a person that they didn't owe before。
3. No one owes more money in total than they did before the simplification。

官方人员 Ryan Laughlin 在同文评论回复 [S2a] 中澄清，**group simplification 遵守 #1 和 #3，但不一定遵守 #2**；他仍以“欠 Betty $20、Betty 欠 Carlos $20，因此直接欠 Carlos $20”为例。另一条官方回复 [S2b] 说，若 R 与 J 原本已结清，算法不会新建 R→J 的债务；官方理由是这种改动不会减少付款次数，反而会改变付款关系。这些是 2013–2014 年的历史评论，适合作为当时设计约束背景，不应覆盖当前帮助页，也不能当成当前实现的完整规格。

## 数学问题：余额相同不等于付款笔数最少

把每个人的历史债务净合并为一个 balance：约定正数表示应收、负数表示应付，所有 balance 之和为零。结算只需要生成一组转账，使每个人的最终 balance 为零；原始 IOU 的条数不是必须保留的付款条数。

对当前 issue #6，合适的候选过程是：取一个负 balance 的成员和一个正 balance 的成员，转账金额为两者绝对值的较小者；更新两人的 balance；余额归零者移出，直到所有余额归零。每一步至少使一个非零余额归零，所以若有 `k` 个非零成员，最多需要 `k - 1` 笔。用堆维护最大应付和最大应收可以做到约 `O(k log k)`；每轮线性找极值则是 `O(k²)`。这只是 ShareTally 可采用的、可解释的有效方案，**不是已证实的 Splitwise 内部算法**。

该过程保证转移的总金额达到下界：总应收额等于总应付额，且每笔转账从一个应付者流向一个应收者，因而总转账金额就是总正 balance。可是它不保证转账笔数达到全局最小。Tom Verhoeff 的论文/题解 [V1] 明确给出同一个结论：任意选择一名 debtor 与一名 creditor、转移较小余额的过程能在至多 `N - 1` 笔内结清且最小化总转账金额，但“is not guaranteed to have a minimal number of transfers”；最少笔数问题是 NP-hard，需要尝试指数数量的可能性。题解还说明，若能把余额分成 `g` 个各自和为零的子组，最多可用 `N - g` 笔；最少笔数等价于尽量找出更多这样的零和子组。

因此，issue #6 的验收条件“生成 valid transfers ... without requiring the fewest transfers”允许采用上述简单贪心过程。产品文案应说“生成可清零余额的 repayment suggestions”或“减少付款路径”，不要承诺“全局最少付款笔数”，除非未来实现并验证一个精确求解器。父任务中的工作示例可以用一个贪心结果为 4 笔、另一个可行结果为 3 笔来说明这个区别；只要正负余额守恒并全部归零，4 笔仍满足 issue #6。

## 证据范围与不确定性

- Splitwise 当前资料确认的是组内范围、净余额不变、目标是减少付款笔数、动态重算和分币种处理；未确认算法是贪心、最优、最小费用流或其他实现。
- 历史官方博客的 “as much as possible” 和“minimize”是产品目标/描述，不是复杂度证明或全局最优性证明。
- Verhoeff 的 NP-hard 结论针对允许付款关系自由重排的数学结算问题。若产品限制“只能向原本欠过的人付款”、要求保留原始边或加入 payment-method 约束，问题定义和可行解集合会改变；本次没有找到 Splitwise 官方对这些变体的复杂度说明。
- issue #6 已明确要求按单个 group 计算；跨 group 总览不能授权跨组 debt netting。Splitwise 好友总额和跨组结清属于另一个产品行为研究，不应借用本算法结论扩大 issue #6 范围。

## 来源

- [S1] Splitwise Help Center, “What is Simplify Debts?”（当前帮助页，未标发布日期）：<https://kb.splitwise.com/balances-and-expenses/what-is-simplify-debts>
- [S2] Ryan Laughlin, “Debts Made Simple”, The Splitwise Blog, 2012-09-14：<https://blog.splitwise.com/2012/09/14/debts-made-simple/>
- [S2a] Ryan Laughlin 对 group 规则的官方回复，2013-05-02，原文评论 #1927：<https://blog.splitwise.com/2012/09/14/debts-made-simple/#comment-1927>
- [S2b] Ryan Laughlin 关于不新建原已结清关系的官方回复，2014-08-04，原文评论 #9299：<https://blog.splitwise.com/2012/09/14/debts-made-simple/#comment-9299>
- [V1] Tom Verhoeff, “Settling multiple debts efficiently: an invitation to computing science”, *Informatics in Education* 3(1), 2004, pp. 105–126；作者公开题解中的算法与复杂度说明：<https://wstomv.win.tue.nl/publications/settling-debts-problems.pdf>；论文 PDF：<https://pure.tue.nl/ws/portalfiles/portal/2062204/623903.pdf>

