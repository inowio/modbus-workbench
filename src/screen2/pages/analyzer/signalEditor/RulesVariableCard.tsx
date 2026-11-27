import { FiArrowDown, FiArrowUp, FiTrash2 } from "react-icons/fi";
import {
  MATH_LIMITS,
  type CmpOp,
  type MathCondition,
  type MathIssue,
  type MathOperand,
  type MathRule,
  type RulesVariable,
} from "../../../utils/analyzerMath";
import OperandPicker, { type OperandOption } from "./OperandPicker";
import { FIELD_CLASS, GHOST_BTN_CLASS, IconButton, IssueText, KEYWORD_CLASS, issueAt } from "./mathUi";

const CMPS: Array<[CmpOp, string]> = [
  ["lt", "<"],
  ["le", "≤"],
  ["eq", "="],
  ["ne", "≠"],
  ["ge", "≥"],
  ["gt", ">"],
];

export default function RulesVariableCard(props: {
  variable: RulesVariable;
  path: string; // e.g. "variables.2"
  options: OperandOption[];
  issues: MathIssue[];
  onChange: (next: RulesVariable) => void;
}) {
  const { variable, path, options, issues, onChange } = props;
  const name = variable.name;

  const isText = (o: MathOperand) =>
    "text" in o || ("ref" in o && options.find((x) => x.ref === o.ref)?.type === "text");
  const defaultOperand = (): MathOperand => {
    const nums = options.filter((o) => o.type === "number");
    return nums.length ? { ref: nums[nums.length - 1].ref } : { num: 0 };
  };

  const setRule = (i: number, rule: MathRule) => onChange({ ...variable, rules: variable.rules.map((r, j) => (j === i ? rule : r)) });
  const moveRule = (i: number, to: number) => {
    const rules = [...variable.rules];
    [rules[i], rules[to]] = [rules[to], rules[i]];
    onChange({ ...variable, rules });
  };
  const setCond = (ri: number, ci: number, cond: MathCondition) => {
    const rule = variable.rules[ri];
    setRule(ri, { ...rule, conds: rule.conds.map((c, k) => (k === ci ? cond : c)) });
  };

  return (
    <div className="flex flex-col gap-2">
      {variable.rules.map((rule, ri) => {
        const rl = `${name} rule ${ri + 1}`;
        const rp = `${path}.rules.${ri}`;
        return (
          <div key={ri} className="flex flex-col gap-1.5 rounded-xl border border-slate-200 p-2 dark:border-slate-800">
            {rule.conds.map((cond, ci) => {
              const cl = `${rl} condition ${ci + 1}`;
              const cp = `${rp}.conds.${ci}`;
              const textLeft = isText(cond.left);
              const cmps = textLeft ? CMPS.filter(([k]) => k === "eq" || k === "ne") : CMPS;
              return (
                <div key={ci} className="flex flex-wrap items-center gap-1.5">
                  {ci === 0 ? (
                    <span className={KEYWORD_CLASS}>IF</span>
                  ) : (
                    <select
                      aria-label={`${rl} join`}
                      className={`${FIELD_CLASS} font-semibold text-sky-600 dark:text-sky-400`}
                      value={rule.join}
                      onChange={(e) => setRule(ri, { ...rule, join: e.currentTarget.value === "or" ? "or" : "and" })}
                    >
                      <option value="and">AND</option>
                      <option value="or">OR</option>
                    </select>
                  )}
                  <OperandPicker
                    ariaLabel={`${cl} left`}
                    value={cond.left}
                    options={options}
                    allowNumber
                    allowText
                    onChange={(left) => {
                      const cmp = isText(left) && cond.cmp !== "eq" && cond.cmp !== "ne" ? "eq" : cond.cmp;
                      setCond(ri, ci, { ...cond, left, cmp });
                    }}
                  />
                  <select
                    aria-label={`${cl} comparison`}
                    className={FIELD_CLASS}
                    value={cond.cmp}
                    onChange={(e) => setCond(ri, ci, { ...cond, cmp: e.currentTarget.value as CmpOp })}
                  >
                    {cmps.map(([k, text]) => (
                      <option key={k} value={k}>
                        {text}
                      </option>
                    ))}
                  </select>
                  <OperandPicker
                    ariaLabel={`${cl} right`}
                    value={cond.right}
                    options={options}
                    allowNumber
                    allowText
                    onChange={(right) => setCond(ri, ci, { ...cond, right })}
                  />
                  {rule.conds.length > 1 && (
                    <IconButton
                      label={`Delete ${cl}`}
                      onClick={() => setRule(ri, { ...rule, conds: rule.conds.filter((_, k) => k !== ci) })}
                    >
                      <FiTrash2 />
                    </IconButton>
                  )}
                  <IssueText message={issueAt(issues, `${cp}.left`) ?? issueAt(issues, `${cp}.right`) ?? issueAt(issues, cp)} />
                </div>
              );
            })}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                aria-label={`Add condition to ${rl}`}
                className={GHOST_BTN_CLASS}
                disabled={rule.conds.length >= MATH_LIMITS.conds}
                title={rule.conds.length >= MATH_LIMITS.conds ? `At most ${MATH_LIMITS.conds} conditions` : undefined}
                onClick={() => {
                  const prev = rule.conds[rule.conds.length - 1];
                  setRule(ri, { ...rule, conds: [...rule.conds, { left: prev?.left ?? defaultOperand(), cmp: "lt", right: { num: 0 } }] });
                }}
              >
                + AND / OR condition
              </button>
              <span className={KEYWORD_CLASS}>THEN</span>
              <OperandPicker ariaLabel={`${rl} then`} value={rule.then} options={options} allowNumber allowText onChange={(then) => setRule(ri, { ...rule, then })} />
              <IssueText message={issueAt(issues, `${rp}.then`) ?? issueAt(issues, `${rp}.conds`)} />
              <span className="ml-auto flex">
                <IconButton label={`Move ${rl} up`} disabled={ri === 0} onClick={() => moveRule(ri, ri - 1)}>
                  <FiArrowUp />
                </IconButton>
                <IconButton label={`Move ${rl} down`} disabled={ri === variable.rules.length - 1} onClick={() => moveRule(ri, ri + 1)}>
                  <FiArrowDown />
                </IconButton>
                <IconButton label={`Delete ${rl}`} onClick={() => onChange({ ...variable, rules: variable.rules.filter((_, j) => j !== ri) })}>
                  <FiTrash2 />
                </IconButton>
              </span>
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-label={`Add rule to ${name}`}
          className={GHOST_BTN_CLASS}
          disabled={variable.rules.length >= MATH_LIMITS.rules}
          title={variable.rules.length >= MATH_LIMITS.rules ? `At most ${MATH_LIMITS.rules} rules` : undefined}
          onClick={() =>
            onChange({
              ...variable,
              rules: [...variable.rules, { join: "and", conds: [{ left: defaultOperand(), cmp: "lt", right: { num: 0 } }], then: { num: 0 } }],
            })
          }
        >
          + add rule
        </button>
        <IssueText message={issueAt(issues, `${path}.rules`)} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className={KEYWORD_CLASS}>OTHERWISE</span>
        <OperandPicker ariaLabel={`${name} otherwise`} value={variable.otherwise} options={options} allowNumber allowText onChange={(otherwise) => onChange({ ...variable, otherwise })} />
        <IssueText message={issueAt(issues, `${path}.otherwise`)} />
      </div>
    </div>
  );
}
