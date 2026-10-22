# 重复 Scenario 的精确配置等价分组

目标是减少“同一个状态的多个克隆”造成的表面歧义，不通过名称相似、分数相近或部分字段相同猜测等价，也不删除 Mock、Profile 或原始候选。

## 比较边界

`build/business-scenario-equivalence.mjs` 对已经排名的候选按以下条件分组：

- API URL 必须完全相同，不做跨 API 归并。
- 仅排除 Scenario 顶层 `id`、`label`；保留 `data.id`、`data.label` 及所有其他配置。
- 完整 JSON 序列化内容一致后，还要通过深度相等检查。保持对象键顺序、数组顺序和数据类型；不把 `"0"`、`0`、`false` 当作同值。
- 响应状态、错误文案、响应类型、延迟、headers、patch、未知字段等任一配置差异都会保留为独立候选。
- 无法比较、单配置超过 1MiB 或总比较量超过 16MiB 时保留独立候选；某 API 超过当前 50 个场景分析窗口时不以归并提升唯一性，避免忽略窗口外的可能分歧。

组代表保持现有排名中的首个候选，不改分数或按 ID 猜测“更正确”的来源。唯一性仍使用原来的 40 分差距要求，但比较下一个不同配置的候选。分组在展示截断之前执行，因此 12 个相同克隆后面的不同状态仍能阻止“唯一候选”。

`analysisPlan.existingScenarioMatches` 保留原来的有界原始排名；`scenarioEquivalence` 提供候选/组计数、等价成员、不同配置的候选及截断标记。review packet 使用不同组的代表展示可区分的替代方案，不重复展示三个同值克隆。完整 API 场景摘要仍可审计。分组详情最多 12 组、每组最多 12 个 ID；此展示限制不影响内部歧义判断。

这只消除由精确重复配置造成的歧义，不证明业务预期正确、不证明未解析字段无用。语义断言、源 Scenario 校验、人工确认、真实请求及最终页面验证仍按既有契约执行，Profile 创建和选择行为不变。

## 关闭与恢复

通过已有 `business_set_analysis_mode` 工具关闭：

```json
{"mode":"strict","exactScenarioEquivalence":false}
```

这会恢复旧的逐候选歧义判断，不修改 Profile/Mock。其他字段省略时保持原值；该开关独立于 strict/assisted 和 sessionReuse，默认开启，保存于已有分析偏好文件，Runtime 重启后保留。重新启用传 `exactScenarioEquivalence:true`。通过 `business_analysis_mode` 可查看当前值；偏好变化会使同会话分析复用失效。

## 与分析复用的关系

本次回归发现，旧同会话复用只凭输入和生命周期 key，无法发现新出现的 Overlay。现在记录所有实际探查的 Mock 路径（包含不存在的高优先级 Overlay），复用前核对设备号、inode、大小、mtime、ctime 与存在性。新增、改写、删除任一已探查输入都会重新分析；未命中的候选路径也记录不存在状态，防止后来新增文件被旧结果遮蔽。

这一校验独立于等价分组开关，不会随关闭分组一起退回旧的陈旧结果风险。五分钟仍是缓存保留上限，不充当文件是否变化的判断依据。校验耗时计入 `analysisTimings.reuseValidationMs`；没有把它隐去后声称复用“免费”。CodeIntell 生命周期校验和既有源值确认保持不变。

## 验证

```sh
npx vitest run test/business-scenario-equivalence.test.mjs test/business-plugin.test.ts test/release.test.ts
node scripts/test-business-runtime.mjs
node scripts/test-business-scenario-equivalence-project.mjs <已有分析运行ID>
```

最后一个命令读取本机连接描述及该运行的业务目标，将涉及的用户 Mock 拷入临时目录，启动独立 Runtime，使用同一源码、同一查询对照开关前后；不联系模型服务，不改变现有 Profile、预览、运行或偏好。完成后关闭子进程并清理自己的临时目录。它是分析器对照，不是自然语言端到端创建测试。

当前项目对照已重现：原场景与旧克隆同配置，原判断为 `review` 且包含歧义；开启后等价组包含两个成员，判断为 `ready`，仍返回 `requiresConfirmation=true`。不能据此宣称 Agent 端到端耗时已缩短。上一条被 429 阻断的跨页体验没有被补成通过，也未重启其 Runtime，以保留第一步激活证据。

新增模块已接入 `package.json` 的打包资源和发布前检查；升级需同时带上 Runtime、Mock store、等价模块和业务工具插件。当前开发客户端需重启后加载新能力；若有待续跑体验，应先完成或明确放弃其激活证据，再重启。
