# 体验分支请求序列隔离

2026-10-28，未提交。业务仓库迁移项DSH-BIZ-103的Desktop配套改动。

`build/business-runtime.mjs` 在Runtime生命周期内持有同一份profileSequenceCounts Map，并传给初始化和apply/import/create/rollback及失败恢复中的每次createMock。业务中间件同时按sessionId/revisionId/Profile/API分隔计数，避免另一个会话apply时重建中间件导致已有序列归零。旧业务包未接收这个选项，必须同时迁移/重建业务中间件才能完整生效。Main/Preload权限与用户数据协议不变。

业务端同时修复同IDOverlay优先、无效绑定422、Local Mock Vuex/开关旧值残留和同页切换的旧URL覆盖。文件、复现、兼容边界和命令详见业务仓库`docs/dsh-desktop-mock-stability-fix.md`，不要拷贝开发用户目录作为补丁。

验证：业务21项回归含本Runtime实际子进程HTTP请求（Next占位，不算UI验收）；额外真实Vue+Next临时预览完成三轮额度布局切换及刷新。Desktop默认分支隔离、Mock检查和插件契约共41项通过，npm run typecheck通过，Runtime语法与diff检查通过。没有替换活动包，未跑正式安装包/Windows验收。

迁移：合并本文件的Map传递与业务源码后正常重建business:sync、verify并重启；无需清用户缓存。回退需整体回退本条业务规则与Runtime参数并重建，不删除Profile/Overlay。
