import PropTypes from "prop-types";

export default function ModelRow({ model, fullModel, alias, copied, onCopy, testStatus, isCustom, isFree, onDeleteAlias, onTest, isTesting, isDisabled, onDisable, onEnable, isToggling }) {
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
    <div className={`group px-3 py-2 rounded-lg border ${borderColor} hover:bg-sidebar/50 ${isDisabled ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-2">
        <span
          className={`material-symbols-outlined text-base ${isDisabled ? "text-text-muted" : ""}`}
          style={iconColor ? { color: iconColor } : undefined}
        >
          {isDisabled ? "block" : testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
        </span>
        <div className="flex flex-col gap-1">
          <code className={`text-xs font-mono bg-sidebar px-1.5 py-0.5 rounded ${isDisabled ? "text-text-muted line-through" : "text-text-muted"}`}>{fullModel}</code>
          {model.name && <span className="text-[9px] text-text-muted/70 italic pl-1">{model.name}</span>}
          {isDisabled && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-black/5 dark:bg-white/10 text-text-muted w-fit">
              disabled
            </span>
          )}
        </div>
        {!isDisabled && onTest && (
          <div className="relative group/btn">
            <button
              onClick={onTest}
              disabled={isTesting}
              className={`p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary transition-opacity ${isTesting ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
            >
              <span className="material-symbols-outlined text-sm" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                {isTesting ? "progress_activity" : "science"}
              </span>
            </button>
            <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {isTesting ? "Testing..." : "Test"}
            </span>
          </div>
        )}
        <div className="relative group/btn">
          <button
            onClick={() => onCopy(fullModel, `model-${model.id}`)}
            className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <span className="material-symbols-outlined text-sm">
              {copied === `model-${model.id}` ? "check" : "content_copy"}
            </span>
          </button>
          <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
            {copied === `model-${model.id}` ? "Copied!" : "Copy"}
          </span>
        </div>
        {(onDisable || onEnable) && (
          <div className="relative group/btn ml-auto">
            <button
              onClick={isDisabled ? onEnable : onDisable}
              disabled={isToggling}
              className={`p-0.5 rounded transition-opacity ${isToggling ? "opacity-50 cursor-not-allowed" : "opacity-0 group-hover:opacity-100"} ${isDisabled ? "hover:bg-green-500/10 text-text-muted hover:text-green-600" : "hover:bg-orange-500/10 text-text-muted hover:text-orange-600"}`}
              title={isDisabled ? "Enable model" : "Disable model"}
            >
              <span className="material-symbols-outlined text-sm">
                {isToggling ? "progress_activity" : isDisabled ? "check_circle" : "block"}
              </span>
            </button>
            <span className="pointer-events-none absolute mt-1 top-5 right-0 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {isDisabled ? "Enable" : "Disable"}
            </span>
          </div>
        )}
        {isCustom && !isDisabled && (
          <button
            onClick={onDeleteAlias}
            className="p-0.5 hover:bg-red-500/10 rounded text-text-muted hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Remove custom model"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        )}
      </div>
    </div>
  );
}

ModelRow.propTypes = {
  model: PropTypes.shape({
    id: PropTypes.string.isRequired,
  }).isRequired,
  fullModel: PropTypes.string.isRequired,
  alias: PropTypes.string,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  testStatus: PropTypes.oneOf(["ok", "error"]),
  isCustom: PropTypes.bool,
  isFree: PropTypes.bool,
  onDeleteAlias: PropTypes.func,
  onTest: PropTypes.func,
  isTesting: PropTypes.bool,
  isDisabled: PropTypes.bool,
  onDisable: PropTypes.func,
  onEnable: PropTypes.func,
  isToggling: PropTypes.bool,
};
