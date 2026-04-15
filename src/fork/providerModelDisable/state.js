export function normalizeDisabledModels(disabledModels = []) {
  return [...new Set(
    (Array.isArray(disabledModels) ? disabledModels : [])
      .filter((modelId) => typeof modelId === "string")
      .map((modelId) => modelId.trim())
      .filter(Boolean)
  )];
}

export function getDisabledModels(source) {
  if (Array.isArray(source)) {
    return getDisabledModels(source[0]);
  }

  return normalizeDisabledModels(source?.providerSpecificData?.disabledModels);
}

export function createDisabledModelsSet(source) {
  return new Set(getDisabledModels(source));
}

export function isModelDisabled(source, modelId) {
  if (typeof modelId !== "string" || !modelId.trim()) return false;
  return createDisabledModelsSet(source).has(modelId.trim());
}

export function filterDisabledModels(source, modelIds = []) {
  const disabledModels = createDisabledModelsSet(source);
  return modelIds.filter((modelId) => typeof modelId === "string" && modelId.trim() !== "" && !disabledModels.has(modelId));
}
