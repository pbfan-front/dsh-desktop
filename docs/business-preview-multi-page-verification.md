# 跨页面体验验证

2026-10-22 新增[日常简化交互](business-daily-experience-flow.md)：新运行的已声明单页/跨页检查可在当前可见对话中收到匹配观察后自动触发；用户仍手动选分支、正常打开下一页，原逐页身份/顺序/断言与最终门禁不变。“工作流面板直接核验”保留为高级诊断路径，不再是每次体验必走步骤；旧运行不回填。

适用于同一体验分支的“入口页状态 → 后续页面入口”需求。例如借据列表显示正常，进入对应详情后检查“提前结清”，不能要求列表页同时出现详情页按钮。

这仍使用原来的六步 `business-scenario-create` 工作流、同一个运行和同一个人工选择的 Profile；不新增 Agent 引擎，不自动选择分支或执行结清等业务提交。旧方案不带 `verificationSteps` 时，继续使用原单页验证。

## 方案声明

在 `confirm-plan` 的既有 Profile 方案中，可附加 `verificationSteps`。创建前把这些页面及断言和 Mock 方案一起交给用户确认：

```json
{
  "verificationSteps": [
    {
      "id": "list",
      "label": "列表正常状态",
      "route": "/repay/receiptList",
      "containsText": ["借据列表", "正常", "待核对的借据号"],
      "absentText": ["系统繁忙"],
      "apiUrls": ["/loanNbr/loanNbr.json"]
    },
    {
      "id": "detail",
      "label": "详情提前结清入口",
      "route": "/repay/receiptDetail",
      "containsText": ["待核对的借据号", "正常", "提前结清"],
      "absentText": ["系统繁忙"]
    }
  ]
}
```

这是方案的附加字段示例，不能单独作为完整 Profile 方案提交；借据号必须换成当前确认的 Mock 实际值。规则如下：

- 1–5 步，有序且 ID 唯一；第一步必须是分析确定的目标路由。
- 每步至少一个非空必需文本；必需/禁止文本各最多 20 项、每项最多 200 字符。
- 可选 `apiUrls` 只能选择方案里已有的 API。它用于当前页面的部分检查；最终检查仍要求整个 Profile 的所有 API/Scenario 真实命中，不允许缩小范围。
- 页面文本只是渲染证据，不证明按钮可点击、操作成功或业务提交完成。后续动作的成功预期必须另外设计证据，不能把入口文案出现等同于动作完成。

## 逐页执行

创建后仍由用户在业务体验面板选择新分支。等列表稳定，在同一运行的 `wait-for-preview` 通过 `business_resume_scenario_workflow` 传：

```json
{"stepId":"list"}
```

通过后仍停在该检查点，`context.previewVerifications` 保存该步的服务器校验结果，包括路由/文本断言、当前会话/Profile/revision/revisionId、页面观察及有界真实请求摘要。Runtime 不会因为部分页面通过就把整个场景标为 `verified`。

用户通过正常页面操作进入详情、等页面稳定后，再传：

```json
{"stepId":"detail"}
```

所有步骤捕获后，原 `verify-preview` 步骤会重新校验当前末页及完整 API 绑定，并检查前面证据与当前激活身份一致。完成结果 `pageSteps` 按序保存每步的确认预期和实际校验结果。

不能跳步、覆盖已确认的文本/路由或使用另一会话、另一 Profile、上一次分支激活/Runtime 实例的证据。后一步观察时间不得早于前一步的校验时间。中间失败会返回错误且不推进；重试必须先使相应页面或证据发生实际变化。

如果检查期间重新选择了分支或重启 Runtime，在仍等待页面检查时可传 `{"restartVerification":true}`，清空当前进度并保留上一次尝试，再从第一步重新采集。仅保留最近一次被重置的尝试，防止无界累积。最终确定性步骤已经失败时，普通 retry 只重试保存的末页断言；若激活身份已过期，需要新建经过确认的运行，不能拼接旧证据。

## 工作流面板直接核验

已创建且保存了 `verificationSteps` 的运行，可在工作流面板查看逐页进度、当前页面的已确认路由、必需/禁止文案及可选 API 范围。先在业务体验中手动选分支并打开当前待验页面，再点击“验证当前步骤”。按钮通过已有 preload/可信主 frame IPC 调用 `resumeBusinessWorkflow(runId, {stepId})`，不经过模型服务，不新增控制端点或权限。

按钮只发送当时展示的下一步 ID；宿主仍从持久化方案读取断言并按序验证。当前步骤通过后停留等待下一页，末步后仍执行完整 API/Scenario 与当前末页的最终门禁。“页面已通过 2/2”不代表最终门禁必然通过；最终失败仍保留失败步骤及既有重试入口。

安全与交互边界：

- 不创建或自动选择 Profile，不导航业务页面、不点击结清或其他业务提交。
- 连续点击只发送一次；旧按钮携带的过期 stepId 由原检查点拒绝，不会偷跑下一步。
- 页面/请求/Profile/revision 不符时显示具体错误，不推进、不自动清除既有证据或改变断言。
- 查看另一会话的运行时禁用核验按钮；切换会话/运行或卸载面板后，不显示旧异步操作的反馈。
- 未保存验证断言的旧单页运行、未创建的确认方案、取消/完成或不兼容运行不开放该操作；缺少桥接能力时提示使用原对话入口。不从页面或用户临时输入猜测旧方案的断言。
- 仍可忽略按钮，通过原对话工具核验同一运行，无需改变已保存方案。升级至少包含客户端插件及 `src/main/business-workflow-ipc.ts` 的错误转换；后者把普通门禁对象转为有界 `Error.message`，确保 Electron IPC 能保留诊断，而非显示 `[object Object]`。

新回归以 jsdom 渲染实际插件、通过实际 IPC 注册器与工作流状态机运行，模拟业务验证响应；覆盖中英文、逐页成功/失败、手动激活要求、连点、过期 ID、激活变更、跨会话、卸载、最终门禁失败和原入口回退。它不是真实 Electron 布局或真实业务浏览器验收。2026-10-19 本轮实际 GUI 操作被 macOS 锁屏阻挡，未刷新/重启客户端，原自然语言样本仍保留一个已通过页面、等待第二步；没有以此测试把原运行补成通过。需解锁后加载新客户端代码，再进行真实按钮和深浅主题/窄栏验收。

```sh
npx vitest run test/business-workflow-preview-ui.test.mjs test/business-workflow-ipc.test.ts test/business-workflow-route-choice-ui.test.mjs
```

## 验证与升级

需同时使用更新后的 Desktop 工作流处理器、业务工具插件及 `build/business-runtime.mjs`。不必修改业务页面、Mock 数据或工作流的六步声明。旧 Runtime 缺少激活身份字段时，新跨页模式会拒绝通过，而不是降级跳过校验。恢复默认模式只需在新方案中省略 `verificationSteps`；已有历史运行不回填、不改成通过。

```sh
npx vitest run test/business-workflow-runtime.test.ts test/business-scenario-workflow.test.ts test/business-plugin.test.ts
node scripts/test-business-runtime.mjs
npm run typecheck
DSH_RUN_BUSINESS_BROWSER_E2E=1 npx vitest run test/business-scenario-create-browser.test.ts test/business-preview-network.test.mjs
```

浏览器回归使用临时用户目录、独立开发服务和真实业务页面；属于受控测试，不计为自然语言创建准确率，也不用于宣称 Agent 端到端耗时改善。

2026-10-19 已通过该浏览器回归：既有正常/逾期两条单页用例保持通过，新增正常借据跨页运行先验证列表状态，再进入详情检查“提前结清”文案，最终门禁通过。移动端测试使用真实触摸输入；详情操作依赖首页正常初始化的角色/权限上下文，测试先走真实业务首页，不注入 Vuex 状态或改写 Mock。未提交结清操作。

当前计时的 `previewWaitMs` 包含逐页检查调用，不能当作纯人工等待；`verifyPreviewMs` 仅是最终门禁。这一受控用例不用于本轮端到端速度统计。

## 客户端自然语言采样（2026-10-19，后经面板续验完成）

重启实际开发客户端后，通过新会话输入自然语言需求，未提供路线、API、源 Scenario 或 `verificationSteps` 字段。按此前认可的预期选择 `/repay/receiptList`，Agent 自主复核源场景并在方案中声明列表、详情两步；确认后创建 `normalReceiptPrepay`，未自动切换分支。运行 `bfadd36f-078c-4d4a-a2f3-92f466f2b543` 保留完整方案和时间线。

手动从真实首页进入还款查询、选中新分支，Agent 已调用工作流核验第一步 `step1-list-normal`：同笔借据显示正常，当前 API/Scenario 的 HTTP 200 请求证据与会话/Profile/revision/revisionId 一致。此时运行仍在 `wait-for-preview`，整体 `verified=false`，不会把列表页成功当作全部成功。

随后手动点击同笔借据进入详情，可见未标禁用的“提前结清”按钮；仅关闭 Mock 提示，未点击结清。请求第二步核验时，模型服务返回 `429 / AccountRateLimitExceeded`，自动重试耗尽；冷却后一次续跑也收到同样错误。第二步和最终门禁没有执行，**不能记为自然语言完整创建通过**，也不能用静态可见文案代替最终校验。没有通过 Legacy API 或人工写入结果补成成功。

当时保留了该会话的新分支与详情页、第一步证据，供后续继续 `step2-detail-prepay`；没有重新选择分支或重启 Runtime。若在等待期间改变激活身份，必须显式重采第一步，不能复用旧证据。

### 真实 Electron 面板续验（2026-10-19 20:25）

解锁后打开实际客户端的工作流页，新入口已加载，无需刷新界面或重启 Runtime。可见“已通过 1/2”、列表已通过、详情待验证以及已确认的详情路由/三条必需文本/API。通过可见按钮“验证当前步骤”续验后，先显示页面 2/2、最终门禁执行中，随后正式显示“已完成”和“所有页面及最终门禁均已通过”；完成态不再显示按钮，也不提示重新选分支。

只读复核持久化运行 `bfadd36f-078c-4d4a-a2f3-92f466f2b543`：状态为 `completed`，两条 `previewVerifications` 与最终结果均为 `verified=true`，使用相同会话、`normalReceiptPrepay`、revision 1 和 `revisionId=70ca5122-8740-4e4c-8d1f-62528318ed06`。详情实际路由为 `/repay/receiptDetail`，含“提前结清”“正常”和同一借据号；匹配 Scenario 的 HTTP 200 请求采样时间为 20:24:56，第二步校验时间为 20:25:50，最终校验结束为 20:25:56。没有修改方案、通过 Legacy、手工回填结果、调用模型服务或点击结清。对话中的 429 历史错误仍保留，不等于这次工作流还在失败。

这是“自然语言启动/Agent 规划创建与列表核验 + 人工操作预览 + 面板详情续验”的混合链路完成，不是全程 Agent 对话自动通过。中间包含数小时暂停、锁屏及限流，不用于正常端到端 P50/P95 或稳定提速结论；未自动改写已审核用例语料的通过数。真实中文/当前深色界面的成功及完成态已检查，浅色、窄栏与失败态的完整实际界面矩阵仍需补验；原失败运行与模型错误历史不回填。
