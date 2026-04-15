import { getDisabledModels, normalizeDisabledModels } from "./state";

export function disableProviderModel(source, modelId) {
  const nextModelId = typeof modelId === "string" ? modelId.trim() : "";
  if (!nextModelId) return getDisabledModels(source);
  return normalizeDisabledModels([...getDisabledModels(source), nextModelId]);
}

export function enableProviderModel(source, modelId) {
  const nextModelId = typeof modelId === "string" ? modelId.trim() : "";
  if (!nextModelId) return getDisabledModels(source);
  return getDisabledModels(source).filter((disabledModelId) => disabledModelId !== nextModelId);
}

export function applyDisabledModelsToConnections(connections = [], disabledModels = []) {
  const normalizedDisabledModels = normalizeDisabledModels(disabledModels);
  return connections.map((connection) => ({
    ...connection,
    providerSpecificData: {
      ...(connection.providerSpecificData || {}),
      disabledModels: normalizedDisabledModels,
    },
  }));
}
