# 证据绑定的聚焦复核读取清单（BEA-058）

日期：2026-10-22；仅 Desktop 插件，未提交。

## 原因与目标

[上一轮真实对话](business-reuse-plan-natural-language-review-2026-10-22.md)中两个精确工具均未调用。实际 retry 回复 13389 字节，因预算整体省略了 reviewPacket；Agent 随后读 review，以及 230230 字符完整 API 文档的第一页，未续页。之后又用 12 次源码调用/98528 字节，其中三份整文件。工具描述可用，但不能据此认定 Agent 会稳定采用；也不能把局部 API 页当完整复核，或把问题归为 CodeIntell 缺解析。

本条把“需要复核”补成**可直接调用、但不自动执行的读取清单**，减少拼参数和无目标翻查。不是新的分析器、数据流证明、来源选择或审批引擎。

## 位置与契约

- 同包新增 `packages/dsh-desktop-business/review-reads.js`，由 `workflow-summary.js` 在压缩前从当前运行的原始分析生成。入口/schema 提示在 `index.js`；无新增工具、HTTP/IPC、依赖、缓存、Main/Runtime 或业务源码改动。
- 仅 `waiting_for_user/confirm-plan` 且有 evidenceId 时提供 `reviewReads`；insufficient/未知质量门不给执行调用。取消、失败、其他阶段不给清单。不读取旧的同名持久化提示，不改保存证据。
- 列出精确 `business_inspect_mock_scenario` 参数，分别标明排序候选/插件声明来源、matched/conflict/unknown/not-declared。冲突候选只能用于调查，不是复用推荐。候选在分析窗口中缺失或 ID 重复时不生成其调用。
- Typed paths **只来自当前运行插件声明的 fieldAssertions**；保留字符串键与数字下标，不从 `list[]`/预览字符串推导 `list[0]`，不自动加成功信封、status 或“正常”值。未声明时仅提供原工具的结构发现调用，其他需求字段仍未知。
- 源码参数只取已声明路径的终端精确标识符；没有时才回退到字段消费证据中的终端标识符，不把全部候选附带字段默认塞进首读。不生成猜测文件路径，不把同名文本或图关系视作字段数据流。
- 清单提供完整 review/semantic 的原工具调用参数；不代替其中的候选对照与质量/来源复核。不为已经充分的当前证据强制增加工具调用。
- 仍由原工具校验当前会话、evidenceId 有效期和索引生命周期、实时文件读取；清单不续期、不缓存值。多文件/多批次仍是独立快照，缺口继续使用聚焦 grep/read，不阻断原模式。

## 有界输出与恢复

清单最多 6000 UTF-8 字节，最多 4 个候选、每个首批 16 条路径、8 个源码标识符。候选较多时有界展示排序候选与插件声明来源两个集合，各自维持保存顺序；不修改原排序、分数或来源结论。省略候选、路径、标识符或整个调用均有 coverage/gaps；多于 16 条时明确要求从完整语义证据继续分批，不丢弃剩余断言。

默认工作流回复仍限 24000 字节。清单超预算整体移除调用，绝不裁切 API、Scenario ID、路径或 JSON；整体摘要压力大时可整段引用 `section=reads`，以原状态工具 `detail=full` 恢复。该 section 是从保存证据派生的导航信息，不是新保存的源码/Mock 证据；也受分节内容哈希变化检查。

大 API 分页增加 `focusedReadHint`，指向同一运行的 `section=reads`，明确当前只是局部文档。若确需完整 API，原 documentId/nextOffset 无损分页协议不变；不自动抓取整份文件，也不把部分 JSON 内容当完整数据。原 run/analysis/review/semantic/api/plan 的完整内容没有改写。

## 验证与限制

自动化覆盖合法/非法 typed paths、类型/数字下标、冲突保留、缺失/重复来源、insufficient/取消状态、无声明不猜路径、预算整调用省略、摘要省略恢复、内容变更拒绝及原证据不变。实际工具通过临时资源目录的 Runtime 子进程和 Main 桥，直接执行清单中的 Mock/源码参数，未改工作流状态；npm pack 实际文件清单投影后的独立子进程加载新增 sibling，通过包闭包检查。

本机真实 Main/Runtime 受控试验（明确路由，不是 Agent 自主分析）：运行 `cb902d1c-db63-4a17-95c0-1635e4d9fae4`，清单的来源字段调用返回 887 字节，`duestatus="1"` 和完整借据号原值与当前 Overlay 独立读取一致。源码首读仅 `duestatus/loan_acct_no`，8 片段/15301 字节，逐行及 SHA256 与当前文件一致；范围仍有限（64 邻域/24 文件，40 文件未读、14 片段省略），不能认定链路全部覆盖。质量门仍 review/75、autoDraftAllowed=false；未提案/确认/创建/启用，试验运行已取消、创建 skipped。

最终全量 213 个文件/1928 项通过，另有既有 1 文件/1 项跳过；类型、JS 语法、Runtime 回归、独立临时目录 main/preload 生产构建、业务包及开发预检已通过。开发进程已重启。9 份用户 Mock/Profile 文件哈希、原 6 个预览会话内容及旧工作流集合保持；预览状态只有 updatedAt 因刷新改变，没有恢复写入或删除数据。

**尚无本条之后的新自然语言遵循率或端到端耗时结果**，不新增批准语料通过数，不宣称提速或最终页面准确率提升。下一步应保持原始用户内容/模型与路由消歧口径再采样，记录是否自主使用清单、源码返回量、提案重试和首次成功方案耗时；最终页面仍须原确认/真实请求/iframe 门禁。

## 迁移与回退

同步 Desktop 插件 `index.js`、`workflow-summary.js`、新增 `review-reads.js` 及对应测试/文档，重启客户端。不能只复制入口而遗漏 import；无需业务 Mock、CodeIntell、业务包重新导出或清空 Profile。业务迁移台账 DSH-BIZ-093 标记“业务源码无需迁移”。

可以不使用清单继续原聚焦 grep/read；移除此条时成组恢复清单 import/投影、reads section/schema 和提示，不删除历史、用户数据或恢复无界原始回复。来源、确认和最终页面门禁不回退。
