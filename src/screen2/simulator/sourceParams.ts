import { bankName, fmtAddr, type AddrFmt } from "./ruleTargets";
import { engFromRaw, formatEng, isIdentityScaling, registerScaling, type ScalableRegister } from "./scaling";

// Shared source-param helpers for the register editor (RegisterInspector).

export type SourceParams = {
  kind?: string;
  preset?: string;
  min?: number;
  max?: number;
  periodMs?: number;
  slaveUnitId?: number;
  connectionKind?: string;
  functionCode?: number;
  address?: number;
  scale?: number;
  offset?: number;
  srcByteOrder?: string;
};

export function parseSourceParams(raw: string | undefined): SourceParams {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** Generators fall back to this period when the field is left empty. */
export const GENERATOR_DEFAULT_PERIOD_MS = 1000;

/** Placeholder for the Period field; device presets use the backend default. */
export function periodPlaceholder(valueSource: string): string {
  return valueSource === "device" ? "default (60 s)" : String(GENERATOR_DEFAULT_PERIOD_MS);
}

/**
 * Initial text for the Period field. A device preset without a stored period
 * stays empty (backend default); a generator shows its effective 1000 ms.
 */
export function initialPeriodText(valueSource: string, params: SourceParams): string {
  if (typeof params.periodMs === "number") return String(params.periodMs);
  return valueSource === "device" ? "" : String(GENERATOR_DEFAULT_PERIOD_MS);
}

function parsePeriod(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Builds the device/generator source params. A device preset only carries
 * `periodMs` when the user entered one, so saving an unrelated field never
 * stamps a period over the backend's preset default.
 */
export function buildPeriodicParams(
  valueSource: "device" | "generator",
  fields: { kind: string; preset: string; min: number; max: number; periodText: string },
): Record<string, unknown> {
  const period = parsePeriod(fields.periodText);
  if (valueSource === "generator") {
    return { kind: fields.kind, min: fields.min, max: fields.max, periodMs: period ?? GENERATOR_DEFAULT_PERIOD_MS };
  }
  return { preset: fields.preset, min: fields.min, max: fields.max, ...(period !== null ? { periodMs: period } : {}) };
}

/**
 * Short, muted description of where a register's value comes from, shown in
 * place of a live value while the simulator is stopped.
 */
export function sourceSummary(
  r: { valueSource: string; holdValue: number; sourceParams: string } & Partial<ScalableRegister>,
  addrFmt: AddrFmt = "dec",
): string {
  const p = parseSourceParams(r.sourceParams);
  const unitSuffix = r.unit ? ` ${r.unit}` : "";
  switch (r.valueSource) {
    case "hold": {
      // Hold is stored raw; show it in engineering units (unchanged when unscaled).
      const reg = { dataType: "u16", ...r };
      if (isIdentityScaling(reg)) return `hold ${r.holdValue}${unitSuffix}`;
      const sc = registerScaling(reg);
      return `hold ${formatEng(engFromRaw(r.holdValue, sc.scale, sc.offset), sc.decimals, sc.unit)}`;
    }
    case "generator":
      // Generator min/max are engineering values already.
      return `${p.kind ?? "generator"} ${p.min ?? 0}–${p.max ?? 100}${unitSuffix}`;
    case "device":
      return `preset ${p.preset ?? "device"}`;
    case "route":
      return `route → unit ${p.slaveUnitId ?? 1} ${bankName(p.functionCode ?? 3)} ${fmtAddr(p.address ?? 0, addrFmt)}`;
    default:
      return r.valueSource;
  }
}
