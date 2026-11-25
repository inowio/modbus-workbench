import { describe, expect, it } from "vitest";
import {
  evaluateSignalMath,
  parseSignalMath,
  referencesOf,
  renameVariable,
  validateSignalMath,
  variableTypes,
  type CalcStep,
  type MathCondition,
  type MathOperand,
  type MathResult,
  type MathRule,
  type MathVariable,
  type SignalMath,
} from "./analyzerMath";

const num = (value: number): MathResult => ({ ok: true, value: { kind: "number", value } });
const ref = (name: string): MathOperand => ({ ref: name });
const n = (value: number): MathOperand => ({ num: value });
const t = (text: string): MathOperand => ({ text });
const calc = (name: string, start: MathOperand, steps: CalcStep[] = []): MathVariable => ({
  name,
  kind: "calc",
  start,
  steps,
});
const cond = (left: MathOperand, cmp: MathCondition["cmp"], right: MathOperand): MathCondition => ({
  left,
  cmp,
  right,
});
const rule = (conds: MathCondition[], then: MathOperand, join: MathRule["join"] = "and"): MathRule => ({
  join,
  conds,
  then,
});
const rules = (name: string, rs: MathRule[], otherwise: MathOperand): MathVariable => ({
  name,
  kind: "rules",
  rules: rs,
  otherwise,
});
const mathOf = (variables: MathVariable[], inputs: SignalMath["inputs"] = []): SignalMath => ({
  version: 1,
  inputs,
  variables,
});
const run = (variables: MathVariable[], register = 0) =>
  evaluateSignalMath(mathOf(variables), { register: num(register), inputs: {} });
const numberOf = (r: MathResult | undefined) => {
  if (!r || !r.ok || r.value.kind !== "number") throw new Error(`not a number: ${JSON.stringify(r)}`);
  return r.value.value;
};
const errorOf = (r: MathResult | undefined) => {
  if (!r || r.ok) throw new Error(`not an error: ${JSON.stringify(r)}`);
  return r.error;
};
const messages = (m: SignalMath, hasRegister = true) => validateSignalMath(m, { hasRegister }).map((i) => i.message);

const example2Rules = (subject: string) =>
  rules(
    "z",
    [
      rule([cond(ref(subject), "lt", n(20))], t("Low")),
      rule([cond(ref(subject), "ge", n(20)), cond(ref(subject), "lt", n(40))], t("Medium")),
      rule([cond(ref(subject), "ge", n(40)), cond(ref(subject), "lt", n(60))], t("High")),
      rule([cond(ref(subject), "ge", n(60)), cond(ref(subject), "lt", n(80))], t("Critical")),
    ],
    t("Unknown"),
  );

describe("analyzerMath evaluation", () => {
  it("example 1: x = register, y = x ÷ 10 gives 32.8", () => {
    const out = run([calc("x", ref("register")), calc("y", ref("x"), [{ op: "div", operand: n(10) }])], 328);
    expect(numberOf(out.x)).toBe(328);
    expect(numberOf(out.y)).toBe(32.8);
  });

  it("example 2: rules on y gives Medium; on x falls to OTHERWISE Unknown", () => {
    const base = [calc("x", ref("register")), calc("y", ref("x"), [{ op: "div", operand: n(10) }])];
    const onY = run([...base, example2Rules("y")], 328);
    expect(onY.z).toEqual({ ok: true, value: { kind: "text", value: "Medium" } });
    const onX = run([...base, example2Rules("x")], 328);
    expect(onX.z).toEqual({ ok: true, value: { kind: "text", value: "Unknown" } });
  });

  it("evaluates left to right without precedence", () => {
    const out = run([
      calc("a", n(2), [
        { op: "add", operand: n(3) },
        { op: "mul", operand: n(4) },
      ]),
    ]);
    expect(numberOf(out.a)).toBe(20);
  });

  it("binary ops", () => {
    const ops = ["add", "sub", "mul", "div", "mod", "min", "max", "pow"] as const;
    const expected = [9, 5, 14, 3.5, 1, 2, 7, 49];
    ops.forEach((op, i) => {
      const out = run([calc("a", n(7), [{ op, operand: n(2) }])]);
      expect(numberOf(out.a)).toBe(expected[i]);
    });
  });

  it("unary ops", () => {
    const one = (start: number, step: CalcStep) => numberOf(run([calc("a", n(start), [step])]).a);
    expect(one(-3.5, { op: "abs" })).toBe(3.5);
    expect(one(3.14159, { op: "round", n: 2 })).toBe(3.14);
    expect(one(-1.5, { op: "floor" })).toBe(-2);
    expect(one(1.2, { op: "ceil" })).toBe(2);
    expect(one(4, { op: "neg" })).toBe(-4);
    expect(one(10, { op: "bit", n: 3 })).toBe(1);
    expect(one(10, { op: "bit", n: 0 })).toBe(0);
    expect(one(2 ** 52, { op: "bit", n: 52 })).toBe(1);
  });

  it("errors", () => {
    const err = (v: MathVariable[]) => errorOf(run(v).a);
    expect(err([calc("a", n(1), [{ op: "div", operand: n(0) }])])).toBe("division by zero");
    expect(err([calc("a", n(1), [{ op: "mod", operand: n(0) }])])).toBe("division by zero");
    expect(err([calc("a", n(10), [{ op: "pow", operand: n(400) }])])).toBe("result is not a finite number");
    expect(err([calc("a", n(2.5), [{ op: "bit", n: 3 }])])).toBe("bit needs a whole number ≥ 0");
    expect(err([calc("a", ref("q"))])).toBe("unknown name q");
    const out = run([rules("z", [], t("hi")), calc("a", ref("z"))]);
    expect(errorOf(out.a)).toBe("z is text, not a number");
  });

  it("error propagates", () => {
    const out = run([
      calc("y", n(1), [{ op: "div", operand: n(0) }]),
      calc("w", ref("y"), [{ op: "add", operand: n(1) }]),
    ]);
    expect(errorOf(out.w)).toBe("depends on y, which has an error");
  });

  it("uses inputs and propagates input errors", () => {
    const m = mathOf(
      [calc("p", ref("V"), [{ op: "mul", operand: ref("A") }])],
      [
        { name: "V", signalId: "s1", value: "shown" },
        { name: "A", signalId: "s2", value: "shown" },
      ],
    );
    expect(numberOf(evaluateSignalMath(m, { inputs: { V: num(2), A: num(5) } }).p)).toBe(10);
    const bad = evaluateSignalMath(m, { inputs: { V: num(2), A: { ok: false, error: "Disconnected" } } });
    expect(errorOf(bad.p)).toBe("depends on A, which has an error");
  });

  it("OR join and first match wins", () => {
    const out = run(
      [
        rules(
          "o",
          [rule([cond(ref("register"), "gt", n(100)), cond(ref("register"), "lt", n(5))], t("edge"), "or")],
          t("mid"),
        ),
        rules(
          "f",
          [rule([cond(n(1), "eq", n(1))], t("first")), rule([cond(n(1), "eq", n(1))], t("second"))],
          t("none"),
        ),
      ],
      3,
    );
    expect(out.o).toEqual({ ok: true, value: { kind: "text", value: "edge" } });
    expect(out.f).toEqual({ ok: true, value: { kind: "text", value: "first" } });
  });

  it("text comparison is exact and only = / ≠", () => {
    const eq = (a: string, b: string) => run([rules("r", [rule([cond(t(a), "eq", t(b))], n(1))], n(0))]).r;
    expect(numberOf(eq("High", "High"))).toBe(1);
    expect(numberOf(eq("high", "High"))).toBe(0);
    const m = mathOf([rules("r", [rule([cond(t("a"), "lt", t("b"))], n(1))], n(0))]);
    expect(messages(m)).toContain("text can only be compared with = or ≠");
  });

  it("comparing text with a number is an error", () => {
    const out = run([rules("r", [rule([cond(t("a"), "eq", n(1))], n(1))], n(0))]);
    expect(errorOf(out.r)).toBe("cannot compare text with a number");
  });
});

describe("analyzerMath validation and helpers", () => {
  it("validate", () => {
    expect(messages(mathOf([calc("1x", n(1))]))).toContain(
      "name must start with a letter or _ and use only letters, digits, _ (max 16)",
    );
    expect(messages(mathOf([calc("x", n(1)), calc("x", n(2))]))).toContain('name "x" is already used');
    expect(messages(mathOf([calc("register", n(1))]))).toContain('"register" is a reserved name');
    expect(messages(mathOf([calc("x", ref("y")), calc("y", n(1))]))).toContain('"y" is defined below this variable');
    const many = Array.from({ length: 31 }, (_, i) => calc(`v${i}`, n(i)));
    expect(messages(mathOf(many))).toContain("at most 30 variables");
    expect(messages(mathOf([rules("r", [rule([], n(1))], n(0))]))).toContain("a rule needs at least one condition");
    expect(messages(mathOf([calc("a", n(1), [{ op: "bit", n: 53 }])]))).toContain("bit must be 0–52");
    expect(messages(mathOf([calc("a", n(1), [{ op: "round", n: 13 }])]))).toContain("decimals must be 0–12");
    expect(messages(mathOf([calc("a", ref("register"))]), false)).toContain(
      "calculated signals have no register value",
    );
    expect(messages(mathOf([calc("a", ref("register"))]), true)).toEqual([]);
    const issues = validateSignalMath(mathOf([calc("a", n(1), [{ op: "bit", n: 53 }])]), { hasRegister: true });
    expect(issues[0].path).toBe("variables.0.steps.0.n");
  });

  it("variableTypes", () => {
    const m = mathOf(
      [
        calc("c", n(1)),
        rules("nums", [rule([cond(n(1), "eq", n(1))], n(1))], ref("c")),
        rules("txt", [rule([cond(n(1), "eq", n(1))], n(1))], t("x")),
        rules("inh", [rule([cond(n(1), "eq", n(1))], ref("txt"))], n(0)),
      ],
      [{ name: "V", signalId: "s", value: "shown" }],
    );
    expect(variableTypes(m)).toEqual({ V: "number", c: "number", nums: "number", txt: "text", inh: "text" });
  });

  it("renameVariable rewrites every reference in the signal", () => {
    const m = mathOf([
      calc("x", ref("register")),
      calc("y", ref("x"), [{ op: "add", operand: ref("x") }]),
      rules("z", [rule([cond(ref("x"), "lt", ref("x"))], ref("x"))], ref("x")),
    ]);
    const out = renameVariable(m, "x", "k");
    expect(out.variables.map((v) => v.name)).toEqual(["k", "y", "z"]);
    expect(out.variables.flatMap(referencesOf).filter((r) => r === "x")).toEqual([]);
    expect(referencesOf(out.variables[2])).toEqual(["k"]);
    expect(m.variables[0].name).toBe("x"); // original untouched
    expect(numberOf(evaluateSignalMath(out, { register: num(4), inputs: {} }).y)).toBe(8);
  });

  it("parseSignalMath tolerates junk", () => {
    for (const junk of [null, undefined, {}, 5, "x", [], { version: 2 }, { version: 1, inputs: 3, variables: "no" }]) {
      expect(() => parseSignalMath(junk)).not.toThrow();
    }
    expect(parseSignalMath(null)).toBeNull();
    expect(parseSignalMath({})).toBeNull();
    expect(parseSignalMath("x")).toBeNull();
    const parsed = parseSignalMath({
      version: 1,
      inputs: [{ name: "V", signalId: "s", value: "shown" }, { name: 3 }],
      variables: [
        { name: "x", kind: "calc", start: { ref: "register" }, steps: [{ op: "add", operand: { num: 1 } }] },
        { name: "bad", kind: "nope" },
        { name: "r", kind: "rules", rules: [{ join: "and", conds: [], then: { num: 1 } }], otherwise: { text: "a" } },
        "junk",
      ],
    });
    expect(parsed?.inputs).toHaveLength(1);
    expect(parsed?.variables.map((v) => v.name)).toEqual(["x", "r"]);
  });

  it("parseSignalMath drops the whole variable when any child is malformed", () => {
    const parsed = parseSignalMath({
      version: 1,
      inputs: [],
      variables: [
        { name: "y", kind: "calc", start: { num: 1 }, steps: [{ op: "div", operand: { num: "10" } }] },
        { name: "u", kind: "calc", start: { num: 1 }, steps: [{ op: "bogus" }] },
        { name: "b", kind: "calc", start: { num: 1 }, steps: [{ op: "bit", n: "3" }] },
        { name: "j", kind: "rules", rules: [{ join: "xor", conds: [], then: { num: 1 } }], otherwise: { num: 0 } },
        { name: "c", kind: "rules", rules: [{ join: "and", conds: [{ left: { num: 1 }, cmp: "zz", right: { num: 1 } }], then: { num: 1 } }], otherwise: { num: 0 } },
        { name: "w", kind: "calc", start: { ref: "y" }, steps: [] },
      ],
    });
    expect(parsed?.variables.map((v) => v.name)).toEqual(["w"]);
    expect(errorOf(evaluateSignalMath(parsed as SignalMath, { inputs: {} }).w)).toBe("unknown name y");
  });
});

describe("analyzerMath fix round 1", () => {
  const rs = (outcome: MathOperand) => rules("r", [rule([cond(ref("register"), "gt", n(80))], t("Alarm"))], outcome);

  it("non-finite sources are errors", () => {
    const nan = evaluateSignalMath(mathOf([rs(t("OK"))]), { register: num(NaN), inputs: {} });
    expect(errorOf(nan.r)).toBe("depends on register, which has an error");
    const inf = evaluateSignalMath(mathOf([rules("r", [], ref("register"))]), { register: num(Infinity), inputs: {} });
    expect(errorOf(inf.r)).toBe("depends on register, which has an error");
    const direct = evaluateSignalMath(mathOf([calc("a", ref("register"))]), { register: num(NaN), inputs: {} });
    expect(errorOf(direct.a)).toBe("depends on register, which has an error");
  });

  it("rules propagate errors from referenced variables even if unreached", () => {
    const bad = calc("y", n(1), [{ op: "div", operand: n(0) }]);
    const cond1 = run([bad, rules("r", [rule([cond(n(1), "eq", n(1)), cond(ref("y"), "lt", n(5))], n(1), "or")], n(0))]);
    expect(errorOf(cond1.r)).toBe("depends on y, which has an error");
    const other = run([bad, rules("r", [rule([cond(n(1), "eq", n(1))], n(1))], ref("y"))]);
    expect(errorOf(other.r)).toBe("depends on y, which has an error");
  });

  it("inputs can be text", () => {
    const m = (c: MathCondition) => mathOf([rules("r", [rule([c], n(1))], n(0))], [{ name: "V", signalId: "s", value: "z" }]);
    const ctx = { hasRegister: false, inputTypes: { V: "text" as const } };
    expect(validateSignalMath(m(cond(ref("V"), "eq", t("High"))), ctx)).toEqual([]);
    expect(validateSignalMath(m(cond(ref("V"), "lt", n(3))), ctx).map((i) => i.message)).toContain(
      "cannot compare text with a number",
    );
    expect(variableTypes(mathOf([rules("q", [], ref("V"))], [{ name: "V", signalId: "s", value: "z" }]), { V: "text" }).q).toBe("text");
  });

  it("prototype-ish names are ordinary", () => {
    const out = run([calc("__proto__", n(1)), calc("constructor", ref("__proto__"))]);
    expect(Object.keys(out)).toEqual(["__proto__", "constructor"]);
    expect(numberOf((out as Record<string, MathResult>)["constructor"])).toBe(1);
    const m = mathOf([calc("a", ref("toString"))], [{ name: "toString", signalId: "s", value: "shown" }]);
    expect(errorOf(evaluateSignalMath(m, { inputs: {} }).a)).toBe("unknown name toString");
  });

  it("runtime guards n and normalises -0", () => {
    expect(errorOf(run([calc("a", n(1), [{ op: "bit", n: 60 }])]).a)).toBe("bit must be 0–52");
    expect(errorOf(run([calc("a", n(1), [{ op: "bit", n: 1.5 }])]).a)).toBe("bit must be 0–52");
    expect(errorOf(run([calc("a", n(1), [{ op: "round", n: 13 }])]).a)).toBe("decimals must be 0–12");
    const z = numberOf(run([calc("a", n(-0.4), [{ op: "round", n: 0 }])]).a);
    expect(Object.is(z, 0)).toBe(true);
  });
});
