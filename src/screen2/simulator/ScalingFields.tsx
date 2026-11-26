import UnitPicker from "../pages/analyzer/signalEditor/UnitPicker";
import { engFromRaw, formatEng, registerScaling } from "./scaling";

/** Scaling inputs as typed; an empty field means "default" (stored as null/absent). */
export type ScalingText = { scale: string; offset: string; decimals: string };

export const EMPTY_SCALING_TEXT: ScalingText = { scale: "", offset: "", decimals: "" };

type ScalingStored = { scale?: number | null; scaleOffset?: number | null; decimals?: number | null };

export function scalingTexts(r: ScalingStored): ScalingText {
  return {
    scale: r.scale == null ? "" : String(r.scale),
    offset: r.scaleOffset == null ? "" : String(r.scaleOffset),
    decimals: r.decimals == null ? "" : String(r.decimals),
  };
}

/** Empty = default (null); otherwise a finite number, else undefined (invalid). */
export function parseOptionalNumber(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export type ScalingCheck = {
  scale: number | null | undefined;
  offset: number | null | undefined;
  decimals: number | null | undefined;
  scaleError: string | null;
  offsetError: string | null;
  decimalsError: string | null;
  /** First error, or null when everything is valid. Bit banks never error. */
  error: string | null;
};

export function validateScaling(text: ScalingText, isBitBank: boolean): ScalingCheck {
  const scale = parseOptionalNumber(text.scale);
  const offset = parseOptionalNumber(text.offset);
  const decimals = parseOptionalNumber(text.decimals);
  const scaleError = isBitBank
    ? null
    : scale === undefined
      ? "Scale must be a number."
      : scale === 0
        ? "Scale can't be zero."
        : null;
  const offsetError = !isBitBank && offset === undefined ? "Offset must be a number." : null;
  const decimalsError =
    !isBitBank && (decimals === undefined || (decimals !== null && (!Number.isInteger(decimals) || decimals < 0 || decimals > 6)))
      ? "Decimals must be a whole number from 0 to 6 (or empty for automatic)."
      : null;
  return { scale, offset, decimals, scaleError, offsetError, decimalsError, error: scaleError ?? offsetError ?? decimalsError };
}

/** Raw value previewed when there is no hold/live value to convert. */
const SAMPLE_RAW = 1000;

/** The Scaling block shared by the simulator side panel and the virtual-device editor. */
export default function ScalingFields(props: {
  dataType: string;
  unit: string | null | undefined;
  onUnitChange: (unit: string) => void;
  text: ScalingText;
  onTextChange: (field: keyof ScalingText, text: string) => void;
  check: ScalingCheck;
  /** Raw value the preview line converts; null (no meaningful value) shows a sample raw. */
  previewRaw: number | null;
  /** Suffix for accessible names (e.g. " 2"); empty keeps "Scale", "Offset", "Decimals". */
  nameSuffix?: string;
  /** Accessible name of the offset field (the virtual-device editor already has a register "Offset"). */
  offsetName?: string;
  unitInputId?: string;
  labelClass: string;
  inputClass: string;
  className?: string;
}) {
  const { text, check, nameSuffix = "", labelClass, inputClass } = props;
  const sc = registerScaling({
    dataType: props.dataType,
    unit: props.unit,
    scale: check.scale ?? null,
    scaleOffset: check.offset ?? null,
    decimals: check.decimals ?? null,
  });
  const bad = (e: string | null) => (e ? "border-rose-500 dark:border-rose-500" : "");
  const unitId = props.unitInputId ?? "register-unit";
  const previewRaw = props.previewRaw ?? SAMPLE_RAW;
  return (
    <fieldset className={props.className ?? "col-span-2 space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800"}>
      <legend className="px-1 text-xs font-semibold text-slate-600 dark:text-slate-300">Scaling</legend>
      <div className="grid grid-cols-2 gap-2">
        <div className={`col-span-2 ${labelClass}`}>
          <label htmlFor={unitId}>Unit</label>
          <UnitPicker id={unitId} value={props.unit ?? ""} onChange={props.onUnitChange} />
        </div>
        <label className={labelClass}>
          Scale
          <input
            aria-label={`Scale${nameSuffix}`}
            type="text"
            inputMode="decimal"
            value={text.scale}
            placeholder="1"
            aria-invalid={check.scaleError ? "true" : undefined}
            onChange={(e) => props.onTextChange("scale", e.target.value)}
            className={`${inputClass} ${bad(check.scaleError)}`}
          />
        </label>
        <label className={labelClass}>
          Offset
          <input
            aria-label={`${props.offsetName ?? "Offset"}${nameSuffix}`}
            type="text"
            inputMode="decimal"
            value={text.offset}
            placeholder="0"
            aria-invalid={check.offsetError ? "true" : undefined}
            onChange={(e) => props.onTextChange("offset", e.target.value)}
            className={`${inputClass} ${bad(check.offsetError)}`}
          />
        </label>
        <label className={labelClass}>
          Decimals
          <input
            aria-label={`Decimals${nameSuffix}`}
            type="text"
            inputMode="numeric"
            value={text.decimals}
            placeholder="auto"
            aria-invalid={check.decimalsError ? "true" : undefined}
            onChange={(e) => props.onTextChange("decimals", e.target.value)}
            className={`${inputClass} ${bad(check.decimalsError)}`}
          />
        </label>
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        {check.error ? "—" : `raw ${previewRaw} = ${formatEng(engFromRaw(previewRaw, sc.scale, sc.offset), sc.decimals, sc.unit, sc.trim)}`}
      </p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Value = raw × scale + offset. Generator, preset and rule values are entered in these units.
      </p>
    </fieldset>
  );
}
