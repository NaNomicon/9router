import { createModelTestStreamParser } from "./streamParser";

export async function runEmbeddingModelTest(baseUrl, headers, model, start) {
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

export async function runNonStreamChatModelTest(baseUrl, headers, model, start) {
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

export async function runStreamChatModelTest(baseUrl, headers, model, start) {
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
  const parser = createModelTestStreamParser();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.addChunk(decoder.decode(value, { stream: true }));
    if (parser.getState().streamError) break;
  }

  parser.addChunk(decoder.decode());
  parser.flush();

  const latencyMs = Date.now() - start;
  const { sawDone, sawChunk, sawContent, streamError } = parser.getState();

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
