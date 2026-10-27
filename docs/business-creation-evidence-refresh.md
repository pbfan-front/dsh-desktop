# 创建时分析证据失效的恢复（BEA-063）

2026-10-26 另一台电脑的运行在 `create-profile` 失败，错误为 `A current business_analyze_target evidenceId is required before creating a Profile`。这说明创建时的分析 ID 已失效或不在当前 Runtime 中；证据内存有效期为 30 分钟，Runtime 重启也会清空。截图中的长处理时间使过期很可疑，但截图不能区分过期和重启。

工作流此前已经提交并确认方案，不能仅凭后来卡片“需要调整”推断提案从未保存。该错误也不能用来判断 ABN Mock 是否正确。

## 恢复行为

Runtime 分析结果和内部证据增加创建用指纹：业务来源摘要、索引生命周期、实际读取的相关源码内容，以及每个候选完整 Mock 配置的 SHA-256。只保存哈希，不新增响应正文。工作流原有证据保存机制保存该结果，模型摘要无需接收这些哈希。

创建前，Runtime 检查当前索引、证据有效期、所属会话和 API 配置指纹。失效返回专用 `E_ANALYSIS_EVIDENCE_STALE`，发生在任何 Profile/Mock 写入前。配置变更返回 `E_ANALYSIS_SOURCE_CHANGED`，且明确不可按原输入直接重试。

Main 只对明确的失效错误恢复一次：

1. 读取已经确认的原方案及其指纹；不重新猜选来源或构造替代方案。
2. 用原路由、原始需求和方案中的精确 API 集合重新分析。`forceFresh` 仅关闭本次完整分析的会话结果复用，仍读取当前源码和 Mock。
3. 比较来源/索引/相关源码及所选 API 配置哈希。全部一致后，再走原质量与语义来源检查；仅替换 evidenceId，再次调用原创建端点。
4. 成功后保存新分析与恢复记录。创建仍不激活分支，原页面/真实请求验证保持。

不对网络超时、未知写入结果或其他错误自动重放，也不无限循环。来源变化返回 `WORKFLOW_ANALYSIS_CHANGED`；老运行没有完整指纹时返回 `WORKFLOW_ANALYSIS_REFRESH_REQUIRED`，二者不可原样重试，需要重新复核并确认方案。不能补猜旧哈希、延长 TTL 或把失败改为成功。

## 另一台电脑当前旧运行的处理

旧运行没有新指纹，无法安全自动沿用旧确认。保存其已经审核的完整方案，包括 Profile ID、路由、API、来源 Scenario 和所有检查；重新分析相同目标与精确 API，复核当前来源后重新提交同一业务方案，在新确认卡上确认一次，再创建。不要不断点击原失败步骤重试，不要为这个错误修改 ABN 字段。

原需求应保留为“命中 ABN 分流”，不能改成默认数据快速创建。目标 `/loan/fullLoanApply`、API `/loan/queryLoanType.json` 和来源“命中ABN”仍须由目标电脑当前分析证据确认；截图中的字段说明不替代完整的当前来源复核。

## 验证与交付

相关单元与实际 Runtime 进程桥覆盖：首次创建证据丢失后重新分析成功、已确认方案逐项保持、旧记录缺指纹停止、Mock 指纹变化停止、普通暂时写入失败不触发自动重放。进程桥使用真实打包资源清单及工具/Main/Runtime，向第一次写入传入不存在的证据 ID，验证后端拒绝后同一已确认方案能在来源一致时创建；创建不激活。该试验不是实际等待 30 分钟或远端 ABN 页面验收。

最终 5 个相关测试文件、66 项回归与 TypeScript 检查通过，Runtime 原有集成回归通过；Main/Preload 在独立临时输出目录构建成功并含新增恢复模块。未跑全量测试，未在活动用户目录执行创建试验。临时构建目录在检查后删除。

迁移 Desktop 的 `build/business-runtime.mjs`、共享错误契约及声明、Main `business-scenario-workflow.ts`、新增 `business-creation-evidence.ts`、`business-preview.ts`，重新构建并重启客户端。新增 Main 模块由原构建链打包；Runtime 和契约仍由已有资源清单携带。业务源码/Mock 和包格式无改动，无需为此重建业务 Web。同步迁移台账 DSH-BIZ-099。

本轮未提交，未替换活动客户端，未修改用户现有 Profile/Mock 或另一台电脑的运行记录。真实 ABN 端到端耗时和页面结果未验收。
