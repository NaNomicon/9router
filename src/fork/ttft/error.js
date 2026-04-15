import { normalizeTtftCooldownMs } from "./settings";

export const TTFT_TIMEOUT_ERROR = "ttft_timeout";
export const TTFT_TIMEOUT_LOG_STATUS = "TTFT_TIMEOUT";
export const TTFT_TIMEOUT_MESSAGE = "Timed out before first token; fell back to the next account.";

export function isTtftTimeoutError(errorText) {
  if (!errorText) return false;
  const lowerError = typeof errorText === "string"
    ? errorText.toLowerCase()
    : JSON.stringify(errorText).toLowerCase();
  return lowerError.includes(TTFT_TIMEOUT_ERROR);
}

export function buildTtftFallbackResult(options = {}) {
  return {
    shouldFallback: true,
    cooldownMs: normalizeTtftCooldownMs(options?.ttftCooldownMs),
  };
}
