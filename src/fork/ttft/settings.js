export const TTFT_SETTINGS_DEFAULTS = {
  ttftTimeoutMs: 0,
  ttftCooldownMs: 15000,
};

export function normalizeTtftTimeoutMs(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : TTFT_SETTINGS_DEFAULTS.ttftTimeoutMs;
}

export function normalizeTtftCooldownMs(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : TTFT_SETTINGS_DEFAULTS.ttftCooldownMs;
}

export function getTtftSettings(settings = {}) {
  return {
    ttftTimeoutMs: normalizeTtftTimeoutMs(settings?.ttftTimeoutMs),
    ttftCooldownMs: normalizeTtftCooldownMs(settings?.ttftCooldownMs),
  };
}
