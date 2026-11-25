// Pure editor model for one Analyzer signal: load, validate, and turn into an upsert payload.

import type { AnalyzerSignal, AnalyzerSignalUpsert, AnalyzerTile } from "../../../api/analyzer";
import type { SlaveItem, SlaveRegisterRow } from "../../../api/slaves";
import { formatAnalyzerAddress, type AnalyzerAddressFormat } from "../../../utils/analyzerAddressFormat";
import {
  emptySignalMath,
  parseSignalMath,
  validateSignalMath,
  variableTypes,
  type MathInput,
  type MathIssue,
  type MathValueType,
  type SignalMath,
} from "../../../utils/analyzerMath";
import { parseAnalyzerDecoderConfig } from "../../../utils/analyzerSignalDecoder";
import { shownValueType } from "../../../utils/analyzerSignalEval";

export type SignalKind = "register" | "calculated";

export type SignalDraft = {
  kind: SignalKind;
  id: string;
  slaveId: number | null; // register only
  functionCode: number; // register only
  registerRowId: number | null; // register only
  bit: string;
  scale: string;
  offset: string;
  clampMin: string;
  clampMax: string;
  decimals: string;
  unit: string;
  show: string; // "register" | variable name ("" = nothing picked yet)
  math: SignalMath;
};

export const SHOW_REGISTER = "register";

// ------------------------------------------------------- moved helpers (unchanged)

export function functionCodeFromFunctionKind(kind: string | null | undefined): number {
  const k = (kind || "").trim().toLowerCase();
  if (k === "coils") return 1;
  if (k === "discrete") return 2;
  if (k === "holding") return 3;
  if (k === "input") return 4;
  return 3;
}

export function functionKindFromFunctionCode(fc: number): string | null {
  switch (fc) {
    case 1:
      return "coils";
    case 2:
      return "discrete";
    case 3:
      return "holding";
    case 4:
      return "input";
    default:
      return null;
  }
}

export function functionCodeLetter(fc: number): string | null {
  switch (fc) {
    case 1:
      return "CO";
    case 2:
      return "DI";
    case 3:
      return "HO";
    case 4:
      return "IN";
    default:
      return null;
  }
}

export function sanitizeSignalIdPart(value: string): string {
  return (value || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "");
}

export function validateOptionalNumberInput(value: string): { parsed: number | null; error?: string } {
  const t = (value || "").trim();
  if (!t) return { parsed: null };
  const n = Number(t);
  if (!Number.isFinite(n)) return { parsed: null, error: "Invalid number" };
  return { parsed: n };
}

export function validateOptionalNonNegativeInt(value: string, max: number | null): { parsed: number | null; error?: string } {
  const out = validateOptionalNumberInput(value);
  if (out.error) return out;
  if (out.parsed == null) return out;
  if (!Number.isInteger(out.parsed)) return { parsed: null, error: "Must be an integer" };
  if (out.parsed < 0) return { parsed: null, error: "Must be ≥ 0" };
  if (max != null && out.parsed > max) return { parsed: null, error: `Must be ≤ ${max}` };
  return { parsed: out.parsed };
}

export function normalizeSignalId(value: string): string {
  return (value || "").replace(/\s+/g, "-").trim();
}

export function validateSignalId(
  signalId: string,
  mode: "add" | "edit",
  signals: AnalyzerSignal[],
): { normalized: string; error: string | null } {
  if (mode === "edit") return { normalized: signalId.trim(), error: null };

  const normalized = normalizeSignalId(signalId);
  if (!normalized) return { normalized, error: "Signal ID is required" };

  const exists = signals.some((s) => s.id.trim().toLowerCase() === normalized.toLowerCase());
  if (exists) return { normalized, error: "Signal ID already exists" };

  return { normalized, error: null };
}

/** Another register signal already reads this slave/function/address. */
export function duplicateRegisterError(args: {
  slaveId: number | null;
  registerRowId: number | null;
  functionCode: number;
  registerRows: SlaveRegisterRow[];
  signals: AnalyzerSignal[];
  mode: "add" | "edit";
  selfId: string | null;
  slaves: SlaveItem[];
  addressFormat: AnalyzerAddressFormat;
}): string | null {
  const slvId = args.slaveId;
  const rowId = args.registerRowId;
  if (slvId == null || rowId == null) return null;

  const row = args.registerRows.find((r) => r.id === rowId) ?? null;
  if (!row) return null;

  const functionKind = functionKindFromFunctionCode(args.functionCode);
  if (!functionKind) return null;

  const functionKindLc = functionKind.trim().toLowerCase();
  const addr = row.address;

  const existing =
    args.signals.find((s) => {
      if (args.mode === "edit" && args.selfId && s.id === args.selfId) return false;
      return (
        s.slaveId === slvId &&
        String(s.functionKind ?? "").trim().toLowerCase() === functionKindLc &&
        s.address === addr
      );
    }) ?? null;

  if (existing) {
    const unit = args.slaves.find((s) => s.id === slvId)?.unitId ?? null;
    const slaveLabel = unit != null ? `Unit ${unit}` : `Slave #${slvId}`;
    return `Signal for "${slaveLabel} | ${functionKind} | Address ${formatAnalyzerAddress(addr, args.addressFormat)}" already exists as "${existing.id}"`;
  }

  return null;
}

// ------------------------------------------------------------------ input types

/** Type of one calculated-signal input, read from its source signal. */
export function mathInputType(input: MathInput, source: AnalyzerSignal | undefined): MathValueType {
  if (!source || input.value === "register") return "number";
  if (input.value === "shown") return shownValueType(source.decoderJson);
  try {
    const raw: unknown = JSON.parse(source.decoderJson);
    const math = parseSignalMath(raw && typeof raw === "object" ? (raw as { math?: unknown }).math : null);
    return (math && variableTypes(math)[input.value]) || "number";
  } catch {
    return "number";
  }
}

/** Names of the variables a register signal defines (empty when it has no math). */
export function sourceVariableNames(signal: AnalyzerSignal | undefined): string[] {
  if (!signal) return [];
  try {
    const raw: unknown = JSON.parse(signal.decoderJson);
    const math = parseSignalMath(raw && typeof raw === "object" ? (raw as { math?: unknown }).math : null);
    return math ? math.variables.map((v) => v.name) : [];
  } catch {
    return [];
  }
}

export function mathInputTypes(math: SignalMath, signals: AnalyzerSignal[]): Record<string, MathValueType> {
  const out: Record<string, MathValueType> = {};
  for (const inp of math.inputs) out[inp.name] = mathInputType(inp, signals.find((s) => s.id === inp.signalId));
  return out;
}

// ------------------------------------------------------------------ draft <-> signal

const text = (n: number | undefined) => (n != null ? String(n) : "");

export function draftFromSignal(s: AnalyzerSignal | null, kind: SignalKind): SignalDraft {
  const k: SignalKind = s ? s.kind : kind;
  const cfg = s ? parseAnalyzerDecoderConfig(s.decoderJson) : {};
  const math = cfg.math ?? emptySignalMath();
  // A calculated signal with nothing picked shows its first variable (register signals: the register).
  const defaultShow = k === "register" ? SHOW_REGISTER : (math.variables[0]?.name ?? "");
  return {
    kind: k,
    id: s?.id ?? "",
    slaveId: s && k === "register" ? s.slaveId : null,
    functionCode: s && k === "register" ? functionCodeFromFunctionKind(s.functionKind) : 4,
    registerRowId: s && k === "register" ? s.registerRowId : null,
    bit: text(cfg.bit),
    scale: text(cfg.scale),
    offset: text(cfg.offset),
    clampMin: text(cfg.clampMin),
    clampMax: text(cfg.clampMax),
    decimals: text(cfg.decimals),
    unit: cfg.unit ?? "",
    show: cfg.show && cfg.show !== SHOW_REGISTER ? cfg.show : defaultShow,
    math,
  };
}

export type DraftTransforms = Pick<
  SignalDraft,
  "slaveId" | "functionCode" | "registerRowId" | "bit" | "scale" | "offset" | "clampMin" | "clampMax"
>;

/**
 * True when the draft reads a different register (slave, register type, address) or applies
 * different transforms than the saved signal. Live values come from the SAVED register, decoded
 * with the SAVED transforms, so they must not be presented as the draft's values then.
 */
export function transformsChanged(draft: DraftTransforms, saved: DraftTransforms | null): boolean {
  if (saved == null) return false;
  if (draft.slaveId !== saved.slaveId || draft.functionCode !== saved.functionCode || draft.registerRowId !== saved.registerRowId) {
    return true;
  }
  const keys = ["bit", "scale", "offset", "clampMin", "clampMax"] as const;
  return keys.some((k) => draft[k].trim() !== saved[k].trim());
}

function hasMath(m: SignalMath): boolean {
  return m.inputs.length > 0 || m.variables.length > 0;
}

/** decoderJson keeps the old key order and omits empty keys, "show" when it is the register, and empty math. */
export function draftToUpsert(d: SignalDraft): AnalyzerSignalUpsert {
  const isRegister = d.kind === "register";
  const cfg: Record<string, unknown> = {};
  if (isRegister) {
    const bit = validateOptionalNonNegativeInt(d.bit, 63).parsed;
    const scale = validateOptionalNumberInput(d.scale).parsed;
    const offset = validateOptionalNumberInput(d.offset).parsed;
    const clampMin = validateOptionalNumberInput(d.clampMin).parsed;
    const clampMax = validateOptionalNumberInput(d.clampMax).parsed;
    if (bit != null) cfg.bit = bit;
    if (scale != null) cfg.scale = scale;
    if (offset != null) cfg.offset = offset;
    if (clampMin != null) cfg.clampMin = clampMin;
    if (clampMax != null) cfg.clampMax = clampMax;
  }
  const decimals = validateOptionalNonNegativeInt(d.decimals, 12).parsed;
  if (decimals != null) cfg.decimals = decimals;
  const unit = d.unit.trim();
  if (unit) cfg.unit = unit;
  if (d.show && d.show !== SHOW_REGISTER) cfg.show = d.show;
  if (hasMath(d.math)) cfg.math = d.math;

  return {
    id: d.id.trim(),
    kind: d.kind,
    slaveId: isRegister ? d.slaveId : null,
    functionKind: isRegister ? (functionKindFromFunctionCode(d.functionCode) ?? "") : "",
    registerRowId: isRegister ? d.registerRowId : null,
    decoderJson: JSON.stringify(cfg),
  };
}

export function suggestCalculatedId(existingIds: string[]): string {
  const taken = new Set(existingIds.map((id) => id.trim().toLowerCase()));
  for (let k = 1; ; k++) if (!taken.has(`calc_${k}`)) return `Calc_${k}`;
}

// ------------------------------------------------------------------ validation

export type DataField = "id" | "register" | "bit" | "scale" | "offset" | "clampMin" | "clampMax" | "decimals" | "show";

export type DraftValidation = {
  ok: boolean;
  byTab: { data: string[]; math: MathIssue[] };
  blocking: string | null;
  /** Per-field messages for the Data tab. */
  fields: Partial<Record<DataField, string>>;
  /** Normalised Signal ID to save under. */
  normalizedId: string;
};

export function validateDraft(
  d: SignalDraft,
  ctx: {
    signals: AnalyzerSignal[];
    mode: "add" | "edit";
    chartTiles: AnalyzerTile[];
    /** Optional: enables the duplicate-register check. */
    registerRows?: SlaveRegisterRow[];
    slaves?: SlaveItem[];
    addressFormat?: AnalyzerAddressFormat;
  },
): DraftValidation {
  const fields: Partial<Record<DataField, string>> = {};
  const isRegister = d.kind === "register";

  const idV = validateSignalId(d.id, ctx.mode, ctx.signals);
  if (idV.error) fields.id = idV.error;

  if (isRegister) {
    if (d.slaveId == null || d.registerRowId == null) fields.register = "Pick a slave and a register address";
    else if (ctx.registerRows) {
      const dup = duplicateRegisterError({
        slaveId: d.slaveId,
        registerRowId: d.registerRowId,
        functionCode: d.functionCode,
        registerRows: ctx.registerRows,
        signals: ctx.signals,
        mode: ctx.mode,
        selfId: ctx.mode === "edit" ? d.id.trim() : null,
        slaves: ctx.slaves ?? [],
        addressFormat: ctx.addressFormat ?? "dec",
      });
      if (dup) fields.register = dup;
    }

    const bitV = validateOptionalNonNegativeInt(d.bit, 63);
    if (bitV.error) fields.bit = bitV.error;
    const scaleV = validateOptionalNumberInput(d.scale);
    if (scaleV.error) fields.scale = scaleV.error;
    const offsetV = validateOptionalNumberInput(d.offset);
    if (offsetV.error) fields.offset = offsetV.error;
    const clampMinV = validateOptionalNumberInput(d.clampMin);
    if (clampMinV.error) fields.clampMin = clampMinV.error;
    const clampMaxV = validateOptionalNumberInput(d.clampMax);
    if (clampMaxV.error) fields.clampMax = clampMaxV.error;
    if (!fields.clampMin && !fields.clampMax && clampMinV.parsed != null && clampMaxV.parsed != null) {
      if (clampMinV.parsed > clampMaxV.parsed) {
        fields.clampMin = "Must be ≤ clamp max";
        fields.clampMax = "Must be ≥ clamp min";
      }
    }
  }

  const decimalsV = validateOptionalNonNegativeInt(d.decimals, 12);
  if (decimalsV.error) fields.decimals = decimalsV.error;

  const varNames = new Set(d.math.variables.map((v) => v.name));
  if (!isRegister && !d.show) fields.show = "Pick a variable for Show value";
  else if (d.show && d.show !== SHOW_REGISTER && !varNames.has(d.show)) fields.show = `Show value "${d.show}" is not a variable any more`;
  else if (!isRegister && d.show === SHOW_REGISTER) fields.show = "Pick a variable for Show value";

  // Math issues, mirroring the backend for calculated inputs.
  const inputTypes = isRegister ? undefined : mathInputTypes(d.math, ctx.signals);
  const math = validateSignalMath(d.math, { hasRegister: isRegister, inputTypes });
  if (!isRegister) {
    if (d.math.inputs.length === 0) math.push({ path: "inputs", message: "needs at least one input" });
    const selfId = d.id.trim();
    d.math.inputs.forEach((inp, i) => {
      const src = ctx.signals.find((s) => s.id === inp.signalId);
      const path = `inputs.${i}.signalId`;
      if (!src) math.push({ path, message: `input ${inp.name}: unknown signal "${inp.signalId}"` });
      else if (src.id === selfId) math.push({ path, message: `input ${inp.name}: a signal can't use itself` });
      else if (src.kind !== "register") math.push({ path, message: `input ${inp.name}: "${inp.signalId}" is a calculated signal` });
      else if (inp.value !== "shown" && inp.value !== "register" && !sourceVariableNames(src).includes(inp.value)) {
        math.push({ path: `inputs.${i}.value`, message: `input ${inp.name}: variable "${inp.value}" no longer exists in ${inp.signalId}` });
      }
    });
  } else if (d.math.inputs.length > 0) {
    math.push({ path: "inputs", message: "register signals can't have inputs" });
  }

  let blocking: string | null = null;
  if (!fields.show && d.show && d.show !== SHOW_REGISTER && ctx.chartTiles.length > 0) {
    const type = variableTypes(d.math, inputTypes)[d.show];
    if (type === "text") {
      const names = ctx.chartTiles.map((t) => t.title?.trim() || `Tile ${t.id}`);
      blocking = `Used by chart tiles: ${names.join(", ")}. Change them to Value tiles or pick a numeric Show value.`;
    }
  }

  const data = Object.values(fields).filter((m): m is string => !!m);
  return {
    ok: data.length === 0 && math.length === 0 && !blocking,
    byTab: { data, math },
    blocking,
    fields,
    normalizedId: idV.normalized,
  };
}
