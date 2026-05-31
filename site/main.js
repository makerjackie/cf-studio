const translations = {
  zh: {
    navFeatures: "功能",
    navUpdates: "更新",
    navThanks: "致谢",
    navDownload: "下载",
    heroEyebrow: "Cloudflare 远程运维桌面端",
    heroLead: "CFDesk 把 R2 文件、D1 数据、Workers 与 Queues 运维、KV 检查和 Token 权限放到一个本机界面，适合每天反复查看、复制、确认和排查的 Cloudflare 账号工作。",
    releaseLink: "下载最新版",
    githubLink: "查看 GitHub",
    updatesLink: "查看更新",
    positioningKicker: "产品定位",
    positioningTitle: "把 Cloudflare 账号里的日常动作收进一个可确认的工作台。",
    positioningBodyA: "远程优先：R2、D1、Workers、Queues、KV、Token 权限与账号级状态，都围绕真实 Cloudflare 账号工作。",
    positioningBodyB: "本地绑定仍交给官方 Local Explorer；CFDesk 负责远程资源、常用命令和高风险写操作前的确认。",
    featuresKicker: "功能范围",
    featuresTitle: "为查看、复制、发布和安全确认设计的入口。",
    featureR2Title: "R2 素材工作流",
    featureR2Body: "浏览存储桶，上传和下载文件，预览图片，复制公开 URL，检查公开域名；删除或覆盖对象前先确认。",
    featureD1Title: "D1 数据库工作",
    featureD1Body: "查看数据库和表，运行 SQL，查看结构图，管理索引，并导出常用格式。",
    featureWorkersTitle: "Workers 运维",
    featureWorkersBody: "打开 Dashboard，检查设置和部署，查看近期健康信号，调整观测设置，复制常用 Wrangler 命令。",
    featureSafetyTitle: "权限与安全操作",
    featureSafetyBody: "检查 Token 权限，对删除、覆盖、Secret、路由、域名、计划任务等远程写操作加入确认。",
    captionD1: "D1 数据库浏览",
    captionAudit: "域名审计总览",
    updatesKicker: "4 月 18 日之后",
    updatesTitle: "一个独立命名、独立发布的 Cloudflare 运维 fork。",
    updateTokenTitle: "Token 引导",
    updateTokenBody: "通过 macOS Keychain 保存 API token，检查端点权限，并在 Wrangler 不可用时提供更清晰的回退路径。",
    updateR2Title: "R2 升级",
    updateR2Body: "加入缓存列表、图片预览、公开 URL 处理、传输设置、分片上传和更安全的变更确认。",
    updateWorkersTitle: "Workers 和 Queues",
    updateWorkersBody: "加入 Workers 快捷操作、近期健康信号、指标、观测控制、设置检查，以及 Queue backlog 指标。",
    updateI18nTitle: "中英文界面",
    updateI18nBody: "主要页面、设置页和资源操作文案进入中英文结构，方便后续持续维护。",
    thanksKicker: "致谢",
    thanksTitle: "向 CF Studio 致谢。",
    thanksBodyA: "CFDesk 从 CF Studio 的桌面基础继续出发；原项目让这个 fork 有了可以快速推进的起点。",
    thanksBodyB: "现在我们使用独立名称、图标、站点、Release 和产品主线，继续把重心放在远程 Cloudflare 资源管理。",
  },
  en: {
    navFeatures: "Features",
    navUpdates: "Updates",
    navThanks: "Thanks",
    navDownload: "Download",
    heroEyebrow: "Cloudflare remote-ops desktop",
    heroLead: "CFDesk brings R2 files, D1 data, Workers and Queues operations, KV checks, and token permissions into one native surface for the repeated Cloudflare account work you do every day.",
    releaseLink: "Download latest",
    githubLink: "View GitHub",
    updatesLink: "Read updates",
    positioningKicker: "Positioning",
    positioningTitle: "A focused desk for the Cloudflare work that keeps coming back.",
    positioningBodyA: "Remote-first: R2, D1, Workers, Queues, KV, token permissions, and account-level status are organized around real Cloudflare accounts.",
    positioningBodyB: "Local bindings stay with Cloudflare Local Explorer; CFDesk handles remote resources, practical commands, and confirmation before risky writes.",
    featuresKicker: "Feature set",
    featuresTitle: "Entry points for inspection, copying, release work, and safe changes.",
    featureR2Title: "R2 asset workflow",
    featureR2Body: "Browse buckets, upload and download files, preview images, copy public URLs, check public domains, and confirm before deleting or overwriting objects.",
    featureD1Title: "D1 database work",
    featureD1Body: "Inspect databases and tables, run SQL, view schema diagrams, manage indexes, and export useful formats.",
    featureWorkersTitle: "Workers operations",
    featureWorkersBody: "Open dashboard links, inspect settings and deployments, check recent health signals, adjust observability, and copy practical Wrangler commands.",
    featureSafetyTitle: "Permissions and safe writes",
    featureSafetyBody: "Check token permissions and confirm remote writes such as deletes, overwrites, secrets, routes, domains, and schedules.",
    captionD1: "D1 database browsing",
    captionAudit: "Domain audit overview",
    updatesKicker: "Since Apr 18",
    updatesTitle: "An independently named and released Cloudflare operations fork.",
    updateTokenTitle: "Token onboarding",
    updateTokenBody: "API token storage through macOS Keychain, endpoint permission checks, and clearer fallback behavior when Wrangler is unavailable.",
    updateR2Title: "R2 upgrades",
    updateR2Body: "Cached listings, image previews, public URL handling, transfer settings, multipart uploads, and safer mutation confirmations.",
    updateWorkersTitle: "Workers and Queues",
    updateWorkersBody: "Workers quick actions, recent health signals, metrics, observability controls, settings inspection, and Queue backlog metrics.",
    updateI18nTitle: "Chinese and English UI",
    updateI18nBody: "Main pages, settings, and resource-operation copy now live in a maintainable bilingual structure.",
    thanksKicker: "Acknowledgement",
    thanksTitle: "Acknowledging CF Studio.",
    thanksBodyA: "CFDesk continues from the desktop foundation created by CF Studio; that work gave this fork a strong starting point.",
    thanksBodyB: "The project now uses its own name, icon, site, Releases, and product direction, with the focus on remote Cloudflare resource management.",
  },
};

function setLanguage(nextLanguage) {
  const language = nextLanguage === "en" ? "en" : "zh";
  const copy = translations[language];

  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  localStorage.setItem("cfdesk-site-language", language);

  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.dataset.i18n;
    if (copy[key]) {
      node.innerHTML = copy[key];
    }
  });

  document.querySelectorAll("[data-lang-option]").forEach((button) => {
    const active = button.dataset.langOption === language;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

const storedLanguage = localStorage.getItem("cfdesk-site-language");
const browserLanguage = navigator.language && navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";

document.querySelectorAll("[data-lang-option]").forEach((button) => {
  button.addEventListener("click", () => setLanguage(button.dataset.langOption));
});

setLanguage(storedLanguage || browserLanguage);
