import { useState } from "react";
import { FiArrowDown, FiArrowUp, FiCopy, FiTrash2 } from "react-icons/fi";
import {
  MATH_LIMITS,
  REGISTER_REF,
  referencesOf,
  renameVariable,
  variableTypes,
  type MathIssue,
  type MathOperand,
  type MathResult,
  type MathValueType,
  validateSignalMath,
  type MathVariable,
  type SignalMath,
} from "../../../utils/analyzerMath";
import { formatMathNumber } from "../../../utils/analyzerSignalEval";
import CalcVariableCard from "./CalcVariableCard";
import NameChip from "./NameChip";
import RulesVariableCard from "./RulesVariableCard";
import type { OperandOption } from "./OperandPicker";
import { FIELD_CLASS, IconButton, IssueText, issueAt } from "./mathUi";

function formatResult(r: MathResult | undefined): { text: string; ok: boolean } | null {
  if (!r) return null;
  if (!r.ok) return { text: r.error, ok: false };
  const v = r.value;
  return { text: `→ ${v.kind === "number" ? formatMathNumber(v.value, undefined) : v.value}`, ok: true };
}

function uniqueName(math: SignalMath, base: string): string {
  const used = new Set([REGISTER_REF, ...math.inputs.map((i) => i.name), ...math.variables.map((v) => v.name)]);
  for (let k = 2; ; k++) {
    const candidate = `${base.slice(0, 16 - String(k).length - 1)}_${k}`;
    if (!used.has(candidate)) return candidate;
  }
}

function freshName(math: SignalMath): string {
  const used = new Set([...math.inputs.map((i) => i.name), ...math.variables.map((v) => v.name)]);
  for (let k = 1; ; k++) if (!used.has(`v${k}`)) return `v${k}`;
}

export default function VariablesList(props: {
  math: SignalMath;
  hasRegister: boolean;
  results: Record<string, MathResult>;
  issues: MathIssue[];
  inputTypes?: Record<string, MathValueType>;
  onChange: (next: SignalMath) => void;
}) {
  const { math, hasRegister, results, issues, inputTypes, onChange } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const types = variableTypes(math, inputTypes);
  const vars = math.variables;
  const atLimit = vars.length >= MATH_LIMITS.variables;

  const setVars = (variables: MathVariable[]) => onChange({ ...math, variables });
  const replaceAt = (i: number, v: MathVariable) => setVars(vars.map((x, j) => (j === i ? v : x)));

  const optionsFor = (i: number): OperandOption[] => [
    ...(hasRegister ? [{ ref: REGISTER_REF, label: "Register value", type: "number" as const }] : []),
    ...math.inputs.map((inp) => ({ ref: inp.name, label: inp.name, type: types[inp.name] ?? ("number" as const) })),
    ...vars.slice(0, i).map((v) => ({ ref: v.name, label: v.name, type: types[v.name] ?? ("number" as const) })),
  ];

  /** Returns an error message, or null when the rename was applied. */
  const rename = (i: number, to: string): string | null => {
    const from = vars[i].name;
    if (to === from) return null;
    const clash =
      to === REGISTER_REF || vars.some((v, j) => j !== i && v.name === to) || math.inputs.some((inp) => inp.name === to);
    if (clash) return `name "${to}" is already used`;
    const fromShared = vars.some((v, j) => j !== i && v.name === from) || math.inputs.some((inp) => inp.name === from);
    const candidate = fromShared ? { ...math, variables: vars.map((v, j) => (j === i ? { ...v, name: to } : v)) } : renameVariable(math, from, to);
    const bad = validateSignalMath(candidate, { hasRegister, inputTypes }).find((x) => x.path === `variables.${i}.name`);
    if (bad) return bad.message;
    onChange(candidate);
    return null;
  };

  const move = (i: number, to: number) => {
    const next = [...vars];
    [next[i], next[to]] = [next[to], next[i]];
    setVars(next);
  };

  /** A new Calculation starts on the value people usually want: the register, else the first number input. */
  const defaultStart = (): MathOperand => {
    if (hasRegister) return { ref: REGISTER_REF };
    const input = math.inputs.find((inp) => (types[inp.name] ?? "number") === "number");
    return input ? { ref: input.name } : { num: 0 };
  };

  const add = (kind: "calc" | "rules") => {
    const name = freshName(math);
    setVars([
      ...vars,
      kind === "calc"
        ? { name, kind: "calc", start: defaultStart(), steps: [] }
        : { name, kind: "rules", rules: [], otherwise: { num: 0 } },
    ]);
    setMenuOpen(false);
  };

  return (
    <div className="flex flex-col gap-3">
      {vars.length === 0 && (
        <p className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No variables yet. Add a Calculation (maths on a value) or Rules (IF … THEN …).
        </p>
      )}

      {vars.map((v, i) => {
        const prev = vars[i - 1];
        const next = vars[i + 1];
        const upBlock =
          i === 0 ? "Already first" : referencesOf(v).includes(prev.name) ? `${v.name} uses ${prev.name}, which must stay above it` : null;
        const downBlock =
          i === vars.length - 1
            ? "Already last"
            : referencesOf(next).includes(v.name)
              ? `${next.name} uses ${v.name}, so ${v.name} must stay above it`
              : null;
        const result = formatResult(results[v.name]);
        const path = `variables.${i}`;
        const nameIssue = issueAt(issues, `${path}.name`);
        return (
          <section
            key={i}
            aria-label={`Variable ${v.name}`}
            className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/40"
          >
            <div className="flex flex-wrap items-center gap-2">
              <NameChip label={`Variable ${i + 1} name`} name={v.name} onCommit={(to) => rename(i, to)} />
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {v.kind === "calc" ? "Calculation" : "Rules"} · {types[v.name] ?? "number"}
              </span>
              {result && (
                <span className={`ml-auto font-mono text-sm ${result.ok ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`}>
                  {result.text}
                </span>
              )}
              <span className={`flex ${result ? "" : "ml-auto"}`}>
                <IconButton label={`Move ${v.name} up`} title={upBlock ?? `Move ${v.name} up`} disabled={!!upBlock} onClick={() => move(i, i - 1)}>
                  <FiArrowUp />
                </IconButton>
                <IconButton label={`Move ${v.name} down`} title={downBlock ?? `Move ${v.name} down`} disabled={!!downBlock} onClick={() => move(i, i + 1)}>
                  <FiArrowDown />
                </IconButton>
                <IconButton
                  label={`Duplicate ${v.name}`}
                  disabled={atLimit}
                  title={atLimit ? `At most ${MATH_LIMITS.variables} variables` : `Duplicate ${v.name}`}
                  onClick={() => setVars([...vars.slice(0, i + 1), { ...structuredClone(v), name: uniqueName(math, v.name) }, ...vars.slice(i + 1)])}
                >
                  <FiCopy />
                </IconButton>
                <IconButton label={`Delete ${v.name}`} onClick={() => setVars(vars.filter((_, j) => j !== i))}>
                  <FiTrash2 />
                </IconButton>
              </span>
            </div>
            <IssueText message={nameIssue} />
            {v.kind === "calc" ? (
              <CalcVariableCard
                variable={v}
                path={path}
                options={optionsFor(i).filter((o) => o.type === "number")}
                issues={issues}
                onChange={(n) => replaceAt(i, n)}
              />
            ) : (
              <RulesVariableCard variable={v} path={path} options={optionsFor(i)} issues={issues} onChange={(n) => replaceAt(i, n)} />
            )}
          </section>
        );
      })}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={atLimit}
          title={atLimit ? `At most ${MATH_LIMITS.variables} variables` : "Add a variable"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-600/50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-900/20"
        >
          + Add variable
        </button>
        {menuOpen && !atLimit && (
          <>
            <button type="button" className={`${FIELD_CLASS} hover:border-emerald-600/60`} onClick={() => add("calc")}>
              Calculation
            </button>
            <button type="button" className={`${FIELD_CLASS} hover:border-emerald-600/60`} onClick={() => add("rules")}>
              Rules
            </button>
          </>
        )}
        <IssueText message={issueAt(issues, "variables")} />
      </div>
    </div>
  );
}
