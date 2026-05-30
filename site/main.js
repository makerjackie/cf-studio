const translations = {
  zh: {
    navFeatures: "功能",
    navUpdates: "更新",
    navThanks: "致谢",
    heroEyebrow: "远程 Cloudflare 资源工作台",
    heroLead: "面向 Cloudflare 日常运维的桌面工作台。管理 R2、D1、Workers、Queues、KV 和 Token 权限时，把高频操作放在一个低干扰界面里。",
    repoLink: "查看仓库",
    updatesLink: "查看更新",
    positioningKicker: "产品定位",
    positioningTitle: "为反复出现的 Cloudflare 运维任务而做。",
    positioningBodyA: "CFDesk 专注远程账号资源：R2 素材、D1 数据、Workers 运维、Queues、KV 和账号权限检查。",
    positioningBodyB: "需要本地 <code>wrangler dev</code> 绑定浏览时，CFDesk 会把用户引导到 Cloudflare 官方 Local Explorer。",
    featuresKicker: "功能范围",
    featuresTitle: "覆盖存储、数据、计算和安全检查的高频入口。",
    featureR2Title: "R2 素材工作流",
    featureR2Body: "浏览存储桶，上传和下载文件，预览图片，复制公开 URL，检查公开域名，并在危险对象操作前确认。",
    featureD1Title: "D1 数据库工作",
    featureD1Body: "查看数据库和表，运行 SQL，查看结构图，管理索引，并导出常用格式。",
    featureWorkersTitle: "Workers 运维",
    featureWorkersBody: "打开 Dashboard，检查设置和部署，查看近期健康信号，调整观测设置，复制常用 Wrangler 命令。",
    featureSafetyTitle: "权限与安全操作",
    featureSafetyBody: "检查 Token 权限，对删除、覆盖、Secret、路由、域名、计划任务等远程写操作加入确认。",
    captionD1: "D1 数据库浏览",
    captionAudit: "域名审计总览",
    updatesKicker: "4 月 18 日之后",
    updatesTitle: "一个有独立方向的远程运维 fork。",
    updateTokenTitle: "Token 引导",
    updateTokenBody: "通过 macOS Keychain 保存 API token，检查端点权限，并在 Wrangler 不可用时提供更清晰的回退路径。",
    updateR2Title: "R2 升级",
    updateR2Body: "加入缓存列表、图片预览、公开 URL 处理、传输设置、分片上传和更安全的变更确认。",
    updateWorkersTitle: "Workers 和 Queues",
    updateWorkersBody: "加入 Workers 快捷操作、近期健康信号、指标、观测控制、设置检查，以及 Queue backlog 指标。",
    updateI18nTitle: "中英文界面",
    updateI18nBody: "主要页面、设置页和资源操作文案进入中英文结构，方便后续持续维护。",
    thanksKicker: "致谢",
    thanksTitle: "感谢 CF Studio。",
    thanksBodyA: "CFDesk 基于 CF Studio 的版本继续改进。我们感谢原项目提供的桌面基础。",
    thanksBodyB: "CFDesk 在名称、站点、图标、README 和功能主线中与原项目区分开，并继续向远程 Cloudflare 资源管理方向推进。",
  },
  en: {
    navFeatures: "Features",
    navUpdates: "Updates",
    navThanks: "Thanks",
    heroEyebrow: "Remote Cloudflare operations",
    heroLead: "A desktop workspace for daily Cloudflare operations. CFDesk keeps frequent R2, D1, Workers, Queues, KV, and token-permission work in a quiet interface.",
    repoLink: "View repository",
    updatesLink: "See updates",
    positioningKicker: "Positioning",
    positioningTitle: "Built for repeat Cloudflare operations.",
    positioningBodyA: "CFDesk focuses on remote account resources: R2 assets, D1 data, Workers operations, Queues, KV, and account permission checks.",
    positioningBodyB: "For local <code>wrangler dev</code> binding inspection, CFDesk points users to Cloudflare's official Local Explorer.",
    featuresKicker: "Feature set",
    featuresTitle: "Fast paths for storage, data, compute, and safety checks.",
    featureR2Title: "R2 asset workflow",
    featureR2Body: "Browse buckets, upload and download files, preview images, copy public URLs, check public domains, and confirm dangerous object actions.",
    featureD1Title: "D1 database work",
    featureD1Body: "Inspect databases and tables, run SQL, view schema diagrams, manage indexes, and export useful formats.",
    featureWorkersTitle: "Workers operations",
    featureWorkersBody: "Open dashboard links, inspect settings and deployments, check recent health signals, adjust observability, and copy practical Wrangler commands.",
    featureSafetyTitle: "Permissions and safe writes",
    featureSafetyBody: "Check token permissions and confirm remote writes such as deletes, overwrites, secrets, routes, domains, and schedules.",
    captionD1: "D1 database browsing",
    captionAudit: "Domain audit overview",
    updatesKicker: "Since Apr 18",
    updatesTitle: "A remote-operations fork with its own direction.",
    updateTokenTitle: "Token onboarding",
    updateTokenBody: "API token storage through macOS Keychain, endpoint permission checks, and clearer fallback behavior when Wrangler is unavailable.",
    updateR2Title: "R2 upgrades",
    updateR2Body: "Cached listings, image previews, public URL handling, transfer settings, multipart uploads, and safer mutation confirmations.",
    updateWorkersTitle: "Workers and Queues",
    updateWorkersBody: "Workers quick actions, recent health signals, metrics, observability controls, settings inspection, and Queue backlog metrics.",
    updateI18nTitle: "Chinese and English UI",
    updateI18nBody: "Main pages, settings, and resource-operation copy now live in a maintainable bilingual structure.",
    thanksKicker: "Acknowledgement",
    thanksTitle: "Thanks to CF Studio.",
    thanksBodyA: "CFDesk continues from a version based on CF Studio. We appreciate the original project's desktop foundation.",
    thanksBodyB: "CFDesk now has separate naming, site, icon, README, and product direction, with a roadmap focused on remote Cloudflare resource management.",
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
