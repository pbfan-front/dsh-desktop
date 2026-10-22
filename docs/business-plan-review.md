# 体验方案的面板确认

目标是减少方案已整理好后“用户回复同意 → 再次等待模型 → 调用创建”的往返，不代替 Agent 理解意图、聚焦复核或最终页面验证。

## 提交与确认分离

1. Agent 按既有质量门和实际 Mock 值复核证据，整理完整 `profileId/label/page/scenarios`，必要时声明 `verificationSteps`。
2. 调用 `business_propose_scenario_plan`，传 `runId` 和完整 `planJson`。宿主只在当前会话的 `confirm-plan` 接受，执行原方案/业务语义检查及请求外壳校验，持久化为 `checkpointProposal`；不创建或选择 Profile。
3. 面板展示目标、API、来源 Scenario 或新数据、可用的分析时字段快照、声明的业务字段规则及计划验收页面。完整方案可只读展开；源码快照有界，不是完整响应或页面证明。`review` 仍明确提示证据待复核，不能仅凭候选名字或分数确认。
4. 用户勾选核对后点击“确认并创建分支”。可信主 frame 的窄 IPC 只接受 `{proposalId,sessionId}`，不能传新方案、路由或文案覆盖。宿主重读保存版本并执行原确认/创建门禁，确认步骤记录 `confirmedProposalId`。
5. 创建后仅新增，当前分支不变；用户手动选择，再通过既有逐页/单页验证流程验收。新增成功不是最终验证通过。

“提交成功”不是“已批准”。分析器的 `suggestedPlan` 也不会自动成为面板方案，必须由 Agent 复核后显式提交。未提交的旧运行继续原对话流程。

2026-10-21 新增可选[完整来源复用方案准备格式](business-reuse-plan-preparation.md)：同一 planJson 可显式传 `format=source-reuse-v1`、明确复用来源及有序正负页面断言，由插件只生成机械 ID/默认标签，展开后仍走本节原完整方案请求。它不选择来源、不采用 suggestedPlan、不批准或创建；需要自定义 ID/新数据或不支持字段时继续原完整格式，不静默丢弃字段。

## 版本与失败边界

- 每次成功提交生成新的随机版本 ID；只保留当前待确认版本。替换后旧勾选不再有效，旧按钮版本会被宿主拒绝。
- 来源已声明字段改变、语义冲突、证据不足、非法方案或版本不兼容时不允许绕过原门禁。新方案提交失败保留上一个版本；确认时复核失败保留待确认状态供修正。
- 待确认版本最多 131072 个 JS 字符，随原工作流存储原子落盘，重启可恢复。落盘失败回退内存版本，不把未持久化版本当作可确认状态。
- 确认消费后移除待确认对象，确认步骤保留接受的版本 ID；取消也移除。重复确认不能再次创建。
- 主进程序列化锁保护提案、确认与执行；UI 同时防连点，并在点击时重新核对当前会话，异步旧反馈不更新新会话。
- HTTP/Agent 只新增 Bearer 鉴权的 `workflow/propose-plan`，会话来自请求上下文，不能由 body 冒充。没有 HTTP/Agent 的 approve-proposal 端点；面板确认沿用窗口/主 frame 信任校验，不放宽认证或 renderer 权限。
- 工具默认只回传提案版本和摘要，不重复回显大块数据；`detail=full` 仍可检查完整运行。面板从 IPC 读取完整保存方案，而非该压缩摘要。

## 兼容与回退

六步拓扑与版本保持不变，提案是可选附加状态，不回填旧运行。需要同步 Desktop main/preload、业务 Runtime、工具插件和 UI 插件并重启开发客户端。无需迁移业务源码、Mock 或修改业务插件的六步声明；新增 main 模块由既有 Electron 构建打包。

不使用面板时，可继续原对话中明确确认后调用 `business_resume_scenario_workflow` 的路径。它通过同样的创建与最终验证门禁，消费已有提案时也会移除待确认状态。不得因提案提交成功就自动调用 resume，也不把“恢复对话模式”解释为放宽证据检查。

## 验证入口

```sh
npx vitest run test/business-scenario-plan.test.ts test/business-workflow-preview-ui.test.mjs test/business-target-selection-bridge.test.ts test/business-plugin.test.ts
node scripts/test-business-runtime.mjs
npm run typecheck
```

单元/UI 回归覆盖版本替换、会话、覆盖输入、重复确认、持久化恢复/失败、来源变更、旧路径和不自动启用。进程桥测试使用实际业务 Runtime 与临时用户目录验证“提交仍停确认 → 确认后创建 → 当前 Profile 仍为空”。这些不是自然语言端到端性能或准确率样本；真实客户端验收记录单独追加。

## 2026-10-20 实际客户端验收

重启本地开发客户端加载 main/preload 和插件后，以受控 HTTP 启动明确路由 `/repay/receiptList` 的新运行 `2f876169-b4be-4926-8c9a-aa5a6191ede1`，提交临时方案。方案由测试预设，不是 Agent 自主生成；使用当前源码中已复核的“正常借据可以提前结清”，首条 `data.list[0].duestatus='0'`，同时匹配业务插件既有精确语义规则。

可见 Electron 深色中文面板自动展示待确认方案、`review` 风险提示、来源快照、页面断言及只读完整 JSON。初始复选框未选、创建按钮禁用，宿主没有创建 Profile。实际勾选后点击按钮，界面先显示执行中，再显示“分支已新增，尚未启用”和待验证 0/1。

持久运行中的 `confirm-plan.confirmedProposalId` 与所显示版本 `f547a36d-7918-4047-a42c-f97c3455961b` 一致，创建完成后停在 `wait-for-preview`；待确认对象已消费。验收前后当前 Profile 均为原有 `normalReceiptPrepay`，revision 为 1，revisionId 未变，未自动应用临时分支，也没有执行结清或贷款提交。

随后通过面板取消本次临时运行，仅回滚其创建操作 `25537ff0-685a-4201-b887-685565cb6ca2`。已核对临时 Profile `panel_review_49b1ca0f` 和 Scenario `panel_normal_49b1ca0f` 均移除，当前激活仍不变；保留取消/确认/回滚诊断记录。既有 10 月 19 日已完成跨页运行及失败历史未改写。

全量 205 个测试文件、1790 项测试通过；另 1 个显式浏览器用例在全量中跳过。类型检查、Runtime 子进程回归、发布预检及临时目录 Electron 生产打包通过，构建临时目录已清理。本次验证的是受控方案提交与真实面板创建，不包含自然语言规划或最终业务页面验收，不新增准确率通过样本、不宣称端到端提速；浅色、窄栏、错误态真实界面矩阵仍待补。
