"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button } from "@/shared/components";

function PassthroughModelRow({ modelId, fullModel, copied, onCopy, onDeleteAlias, onTest, testStatus, isTesting, isDisabled, onDisable, onEnable, isToggling }) {
  const borderColor = isDisabled
    ? "border-black/[0.06] dark:border-white/[0.06]"
    : testStatus === "ok"
    ? "border-green-500/40"
    : testStatus === "error"
    ? "border-red-500/40"
    : "border-border";

  const iconColor = isDisabled
    ? undefined
    : testStatus === "ok"
    ? "#22c55e"
    : testStatus === "error"
    ? "#ef4444"
    : undefined;

  return (
    <div className={`group flex items-center gap-3 p-3 rounded-lg border ${borderColor} hover:bg-sidebar/50 ${isDisabled ? "opacity-50" : ""}`}>
      <span
        className={`material-symbols-outlined text-base ${isDisabled ? "text-text-muted" : "text-text-muted"}`}
        style={iconColor ? { color: iconColor } : undefined}
      >
        {isDisabled ? "block" : testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
      </span>

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${isDisabled ? "line-through text-text-muted" : ""}`}>{modelId}</p>

        <div className="flex items-center gap-1 mt-1 flex-wrap">
        <code className="text-xs text-text-muted font-mono bg-sidebar px-1.5 py-0.5 rounded">{fullModel}</code>
          {isDisabled && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-black/5 dark:bg-white/10 text-text-muted">
              disabled
            </span>
          )}
          <div className="relative group/btn">
            <button
              onClick={() => onCopy(fullModel, `model-${modelId}`)}
              className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary"
            >
              <span className="material-symbols-outlined text-sm">
                {copied === `model-${modelId}` ? "check" : "content_copy"}
              </span>
            </button>
            <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {copied === `model-${modelId}` ? "Copied!" : "Copy"}
            </span>
          </div>
          {!isDisabled && onTest && (
            <div className="relative group/btn">
              <button
                onClick={onTest}
                disabled={isTesting}
                className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary transition-colors"
              >
                <span className="material-symbols-outlined text-sm" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                  {isTesting ? "progress_activity" : "science"}
                </span>
              </button>
              <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
                {isTesting ? "Testing..." : "Test"}
              </span>
            </div>
          )}
        </div>
      </div>

      {(onDisable || onEnable) && (
        <div className="relative group/btn">
          <button
            onClick={isDisabled ? onEnable : onDisable}
            disabled={isToggling}
            className={`p-1 rounded transition-opacity ${isToggling ? "opacity-50 cursor-not-allowed" : "opacity-0 group-hover:opacity-100"} ${isDisabled ? "hover:bg-green-500/10 text-text-muted hover:text-green-600" : "hover:bg-orange-500/10 text-text-muted hover:text-orange-600"}`}
            title={isDisabled ? "Enable model" : "Disable model"}
          >
            <span className="material-symbols-outlined text-sm">
              {isToggling ? "progress_activity" : isDisabled ? "check_circle" : "block"}
            </span>
          </button>
          <span className="pointer-events-none absolute top-7 right-0 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
            {isDisabled ? "Enable" : "Disable"}
          </span>
        </div>
      )}

      {!isDisabled && (
        <button
          onClick={onDeleteAlias}
          className="p-1 hover:bg-red-50 dark:hover:bg-red-500/10 rounded text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Remove model"
        >
          <span className="material-symbols-outlined text-sm">delete</span>
        </button>
      )}
    </div>
  );
}

PassthroughModelRow.propTypes = {
  modelId: PropTypes.string.isRequired,
  fullModel: PropTypes.string.isRequired,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
  onTest: PropTypes.func,
  testStatus: PropTypes.oneOf(["ok", "error"]),
  isTesting: PropTypes.bool,
  isDisabled: PropTypes.bool,
  onDisable: PropTypes.func,
  onEnable: PropTypes.func,
  isToggling: PropTypes.bool,
};

export default function PassthroughModelsSection({ providerAlias, modelAliases, copied, onCopy, onSetAlias, onDeleteAlias, disabledModels, onDisableModel, onEnableModel, togglingModelId }) {
  const [newModel, setNewModel] = useState("");
  const [adding, setAdding] = useState(false);

  // Filter aliases for this provider - models are persisted via alias
  const providerAliases = Object.entries(modelAliases).filter(
    ([, model]) => model.startsWith(`${providerAlias}/`)
  );

  const allModels = providerAliases.map(([alias, fullModel]) => ({
    modelId: fullModel.replace(`${providerAlias}/`, ""),
    fullModel,
    alias,
  }));

  // Generate default alias from modelId (last part after /)
  const generateDefaultAlias = (modelId) => {
    const parts = modelId.split("/");
    return parts[parts.length - 1];
  };

  const handleAdd = async () => {
    if (!newModel.trim() || adding) return;
    const modelId = newModel.trim();
    const defaultAlias = generateDefaultAlias(modelId);
    
    // Check if alias already exists
    if (modelAliases[defaultAlias]) {
      alert(`Alias "${defaultAlias}" already exists. Please use a different model or edit existing alias.`);
      return;
    }
    
    setAdding(true);
    try {
      await onSetAlias(modelId, defaultAlias);
      setNewModel("");
    } catch (error) {
      console.log("Error adding model:", error);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        OpenRouter supports any model. Add models and create aliases for quick access.
      </p>

      {/* Add new model */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor="new-model-input" className="text-xs text-text-muted mb-1 block">Model ID (from OpenRouter)</label>
          <input
            id="new-model-input"
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="anthropic/claude-3-opus"
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
          />
        </div>
        <Button size="sm" icon="add" onClick={handleAdd} disabled={!newModel.trim() || adding}>
          {adding ? "Adding..." : "Add"}
        </Button>
      </div>

      {/* Models list */}
      {allModels.length > 0 && (
        <div className="flex flex-col gap-3">
          {allModels.map(({ modelId, fullModel, alias }) => (
            <PassthroughModelRow
              key={fullModel}
              modelId={modelId}
              fullModel={fullModel}
              copied={copied}
              onCopy={onCopy}
              onDeleteAlias={() => onDeleteAlias(alias)}
              isDisabled={(disabledModels || []).includes(modelId)}
              onDisable={onDisableModel ? () => onDisableModel(modelId) : undefined}
              onEnable={onEnableModel ? () => onEnableModel(modelId) : undefined}
              isToggling={togglingModelId === modelId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

PassthroughModelsSection.propTypes = {
  providerAlias: PropTypes.string.isRequired,
  modelAliases: PropTypes.object.isRequired,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onSetAlias: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
  disabledModels: PropTypes.arrayOf(PropTypes.string),
  onDisableModel: PropTypes.func,
  onEnableModel: PropTypes.func,
  togglingModelId: PropTypes.string,
};
