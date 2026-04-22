import { normalizeSoftErrorPhrases } from "./settings";

const STREAM_HOLDBACK_FLOOR_CHARS = 256;

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.toLowerCase();
}

function getMessageContent(message) {
  if (!message || typeof message !== "object") return "";
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return "";
  return typeof message.content === "string" ? message.content : "";
}

export function getSoftErrorHoldbackChars(phrases = []) {
  const normalizedPhrases = normalizeSoftErrorPhrases(phrases);
  const maxPhraseLength = normalizedPhrases.reduce((max, phrase) => Math.max(max, phrase.length), 0);
  return Math.max(STREAM_HOLDBACK_FLOOR_CHARS, maxPhraseLength * 2);
}

export function getSoftErrorVisibleTextContext(response) {
  if (!response || typeof response !== "object") {
    return { eligible: false, text: "", reason: "missing_response" };
  }

  if (Array.isArray(response.output)) {
    const messages = response.output.filter((item) => item?.type === "message");
    if (messages.length === 0) {
      return { eligible: false, text: "", reason: "no_message_output" };
    }

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const item = messages[index];
      if (!Array.isArray(item?.content)) continue;
      const outputTextBlock = item.content.find((part) => part?.type === "output_text" && typeof part.text === "string");
      if (outputTextBlock?.text) {
        return { eligible: true, text: outputTextBlock.text, reason: "responses_output_text" };
      }
      const anyTextBlock = item.content.find((part) => typeof part?.text === "string" && part.text.length > 0);
      if (anyTextBlock?.text) {
        return { eligible: true, text: anyTextBlock.text, reason: "responses_text" };
      }
    }

    return { eligible: false, text: "", reason: "responses_without_visible_text" };
  }

  if (Array.isArray(response.choices)) {
    const firstChoice = response.choices[0];
    const visibleText = getMessageContent(firstChoice?.message);
    if (visibleText) {
      return { eligible: true, text: visibleText, reason: "chat_completion_message" };
    }

    return { eligible: false, text: "", reason: "chat_completion_without_visible_text" };
  }

  if (typeof response.content === "string") {
    return { eligible: true, text: response.content, reason: "top_level_content" };
  }

  return { eligible: false, text: "", reason: "unsupported_shape" };
}

export function findSoftErrorPhraseMatch(text, phrases = []) {
  if (typeof text !== "string" || text.length === 0) {
    return { matched: false, phrase: null, normalizedPhrase: null };
  }

  const normalizedText = normalizeText(text);
  const normalizedPhrases = normalizeSoftErrorPhrases(phrases);

  for (const phrase of normalizedPhrases) {
    const normalizedPhrase = normalizeText(phrase);
    if (normalizedPhrase && normalizedText.includes(normalizedPhrase)) {
      return {
        matched: true,
        phrase,
        normalizedPhrase,
      };
    }
  }

  return { matched: false, phrase: null, normalizedPhrase: null };
}

export function createSoftErrorGuardState(phrases = []) {
  return {
    holdbackChars: getSoftErrorHoldbackChars(phrases),
    visibleText: "",
    flushedChars: 0,
  };
}

export function recordSoftErrorVisibleText(state, textChunk = "") {
  if (!state || typeof state !== "object") return state;
  if (typeof textChunk !== "string" || textChunk.length === 0) return state;
  state.visibleText += textChunk;
  return state;
}

export function splitSoftErrorContentForFlush(state, textChunk = "") {
  if (!state || typeof state !== "object") {
    return { emit: typeof textChunk === "string" ? textChunk : "", holdback: "" };
  }

  const safeText = typeof textChunk === "string" ? textChunk : "";
  if (!safeText) return { emit: "", holdback: "" };

  const previousLength = state.visibleText.length - safeText.length;
  const flushUntil = Math.max(0, state.visibleText.length - state.holdbackChars);
  const emitStart = Math.max(previousLength, state.flushedChars);
  const emitEnd = Math.max(emitStart, Math.min(state.visibleText.length, flushUntil));
  const emitCount = Math.max(0, emitEnd - emitStart);

  const emit = safeText.slice(0, emitCount);
  const holdback = safeText.slice(emitCount);
  state.flushedChars = emitEnd;
  return { emit, holdback };
}

export function getSoftErrorTailText(state) {
  if (!state || typeof state !== "object") return "";
  return state.visibleText.slice(state.flushedChars);
}
