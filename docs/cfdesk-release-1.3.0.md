# CFDesk v1.3.0 Release

Date: 2026-05-31

This release makes CFDesk feel more like a focused Cloudflare operations desk: a native place to inspect account resources, jump into Wrangler workflows, verify local readiness, and prepare safer release work without opening several browser tabs first.

## Improvements

1. Added CFDesk Home as the default app surface.
2. Added resource map tiles for R2, D1, KV, Workers, Queues, and Token Check.
3. Added account connection status directly on the home screen.
4. Added account-aware Cloudflare Dashboard launch.
5. Added API Tokens launch from CFDesk Home and the command center.
6. Added copyable Cloudflare environment variable snippets.
7. Added copyable minimum token permission checklist.
8. Added D1 cache freshness status.
9. Added R2 cache freshness status.
10. Added KV cache freshness status.
11. Added workspace readiness scoring.
12. Added readiness checks for account, user profile, D1, R2, Workers, privacy, remote resource loading, and auto-update state.
13. Added Workers health summary for requests and errors.
14. Added Workers binding and traffic entry counts.
15. Added recently updated Workers shortcuts.
16. Added local Wrangler runbook cards.
17. Added copyable Wrangler login command.
18. Added copyable Wrangler local dev command.
19. Added copyable Wrangler remote preview command.
20. Added copyable Wrangler deploy command.
21. Added copyable Wrangler tail command.
22. Added copyable multi-resource Wrangler list command.
23. Added Local Explorer entry from CFDesk Home.
24. Added Cloudflare docs shortcuts for Workers, D1, R2, Queues, and Local Explorer.
25. Added global command center with navigation, docs, account actions, and Wrangler command search.
26. Added `Cmd/Ctrl+K` command center shortcut.
27. Added `Cmd/Ctrl+B` sidebar toggle shortcut.
28. Added `Cmd/Ctrl+1..9` numbered navigation shortcuts.
29. Added persisted active navigation.
30. Added persisted sidebar collapsed state.
31. Added persisted recent navigation state for future quick-open workflows.
32. Added active account badge in the title bar with privacy blur support.
33. Added code splitting for major views to reduce the initial app shell size.
34. Added helper tests for cache status, command filtering, dashboard URLs, env snippets, readiness, and token permissions.
35. Cleaned up public R2 requirements wording to match the current writing rules.

## Verification

- `bun run test`
- `bun run build`
- `cargo check`
- `./scripts/verify_release.sh`
