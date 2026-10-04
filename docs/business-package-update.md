# Business Plugin 独立更新

BEA-011 将 Desktop 壳与业务插件分离。当前完成插件身份与能力校验、本地导入、兼容性校验、完整性校验、原子切换和上一版本回滚；网络自动下载与正式签名属于后续阶段。插件契约参见 [Business Plugin 架构](./business-plugin-architecture.md)。

## 业务包协议 v2

`manifest.json` 必须包含：

- `type/pluginId/projectId/displayName/capabilities`：插件身份和受控能力声明。
- `packageVersion`：业务包独立版本。
- `buildId`：本次业务源码、Web、Mock Platform 和 CodeIntell 的唯一构建标识。
- `compatibility.desktop.min/maxExclusive`：允许安装的 Desktop 版本范围。
- `integrity.files`：除 manifest 外所有包文件的 SHA-256。
- `provenance`：业务 Web、CodeIntell、源码和 Mock Platform 构建来源。

独立导入只接受 schema v2；旧 schema 只能作为随 Desktop 安装的内置兼容包，不能写入用户活动包目录。

## 生成本地业务包

```bash
cd /Users/pbfan/work/ai/dsh-desktop
DSH_BUSINESS_PACKAGE_VERSION=0.1.0 npm run business:sync
npm run business:verify
```

输出目录为 `build/business-package`。传输到另一台电脑时应完整复制该目录，不能只复制 Web 或 Mock 文件。

## Desktop 中导入

打开应用菜单，选择“导入业务包…”，再选择包含 `manifest.json` 的业务包目录。Desktop 会依次执行：

1. 校验 schema、独立版本和 Desktop 兼容范围。
2. 校验逐文件 SHA-256，拒绝缺失或被修改的文件。
3. 复制到用户数据下的 staging 目录并再次校验。
4. 注册到 `business/plugins/registry.json`，原子更新 `business/plugins/active.json`，同时保留上一 Build ID。
5. 下次启动时使用新包；Profile、Scenario 和 Mock Overlay 仍位于 `business/user-data`，不会被覆盖。

新包损坏、不兼容或活动指针不可读时，Desktop 自动使用安装包内置业务包。

## 回滚

应用菜单选择“回退上一业务包”。回滚只切换活动指针，不修改两个业务包内容，也不修改用户场景数据，下次启动生效。

## 后续阶段

- 为 manifest 和完整性清单增加非对称签名。
- 从受信更新源读取版本索引并只下载业务包。
- 后台下载、验证、原子激活和失败自动回滚。
- 清理不再被 active/previous 引用的旧包，同时保留用户数据。
