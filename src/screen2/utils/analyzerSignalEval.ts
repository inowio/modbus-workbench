// Evaluates one Analyzer signal (register or calculated) into a SignalEvaluation.
// Pure: no React/Tauri/DOM. Signals without math go through decodeAnalyzerSignal unchanged.

import {
  evaluateSignalMath,
  parseSignalMath,
  variableTypes,
  type MathResult,
  type MathValueType,
  type SignalMath,
} from "./analyzerMath";
import {
  decodeAnalyzerSignal,
  formatNonOkStateMessage,
  parseAnalyzerDecoderConfig,
  type AnalyzerDecodeResult,
} from "./analyzerSignalDecoder";

export type RegisterSignalInput = Parameters<typeof decodeAnalyzerSignal>[0];

export type SignalEvaluation = {
  state: string; // OK | STALE | DISCONNECTED | ERROR (upper-case)
  formatted: string; // exact tile label
  shown: MathResult; // UNROUNDED shown value (what "shown" inputs receive)
  register: MathResult | null; // null for calculated signals
  variables: Record<string, MathResult>;
  sample: number | null; // trend sample (rounded by Decimals); null for text/error/non-OK
  valueType: "number" | "text";
};

const INVALID_MATH = "unsupported or invalid math";
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

const fail = (error: string): MathResult => ({ ok: false, error });
const num = (value: number): MathResult => ({ ok: true, value: { kind: "number", value } });

function has(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function newMap<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function parseObject(decoderJson: string | null | undefined): Record<string, unknown> | null {
  if (!decoderJson) return null;
  try {
    const parsed: unknown = JSON.parse(decoderJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** "invalid" when a `math` key exists but does not parse (never fall back silently). */
function readMath(decoderJson: string | null | undefined): { math: SignalMath | null; invalid: boolean } {
  const obj = parseObject(decoderJson);
  if (!obj || !("math" in obj)) return { math: null, invalid: false };
  const math = parseSignalMath(obj.math);
  return { math, invalid: math === null };
}

// ------------------------------------------------------------- formatting

export function formatMathNumber(n: number, decimals: number | undefined): string {
  let s: string;
  if (decimals != null && Number.isInteger(decimals) && decimals >= 0) s = n.toFixed(Math.min(12, decimals));
  else if (Number.isInteger(n)) s = String(n); // integers are exact: never round them
  else s = String(Number(n.toPrecision(15)));
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
}

function roundSample(n: number, decimals: number | undefined): number {
  const r =
    decimals != null && Number.isInteger(decimals) && decimals >= 0
      ? Math.round(n * 10 ** Math.min(12, decimals)) / 10 ** Math.min(12, decimals)
      : n;
  return r === 0 ? 0 : r;
}

/** Follows "depends on X, which has an error" chains down to the original cause. */
function rootCause(error: string, lookup: (name: string) => MathResult | undefined): string {
  let current = error;
  for (let i = 0; i < 64; i++) {
    const m = /^depends on ([^,]+), which has an error$/.exec(current);
    if (!m) break;
    const next = lookup(m[1]);
    if (!next || next.ok) break;
    current = next.error;
  }
  return current;
}

function errorEvaluation(
  state: string,
  message: string,
  register: MathResult | null,
  variables: Record<string, MathResult>,
  valueType: "number" | "text" = "number",
): SignalEvaluation {
  return { state, formatted: message, shown: fail(message), register, variables, sample: null, valueType };
}

/** Formats the shown value into label/sample/valueType. */
function presentShown(
  shown: MathResult,
  decimals: number | undefined,
  unit: string | undefined,
  lookup: (name: string) => MathResult | undefined,
): Pick<SignalEvaluation, "state" | "formatted" | "sample" | "valueType" | "shown"> {
  if (!shown.ok) {
    return { state: "ERROR", formatted: rootCause(shown.error, lookup), shown, sample: null, valueType: "number" };
  }
  if (shown.value.kind === "text") {
    return { state: "OK", formatted: shown.value.value, shown, sample: null, valueType: "text" };
  }
  const n = shown.value.value;
  const base = formatMathNumber(n, decimals);
  return {
    state: "OK",
    formatted: unit ? `${base} ${unit}` : base,
    shown,
    sample: roundSample(n, decimals),
    valueType: "number",
  };
}

// -------------------------------------------------------- register signals

function decodedToMath(dec: AnalyzerDecodeResult): MathResult {
  if (!dec.ok) return fail(dec.error);
  const v = dec.value;
  if (v.kind === "bool") return num(v.value ? 1 : 0);
  if (v.kind === "number") return Number.isFinite(v.value) ? num(v.value) : fail("value is not a finite number");
  if (v.value > BigInt(MAX_SAFE) || v.value < -BigInt(MAX_SAFE)) return fail("value too large for math");
  return num(Number(v.value));
}

function decodedSample(dec: AnalyzerDecodeResult): number | null {
  if (!dec.ok) return null;
  const v = dec.value;
  if (v.kind === "bool") return v.value ? 1 : 0;
  const n = Number(v.value);
  return Number.isFinite(n) ? n : null;
}

/** The Data-tab register value for Math: transforms applied, but no rounding or unit. */
function registerValue(input: RegisterSignalInput): MathResult {
  const obj = parseObject(input.decoderJson);
  let stripped = input.decoderJson;
  if (obj) {
    // Magnitude is checked on the raw decoded value: a transform must not hide a lossy u64.
    if (typeof obj.bit !== "number") {
      const raw = decodeAnalyzerSignal({ ...input, decoderJson: null });
      if (raw.ok && raw.value.kind === "bigint" && (raw.value.value > BigInt(MAX_SAFE) || raw.value.value < -BigInt(MAX_SAFE))) {
        return fail("value too large for math");
      }
    }
    const copy = { ...obj };
    delete copy.decimals;
    delete copy.unit;
    delete copy.show;
    delete copy.math;
    stripped = JSON.stringify(copy);
  }
  return decodedToMath(decodeAnalyzerSignal({ ...input, decoderJson: stripped }));
}

export function evaluateRegisterSignal(input: RegisterSignalInput): SignalEvaluation {
  const dec = decodeAnalyzerSignal(input);
  const state = worstState([input.state]);
  if (state !== "OK") {
    const err = fail(dec.ok ? "" : dec.error);
    return { state, formatted: dec.formatted, shown: err, register: err, variables: {}, sample: null, valueType: "number" };
  }

  const register = registerValue(input);
  const { math, invalid } = readMath(input.decoderJson);
  if (invalid) return errorEvaluation("ERROR", INVALID_MATH, register, {});
  const cfg = parseAnalyzerDecoderConfig(input.decoderJson);
  const variables = math ? evaluateSignalMath(math, { register, inputs: newMap<MathResult>() }) : newMap<MathResult>();

  const showName = cfg.show;
  if (!math || showName == null || showName === "" || showName === "register") {
    return {
      state: dec.ok ? "OK" : "ERROR",
      formatted: dec.formatted,
      shown: register,
      register,
      variables,
      sample: decodedSample(dec),
      valueType: "number",
    };
  }

  const shown = has(variables, showName) ? variables[showName] : fail(`unknown name ${showName}`);
  const lookup = (name: string) => (name === "register" ? register : has(variables, name) ? variables[name] : undefined);
  return { ...presentShown(shown, cfg.decimals, cfg.unit, lookup), register, variables };
}

// ------------------------------------------------------- calculated signals

const STATE_RANK: Record<string, number> = { DISCONNECTED: 3, STALE: 2, ERROR: 1, OK: 0 };

export function worstState(states: string[]): string {
  let worst = "OK";
  for (const s of states) {
    const raw = (s || "").toUpperCase();
    const u = has(STATE_RANK, raw) ? raw : "ERROR";
    if (STATE_RANK[u] > STATE_RANK[worst]) worst = u;
  }
  return worst;
}

function pickInput(
  input: { name: string; signalId: string; value: string },
  source: SignalEvaluation | undefined,
): MathResult {
  if (!source) return fail(`missing: ${input.name}`);
  if (input.value === "shown") return source.shown;
  if (input.value === "register") return source.register ?? fail(`missing: ${input.name}.register`);
  return has(source.variables, input.value) ? source.variables[input.value] : fail(`missing: ${input.name}.${input.value}`);
}

export function evaluateCalculatedSignal(decoderJson: string, inputs: Record<string, SignalEvaluation>): SignalEvaluation {
  const { math, invalid } = readMath(decoderJson);
  if (!math || invalid) return errorEvaluation("ERROR", INVALID_MATH, null, {});
  const cfg = parseAnalyzerDecoderConfig(decoderJson);

  const byName = newMap<MathResult>();
  const states: string[] = [];
  for (const input of math.inputs) {
    const source = has(inputs, input.signalId) ? inputs[input.signalId] : undefined;
    if (source) states.push(source.state);
    byName[input.name] = pickInput(input, source);
  }

  const state = worstState(states);
  if (state === "DISCONNECTED" || state === "STALE") {
    const msg = formatNonOkStateMessage(state, "");
    return { state, formatted: msg, shown: fail(msg), register: null, variables: {}, sample: null, valueType: "number" };
  }

  const variables = evaluateSignalMath(math, { inputs: byName });
  const showName = cfg.show;
  const shown = showName != null && has(variables, showName) ? variables[showName] : fail(showName ? `unknown name ${showName}` : "nothing selected to show");
  const lookup = (name: string) => (has(variables, name) ? variables[name] : has(byName, name) ? byName[name] : undefined);
  const view = presentShown(shown, cfg.decimals, cfg.unit, lookup);

  if (view.state === "OK" && state !== "OK") {
    // An input is in ERROR: never show a number computed from it.
    return { state, formatted: "Error", shown: fail("an input has an error"), register: null, variables, sample: null, valueType: view.valueType };
  }
  return { ...view, register: null, variables };
}

// ------------------------------------------------------------- value type

/** Type of the shown value. `inputTypes` (by input name) matters only for calculated signals. */
export function shownValueType(decoderJson: string, inputTypes?: Record<string, MathValueType>): "number" | "text" {
  const { math } = readMath(decoderJson);
  if (!math) return "number";
  const show = parseAnalyzerDecoderConfig(decoderJson).show;
  if (!show || show === "register") return "number";
  const types = variableTypes(math, inputTypes);
  return has(types, show) ? types[show] : "number";
}
