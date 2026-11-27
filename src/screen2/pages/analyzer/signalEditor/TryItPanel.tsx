import { isWaiting, type MathResult } from "../../../utils/analyzerMath";
import { formatMathNumber } from "../../../utils/analyzerSignalEval";
import { FIELD_CLASS } from "./mathUi";

/** The one editor formatter (same as tiles without Decimals): integers exact, never rounded to fewer digits. */
export function formatMathResult(r: MathResult | undefined | null): string {
  if (!r || !r.ok) return "";
  return r.value.kind === "number" ? formatMathNumber(r.value.value, undefined) : r.value.value;
}

function livePlaceholder(r: MathResult | undefined): string {
  if (!r) return "no value";
  return r.ok ? "" : r.error;
}

/** Preview only: nothing typed here is saved or sent to a device. */
export default function TryItPanel(props: {
  kind: "register" | "calculated";
  inputNames: string[];
  liveSources: { register?: MathResult; inputs: Record<string, MathResult> } | null;
  useLive: boolean;
  onUseLiveChange: (v: boolean) => void;
  manual: Record<string, string>;
  onManualChange: (key: string, v: string) => void;
  results: Record<string, MathResult>;
  /** When set, live values can't be used for this draft; shown under the checkbox. */
  liveBlockedReason?: string | null;
}) {
  const { kind, inputNames, liveSources, useLive, onUseLiveChange, manual, onManualChange, results, liveBlockedReason } = props;
  const keys = kind === "register" ? ["register"] : inputNames;
  const liveFor = (key: string) => (key === "register" ? liveSources?.register : liveSources?.inputs[key]);

  return (
    <aside
      aria-label="Try it"
      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/40"
    >
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Try it</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">Type sample values to preview the results. Nothing here is saved.</p>
      </div>

      <label
        className={`flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 ${liveSources ? "" : "opacity-50"}`}
        title={
          liveBlockedReason ||
          (liveSources ? "Use the values the analyzer is reading right now" : "No live values yet. Start the analyzer to use them.")
        }
      >
        <input
          type="checkbox"
          aria-label="Use live values"
          checked={useLive}
          disabled={!liveSources}
          onChange={(e) => onUseLiveChange(e.currentTarget.checked)}
          className="accent-emerald-600"
        />
        Use live values
      </label>
      {liveBlockedReason ? <p className="-mt-2 text-xs text-amber-700 dark:text-amber-300">{liveBlockedReason}</p> : null}

      {keys.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400">Add an input to try values.</p>}
      {keys.map((key) => (
        <label key={key} className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
          <span className={key === "register" ? "" : "font-mono text-blue-700 dark:text-blue-300"}>{key === "register" ? "Register value" : key}</span>
          <input
            aria-label={`Try it ${key} value`}
            className={`${FIELD_CLASS} font-mono`}
            inputMode="decimal"
            placeholder={useLive ? livePlaceholder(liveFor(key)) : "type a value"}
            value={useLive ? formatMathResult(liveFor(key)) : (manual[key] ?? "")}
            onChange={(e) => {
              onUseLiveChange(false);
              onManualChange(key, e.currentTarget.value);
            }}
          />
        </label>
      ))}

      {Object.keys(results).length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-slate-200 pt-3 dark:border-slate-800">
          {Object.entries(results).map(([name, r]) => (
            <li key={name} data-result={name} className="flex items-baseline justify-between gap-2 font-mono text-sm">
              <span className="text-emerald-700 dark:text-emerald-300">{name}</span>
              <span
                className={
                  r.ok
                    ? "text-amber-600 dark:text-amber-400"
                    : isWaiting(r)
                      ? "text-xs italic text-slate-400 dark:text-slate-500"
                      : "text-xs text-red-600 dark:text-red-400"
                }
              >
                {r.ok ? formatMathResult(r) : r.error}
              </span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
