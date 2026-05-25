# CF Studio 远程资源管理需求文档

最后更新：2026-05-26

## 文档目的

这份文档用于明确 CF Studio 接下来的产品主线、功能优先级和验收标准。本阶段不做产品更名，继续使用 CF Studio。

CF Studio 的核心方向是远程 Cloudflare 资源管理。本地开发能力不重复建设，统一通过 Cloudflare 官方 Local Explorer 做入口和指引。

## 背景判断

FlareDesk 的价值在于围绕 `wrangler dev` 提供本地开发控制台，包括项目识别、绑定侧边栏、请求调试、绑定调试、快照和 Tunnel 等能力。这条路线适合本地 Workers 开发。

CF Studio 不应该复刻 FlareDesk。Cloudflare 官方已经提供 Local Explorer，用于在本地开发时浏览和编辑本地绑定数据。CF Studio 更适合把精力放在远程账号资源上，解决用户平时反复打开 Cloudflare Dashboard 才能完成的高频工作。

因此，CF Studio 的产品骨架应该是：

- 远程 R2 素材和对象管理。
- 远程 Workers 运维和安全操作。
- 远程 D1 查询、导出和轻量维护。
- 远程 KV 调试和编辑。
- 远程 Queues 调试。
- Token 权限检查和最小权限建议。
- Local Explorer 官方入口和使用指南。

## 参考资料

- Cloudflare Local Explorer：https://developers.cloudflare.com/workers/development-testing/local-explorer/
- Workers API：https://developers.cloudflare.com/api/resources/workers/
- Workers Metrics and Analytics：https://developers.cloudflare.com/workers/observability/metrics-and-analytics/
- Workers Logs：https://developers.cloudflare.com/workers/observability/logs/workers-logs/
- Workers Versions and Deployments：https://developers.cloudflare.com/workers/configuration/versions-and-deployments/
- Workers Custom Domains：https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- Queues API：https://developers.cloudflare.com/api/resources/queues/
- R2 Upload objects：https://developers.cloudflare.com/r2/objects/upload-objects/
- R2 Public buckets：https://developers.cloudflare.com/r2/buckets/public-buckets/
- FlareDesk：https://flaredesk.dev/
- 当前 fork 需求：`docs/makerjackie-fork-requirements.md`
- R2 素材管理需求：`docs/r2-asset-manager-requirements.md`
- R2 上传工作流需求：`docs/r2-upload-workflow-requirements.md`

## 产品定位

CF Studio 是面向 Cloudflare 日常工作的桌面工具。它帮助用户在一个低干扰界面中完成远程资源查看、上传、调试、导出、日志检查和确认式安全操作。

它不是：

- Cloudflare Dashboard 的完整替代品。
- FlareDesk 的复刻版本。
- Wrangler Local Explorer 的替代品。
- 以本地 Workers 项目为中心的开发控制台。
- 内置代码编辑、构建和完整发布流水线的 IDE。

它应该是：

- 远程 R2 素材管理器。
- 远程 Workers 运维面板。
- 远程 D1 实用操作台。
- 远程 KV 调试工具。
- 远程 Queues 调试工具。
- Cloudflare API Token 权限检查器。
- Local Explorer 的清晰入口和使用指南。

## 核心原则

- 本阶段继续使用 CF Studio，不做更名。
- 远程资源管理是主线。
- 本地开发能力优先链接官方 Local Explorer。
- 不维护自己的本地绑定浏览器。
- 不启动、不管理、不包装 `wrangler dev`。
- 不读取或反向解析 `.wrangler/state`。
- 不自动扫描用户本地项目。
- 不把 Cloudflare API Token 放进前端运行时，也不写入 localStorage。
- 真实远程资源的删除、覆盖、批量操作、路由、域名、Secret、Cron、workers.dev 开关和部署切换都必须确认。
- 写权限检查只给出缺失项，不通过创建、删除或修改真实资源来探测权限。
- 用户界面只写给正常使用者，不放实现备注、内部说明或开发者自言自语。
- 能通过 Cloudflare 官方 API 稳定完成的功能优先做；依赖私有实现、版本脆弱或需要重型平台能力的功能推迟。

## 信息架构

### 侧边栏

建议侧边栏按使用频率和风险排序：

- Overview
- R2
- Workers
- D1
- KV
- Queues
- Local Explorer
- Token Check
- Settings

后续可加入：

- Durable Objects
- Workflows
- Hyperdrive
- Audit

这些入口都应该从远程账号资源视角出发，不做本地项目视角。

### Overview

Overview 是远程资源工作台，不是营销页。

建议展示：

- 当前 Cloudflare 账号。
- Token 状态和权限缺口。
- 最近访问的 R2 Bucket、Worker、D1 Database、KV Namespace、Queue。
- 资源健康摘要：
  - Workers 近期请求数、错误数和错误率。
  - R2 最近上传任务状态。
  - D1 最近查询、导出或备份状态。
  - KV 最近编辑状态。
  - Queue backlog 或测试消息结果。
- 高风险变更入口：
  - 最近 Worker deployment。
  - 最近 route/domain 变更。
  - 最近 secret 更新。
  - 最近 Cron trigger 变更。

## 优先级总览

| 优先级 | 模块 | 目标 | 风险 |
| --- | --- | --- | --- |
| P0 | 产品边界和导航 | 固定远程优先路线，加入 Workers 和 Local Explorer | 低 |
| P1 | Local Explorer 指引 | 告诉用户官方本地工具怎么用 | 低 |
| P2 | R2 | 强化素材管理、上传队列和公开 URL 判断 | 中 |
| P3 | Workers 只读总览 | 快速定位线上 Worker 和健康状态 | 低 |
| P4 | Worker 详情 | 看清指标、日志入口、部署、绑定、域名和 Cron | 中 |
| P5 | Worker 安全写操作 | Secret、Cron、route、domain、workers.dev、observability | 高 |
| P6 | D1 | 查询、导出、dump、历史、轻量编辑 | 中 |
| P7 | KV | Prefix 搜索、JSON/TTL、metadata、增删改 | 中 |
| P8 | Queues | 队列详情、metrics、测试消息、Worker 关系 | 中 |
| P9 | 权限和安全体验 | Token 检查、最小权限建议、统一确认机制 | 高 |

## P0：产品边界和导航

目标：把 CF Studio 的主线固定为远程 Cloudflare 资源管理，并保留 Local Explorer 官方入口。

需求：

- 文档和 UI 继续使用 CF Studio。
- 侧边栏加入 Workers。
- 侧边栏加入 Local Explorer。
- Overview 改成远程资源工作台。
- 不新增本地 Project Mode。
- 不实现自研本地 D1/KV/R2/Durable Objects/Workflows 管理器。
- 移除或推迟自研本地 Profiler、Snapshots、Tunnel 规划。

验收：

- 需求文档统一使用 CF Studio 作为产品名。
- 本地开发相关需求都指向 Local Explorer 页面和官方文档。
- Workers 被列为远程资源管理主线。

## P1：Local Explorer 指引页

目标：让用户在 CF Studio 中知道 Local Explorer 是什么、怎么打开、什么时候该用它。

截至 2026-05-26，Cloudflare 官方文档说明 Local Explorer 是本地开发服务器上的浏览器界面，路径为 `/cdn-cgi/explorer`，用于查看和编辑本地 bindings 数据。前置条件是 Wrangler 4.82.1 或更新版本，或 Cloudflare Vite plugin 1.32.0 或更新版本。

需求：

- 在侧边栏加入 `Local Explorer`。
- 页面展示 Local Explorer 的用途、前置条件、使用步骤和官方文档链接。
- 支持复制命令：
  - `npx wrangler dev`
  - `http://localhost:8787/cdn-cgi/explorer`
  - `curl http://localhost:8787/cdn-cgi/explorer/api`
- 支持打开官方文档。
- 支持输入本地端口并打开对应 Explorer URL。
- 明确说明 CF Studio 不管理本地 binding 数据。

页面内容建议：

- 标题：`Local Explorer`
- 简短说明：`Cloudflare 官方提供的本地绑定数据浏览器，可用于查看和编辑 wrangler dev 中的本地 D1、KV、R2、Durable Objects 和 Workflows 数据。`
- 使用步骤：
  - 在项目目录运行 `npx wrangler dev`。
  - 在终端中按 `e` 打开 Local Explorer。
  - 或访问当前本地 Worker 地址下的 `/cdn-cgi/explorer`。
- 支持能力：
  - KV：浏览 key、查看 value 和 metadata、创建、更新、删除 key-value。
  - R2：列出对象、查看 metadata、上传、删除对象。
  - D1：浏览表和行，运行 SQL，通过 SQL 修改数据。
  - Durable Objects SQLite storage：浏览表和行，运行 SQL。
  - Workflows：查看实例、状态、步骤历史，触发或重试运行。
- API 入口：
  - `/cdn-cgi/explorer/api` 提供 OpenAPI spec。
  - 适合自动化工具读取本地绑定数据。

验收：

- 用户不需要离开应用就能知道官方 Local Explorer 的使用方式。
- 页面不会暗示 CF Studio 自己管理本地绑定数据。
- 官方文档入口明显可见。

## P2：强化远程 R2 素材管理

目标：让 R2 成为 CF Studio 最明显的高频价值点，适合用作图床、博客素材库、静态资源管理器和对象检查工具。

需求：

- 保持 R2 作为第一优先级模块。
- 完善 List/Grid 视图。
- 完善公开和私有图片预览。
- 完善上传配置档。
- 支持批量上传、下载、复制、删除。
- 传输队列支持：
  - 真实进度。
  - 重试。
  - 取消。
  - 并发控制。
  - 失败原因展示。
- 支持自定义复制模板：
  - URL。
  - Markdown image。
  - HTML image。
  - 自定义前缀和路径模板。
- 大文件上传接入官方推荐路径：
  - 小中型文件可用单次 PUT。
  - 大文件走 multipart 或 S3 兼容 SDK。
  - UI 中显示是否支持断点重试和并发上传。
- 增加 public URL 可用性检查：
  - custom domain 优先。
  - `r2.dev` 次之，只标注为开发用途。
  - 没有公开访问时不生成伪 URL。
- 对公开访问相关配置只做展示和说明，启用公开访问需要强确认。

验收：

- 用户可以把 CF Studio 当作 R2 图床、博客素材库和静态资源管理器使用。
- 私有 Bucket 也能预览对象，但不会伪造公开 URL。
- 大文件上传不会因为单次读入内存导致应用卡死或崩溃。

## P3：远程 Workers 总览

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
  - Observability 未开启。
- Worker 卡片或列表项提供快捷操作：
  - 打开详情。
  - 复制可访问 URL。
  - 打开 Cloudflare Dashboard。
  - 打开官方文档。

验收：

- 用户可以快速找到某个 Worker。
- 用户能看到 Worker 绑定了哪些远程资源。
- 该阶段不修改线上配置，只读风险可控。

## P4：远程 Worker 详情页

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

### Overview

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

### Metrics

需求：

- 第一版通过 Cloudflare GraphQL Analytics API 读取 Workers metrics。
- 展示常用指标：
  - 请求数。
  - 成功数。
  - 错误数。
  - 错误率。
  - CPU time。
  - wall time。
  - invocation status。
  - subrequests。
- 支持时间范围：
  - 15 分钟。
  - 1 小时。
  - 24 小时。
  - 7 天。
- 支持打开 Cloudflare Dashboard 对应页面。
- 如果 Token 缺少 Account Analytics 权限，页面要说明权限缺口，不把它当成 Worker 本身异常。

### Logs

需求：

- 第一版提供 Workers Logs / Tail 的清晰入口，而不是假装有完整日志平台。
- 展示 Observability 状态。
- 支持复制 `wrangler tail <worker-name>` 命令。
- 支持打开 Cloudflare Dashboard 的 Observability 页面。
- 支持说明如何开启 Workers Logs。
- 后续如果接入日志查询能力，支持按 level、status、path、method、时间过滤。
- 后续支持查看单条日志详情。
- 日志中可能包含敏感信息，默认不持久化到本地数据库。

验收：

- 用户能快速进入官方日志视图或启动 tail。
- 页面不会把缺少日志权限误报成 Worker 异常。

### Deployments

需求：

- 展示 Worker versions 和 deployments。
- 展示每个 deployment 的流量分配、创建时间、来源和状态。
- 支持查看 deployment 详情。
- 后续支持 rollback。
- 后续支持 gradual deployment 管理。

风险提示：

- Rollback 只回滚 Worker 代码和配置版本，不回滚 D1、KV、R2、Queues 等数据资源。
- 切换 deployment 会影响线上流量，必须强确认。

### Bindings

需求：

- 展示绑定资源列表。
- 支持点击跳转到对应资源页：
  - D1 database -> D1 页面。
  - R2 bucket -> R2 页面。
  - KV namespace -> KV 页面。
  - Queue -> Queues 页面。
- 标记找不到或权限不足的绑定资源。
- 不在第一阶段提供绑定编辑，避免误改线上配置。

### Secrets

需求：

- 展示 secret 名称列表，不展示值。
- 支持新增或更新 secret。
- 支持删除 secret。
- 删除和覆盖必须确认。
- secret 只通过后端命令/API 处理，不进入前端持久化状态。

### Domains & Routes

需求：

- 展示 custom domains。
- 展示 routes。
- 展示 workers.dev URL 状态。
- 支持复制可访问 URL。
- 支持打开域名的 Cloudflare Dashboard。
- 安全写操作阶段支持绑定/解绑 custom domain。
- 安全写操作阶段支持添加/删除 route；删除 route 时需要 route id 和 zone id。

风险提示：

- domain/route 变更会直接影响线上流量。
- 删除 route 可能让请求不再进入 Worker。

### Cron Triggers

需求：

- 展示已配置 cron triggers。
- 展示下一次运行时间或配置表达式。
- 安全写操作阶段支持新增、编辑、删除。
- 保存前解释影响范围。

验收：

- 用户能在一个页面中看清 Worker 的线上状态、绑定关系、日志入口、版本、域名和风险项。
- 第一阶段以只读和确认式安全操作为主。

## P5：Workers 安全写操作

目标：在只读详情稳定后，加入高频但风险可控的写操作。

优先级：

1. Secret 新增、更新、删除。
2. Cron trigger 新增、编辑、删除。
3. workers.dev route 开关。
4. custom domain / route 绑定和解绑。
5. Observability 开关或配置更新。

交互要求：

- 所有操作都展示账号、Worker 名称和影响对象。
- 删除、覆盖、路由、域名、Cron 和 workers.dev 变更必须二次确认。
- route/domain 变更要展示 zone、hostname、pattern 或 route id。
- Secret 写入后不在前端状态里保留明文。
- 成功后刷新 Worker 详情页。
- 失败时用产品语言解释权限、配置或 API 错误。

验收：

- 常见线上 Worker 维护不需要打开 Cloudflare Dashboard。
- 高风险配置不会被误触。
- 错误信息能让用户判断是权限不足、资源不存在、配置冲突还是 API 限制。

## P6：完善远程 D1 实用操作

目标：让 D1 能承担小型数据库的日常检查、导出和轻量维护。

需求：

- 表浏览。
- SQL 查询编辑器。
- 查询结果复制。
- CSV/JSON 导出。
- SQL dump 备份。
- SQL dump 第一版可直接写入本地 `.sql` 文件，包含 `CREATE TABLE`、用户表数据和索引/视图/触发器语句。
- 危险 SQL 提示。
- 小表行编辑第一版只支持单一主键表，避免无法稳定定位行时误更新多行。
- 查询历史。
- 常用查询模板。

验收：

- 用户可以检查、导出和轻量编辑远程 D1。
- 对 `DROP`、`DELETE`、`UPDATE`、`ALTER` 等语句有明确风险提示。
- 导出结果可直接用于排查问题、备份或复制给协作者。

## P7：补齐远程 KV 管理

目标：让常见 KV 调试不需要打开 Cloudflare Dashboard。

需求：

- 列出 namespaces。
- 按 prefix 搜索 key。
- 查看 value 和 metadata。
- 新增、编辑、删除 key。
- JSON 格式化和校验。
- TTL 展示和编辑。
- metadata 查看，后续支持编辑。
- 复制 key/value。
- 删除确认。

验收：

- 用户可以完成常见 KV 检查和修复。
- JSON 错误能在保存前提示。
- TTL 和 metadata 不会被编辑操作意外清空。

## P8：增加 Queues 远程管理

目标：覆盖 Workers 生态中高频的异步任务调试场景。

需求：

- 列出 Queues。
- 查看 queue 详情。
- 展示 backlog、oldest message timestamp 等可用 metrics。
- 查看 producers 和 consumers 关系。
- 从 Worker 详情页跳转到相关 Queue。
- 支持发送测试消息：
  - text。
  - JSON。
  - batch。
  - 可选 delay seconds。
- 展示发送结果和错误。
- Pull / ack / retry / purge 属于高风险诊断操作，默认不放在第一版主流程。

非目标：

- 不做完整消息浏览器，除非 Cloudflare 官方 API 和交互风险都明确可控。
- 不伪造消费端状态。
- 不默认拉取生产队列消息，避免改变消息可见性或消费行为。

验收：

- 用户可以快速测试 Queue 是否可写。
- 用户能看清 Worker 和 Queue 的关系。
- 应用不会因为调试操作误消费或清空生产消息。

## P9：远程资源安全和权限体验

目标：降低 token、权限和破坏性操作带来的风险。

需求：

- Token Check 页面继续保留。
- 通过真实 Cloudflare API 检查 Account、D1、R2、KV、Workers、Queues 读权限。
- 写权限只说明缺失项，不做破坏性写入测试。
- 所有远程删除、覆盖、批量操作都需要确认。
- 错误信息用产品语言解释，不直接暴露难读的原始失败。
- 权限缺失时给出最小所需权限建议。
- 对 API rate limit、资源不存在、权限不足、配置冲突分别给出不同提示。

验收：

- 用户能理解 token 缺了什么权限。
- 应用不会为了测试权限创建或修改真实资源。
- 高风险操作都有统一确认体验。

## 其他高频功能池

这些能力应该持续评估，但不要打断当前远程资源主线。

### 应优先考虑

- Workers 远程总览。
- Workers 详情页。
- Workers logs / tail 入口。
- Workers metrics。
- Workers versions / deployments / rollback。
- Workers secrets。
- Workers domains / routes。
- Workers bindings 关系跳转。
- Queues 远程管理和测试消息。
- R2 大文件上传和传输队列。
- R2 public URL 可用性检查。
- D1 SQL dump 和查询历史。
- D1 查询结果复制和 CSV/JSON 导出。
- KV JSON 编辑、TTL、metadata。
- Token 权限检查和最小权限建议。

### 可以延后

- Durable Objects 远程状态管理。
- Workflows 远程实例管理。
- Hyperdrive 配置检查。
- Workers AI 调用统计。
- Pages 项目管理。
- 完整 Audit 报告系统。
- 资源关系图的可视化大图。

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
- 同时做远程资源管理和本地开发控制台，会拉散产品重心。
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

### Milestone 1：导航、Overview 和 Local Explorer

- 保留远程资源入口。
- 新增 Workers 入口。
- 新增 Local Explorer 入口。
- Overview 展示账号、权限、最近资源和风险变更。
- Local Explorer 页面加入说明、命令、官方文档链接和本地端口输入。

### Milestone 2：Workers 只读总览

- 列出 Workers。
- 展示绑定摘要、URL、routes/domains、observability 和健康状态。
- 支持搜索、筛选和跳转详情。
- 只读，不修改线上配置。

### Milestone 3：Worker 详情页

- 加入 Overview、Metrics、Logs、Deployments、Bindings、Secrets、Domains & Routes、Cron Triggers。
- Metrics 第一版接入 Cloudflare GraphQL Analytics。
- Logs 第一版提供 Workers Logs / Tail 入口和 `wrangler tail` 命令复制。
- Bindings 支持跳转到 D1、R2、KV、Queues 页面。

### Milestone 4：Workers 确认式安全写操作

- Secret 新增、更新、删除。
- Cron Triggers 新增、编辑、删除。
- workers.dev route 开关。
- Custom Domains 和 Routes 绑定/解绑。
- Observability 配置更新。

### Milestone 5：远程资源主线补齐

- R2 素材管理继续作为主功能。
- D1 补齐导出、SQL dump 备份、查询历史和查询结果复制。
- KV 补齐 JSON 校验、TTL、metadata 和复制能力。
- Queues 加入 metrics、Worker 关系和测试消息能力。

## 整体验收标准

- 侧边栏和文档都能清楚表达：CF Studio 走远程资源管理路线。
- Local Explorer 只作为官方本地工具入口，不变成 CF Studio 自研本地控制台。
- Workers 进入核心导航，并具备总览、详情和分阶段安全写操作规划。
- R2、D1、KV、Queues 都围绕高频远程操作补齐，不扩散成 Cloudflare Dashboard 全量替代。
- 所有真实远程写操作都有明确确认、失败解释和权限建议。
- 用户界面没有内部备注、实现思考或面向作者的说明。
