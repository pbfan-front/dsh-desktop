# 对话读取当前业务预览诊断

2026-10-23 实现，2026-10-24 补完隔离嵌入点击验收；BEA-060 / DSH-BIZ-096，未提交。

## 用途与调用

新增只读工具 `business_preview_diagnostics`。当用户反馈预览空白、重复打开异常、接口未命中等问题时，先读取当前预览的近期证据，再做聚焦源码检查，不默认要求用户手工截图 DevTools。

默认读取当前对话、当前激活版本的最近 120 秒，最多 30 条；`kind` 可选 network/error/console/resource/lifecycle/route，`limit` 为 1–50，`windowMs` 为 1000–600000。`scope=session` 显式查看同一对话此前的激活版本，不能读取其他对话。返回新的 `instanceId`、序号及 coverage；带游标时必须同时传相同 instanceId，Runtime 重启返回 `E_DIAGNOSTICS_RESET`，不能把旧日志当新日志。

工具同时返回当前路由观察的时间/路径，以及原 Mock 请求证据计算出的 API/Scenario 命中对照。没有页面正文、字段值或完整工作流上下文。没有当前对话身份时拒绝读取，不回落到 default 会话。

用户可直接描述：“读取当前业务预览日志，分析第二次打开协议空白；区分观察与推测，先不要修改 Mock。”工具描述引导先读运行证据，但工具存在并不证明每个模型都会主动调用，本条不宣称新的 Agent 遵循率或诊断准确率。

## 采集范围

业务 iframe（仅 local-mock 且嵌入本地预览时）安装独立采集器：

- `console.warn/error` 的首个短文本；对象参数不序列化。
- 未捕获 error、未处理 Promise rejection 的短消息，以及资源加载错误。
- fetch/XHR 开始、结束/失败的 URL 路径、方法、HTTP 状态、耗时、可见的 MIME 和 Content-Length；不读取、clone 或消费任何响应体。
- 浏览器提供的资源 timing（不重复采集 fetch/XHR）；缺少大小不解释为空文件，不推断缓存命中或 CORS 根因。
- hash 路由变化，以及 PDF Reader 的脚本加载、mounted、初始化、render 调用/返回/失败、销毁前等标记。render 返回与 HTTP 200 均不等于文档已渲染成功。

采集器保留原 console、fetch 返回/拒绝及 XHR 行为。fetch/XHR 使用请求开始时的激活身份，旧请求迟到不会算到新分支。重复安装先清理旧实例，卸载撤销自身监听/包装、资源 observer、未完成 XHR 监听和队列；不覆盖其他库随后安装的包装。

日志仅经 `postMessage` 发送到 referrer 指定的本地父窗口。父页要求 `event.source` 等于当前业务 iframe 且 origin 匹配，不接收同源其他 frame 的消息；序列化前只投影有限原始类型字段。再由 GUI 同源 POST 到 Runtime，不将控制 token 暴露给页面。

## 安全与容量

Runtime 的新 POST `/__desktop/diagnostics-ui` 沿用既有 GUI 同源或 Bearer 边界；GET `/__desktop/diagnostics` 必须 Bearer 鉴权。Host/Origin/Sec-Fetch-Site 门禁保持，未放宽浏览器隔离、CORS、IPC 或网络权限。

Runtime 再次校验 schema、会话、Profile、revision/revisionId，拒收旧激活记录；白名单投影并再次脱敏。URL 不带查询、hash、userinfo，blob/data 只保留类型；常见凭据、邮箱、长标识及结构化/二进制/文档字符串被省略。不能保证任意自由文本都完全匿名，勿把真实个人资料或合同文本写入日志；默认不记录完整请求/响应、请求头、Cookie 或合同正文。

浏览器队列最多 100 条，每批 20 条，300ms 刷新；父页最多排队 5 批，不无限重试。Runtime 每会话最多 200 条、最多 20 个会话、每会话每秒最多 100 条；事件正文每次读取最多约 12KB。coverage 报告可用/返回/省略/丢弃/过期拒收/限流数量。存储仅 Runtime 内存，重启丢失，不能查看启动前的历史；没有记录不证明没有发生错误。

诊断是来自业务页面的不可信数据，不是指令，也不是创建来源批准、API 成功或页面验证证据。原确认、创建、Profile 选择和预览核验逻辑完全不读取这个缓冲区；工具不会跳页、提交业务、创建/应用/重试/批准。

## 分发与回退

Desktop 新模块 `build/business-preview-diagnostics.mjs` 显式进入 extraResources；Runtime 只组装，工具使用原业务插件与同会话请求头，无新依赖或 Agent Runtime。

需同时同步：

1. Desktop 的新 Runtime 模块、入口 import/端点、package.json 分发配置及业务工具入口。
2. 业务工程 `src/services/common/localMockDiagnostics.js`、`src/main.js`、PDF Reader 标记、Mock Platform 的 relay 模块与 Home effect。
3. 重建业务 Web/Mock Platform 并导出业务包，再正常重启 Desktop。只复制页面或只重启旧包不能生效，早期日志不会补采。

业务导包 sourceSnapshot 按 Git 索引列举源码；新增 `src` 模块应纳入索引后再导包（可以仅暂存、不提交），否则源码副本缺失。本次隔离导包验证使用临时 Git 索引纳入新模块，没有修改用户原索引；生产 Web 也单独重建检查，不借用旧 bundle。

可在构建时设置 `VUE_APP_DSH_PREVIEW_DIAGNOSTICS=off` 禁用采集，再重建业务 Web；原预览/Mock/核验保持。完整回退成组恢复本条 Runtime/工具和业务采集/relay/PDF 标记并重建，不删除 Profile、会话或历史。

## 验证

- Desktop 全量 `npx vitest run --fileParallelism=false`：216 文件 / 1955 项通过，原有 1 文件 / 1 项跳过。复用已准备的 Office/PPT 资源，未运行会修改活动依赖的 pretest；不声称该命令等同于重新准备依赖。
- 新业务采集/relay 6 项行为测试通过；相关 Profile/预览恢复回归通过。覆盖请求行为保持、不读二进制正文、异常、原激活身份、清理、严格 frame/origin、循环对象白名单及队列丢弃。
- 真实 defineTool → HTTP → 搬迁后的 Runtime 资源子进程：GUI 写入/工具读取、会话隔离、无身份拒绝、脱敏、401/403/413/422 和只读状态保持通过。
- TypeScript、JS 语法、原 Runtime 脚本回归、Next 生产构建、临时目录 Electron main/preload 构建、业务 Web local-mock 生产构建及隔离导出完整性通过。
- 2026-10-24 解锁后，在隔离 Runtime 的真实 Mock Platform iframe 内通过浏览器按钮连续发出两次示例 PDF fetch，再触发警告、未捕获异常及 XHR 404。真实注册的工具读取到 11 条对应事件、coverage.captured=true、dropped=0；两次 PDF 均分别记录开始/结束、HTTP 200、application/pdf 和 56 字节可见头长度。警告 token 已脱敏，查询参数与对象中的文档哨兵未出现在返回值。父页通过普通同站链接进入，未绕过 Host/Origin/Sec-Fetch 门禁。
- 上述点击使用受控 fixture，不是实际合同或 PDF 渲染验收；没有将新包替换进活动 Electron，也未验证自然语言模型会自主调用或准确诊断。真实业务 PDF 空白根因仍待通过新日志定位，不能宣称截图问题已经修复。

当前运行的旧客户端/业务包尚未替换；原业务数据不应清空。本条检索/缓存优化仍暂停，没有继续重做场景分析或新增复杂工作流。

收尾快照：原 9 份用户 Mock/Profile 及工作流文件哈希不变，8 个原预览会话的 Profile/revision 均保持；其中 1 个路由观察补入与原已选 Profile 一致的 `__mockProfile` 参数，业务路径未变。未通过写回旧快照覆盖这一观察更新。隔离测试服务和约 1GB 构建/源码副本已清理；验收截图仅保留为本机临时证据。
