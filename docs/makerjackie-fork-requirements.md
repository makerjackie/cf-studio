# MakerJackie CF Studio Fork Requirements

## Product Positioning

This fork is a focused desktop companion for Cloudflare daily work. It is not a full Dashboard replacement.

The strongest use case is fast local management for D1, R2, and KV when the Cloudflare Dashboard is too slow for repeated operational work.

## Current Implemented Scope

### Runtime and Auth

- Detect Node.js, npm, npx, and Wrangler installed through nvm on macOS.
- Prefer `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the process environment.
- When launched from Finder, probe the user's login shell for Cloudflare environment variables.
- Read the existing Wrangler OAuth config when no API token is available.
- Allow users to paste a Cloudflare API token in Settings and store it in macOS Keychain.
- Keep token storage runtime-only. Do not hardcode tokens, account IDs, bucket names, or user paths.

### R2

- List buckets and objects.
- Upload files from file picker.
- Upload files by drag and drop.
- Upload images from clipboard.
- Download objects.
- Preview public images when a public domain is enabled.
- Copy object public URLs.
- Detect bucket public domain status by checking custom domains first, then managed `r2.dev`.
- Cache bucket object listings by bucket and prefix, then refresh stale listings in the background.
- Keep manual object-list refresh available for users who need current remote state immediately.

### Permissions

- Add a Token Check page.
- Verify read access for Account, D1, R2, and KV through real Cloudflare API calls.
- Show required Edit permissions for write workflows without creating or modifying resources.

### i18n

- Keep English as the default language.
- Add Simplified Chinese as an optional language.
- Store locale text in separate files:
  - `src/lib/i18n/en-US.ts`
  - `src/lib/i18n/zh-CN.ts`

### Release

- Build local macOS app and DMG through `bun run tauri build`.
- Use the MakerJackie GitHub release endpoint for update checks.
- GitHub Actions can build macOS, Windows, and Linux release artifacts from `main`.
- Do not require Apple signing/notarization for now; document the macOS quarantine removal command for personal builds.

## R2 Custom Domain Behavior

R2 buckets are private by default. CF Studio can only copy a working public URL when one of these is enabled:

- A custom domain connected to the bucket.
- The Cloudflare-managed `r2.dev` public development URL.

If no public domain is enabled, upload still succeeds, but the app should not pretend there is a public URL.

## Recommended Token Permissions

For the current feature set:

- `Account:Read`
- `D1:Read`
- `D1:Edit`
- `R2 Storage:Read`
- `R2 Storage:Edit`
- `Workers KV Storage:Read`
- `Workers KV Storage:Edit`

The app should continue to explain missing permissions in product language instead of showing raw API failures only.

## Near-Term Requirements

### 1. Better Token Onboarding

Goal: Make first-time setup understandable for non-technical users.

Requirements:

- If no environment token or Wrangler session is found, Settings should show a manual token card.
- The card should link to Cloudflare's API token page.
- The card should explain the minimum permissions needed for D1/R2/KV.
- Saved tokens should live in OS secure storage, not localStorage.
- Clearing the saved token should reload the app and fall back to environment variables or Wrangler.

Acceptance:

- A user who does not use terminal environment variables can still connect the app.
- No token value is logged, committed, or displayed after save.

### 2. R2 Asset Manager

Goal: Make R2 useful as a lightweight image hosting and asset library tool.

Requirements:

- Upload multiple images.
- Paste image from clipboard.
- Copy direct URL after upload.
- Copy Markdown image syntax.
- Rename object key before upload.
- Optional prefix selector, for example `images/`, `blog/`, `assets/`.
- Basic conflict handling when the object key already exists.
- Stale-while-revalidate browsing for bucket folders and object listings.

Acceptance:

- Screenshot or copied image can be uploaded to R2 and pasted into a blog editor within one flow.

### 3. D1 Practical Operations

Goal: Move beyond read-only browsing into safe daily database operations.

Requirements:

- Export table as CSV/JSON.
- Create backup SQL dump.
- Safer query execution warnings for destructive SQL.
- Optional row edit UI for small tables.
- Query templates for common inspection commands.

Acceptance:

- A small D1 database can be inspected, exported, and lightly edited without opening the Dashboard.

### 4. KV Manager

Goal: Fill the biggest missing storage surface.

Requirements:

- List namespaces.
- Search keys by prefix.
- View/edit values.
- JSON formatting and validation.
- Copy key/value.
- Delete with confirmation.

Acceptance:

- Common KV debugging can be done without Dashboard.

### 5. Local Explorer Companion

Goal: Bridge Wrangler local state and remote resources.

Requirements:

- Detect local Wrangler dev projects.
- Document how to open Cloudflare Local Explorer.
- Explore whether `/cdn-cgi/explorer/api` can be used as an optional local data source.
- Compare local and remote D1/R2/KV where safe.

Acceptance:

- A developer can understand whether they are viewing local simulated data or remote Cloudflare data.

## Non-Goals

- Do not clone the full Cloudflare Dashboard.
- Do not depend on the new `cf` CLI while it is still technical preview.
- Do not store Cloudflare API tokens in localStorage.
- Do not auto-enable public R2 access without explicit user action.
- Do not do destructive write-permission tests without user confirmation.

## Open Decisions

- Whether to keep upstream branding or rename the fork for personal use.
- Whether to ship only macOS releases or keep the cross-platform GitHub Actions matrix.
- When to add Apple signing and notarization for broader public distribution.
- Whether custom domain creation should stay Dashboard-only or be exposed in app later.
