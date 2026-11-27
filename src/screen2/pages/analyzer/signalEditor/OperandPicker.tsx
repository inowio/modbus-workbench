import type { MathOperand, MathValueType } from "../../../utils/analyzerMath";
import { FIELD_CLASS, NumberBox } from "./mathUi";

const NUM = "#num";
const TEXT = "#text";

export type OperandOption = { ref: string; label: string; type: MathValueType };

export default function OperandPicker(props: {
  value: MathOperand;
  options: OperandOption[];
  allowNumber: boolean;
  allowText: boolean;
  onChange: (o: MathOperand) => void;
  ariaLabel: string;
}) {
  const { value, options, allowNumber, allowText, onChange, ariaLabel } = props;
  const selectValue = "ref" in value ? value.ref : "num" in value ? NUM : TEXT;
  const missing = "ref" in value && !options.some((o) => o.ref === value.ref);

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <select
        aria-label={ariaLabel}
        className={`${FIELD_CLASS} max-w-44`}
        value={selectValue}
        onChange={(e) => {
          const next = e.currentTarget.value;
          if (next === NUM) onChange({ num: 0 });
          else if (next === TEXT) onChange({ text: "" });
          else onChange({ ref: next });
        }}
      >
        {missing && <option value={(value as { ref: string }).ref}>{(value as { ref: string }).ref}</option>}
        {options.map((o) => (
          <option key={o.ref} value={o.ref}>
            {o.label}
          </option>
        ))}
        {(allowNumber || "num" in value) && <option value={NUM}>Number…</option>}
        {(allowText || "text" in value) && <option value={TEXT}>Text…</option>}
      </select>
      {"num" in value && <NumberBox ariaLabel={`${ariaLabel} number`} value={value.num} onChange={(n) => onChange({ num: n })} />}
      {"text" in value && (
        <input
          aria-label={`${ariaLabel} text`}
          className={`${FIELD_CLASS} w-32`}
          value={value.text}
          placeholder="text"
          onChange={(e) => onChange({ text: e.currentTarget.value })}
        />
      )}
    </span>
  );
}
