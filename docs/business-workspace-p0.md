# 业务工作区 P0 原型

本原型把预先构建的业务页面、Mock 平台、源码快照和索引随 DSH Desktop 启动，并将源码快照注册为 Harness 工作区。用户无需在目标机器执行 `npm install`。

## 当前能力

- Desktop 以随机回环端口启动独立业务服务，不占用开发服务的 8094 端口。
- Harness 自动出现业务源码工作区，并注册业务上下文、CodeIntell 目标分析、Profile 查询/应用/创建、预览验证和回滚工具。
- 对话顶部的“侧栏体验”在持久化右侧栏中打开业务页面；切换对话或收起侧栏不会销毁 iframe。只有用户从 Harness 菜单显式操作时才允许打开独立业务体验窗口。
- 业务静态资源和 Mock 请求只允许访问本机服务；控制接口使用随机令牌。
- 退出、更新 Desktop 时只停止 Desktop 自己创建的业务进程。

P1 已提供独立用户场景目录，以及分析、创建、应用、验证和回滚工具。创建前必须调用 `business_analyze_target`：服务按精确路由读取 CodeIntell 的页面、Interactor、API caller 和同业务域证据，返回候选接口、已有 Mock、响应外层和业务字段，并签发 30 分钟有效的 `evidenceId`；`business_create_profile` 只接受该次分析确认的路由和接口，不能凭模型猜测接口。受控业务工具的所有写入仅落到 Desktop userData，不修改内置源码；macOS 签名要求打包输入可写，因此不能用文件 `0444` 作为发布方案，最终不可变边界由签名 App 完整性和工具授权共同保证。已有 API Mock 会被复用；如果 API 已由 CodeIntell/源码证据确认、尚无 `mock.json` 且存在可解析的 `Rsp.ts`，服务可在用户 Overlay 生成带标准响应信封的首个基础 Mock。每个 Profile 对同一 API 只允许一个场景绑定；服务会拒绝重复 `data` 包裹和非法路由，并在写入后通过真实中间件请求验证 Profile/Scenario 命中。任一步骤失败都会恢复全部已修改文件。页面验证同时检查当前 Profile、绑定场景的真实请求命中、iframe 当前路由以及必须出现/不得出现的可见文案。Profile、路由、页面观察和请求证据已按 Harness 对话隔离；侧栏按钮自动传递当前 `sessionId`，iframe 通过同源 Cookie 选择对应状态。尚未完成正式签名公证和干净机器验收。

用户 Profile 和 Scenario 使用 Schema v2。业务运行时启动时会迁移 v1 数据，并记录创建场景时所依据的业务 Build ID 和内置 Mock 指纹。升级后的内置 Mock 结构兼容时自动更新基线；字段不兼容或内置 API 被移除时标记为 `needs-repair` 并阻止应用，不会静默使用错误数据。`business_user_data_status` 可查看迁移、冲突和用户目录，`business_export_scenarios` 导出不含凭据的便携 JSON 包，`business_import_scenarios` 在另一台电脑原子导入并返回可回滚的 operationId。

覆盖安装和普通升级复用 Desktop 的 userData，用户场景会保留。卸载程序是否删除 userData 取决于系统和卸载选项；跨电脑迁移、主动清理 userData 或重装前，应先调用 `business_export_scenarios`。导入默认拒绝同 ID Profile，只有明确设置 `replaceExisting=true` 才覆盖。

## 生成业务包

Desktop 仓库提供一条完整同步命令。它会刷新生成路由、编译并更新 CodeIntell 索引、编译 local-mock 业务 Web、构建 `mock-platform`，然后原子替换业务包并立即校验清单：

```bash
npm run business:sync
```

仅在上述产物已由同一受信流水线生成时，才可使用 `npm run business:export` 跳过重新构建并执行原子导出。日常开发不应使用该命令。

默认业务仓库是相邻的 `../demo-test`，可通过 `DSH_BUSINESS_PROJECT` 和 `DSH_BUSINESS_WEB_ROOT` 覆盖。导出清单记录业务提交、平台 BUILD_ID、平台页面源码、全部业务源码、业务 Web 入口和 CodeIntell 索引摘要。

所有 Desktop 打包命令都会先运行：

```bash
npm run business:verify
```

只要业务源码在导出后变化、Next.js 产物过期、业务包被修改、CodeIntell 或 Web 入口错配，打包就会失败并提示重新执行 `npm run business:sync`，不再允许旧产物进入安装包。

## 开发运行与验证

`npm run dev:business` 会同时启动业务开发服务、Desktop 和 CodeIntell 源码监听。修改 `demo-test/src` 后，业务页面继续走 HMR，CodeIntell 在 800ms 防抖后执行增量索引；成功后运行时会在下一次状态查询或场景分析时热重载，无需重启 Desktop。

侧栏右上角会显示“索引正常 · N 路由”或“索引异常 · 场景分析已降级”。也可以在对话中调用 `business_code_intell_status` 查看索引生成时间、源码摘要、覆盖率与最近错误。

```bash
DSH_BUSINESS_PACKAGE="$PWD/build/business-package" npm run dev
npm run typecheck
npm run business:verify
npm run business:accept
npm run business:regression
npx vitest run test/business-plugin.test.ts test/runtime.test.ts
node scripts/test-business-runtime.mjs build/business-package
```

日常业务页面联调使用：

```bash
npm run dev:business
```

该命令同时启动 `demo-test` 的 local-mock dev server 和 Desktop 源码开发进程。侧栏仍由 Desktop 业务运行时管理 Profile 和证据，内部业务 iframe 改为加载 dev server，业务源码保存后可热更新。开发 Mock 数据写入 `build/business-dev-user-data`，不与安装版用户数据混用。

`business:accept` 使用临时用户目录验收 15 个黄金数据链路场景，覆盖借据、额度、企个切换、套餐、收款账户、借款申请、KYC 和还款试算的正常与失败分支。它要求 CodeIntell 自动识别目标 API，随后创建并应用临时 Profile，检查 Mock 命中头及关键业务字段，最后回滚全部写入。

业务插件、Desktop 运行时或 CodeIntell 更新后，统一运行：

```bash
npm run business:regression
```

该命令依次执行业务包完整性校验、业务运行时回归和 15 个黄金场景验收。结果会写入 `build/reports/business-regression/latest.json`，并按执行时间保留一份历史报告。报告属于本机构建证据，不提交 Git，也不会自动加入每次打包流程；打包仍只执行较快的 `business:verify`。

运行时连接描述文件位于 Desktop 自身的 userData 目录，权限为 `0600`。不要复制该文件或其中令牌。也不要把业务服务固定到 8094；随机端口用于避免干扰 VSCode 中的开发服务。

## P1 状态与后续

已完成：基础源码随业务包发布、受控写入与源码目录分离；新增独立且可升级保留的用户数据目录；Harness 增加 `business_analyze_target`、`business_create_profile`、`business_verify_preview` 和 `business_rollback`。创建流程强制先取得 CodeIntell 结构化证据，再校验 Profile、API 和场景结构，并为每次操作生成回滚快照。`business_preview_evidence` 可读取当前对话最近 100 条 Mock 请求及 iframe 页面观察证据；不同对话的 Profile 和验证状态互不覆盖。

后续：

1. 使用业务验收样本补充真实页面 DOM/截图断言。
2. 完成签名安装包、干净机器和连续升级验证。
