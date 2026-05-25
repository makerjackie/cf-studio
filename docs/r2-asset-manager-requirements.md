# R2 Asset Manager Requirements

## Purpose

This document defines the next-stage R2 work for the MakerJackie CF Studio fork.

The product direction is not "a smaller Cloudflare Dashboard". The useful product is a local-first R2 asset manager for images, blog assets, downloads, and static files.

Primary user goal:

- Browse all R2 buckets quickly.
- Inspect image-heavy folders visually.
- Upload screenshots and assets with predictable naming.
- Copy usable URLs or Markdown snippets immediately.
- Avoid waiting on the Cloudflare Dashboard for repeated asset operations.

## Current Problems

1. R2 upload settings should not occupy the main page.

   The main R2 screen should show buckets, folders, files, previews, and transfer state. Upload defaults belong in a settings dialog.

2. Image preview is still too weak.

   The current object list can show a small thumbnail for public images, but it does not yet provide a real image-browser mode. Users should be able to switch between list view and grid/gallery view.

3. Clipboard behavior should be native, not WebView-dependent.

   Browser `navigator.clipboard` can fail inside WebView. CF Studio should use Tauri's native clipboard plugin for reading and writing text/images where possible, and explain why clipboard access is needed.

4. Private buckets should still be inspectable.

   Public URLs are only available when custom domain or managed `r2.dev` access is enabled. A private bucket should still support preview through authenticated app-side download or temporary signed access.

5. Upload and bulk operations need a real transfer model.

   Single uploads are not enough. A useful R2 asset manager needs upload/download progress, retry, cancel, and batch status.

## Product Principles

- Keep the main screen dense and operational.
- Hide advanced defaults behind a settings button.
- Prefer cached local state first, then background refresh.
- Make public/private access explicit.
- Never auto-enable public access.
- Keep Cloudflare credentials out of the frontend runtime.
- Use native Tauri capabilities for filesystem and clipboard operations.
- Optimize for image and static-asset workflows before generic cloud-storage administration.

## Priority Roadmap

### P0: Make R2 usable as a local asset browser

#### 1. View Modes

Requirements:

- Add a segmented control for `List` / `Grid`.
- List view remains optimized for dense object management.
- Grid view shows image thumbnails as the primary visual signal.
- Grid cards show:
  - thumbnail
  - filename
  - size
  - updated time
  - public/private status when known
- Non-image objects show file-type icons.
- Persist the selected view mode locally.

Acceptance:

- A folder with screenshots or blog images can be scanned visually without opening every file.
- Switching folders does not reset the chosen view mode.

#### 2. Image Preview

Requirements:

- Add a preview dialog/lightbox for image objects.
- Support next/previous navigation within the current filtered file list.
- Show object details beside or below the preview:
  - key
  - size
  - content type when available
  - uploaded/modified time
  - public URL when available
- Provide buttons:
  - copy URL
  - copy Markdown
  - download
  - reveal in current folder
- For public images, use public/custom domain URL when available.
- For private images, use authenticated app-side download to a temporary local preview cache.

Acceptance:

- Public and private images can both be previewed in the app.
- The app does not require enabling public R2 access just to view an image.

#### 3. Native Clipboard

Requirements:

- Add Tauri clipboard manager plugin.
- Replace text copy calls with native clipboard write.
- Prefer native clipboard image read for screenshot upload.
- If clipboard image read fails, fall back to file picker without marking upload as failed.
- Add a first-run or settings hint explaining:
  - clipboard read is used to upload screenshots directly
  - clipboard write is used to copy URLs and Markdown snippets
  - no clipboard content is stored unless uploaded by the user

Acceptance:

- Copying URL/Markdown should not fail because of WebView clipboard restrictions.
- Clicking "Paste or Upload" reads an image if present; otherwise it opens file picker.

#### 4. Upload Settings Dialog

Requirements:

- Keep upload defaults in a settings dialog:
  - prefix
  - date folder
  - single-file custom name
  - conflict strategy
  - after-upload copy format
- Main toolbar only exposes:
  - upload
  - paste or upload
  - settings
  - refresh

Acceptance:

- The main screen is bucket/object focused.
- Upload defaults remain discoverable but do not dominate the page.

#### 5. Public Domain Cache

Requirements:

- Cache public domain status per account + bucket.
- Use long TTL because domain status changes rarely.
- Show cached timestamp.
- Add a hover-visible manual refresh button.
- Prefer custom domain over managed `r2.dev` when both exist.

Acceptance:

- Opening a bucket does not always call domain APIs.
- Users can manually refresh after changing domain settings in Cloudflare.

### P1: Become a practical R2 file manager

#### 6. Transfer Queue

Requirements:

- Add a bottom transfer dock or panel.
- Track uploads and downloads.
- Show:
  - filename/key
  - status
  - progress
  - speed when practical
  - retry
  - cancel
- Support batch upload and download.
- Keep completed transfers visible until cleared.

Acceptance:

- A user can drop multiple files and understand what succeeded, failed, or is still running.

#### 7. Bulk Operations

Requirements:

- Add multi-select in list and grid views.
- Support:
  - download selected
  - delete selected with confirmation
  - copy URLs
  - copy Markdown for selected image objects
  - move/copy to another prefix
- Support recursive folder upload.
- Support recursive folder download.

Acceptance:

- Common folder-level maintenance does not require repeated single-object actions.

#### 8. Object Rename, Move, and Copy

Requirements:

- Rename should be implemented as copy-to-new-key plus delete-old-key.
- Move should use the same copy/delete behavior.
- Copy should preserve content type and metadata where possible.
- Never delete the source until the copy succeeds.
- Confirm destructive operations.

Acceptance:

- Users can reorganize image folders without going to the Dashboard or using CLI.

#### 9. Metadata Panel

Requirements:

- Add a right-side object detail panel.
- Show:
  - key
  - bucket
  - size
  - ETag
  - content type
  - cache-control
  - last modified/uploaded time
  - custom metadata if returned by API
- Allow setting content type and cache-control during upload.
- Later: allow metadata replacement through copy-object flow.

Acceptance:

- Users can diagnose bad image rendering caused by wrong content type.
- Users can set cache headers for static assets at upload time.

#### 10. Search and Sorting

Requirements:

- Keep current-prefix filter instant.
- Add sorting by:
  - name
  - size
  - modified time
  - type
- Add optional background indexing for selected buckets.
- Background index should be account-scoped and cancellable.
- Clearly show whether search is current-prefix-only or full-bucket indexed.

Acceptance:

- Small folders remain instant.
- Large buckets do not freeze the UI.

### P2: Make it better than Dashboard for image hosting

#### 11. Full Image Gallery Mode

Requirements:

- Add large grid mode for image-only browsing.
- Support keyboard navigation.
- Support zoom in preview.
- Show dimensions when available.
- Cache dimensions and thumbnails locally.
- Optional: local-only tags/favorites.

Acceptance:

- The app feels closer to a lightweight asset library than a raw object list.

#### 12. Duplicate Detection

Requirements:

- Detect same filename conflicts before upload.
- Optional: detect duplicate content by hash for local upload files.
- Show "already exists" with choices:
  - use existing URL
  - rename and upload
  - overwrite
  - skip

Acceptance:

- Re-uploading the same blog image does not create accidental duplicates.

#### 13. Presigned URL Support

Requirements:

- Add temporary link generation for private objects.
- Allow expiry choices:
  - 15 minutes
  - 1 hour
  - 1 day
  - 7 days
- Make clear that presigned URLs are bearer tokens.
- Make clear that R2 presigned URLs use the S3 API endpoint, not custom domains.

Acceptance:

- Private objects can be shared temporarily without enabling public bucket access.

#### 14. Advanced Upload Rules

Requirements:

- Per-bucket default prefix.
- Per-bucket after-upload copy format.
- Naming templates:
  - original filename
  - timestamp
  - date path
  - slugified filename
  - random suffix
- Optional image conversion/compression should remain explicit, not automatic.

Acceptance:

- Screenshot-to-blog workflows become one click after initial setup.

## Technical Architecture

### Data Sources

Use both Cloudflare REST APIs and S3-compatible APIs.

Recommended split:

- Cloudflare REST API:
  - bucket list
  - public domain status
  - Cloudflare-account-aware operations
- S3-compatible API:
  - object metadata
  - presigned URLs
  - multipart uploads
  - copy/move flows

Reason:

- R2 is S3-compatible, and many mature object-storage workflows are better represented by S3 concepts.
- Cloudflare-specific domain and account features are still easier through Cloudflare APIs.

### Cache Layers

1. Bucket cache

   Account-scoped bucket list with stale-while-revalidate.

2. Object listing cache

   Account + bucket + prefix scoped cache.

3. Domain cache

   Account + bucket scoped cache with long TTL.

4. Thumbnail cache

   Local app cache, keyed by account + bucket + object key + ETag.

5. Metadata cache

   Optional per-object cache for content type, cache-control, custom metadata, dimensions, and preview info.

6. Search index

   Optional local index for buckets the user chooses to index.

### Cache Invalidation

Invalidate or patch affected cache entries after:

- upload
- delete
- rename
- move
- metadata replacement
- manual refresh

Do not clear the whole bucket cache unless necessary.

### Clipboard Strategy

Use native Tauri clipboard APIs instead of relying on browser clipboard APIs.

Expected behavior:

- On first clipboard action, explain what the app uses clipboard for.
- If macOS/system denies access, keep the upload/file-picker flow usable.
- Never classify clipboard copy failure as upload failure.

### Preview Strategy

Public object:

- Use public custom domain or managed `r2.dev` URL.
- Cache thumbnail locally.

Private object:

- Fetch via authenticated backend command.
- Save temporary preview cache locally.
- Render through Tauri asset URL.

Large object:

- Do not download full content automatically.
- Show size warning or load only on explicit preview.

## Testing Requirements

### Unit Tests

- Upload key generation.
- Prefix normalization.
- Conflict handling:
  - rename
  - skip
  - overwrite cancel
- Cache keys:
  - account isolation
  - bucket isolation
  - prefix isolation
- Public URL generation.
- Markdown generation.

### Rust Tests

- Thumbnail cache filename generation.
- Thumbnail resize output.
- Large image rejection.
- Non-image rejection for thumbnail path.
- Cache eviction behavior.

### Integration Tests

Use a mock R2/S3-compatible service where possible.

Test:

- list objects
- upload object
- download object
- delete object
- copy/rename object
- metadata read
- presigned URL generation

### Manual Test Matrix

Buckets:

- private bucket
- bucket with managed `r2.dev`
- bucket with custom domain
- bucket with many prefixes
- bucket with image-heavy folder

Actions:

- paste screenshot and upload
- upload file picker fallback
- drag and drop upload
- copy URL
- copy Markdown
- preview public image
- preview private image
- delete object
- refresh domain status
- switch between list and grid

## Non-Goals

- Do not clone all Cloudflare Dashboard settings.
- Do not auto-enable public bucket access.
- Do not expose raw credentials to the frontend.
- Do not build a general multi-cloud storage suite until the R2 workflow is strong.
- Do not add image compression/conversion as a hidden default.

## Open Decisions

1. Should this fork stay R2-first, or should it become a broader S3-compatible client?

   Recommendation: stay R2-first for now. Use S3 APIs internally only where they improve R2 functionality.

2. Should background full-bucket indexing be automatic?

   Recommendation: no. Make it opt-in per bucket because large buckets may be expensive or slow to crawl.

3. Should private previews use temporary files or in-memory blobs?

   Recommendation: use app cache files with eviction. It works better for large images and Tauri asset rendering.

4. Should the app support video/PDF preview in the next milestone?

   Recommendation: image preview first. PDF/text/video can follow after transfer queue and private image preview are stable.

5. Should macOS be the only first-class target?

   Recommendation: optimize for macOS first, but keep the implementation cross-platform when Tauri gives it for free.

## Implementation Milestones

### Milestone 1: R2 Image Browser

- List/grid view switch.
- Real image preview dialog.
- Private image preview through authenticated backend download.
- Native clipboard plugin.
- Upload settings dialog retained.
- Domain cache retained.

### Milestone 2: Transfer and Bulk Operations

- Transfer queue.
- Multi-select.
- Bulk delete/download/copy URL.
- Recursive upload/download.

### Milestone 3: Metadata and Presigned URLs

- Object detail panel.
- Metadata read.
- Upload content-type/cache-control controls.
- Temporary private share links.

### Milestone 4: Search and Asset Library

- Optional full-bucket background index.
- Advanced filters.
- Dimensions cache.
- Local favorites/tags.
- Duplicate detection.

## References

- Cloudflare R2 S3 API compatibility: https://developers.cloudflare.com/r2/api/s3/api/
- Cloudflare R2 presigned URLs: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- Cloudflare R2 object API reference: https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects
- Tauri clipboard plugin: https://v2.tauri.app/plugin/clipboard/
- Brows3 S3 browser feature reference: https://www.brows3.app/
- BucketDock S3 client feature reference: https://bucketdock.com/
