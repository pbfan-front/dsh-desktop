# 业务工作区 P0 原型

本原型把预先构建的业务页面、Mock 平台、源码快照和索引随 DSH Desktop 启动，并将源码快照注册为 Harness 工作区。用户无需在目标机器执行 `npm install`。

## 当前能力

- Desktop 以随机回环端口启动独立业务服务，不占用开发服务的 8094 端口。
- Harness 自动出现业务源码工作区，并注册业务上下文、CodeIntell 目标分析、Profile 查询/应用/创建、预览验证和回滚工具。
- 对话顶部的“侧栏体验”在持久化右侧栏中打开业务页面；切换对话或收起侧栏不会销毁 iframe。只有用户从 Harness 菜单显式操作时才允许打开独立业务体验窗口。
- 业务静态资源和 Mock 请求只允许访问本机服务；控制接口使用随机令牌。
- 退出、更新 Desktop 时只停止 Desktop 自己创建的业务进程。

P1 已提供独立用户场景目录，以及分析、创建、应用、验证和回滚工具。创建前必须调用 `business_analyze_target`：服务按精确路由读取 CodeIntell 的页面、Interactor、API caller 和同业务域证据，返回候选接口、已有 Mock、响应外层和业务字段，并签发 30 分钟有效的 `evidenceId`；`business_create_profile` 只接受该次分析确认的路由和接口，不能凭模型猜测接口。受控业务工具的所有写入仅落到 Desktop userData，不修改内置源码；macOS 签名要求打包输入可写，因此不能用文件 `0444` 作为发布方案，最终不可变边界由签名 App 完整性和工具授权共同保证。场景创建只接受已存在的 API mock，每个 Profile 对同一 API 只允许一个场景绑定；服务会拒绝重复 `data` 包裹和非法路由，自动补齐既有响应外层字段，并在写入后验证 Profile/Scenario 绑定。任一步骤失败都会恢复全部已修改文件。页面验证同时检查当前 Profile、绑定场景的真实请求命中、iframe 当前路由以及必须出现/不得出现的可见文案。Profile、路由、页面观察和请求证据已按 Harness 对话隔离；侧栏按钮自动传递当前 `sessionId`，iframe 通过同源 Cookie 选择对应状态。尚未完成正式签名公证和干净机器验收。

## 生成业务包

Desktop 仓库提供一条完整同步命令。它会构建 `mock-platform`、原子替换业务包并立即校验清单：

```bash
npm run business:sync
```

默认业务仓库是相邻的 `../demo-test`，可通过 `DSH_BUSINESS_PROJECT` 和 `DSH_BUSINESS_WEB_ROOT` 覆盖。导出清单记录业务提交、平台 BUILD_ID、平台页面源码、全部业务源码、业务 Web 入口和 CodeIntell 索引摘要。

所有 Desktop 打包命令都会先运行：

```bash
npm run business:verify
```

只要业务源码在导出后变化、Next.js 产物过期、业务包被修改、CodeIntell 或 Web 入口错配，打包就会失败并提示重新执行 `npm run business:sync`，不再允许旧产物进入安装包。

## 开发运行与验证

```bash
DSH_BUSINESS_PACKAGE="$PWD/build/business-package" npm run dev
npm run typecheck
npm run business:verify
npm run business:accept
npx vitest run test/business-plugin.test.ts test/runtime.test.ts
node scripts/test-business-runtime.mjs build/business-package
```

`business:accept` 使用临时用户目录验收两个真实业务基准：借据列表“借据状态正常”和额度页“核额失败”。它要求 CodeIntell 自动识别目标 API，随后创建并应用临时 Profile，检查 Mock 命中头及关键业务字段，最后回滚全部写入。

运行时连接描述文件位于 Desktop 自身的 userData 目录，权限为 `0600`。不要复制该文件或其中令牌。也不要把业务服务固定到 8094；随机端口用于避免干扰 VSCode 中的开发服务。

## P1 状态与后续

已完成：基础源码随业务包发布、受控写入与源码目录分离；新增独立且可升级保留的用户数据目录；Harness 增加 `business_analyze_target`、`business_create_profile`、`business_verify_preview` 和 `business_rollback`。创建流程强制先取得 CodeIntell 结构化证据，再校验 Profile、API 和场景结构，并为每次操作生成回滚快照。`business_preview_evidence` 可读取当前对话最近 100 条 Mock 请求及 iframe 页面观察证据；不同对话的 Profile 和验证状态互不覆盖。

后续：

1. 使用业务验收样本补充真实页面 DOM/截图断言。
2. 完成签名安装包、干净机器和连续升级验证。
