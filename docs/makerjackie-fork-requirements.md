# MakerJackie CF Studio Fork Requirements

## Goal

Create a lightweight MakerJackie fork of CF Studio for daily Cloudflare D1 and R2 work.

This fork is not trying to replace the Cloudflare dashboard. It should make repeated local desktop workflows faster, especially when the dashboard is slow or too heavy for a quick D1/R2 check.

## Scope for this first pass

1. Make the app reliably detect Node.js, npm, npx, and Wrangler when they are installed through nvm on macOS.
2. Add a basic language system with English and Simplified Chinese support.
3. Keep the public clone runnable without private Pro modules.
4. Start the local Tauri app and verify the setup screen no longer blocks when nvm provides the tools.

## Non-goals

- Do not build a full Cloudflare dashboard clone.
- Do not depend on the new `cf` CLI as the backend.
- Do not add full KV management in this pass.
- Do not implement Local Explorer integration in this pass.
- Do not rewrite the UI architecture.

## Background

Cloudflare's current tool split is:

- Wrangler remains the mature developer CLI.
- Cloudflare Dashboard remains the complete remote management surface.
- Local Explorer is useful for local Wrangler dev state, including local D1, R2, KV, Durable Objects SQLite, and Workflows.
- The new `cf` CLI is promising but still a technical preview.
- CF Studio is useful as a focused remote D1/R2 desktop client.

The fork should lean into the focused desktop-client role.

## Requirement 1, nvm-aware dependency detection

### Problem

On macOS, Tauri apps launched from Finder do not reliably inherit the interactive shell PATH.

The user's terminal can resolve:

```bash
which node
which wrangler
```

But the app may still report Node.js or Wrangler as missing.

### Expected behavior

When the app checks dependencies, it should detect binaries installed through nvm:

```txt
~/.nvm/versions/node/*/bin/node
~/.nvm/versions/node/*/bin/npm
~/.nvm/versions/node/*/bin/npx
~/.nvm/versions/node/*/bin/wrangler
```

It should also check:

```txt
~/.npm-global/bin
/opt/homebrew/bin
/usr/local/bin
```

### Implementation direction

In Rust:

- Add a reusable shell environment helper.
- Load `~/.nvm/nvm.sh` when present.
- Prepend common nvm, npm-global, and Homebrew bin folders before probing commands.
- Use the same shell bootstrap for silent Wrangler refresh commands.

### Acceptance checks

From a normal terminal:

```bash
npm run tauri dev
```

The setup wizard should mark Node.js / npm and Cloudflare Wrangler as installed when they exist under nvm.

## Requirement 2, basic i18n

### Problem

The app is English-only. For personal daily use, the main navigation and setup/settings surfaces should support Chinese.

### Expected behavior

The app should include:

- English, `en-US`
- Simplified Chinese, `zh-CN`
- A language selector in Settings
- Persisted language preference in localStorage

### Initial translation scope

Translate only high-frequency surfaces in this pass:

- Setup wizard
- Sidebar navigation
- Top title labels
- Settings page headings and tabs
- Common empty-state and coming-soon labels where easy

Do not try to translate every D1/R2 table cell and every Pro/hidden feature in the first pass.

## Requirement 3, public clone runnable

### Problem

The upstream repository imports `src/pro_modules`, but that folder is ignored and absent in a public clone.

### Expected behavior

The MakerJackie fork should run locally without private Pro modules.

### Implementation direction

Add public fallback modules under `src/pro_modules` and adjust `.gitignore` so these fallback files are tracked.

Fallback behavior:

- Remote config defaults to disabled paid features.
- R2 Buckets view remains usable for bucket listing and object listing with the public backend commands.
- Pro-only actions show disabled state or a clear message.
- Audit and query-history views render placeholder screens.

## Requirement 4, keep changes small

This first fork should stay close to upstream.

Avoid:

- Big design rewrites
- Deep R2 upload/download refactors
- New auth systems
- `cf` CLI integration
- Local Explorer integration

## Future ideas

Potential follow-up work:

- R2 image hosting workflow, upload, compress, copy Markdown URL
- D1 local/remote diff
- D1 seed and backup helpers
- KV JSON search and editor
- Cloudflare API token permission checker
- Local Explorer API companion view

## Verification

Run:

```bash
npm install
npm run build
npm run tauri dev
```

Expected result:

- TypeScript build passes.
- Rust build passes or surfaces only environment-specific toolchain issues.
- App starts locally.
- Setup wizard sees nvm-provided Node/npm/Wrangler.
- Settings exposes language selection.
