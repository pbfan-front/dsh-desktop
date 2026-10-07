# Business Plugin 架构

业务源码以受控的 `dsh-business-plugin` 集成到 Desktop。它不是普通 Harness 插件：Desktop 负责安装、完整性、兼容性、激活和回滚，业务 Runtime 只获得声明过的能力和插件专属数据目录。

## 插件契约

manifest schema v2 的身份字段：

```json
{
  "type": "dsh-business-plugin",
  "pluginId": "com.dataelement.demo-test",
  "projectId": "demo-test",
  "displayName": "微业贷业务体验",
  "capabilities": [
    "business-preview",
    "mock-runtime",
    "code-intell",
    "scenario-editor"
  ]
}
```

当前能力白名单：

- `business-preview`：在业务体验侧栏加载业务页面。
- `mock-runtime`：运行插件自带的本地 Mock 中间件。
- `code-intell`：读取插件内的源码索引和证据图谱。
- `scenario-editor`：允许创建和编辑用户场景覆盖层。

未知能力会在安装前被拒绝。首版要求前三项必备；`scenario-editor` 可选。

## 目录与隔离

```text
business/
├── plugins/
│   ├── active.json
│   ├── registry.json
│   └── com.dataelement.demo-test/
│       └── packages/
│           ├── <active-build-id>/
│           └── <previous-build-id>/
├── user-data/                  # Profile、Scenario、Mock Overlay
└── workspace/                  # 当前业务源码工作区副本
```

插件包与用户数据分离。更新、回滚或替换插件包不会覆盖 `user-data`。当前 Desktop 仍为单活动业务插件模式；registry 和按 Plugin ID 隔离的目录只作为后续扩展基础，不等于已经开放多项目切换。

## 安装与启动

1. 校验插件类型、身份和能力白名单。
2. 校验 Desktop 兼容范围和逐文件 SHA-256。
3. 复制到插件 staging 目录并再次验证。
4. 写入 registry，原子切换 active 指针。
5. 下次启动从 active 插件加载；活动包异常则回退随 Desktop 安装的内置业务插件。

正式签名、网络分发、权限沙箱和多插件 UI 暂不在本阶段实现。

## 代码归属

业务仓库是插件产物的权威输入，负责：

- `dsh-business-plugin.config.mjs` 中的插件身份、入口和能力声明；
- 业务 Web、Mock Platform、Local Mock 中间件、CodeIntell 索引和可读业务源码；
- `build:dsh-plugin` / `export:dsh-plugin` / `verify:dsh-plugin` 构建契约。

Desktop 只负责宿主能力：

- manifest 契约、能力白名单和 Desktop 版本兼容校验；
- 逐文件完整性检查、staging 安装、registry、激活与回滚；
- 业务运行时进程、窗口/IPC 和用户数据隔离。

Desktop 中的 `business:sync` 仅作为联合构建入口，导出阶段调用业务仓库的插件 CLI，不再在 Desktop 中写死业务 Plugin ID、展示名和默认路由。

## 工作区身份

Harness 的工作区按真实目录路径唯一。开发源码、Desktop 用户目录中的稳定副本以及旧安装包资源目录曾被分别注册，因而会在侧栏出现多个同名业务工作区。

Desktop 现在在 Harness 启动前执行保守归一化：

- 当前业务源码工作区使用插件 manifest 的 `displayName`，不再把 Build ID 当作用户可见身份；
- 已知旧业务路径或以同一 `projectId` 命名、且没有任何会话的记录会从工作区清单移除；
- 包含会话的旧记录保留，避免历史对话丢失或 cwd 被静默迁移；
- 每次实际改写前保留 `workspace.json.business-workspace-backup`，用于人工恢复。

工作区、业务 Profile 和 Mock 数据仍是三个独立概念：工作区决定对话的源码上下文，Profile/Mock 保存在插件用户数据目录，二者不是一一对应关系。

## 场景分析模式

场景创建保留两种可切换模式：

- `strict`：默认模式。按现有 CodeIntell/源码证据链分析，不读取候选缓存；
- `assisted`：同一源码摘要、路由和查询下的缓存，以及当前会话已发生的真实 API 请求，只用于提高候选 API 排序。每次仍重新加载 CodeIntell 生命周期、读取相关源码并检查 Mock/Rsp 类型。

`business_analysis_mode` 查看状态，`business_set_analysis_mode` 切换模式，`business_clear_analysis_cache` 清空候选缓存。切回 `strict` 会立即恢复原始默认分析行为；清缓存不会删除 Profile、Scenario、Mock、会话或 CodeIntell 产物。

无论模式如何，创建 Profile 都必须使用本轮 `business_analyze_target` 返回的未过期 `evidenceId`，并继续经过实际 Mock 中间件命中验证和失败原子回滚。缓存和真实请求不能作为创建证据。

## 有状态工作流边界

业务体验流程采用“宿主执行、插件定义”的边界：

- Desktop 的 `BusinessWorkflowRuntime` 负责串行状态转换、Checkpoint、重试、取消、结构化运行记录和后续持久化；
- 业务插件负责声明工作流步骤，以及页面识别、CodeIntell 查询、Mock 计划、应用和验证等业务处理器；
- Agent 步骤只返回结构化推理结果和证据 ID，不直接越过宿主执行写入、请求命中或页面断言；
- 工作流上下文、步骤输入输出与错误必须可序列化，不传递 Electron 对象、函数或业务实例。

当前 `WF-001` 至 `WF-004` 已提供共享契约、无 Electron 依赖的执行器、版本化原子持久化和 Desktop 生命周期接入：Checkpoint 原样保留；执行中的步骤在重启后标记为可重试中断，不自动重放副作用；损坏状态会隔离而不是覆盖。受信任主窗口可通过窄 IPC 查询运行时间线，以及继续、重试或取消已有运行，但不能注册任意工作流或执行代码。该能力尚未替换现有业务工具；下一阶段将现有场景创建流程接入工作流，再由业务插件导出带 Schema 的定义与处理器声明。

`WF-005` 的宿主固定流程现已接通现有业务服务：先执行 `analyze-target`，在 Checkpoint 接收经确认的 Profile/Scenario 方案，然后调用 `create-profile` 和 `apply`；业务页面加载后在第二个 Checkpoint 接收严格页面断言，最后调用 `verify`。所有请求仍使用业务服务的随机控制令牌、会话隔离和既有证据门禁。`WF-010` 起固定工作流成为默认入口；旧四段式工具只作为显式启用的 `legacy` 兼容回退路径，切换不会修改 Profile、Scenario 或运行历史，模式与调用结果会写入本地审计。

Agent 插件现提供 `business_start_scenario_workflow`、`business_resume_scenario_workflow`、`business_scenario_workflow_status`、`business_retry_scenario_workflow` 和 `business_cancel_scenario_workflow`。这些工具先经过业务服务的随机令牌鉴权，再由白名单父子进程消息桥交给 Desktop 宿主；插件不能注册定义或执行任意代码。原有分析、创建、应用和验证工具继续保留，在 GUI 验收完成前作为明确的回退路径。

目标解析遇到多个同名页面时，业务服务返回带路由和页面标题的结构化候选，工作流将其保存在失败步骤中。Agent 必须先把候选展示给用户；只有用户明确选择后，才能调用 `business_retry_scenario_workflow(runId, selectedRoutePath, confirmedByUser=true)`。Desktop 只接受该运行保存的候选路由，错误或未确认的选择不改变运行状态。有效选择在同一运行中重试目标解析，然后进入尚未开始的源码分析，不创建新运行或提前写入 Profile。其他可重试失败仍可不带选择参数按原方式重试。

质量门为 `review` 时，分析结果附带有界的 `analysisPlan.reviewPacket`：列出置信度缺口、最多三个现有 Scenario 的意图匹配与字段消费对比、总分拆解，以及少量源码位置证据。`analysisPlan.fieldImpact.candidateOnly=true` 表示第一候选虽有字段消费证据，但尚不足以自动复用；不再把这类证据误写为 `unproven`。`strongestScenarioHasFieldImpact=false` 也可能只是因为缺少唯一高置信匹配，不能据此否认候选已有字段证据。未证实字段只是“在有界源码范围内未找到消费”，不等于页面必需或完全未使用。Agent 应在方案确认前核对实际 Mock 值与用户意图，不得仅凭名称或总分推荐复用。现有质量门阈值及最终 iframe/真实请求验证保持不变。

业务插件可选地在 manifest 中声明 `scenarioSemanticRules`。每条规则使用精确路由、精确意图和 API，指定直接 Mock 数据的标量字段断言及可接受的来源 Scenario ID；不执行插件脚本或正则。命中规则会随分析结果送给 Agent 供确认方案时审阅。Desktop 在接受 `confirm-plan` 输入前重新按当前插件规则校验，失败时保持检查点等待而不写 Profile；创建步骤重复校验作为防线。未声明或未精确匹配的意图不套用业务猜测，最终页面与真实请求验证仍不可省略。

命中语义规则时，分析阶段会读取候选 Scenario 的实际 Mock 响应，对声明的标量路径分别标为 `matched`、`conflict` 或 `unknown`，并独立报告来源 ID 是否获准。`analysisPlan.semanticValueChecks` 包含候选与所有获准来源的检查结果；`reviewPacket` 也携带候选结果。`conflict` 不应复用，`unknown` 需继续核查，`matched` 仍不等于页面最终正确。新分析的来源复用方案在确认前和创建前必须取得已匹配的检查结果；会话分析复用对命中规则的请求关闭，以免沿用旧 Mock 值。旧版已持久化运行若无此快照，保持原校验契约。未声明字段不会被推断为正确；写入后外部再次修改 Mock 仍须依赖后续真实请求与页面验证发现。

BEA-047 进一步在 `confirm-plan` 接受前从当前 Overlay/业务包文件重新读取所选来源，不使用分析缓存；若字段冲突、缺失或来源不存在，仍停在确认步骤，不写 Profile。`create-profile` 接口在写入前重复读取并检查，并从复核后的最新文件克隆，防止确认与写入之间出现过期来源。校验只针对精确命中的插件规则与所选来源；旧运行没有新规则快照时保持原契约。复核通过不替代真实 Mock 请求及页面验证。

运行时中的 Mock 文件读取、精确元数据缓存、关闭时落盘和来源语义复核现收敛到 `build/business-mock-store.mjs`。业务 Runtime 负责路由、分析和 Profile 写入，只通过明确的 `read`、`readFresh`、语义检查及关闭接口使用该模块。`readFresh` 不使用分析缓存，Overlay 优先级仍由模块内部保持；新模块与运行时入口一起作为安装包资源打包。
