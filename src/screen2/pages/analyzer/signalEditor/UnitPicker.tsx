import { useEffect, useRef, useState } from "react";
import { UNIT_GROUPS, isKnownUnit } from "./units";

const CUSTOM_VALUE = "__custom__";
const FIELD_CLASS =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60";

export default function UnitPicker(props: { value: string; onChange: (unit: string) => void; id?: string; disabled?: boolean }) {
  const { value, onChange, id, disabled } = props;
  const [customMode, setCustomMode] = useState(() => value !== "" && !isKnownUnit(value));

  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the mode in sync when the parent changes `value` while mounted.
  useEffect(() => {
    if (value !== "" && !isKnownUnit(value)) {
      setCustomMode(true);
    } else if (document.activeElement !== inputRef.current) {
      setCustomMode(false);
    }
  }, [value]);

  const selectValue = customMode ? CUSTOM_VALUE : value;

  return (
    <div className="flex flex-col gap-1">
      <select
        id={id}
        className={FIELD_CLASS}
        disabled={disabled}
        value={selectValue}
        onChange={(e) => {
          const next = e.currentTarget.value;
          if (next === CUSTOM_VALUE) {
            setCustomMode(true);
            return;
          }
          setCustomMode(false);
          onChange(next);
        }}
      >
        <option value="">None</option>
        {UNIT_GROUPS.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.units.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </optgroup>
        ))}
        <option value={CUSTOM_VALUE}>Custom…</option>
      </select>
      {customMode && (
        <input
          ref={inputRef}
          className={FIELD_CLASS}
          aria-label="Custom unit"
          maxLength={16}
          disabled={disabled}
          value={value}
          placeholder="Custom unit"
          onChange={(e) => onChange(e.currentTarget.value)}
        />
      )}
    </div>
  );
}
