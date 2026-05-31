# CFDesk

Simplified Chinese README: [README.zh-CN.md](README.zh-CN.md).

CFDesk is a native desktop workspace for day-to-day Cloudflare operations. It focuses on remote resources: R2 assets, D1 databases, Workers, Queues, KV, token permissions, and low-risk operational checks.

CFDesk is based on the MakerJackie fork of [CF Studio](https://github.com/mubashardev/cf-studio). We appreciate the original CF Studio work; this project keeps the useful desktop foundation and continues in a more remote-operations-focused direction.

Website: [cfdesk.01mvp.com](https://cfdesk.01mvp.com)

## What Changed Since April 18

After the April 18 baseline, this fork moved beyond the original CF Studio scope in several areas:

- Added Cloudflare API token onboarding, macOS Keychain storage, and token permission checks for D1, R2, KV, Workers, Queues, and analytics access.
- Expanded English and Simplified Chinese localization across the main app surfaces.
- Improved R2 into an asset workflow: cached listings, upload/download, image preview, public URL copy, public domain checks, transfer settings, multipart upload, and confirmation before destructive object actions.
- Added a remote resource direction for KV, Workers, Queues, and account-level overviews instead of focusing only on D1/R2.
- Added Workers quick actions, recent health signals, metrics, observability controls, settings inspection, and safer copy/open flows.
- Added explicit confirmation around remote writes such as deletes, overwrites, Worker settings, secrets, routes, domains, and schedules.
- Improved macOS app startup behavior for nvm, Wrangler, and Cloudflare token environment detection.
- Updated release metadata, update checks, artifact naming, and public documentation for the MakerJackie fork.

## Core Capabilities

- **CFDesk Home:** a local command center for account status, resource counts, readiness checks, cache freshness, Workers health, Wrangler runbooks, and quick docs.
- **R2 asset management:** browse buckets, upload/download files, preview images, copy public URLs, and inspect public domain status.
- **D1 database work:** browse databases, inspect tables, run SQL, view schemas, manage indexes, and export useful data formats.
- **Workers operations:** list Workers, inspect deployments/settings, copy routes, open dashboard links, check recent health, and manage observability settings.
- **KV and Queues visibility:** lightweight remote resource inspection and operational entry points.
- **Token checks:** verify whether the current token can access the Cloudflare endpoints CFDesk needs.
- **Global commands:** `Cmd/Ctrl+K` opens navigation, docs, account actions, copyable Wrangler commands, and token/env snippets.
- **Privacy controls:** blur sensitive account, database, bucket, and object names during demos or screen shares.
- **Local Explorer handoff:** link to Cloudflare's official Local Explorer for local `wrangler dev` bindings while CFDesk stays focused on remote account resources.

## v1.3.0 CFDesk Home Release

The v1.3.0 release adds CFDesk Home, the command center, keyboard shortcuts, cache freshness, workspace readiness checks, Workers health summaries, Wrangler runbooks, and code splitting for major app views. See [docs/cfdesk-release-1.3.0.md](docs/cfdesk-release-1.3.0.md) for the full improvement list.

## Install / Update

This fork publishes builds through [GitHub Releases](https://github.com/makerjackie/cf-desk/releases). The release workflow builds the Tauri app from `main` when a release commit is pushed.

### macOS Gatekeeper

CFDesk is currently distributed without Apple signing or notarization. If macOS blocks the app after installation, move `CFDesk.app` to `/Applications`, then run:

```bash
xattr -dr com.apple.quarantine /Applications/CFDesk.app
```

Then open the app again from Finder or Spotlight.

## Local Development

Prerequisites:

- [Bun](https://bun.sh/)
- [Rust](https://www.rust-lang.org/tools/install)
- Cloudflare Wrangler CLI with either `wrangler login` or a scoped API token

```bash
git clone https://github.com/makerjackie/cf-desk.git
cd cf-desk
bun install
bun tauri dev
```

For API token based development:

```bash
export CLOUDFLARE_API_TOKEN="your-token"
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
bun tauri dev
```

Recommended token permissions:

```txt
Account:Read
D1:Read / D1:Edit
R2 Storage:Read / R2 Storage:Edit
Workers KV Storage:Read / Workers KV Storage:Edit
Workers Scripts:Read / Workers Scripts:Edit
Queues:Read / Queues:Edit
Account Analytics:Read
```

## Build

```bash
bun run build
bun run tauri build
```

The macOS bundle is generated under:

```bash
src-tauri/target/release/bundle/macos/CFDesk.app
```

## Project Site

The small bilingual site lives in [site](site). Pushes to `main` deploy it as a Cloudflare Worker through [Deploy CFDesk Worker](.github/workflows/worker.yml), targeting `cfdesk.01mvp.com`.

## Tech Stack

- **Frontend:** React, Vite, TypeScript
- **Backend:** Rust, Tauri v2
- **UI:** Tailwind CSS v4 and shadcn/ui
- **Package manager:** Bun
- **Local state:** SQLite

## License

[MIT](LICENSE)
