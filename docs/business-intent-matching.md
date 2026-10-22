# 声明式业务意图与原始需求分离

目的：修复“已声明业务意图后附加对象、验收要求和操作约束，整段 query 不再等于 intentEquals，导致语义规则未启用”的缺口。公共能力由 Desktop 实现，业务插件逐条显式开启；不自动理解任意自然语言，不更改业务字段或来源批准范围。

## 插件声明与匹配边界

```js
{
  id: 'receipt-normal-status',
  routePath: '/repay/receiptList',
  intentEquals: '借据列表正常展示',
  intentMatch: 'leading-clause',
  // 原有 apiUrl、fieldAssertions、sourceScenarioIds 保持不变
}
```

- 未声明 `intentMatch` 或使用 `exact`：保持原整段 query 精确匹配。
- `leading-clause`：只比较首个业务子句与 `intentEquals` 的精确文本；边界分隔符为中英文冒号、逗号、分号、中文句号和换行。仅去除子句两端空白，不做同义词、子串、大小写、Unicode 或字段类型归一化。
- 因此 `借据列表正常展示：保持默认，不执行交易` 可匹配；`不要借据列表正常展示`、`示例：借据列表正常展示`、引用、近义改写、路径前缀等不会匹配。不会跳过空首句或自行剥离“业务需求”等引导标签；不匹配仍需按原流程复核，而不是假设已受语义门禁保护。
- 开启该模式的 `intentEquals` 必须是单一子句，不含这些分隔符。非法模式/声明在插件契约解析时拒绝。
- 精确路由范围不变，先完成原目标解析及必要人工消歧，不用意图规则自动替用户选页面。
- 首句匹配后，如果同一路由下还出现另一段完整的已声明意图子句，返回 `WORKFLOW_INTENT_AMBIGUOUS`，在源码分析或创建前停止；澄清需求后新建运行。它不是通用否定/矛盾推理器，任意附加描述仍须 Agent 与用户复核。

## 原始描述与执行契约

新运行由宿主设置内部 `semanticIntentContract=1`，记录 `context.intentResolution`：是否匹配、规范意图、精确匹配或声明式首句匹配来源、所匹配规则 ID。`context.query` 和跨进程的 query 原样保留，补充标识、验收文案与操作约束不会被丢弃；不从 Agent 接收另一个“规范意图”字段来覆盖用户描述。

Main 选择规则与业务 Runtime 验证请求共用 `build/business-control-contract.mjs`。分析、来源重验、Profile 创建都接受同一声明式边界；匹配后仍执行原来源 ID 批准、实际字段值、证据有效性、人工确认和最终页面/请求门禁。仅匹配首句不是批准复用、也不是“同卡片”或所有附加条件已验证。

规则数量、路径、标量断言、安全校验保持原有边界。不改变原始候选排名、质量评分、精确配置等价规则、缓存或默认分支；创建仍只新增、不自动启用。此阶段主要补准确性门禁，尚未证明自然语言创建速度提高。

## 历史、变更和回退

- 没有内部契约标记的历史运行继续整段 query 精确匹配，不因新声明突然套用额外规则；既有完成/失败记录不回填。
- 新运行在分析时保存意图匹配结果与完整适用规则；确认/创建时重新检查。若修改/删除插件声明导致匹配结果、字段断言或来源批准范围变化，报 `WORKFLOW_INTENT_CHANGED`，要求新建已复核运行，不能沿用旧方案悄悄切换或削弱门禁。保留确认等待状态和诊断。
- 回退时删除对应业务规则的 `intentMatch`，或改为 `exact`，重新导出/同步业务包并重启客户端。新运行恢复旧匹配方式；已分析的运行不会借回退跳过原检查，需要重建。不清空 Profile，不删除已创建用户分支。
- 目标电脑须同步 Desktop 共享契约、Main 处理器和工具插件，以及业务插件 manifest 中的声明。不能只复制业务配置到旧 Desktop 后宣称长描述已生效；旧 Runtime 对新请求可能拒绝。

## 本轮迁移与验证

`demo-test/dsh-business-plugin.config.mjs` 仅给两条既有、已人工认可的借据规则增加 `intentMatch: 'leading-clause'`。原字段断言、具体借据号与 sourceScenarioIds 不改；不是把全部正常/逾期需求都当成这两个已批准用例。迁移新版业务数据仍须核对原规则适用范围。

验证覆盖：所有分隔符、未开启回退、否定/引用/非首句/近义词不猜测、多个声明意图、精确路由、非法模式、长 query 原样保留、错误来源拦截、显式提案与确认、规则变化/删除、旧运行恢复。实际业务 Runtime 子进程测试覆盖分析、来源重验、创建及回滚；进程桥测试消费实际导出业务包的两条声明，分别验证正常/逾期长描述、正确来源创建及不自动启用。使用系统临时用户目录，不修改真实 Profile。

```sh
npx vitest run test/business-control-contract.test.ts test/business-plugin-contract.test.ts test/business-scenario-intent.test.ts test/business-target-selection-bridge.test.ts
node scripts/test-business-runtime.mjs
npm run typecheck
```

本轮不回填 10 月 20 日已完成的自然语言采样，也不放宽固定语料评估器的 query/源 ID/独立网络和 DOM 证据契约。

### 2026-10-20 验证记录

- 全量 206 个测试文件、1817 项测试通过，另 1 文件/用例显式跳过；类型检查、Runtime 子进程回归、临时目录 Electron 生产构建、业务包校验和开发渠道发布预检通过。
- 业务包已导出为 `718bb45c0166-working-1792487807173`，开发客户端已重启加载；可见 Electron 恢复原会话、默认分支及借据列表。
- 实际运行中的 Main/Runtime 受控接口烟测会话为 `intent-smoke-74747ffa-ebbc-4a9a-b93b-8ac267546fc8`：长 query 原样保留、规则 `receipt-normal-status` 启用；错误来源返回 422，正确来源只保存待确认提案；否定首句未匹配；两种已声明意图并列时报 `WORKFLOW_INTENT_AMBIGUOUS`。三条运行 `3e646ec0-ea5b-4060-8b6e-8ead985a150b`、`8f4d207d-a8af-4978-aeb6-51a199086d16`、`79676511-e1fb-45ab-89e6-ce72a55d49ea` 均已取消，没有创建或启用分支。此烟测未经过 Agent 自然语言规划，不是新一轮准确率或提速样本。
- 重启检查还发现旧持久化逻辑会丢掉尚未打开的其他会话。现先保留恢复记录，再合并本次活动会话；实际子进程回归通过。第一次重启影响的两条原记录从重启前快照恢复，修复后再次启动确认四个原会话的 Profile/revision/路由均保留；未改历史工作流验证结果。重启产生新的 revisionId 是原证据失效机制，不复用旧激活证据。
- 用户 Profile 文件和 Mock 业务数据未变。包更新由原迁移逻辑将两份 Overlay 的 `_dsh.baseBuildId` 更新为新构建号，前后内容由迁移回滚文件逐份复核，其余业务配置完整相同；未清空 Profile。迁移记录 `b87b8d7e-1894-40ca-bdba-6911648996c7` 保留。

本轮代码和文档均未提交。下一步优先减少 Agent 对大型 Mock 文件的重复/全文读取，须保留精确字段证据和完整检索回退，不能仅凭本轮毫秒级 Runtime 检查推算端到端收益。
