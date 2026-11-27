import { useId } from "react";
import { isWaiting, type MathResult } from "../../../utils/analyzerMath";
import { formatMathNumber, type SignalEvaluation } from "../../../utils/analyzerSignalEval";
import { formatMathResult } from "./TryItPanel";
import UnitPicker from "./UnitPicker";
import { SHOW_REGISTER, transformsChanged, validateOptionalNonNegativeInt, type SignalDraft } from "./signalDraft";
import { FieldError, FIELD_CLASS, LABEL_CLASS, SECTION_CLASS, SectionTitle } from "./dataTabUi";

function optionLabel(name: string, r: MathResult | undefined): string {
  if (!r || isWaiting(r)) return name;
  if (!r.ok) return `${name} · error`;
  return r.value.kind === "text" ? `${name} · ${r.value.value} · text` : `${name} · ${formatMathResult(r)}`;
}

export type SavedDisplay = Pick<
  SignalDraft,
  "show" | "decimals" | "unit" | "math" | "slaveId" | "functionCode" | "registerRowId" | "bit" | "scale" | "offset" | "clampMin" | "clampMax"
>;

export const SAVE_TRANSFORMS_NOTE = "Save to preview register or Scale/Offset/Clamp/Bit changes";

function sameDisplay(draft: SignalDraft, saved: SavedDisplay | null): boolean {
  return (
    saved != null &&
    !transformsChanged(draft, saved) &&
    draft.show === saved.show &&
    draft.decimals.trim() === saved.decimals &&
    draft.unit.trim() === saved.unit &&
    JSON.stringify(draft.math) === JSON.stringify(saved.math)
  );
}

/**
 * What a tile will show. The live label is used only while the draft still matches the saved
 * signal; otherwise the draft's Show value is formatted like presentShown (number + unit, text as-is).
 * Live values are decoded with the SAVED Scale/Offset/Clamp/Bit, so once those change in the draft
 * no live-derived number is shown (only values the user typed in Try it).
 */
export function tilePreview(args: {
  draft: SignalDraft;
  saved: SavedDisplay | null;
  results: Record<string, MathResult>;
  registerSample: MathResult | undefined;
  live: SignalEvaluation | undefined;
  /** True when `results`/`registerSample` were computed from live values (not typed ones). */
  resultsFromLive?: boolean;
  /** False when the analyzer is stopped: the stored value is then the last one read, not live. */
  polling?: boolean;
}): { text: string; note: string; error: boolean } {
  const { draft, saved, results, registerSample, live, resultsFromLive = false, polling = true } = args;
  const liveOk = live != null && live.state === "OK";
  if (liveOk && sameDisplay(draft, saved)) {
    return { text: live.formatted || "—", note: polling ? "Live value" : "Last value (analyzer stopped)", error: false };
  }
  if (!draft.show) return { text: "—", note: "Pick a Show value", error: false };
  const isRegisterShow = draft.show === SHOW_REGISTER;
  const r = isRegisterShow ? registerSample : results[draft.show];
  // Without a good typed value, a live signal gets the save note (never a stale or saved-transform number).
  if (transformsChanged(draft, saved) && (resultsFromLive || (liveOk && (!r || !r.ok)))) {
    return { text: "—", note: SAVE_TRANSFORMS_NOTE, error: false };
  }
  if (!r || isWaiting(r)) {
    const note = isRegisterShow
      ? "No register value yet. Start the analyzer, or type one in the Math tab's Try it panel."
      : "Type sample values in the Math tab's Try it panel";
    return { text: "—", note, error: false };
  }
  if (!r.ok) return { text: "—", note: r.error, error: true };
  const note = resultsFromLive ? "Preview with your unsaved changes" : "From Try it values";
  if (r.value.kind === "text") return { text: r.value.value, note, error: false };
  const decimals = validateOptionalNonNegativeInt(draft.decimals, 12).parsed ?? undefined;
  const unit = draft.unit.trim();
  const base = formatMathNumber(r.value.value, decimals);
  return { text: unit ? `${base} ${unit}` : base, note, error: false };
}

export default function TilesShowSection(props: {
  draft: SignalDraft;
  onChange: (patch: Partial<SignalDraft>) => void;
  results: Record<string, MathResult>;
  registerSample: MathResult | undefined;
  saved: SavedDisplay | null;
  live: SignalEvaluation | undefined;
  resultsFromLive: boolean;
  polling: boolean;
  errors: { show?: string; decimals?: string };
  unitKey: string;
  disabled: boolean;
}) {
  const { draft, onChange, results, registerSample, saved, live, resultsFromLive, polling, errors, unitKey, disabled } = props;
  const showId = useId();
  const unitId = useId();
  const decimalsId = useId();
  const isRegister = draft.kind === "register";
  const vars = draft.math.variables;
  const showMissing = draft.show !== "" && draft.show !== SHOW_REGISTER && !vars.some((v) => v.name === draft.show);
  const preview = tilePreview({ draft, saved, results, registerSample, live, resultsFromLive, polling });

  return (
    <section aria-label="What tiles show" className={SECTION_CLASS}>
      <SectionTitle title="What tiles show" caption="Pick the value a tile displays, and how it is labelled." />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={showId} className={LABEL_CLASS}>
            Show value
          </label>
          <select
            id={showId}
            className={`mt-1 ${FIELD_CLASS}`}
            value={draft.show}
            onChange={(e) => onChange({ show: e.currentTarget.value })}
            disabled={disabled}
          >
            {draft.show === "" ? (
              <option value="" disabled>
                {vars.length === 0 ? "Add a variable in the Math tab first" : "Pick a variable…"}
              </option>
            ) : null}
            {isRegister ? <option value={SHOW_REGISTER}>Register value</option> : null}
            {vars.map((v) => (
              <option key={v.name} value={v.name}>
                {optionLabel(v.name, results[v.name])}
              </option>
            ))}
            {showMissing ? <option value={draft.show}>{draft.show} · missing</option> : null}
          </select>
          <FieldError message={errors.show} />
        </div>

        <div>
          <label htmlFor={unitId} className={LABEL_CLASS}>
            Unit
          </label>
          <div className="mt-1">
            <UnitPicker key={unitKey} id={unitId} value={draft.unit} onChange={(unit) => onChange({ unit })} disabled={disabled} />
          </div>
        </div>

        <div>
          <label htmlFor={decimalsId} className={LABEL_CLASS}>
            Decimals (0-12)
          </label>
          <input
            id={decimalsId}
            className={`mt-1 ${FIELD_CLASS}`}
            value={draft.decimals}
            onChange={(e) => onChange({ decimals: e.currentTarget.value })}
            placeholder="e.g. 2"
            disabled={disabled}
          />
          <FieldError message={errors.decimals} />
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Applies when the shown value is a number.</div>
        </div>
      </div>

      <div
        role="group"
        aria-label="Tile preview"
        className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-emerald-600/30 bg-emerald-500/5 px-4 py-3 dark:border-emerald-500/30 dark:bg-emerald-500/10"
      >
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Tile preview</div>
          <div className={`mt-0.5 text-[11px] ${preview.error ? "text-rose-700 dark:text-rose-300" : "text-slate-500 dark:text-slate-400"}`}>
            {preview.note}
          </div>
        </div>
        <div className="truncate font-mono text-2xl font-semibold text-slate-900 dark:text-slate-100">{preview.text}</div>
      </div>
    </section>
  );
}
