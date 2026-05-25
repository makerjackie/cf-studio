# CF Studio 远程资源管理与 Local Explorer 指引需求文档

## 背景

CF Studio 当前已经具备 D1、R2、权限检查、Token 接入、中文界面和部分 R2 素材管理能力。下一阶段不做产品更名，继续沿用 CF Studio，先把产品计划和开发优先级梳理清楚。

FlareDesk 是一个优秀的本地开发控制台，围绕 `wrangler dev` 管理本地 Workers 项目里的绑定、日志、快照和调试能力。但 CF Studio 不应该复刻这条路线。Cloudflare 官方已经提供 Local Explorer，本地绑定数据的浏览和编辑应该优先交给官方工具。

CF Studio 的主线应该是远程 Cloudflare 资源管理：

- 远程 R2 素材和对象管理。
- 远程 D1 查询、导出和轻量维护。
- 远程 KV 调试和编辑。
- 远程 Workers 运维、日志、版本、域名、路由和配置检查。
- Local Explorer 作为官方本地开发入口展示在侧边栏中。

## 参考资料

- Cloudflare Workers API：https://developers.cloudflare.com/api/resources/workers/
- Workers Versions and Deployments：https://developers.cloudflare.com/workers/configuration/versions-and-deployments/
- Workers Metrics and Analytics：https://developers.cloudflare.com/workers/observability/metrics-and-analytics/
- Workers Logs：https://developers.cloudflare.com/workers/observability/logs/workers-logs/
- Workers Custom Domains：https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- Cloudflare Local Explorer 文档：https://developers.cloudflare.com/workers/development-testing/local-explorer/
- Cloudflare Local Explorer 发布说明：https://blog.cloudflare.com/cf-cli-local-explorer/
- FlareDesk 首页：https://flaredesk.dev/
- FlareDesk 文档：https://flaredesk.dev/docs
- 当前 fork 需求：`docs/makerjackie-fork-requirements.md`
- R2 素材管理需求：`docs/r2-asset-manager-requirements.md`
- R2 上传工作流需求：`docs/r2-upload-workflow-requirements.md`

## 产品定位

CF Studio 是一个面向 Cloudflare 日常工作的桌面工具，核心价值是让用户不用频繁打开 Cloudflare Dashboard，也能完成高频资源查看、上传、调试、导出、日志检查和安全操作。

它不是：

- Cloudflare Dashboard 的完整替代品。
- FlareDesk 的复刻版本。
- Wrangler Local Explorer 的替代品。
- 一个以本地 Workers 项目为中心的开发控制台。
- 一个内置代码编辑、构建和完整发布流水线的 IDE。

它应该是：

- 远程 R2 素材管理器。
- 远程 D1 实用操作台。
- 远程 KV 调试工具。
- 远程 Workers 运维面板。
- Cloudflare API Token 权限检查器。
- Local Explorer 的清晰入口和使用指南。

## 核心原则

- 本阶段继续使用 CF Studio，不做更名。
- 远程资源管理是主线。
- 本地开发能力优先链接官方 Local Explorer。
- 不维护自己的本地绑定浏览器。
- 不启动、不管理、不包装 `wrangler dev`。
- 不读取或反向解析 `.wrangler/state`。
- 涉及真实远程资源写入、删除、覆盖、路由、域名、Secret 和部署切换时必须确认。
- Cloudflare API Token 不进入前端运行时，不写入 localStorage。
- 用户界面只写给正常使用者，不放实现备注或内部说明。
- 能通过 Cloudflare 官方 API 稳定完成的功能优先做；依赖私有实现、版本脆弱或需要重型平台能力的功能推迟。

## 推荐信息架构

### 侧边栏

建议侧边栏按使用频率和风险排序：

- Overview
- R2
- D1
- KV
- Workers
- Queues
- Local Explorer
- Token Check
- Settings

后续可加入：

- Durable Objects
- Workflows
- Hyperdrive
- Audit

这些都应该是远程账号资源视角，不是本地项目视角。

### Overview

Overview 是远程资源工作台，不是营销页。

建议展示：

- 当前 Cloudflare 账号。
- Token 状态和权限缺口。
- 最近访问的 R2 Bucket、D1 Database、KV Namespace、Worker。
- 资源健康摘要：
  - Workers 错误率或最近错误。
  - R2 最近上传任务状态。
  - D1 最近查询或导出状态。
  - KV 最近编辑状态。
- 高风险变更入口：
  - 最近 Workers 部署。
  - 最近 route/domain 变更。
  - 最近 secret 更新。

## 阶段路线

### P0：确认产品边界和侧边栏

目标：把 CF Studio 的主线定为远程资源管理，并保留 Local Explorer 官方入口。

需求：

- 文档和 UI 继续使用 CF Studio。
- 侧边栏加入 Workers。
- 侧边栏加入 Local Explorer。
- 不新增本地 Project Mode。
- 不实现自研本地 D1/KV/R2/Durable Objects/Workflows 管理器。
- 移除或推迟自研本地 Profiler、Snapshots、Tunnel 规划。

验收：

- 需求文档统一使用 CF Studio 作为产品名。
- 本地开发相关需求都指向 Local Explorer 页面和官方文档。
- Workers 被列为远程资源管理主线。

### P1：实现 Local Explorer 指引页

目标：让用户在 CF Studio 中知道 Local Explorer 是什么、怎么打开、什么时候该用它。

需求：

- 在侧边栏加入 `Local Explorer`。
- 页面展示 Local Explorer 的用途、前置条件、使用步骤和官方文档链接。
- 支持复制命令：
  - `npx wrangler dev`
  - `http://localhost:8787/cdn-cgi/explorer`
  - `curl http://localhost:8787/cdn-cgi/explorer/api`
- 支持打开官方文档。
- 可选支持输入本地端口并打开对应 Explorer URL。

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

验收：

- 用户不需要离开应用就能知道官方 Local Explorer 的使用方式。
- 页面不会暗示 CF Studio 自己管理本地绑定数据。
- 官方文档入口明显可见。

### P2：继续强化远程 R2 素材管理

目标：让 R2 成为 CF Studio 最明显的高频价值点。

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
- 增加 public URL 可用性检查：
  - custom domain 优先。
  - `r2.dev` 次之。
  - 没有公开访问时不生成伪 URL。

验收：

- 用户可以把 CF Studio 当作 R2 图床、博客素材库和静态资源管理器使用。
- 私有 Bucket 也能预览对象，但不会伪造公开 URL。

### P3：新增远程 Workers 总览

目标：让 Workers 成为 CF Studio 的第二个高频主模块，先从低风险只读运维能力开始。

需求：

- 在侧边栏加入 `Workers`。
- 列出当前账号下的 Workers。
- Worker 列表展示：
  - 名称。
  - 最近更新时间或最近部署时间。
  - workers.dev 状态。
  - custom domains / routes 数量。
  - 绑定资源摘要。
  - Observability 状态。
  - 最近错误或健康状态。
- 支持搜索和筛选：
  - 名称。
  - 有 custom domain。
  - 有 routes。
  - 有 D1/R2/KV/Queue 绑定。
  - 最近有错误。
- Worker 卡片或列表项提供快捷操作：
  - 打开详情。
  - 复制线上 URL。
  - 打开 Cloudflare Dashboard。
  - 打开官方文档。

验收：

- 用户可以快速找到某个 Worker。
- 用户能看到 Worker 绑定了哪些远程资源。
- 该阶段不修改线上配置，只读风险可控。

### P4：远程 Worker 详情页

目标：把每个 Worker 做成清晰的远程运维页面。

建议页面分区：

- Overview
- Metrics
- Logs
- Deployments
- Bindings
- Secrets
- Domains & Routes
- Cron Triggers
- Settings

#### Overview

需求：

- 展示 Worker 名称、状态、最近部署、当前线上 URL。
- 展示 custom domains、routes、workers.dev URL。
- 展示绑定摘要：
  - D1
  - R2
  - KV
  - Queues
  - Durable Objects
  - Workflows
  - Hyperdrive
  - Workers AI
- 展示最近风险：
  - 最近部署。
  - 最近错误。
  - 最近 domain/route 变化。
  - 缺失 observability 或日志配置。

#### Metrics

需求：

- 展示常用指标：
  - 请求数。
  - 错误数。
  - 错误率。
  - CPU time。
  - Wall time。
  - invocation status。
  - subrequests。
- 支持时间范围：
  - 15 分钟。
  - 1 小时。
  - 24 小时。
  - 7 天。
- 支持打开 Cloudflare Dashboard 的对应页面。

#### Logs

需求：

- 提供 Workers Logs 或 Tail 入口。
- 支持按 level、status、path、method、时间过滤。
- 支持查看单条日志详情。
- 支持复制 `wrangler tail <worker-name>` 命令。
- 日志中可能包含敏感信息，默认不持久化到本地数据库。

#### Deployments

需求：

- 展示 Worker versions 和 deployments。
- 展示每个 deployment 的流量分配、创建时间、来源和状态。
- 支持查看 deployment 详情。
- 后续支持 rollback。
- 后续支持 gradual deployment 管理。

风险提示：

- Rollback 只回滚 Worker 代码和配置版本，不回滚 D1、KV、R2、Queues 等数据资源。
- 切换 deployment 会影响线上流量，必须强确认。

#### Bindings

需求：

- 展示绑定资源列表。
- 支持点击跳转到对应资源页：
  - D1 database -> D1 页面。
  - R2 bucket -> R2 页面。
  - KV namespace -> KV 页面。
  - Queue -> Queues 页面。
- 标记找不到或权限不足的绑定资源。
- 不在第一阶段提供绑定编辑，避免误改线上配置。

#### Secrets

需求：

- 展示 secret 名称列表，不展示值。
- 支持新增或更新 secret。
- 支持删除 secret。
- 删除和覆盖必须确认。
- secret 只通过后端命令/API 处理，不进入前端持久化状态。

#### Domains & Routes

需求：

- 展示 custom domains。
- 展示 routes。
- 展示 workers.dev URL 状态。
- 支持复制可访问 URL。
- 支持打开域名的 Cloudflare Dashboard。
- 后续支持绑定/解绑 custom domain 或 route。

风险提示：

- domain/route 变更会直接影响线上流量。
- 删除 route 可能让请求不再进入 Worker。

#### Cron Triggers

需求：

- 展示已配置 cron triggers。
- 展示下一次运行时间或配置表达式。
- 后续支持新增、编辑、删除。
- 保存前解释影响范围。

验收：

- 用户能在一个页面中看清 Worker 的线上状态、绑定关系、日志、版本、域名和风险项。
- 第一阶段以只读和安全操作为主。

### P5：远程 Workers 安全写操作

目标：在只读详情稳定后，加入高频但风险可控的写操作。

优先级：

- Secret 新增、更新、删除。
- Observability 开关或配置更新。
- Cron trigger 新增、编辑、删除。
- workers.dev route 开关。
- custom domain / route 绑定和解绑。

交互要求：

- 所有操作都展示影响对象。
- 删除、覆盖、路由和域名变更必须二次确认。
- 成功后刷新 Worker 详情页。
- 失败时用产品语言解释权限、配置或 API 错误。

验收：

- 常见线上 Worker 维护不需要打开 Cloudflare Dashboard。
- 高风险配置不会被误触。

### P6：完善远程 D1 实用操作

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

### P7：补齐远程 KV 管理

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

### P8：增加 Queues 远程管理

目标：覆盖 Workers 生态中高频的异步任务调试场景。

需求：

- 列出 Queues。
- 查看 queue 详情。
- 查看 producers 和 consumers 关系。
- 从 Worker 详情页跳转到相关 Queue。
- 支持发送测试消息：
  - text
  - JSON
  - batch
- 展示发送结果和错误。

非目标：

- 不做完整消息浏览器，除非 Cloudflare 官方 API 明确支持。
- 不伪造消费端状态。

验收：

- 用户可以快速测试 Queue 是否可写。
- 用户能看清 Worker 和 Queue 的关系。

### P9：远程资源安全和权限体验

目标：降低 token、权限和破坏性操作带来的风险。

需求：

- Token Check 页面继续保留。
- 通过真实 Cloudflare API 检查 Account、D1、R2、KV、Workers、Queues 读权限。
- 写权限只说明缺失项，不做破坏性写入测试。
- 所有远程删除、覆盖、批量操作都需要确认。
- 错误信息用产品语言解释，不直接暴露难读的原始失败。
- 权限缺失时给出最小所需权限建议。

验收：

- 用户能理解 token 缺了什么权限。
- 应用不会为了测试权限创建或修改真实资源。

## 高频功能池

这些能力应该作为后续开发计划持续评估。

### 应优先考虑

- Workers 远程总览。
- Workers 详情页。
- Workers logs / tail。
- Workers metrics。
- Workers versions / deployments / rollback。
- Workers secrets。
- Workers domains / routes。
- Workers bindings 关系图。
- Queues 远程管理。
- R2 大文件上传和传输队列。
- D1 SQL dump 和查询历史。
- KV JSON 编辑和 TTL。

### 可以延后

- Durable Objects 远程状态管理。
- Workflows 远程实例管理。
- Hyperdrive 配置检查。
- Workers AI 调用统计。
- Pages 项目管理。
- 完整 Audit 报告系统。

### 暂不建议

- App 内代码编辑器。
- App 内完整源码部署流程。
- 本地项目扫描器。
- 自研本地 request logs。
- 自研本地 binding profiler。
- 自研 snapshots。
- 自研 tunnel 管理。
- 多云对象存储客户端。

## FlareDesk 可借鉴但不实现的能力

这些能力在 FlareDesk 中很有价值，但在 CF Studio 中不作为近期目标：

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
- CF Studio 的远程资源管理方向更明确。
- 同时做远程 Dashboard 替代和本地开发控制台，会拉散产品重心。
- 本地开发工具依赖 Wrangler 版本和本地项目结构，维护成本高。

## 非目标

- 不复刻 FlareDesk。
- 不使用 FlareDesk 的品牌、文案、定价或 UI 结构。
- 不把 CF Studio 表述成 Cloudflare 官方产品。
- 不实现 Local Explorer 的替代品。
- 不自动启动本地 dev server。
- 不自动扫描用户本地项目。
- 不反向读取 `.wrangler/state`。
- 不自动开启 R2 public access。
- 不把 Cloudflare API Token 存入 localStorage。
- 不在本阶段更名。

## 首批实现建议

### Milestone 1：重整侧边栏和 Overview

- 保留远程资源入口。
- 新增 Workers 入口。
- 新增 Local Explorer 入口。
- Overview 展示账号、权限、最近资源和风险变更。

### Milestone 2：Local Explorer 指引页

- 加入说明、命令、官方文档链接。
- 支持复制命令。
- 支持打开本地 Explorer URL。

### Milestone 3：Workers 只读总览

- 列出 Workers。
- 展示绑定摘要、URL、routes/domains 和健康状态。
- 支持搜索、筛选和跳转详情。

### Milestone 4：Worker 详情页

- 加入 Overview、Metrics、Logs、Deployments、Bindings、Secrets、Domains & Routes、Cron Triggers。
- 第一版以只读为主。
- Secret 管理可以作为首个安全写操作。

### Milestone 5：远程资源主线补齐

- R2 素材管理继续作为主功能。
- D1 补齐导出、备份、查询历史。
- KV 补齐编辑、TTL、JSON 校验。
- Queues 加入测试消息能力。
