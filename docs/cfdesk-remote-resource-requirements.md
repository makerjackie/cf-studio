# CFDesk 远程资源管理与 Local Explorer 指引需求文档

## 背景

FlareDesk 是一个非常清晰的本地开发控制台：围绕 `wrangler dev` 展开，帮助开发者管理本地 Workers 项目里的 D1、KV、R2、Queues、Durable Objects、Workflows、日志、快照和 Tunnel。

但 CFDesk 不应该重复做这条产品线。Cloudflare 官方已经提供 Local Explorer，它可以在本地开发服务器中查看和编辑本地绑定数据。对 CFDesk 来说，更合理的方向是：

- 主产品继续聚焦真实 Cloudflare 账号里的远程资源管理。
- 本地开发能力不重复造轮子，只在侧边栏提供 Local Explorer 的介绍、使用步骤和官方文档入口。
- 如果后续需要增强本地体验，也只做轻量入口，例如打开本地 `/cdn-cgi/explorer`，不实现自己的本地 D1/KV/R2/DO/Workflow 管理器。

## 参考资料

- FlareDesk 首页：https://flaredesk.dev/
- FlareDesk 文档：https://flaredesk.dev/docs
- Cloudflare Local Explorer 文档：https://developers.cloudflare.com/workers/development-testing/local-explorer/
- Cloudflare Local Explorer 发布说明：https://blog.cloudflare.com/cf-cli-local-explorer/
- 当前 fork 需求：`docs/makerjackie-fork-requirements.md`
- R2 素材管理需求：`docs/r2-asset-manager-requirements.md`
- R2 上传工作流需求：`docs/r2-upload-workflow-requirements.md`

## 产品定位

CFDesk 是一个面向 Cloudflare 日常工作的桌面工具，核心场景是远程资源的快速查看、上传、导出、调试和维护。

它不是：

- Cloudflare Dashboard 的完整替代品。
- FlareDesk 的复刻版本。
- Wrangler Local Explorer 的替代品。
- 一个以本地 Workers 项目为中心的开发控制台。

它应该是：

- 远程 R2 素材管理器。
- 远程 D1 实用操作台。
- 远程 KV 调试工具。
- Cloudflare API Token 权限检查器。
- Local Explorer 的清晰入口和使用指南。

## 核心原则

- 远程资源管理是主线。
- 本地开发能力优先链接官方 Local Explorer。
- 不维护自己的本地绑定浏览器。
- 不启动、不管理、不包装 `wrangler dev`。
- 不读取或反向解析 `.wrangler/state`。
- 不把 Local Explorer 做成隐藏功能，应该在侧边栏中有明确入口。
- 涉及真实远程资源写入、删除、覆盖时必须确认。
- Cloudflare API Token 不进入前端运行时，不写入 localStorage。
- 用户界面只写给正常使用者，不放实现备注或内部说明。

## 信息架构

### 侧边栏

建议侧边栏保留远程资源优先级：

- Overview
- R2
- D1
- KV
- Token Check
- Local Explorer
- Settings

后续如果增加更多远程资源，可以继续加入：

- Queues
- Workers
- Workflows
- Durable Objects
- Hyperdrive
- Audit

但这些都应该是远程账号资源视角，不是本地项目视角。

### Local Explorer 页面

Local Explorer 是一个说明和跳转页，不是本地管理器。

页面目标：

- 告诉用户 Cloudflare 官方已经提供本地绑定数据浏览/编辑能力。
- 解释它适合什么时候使用。
- 给出最短使用路径。
- 链接到官方文档。
- 可选地提供一个本地 URL 输入框和打开按钮。

页面内容建议：

- 标题：`Local Explorer`
- 简短说明：`Cloudflare 官方提供的本地绑定数据浏览器，可用于查看和编辑 wrangler dev 中的本地 D1、KV、R2、Durable Objects 和 Workflows 数据。`
- 使用步骤：
  - 在项目目录运行 `npx wrangler dev`。
  - 在终端中按 `e` 打开 Local Explorer。
  - 或访问当前本地 Worker 地址下的 `/cdn-cgi/explorer`。
- 支持能力：
  - KV：浏览、查看、创建、更新、删除 key-value。
  - R2：列出对象、查看元数据、上传、删除对象。
  - D1：浏览表和行，运行 SQL，通过 SQL 修改数据。
  - Durable Objects SQLite storage：浏览表和行，运行 SQL。
  - Workflows：查看实例、状态、步骤历史，触发或重试运行。
- API 入口：
  - `/cdn-cgi/explorer/api` 提供 OpenAPI spec。
  - 适合 AI coding agent 或其他工具读取本地绑定数据。
- 官方文档按钮：
  - `Open Cloudflare Docs`
- 可选快捷打开：
  - 输入本地地址，默认 `http://localhost:8787`。
  - 点击后打开 `http://localhost:8787/cdn-cgi/explorer`。

不建议加入：

- 自动扫描本地项目。
- 自动启动 `wrangler dev`。
- 自己渲染本地 D1/KV/R2 数据。
- 自己实现本地请求日志、Profiler、Snapshots、Tunnel。

## 阶段路线

### P0：确认产品边界

目标：把 CFDesk 从“可能做本地 Workers 控制台”的方向拉回远程资源管理。

需求：

- 文档中明确：CFDesk 主线是远程 Cloudflare 资源管理。
- 删除或推迟自研本地 Project Mode、Profiler、Snapshots、Tunnel 的规划。
- 保留 FlareDesk 作为产品形态参考，但不照搬功能。
- 把 Local Explorer 定义为官方本地开发入口。

验收：

- 需求文档不再要求实现自有本地绑定管理器。
- 本地开发相关需求都指向 Local Explorer 页面和官方文档。

### P1：实现 Local Explorer 侧边栏页面

目标：让用户在 CFDesk 中知道 Local Explorer 是什么、怎么打开、什么时候该用它。

需求：

- 在侧边栏加入 `Local Explorer`。
- 页面展示 Local Explorer 的用途、前置条件、使用步骤和官方文档链接。
- 支持复制命令：
  - `npx wrangler dev`
  - `http://localhost:8787/cdn-cgi/explorer`
  - `curl http://localhost:8787/cdn-cgi/explorer/api`
- 支持打开官方文档。
- 可选支持输入本地端口并打开对应 Explorer URL。

验收：

- 用户不需要离开应用就能知道官方 Local Explorer 的使用方式。
- 页面不会暗示 CFDesk 自己管理本地绑定数据。
- 官方文档入口明显可见。

### P2：继续强化远程 R2 素材管理

目标：形成和 FlareDesk 不同的核心优势。

需求：

- 保持 R2 作为第一优先级。
- 完善 List/Grid 视图。
- 完善公开和私有图片预览。
- 完善上传配置档。
- 完善批量上传、下载、复制、删除。
- 完善传输队列：
  - 真实进度
  - 重试
  - 取消
  - 并发控制
- 支持自定义复制模板。
- 大文件上传接入 multipart/S3 兼容路径。

验收：

- 用户可以把 CFDesk 当作 R2 图床、博客素材库和静态资源管理器使用。
- 私有 Bucket 也能预览对象，但不会伪造公开 URL。

### P3：完善远程 D1 实用操作

目标：让 D1 能承担小型数据库的日常检查、导出和轻量维护。

需求：

- 表浏览。
- SQL 查询编辑器。
- 查询结果复制。
- CSV/JSON 导出。
- SQL dump 备份。
- 危险 SQL 提示。
- 小表行编辑。
- 查询历史。
- 常用查询模板。

验收：

- 用户可以检查、导出和轻量编辑远程 D1。
- 对 `DROP`、`DELETE`、`UPDATE`、`ALTER` 等语句有明确风险提示。

### P4：补齐远程 KV 管理

目标：让常见 KV 调试不需要打开 Cloudflare Dashboard。

需求：

- 列出 namespaces。
- 按 prefix 搜索 key。
- 查看 value 和 metadata。
- 新增、编辑、删除 key。
- JSON 格式化和校验。
- TTL 展示和编辑。
- 复制 key/value。
- 删除确认。

验收：

- 用户可以完成常见 KV 检查和修复。
- JSON 错误能在保存前提示。

### P5：远程资源安全和权限体验

目标：降低 token、权限和破坏性操作带来的风险。

需求：

- Token Check 页面继续保留。
- 通过真实 Cloudflare API 检查 Account、D1、R2、KV 读权限。
- 写权限只说明缺失项，不做破坏性写入测试。
- 所有远程删除、覆盖、批量操作都需要确认。
- 错误信息用产品语言解释，不直接暴露难读的原始失败。

验收：

- 用户能理解 token 缺了什么权限。
- 应用不会为了测试权限创建或修改真实资源。

## FlareDesk 可借鉴但不实现的能力

这些能力在 FlareDesk 中很有价值，但在 CFDesk 中不作为近期目标：

- 项目选择器。
- 自动解析本地 `wrangler.toml`。
- 启停 `wrangler dev`。
- 本地 D1/KV/R2/DO/Workflow 管理。
- 本地 request logs。
- 本地 console logs。
- Binding profiler。
- 本地 snapshots。
- 本地 Tunnel 管理。

原因：

- Cloudflare 官方 Local Explorer 已经覆盖本地绑定数据管理。
- CFDesk 的远程资源管理方向更明确。
- 同时做远程 Dashboard 替代和本地开发控制台，会拉散产品重心。
- 本地开发工具依赖 Wrangler 版本和本地项目结构，维护成本高。

## 非目标

- 不复刻 FlareDesk。
- 不使用 FlareDesk 的品牌、文案、定价或 UI 结构。
- 不把 CFDesk 表述成 Cloudflare 官方产品。
- 不实现 Local Explorer 的替代品。
- 不自动启动本地 dev server。
- 不自动扫描用户本地项目。
- 不反向读取 `.wrangler/state`。
- 不自动开启 R2 public access。
- 不把 Cloudflare API Token 存入 localStorage。

## 首批实现建议

### Milestone 1：重整侧边栏

- 保留远程资源入口。
- 新增 Local Explorer 入口。
- 移除或隐藏本地 Project Mode 相关规划入口。

### Milestone 2：Local Explorer 指引页

- 加入说明、命令、官方文档链接。
- 支持复制命令。
- 支持打开本地 Explorer URL。

### Milestone 3：远程资源主线

- R2 素材管理继续作为主功能。
- D1 和 KV 补齐日常操作。
- Token Check 和 Settings 保持稳定。

### Milestone 4：品牌和命名

- 确认新名字是否使用 `CFDesk`。
- README、应用标题、release 名称和更新地址统一。
- 增加独立项目声明：`Independent desktop app for Cloudflare users. Not affiliated with Cloudflare.`

