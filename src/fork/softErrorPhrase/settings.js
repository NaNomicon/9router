export const SOFT_ERROR_PHRASE_LIMITS = {
  maxPhrases: 50,
  maxPhraseLength: 200,
  maxTotalChars: 2000,
  minWarnLength: 8,
};

export const SOFT_ERROR_PHRASE_SETTINGS_DEFAULTS = {
  softErrorPhrases: [],
};

function normalizePhraseValue(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

export function normalizeSoftErrorPhrases(phrases = []) {
  const input = Array.isArray(phrases) ? phrases : [];
  const seen = new Set();
  const normalized = [];
  let totalChars = 0;

  for (const value of input) {
    const phrase = normalizePhraseValue(value);
    if (!phrase) continue;

    if (phrase.length > SOFT_ERROR_PHRASE_LIMITS.maxPhraseLength) {
      throw new Error(`softErrorPhrases entries must be <= ${SOFT_ERROR_PHRASE_LIMITS.maxPhraseLength} characters`);
    }

    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;

    if (normalized.length >= SOFT_ERROR_PHRASE_LIMITS.maxPhrases) {
      throw new Error(`softErrorPhrases cannot contain more than ${SOFT_ERROR_PHRASE_LIMITS.maxPhrases} phrases`);
    }

    if (totalChars + phrase.length > SOFT_ERROR_PHRASE_LIMITS.maxTotalChars) {
      throw new Error(`softErrorPhrases cannot exceed ${SOFT_ERROR_PHRASE_LIMITS.maxTotalChars} total characters`);
    }

    seen.add(key);
    normalized.push(phrase);
    totalChars += phrase.length;
  }

  return normalized;
}

export function getSoftErrorPhraseSettings(settings = {}) {
  return {
    softErrorPhrases: normalizeSoftErrorPhrases(settings?.softErrorPhrases),
  };
}
