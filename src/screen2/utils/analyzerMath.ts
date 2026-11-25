// Pure math engine for Analyzer signals. Declarative JSON in, values out.
// No React/Tauri/DOM imports, no eval: the same JSON must stay portable to a Rust evaluator.

export type MathOperand = { ref: string } | { num: number } | { text: string };
export type BinaryOp = "add" | "sub" | "mul" | "div" | "mod" | "min" | "max" | "pow";
export type UnaryOp = "abs" | "round" | "floor" | "ceil" | "bit" | "neg";
export type CalcStep = { op: BinaryOp; operand: MathOperand } | { op: UnaryOp; n?: number }; // n: round decimals 0–12, bit index 0–52
export type CmpOp = "lt" | "le" | "eq" | "ne" | "ge" | "gt";
export type MathCondition = { left: MathOperand; cmp: CmpOp; right: MathOperand };
export type MathRule = { join: "and" | "or"; conds: MathCondition[]; then: MathOperand };
export type CalcVariable = { name: string; kind: "calc"; start: MathOperand; steps: CalcStep[] };
export type RulesVariable = { name: string; kind: "rules"; rules: MathRule[]; otherwise: MathOperand };
export type MathVariable = CalcVariable | RulesVariable;
export type MathInput = { name: string; signalId: string; value: string }; // "shown" | "register" | <variable name>
export type SignalMath = { version: 1; inputs: MathInput[]; variables: MathVariable[] };
export type MathValue = { kind: "number"; value: number } | { kind: "text"; value: string };
/** `waiting` marks "no value to compute with yet" (nothing typed, no live data): not a real error. */
export type MathResult = { ok: true; value: MathValue } | { ok: false; error: string; waiting?: true };
export type MathIssue = { path: string; message: string }; // path e.g. "variables.1.steps.0.operand"
export type MathValueType = "number" | "text";

export const MATH_LIMITS = { inputs: 20, variables: 30, steps: 20, rules: 20, conds: 10 } as const;
export const MATH_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,15}$/;
export const REGISTER_REF = "register";

const BINARY_OPS: readonly string[] = ["add", "sub", "mul", "div", "mod", "min", "max", "pow"];
const UNARY_OPS: readonly string[] = ["abs", "round", "floor", "ceil", "bit", "neg"];
const CMP_OPS: readonly string[] = ["lt", "le", "eq", "ne", "ge", "gt"];

const NAME_MESSAGE = "name must start with a letter or _ and use only letters, digits, _ (max 16)";

export function emptySignalMath(): SignalMath {
  return { version: 1, inputs: [], variables: [] };
}

// ---------------------------------------------------------------- parsing

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseOperand(raw: unknown): MathOperand | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.ref === "string") return { ref: raw.ref };
  if (typeof raw.num === "number" && Number.isFinite(raw.num)) return { num: raw.num };
  if (typeof raw.text === "string") return { text: raw.text };
  return null;
}

function parseStep(raw: unknown): CalcStep | null {
  if (!isRecord(raw) || typeof raw.op !== "string") return null;
  if (BINARY_OPS.includes(raw.op)) {
    const operand = parseOperand(raw.operand);
    return operand ? { op: raw.op as BinaryOp, operand } : null;
  }
  if (UNARY_OPS.includes(raw.op)) {
    const step: CalcStep = { op: raw.op as UnaryOp };
    if (raw.n !== undefined) {
      if (typeof raw.n !== "number" || !Number.isFinite(raw.n)) return null;
      step.n = raw.n;
    }
    return step;
  }
  return null;
}

function parseCondition(raw: unknown): MathCondition | null {
  if (!isRecord(raw) || typeof raw.cmp !== "string" || !CMP_OPS.includes(raw.cmp)) return null;
  const left = parseOperand(raw.left);
  const right = parseOperand(raw.right);
  return left && right ? { left, cmp: raw.cmp as CmpOp, right } : null;
}

/** All-or-nothing: one malformed child makes the whole list (and so the variable) invalid. */
function parseAll<T>(items: unknown[], parse: (raw: unknown) => T | null): T[] | null {
  const out: T[] = [];
  for (const item of items) {
    const parsed = parse(item);
    if (!parsed) return null;
    out.push(parsed);
  }
  return out;
}

function parseRule(raw: unknown): MathRule | null {
  if (!isRecord(raw) || (raw.join !== "and" && raw.join !== "or")) return null;
  const then = parseOperand(raw.then);
  if (!then) return null;
  if (!Array.isArray(raw.conds)) return null;
  const conds = parseAll(raw.conds, parseCondition);
  return conds ? { join: raw.join, conds, then } : null;
}

function parseVariable(raw: unknown): MathVariable | null {
  if (!isRecord(raw) || typeof raw.name !== "string") return null;
  if (raw.kind === "calc") {
    const start = parseOperand(raw.start);
    if (!start) return null;
    if (!Array.isArray(raw.steps)) return null;
    const steps = parseAll(raw.steps, parseStep);
    return steps ? { name: raw.name, kind: "calc", start, steps } : null;
  }
  if (raw.kind === "rules") {
    const otherwise = parseOperand(raw.otherwise);
    if (!otherwise) return null;
    if (!Array.isArray(raw.rules)) return null;
    const rules = parseAll(raw.rules, parseRule);
    return rules ? { name: raw.name, kind: "rules", rules, otherwise } : null;
  }
  return null;
}

function parseInput(raw: unknown): MathInput | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.name !== "string" || typeof raw.signalId !== "string" || typeof raw.value !== "string") return null;
  return { name: raw.name, signalId: raw.signalId, value: raw.value };
}

/** Tolerant parse of stored JSON; malformed entries are dropped, never thrown. */
export function parseSignalMath(raw: unknown): SignalMath | null {
  if (!isRecord(raw) || raw.version !== 1) return null;
  const inputs = Array.isArray(raw.inputs) ? raw.inputs.map(parseInput).filter((i): i is MathInput => !!i) : [];
  const variables = Array.isArray(raw.variables)
    ? raw.variables.map(parseVariable).filter((v): v is MathVariable => !!v)
    : [];
  return { version: 1, inputs, variables };
}

// ------------------------------------------------------------- references

function operandsOf(v: MathVariable): MathOperand[] {
  if (v.kind === "calc") {
    const out: MathOperand[] = [v.start];
    for (const s of v.steps) if ("operand" in s) out.push(s.operand);
    return out;
  }
  const out: MathOperand[] = [];
  for (const r of v.rules) {
    for (const c of r.conds) out.push(c.left, c.right);
    out.push(r.then);
  }
  out.push(v.otherwise);
  return out;
}

/** Names referenced by a variable, in first-use order, without duplicates. */
export function referencesOf(v: MathVariable): string[] {
  const seen: string[] = [];
  for (const o of operandsOf(v)) {
    if ("ref" in o && !seen.includes(o.ref)) seen.push(o.ref);
  }
  return seen;
}

function renameOperand(o: MathOperand, from: string, to: string): MathOperand {
  return "ref" in o && o.ref === from ? { ref: to } : o;
}

/** Returns a copy with `from` renamed to `to` (variable/input name and every reference). */
export function renameVariable(math: SignalMath, from: string, to: string): SignalMath {
  const rn = (o: MathOperand) => renameOperand(o, from, to);
  const rename = (name: string) => (name === from ? to : name);
  const variables = math.variables.map((v): MathVariable => {
    if (v.kind === "calc") {
      return {
        name: rename(v.name),
        kind: "calc",
        start: rn(v.start),
        steps: v.steps.map((s): CalcStep => ("operand" in s ? { op: s.op, operand: rn(s.operand) } : { ...s })),
      };
    }
    return {
      name: rename(v.name),
      kind: "rules",
      rules: v.rules.map((r) => ({
        join: r.join,
        conds: r.conds.map((c) => ({ left: rn(c.left), cmp: c.cmp, right: rn(c.right) })),
        then: rn(r.then),
      })),
      otherwise: rn(v.otherwise),
    };
  });
  return { version: 1, inputs: math.inputs.map((i) => ({ ...i, name: rename(i.name) })), variables };
}

// ------------------------------------------------------------------ types

/** Inferred type per name (inputs are numbers; rules are text if any output is text). */
export function variableTypes(
  math: SignalMath,
  inputTypes?: Record<string, MathValueType>,
): Record<string, MathValueType> {
  const types = seedTypes(math, inputTypes);
  for (const v of math.variables) types[v.name] = inferType(v, types);
  return types;
}

function newMap<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function has(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function seedTypes(math: SignalMath, inputTypes?: Record<string, MathValueType>): Record<string, MathValueType> {
  const types = newMap<MathValueType>();
  for (const i of math.inputs) types[i.name] = inputTypes && has(inputTypes, i.name) ? inputTypes[i.name] : "number";
  return types;
}

function operandType(o: MathOperand, types: Record<string, MathValueType>): MathValueType {
  if ("text" in o) return "text";
  if ("ref" in o) return has(types, o.ref) ? types[o.ref] : "number"; // register and unknown refs are numeric
  return "number";
}

function inferType(v: MathVariable, types: Record<string, MathValueType>): MathValueType {
  if (v.kind === "calc") return "number";
  const outs = [...v.rules.map((r) => r.then), v.otherwise];
  return outs.some((o) => operandType(o, types) === "text") ? "text" : "number";
}

// ------------------------------------------------------------- validation

/** Static checks; `hasRegister` is false for calculated signals. */
export function validateSignalMath(
  math: SignalMath,
  ctx: { hasRegister: boolean; inputTypes?: Record<string, MathValueType> },
): MathIssue[] {
  const issues: MathIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  const used = new Set<string>();

  const checkName = (path: string, name: string) => {
    if (name === REGISTER_REF) add(path, `"${REGISTER_REF}" is a reserved name`);
    else if (!MATH_NAME_PATTERN.test(name)) add(path, NAME_MESSAGE);
    else if (used.has(name)) add(path, `name "${name}" is already used`);
    used.add(name);
  };

  if (math.inputs.length > MATH_LIMITS.inputs) add("inputs", `at most ${MATH_LIMITS.inputs} inputs`);
  if (math.variables.length > MATH_LIMITS.variables) add("variables", `at most ${MATH_LIMITS.variables} variables`);

  math.inputs.forEach((input, i) => checkName(`inputs.${i}.name`, input.name));

  const inputNames = new Set(math.inputs.map((i) => i.name));
  const laterNames = new Set(math.variables.map((v) => v.name));
  const types = seedTypes(math, ctx.inputTypes);
  const defined = new Set<string>(inputNames);

  const checkRef = (path: string, o: MathOperand) => {
    if (!("ref" in o)) return;
    const name = o.ref;
    if (name === REGISTER_REF) {
      if (!ctx.hasRegister) add(path, "calculated signals have no register value");
    } else if (defined.has(name)) {
      // ok
    } else if (laterNames.has(name)) {
      add(path, `"${name}" is defined below this variable`);
    } else {
      add(path, `unknown name ${name}`);
    }
  };

  math.variables.forEach((v, vi) => {
    const base = `variables.${vi}`;
    checkName(`${base}.name`, v.name);

    if (v.kind === "calc") {
      checkRef(`${base}.start`, v.start);
      const numericOperand = (path: string, o: MathOperand) => {
        if (operandType(o, types) === "text") {
          add(path, "a calculation needs numbers, not text");
        }
      };
      numericOperand(`${base}.start`, v.start);
      if (v.steps.length > MATH_LIMITS.steps) add(`${base}.steps`, `at most ${MATH_LIMITS.steps} steps`);
      v.steps.forEach((s, si) => {
        const sp = `${base}.steps.${si}`;
        if ("operand" in s) {
          checkRef(`${sp}.operand`, s.operand);
          numericOperand(`${sp}.operand`, s.operand);
        } else if (s.op === "bit") {
          if (s.n !== undefined && (!Number.isInteger(s.n) || s.n < 0 || s.n > 52)) add(`${sp}.n`, "bit must be 0–52");
        } else if (s.op === "round") {
          if (s.n !== undefined && (!Number.isInteger(s.n) || s.n < 0 || s.n > 12)) {
            add(`${sp}.n`, "decimals must be 0–12");
          }
        }
      });
    } else {
      if (v.rules.length > MATH_LIMITS.rules) add(`${base}.rules`, `at most ${MATH_LIMITS.rules} rules`);
      v.rules.forEach((r, ri) => {
        const rp = `${base}.rules.${ri}`;
        if (r.conds.length === 0) add(`${rp}.conds`, "a rule needs at least one condition");
        if (r.conds.length > MATH_LIMITS.conds) add(`${rp}.conds`, `at most ${MATH_LIMITS.conds} conditions`);
        r.conds.forEach((c, ci) => {
          const cp = `${rp}.conds.${ci}`;
          checkRef(`${cp}.left`, c.left);
          checkRef(`${cp}.right`, c.right);
          const lt = operandType(c.left, types);
          const rt = operandType(c.right, types);
          if (lt !== rt) add(cp, "cannot compare text with a number");
          else if (lt === "text" && c.cmp !== "eq" && c.cmp !== "ne") add(cp, "text can only be compared with = or ≠");
        });
        checkRef(`${rp}.then`, r.then);
      });
      checkRef(`${base}.otherwise`, v.otherwise);
    }

    types[v.name] = inferType(v, types);
    defined.add(v.name);
  });

  return issues;
}

// ------------------------------------------------------------- evaluation

const fail = (error: string): MathResult => ({ ok: false, error });

export const WAITING_MESSAGE = "waiting for a value";
/** A source with no value yet. Anything computed from it is "waiting" too, never an error. */
export const waitingResult = (): MathResult => ({ ok: false, error: WAITING_MESSAGE, waiting: true });
export const isWaiting = (r: MathResult | undefined | null): boolean => !!r && !r.ok && r.waiting === true;
type Failure = { ok: false; error: string; waiting?: true };
const carry = (r: Failure): MathResult => (r.waiting ? waitingResult() : fail(r.error));
const numberResult = (value: number): MathResult =>
  Number.isFinite(value)
    ? { ok: true, value: { kind: "number", value: value === 0 ? 0 : value } } // value === 0 also folds -0 to 0
    : fail("result is not a finite number");

type Resolved = { ok: true; value: MathValue; label: string } | Failure;

function resolve(o: MathOperand, scope: Map<string, MathResult>): Resolved {
  if ("num" in o) return { ok: true, value: { kind: "number", value: o.num }, label: "number" };
  if ("text" in o) return { ok: true, value: { kind: "text", value: o.text }, label: "text" };
  const found = scope.get(o.ref);
  if (!found) return { ok: false, error: `unknown name ${o.ref}` };
  if (!found.ok) return found.waiting ? found : { ok: false, error: `depends on ${o.ref}, which has an error` };
  return { ok: true, value: found.value, label: o.ref };
}

function resolveNumber(o: MathOperand, scope: Map<string, MathResult>): { ok: true; value: number } | Failure {
  const r = resolve(o, scope);
  if (!r.ok) return r;
  if (r.value.kind !== "number") return { ok: false, error: `${r.label} is text, not a number` };
  return { ok: true, value: r.value.value };
}

function applyBinary(op: BinaryOp, a: number, b: number): MathResult {
  switch (op) {
    case "add":
      return numberResult(a + b);
    case "sub":
      return numberResult(a - b);
    case "mul":
      return numberResult(a * b);
    case "div":
      return b === 0 ? fail("division by zero") : numberResult(a / b);
    case "mod":
      return b === 0 ? fail("division by zero") : numberResult(a % b);
    case "min":
      return numberResult(Math.min(a, b));
    case "max":
      return numberResult(Math.max(a, b));
    case "pow":
      return numberResult(Math.pow(a, b));
  }
}

function applyUnary(op: UnaryOp, a: number, n: number | undefined): MathResult {
  switch (op) {
    case "abs":
      return numberResult(Math.abs(a));
    case "neg":
      return numberResult(-a);
    case "floor":
      return numberResult(Math.floor(a));
    case "ceil":
      return numberResult(Math.ceil(a));
    case "round": {
      if (n !== undefined && (!Number.isInteger(n) || n < 0 || n > 12)) return fail("decimals must be 0–12");
      const f = Math.pow(10, n ?? 0);
      return numberResult(Math.round(a * f) / f);
    }
    case "bit": {
      if (n !== undefined && (!Number.isInteger(n) || n < 0 || n > 52)) return fail("bit must be 0–52");
      if (!Number.isInteger(a) || a < 0) return fail("bit needs a whole number ≥ 0");
      return numberResult(Math.floor(a / Math.pow(2, n ?? 0)) % 2);
    }
  }
}

function evalCalc(v: CalcVariable, scope: Map<string, MathResult>): MathResult {
  const start = resolveNumber(v.start, scope);
  if (!start.ok) return carry(start);
  let acc = start.value;
  for (const step of v.steps) {
    let next: MathResult;
    if ("operand" in step) {
      const rhs = resolveNumber(step.operand, scope);
      if (!rhs.ok) return carry(rhs);
      next = applyBinary(step.op, acc, rhs.value);
    } else {
      next = applyUnary(step.op, acc, step.n);
    }
    if (!next.ok) return next;
    if (next.value.kind !== "number") return fail("result is not a finite number");
    acc = next.value.value;
  }
  return numberResult(acc);
}

function compare(cmp: CmpOp, a: number | string, b: number | string): boolean {
  switch (cmp) {
    case "lt":
      return a < b;
    case "le":
      return a <= b;
    case "eq":
      return a === b;
    case "ne":
      return a !== b;
    case "ge":
      return a >= b;
    case "gt":
      return a > b;
  }
}

function evalCondition(c: MathCondition, scope: Map<string, MathResult>): { ok: true; value: boolean } | Failure {
  const l = resolve(c.left, scope);
  if (!l.ok) return l;
  const r = resolve(c.right, scope);
  if (!r.ok) return r;
  if (l.value.kind !== r.value.kind) return { ok: false, error: "cannot compare text with a number" };
  if (l.value.kind === "text" && c.cmp !== "eq" && c.cmp !== "ne") {
    return { ok: false, error: "text can only be compared with = or ≠" };
  }
  return { ok: true, value: compare(c.cmp, l.value.value, r.value.value) };
}

function evalRules(v: RulesVariable, scope: Map<string, MathResult>): MathResult {
  // An error in any referenced variable propagates, even if its branch is never reached.
  // A real error wins over "waiting for a value".
  let waiting = false;
  for (const name of referencesOf(v)) {
    const found = scope.get(name);
    if (!found) return fail(`unknown name ${name}`);
    if (!found.ok) {
      if (!found.waiting) return fail(`depends on ${name}, which has an error`);
      waiting = true;
    }
  }
  if (waiting) return waitingResult();
  for (const rule of v.rules) {
    let matched = rule.join === "and";
    for (const c of rule.conds) {
      const res = evalCondition(c, scope);
      if (!res.ok) return carry(res);
      if (rule.join === "and" && !res.value) {
        matched = false;
        break;
      }
      if (rule.join === "or" && res.value) {
        matched = true;
        break;
      }
    }
    if (rule.conds.length === 0) matched = false;
    if (matched) return outputOf(rule.then, scope);
  }
  return outputOf(v.otherwise, scope);
}

function outputOf(o: MathOperand, scope: Map<string, MathResult>): MathResult {
  const r = resolve(o, scope);
  return r.ok ? { ok: true, value: r.value } : carry(r);
}

function sanitizeSource(r: MathResult): MathResult {
  if (r.ok && r.value.kind === "number" && !Number.isFinite(r.value.value)) {
    return fail("value is not a finite number");
  }
  return r;
}

/** Evaluates variables top to bottom. Never throws; errors are values. */
export function evaluateSignalMath(
  math: SignalMath,
  sources: { register?: MathResult; inputs: Record<string, MathResult> }, // keyed by input name
): Record<string, MathResult> {
  const scope = new Map<string, MathResult>();
  if (sources.register) scope.set(REGISTER_REF, sanitizeSource(sources.register));
  for (const input of math.inputs) {
    if (has(sources.inputs, input.name)) scope.set(input.name, sanitizeSource(sources.inputs[input.name]));
  }
  const out = newMap<MathResult>();
  for (const v of math.variables) {
    const result = v.kind === "calc" ? evalCalc(v, scope) : evalRules(v, scope);
    out[v.name] = result;
    scope.set(v.name, result);
  }
  return out;
}
