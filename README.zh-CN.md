# CFDesk

这是 `makerjackie/cf-desk` 的中文说明。

CFDesk 是一个面向 Cloudflare 日常运维的原生桌面工作台，重点放在远程资源：R2 素材、D1 数据库、Workers、Queues、KV、Token 权限检查，以及带确认的安全操作。

CFDesk 基于 MakerJackie 对 [CF Studio](https://github.com/mubashardev/cf-studio) 的 fork 继续改进。我们感谢原 CF Studio 项目提供的桌面基础；CFDesk 会保留好用的部分，并把方向收拢到更明确的远程 Cloudflare 资源管理。

官网：[cfdesk.01mvp.com](https://cfdesk.01mvp.com)

## 4 月 18 日之后的主要更新

- 增加 Cloudflare API Token 引导、macOS Keychain 保存，以及 D1、R2、KV、Workers、Queues、Analytics 权限检查。
- 扩展中英文界面文案，主界面、设置页和资源页都进入更可维护的 i18n 结构。
- 强化 R2 素材工作流：缓存对象列表、上传/下载、图片预览、公开 URL 复制、公开域名检测、传输设置、分片上传，以及删除/覆盖前确认。
- 把产品主线从 D1/R2 扩展到远程 KV、Workers、Queues 和账号总览。
- 增加 Workers 快捷操作、近期健康信号、指标、观测设置、配置检查，以及更低风险的复制和跳转入口。
- 对删除、覆盖、Worker 设置、Secret、路由、域名、计划任务等远程写操作加入确认。
- 改进 macOS 从 Finder 启动时对 nvm、Wrangler、Cloudflare token 环境变量的检测。
- 更新 MakerJackie fork 的 release metadata、更新检查、构建产物命名和公开文档。

## 功能范围

- **CFDesk Home：** 本机命令中心，集中展示账号状态、资源数量、准备度、缓存新鲜度、Workers 健康、Wrangler runbook 和文档入口。
- **R2 素材管理：** 浏览存储桶，上传/下载文件，预览图片，复制公开 URL，检查公开域名状态。
- **D1 数据库：** 浏览数据库和表，运行 SQL，查看结构图，管理索引，导出常用格式。
- **Workers 运维：** 查看 Workers、部署和设置，复制路由，打开 Dashboard，检查近期健康状态，管理观测设置。
- **KV 和 Queues：** 作为远程资源检查和轻量操作入口。
- **Token 检查：** 验证当前 token 是否能访问 CFDesk 需要的 Cloudflare API。
- **全局命令：** `Cmd/Ctrl+K` 打开导航、文档、账号操作、Wrangler 命令复制，以及 Token/环境变量片段。
- **隐私遮罩：** 演示或录屏时模糊账号、数据库、存储桶和对象名。
- **Local Explorer 入口：** 本地 `wrangler dev` 绑定数据交给 Cloudflare 官方 Local Explorer，CFDesk 专注远程账号资源。

## v1.3.0 CFDesk Home Release

v1.3.0 增加 CFDesk Home、命令中心、快捷键、缓存新鲜度、工作台准备度检查、Workers 健康摘要、Wrangler runbook，以及主要页面按需加载。完整改进清单见 [docs/cfdesk-release-1.3.0.md](docs/cfdesk-release-1.3.0.md)。

## v1.3.1 稳定性发布

v1.3.1 强化导出安全、R2 素材工具、Workers 和 Queues 指标解析、本地化覆盖，以及 release metadata 校验。同时扩展了这些边界的 Vitest 测试。

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
git clone git@github.com:makerjackie/cf-desk.git
cd cf-desk
export PATH="$HOME/.bun/bin:$PATH"
source "$HOME/.cargo/env"
bun install --frozen-lockfile
bun run tauri dev
```

如果使用 API Token：

```bash
export CLOUDFLARE_API_TOKEN="your-token"
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
bun run tauri dev
```

也可以在 App 的 Settings 页面粘贴 API Token。当前 macOS 版本会把它保存到 Keychain。Token 创建入口：

```txt
https://dash.cloudflare.com/profile/api-tokens
```

建议权限：

```txt
Account:Read
D1:Read / D1:Edit
R2 Storage:Read / R2 Storage:Edit
Workers KV Storage:Read / Workers KV Storage:Edit
Workers Scripts:Read / Workers Scripts:Edit
Queues:Read / Queues:Edit
Account Analytics:Read
```

## 构建本机 App

```bash
export PATH="$HOME/.bun/bin:$PATH"
source "$HOME/.cargo/env"
bun run build
bun run tauri build
```

macOS app 通常会生成在：

```bash
src-tauri/target/release/bundle/macos/CFDesk.app
```

安装到 `/Applications`：

```bash
cp -R "src-tauri/target/release/bundle/macos/CFDesk.app" /Applications/
```

这个 fork 暂时不做 Apple 签名和公证。如果 macOS 阻止打开本地构建版本或从 Release 下载的版本，可以移除 quarantine 标记：

```bash
xattr -dr com.apple.quarantine /Applications/CFDesk.app
```

## 网站

双语介绍站点在 [site](site)。推送到 `main` 后，GitHub Actions 会部署为 Cloudflare Worker，并绑定到 `cfdesk.01mvp.com`。

## License

[MIT](LICENSE)
