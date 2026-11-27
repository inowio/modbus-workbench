import { FiTrash2 } from "react-icons/fi";
import { MATH_LIMITS, MATH_NAME_PATTERN, REGISTER_REF, type MathInput } from "../../../utils/analyzerMath";
import type { AnalyzerSignal } from "../../../api/analyzer";
import type { SignalEvaluation } from "../../../utils/analyzerSignalEval";
import NameChip from "./NameChip";
import { FIELD_CLASS, IconButton } from "./mathUi";
import { sourceVariableNames } from "./signalDraft";

const DOT: Record<string, string> = { OK: "bg-emerald-500", STALE: "bg-amber-500", ERROR: "bg-red-500", DISCONNECTED: "bg-slate-400" };

export default function InputsSection(props: {
  inputs: MathInput[];
  registerSignals: AnalyzerSignal[];
  evaluations: Record<string, SignalEvaluation>;
  onChange: (next: MathInput[]) => void;
  /** Lets the parent rewrite references when an input is renamed. */
  onRename: (from: string, to: string) => void;
  /** Variable names that an input may not reuse. */
  reservedNames?: string[];
}) {
  const { inputs, registerSignals, evaluations, onChange, onRename, reservedNames = [] } = props;
  const atLimit = inputs.length >= MATH_LIMITS.inputs;
  const labelOf = (s: AnalyzerSignal) => {
    const alias = s.alias?.trim();
    return alias ? `${alias} (${s.id})` : s.id;
  };

  const add = () => {
    const first = registerSignals[0];
    if (!first) return;
    const used = new Set([...inputs.map((i) => i.name), ...reservedNames]);
    let k = 1;
    while (used.has(`in${k}`)) k++;
    onChange([...inputs, { name: `in${k}`, signalId: first.id, value: "shown" }]);
  };

  const replaceAt = (i: number, patch: Partial<MathInput>) => onChange(inputs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const rename = (i: number, to: string): string | null => {
    const from = inputs[i].name;
    if (to === from) return null;
    if (!MATH_NAME_PATTERN.test(to)) return "use letters, digits and _ (max 16, not starting with a digit)";
    if (to === REGISTER_REF || reservedNames.includes(to) || inputs.some((x, j) => j !== i && x.name === to)) return `name "${to}" is already used`;
    onRename(from, to);
    return null;
  };

  return (
    <section aria-label="Inputs" className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/40">
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Inputs</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">Pick the register signals this signal is calculated from. Each input gets a short name you can use below.</p>
      </div>

      {inputs.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 p-3 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No inputs yet. Add one to start.
        </p>
      )}

      {inputs.map((inp, i) => {
        const source = registerSignals.find((s) => s.id === inp.signalId);
        const ev = evaluations[inp.signalId];
        const varNames = sourceVariableNames(source);
        // A stored value naming a variable the source no longer has stays visible, marked missing.
        const valueMissing = inp.value !== "shown" && inp.value !== "register" && !varNames.includes(inp.value);
        const n = i + 1;
        return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <NameChip tone="input" label={`Input ${n} name`} name={inp.name} onCommit={(to) => rename(i, to)} />
            <select
              aria-label={`Input ${n} signal`}
              className={FIELD_CLASS}
              value={inp.signalId}
              onChange={(e) => replaceAt(i, { signalId: e.currentTarget.value, value: "shown" })}
            >
              {!source && <option value={inp.signalId}>(missing signal)</option>}
              {registerSignals.map((s) => (
                <option key={s.id} value={s.id}>
                  {labelOf(s)}
                </option>
              ))}
            </select>
            <select aria-label={`Input ${n} value`} className={FIELD_CLASS} value={inp.value} onChange={(e) => replaceAt(i, { value: e.currentTarget.value })}>
              <option value="shown">Shown value</option>
              <option value="register">Register value</option>
              {varNames.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
              {valueMissing && <option value={inp.value}>{inp.value} · missing</option>}
            </select>
            <span
              role="img"
              aria-label={`${inp.name} status: ${ev ? ev.state : "no live data"}`}
              title={ev ? `Source is ${ev.state.toLowerCase()}` : "No live data"}
              className={`h-2.5 w-2.5 rounded-full ${ev ? (DOT[ev.state] ?? "bg-slate-400") : "bg-slate-300 dark:bg-slate-600"}`}
            />
            <span className="ml-auto">
              <IconButton label={`Remove input ${inp.name}`} onClick={() => onChange(inputs.filter((_, j) => j !== i))}>
                <FiTrash2 />
              </IconButton>
            </span>
          </div>
        );
      })}

      <div>
        <button
          type="button"
          disabled={atLimit || registerSignals.length === 0}
          title={atLimit ? `At most ${MATH_LIMITS.inputs} inputs` : registerSignals.length === 0 ? "Add a register signal first" : "Add an input"}
          onClick={add}
          className="rounded-xl border border-blue-600/50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-blue-300 dark:hover:bg-blue-900/20"
        >
          + Add input
        </button>
      </div>
    </section>
  );
}
