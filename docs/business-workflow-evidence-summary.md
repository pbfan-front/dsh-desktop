# 工作流有界回复与完整证据读取（BEA-055）

## 目的与边界

上一轮[自然语言采样](business-mock-inspection-natural-language-review-2026-10-21.md)暴露：相同分析同时返回在 `context.analysis` 和分析步骤 `output`，旧 compact 结果仍有 72399 字符/73563 UTF-8 字节；上层约 50000 字符截断后不是合法 JSON。状态接口实际返回 `{run: ...}`，此前按裸 run 压缩的逻辑还漏掉了这个外壳。

本条只修改 `dsh-desktop-business` 服务端工具的模型可见投影，不修改 Runtime 分析器、持久化工作流、Mock/Profile、排名、质量门或来源审批。确认后创建、创建不启用、当前版本的实际请求/页面最终验证继续独立执行。没有新增服务、依赖、证据缓存或自动重试。

入口为 `packages/dsh-desktop-business/index.js`，投影与序列化归同包 `workflow-summary.js`。保留 JS ESM 加载协议，新增模块必须随插件一起分发；不需要重新导出业务包。

## 默认回复

- 所有成功的工作流工具回复先完整序列化，再校验 **24000 UTF-8 字节**上限；不是截取字符串，也没有提高 Harness 的全局截断上限。
- 裸 run 和 `{run: ...}` 都处理。分析只出现一次；步骤输出与其完整相等时用 `outputRef` 指向 `context.analysis`。不同版本不伪装成同一份证据。
- 保留运行/检查点、步骤状态、回滚 operationId、已知验证身份和失败原因。API/Scenario 集合是有界候选展示，不是完整候选清单；继续优先既有匹配来源，不改保存的候选顺序。
- 提案提交只返回待确认回执、方案 ID/数量等摘要，不重复分析或原始 Mock 数据。`explicit-user-action-required` 不是批准、创建、启用或通过验证。
- 对大段证据逐段整体替换为 `summaryOmitted/read` 引用，并标记 `requiresFullReview`；极大元数据只留运行状态及完整读取提示，仍超限则明确报错。业务标量不截短、不做类型归一；错误诊断文字可有界截短并显式标注。
- 摘要未展示的字段不等于不存在，候选不在摘要里不等于不匹配；`requiresFullReview` 未出现也不代表 `qualityGate=ready` 或已批准。必须沿用原质量/语义门，必要时取完整分节或使用精确 Mock 字段工具。
- JSON 解析或投影失败不会回退返回原始大段文本。无法解析响应时提示先查运行状态，再决定是否重试写操作，不能把响应展示失败当作操作一定没发生。

## 完整证据契约

`business_scenario_workflow_status` 新增以下可选选择器；HTTP 仍只发送原 `runId` 和原会话身份，投影在工具插件内完成，不另开鉴权通道，不重跑分析。

| `detail=full` 的 section | 原始数据来源 |
| --- | --- |
| `run`（默认） | 完整保存的运行；小文档保持原返回外壳 |
| `analysis` | `context.analysis` |
| `review` | `context.analysis.analysisPlan.reviewPacket` |
| `semantic` | 原始 intentResolution、semanticExpectations、semanticValueChecks |
| `api` | `context.analysis.apis` 中精确 `apiUrl` 的完整条目，必须提供 apiUrl |
| `plan` | 当前待确认提案 output，否则为 context.plan |
| `reads` | 从当前等待确认运行的原始证据派生的有界只读调用清单；不是保存的源码/Mock 值，见 [BEA-058](business-review-read-plan.md) |

优先读取必要的 `review`/`semantic`，缺 Mock 字段时继续用 `business_inspect_mock_scenario`；不要为完整克隆枚举所有附带字段。`run`/`analysis` 大文档完整分页主要是诊断兜底，不应成为默认阅读流程。

小的分节返回 `evidence: {available:true, complete:true, documentId, value}`；不存在返回 `available:false`，不默认回退其他 API/场景。大文档返回：

```json
{
  "id": "run-id",
  "evidencePage": {
    "section": "analysis",
    "format": "json-text",
    "documentId": "<64位sha256>",
    "offset": 0,
    "nextOffset": 12000,
    "totalChars": 30000,
    "complete": false,
    "content": "<完整JSON文档的一段原始文本>"
  }
}
```

每页外壳始终是完整 JSON；**content 片段本身不是独立 JSON 或可供判断缺失字段的完整证据**。以返回的 `nextOffset` 连续读取，并携带同一 `documentId`，直到 `nextOffset=null`，依序拼接所有 content 后才能 JSON.parse。偏移是 JS 字符串索引，不是 UTF-8 字节；单页最多 12000 字符，序列化后若超过字节预算则缩小，因此不可自行按固定步长猜偏移。代理不需要理解原始字节切割。

哈希绑定 runId、section、apiUrl 和该分节完整 JSON。内容改变、分节消失、运行消失或混用选择器时拒绝续页，报 `WORKFLOW_EVIDENCE_CHANGED`；必须丢弃旧片段，从 0 不带 documentId 重读。没有保存临时服务端快照；持续变化的文档可能需要等到稳定后重读。非法偏移、缺少续页哈希或非法选择器同样明确报错。

除明确派生的 reads 导航节外，完整模式读取的是保存的工作流证据，不等于当前磁盘 Mock，读取也不续期 evidenceId；当前值仍由只读 Mock 工具和原写入前实时复核确认。分页内容哈希不代替方案确认的 proposalId，也不授权批准或创建。API 局部页的 focusedReadHint 仅引导按需读取，不替代完整分页或原门禁。

## 2026-10-21 受控验证

使用已取消的真实运行 `90d60b5b-9908-43c6-aacf-e55fc30ff494`，通过实际注册工具实现连接开发 Main/Runtime，只读重放，没有发送模型请求或创建 Profile：

| 返回内容 | 实测 |
| --- | --- |
| 新默认状态回复，含真实 `{run}` 外壳 | 22335 字符 / 22901 字节，合法 JSON，分析步骤不重复输出 |
| 完整 review 分节 | 5212 字节，一次读取 |
| 完整 semantic 分节 | 1939 字节，一次读取 |
| 完整原始 analysis | 23 页，最大回复 13788 字节；拼接后与持久化分析逐值完全一致 |

与历史 compact 的 72399 字符相比，默认回复约减少 69%；这只是同一历史证据的**输出体积对照**。完整原始 analysis 有 270629 字符，不能把它与旧 compact 的 34681 字符混成同一口径。没有新自然语言规划/完整创建验收，不新增语料通过数，不证明端到端提速或最终准确率改善；原取消/失败/完成历史保持不变。

回归覆盖完整 JSON、中文/emoji/转义字符、分节与分页无损复原、哈希变更/分节消失、冲突/未知和数值类型、显式摘要缺口、提案不批准、歧义候选及回滚身份、真实 `{run}` 进程桥与完整证据取回。npm pack 的实际文件清单投影到独立临时包，再以真实 Node 子进程加载插件，确认同包模块与已声明宿主 peer 可解析；不等同于新签名安装包验收。全量、类型检查、Runtime 回归、临时目录生产构建、业务包及开发发布预检结果同步在路线图和基线。

最终开发客户端已重启，Harness 与业务编译就绪、可见 Electron 会话/工作流面板正常。操作前后 9 份 Mock/Profile 文件哈希、全部 6 个预览会话选择及完整工作流存储哈希一致，没有重写历史结果；本轮未提交。

## 迁移与回退

后续已补[同需求真实对话复测](business-workflow-summary-natural-language-review-2026-10-21.md)：实际 retry/propose 均为完整合法 JSON，精确字段工具取得所需值，正确方案仍待确认而未创建。工具文本量减少，但模型步骤增加，尚不能宣称稳定端到端提速；原受控重放与新 Agent 样本分开记录。

同步插件 `index.js`、`workflow-summary.js` 及工具 schema/说明，重启 Desktop/Harness 后生效；后续 BEA-058 同时需要新增 `review-reads.js`。不修改业务 Mock 或 CodeIntell，不必清空 Profile。只复制 index.js 会缺少运行时 import，不能作为完整迁移。

如需回退，成组恢复本条工具投影及 schema/说明，再重启；不删除持久化证据或用户 Profile，不回退原质量/确认/最终页面门禁。旧版默认/完整大回复仍可能被上层截断，不建议把直接返回无界原文当恢复方案。现有分析模式开关不负责切换工具输出协议；不读取新完整模式时仍沿用原定向源码/grep 流程。
