# DSH Desktop 官方仓库同步操作手册

本文档用于将官方 `dataelement/dsh-desktop` 的最新代码同步到个人仓库，并合并到业务体验分支 `dsh_bus`。

## 远端关系

```text
upstream  https://github.com/dataelement/dsh-desktop
origin    https://github.com/pbfan-front/dsh-desktop.git
```

- `upstream`：官方仓库，只拉取，不推送；
- `origin`：个人 Fork，用于保存 `main` 和 `dsh_bus`；
- `dsh_bus`：业务体验特性分支。

## 同步前检查

先确认工作区没有未提交修改：

```bash
cd /Users/pbfan/work/ai/dsh-desktop
git status
```

如果存在修改，应先提交或暂存，不能直接开始合并。

## 标准同步命令

```bash
cd /Users/pbfan/work/ai/dsh-desktop

# 1. 获取官方最新代码
git fetch upstream

# 2. 将本地 main 快进到官方 main
git switch main
git merge --ff-only upstream/main

# 3. 更新个人仓库的 main
git push origin main

# 4. 将最新 main 合并到业务体验分支
git switch dsh_bus
git merge main

# 5. 验证后推送业务体验分支
git push
```

## 合并后的检查

```bash
git status
git log --oneline --decorate -10
npx vitest run test/business-development-mode.test.ts test/business-sync-plan.test.ts
node scripts/test-business-runtime.mjs
```

确认以下结果：

- 当前分支为 `dsh_bus`；
- 工作区干净；
- `dsh_bus` 跟踪 `origin/dsh_bus`；
- 业务体验相关测试通过；
- Desktop 开发模式和侧栏业务预览可正常启动。

## 出现冲突时

`git merge main` 如果发生冲突，不要强制推送，也不要执行 `git reset --hard`。先查看冲突：

```bash
git status
git diff --name-only --diff-filter=U
```

逐个处理冲突后执行：

```bash
git add <已处理的文件>
git commit
```

完成测试后再执行：

```bash
git push
```

如果决定放弃本次尚未完成的合并，可执行：

```bash
git merge --abort
```

## 注意事项

- 不要向 `upstream` 推送代码；该远端已配置为禁止推送。
- 不要在 `dsh_bus` 上直接执行 `git pull upstream main`，应先更新本地 `main`，再合并到 `dsh_bus`。
- 不要使用 `git push --force` 覆盖远端业务分支。
- 官方代码合并后，应先完成业务体验验证，再发布安装包。
