import { translateResponse, initState } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { trackPendingRequest, appendRequestLog } from "@/lib/usageDb.js";
import { extractUsage, hasValidUsage, estimateUsage, logUsage, addBufferToUsage, filterUsageForFormat, COLORS } from "./usageTracking.js";
import { parseSSELine, hasValuableContent, fixInvalidId, formatSSE } from "./streamHelpers.js";
import {
  createSoftErrorGuardState,
  findSoftErrorPhraseMatch,
  getSoftErrorTailText,
  recordSoftErrorVisibleText,
  splitSoftErrorContentForFlush,
} from "@/fork/softErrorPhrase/detect";
import { SOFT_ERROR_PHRASE_STREAM_MARKER } from "@/fork/softErrorPhrase/error";
import { getSoftErrorPhraseSettings } from "@/fork/softErrorPhrase/settings";
import { getSettings } from "@/lib/localDb";

export { COLORS, formatSSE };

// sharedEncoder is stateless — safe to share across streams
const sharedEncoder = new TextEncoder();

/**
 * Stream modes
 */
const STREAM_MODE = {
  TRANSLATE: "translate",    // Full translation between formats
  PASSTHROUGH: "passthrough" // No translation, normalize output, extract usage
};

/**
 * Create unified SSE transform stream
 * @param {object} options
 * @param {string} options.mode - Stream mode: translate, passthrough
 * @param {string} options.targetFormat - Provider format (for translate mode)
 * @param {string} options.sourceFormat - Client format (for translate mode)
 * @param {string} options.provider - Provider name
 * @param {object} options.reqLogger - Request logger instance
 * @param {string} options.model - Model name
 * @param {string} options.connectionId - Connection ID for usage tracking
 * @param {object} options.body - Request body (for input token estimation)
 * @param {function} options.onStreamComplete - Callback when stream completes (content, usage)
 * @param {string} options.apiKey - API key for usage tracking
 */
export function createSSEStream(options = {}) {
  const {
    mode = STREAM_MODE.TRANSLATE,
    targetFormat,
    sourceFormat,
    provider = null,
    reqLogger = null,
    toolNameMap = null,
    model = null,
    connectionId = null,
    body = null,
    onStreamComplete = null,
    apiKey = null,
    onDeferredSuccess = null
  } = options;

  let buffer = "";
  let usage = null;

  // Per-stream decoder with stream:true to correctly handle multi-byte chars split across chunks
  const decoder = new TextDecoder("utf-8", { fatal: false });

  const state = mode === STREAM_MODE.TRANSLATE ? { ...initState(sourceFormat), provider, toolNameMap, model } : null;

  let totalContentLength = 0;
  let accumulatedContent = "";
  let accumulatedThinking = "";
  let ttftAt = null;
  let successFired = false;
  let softErrorPhrases = [];
  let guardState = null;

  const ensureSoftErrorGuard = async () => {
    if (guardState) return;
    const settings = await getSettings();
    softErrorPhrases = getSoftErrorPhraseSettings(settings).softErrorPhrases;
    guardState = createSoftErrorGuardState(softErrorPhrases);
  };

  const markDeferredSuccess = () => {
    if (!successFired && typeof onDeferredSuccess === "function") {
      successFired = true;
      onDeferredSuccess();
    }
  };

  const emitOutput = (controller, output) => {
    reqLogger?.appendConvertedChunk?.(output);
    controller.enqueue(sharedEncoder.encode(output));
  };

  /**
   * Extract assistant-visible text from a translated chunk for soft-error detection.
   * Works across OpenAI, Claude, and Antigravity output formats.
   */
  const extractVisibleTextFromItem = (item) => {
    // OpenAI chat.completions format
    if (item?.choices?.[0]?.delta?.content) {
      return item.choices[0].delta.content;
    }
    // Claude format: content_block_delta with text_delta
    if (item?.type === "content_block_delta" && item?.delta?.type === "text_delta" && typeof item.delta.text === "string") {
      return item.delta.text;
    }
    // Antigravity format: { response: { candidates: [{ content: { parts: [{ text }] }] }] } }
    if (item?.response?.candidates?.[0]?.content?.parts) {
      const parts = item.response.candidates[0].content.parts;
      for (const part of parts) {
        if (typeof part?.text === "string" && !part.thought) {
          return part.text;
        }
      }
    }
    return "";
  };

  /**
   * Rebuild a translated chunk with replaced assistant-visible text.
   * Preserves all other structure and fields. Returns a new object.
   */
  const rebuildItemWithText = (item, newText, format) => {
    // OpenAI chat.completions format
    if (format === FORMATS.OPENAI && item?.choices?.[0]?.delta) {
      return {
        ...item,
        choices: item.choices.map((choice, index) => index === 0
          ? { ...choice, delta: { ...choice.delta, content: newText } }
          : choice),
      };
    }
    // Claude format: content_block_delta with text_delta
    if (format === FORMATS.CLAUDE && item?.type === "content_block_delta" && item?.delta?.type === "text_delta") {
      return {
        ...item,
        delta: { ...item.delta, text: newText },
      };
    }
    // Antigravity format
    if ((format === FORMATS.ANTIGRAVITY || format === FORMATS.GEMINI || format === FORMATS.GEMINI_CLI || format === FORMATS.VERTEX) && item?.response?.candidates?.[0]?.content?.parts) {
      const newParts = item.response.candidates[0].content.parts.map((part) => {
        if (typeof part?.text === "string" && !part.thought) {
          return { ...part, text: newText };
        }
        return part;
      });
      return {
        ...item,
        response: {
          ...item.response,
          candidates: [{
            ...item.response.candidates[0],
            content: {
              ...item.response.candidates[0].content,
              parts: newParts,
            },
          }],
        },
      };
    }
    // Fallback: return as-is if we don't recognize the structure
    return item;
  };

  const emitTranslatedTextChunk = async (controller, item, textChunk) => {
    await ensureSoftErrorGuard();
    recordSoftErrorVisibleText(guardState, textChunk);

    const match = findSoftErrorPhraseMatch(guardState.visibleText, softErrorPhrases);
    if (match.matched) {
      throw new Error(`${SOFT_ERROR_PHRASE_STREAM_MARKER}:${match.phrase}`);
    }

    const { emit } = splitSoftErrorContentForFlush(guardState, textChunk);
    if (!emit) return;

    const nextItem = rebuildItemWithText(item, emit, sourceFormat);
    emitOutput(controller, formatSSE(nextItem, sourceFormat));
    markDeferredSuccess();
  };

  return new TransformStream({
    async transform(chunk, controller) {
      if (!ttftAt) {
        ttftAt = Date.now();
      }
      const text = decoder.decode(chunk, { stream: true });
      buffer += text;
      reqLogger?.appendProviderChunk?.(text);

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();

        // Passthrough mode: normalize and forward
        if (mode === STREAM_MODE.PASSTHROUGH) {
          let output;
          let injectedUsage = false;

          if (trimmed.startsWith("data:") && trimmed.slice(5).trim() !== "[DONE]") {
            try {
              const parsed = JSON.parse(trimmed.slice(5).trim());

              const idFixed = fixInvalidId(parsed);

              // Ensure OpenAI-required fields are present on streaming chunks (Letta compat)
              let fieldsInjected = false;
              if (parsed.choices !== undefined) {
                if (!parsed.object) { parsed.object = "chat.completion.chunk"; fieldsInjected = true; }
                if (!parsed.created) { parsed.created = Math.floor(Date.now() / 1000); fieldsInjected = true; }
              }

              // Strip Azure-specific non-standard fields from streaming chunks
              if (parsed.prompt_filter_results !== undefined) {
                delete parsed.prompt_filter_results;
                fieldsInjected = true;
              }
              if (parsed?.choices) {
                for (const choice of parsed.choices) {
                  if (choice.content_filter_results !== undefined) {
                    delete choice.content_filter_results;
                    fieldsInjected = true;
                  }
                }
              }

              if (!hasValuableContent(parsed, FORMATS.OPENAI)) {
                continue;
              }

              const delta = parsed.choices?.[0]?.delta;
              const content = delta?.content;
              const reasoning = delta?.reasoning_content;
              if (content && typeof content === "string") {
                totalContentLength += content.length;
                accumulatedContent += content;
              }
              if (reasoning && typeof reasoning === "string") {
                totalContentLength += reasoning.length;
                accumulatedThinking += reasoning;
              }

              // Soft-error detection for passthrough mode (after accumulation, no holdback)
              if (accumulatedContent) {
                await ensureSoftErrorGuard();
                recordSoftErrorVisibleText(guardState, content || "");
                const match = findSoftErrorPhraseMatch(guardState.visibleText, softErrorPhrases);
                if (match.matched) {
                  throw new Error(`${SOFT_ERROR_PHRASE_STREAM_MARKER}:${match.phrase}`);
                }
              }

              const extracted = extractUsage(parsed);
              if (extracted) {
                usage = extracted;
              }

              const isFinishChunk = parsed.choices?.[0]?.finish_reason;
              if (isFinishChunk && !hasValidUsage(parsed.usage)) {
                const estimated = estimateUsage(body, totalContentLength, FORMATS.OPENAI);
                parsed.usage = filterUsageForFormat(estimated, FORMATS.OPENAI);
                output = `data: ${JSON.stringify(parsed)}\n`;
                usage = estimated;
                injectedUsage = true;
              } else if (isFinishChunk && usage) {
                const buffered = addBufferToUsage(usage);
                parsed.usage = filterUsageForFormat(buffered, FORMATS.OPENAI);
                output = `data: ${JSON.stringify(parsed)}\n`;
                injectedUsage = true;
              } else if (idFixed || fieldsInjected) {
                output = `data: ${JSON.stringify(parsed)}\n`;
                injectedUsage = true;
              }
            } catch { }
          }

          if (!injectedUsage) {
            if (line.startsWith("data:") && !line.startsWith("data: ")) {
              output = "data: " + line.slice(5) + "\n";
            } else {
              output = line + "\n";
            }
          }

          emitOutput(controller, output);
          // Do NOT mark success here - wait until flush completes without soft-error
          continue;
        }

        // Translate mode
        if (!trimmed) continue;

        await ensureSoftErrorGuard();

        const parsed = parseSSELine(trimmed, targetFormat);
        if (!parsed) continue;

        // For Ollama: done=true is the final chunk with finish_reason/usage, must translate
        // For other formats: done=true is the [DONE] sentinel, skip
        if (parsed && parsed.done && targetFormat !== FORMATS.OLLAMA) {
          const output = "data: [DONE]\n\n";
          emitOutput(controller, output);
          continue;
        }

        // Claude format - content
        if (parsed.delta?.text) {
          totalContentLength += parsed.delta.text.length;
          accumulatedContent += parsed.delta.text;
        }
        // Claude format - thinking
        if (parsed.delta?.thinking) {
          totalContentLength += parsed.delta.thinking.length;
          accumulatedThinking += parsed.delta.thinking;
        }
        
        // OpenAI format - content
        if (parsed.choices?.[0]?.delta?.content) {
          totalContentLength += parsed.choices[0].delta.content.length;
          accumulatedContent += parsed.choices[0].delta.content;
        }
        // OpenAI format - reasoning
        if (parsed.choices?.[0]?.delta?.reasoning_content) {
          totalContentLength += parsed.choices[0].delta.reasoning_content.length;
          accumulatedThinking += parsed.choices[0].delta.reasoning_content;
        }
        
        // Gemini format
        if (parsed.candidates?.[0]?.content?.parts) {
          for (const part of parsed.candidates[0].content.parts) {
            if (part.text && typeof part.text === "string") {
              totalContentLength += part.text.length;
              // Check if this is thinking content
              if (part.thought === true) {
                accumulatedThinking += part.text;
              } else {
                accumulatedContent += part.text;
              }
            }
          }
        }

        // Extract usage
        const extracted = extractUsage(parsed);
        if (extracted) state.usage = extracted; // Keep original usage for logging

        // Translate: targetFormat -> openai -> sourceFormat
        const translated = translateResponse(targetFormat, sourceFormat, parsed, state);

        // Log OpenAI intermediate chunks (if available)
        if (translated?._openaiIntermediate) {
          for (const item of translated._openaiIntermediate) {
            const openaiOutput = formatSSE(item, FORMATS.OPENAI);
            reqLogger?.appendOpenAIChunk?.(openaiOutput);
          }
        }

        if (translated?.length > 0) {
          for (const item of translated) {
            // Filter empty chunks
            if (!hasValuableContent(item, sourceFormat)) {
              continue; // Skip this empty chunk
            }

            // Inject estimated usage if finish chunk has no valid usage
            const isFinishChunk = item.type === "message_delta" || item.choices?.[0]?.finish_reason;
            if (state.finishReason && isFinishChunk && !hasValidUsage(item.usage) && totalContentLength > 0) {
              const estimated = estimateUsage(body, totalContentLength, sourceFormat);
              item.usage = filterUsageForFormat(estimated, sourceFormat); // Filter + already has buffer
              state.usage = estimated;
            } else if (state.finishReason && isFinishChunk && state.usage) {
              // Add buffer and filter usage for client (but keep original in state.usage for logging)
              const buffered = addBufferToUsage(state.usage);
              item.usage = filterUsageForFormat(buffered, sourceFormat);
            }

            const visibleTextChunk = extractVisibleTextFromItem(item);
            if (visibleTextChunk) {
              await emitTranslatedTextChunk(controller, item, visibleTextChunk);
            } else {
              emitOutput(controller, formatSSE(item, sourceFormat));
            }
          }
        }
      }
    },

    async flush(controller) {
      trackPendingRequest(model, provider, connectionId, false);
      try {
        const remaining = decoder.decode();
        if (remaining) buffer += remaining;

        if (mode === STREAM_MODE.PASSTHROUGH) {
          if (buffer) {
            let output = buffer;
            if (buffer.startsWith("data:") && !buffer.startsWith("data: ")) {
              output = "data: " + buffer.slice(5);
            }
            emitOutput(controller, output);
          }

          if (!hasValidUsage(usage) && totalContentLength > 0) {
            usage = estimateUsage(body, totalContentLength, FORMATS.OPENAI);
          }

          if (hasValidUsage(usage)) {
            logUsage(provider, usage, model, connectionId, apiKey);
          } else {
            appendRequestLog({ model, provider, connectionId, tokens: null, status: "200 OK" }).catch(() => { });
          }
          
          // IMPORTANT: In passthrough mode we still must terminate the SSE stream.
          // Some clients (e.g. OpenClaw) expect the OpenAI-style sentinel:
          //   data: [DONE]\n\n
          // Without it they can hang until timeout and trigger failover.
          const doneOutput = "data: [DONE]\n\n";
          reqLogger?.appendConvertedChunk?.(doneOutput);
          controller.enqueue(sharedEncoder.encode(doneOutput));

          // Mark success only after stream completes without soft-error
          markDeferredSuccess();

          if (onStreamComplete) {
            onStreamComplete({
              content: accumulatedContent,
              thinking: accumulatedThinking
            }, usage, ttftAt);
          }
          return;
        }

        if (buffer.trim()) {
          const parsed = parseSSELine(buffer.trim());
          if (parsed && !parsed.done) {
            const translated = translateResponse(targetFormat, sourceFormat, parsed, state);

            if (translated?._openaiIntermediate) {
              for (const item of translated._openaiIntermediate) {
                const openaiOutput = formatSSE(item, FORMATS.OPENAI);
                reqLogger?.appendOpenAIChunk?.(openaiOutput);
              }
            }

            if (translated?.length > 0) {
              for (const item of translated) {
                const visibleTextChunk = extractVisibleTextFromItem(item);
                if (visibleTextChunk) {
                  await emitTranslatedTextChunk(controller, item, visibleTextChunk);
                } else {
                  emitOutput(controller, formatSSE(item, sourceFormat));
                }
              }
            }
          }
        }

        const flushed = translateResponse(targetFormat, sourceFormat, null, state);

        if (flushed?._openaiIntermediate) {
          for (const item of flushed._openaiIntermediate) {
            const openaiOutput = formatSSE(item, FORMATS.OPENAI);
            reqLogger?.appendOpenAIChunk?.(openaiOutput);
          }
        }

        if (flushed?.length > 0) {
          for (const item of flushed) {
            const visibleTextChunk = extractVisibleTextFromItem(item);
            if (visibleTextChunk) {
              await emitTranslatedTextChunk(controller, item, visibleTextChunk);
            } else {
              emitOutput(controller, formatSSE(item, sourceFormat));
            }
          }
        }

        const heldTail = getSoftErrorTailText(guardState);
        if (heldTail) {
          // Build format-appropriate tail chunk for the held text
          let tailItem;
          if (sourceFormat === FORMATS.CLAUDE) {
            tailItem = {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: heldTail }
            };
          } else if (sourceFormat === FORMATS.ANTIGRAVITY || sourceFormat === FORMATS.GEMINI || sourceFormat === FORMATS.GEMINI_CLI || sourceFormat === FORMATS.VERTEX) {
            tailItem = {
              response: {
                candidates: [{
                  content: { role: "model", parts: [{ text: heldTail }] }
                }]
              }
            };
          } else {
            // OpenAI and other formats: use OpenAI chunk shape
            tailItem = {
              id: `chatcmpl-${Date.now()}`,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [{ index: 0, delta: { content: heldTail } }],
            };
          }
          emitOutput(controller, formatSSE(tailItem, sourceFormat));
          markDeferredSuccess();
        }

        const doneOutput = "data: [DONE]\n\n";
        emitOutput(controller, doneOutput);

        if (!hasValidUsage(state?.usage) && totalContentLength > 0) {
          state.usage = estimateUsage(body, totalContentLength, sourceFormat);
        }

        if (hasValidUsage(state?.usage)) {
          logUsage(state.provider || targetFormat, state.usage, model, connectionId, apiKey);
        } else {
          appendRequestLog({ model, provider, connectionId, tokens: null, status: "200 OK" }).catch(() => { });
        }
        
        if (onStreamComplete) {
          onStreamComplete({
            content: accumulatedContent,
            thinking: accumulatedThinking
          }, state?.usage, ttftAt);
        }
      } catch (error) {
        if (String(error?.message || "").startsWith(`${SOFT_ERROR_PHRASE_STREAM_MARKER}:`)) {
          controller.error(error);
          return;
        }
        console.log("Error in flush:", error);
      }
    }
  });
}

export function createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider = null, reqLogger = null, toolNameMap = null, model = null, connectionId = null, body = null, onStreamComplete = null, apiKey = null, onDeferredSuccess = null) {
  return createSSEStream({
    mode: STREAM_MODE.TRANSLATE,
    targetFormat,
    sourceFormat,
    provider,
    reqLogger,
    toolNameMap,
    model,
    connectionId,
    body,
    onStreamComplete,
    apiKey,
    onDeferredSuccess
  });
}

export function createPassthroughStreamWithLogger(provider = null, reqLogger = null, model = null, connectionId = null, body = null, onStreamComplete = null, apiKey = null, onDeferredSuccess = null) {
  return createSSEStream({
    mode: STREAM_MODE.PASSTHROUGH,
    provider,
    reqLogger,
    model,
    connectionId,
    body,
    onStreamComplete,
    apiKey,
    onDeferredSuccess
  });
}
