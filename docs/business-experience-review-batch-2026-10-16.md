# 业务体验准确性基线：首批审核用例

状态：**两条用例均已获用户确认（2 条批准）**。适用范围为本机当前 `demo-test` 业务包；迁移到另一台电脑或新版业务源码后，须重新核对 Mock、状态枚举和页面消费链。本文件记录业务预期审核，不把代码或测试运行结果当作业务批准。

| 用例 | 准备使用的源 Scenario | 业务预期 | 审核结论 |
| --- | --- | --- | --- |
| `receipt-normal` | `正常借据可以提前结清` | 借据列表的这笔借据状态为 `0`，卡片展示借据号 `JQ20250528QJ0M00006007` 和“正常” | 已认可复用第 1 条的完整源 Scenario，包括其“可以提前结清”语义；准确率仍待运行证据验证。 |
| `receipt-overdue` | `多个优惠券提示` | 借据列表的这笔借据状态为 `1`，卡片展示借据号 `JQ20250320QG0M00003006` 和“逾期” | 已认可复用第 2 条的完整源 Scenario，包括附带的多个优惠券配置；准确率仍待运行证据验证。 |

两条的目标页面均为 `/repay/receiptList`，请求均为 `/loanNbr/loanNbr.json`。`系统繁忙` 暂列为不应出现的页面文案；是否还需排除其它错误态，请业务方补充。用例定义见 [`business-experience-cases.json`](../scripts/fixtures/business-experience-cases.json)。

## 可复核证据

- Mock 值：[`loanNbr/mock.json`](../../demo-test/src/baseTypes/api/loanNbr/loanNbr/mock.json) 中 `正常借据可以提前结清` 的首条借据号/状态在约 1529/1565 行；`多个优惠券提示` 的对应字段在约 193/229 行。
- 业务状态约定：[`repayConstants.ts`](../../demo-test/src/configs/constants/repayConstants.ts) 将 `0` 定义为正常、`1` 定义为逾期。借据列表通过 [`receipt/base.ts`](../../demo-test/src/domains/repay/domains/receipt/base.ts) 构造借据实体；[`receipt/abstract.ts`](../../demo-test/src/domains/repay/entities/receipt/abstract.ts) 把状态映射为文案；[`ReceiptItem.vue`](../../demo-test/src/views/repay/receiptList/components/ReceiptItem.vue) 在同一张卡片展示借据号与状态。
- 2026-10-16 隔离浏览器 A→B→A 实测：临时 Profile 分别选中上述两个源 Scenario，三轮均命中真实 Mock 响应、当轮证据及页面校验；DOM 检查确认同一张借据卡片上分别是指定借据号+“正常”或指定借据号+“逾期”。这是技术验收，不替代业务预期确认。复测命令：`node scripts/test-business-revision-browser.mjs`。
- 2026-10-16 双用例受控创建闭环：`DSH_RUN_BUSINESS_BROWSER_E2E=1 npx vitest run test/business-scenario-create-browser.test.ts --disableConsoleIntercept` 共用一次隔离业务服务，逐条执行分析、确认源 Scenario、创建但不自动启用、浏览器同源选择、真实 Mock 响应字段和同一借据卡片状态校验，最终预览门禁均通过。业务插件现对两条精确意图都校验源 Scenario 的首条状态与借据号。缓存已热的一次采样中，服务就绪约 9.76 秒；两条受控触发到验证分别约 1.19 秒、0.70 秒。这不包含 Agent 规划或人工等待。
- 后续补上可追溯的离线证据输出：受控测试在忽略的 `build/reports/business-create-evidence-*/` 下保存权限为仅当前用户可读的 `runs.json` 与 `links.json`，后者包含浏览器 Mock 响应和同卡片 DOM 原始文本。聚合报告校验源 Scenario、Profile、revision、请求路径和时间窗口，并把两条计为 `controlledRunOutcomes.passed=2`；自然语言 Agent 的 `completedRunOutcomes` 仍是 `passed=0, notVerified=2`。原始文件含业务 Mock 和会话信息，不得提交或直接对外分享；迁移电脑需重新采样，不能沿用本机输出。

<a id="manual-review-record"></a>

## 人工确认记录

2026-10-16：用户针对编号问题先回复“1”；在助手明确追问“你是说第 1 条认可复用……吗？”后回复“认可”。因此将 `receipt-normal` 的完整 Scenario 复用方案记为已认可。随后助手明确询问“第 2 条也认可复用带多优惠券的场景吗？”，用户回复“认可”，因此将 `receipt-overdue` 的完整 Scenario 复用方案也记为已认可。确认仅针对这两条当前业务预期及源 Scenario 的复用，不扩展到其它页面或新版业务源码。两条均尚未关联已完成的真实创建运行，聚合评估仍应为 `notVerified`。

## 审核边界和下一步

业务预期批准不等于自然语言创建准确率。受控浏览器运行已能独立关联两条用例并通过，但该测试预设意图、目标和源 Scenario；后续还须以真实 Agent 对话运行验证其自主定位和选源，再计入自然语言准确率。迁移到另一台电脑或新版业务源码时须重新核对源 Scenario 的字段及附带行为。

当前聚合评估只按页面全文查找 `visibleText`，不能单凭“正常/逾期”二字证明它和指定借据号位于同一张卡片；这次隔离浏览器脚本增加了同卡片 DOM 断言。正式准确率基线应保留这种关联证据，不能仅依赖全文命中。
