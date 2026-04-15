import {
  TTFT_TIMEOUT_ERROR,
  TTFT_TIMEOUT_LOG_STATUS,
  TTFT_TIMEOUT_MESSAGE,
} from "./error";

export function buildTtftTimeoutLogEntry({ model, provider, connectionId }) {
  return { model, provider, connectionId, status: TTFT_TIMEOUT_LOG_STATUS };
}

export function buildTtftTimeoutDetailBase({
  provider,
  model,
  connectionId,
  elapsedMs,
  requestConfig,
  providerRequest,
}) {
  return {
    provider,
    model,
    connectionId,
    latency: { ttft: elapsedMs, total: elapsedMs },
    tokens: { prompt_tokens: 0, completion_tokens: 0 },
    request: requestConfig,
    providerRequest: providerRequest || null,
    response: { error: TTFT_TIMEOUT_ERROR, message: TTFT_TIMEOUT_MESSAGE, thinking: null },
    status: "error",
  };
}

export async function raceTtftDeadline(providerResponse, ttftTimeoutMs, streamController) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      streamController.abort();
      resolve({ timedOut: true });
    }, ttftTimeoutMs);

    const reader = providerResponse.body.getReader();
    reader.read().then(({ value, done }) => {
      clearTimeout(timer);
      const newBody = new ReadableStream({
        start(controller) {
          if (!done && value) controller.enqueue(value);
          if (done) { controller.close(); return; }
        },
        async pull(controller) {
          const { value: chunk, done: isDone } = await reader.read();
          if (isDone) { controller.close(); return; }
          controller.enqueue(chunk);
        },
        cancel() { reader.cancel(); }
      });
      resolve({
        timedOut: false,
        response: new Response(newBody, {
          status: providerResponse.status,
          statusText: providerResponse.statusText,
          headers: providerResponse.headers,
        }),
      });
    }).catch(() => {
      clearTimeout(timer);
      resolve({ timedOut: true });
    });
  });
}
