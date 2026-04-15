import { NextResponse } from "next/server";
import { getApiKeys } from "@/lib/localDb";
import {
  DUAL_MODE,
  NON_STREAM_MODE,
  STREAM_MODE,
  normalizeMode,
  runEmbeddingModelTest,
  runNonStreamChatModelTest,
  runStreamChatModelTest,
} from "@/fork/modelTest";

// POST /api/models/test - Ping a single model via internal completions or embeddings
export async function POST(request) {
  try {
    const { model, kind, mode } = await request.json();
    if (!model) return NextResponse.json({ error: "Model required" }, { status: 400 });

    const baseUrl = process.env.BASE_URL ||
      (() => { const u = new URL(request.url); return `${u.protocol}//${u.host}`; })();

    // Get an active internal API key for auth (if requireApiKey is enabled)
    let apiKey = null;
    try {
      const keys = await getApiKeys();
      apiKey = keys.find((k) => k.isActive !== false)?.key || null;
    } catch {}

    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const start = Date.now();
    const normalizedMode = normalizeMode(mode, kind);

    // Route to appropriate endpoint based on kind
    if (kind === "embedding") {
      const result = await runEmbeddingModelTest(baseUrl, headers, model, start);
      if (normalizedMode === DUAL_MODE) {
        return NextResponse.json({
          nonStream: result,
          stream: { ok: false, latencyMs: 0, error: "Streaming test is not supported for embedding models", status: null, skipped: true },
        });
      }
      return NextResponse.json(result);
    }

    if (normalizedMode === NON_STREAM_MODE) {
      return NextResponse.json(await runNonStreamChatModelTest(baseUrl, headers, model, start));
    }

    if (normalizedMode === STREAM_MODE) {
      return NextResponse.json(await runStreamChatModelTest(baseUrl, headers, model, start));
    }

    const nonStream = await runNonStreamChatModelTest(baseUrl, headers, model, start);
    const stream = await runStreamChatModelTest(baseUrl, headers, model, Date.now());

    return NextResponse.json({ nonStream, stream });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
