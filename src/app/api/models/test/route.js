import { NextResponse } from "next/server";
import { getApiKeys } from "@/lib/localDb";

const NON_STREAM_MODE = "non-stream";
const STREAM_MODE = "stream";
const DUAL_MODE = "dual";

function normalizeMode(mode, kind) {
  if (kind === "embedding") return NON_STREAM_MODE;
  if (mode === "non_stream") return NON_STREAM_MODE;
  if (mode === NON_STREAM_MODE || mode === STREAM_MODE || mode === DUAL_MODE) return mode;
  return DUAL_MODE;
}

async function runEmbeddingTest(baseUrl, headers, model, start) {
  const res = await fetch(`${baseUrl}/api/v1/embeddings`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, input: "test" }),
    signal: AbortSignal.timeout(15000),
  });
  const latencyMs = Date.now() - start;
  const rawText = await res.text().catch(() => "");
  let parsed = null;
  try { parsed = rawText ? JSON.parse(rawText) : null; } catch {}

  if (!res.ok) {
    const detail = parsed?.error?.message || parsed?.error || rawText;
    return { ok: false, latencyMs, error: `HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 240)}` : ""}`, status: res.status };
  }
  const hasEmbedding = Array.isArray(parsed?.data) && parsed.data.length > 0 && Array.isArray(parsed.data[0]?.embedding);
  if (!hasEmbedding) {
    return { ok: false, latencyMs, status: res.status, error: "Provider returned no embedding data" };
  }
  return { ok: true, latencyMs, error: null, status: res.status };
}

async function runNonStreamChatTest(baseUrl, headers, model, start) {
  const res = await fetch(`${baseUrl}/api/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      max_tokens: 1,
      stream: false,
      messages: [{ role: "user", content: "hi" }],
    }),
    signal: AbortSignal.timeout(15000),
  });
  const latencyMs = Date.now() - start;

  const rawText = await res.text().catch(() => "");
  let parsed = null;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {}

  if (!res.ok) {
    const detail = parsed?.error?.message || parsed?.msg || parsed?.message || parsed?.error || rawText;
    const error = `HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 240)}` : ""}`;
    return { ok: false, latencyMs, error, status: res.status };
  }

  const providerStatus = parsed?.status;
  const providerMsg = parsed?.msg || parsed?.message;
  const hasProviderErrorStatus = providerStatus !== undefined
    && providerStatus !== null
    && String(providerStatus) !== "200"
    && String(providerStatus) !== "0";
  if (hasProviderErrorStatus && providerMsg) {
    return {
      ok: false,
      latencyMs,
      status: res.status,
      error: `Provider status ${providerStatus}: ${String(providerMsg).slice(0, 240)}`,
    };
  }

  if (parsed?.error) {
    const providerError = parsed?.error?.message || parsed?.error || "Provider returned an error";
    return {
      ok: false,
      latencyMs,
      status: res.status,
      error: String(providerError).slice(0, 240),
    };
  }

  const hasChoices = Array.isArray(parsed?.choices) && parsed.choices.length > 0;
  if (!hasChoices) {
    return {
      ok: false,
      latencyMs,
      status: res.status,
      error: "Provider returned no completion choices for this model",
    };
  }

  return { ok: true, latencyMs, error: null, status: res.status };
}

async function runStreamChatTest(baseUrl, headers, model, start) {
  const res = await fetch(`${baseUrl}/api/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      max_tokens: 5,
      temperature: 0,
      stream: true,
      messages: [{ role: "user", content: "Reply exactly: OK" }],
    }),
    signal: AbortSignal.timeout(20000),
  });

  const contentType = res.headers.get("content-type") || "";
  if (!res.ok) {
    const latencyMs = Date.now() - start;
    const rawText = await res.text().catch(() => "");
    let parsed = null;
    try { parsed = rawText ? JSON.parse(rawText) : null; } catch {}
    const detail = parsed?.error?.message || parsed?.msg || parsed?.message || parsed?.error || rawText;
    return { ok: false, latencyMs, error: `HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 240)}` : ""}`, status: res.status };
  }

  if (!res.body) {
    return { ok: false, latencyMs: Date.now() - start, status: res.status, error: "Provider returned no streaming body" };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawDone = false;
  let sawChunk = false;
  let sawContent = false;
  let streamError = null;

  const processBuffer = (flush = false) => {
    const events = buffer.split("\n\n");
    buffer = flush ? "" : (events.pop() || "");

    for (const event of events) {
      const dataLines = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);

      for (const dataLine of dataLines) {
        if (dataLine === "[DONE]") {
          sawDone = true;
          continue;
        }

        let parsed;
        try {
          parsed = JSON.parse(dataLine);
        } catch {
          continue;
        }

        sawChunk = true;

        if (parsed?.error) {
          streamError = parsed?.error?.message || parsed?.error || "Provider returned an error during streaming";
          return;
        }

        const deltaContent = parsed?.choices?.some((choice) => {
          const content = choice?.delta?.content;
          if (Array.isArray(content)) {
            return content.some((part) => typeof part?.text === "string" && part.text.length > 0);
          }
          return typeof content === "string" && content.length > 0;
        });

        if (deltaContent || parsed?.choices?.some((choice) => choice?.finish_reason)) {
          sawContent = true;
        }
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    processBuffer(false);
    if (streamError) break;
  }

  buffer += decoder.decode();
  processBuffer(true);

  const latencyMs = Date.now() - start;
  if (streamError) {
    return { ok: false, latencyMs, status: res.status, error: String(streamError).slice(0, 240) };
  }
  if (!sawChunk) {
    return { ok: false, latencyMs, status: res.status, error: "Provider returned no streaming chunks for this model" };
  }
  if (!sawDone) {
    return { ok: false, latencyMs, status: res.status, error: "Provider stream ended without a [DONE] marker" };
  }
  if (!contentType.includes("text/event-stream")) {
    return { ok: false, latencyMs, status: res.status, error: `Expected streaming SSE response, got ${contentType || "unknown content-type"}` };
  }
  if (!sawContent) {
    return { ok: false, latencyMs, status: res.status, error: "Provider stream completed without any completion content" };
  }

  return { ok: true, latencyMs, error: null, status: res.status };
}

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
      const result = await runEmbeddingTest(baseUrl, headers, model, start);
      if (normalizedMode === DUAL_MODE) {
        return NextResponse.json({
          nonStream: result,
          stream: { ok: false, latencyMs: 0, error: "Streaming test is not supported for embedding models", status: null, skipped: true },
        });
      }
      return NextResponse.json(result);
    }

    if (normalizedMode === NON_STREAM_MODE) {
      return NextResponse.json(await runNonStreamChatTest(baseUrl, headers, model, start));
    }

    if (normalizedMode === STREAM_MODE) {
      return NextResponse.json(await runStreamChatTest(baseUrl, headers, model, start));
    }

    const nonStream = await runNonStreamChatTest(baseUrl, headers, model, start);
    const stream = await runStreamChatTest(baseUrl, headers, model, Date.now());

    return NextResponse.json({ nonStream, stream });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
