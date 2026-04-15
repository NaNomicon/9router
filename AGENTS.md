# 9ROUTER KNOWLEDGE BASE

**Generated:** 2026-04-12 | **Commit:** 875a128 | **Branch:** master

## OVERVIEW

Local AI routing gateway built on Next.js 16. Exposes a single OpenAI-compatible endpoint (`/v1/*`) and routes traffic across 20+ upstream providers with format translation, combo/account fallback, token refresh, and usage tracking. Pure JavaScript (no TypeScript). Dashboard UI with Tailwind v4.

## STRUCTURE

```
9router/
├── open-sse/           # Routing/translation engine (see open-sse/AGENTS.md)
├── cloud/              # Cloudflare Worker for edge deployment (see cloud/AGENTS.md)
├── src/
│   ├── app/            # Next.js App Router (API routes + dashboard pages)
│   │   ├── api/v1/     # OpenAI-compatible endpoints (chat, messages, responses, models, embeddings, audio)
│   │   ├── (dashboard)/dashboard/  # Dashboard UI pages (route group)
│   │   └── login/      # JWT cookie auth page
│   ├── sse/            # Thin adapter: auth + DB wiring → delegates to open-sse
│   ├── mitm/           # HTTPS MITM proxy (child process, port 443)
│   ├── lib/            # Server-only singletons (localDb, usageDb, oauth, tunnel, proxy)
│   ├── shared/         # Cross-boundary components, hooks, utils, constants
│   └── store/          # Zustand client stores (theme, user, provider, notification)
├── tests/              # Vitest unit tests (separate package.json)
├── tester/             # Manual dev-time test scripts (not automated)
├── docs/ARCHITECTURE.md  # Comprehensive architecture with mermaid diagrams
├── next.config.mjs     # Rewrites: /v1/* → /api/v1/*, /codex/* → /api/v1/responses
└── package.json        # 9router-app (private), forced webpack, port 20128
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add/modify API endpoint | `src/app/api/v1/` | `/v1/` prefix is via rewrite, not file path |
| Routing/fallback logic | `src/sse/handlers/chat.js` | Combo loop, account selection, then → open-sse |
| Format translation | `open-sse/translator/` | OpenAI is pivot format; see open-sse/AGENTS.md |
| Add new provider executor | `open-sse/executors/` | Extend BaseExecutor |
| OAuth provider setup | `src/lib/oauth/providers.js` | Central OAuth engine (1,216 lines) |
| DB schema changes | `src/lib/localDb.js` | Primary state store; highest blast radius |
| Usage/cost tracking | `src/lib/usageDb.js` | Separate from localDb; uses `~/.9router/` |
| Dashboard page | `src/app/(dashboard)/dashboard/{page}/` | Route group layout isolation |
| Auth middleware | `src/dashboardGuard.js` | NOT middleware.js; re-exported by `src/proxy.js` |
| MITM intercept | `src/mitm/handlers/` | Or `src/mitm/dev/` for private overrides |
| Tunnel config | `src/lib/tunnel/` | Cloudflare + Tailscale managers |
| Client stores | `src/store/` | Zustand: theme, user, provider, notification |
| Shared UI components | `src/shared/components/` | DashboardLayout, Sidebar, modals |
| i18n strings | `public/i18n/literals/{locale}.json` | Runtime-loaded, not Next.js i18n routing |

## CONVENTIONS

- **JS only** — no TypeScript. All files `.js`/`.mjs`. Do not add `tsconfig.json`.
- **Forced webpack** — `--webpack` flag required on all `next dev`/`next build` commands. Turbopack disabled.
- **Tailwind v4** — no `tailwind.config.js`. CSS custom properties in `globals.css`. Dark mode via `.dark` class.
- **No Prettier, no .editorconfig** — formatting via ESLint only (flat config `eslint.config.mjs`).
- **`package-lock.json` is gitignored** — regenerate locally.
- **Path aliases** — `@/*` → `./src/*`, `open-sse` → `./open-sse/` (via jsconfig).
- **Dev port 20128** — not 3000. All base URLs default to `http://localhost:20128`.
- **Server init via side-effect import** — `src/app/page.js` imports `@/lib/initCloudSync`; `initializeApp.js` uses `global.__appSingleton` to survive HMR.
- **Data storage paths** — main DB at `${DATA_DIR}/db.json` (default `~/.9router/db.json`), usage at `~/.9router/usage.json` + `log.txt`. usageDb does NOT follow `DATA_DIR`.

## ANTI-PATTERNS (THIS PROJECT)

### SSE / Streaming
- **ALWAYS** terminate SSE stream even in passthrough mode.
- **ALWAYS** send `message_start` as first chunk in OpenAI→Claude translation.
- Clean up reader/writer references after stream ends.

### Message Filtering
- **NEVER** filter tool messages — only filter empty-text user messages.
- `thinking`/`redacted_thinking` blocks do NOT support `cache_control`.
- Strip built-in tools (e.g. `web_search_20250305`) for non-Claude providers.
- Filter nameless `functionDeclarations` before forwarding to downstream.

### Provider-Specific
- Vertex AI: SA JSON + Bearer must use project-scoped path or `RESOURCE_PROJECT_INVALID`.
- Qoder: requires 3 custom headers or 406.
- Claude OAuth: requires prefixed tool names to avoid conflicts.
- OpenRouter passthrough: use last URL path segment as alias to avoid slash conflicts.

### Networking
- Use `Map` (not plain object) for DNS cache — prevents prototype pollution.
- MITM DNS bypass: resolve real IP for intercepted hosts.
- Patch `proxyFetch` only once — idempotency guard exists.
- Use `127.0.0.1`, never `localhost`, for OpenClaw (IPv6 resolution issues).

### Data / Database
- Always read latest disk state for localDb — never rely on in-memory singleton across route workers.
- Use full API key for usage DB lookups, not prefix — prefixes collide.

### Frontend
- Define components outside render scope to avoid re-mount on re-render.
- Use `useState` + `useEffect` for `Date.now()` — never call during render.
- Portal modals at `document.body` to escape parent layout.
- Import model constants from direct file paths — avoid `index.js` which pulls server deps.

## MITM PROXY (`src/mitm/`)

Local HTTPS man-in-the-middle proxy on port 443 for intercepting subscription tools that can't be redirected via env var. Runs as a child process managed by `src/mitm/manager.js`.

| Tool | Host | URL Patterns |
|------|------|-------------|
| Antigravity | `cloudcode-pa.googleapis.com` | `:generateContent`, `:streamGenerateContent` |
| Copilot | `api.individual.githubcopilot.com` | `/chat/completions`, `/v1/messages`, `/responses` |
| Kiro | `q.us-east-1.amazonaws.com` | `/generateAssistantResponse` |
| Cursor | `api2.cursor.sh` | `/BidiAppend`, `/RunSSE`, `/RunPoll`, `/Run` (protobuf) |

- `dev/` directory holds private handler overrides that shadow `handlers/`.
- Anti-loop guard: `x-request-source: local` header bypasses interception.
- Requires elevated permissions (port 443). CA cert generated by `cert/` module.
- Config reads `mitmAlias` from shared `db.json` at `DATA_DIR`.

## COMMANDS

```bash
# Development
npm run dev                    # next dev --webpack --port 20128

# Production
npm run build                  # NODE_ENV=production next build --webpack
npm run start                  # NODE_ENV=production next start

# Tests (from tests/ directory, NOT root)
cd tests && npm test           # Requires: cd /tmp && npm install vitest (first time)

# Docker
docker build -t 9router .
docker run -v 9router-data:/app/data -v 9router-usage:/root/.9router -p 20128:20128 9router

# Cloud worker (separate deployment)
cd cloud && wrangler deploy
```

## NOTES

- **CI has no test step** — tests must be run manually before tagging a release.
- **Vitest lives in `/tmp/node_modules`** — npm hoisting conflicts prevent normal install.
- **`providers/[id]/page.js`** (2,159 lines) has a WIP rewrite (`page.new.js`) alongside it.
- **`docs/ARCHITECTURE.md`** (558 lines) has comprehensive mermaid diagrams — read it first for system overview.
- **Two data volumes in Docker**: `/app/data` (main DB via `DATA_DIR`) and `/root/.9router` (usage) — must mount both.
- **Default password is `123456`** — `JWT_SECRET` and `INITIAL_PASSWORD` must be changed in production.
- **Env vars**: `DATA_DIR`, `JWT_SECRET`, `INITIAL_PASSWORD`, `API_KEY_SECRET`, `ENABLE_REQUEST_LOGS`, `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_CLOUD_URL`, `HTTP_PROXY`/`HTTPS_PROXY`.
- **TTFT Timeout (fork-only)** — Not present in upstream. A configurable time-to-first-token timeout that aborts slow streaming providers and soft-locks the account. Settings: `ttftTimeoutMs` (default 0 = disabled) and `ttftCooldownMs` (default 15000ms). Canonical fork seam: `src/fork/ttft/`. Integration points: `open-sse/handlers/chatCore.js`, `open-sse/services/accountFallback.js`, `src/sse/handlers/chat.js`, `src/lib/localDb.js`, and `src/app/(dashboard)/dashboard/profile/page.js`. **Merge guidance**: preserve helper imports/call boundaries first, then port any upstream flow changes around them.
- **Provider model disable (fork-only)** — Provider-wide disabled model state and enforcement live behind `src/fork/providerModelDisable/`. Integration points: `src/lib/localDb.js`, `src/app/api/providers/[id]/route.js`, `src/app/api/v1/models/route.js`, `src/shared/components/ModelSelectModal.js`, `src/sse/handlers/chat.js`, and `src/app/(dashboard)/dashboard/providers/[id]/page.js`. **Merge guidance**: keep policy in helpers, and treat inline list/set logic in integration points as a regression to refactor back out.

## FORK HELPER SEAMS

- Put new fork-only behavior behind helper seams first, then call those helpers from upstream-owned files.
- Canonical locations for current fork-only helpers:
  - `src/fork/ttft/` for TTFT timeout constants, settings normalization, fallback handling, and stream-timeout helpers.
  - `src/fork/providerModelDisable/` for disabled-model normalization, selectors, and mutations shared across runtime/API/UI.
- Treat hotspot files as orchestration/integration points, not as the long-term home of fork logic.
- When a future fork-only feature needs multiple touchpoints, add a new helper namespace under `src/fork/` (or the closest module-local fork seam) before modifying the hotspot files.
- During upstream pulls/merges, verify helper module signatures first, then verify each integration point still calls the helper instead of re-inlining logic.

## FORK BRANCH WORKFLOW

- **`master` is the upstream-sync branch** — keep it close to `decolua/9router` and avoid developing fork features directly on it.
- **`dev` is the personal integration branch** — this branch may contain all locally desired fork features, even if upstream PRs are still open or never merged.
- **Upstreamable work always starts from clean upstream-sync state** — create one feature branch per upstream PR from `master`, not from `dev`.
- **Merge direction**: feature branch → upstream PR, and separately feature branch → `dev` for local use. Do not branch upstream PR work off `dev` unless the PR intentionally depends on unmerged local work.
- **Use separate worktrees** for active long-lived branches. Current intended layout:
  - `9router/` → `master`
  - `9router-dev/` → `dev`
  - dedicated per-feature worktrees (for example `9router-ttft-pr/`, `9router-provider-disable-pr/`) for upstream PR branches
- **Branch naming guidance**:
  - personal integration: `dev`
  - upstream PR branches: `feature/<slug>` or `agent/<agent>/<slug>`
  - local-only experiments: `local/<slug>`
- **Cherry-pick or merge into `dev` deliberately** after a feature branch is validated, so `dev` remains the branch that represents “what I actually run”.
- **Keep upstream PR branches minimal** — exclude `.sisyphus` planning artifacts, local-only docs, and unrelated fork changes.
- **Do not rely on merge-vs-rebase policy to protect fork features** — both strategies can drop or regress local behavior when upstream refactors overlapping code. Protection comes from branch structure and verification, not from history shape.
- **Every fork-only feature must retain a canonical feature branch** even after it lands in `dev`. Treat `dev` as the integration result, not as the only copy of local feature history.
- **Prefer replayable fork features** — keep local-only changes in small, focused commits with narrow blast radius so they can be cherry-picked, replayed, or manually ported after upstream refactors.
- **After every upstream sync into `dev`, run a fork regression check** for each active fork-only feature. Verify both history and behavior:
  - confirm the feature branch tip is still reachable from `dev` when that branch is meant to be integrated;
  - grep for the key codepaths/files that implement the feature;
  - verify the user-visible behavior or API path still exists.
- **If upstream refactors the same area, port the feature intentionally** — do not assume a clean merge means the behavior survived. Re-apply the feature onto the new architecture if necessary, then verify before considering the sync complete.
- **Current fork-only feature checklist**:
  - **TTFT timeout** — verify `src/fork/ttft/` helpers still match integration points in `open-sse/handlers/chatCore.js`, `open-sse/services/accountFallback.js`, `src/sse/handlers/chat.js`, `src/lib/localDb.js`, and `src/app/(dashboard)/dashboard/profile/page.js`.
  - **Provider model disable** — verify `src/fork/providerModelDisable/` helpers still match integration points in `src/lib/localDb.js`, `src/app/api/providers/[id]/route.js`, `src/app/api/v1/models/route.js`, `src/shared/components/ModelSelectModal.js`, `src/sse/handlers/chat.js`, and the provider page UI under `src/app/(dashboard)/dashboard/providers/[id]/`.
