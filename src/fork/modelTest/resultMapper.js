export function mapDualModeTestResult(result) {
  if (!result) return undefined;

  if (result.nonStream !== undefined || result.stream !== undefined) {
    return {
      nonStream: result.nonStream?.ok ? "ok" : "error",
      stream: result.stream?.ok ? "ok" : "error",
    };
  }

  return {
    nonStream: result.ok ? "ok" : "error",
    stream: "error",
  };
}

export function getDualModeTestError(result) {
  if (!result) return "";
  return result.nonStream?.error || result.stream?.error || result.error || "";
}

export function hasAnyPassingTest(result) {
  if (!result) return false;
  if (result.nonStream !== undefined || result.stream !== undefined) {
    return Boolean(result.nonStream?.ok || result.stream?.ok);
  }
  return Boolean(result.ok);
}
