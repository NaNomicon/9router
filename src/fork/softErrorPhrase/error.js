export const SOFT_ERROR_PHRASE_REASON_TAG = "soft_error_phrase";
export const SOFT_ERROR_PHRASE_ERROR_CODE = "soft_error_phrase_detected";
export const SOFT_ERROR_PHRASE_STREAM_MARKER = "soft_error_phrase_stream_triggered";

export function buildSoftErrorPhraseFailure(match, details = {}) {
  const phrase = match?.phrase || "unknown phrase";
  const provider = details?.provider || "unknown provider";

  return {
    reasonTag: SOFT_ERROR_PHRASE_REASON_TAG,
    errorCode: SOFT_ERROR_PHRASE_ERROR_CODE,
    matchedPhrase: phrase,
    message: `[${SOFT_ERROR_PHRASE_ERROR_CODE}] ${provider} response matched configured soft-error phrase: ${phrase}`,
  };
}

export function isSoftErrorPhraseFailure(errorText) {
  if (!errorText) return false;
  const normalized = typeof errorText === "string"
    ? errorText.toLowerCase()
    : JSON.stringify(errorText).toLowerCase();
  return normalized.includes(SOFT_ERROR_PHRASE_ERROR_CODE);
}

export function buildSoftErrorPhraseStreamError(match, details = {}) {
  const failure = buildSoftErrorPhraseFailure(match, details);
  return {
    ...failure,
    streamMarker: SOFT_ERROR_PHRASE_STREAM_MARKER,
  };
}
