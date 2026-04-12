# OPEN-SSE KNOWLEDGE BASE

## OVERVIEW
Framework-agnostic routing/translation engine. OpenAI is the universal pivot format — all translations use it as a two-step intermediate (`source → openai → target` for requests, `target → openai → source` for responses).

## REQUEST FLOW
```
detectFormat(body)            → source format
isNativePassthrough(tool, provider) → if true, skip translation (model + Bearer swap only)
translateRequest(src→OAI→target)    → two-step pivot via requestRegistry
getExecutor(provider)         → specialized or DefaultExecutor
executor.execute(...)         → HTTP call to upstream
translateResponse(target→OAI→src)   → per-chunk pivot via responseRegistry
```

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Routing/response orchestration | `handlers/chatCore.js` |
| Add/modify executor | `executors/<name>.js` + `executors/index.js` map |
| Provider URL + header construction | `services/provider.js` → `buildProviderUrl`, `buildProviderHeaders` |
| Source format detection | `services/provider.js` → `detectFormat` |
| Provider/model metadata | `config/providers.js`, `config/providerModels.js` |
| Token refresh | `services/tokenRefresh.js` |
| Account fallback / cooling | `services/accountFallback.js` |
| Native passthrough detection | `utils/clientDetector.js` |
| Tool cloaking (anti-ban) | `utils/claudeCloaking.js`, `executors/antigravity.js` |
| Proxy fetch patch | `utils/proxyFetch.js` |
| Translator registry + pivot logic | `translator/index.js` |
| Request translators | `translator/request/<src-to-openai>.js`, `translator/request/<openai-to-target>.js` |
| Response translators | `translator/response/<target-to-openai>.js`, `translator/response/<openai-to-src>.js` |
| Format constants | `translator/formats.js` |

## EXECUTORS

**12 specialized**: `antigravity`, `gemini-cli`, `github`, `iflow`, `qoder`, `kiro`, `codex`, `cursor` (alias `cu`), `vertex`, `vertex-partner`, `qwen`, `opencode`.  
**All others** → `DefaultExecutor` (Bearer token, OpenAI-compatible endpoint).  
Extend `BaseExecutor` (`executors/base.js`); implement `execute()` and `refreshCredentials()`.

## SUPPORTED FORMATS

`openai` | `openai-responses` | `claude` | `gemini` | `gemini-cli` | `antigravity` | `cursor` | `kiro` | `ollama`

## HOW TO ADD A PROVIDER

1. Create `executors/<name>.js` extending `BaseExecutor`; add instance to map in `executors/index.js`
2. Add entry in `config/providers.js` (baseUrl, format, headers) and `config/providerModels.js` (models, targetFormat, optional `strip[]`)
3. Only add a translator if the provider uses a new wire format (see below)

## HOW TO ADD A FORMAT TRANSLATOR

1. Create `translator/request/<src-to-openai>.js` and/or `translator/request/<openai-to-target>.js`
2. Create matching `translator/response/` counterparts
3. Add `require(...)` calls inside `ensureInitialized()` in `translator/index.js` — use `require()`, not `import`, for synchronous registry initialization
4. Each file must call `register(fromFormat, toFormat, requestFn, responseFn)` on load

## CONVENTIONS

- **Pivot**: requests go `source → openai → target`; responses go `target → openai → source`. Same-format pairs skip translation entirely.
- **Translator lazy-load**: `ensureInitialized()` runs once; `require()` inside it keeps the registry synchronous.
- **proxyFetch must be first** in `index.js` — patches global `fetch` before any executor imports.
- **`_toolNameMap`**: translators attach this property to the translated body for cloaked tools; `chatCore.js` strips it before HTTP dispatch.
- **openai + codex force streaming**: `providerRequiresStreaming = true`; SSE-to-JSON conversion done by `handlers/chatCore/sseToJsonHandler.js` when client wants JSON.
- **`strip[]` in providerModels**: opt-in per-model removal of `image` or `audio` content types before translation.
- **`openai-compatible-*` / `anthropic-compatible-*` prefixes**: virtual provider IDs handled in `getProviderConfig` / `buildProviderUrl` / `getTargetFormat` — no executor or translator needed.

## ANTI-PATTERNS

- **Never** import open-sse sub-paths from outside; always use the `open-sse` jsconfig alias resolving to `index.js`.
- **Never** set `Authorization` for `vertex`/`vertex-partner` in `buildProviderHeaders` — `VertexExecutor._buildHeadersAsync()` mints the token after the fact.
- **Never** cloak tools for native Antigravity clients (`body.userAgent === "antigravity"`) — cloaking is only for non-native callers.
- **Never** filter `tool_use` / `tool_result` messages — only filter empty-text user messages.
- **Always** send `message_start` as the first SSE chunk in OpenAI → Claude translation (Claude protocol requirement).

## REVERSE DEPENDENCIES (open-sse → Next.js app)

These two imports couple open-sse to the host app; keep them stable:
- `@/lib/usageDb.js` — used in `handlers/chatCore.js` for request tracking (`trackPendingRequest`, `appendRequestLog`, `saveRequestDetail`)
- `../../src/shared/utils/clineAuth.js` — used in `services/provider.js` for Cline auth header construction
