# Desktop 正式包与干净机验收

本清单用于 BEA-010。正式发布必须分别在原生 macOS 和 Windows 环境完成；开发包验收不能替代正式签名、公证和时间戳验收。

## 1. 构建前

```bash
npm ci
npm test
npm run typecheck
npm run business:verify
npm run release:preflight
```

`release:preflight` 会阻止无合法 Desktop 版本、无业务 Build ID、缺业务运行时或缺业务 Web 入口的构建。开发包使用 `npm run release:preflight:dev`。

## 2. 正式构建

- macOS Apple Silicon：`npm run package:mac:arm64`
- macOS Intel：`npm run package:mac:x64`
- Windows x64：`npm run package:win`

正式包优先使用 GitHub Actions 的 `Release desktop installers` 工作流，证书、Apple 公证密钥和 Windows UKey 不应落入源码或普通开发机。

## 3. 签名与产物检查

macOS：

```bash
node scripts/release-preflight.mjs --channel production --artifact "dist/mac-arm64/DSH Desktop.app"
node scripts/release-preflight.mjs --channel production --artifact dist/dsh-desktop-mac-arm64.dmg
```

Windows PowerShell：

```powershell
node scripts/release-preflight.mjs --channel production --artifact dist\dsh-desktop-windows-x64-setup.exe
```

Windows 检查要求 Authenticode 状态为 `Valid` 且存在时间戳证书；macOS 检查要求严格 codesign、Gatekeeper 和 stapler 验证通过。

验证安装包自带的 Node、业务运行时和业务 Web 入口，不读取仓库源码：

```bash
npm run release:smoke:business -- "dist-dev/mac-arm64/DSH Desktop Dev.app/Contents/Resources"
```

Windows 将参数替换为解包目录中的 `resources` 路径。

## 4. 干净机矩阵

每个平台使用未安装 Node.js、npm、业务源码和 DSH 用户数据的机器或全新虚拟机。

| 场景 | macOS | Windows | 验收结果 |
|---|---|---|---|
| 首次安装并启动 | 待实机 | 待实机 | 应进入 Desktop，不依赖外部 Node/npm |
| “关于”版本信息 | 待实机 | 待实机 | 版本、通道、平台、业务 Build ID 均与产物一致 |
| 业务预览 | 待实机 | 待实机 | 可打开页面、切换场景、Mock 请求真实命中 |
| CodeIntell | 待实机 | 待实机 | 索引健康状态可见，可创建业务场景 |
| 覆盖安装同版本 | 待实机 | 待实机 | 用户 Profile/Scenario 和对话不丢失 |
| 旧版升级到新版 | 待实机 | 待实机 | 数据迁移成功，可回看原场景 |
| 卸载后重装 | 待实机 | 待实机 | 按平台的数据保留策略执行，无临时安装文件冲突 |
| 更新失败回退 | 待实机 | 待实机 | 恢复上一已验证版本且用户业务数据保留 |

当前自动化基线：2026-09-29 已完成 macOS ARM64 未签名 Dev 候选包构建，包内版本 `0.1.1-dev.202609290837`、通道 `development`、业务 Build ID `3dbb95619672-working-1790682133141`；脱离源码后，包内 Node 成功启动业务运行时，`/mm2606290/` 返回 `200 text/html`。该结果验证打包完整性，但不替代正式签名、公证和干净机安装。

## 5. 证据留存

每次正式候选版本保存：安装包 SHA-256、工作流运行地址、签名/公证输出、两个平台的“关于”截图、业务预览截图、升级前后版本号和失败回退记录。未完成矩阵中的实机项时，不得把 BEA-010 标记为完成。

本地候选包可生成机器可读证据：

```bash
npm run release:evidence -- artifacts/release-evidence-mac-arm64.json \
  dist-dev/dsh-desktop-dev-mac-arm64.dmg \
  dist-dev/dsh-desktop-dev-mac-arm64.zip
```

证据包含 Desktop 版本、业务 Build ID、业务提交、工作区状态、产物大小和 SHA-256。正式发布要求业务包的 `businessWorkingTree` 为 `false`。
