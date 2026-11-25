import { useEffect, useMemo, useState } from "react";
import {
  evaluateSignalMath,
  renameVariable,
  waitingResult,
  type MathInput,
  type MathIssue,
  type MathResult,
  type SignalMath,
} from "../../../utils/analyzerMath";
import type { SignalEvaluation } from "../../../utils/analyzerSignalEval";
import type { AnalyzerSignal } from "../../../api/analyzer";
import InputsSection from "./InputsSection";
import TryItPanel, { formatMathResult } from "./TryItPanel";
import VariablesList from "./VariablesList";
import { IssueText } from "./mathUi";
import { mathInputTypes } from "./signalDraft";

type Sources = { register?: MathResult; inputs: Record<string, MathResult> };

function parseManual(text: string): MathResult | undefined {
  const t = text.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? { ok: true, value: { kind: "number", value: n } } : { ok: true, value: { kind: "text", value: text } };
}

function liveInput(input: MathInput, ev: SignalEvaluation | undefined): MathResult | undefined {
  if (!ev) return undefined;
  if (input.value === "shown") return ev.shown;
  if (input.value === "register") return ev.register ?? undefined;
  return Object.prototype.hasOwnProperty.call(ev.variables, input.value) ? ev.variables[input.value] : undefined;
}

export default function MathTab(props: {
  kind: "register" | "calculated";
  math: SignalMath;
  onChange: (m: SignalMath) => void;
  signals: AnalyzerSignal[];
  evaluations: Record<string, SignalEvaluation>;
  selfSignalId: string | null;
  issues: MathIssue[];
  /** `fromLive` is true when the results were computed from live values rather than typed ones. */
  onResults?: (r: Record<string, MathResult>, fromLive: boolean) => void;
  /** The register value the results were computed from (live or typed); register signals only. */
  onRegisterSample?: (r: MathResult | undefined) => void;
  /** Whether the analyzer is polling: "Use live values" starts on only then (and only with data). */
  polling: boolean;
  /** When set, live values don't match this draft (e.g. unsaved Scale): Try it can't use them. */
  liveBlockedReason?: string | null;
}) {
  const { kind, math, onChange, signals, evaluations, selfSignalId, issues, onResults, onRegisterSample, polling, liveBlockedReason } = props;
  const [manual, setManual] = useState<Record<string, string>>({});
  const [useLiveChoice, setUseLiveChoice] = useState<boolean | null>(null);

  const registerSignals = useMemo(() => signals.filter((s) => s.kind === "register" && s.id !== selfSignalId), [signals, selfSignalId]);

  const inputTypes = useMemo(() => mathInputTypes(math, signals), [math, signals]);
  const inputIssues = issues.filter((i) => i.path === "inputs" || i.path.startsWith("inputs."));

  const live: Sources | null = useMemo(() => {
    if (liveBlockedReason) return null;
    const src: Sources = { inputs: {} };
    if (kind === "register") {
      const reg = selfSignalId ? evaluations[selfSignalId]?.register : null;
      if (reg) src.register = reg;
    } else {
      for (const inp of math.inputs) {
        const r = liveInput(inp, evaluations[inp.signalId]);
        if (r) src.inputs[inp.name] = r;
      }
    }
    return src.register || Object.keys(src.inputs).length > 0 ? src : null;
  }, [kind, math.inputs, evaluations, selfSignalId, liveBlockedReason]);

  const useLive = !!live && (useLiveChoice ?? polling);

  const results = useMemo(() => {
    // A source with no value (nothing typed, no live data) is "waiting", not an error.
    const withWaiting = (src: Sources): Sources => {
      if (kind === "register") return { ...src, register: src.register ?? waitingResult() };
      const inputs = { ...src.inputs };
      for (const inp of math.inputs) if (!Object.prototype.hasOwnProperty.call(inputs, inp.name)) inputs[inp.name] = waitingResult();
      return { ...src, inputs };
    };
    if (useLive && live) return evaluateSignalMath(math, withWaiting(live));
    const src: Sources = { inputs: {} };
    const reg = parseManual(manual.register ?? "");
    if (kind === "register" && reg) src.register = reg;
    if (kind === "calculated") {
      for (const inp of math.inputs) {
        const r = parseManual(manual[inp.name] ?? "");
        if (r) src.inputs[inp.name] = r;
      }
    }
    return evaluateSignalMath(math, withWaiting(src));
  }, [useLive, live, manual, math, kind]);

  const resultsFromLive = useLive && !!live;
  useEffect(() => onResults?.(results, resultsFromLive), [results, resultsFromLive, onResults]);

  const manualRegister = manual.register ?? "";
  const registerSample = useMemo(() => {
    if (kind !== "register") return undefined;
    return useLive && live ? live.register : parseManual(manualRegister);
  }, [kind, useLive, live, manualRegister]);
  useEffect(() => onRegisterSample?.(registerSample), [registerSample, onRegisterSample]);

  /** Leaving live mode keeps what the boxes showed, so only the edited value changes. */
  const seedFromLive = () => {
    if (!useLive || !live) return;
    setManual((prev) => {
      const next = { ...prev };
      const keys = kind === "register" ? ["register"] : math.inputs.map((i) => i.name);
      for (const k of keys) {
        if ((next[k] ?? "") === "") next[k] = formatMathResult(k === "register" ? live.register : live.inputs[k]);
      }
      return next;
    });
  };

  const liveRegister = kind === "register" && selfSignalId ? evaluations[selfSignalId]?.register : null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px] xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-4">
        {kind === "calculated" ? (
          <div className="flex flex-col gap-1">
            <InputsSection
              inputs={math.inputs}
              registerSignals={registerSignals}
              evaluations={evaluations}
              onChange={(inputs) => onChange({ ...math, inputs })}
              onRename={(from, to) => onChange(renameVariable(math, from, to))}
              reservedNames={math.variables.map((v) => v.name)}
            />
            {inputIssues.map((i) => (
              <IssueText key={`${i.path}:${i.message}`} message={i.message} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200">
              Register value →{" "}
              <span className="font-mono text-amber-600 dark:text-amber-400">{liveBlockedReason ? "save to see it with your changes" : liveRegister ? formatMathResult(liveRegister) || "error" : "no live value yet"}</span>
            </p>
            {inputIssues.map((i) => (
              <IssueText key={`${i.path}:${i.message}`} message={i.message} />
            ))}
          </div>
        )}
        <VariablesList math={math} hasRegister={kind === "register"} results={results} issues={issues} inputTypes={inputTypes} onChange={onChange} />
      </div>
      <TryItPanel
        kind={kind}
        inputNames={math.inputs.map((i) => i.name)}
        liveSources={live}
        useLive={useLive}
        onUseLiveChange={(v) => {
          if (!v) seedFromLive();
          else setManual({});
          setUseLiveChoice(v);
        }}
        manual={manual}
        onManualChange={(k, v) => setManual((m) => ({ ...m, [k]: v }))}
        results={results}
        liveBlockedReason={liveBlockedReason}
      />
    </div>
  );
}
