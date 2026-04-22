import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({
    softErrorPhrases: [
      "An error occurred while processing your request",
      "Our servers are currently overloaded",
    ],
  })),
}));

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { saveRequestDetail } from "@/lib/usageDb.js";

function makeReqLogger() {
  return {
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
  };
}

function makeBaseArgs(overrides = {}) {
  return {
    providerResponse: new Response(JSON.stringify({
      id: "chatcmpl_test",
      object: "chat.completion",
      created: 1,
      model: "test-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "normal response" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
    provider: "codex",
    model: "gpt-5.4",
    sourceFormat: "openai",
    targetFormat: "openai",
    body: { model: "codex/gpt-5.4", messages: [{ role: "user", content: "hello" }], stream: false },
    stream: false,
    translatedBody: { model: "gpt-5.4", messages: [{ role: "user", content: "hello" }] },
    finalBody: null,
    requestStartTime: Date.now() - 25,
    connectionId: "conn_123",
    apiKey: "test-key",
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    onRequestSuccess: vi.fn(async () => {}),
    reqLogger: makeReqLogger(),
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    ...overrides,
  };
}

describe("soft error phrase non-stream integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("converts matching non-stream response into retryable failure before success bookkeeping", async () => {
    const args = makeBaseArgs({
      providerResponse: new Response(JSON.stringify({
        id: "chatcmpl_test",
        object: "chat.completion",
        created: 1,
        model: "test-model",
        choices: [{
          index: 0,
          message: { role: "assistant", content: "Error Our servers are currently overloaded. Please try again later." },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    });

    const result = await handleNonStreamingResponse(args);

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toContain("soft_error_phrase_detected");
    expect(args.onRequestSuccess).not.toHaveBeenCalled();
    expect(saveRequestDetail).toHaveBeenCalledWith(expect.objectContaining({
      status: "error",
      response: expect.objectContaining({
        error: expect.stringContaining("soft_error_phrase_detected"),
      }),
    }));
  });

  it("keeps normal non-stream response successful when no phrase matches", async () => {
    const args = makeBaseArgs();

    const result = await handleNonStreamingResponse(args);

    expect(result.success).toBe(true);
    expect(args.onRequestSuccess).toHaveBeenCalledTimes(1);
    expect(result.response).toBeInstanceOf(Response);
  });

  it("converts matching standard SSE-to-JSON response into retryable failure before success bookkeeping", async () => {
    const args = makeBaseArgs({
      provider: "openai",
      providerResponse: new Response(
        [
          "data: {\"id\":\"chatcmpl_1\",\"model\":\"gpt-5.4\",\"choices\":[{\"delta\":{\"content\":\"Error Our servers are currently overloaded. Please try again later.\"}}]}\n",
          "data: {\"choices\":[{\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":2,\"total_tokens\":3}}\n",
          "data: [DONE]\n",
        ].join(""),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      ),
      sourceFormat: "openai",
      targetFormat: "openai",
    });

    const result = await handleForcedSSEToJson(args);

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toContain("soft_error_phrase_detected");
    expect(args.onRequestSuccess).not.toHaveBeenCalled();
  });

  it("converts matching Responses SSE-to-JSON response into retryable failure before success bookkeeping", async () => {
    const args = makeBaseArgs({
      provider: "codex",
      sourceFormat: "openai-responses",
      targetFormat: "openai-responses",
      providerResponse: new Response(
        [
          "event: response.created\n" +
            "data: {\"response\":{\"id\":\"resp_1\",\"created_at\":1}}\n\n",
          "event: response.output_item.done\n" +
            "data: {\"output_index\":0,\"item\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"An error occurred while processing your request.\"}]}}\n\n",
          "event: response.completed\n" +
            "data: {\"response\":{\"usage\":{\"input_tokens\":1,\"output_tokens\":2,\"total_tokens\":3}}}\n\n",
          "event: done\n" +
            "data: [DONE]\n",
        ].join(""),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      ),
    });

    const result = await handleForcedSSEToJson(args);

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toContain("soft_error_phrase_detected");
    expect(args.onRequestSuccess).not.toHaveBeenCalled();
  });
});
