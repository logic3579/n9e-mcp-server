# Release & 使用指南(@logic3579 私有 npm 包)

本仓库是 [n9e/n9e-mcp-server](https://github.com/n9e/n9e-mcp-server) 的 fork。
我们通过新增的 `release-private.yml` workflow 把构建产物发布到 npm 的
`@logic3579` 组织下,**不影响**官方的 `release.yml`。

## 一次性准备

1. **NPM 端**
   - 确保 `@logic3579` npm 组织存在,且发布者账号有 publish 权限。
   - 在 npmjs.com 生成一个 **Automation Token**(类型选 `Automation`,这样不受
     2FA 影响)。
2. **GitHub 端**
   - 进入 `Settings → Secrets and variables → Actions → New repository secret`。
   - 添加 secret:`NPM_TOKEN` = 上面生成的 token。
   - **不**需要额外 `GITHUB_TOKEN`,workflow 默认即可。

## 发布流程(每次 release)

1. 在新分支 / main 上确认要发布的 commit。
2. GitHub 仓库 → **Actions** 标签 → 左侧选 **Release Private (npm @logic3579)**。
3. 点 **Run workflow**:
   - **version**:必填,纯数字版本(如 `0.1.0`、`0.2.1`)。**不要**带 `v` 前缀。
   - **dry_run**:首次试跑可勾上,只走流程不上传 npm。
4. 点 **Run workflow** 按钮。Action 大约 2–3 分钟完成。

成功后,以下 7 个包会在 npm 上更新:

```
@logic3579/n9e-mcp-server                  (主包,纯 JS 包装)
@logic3579/n9e-mcp-server-darwin-arm64
@logic3579/n9e-mcp-server-darwin-x64
@logic3579/n9e-mcp-server-linux-arm64
@logic3579/n9e-mcp-server-linux-x64
@logic3579/n9e-mcp-server-win32-arm64
@logic3579/n9e-mcp-server-win32-x64
```

## 团队成员怎么用

### Cursor / Claude Code(stdio 模式)

把下面的内容写进 `~/.cursor/mcp.json`(Cursor)或对应客户端的 MCP 配置:

```json
{
  "mcpServers": {
    "nightingale": {
      "command": "npx",
      "args": ["-y", "@logic3579/n9e-mcp-server", "stdio"],
      "env": {
        "N9E_TOKEN": "your-api-token",
        "N9E_BASE_URL": "http://your-n9e-server:17000"
      }
    }
  }
}
```

如何拿 `N9E_TOKEN`:登录夜莺 web → 个人设置 → 个人信息 → Token 管理。

### 仅启用部分工具集(节省上下文 token)

```json
"env": {
  "N9E_TOKEN": "...",
  "N9E_BASE_URL": "...",
  "N9E_TOOLSETS": "alerts,targets,metrics,logs"
}
```

可用 toolset 列表见 [README.md](./README.md#available-tools)。

### 只读模式

```json
"env": {
  "N9E_TOKEN": "...",
  "N9E_BASE_URL": "...",
  "N9E_READ_ONLY": "true"
}
```

只读模式下所有 `create_*` / `update_*` / `import_*` / `clone_*` / `toggle_*`
工具都会被屏蔽,只暴露 `list_*` / `get_*` / `query_*` 类工具。

## 版本号约定

- 严格遵循 semver:`major.minor.patch`。
- npm 不允许重复发布同一版本号,bump 后重新触发即可。
- 改动较大(API 不兼容)bump major;新增 toolset/工具 bump minor;bug fix bump patch。

## 与官方 release.yml 的关系

- 官方 `release.yml` 仍然在,触发条件是推 `v*` tag。我们的 workflow **不会**
  推 tag,所以不会触发官方流程。
- 官方流程会发布到 `@n9e/n9e-mcp-server`,我们的发到 `@logic3579/...`,
  npm 上互不冲突。
- 如果将来想自己也保留 GitHub Release(给二进制下载),可以单独再加一个
  workflow 跑 `goreleaser release`(不带 `--snapshot`),但目前 npm 包内
  已经捆绑了二进制,通常不需要。

## 排错

| 现象 | 原因与对策 |
|---|---|
| `403 You don't have permission to publish` | NPM_TOKEN 失效或账号无 `@logic3579` 发布权限 |
| `404 Not Found` for sub-package | 主包先发了、子包没发成功;workflow 内置先发子包后发主包,通常不会出现;手动重跑即可 |
| `goreleaser: no archive matches` | dist/ 没生成对应平台,看 goreleaser 步骤日志 |
| 客户端启动报 `Unsupported platform` | 当前 OS/arch 没被 PLATFORM_MAP 覆盖,目前仅支持 darwin/linux/windows × arm64/amd64 |
