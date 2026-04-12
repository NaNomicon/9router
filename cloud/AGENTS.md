# CLOUD WORKER KNOWLEDGE BASE

## OVERVIEW

Cloudflare Worker re-exposing 9Router's routing at global edge. Separate deployable, NOT part of the Next.js build. Shares the translation/routing engine via `"open-sse": "file:../open-sse"`.

## WHERE TO LOOK

| Task | File |
|------|------|
| Route dispatch | `src/index.js` |
| Chat: auth, combo/fallback loop, token refresh | `src/handlers/chat.js` |
| Sync push/pull (providers, combos, apiKeys) | `src/handlers/sync.js` |
| Embeddings | `src/handlers/embeddings.js` |
| Proxy forward / raw TCP forward | `src/handlers/forward.js`, `forwardRaw.js` |
| API key validation | `src/handlers/verify.js` |
| Cache clear / scheduled cleanup | `src/handlers/cache.js`, `cleanup.js` |
| D1 reads/writes + 5s request-scope cache | `src/services/storage.js` |
| OAuth token refresh | `src/services/tokenRefresh.js` |
| Bearer token parse, machineId extraction | `src/utils/apiKey.js` |
| D1 schema | `migrations/0001_init.sql` |
| KV + D1 binding names | `wrangler.toml` |

## ROUTES

`POST /v1/chat/completions|/v1/messages|/v1/responses` → `handleChat`
`POST /v1/embeddings` → `handleEmbeddings`
`GET /v1/verify` → `handleVerify`
`GET|POST|DELETE /sync/:machineId` → `handleSync`
`POST /cache/clear` → `handleCacheClear`
`POST /forward|/forward-raw` → `handleForward|handleForwardRaw`
`cron` (scheduled) → `handleCleanup`

Old format `/{machineId}/v1/...` supported. New format `/v1/...` extracts machineId from Bearer token.

## STORAGE

- **D1 (`env.DB`)** — `machines` table; providers/combos/apiKeys/modelAliases as JSON blob per `machineId`.
- **KV (`env.KV`)** — session/cache data.

## INTEGRATION WITH MAIN APP

Main app's `CLOUD_URL` env var points here. Sync: main app POSTs to `/sync/:machineId`; Worker merges by `updatedAt` (newer wins). Clients call Worker directly with API key embedding `machineId`.

## CONVENTIONS

- No Node.js APIs (`fs`, `path`, `os`, `process.env`) — use `env` bindings only.
- ES Modules, JS only, no TypeScript.
- Static handler imports at top of `index.js` (no dynamic import CPU cost).
- Shared routing/translation lives in `open-sse/` — do not duplicate here.

## COMMANDS

```bash
npm run dev      # wrangler dev
npm run deploy   # wrangler deploy

# One-time setup — paste generated IDs into wrangler.toml
wrangler kv namespace create KV
wrangler d1 create proxy-db
wrangler d1 execute proxy-db --remote --file=./migrations/0001_init.sql
```
