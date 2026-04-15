export const NON_STREAM_MODE = "non-stream";
export const STREAM_MODE = "stream";
export const DUAL_MODE = "dual";

export function normalizeMode(mode, kind) {
  if (kind === "embedding") return NON_STREAM_MODE;
  if (mode === "non_stream") return NON_STREAM_MODE;
  if (mode === NON_STREAM_MODE || mode === STREAM_MODE || mode === DUAL_MODE) return mode;
  return DUAL_MODE;
}
