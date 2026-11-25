import { FiArrowDown, FiArrowUp, FiTrash2 } from "react-icons/fi";
import {
  MATH_LIMITS,
  type BinaryOp,
  type CalcStep,
  type CalcVariable,
  type MathIssue,
  type UnaryOp,
} from "../../../utils/analyzerMath";
import OperandPicker, { type OperandOption } from "./OperandPicker";
import { FIELD_CLASS, GHOST_BTN_CLASS, IconButton, IssueText, NumberBox, issueAt } from "./mathUi";

const BINARY: Array<[BinaryOp, string]> = [
  ["add", "+"],
  ["sub", "−"],
  ["mul", "×"],
  ["div", "÷"],
  ["mod", "% (remainder)"],
  ["min", "min"],
  ["max", "max"],
  ["pow", "power"],
];
const UNARY: Array<[UnaryOp, string]> = [
  ["abs", "abs"],
  ["round", "round to N decimals"],
  ["floor", "floor"],
  ["ceil", "ceil"],
  ["bit", "bit N of"],
  ["neg", "negate"],
];
const isBinary = (op: string): op is BinaryOp => BINARY.some(([k]) => k === op);

function changeOp(step: CalcStep, op: string): CalcStep {
  if (isBinary(op)) return { op, operand: "operand" in step ? step.operand : { num: 0 } };
  const unary = op as UnaryOp;
  return unary === "round" || unary === "bit" ? { op: unary, n: 0 } : { op: unary };
}

export default function CalcVariableCard(props: {
  variable: CalcVariable;
  path: string; // e.g. "variables.1"
  options: OperandOption[];
  issues: MathIssue[];
  onChange: (next: CalcVariable) => void;
}) {
  const { variable, path, options, issues, onChange } = props;
  const name = variable.name;
  const setStep = (i: number, step: CalcStep) =>
    onChange({ ...variable, steps: variable.steps.map((s, j) => (j === i ? step : s)) });
  const moveStep = (i: number, to: number) => {
    const steps = [...variable.steps];
    [steps[i], steps[to]] = [steps[to], steps[i]];
    onChange({ ...variable, steps });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">=</span>
        <OperandPicker
          ariaLabel={`${name} start`}
          value={variable.start}
          options={options}
          allowNumber
          allowText={false}
          onChange={(start) => onChange({ ...variable, start })}
        />
        <IssueText message={issueAt(issues, `${path}.start`)} />
      </div>

      {variable.steps.map((step, i) => {
        const label = `${name} step ${i + 1}`;
        const sp = `${path}.steps.${i}`;
        return (
          <div key={i} className="flex flex-wrap items-center gap-1.5 pl-4">
            <select
              aria-label={`${label} operation`}
              className={FIELD_CLASS}
              value={step.op}
              onChange={(e) => setStep(i, changeOp(step, e.currentTarget.value))}
            >
              <optgroup label="Combine with a value">
                {BINARY.map(([k, text]) => (
                  <option key={k} value={k}>
                    {text}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Change the running value">
                {UNARY.map(([k, text]) => (
                  <option key={k} value={k}>
                    {text}
                  </option>
                ))}
              </optgroup>
            </select>
            {"operand" in step ? (
              <>
                <OperandPicker
                  ariaLabel={`${label} value`}
                  value={step.operand}
                  options={options}
                  allowNumber
                  allowText={false}
                  onChange={(operand) => setStep(i, { op: step.op, operand })}
                />
                <IssueText message={issueAt(issues, `${sp}.operand`)} />
              </>
            ) : (
              (step.op === "round" || step.op === "bit") && (
                <>
                  <NumberBox
                    ariaLabel={`${label} ${step.op === "round" ? "decimals" : "bit number"}`}
                    value={step.n ?? 0}
                    onChange={(n) => setStep(i, { op: step.op, n })}
                  />
                  <span className="text-xs text-slate-500 dark:text-slate-400">{step.op === "round" ? "decimals" : "(0 = lowest)"}</span>
                  <IssueText message={issueAt(issues, `${sp}.n`)} />
                </>
              )
            )}
            <span className="ml-auto flex">
              <IconButton label={`Move ${label} up`} disabled={i === 0} onClick={() => moveStep(i, i - 1)}>
                <FiArrowUp />
              </IconButton>
              <IconButton label={`Move ${label} down`} disabled={i === variable.steps.length - 1} onClick={() => moveStep(i, i + 1)}>
                <FiArrowDown />
              </IconButton>
              <IconButton label={`Delete ${label}`} onClick={() => onChange({ ...variable, steps: variable.steps.filter((_, j) => j !== i) })}>
                <FiTrash2 />
              </IconButton>
            </span>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-3 pl-4">
        <button
          type="button"
          aria-label={`Add operation to ${name}`}
          className={GHOST_BTN_CLASS}
          disabled={variable.steps.length >= MATH_LIMITS.steps}
          title={variable.steps.length >= MATH_LIMITS.steps ? `At most ${MATH_LIMITS.steps} operations` : undefined}
          onClick={() => onChange({ ...variable, steps: [...variable.steps, { op: "add", operand: { num: 0 } }] })}
        >
          + add operation
        </button>
        <IssueText message={issueAt(issues, `${path}.steps`)} />
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">Steps run left to right — use another variable to group.</p>
    </div>
  );
}
