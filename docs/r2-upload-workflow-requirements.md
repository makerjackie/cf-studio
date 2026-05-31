# R2 上传工作流需求文档

## 范围

这份文档定义 CFDesk 下一阶段的 R2 上传能力：上传配置档、批量上传、上传前图片处理，以及上传后链接复制格式。

产品方向会避开复制 PicGo 或 PicList 的完整功能，聚焦 Cloudflare R2，做一个更好用的本地素材上传和管理工具。核心场景是截图、博客图片、文档图片、静态资源和私有/公开 Bucket 的日常维护。

## 调研摘要

PicGo 和 PicList 代表了用户对图床工具的常见预期：

- 支持拖拽上传、剪贴板上传、本地文件上传和 URL 上传。
- 支持配置默认图床、存储路径、自定义域名、上传后自动复制链接。
- 支持上传前重命名、时间戳命名、自定义链接格式。
- 支持多种复制格式，例如 URL、Markdown、HTML、自定义模板。
- PicList 还内置了图片压缩、缩放、旋转、格式转换、移除 EXIF、水印、任务上传、短链接、相册搜索排序、批量修改 URL 等能力。

R2 相关差异：

- R2 Bucket 默认是私有的，复制公开 URL 必须依赖自定义域名或托管的 `r2.dev` 域名。
- 对 CFDesk 来说，自定义域名应该优先于 `r2.dev`，`r2.dev` 不应被当作生产默认方案。
- R2 对象管理和大文件上传可以结合 Cloudflare REST API 与 S3 兼容 API。
- Cloudflare Images 可以做动态图片转换，但这应作为后续的服务端增强，不应混在基础上传流程里。

参考资料：

- PicList APP 概述：https://piclist.cn/app.html
- PicList 配置与上传功能：https://piclist.cn/configure
- PicGo 配置文档：https://docs.picgo.app/gui/guide/config
- Cloudflare R2 上传对象：https://developers.cloudflare.com/r2/objects/upload-objects/
- Cloudflare R2 公开 Bucket：https://developers.cloudflare.com/r2/buckets/public-buckets/
- Cloudflare R2 预签名 URL：https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- Cloudflare Images Transformations：https://developers.cloudflare.com/images/optimization/transformations/overview/

## 实现状态

本轮已经落地的能力：

- 多文件选择上传。
- 从本地文件拖拽上传。
- 从系统文件管理器拖入文件或文件夹时显示放置提示，松开后自动上传到当前选中的 R2 Bucket。
- 剪贴板图片上传，并使用原生剪贴板能力做兜底。
- 选择本地文件夹并递归上传，保留文件夹内相对路径。
- URL 分行批量上传，每行一个 `http` 或 `https` URL。
- 按账号和 Bucket 持久化上传设置：上传前缀、日期文件夹、重名策略、上传后复制格式、`Cache-Control`、图片优化。
- 上传后复制格式：URL、Markdown、HTML。
- 批量上传完成后，一次性复制全部成功文件的输出内容，每个文件一行，顺序与上传计划一致。
- 单项上传失败不会中断整个批次，失败项保留在传输列表中。
- 上传前预检表：展示来源、最终 R2 Key、大小变化、图片处理结果和重名状态。
- 本地图片优化：支持 JPEG、PNG、WebP 的缩放、质量设置和 WebP/JPEG/PNG/原格式输出；默认关闭，不修改本地原文件。
- List/Grid 视图、缩略图、私有图片预览、公开域名缓存、对象详情、复制/移动对象。
- 选中多个对象后的批量复制 URL、复制 Markdown、下载、删除。
- 基础传输列表。

仍保留为后续增强的缺口：

- 自定义复制模板还没有实现。
- 传输队列的进度较粗，没有真实字节进度、单项重试、单项取消和并发控制。
- 大文件上传还没有接入 multipart/S3 兼容路径。
- 远程 URL 上传目前直接由后端下载并写入 R2，不做图片预处理。
- 图片处理在 WebView Canvas 中完成；处理后的输出会去掉原始元数据，保留原图时不会改动 EXIF。

## 产品建议

下一阶段优先做三件事：

1. R2 上传配置档

   每个账号和 Bucket 可以保存一套上传默认设置。配置档包含目标目录、命名规则、图片处理、重名处理、复制格式和缓存头。

2. 批量上传预检和队列

   每个待上传文件先变成一个计划项。用户可以在写入 R2 之前看到最终路径、文件大小变化、重名状态和将要复制的链接。

3. 本地图片预处理

   图片压缩、缩放、转 WebP/JPEG/PNG、移除 EXIF 都在本地完成。默认不修改图片，用户需要在配置档里显式开启。

这样可以吸收 PicGo/PicList 的高频工作流，同时保持 R2-first：Bucket 浏览、私有/公开状态、对象元数据、R2 域名、批量操作和大文件处理都围绕 R2 展开。

## 上传配置档

配置档按 `accountId + bucketName` 作用域保存。

建议字段：

```ts
interface R2UploadProfile {
  id: string;
  accountId: string;
  bucketName: string;
  name: string;
  defaultPrefix: string;
  dateFolderTemplate: "" | "yyyy/MM/dd" | "yyyy/MM" | "custom";
  customDateFolderTemplate?: string;
  namingTemplate: "{filename}";
  slugifyFileName: boolean;
  conflictPolicy: "rename" | "skip" | "overwrite";
  outputFormat: R2CopyFormat;
  customOutputTemplate?: string;
  publicUrlMode: "custom-domain-first" | "r2-dev" | "none";
  urlSuffix?: string;
  cacheControl?: string;
  imagePreprocess: R2ImagePreprocessSettings;
  batch: {
    concurrency: number;
    retryCount: number;
    retryIntervalSeconds: number;
    copyAllSuccessfulOutputs: boolean;
  };
}

type R2CopyFormat = "url" | "markdown" | "html" | "ubb" | "custom";

interface R2ImagePreprocessSettings {
  enabled: boolean;
  preset: "keep-original" | "blog-web" | "custom";
  outputFormat: "same" | "webp" | "jpeg" | "png";
  quality: number;
  maxWidth?: number;
  maxHeight?: number;
  skipSmallImages: boolean;
  skipIfOutputLarger: boolean;
  stripExif: boolean;
  preserveOriginal: boolean;
  originalPrefix?: string;
}
```

存储建议：

- 轻量配置先放在 Zustand 持久化 store 中。
- 如果后续需要上传历史、任务历史、原图/处理后文件映射，再迁移到现有 Tauri SQLite 数据库。
- 配置档不保存 Cloudflare 凭证。

## 默认配置

新 Bucket 自动生成默认配置：

- 默认目录：当前浏览目录；如果从 Bucket 根部上传，则为空。
- 日期文件夹：关闭。
- 命名规则：原文件名。
- 重名处理：自动重命名。
- 复制格式：URL。
- 图片预处理：关闭。
- `Cache-Control`：空。
- 并发数：3。
- 重试次数：2。
- 批量上传完成后：一次性复制全部成功文件的输出内容，每个文件一行。

推荐提供一个可选预设：

- 名称：`博客/Web 图片`。
- 输出格式：WebP。
- 质量：82。
- 最大宽度：2400。
- 移除 EXIF：开启。
- 小图跳过缩放：开启。
- 如果处理后更大：保留原图。
- 保留原始文件副本：默认关闭。

这个预设可以一键启用，但不能默认开启。

## 复制链接格式

上传后复制应该是独立设置，不应和上传流程写死。

内置格式：

- URL：`https://assets.example.com/path/image.webp`
- Markdown：`![image.webp](https://assets.example.com/path/image.webp)`
- HTML：`<img src="https://assets.example.com/path/image.webp" alt="image.webp" />`
- UBB：`[img]https://assets.example.com/path/image.webp[/img]`
- 自定义：用户用变量拼接。

自定义模板变量：

- `{url}`：最终访问 URL。
- `{fileName}`：文件名，包含扩展名。
- `{name}`：文件名，不含扩展名。
- `{ext}`：扩展名。
- `{key}`：R2 Object Key。
- `{bucket}`：Bucket 名称。
- `{width}`：图片宽度，未知时为空。
- `{height}`：图片高度，未知时为空。

批量上传复制规则：

- 默认一次性写入剪贴板。
- 每个成功文件占一行。
- 顺序使用上传预检表中的顺序。
- 失败或跳过的文件不进入剪贴板内容。
- 如果没有公开域名，则不复制假 URL；界面应提示当前 Bucket 没有可用公开访问地址。

示例：

```md
![a.webp](https://assets.example.com/images/a.webp)
![b.webp](https://assets.example.com/images/b.webp)
![c.webp](https://assets.example.com/images/c.webp)
```

## 上传来源

P0：

- 多文件选择上传。
- 拖拽多个文件到对象浏览区。
- 拖拽文件夹并递归上传。
- 粘贴一张剪贴板图片。
- 上传到当前目录或配置档指定目录。

P1：

- 选择本地文件夹并递归上传。
- URL 批量上传：每行一个 `http` 或 `https` URL。
- 上传前手动重命名，批量上传时显示为预检表中的可编辑列。

P2：

- 任务上传：支持上传间隔、重试次数、延迟开始。

## 批量上传流程

1. 收集上传来源。
2. 按当前配置档生成计划 Key。
3. 如启用图片预处理，先在本地生成临时处理文件。
4. 获取受影响目录的已存在 Key。
5. 按重名策略处理冲突。
6. 多文件上传、文件被处理、存在重名或 URL 上传时，显示预检表。
7. 用户确认后进入上传队列。
8. 队列串行执行；单项失败后记录错误并继续后续文件。
9. 批量结束后刷新当前对象列表，并预取受影响目录。
10. 上传结束后，一次性复制全部成功文件的输出内容，每个文件一行。
11. 失败项保留在传输面板中，后续再补单项重试。

当前预检表字段：

- 来源名称。
- 最终 R2 Key。
- 原始大小。
- 输出大小。
- 图片处理说明。
- 重名状态。

验收标准：

- 拖入 20 个文件时，能看到 20 行待上传计划。
- 用户能在上传前发现错误目录、错误命名或误开的图片转换。
- 上传完成后，剪贴板里是所有成功文件的链接，每行一个。
- 单个文件失败不会让整个批次失败。

## 图片预处理

P0 支持：

- 输入：JPEG、PNG、WebP。
- 输出：保持原格式、WebP、JPEG、PNG。
- 有损格式质量设置。
- 按最大宽度/高度缩放，并保持比例。
- 小图不会被放大。
- 如果处理后文件更大，则保留原图。
- 处理后的输出不保留原始 EXIF；如果因为结果更大而保留原图，则原图元数据保持不变。
- 上传前显示原始大小、输出大小和变化比例。

P0 不做：

- AVIF、HEIC 转换。
- 水印。
- 一张图生成多个尺寸变体。
- Cloudflare Images 计费或配置管理。

实现说明：

- 当前实现使用 WebView Canvas 做本地图片处理，不引入服务端图片处理链路。
- 处理后的文件直接以字节上传到 R2，不写回用户原文件。
- 剪贴板图片会转为临时 `File`，再进入同一套上传流程。
- 永远不修改用户本地原文件。

## R2 上传后端

短期：

- 小图片和普通静态文件继续使用现有 Cloudflare REST 上传路径。
- 上传时支持 `Content-Type` 和 `Cache-Control`。

后续：

- 为大文件和可恢复上传增加 S3 兼容 multipart 上传。
- 提供真实字节进度、分片重试、单项取消。

推荐默认阈值：

- 100 MB 以下：普通上传。
- 100 MB 及以上：multipart 上传。

后续可把阈值放进高级设置。

## UI 要求

R2 主工具栏：

- `上传`：一个主按钮，打开文件选择器；文件夹通过拖拽进入同一上传流程。
- `粘贴或上传`：优先读取剪贴板图片，失败时打开文件选择。
- `从 URL 上传`：打开分行 URL 上传弹窗。
- 设置继续放在滑杆图标中，不占据主页面空间。

上传设置弹窗：

- 目标位置：上传前缀、日期文件夹。
- 命名：单文件重命名。
- 复制格式：URL、Markdown、HTML。
- 图片处理：启用开关、输出格式、质量、最大宽高、结果更大时保留原图。
- 高级：`Cache-Control`。
- 设置按账号和 Bucket 自动保存。
- 容易误解的字段需要有说明图标和短文案，尤其是上传路径前缀、日期文件夹、重名处理、复制格式和 `Cache-Control`。
- 弹窗内容在小窗口中必须可滚动，不能因为设置项变多而超出屏幕。

传输面板：

- 单项显示状态、粗略进度和错误信息。
- 已完成项保留，直到用户手动清除。

对象/相册区：

- 对当前 Bucket 的图片对象提供更强的素材库视图。
- 支持快速切换复制格式。
- 支持按文件名、URL、上传时间、扩展名搜索和排序。
- P1 支持批量 URL 改写，用于域名迁移、追加图片处理参数、HTTP 到 HTTPS 修正。

页面 UI 文案只面向正常用户，不解释 REST/S3 等实现细节。实现细节放在开发文档和诊断信息里。

## 功能清单

已实现：

- per Bucket 上传配置档。
- 默认复制格式设置。
- 批量上传后一次性复制全部成功输出，每行一个。
- Markdown、HTML、URL。
- 图片压缩、缩放、转 WebP/JPEG/PNG。
- 上传预检表。
- 文件夹递归上传。
- URL 分行批量上传。

后续高价值：

- 自定义复制模板。
- 任务上传：间隔、重试、延迟开始。
- 批量 URL 改写。
- 真实传输进度和单项重试。
- 选中对象后快速切换复制格式。

P2 可选：

- S3 multipart 大文件上传。
- 私有对象预签名 URL。
- 批量 URL 改写。

暂不做：

- 短链接集成。
- 监听剪贴板自动上传。
- 水印。
- 图片旋转、翻转、裁剪。
- Cloudflare Images/Worker 图片转换助手。
- 内容哈希去重。
- 任意 PicGo/PicList 插件兼容。

## 后续计划

### P1：补齐队列和模板

- 自定义复制模板。
- `博客/Web 图片` 一键预设。
- 并发与重试设置。
- 单项重试和取消。
- 真实字节进度。

### P2：R2 高级工作流

- S3 multipart 大文件上传。
- 私有对象预签名 URL。
- 批量 URL 改写。

## 非目标

- 不默认开启有损压缩或格式转换。
- 不自动开启 R2 公开访问。
- 不把 `r2.dev` 当作生产默认域名。
- 不在 CFDesk 内执行任意 PicGo 插件。
- 不先做通用多云上传器，R2 工作流做好之前不扩散范围。

## 验收清单

- 已完成：新 Bucket 使用默认上传设置，并可按账号和 Bucket 持久化修改。
- 已完成：用户可以设置默认上传目录和日期文件夹，并持续复用。
- 已完成：用户可以为某个 Bucket 开启图片优化，不影响其它 Bucket。
- 已完成：用户可以拖入多张图片，确认最终 Key 和输出大小后一次性上传。
- 已完成：批量上传完成后，剪贴板内容包含所有成功文件，每行一个。
- 已完成：复制格式可以在 URL、Markdown、HTML 之间切换。
- 已完成：私有 Bucket 仍可上传和预览；没有公开域名时，不生成假公开 URL。
- 已完成：用户本地原文件不会被修改。
- 待补充：自定义复制模板。
- 待补充：失败文件单独重试、真实字节进度、单项取消。
