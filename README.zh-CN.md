# CF Studio MakerJackie Fork

这是 `makerjackie/cf-studio` 的中文说明。这个 fork 基于 `mubashardev/cf-studio`，目标是评估它是否适合作为本地 Cloudflare 管理器的基础。

## 这个 fork 改了什么

- 修复 macOS GUI 启动时检测不到 nvm 中 `node` / `wrangler` 的问题。
- 增加基础中英文界面切换。
- D1 / R2 / KV 主要页面已接入中文文案。
- 优先读取 `CLOUDFLARE_API_TOKEN` 环境变量；没有环境变量时可在设置页手动保存 API Token 到 macOS Keychain；再回退到 Wrangler OAuth 配置。
- 用公开 fallback 替换上游私有 `src/pro_modules` submodule，让仓库可以直接 clone、安装、构建。
- 补齐 R2 上传、下载、图片预览、复制公开 URL、公开域名状态。
- 增加 Token 权限检查页，用于排查 D1 / R2 / KV 权限。

## 功能范围

当前公开 fork 适合用来评估这些工作流：

- D1 数据库列表
- D1 表结构查看
- D1 表数据浏览
- D1 SQL 查询编辑器
- D1 可视化结构图
- R2 存储桶和对象列表、上传、下载、图片预览、公开 URL 复制
- Token 权限检查
- KV 占位页

注意：这个 fork 不包含上游私有 Pro 模块。高级导出、完整审计能力等功能需要单独实现或继续接入。

## 本地开发

准备环境：

```bash
brew install bun
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
npm install -g wrangler
wrangler login
```

启动：

```bash
git clone git@github.com:makerjackie/cf-studio.git
cd cf-studio
export PATH="$HOME/.bun/bin:$PATH"
source "$HOME/.cargo/env"
bun install --frozen-lockfile
bun run tauri dev
```

如果你使用 API Token，而不是 `wrangler login`：

```bash
export CLOUDFLARE_API_TOKEN="your-token"
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
bun run tauri dev
```

如果你不熟悉终端环境变量，可以在 App 的 Settings 页面粘贴 API Token。当前 macOS 版本会把它保存到 Keychain。Token 创建入口：

```txt
https://dash.cloudflare.com/profile/api-tokens
```

建议权限：

```txt
Account:Read
D1:Read / D1:Edit
R2 Storage:Read / R2 Storage:Edit
Workers KV Storage:Read / Workers KV Storage:Edit
```

## 构建本机 App

```bash
export PATH="$HOME/.bun/bin:$PATH"
source "$HOME/.cargo/env"
bun run tauri build
```

macOS app 通常会生成在：

```bash
src-tauri/target/release/bundle/macos/CF-Studio.app
```

安装到 `/Applications`：

```bash
cp -R "src-tauri/target/release/bundle/macos/CF-Studio.app" /Applications/
```

如果 macOS 阻止打开本地构建版本，可以移除 quarantine 标记：

```bash
xattr -dr com.apple.quarantine /Applications/CF-Studio.app
```

## 当前判断

这个 fork 更适合作为“Cloudflare Dashboard / Wrangler / cf CLI 的本地伴侣”，而不是完整替代官网。短期更值得投入的方向是：

- 让 D1 表格浏览和 SQL 编辑更稳定。
- 把 R2 做成更像图床和素材管理器。
- 补齐 KV 搜索和 JSON 编辑。
- 增加本地 Wrangler / Local Explorer / 远程资源对比。
- 把中文和英文文案整理成更完整的 i18n 结构。
