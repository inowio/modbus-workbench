import { decodeWordsInAddressOrder } from "../utils/modbusValueCodec";

/**
 * Engineering-unit scaling for simulator registers. Mirrors
 * `src-tauri/src/sim_scaling.rs` exactly: engineering = raw * scale + offset.
 * Defaults (scale 1, offset 0) reproduce the pre-scaling behaviour.
 */

const MAX_SAFE = 9_007_199_254_740_992; // 2^53

const INTEGER_TYPES = new Set(["u16", "i16", "u32", "i32", "u64", "i64", "bool"]);

const TYPE_RANGE: Record<string, [number, number]> = {
  u16: [0, 65535],
  i16: [-32768, 32767],
  u32: [0, 4_294_967_295],
  i32: [-2_147_483_648, 2_147_483_647],
  u64: [0, MAX_SAFE],
  i64: [-MAX_SAFE, MAX_SAFE],
  bool: [0, 1],
};

/** Round half away from zero (JS Math.round rounds halves toward +Infinity). */
function roundHalfAway(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

export function engFromRaw(raw: number, scale: number, offset: number): number {
  return raw * scale + offset;
}

export function rawFromEng(eng: number, scale: number, offset: number, dataType: string): number {
  const e = Number.isFinite(eng) ? eng : 0;
  const s = scale === 0 || !Number.isFinite(scale) ? 1 : scale;
  const o = Number.isFinite(offset) ? offset : 0;
  const identity = s === 1 && o === 0;
  let raw = (e - o) / s;
  if (INTEGER_TYPES.has(dataType) && !identity) {
    // Pre-round to 9 decimals so float noise (23.45 / 0.1) does not flip a true half.
    raw = roundHalfAway(roundHalfAway(raw * 1e9) / 1e9);
  }
  const range = TYPE_RANGE[dataType];
  return range ? Math.min(Math.max(raw, range[0]), range[1]) : raw;
}

/** Decimal places of the shortest representation of |s| (no exponent form). */
function decimalPlaces(s: number): number {
  const text = String(s);
  const m = /^(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(text);
  if (m) {
    const frac = m[2]?.length ?? 0;
    return Math.max(0, frac - Number(m[3]));
  }
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

export function effectiveDecimals(decimals: number | null | undefined, scale: number, dataType: string): number {
  if (decimals !== null && decimals !== undefined && Number.isFinite(decimals)) {
    return Math.min(6, Math.max(0, Math.trunc(decimals)));
  }
  if (!INTEGER_TYPES.has(dataType)) return 3;
  const s = Math.abs(scale);
  if (!Number.isFinite(s) || s === 0) return 0;
  return Math.min(6, decimalPlaces(s));
}

export function formatEng(value: number, decimals: number, unit?: string | null): string {
  let text = value.toFixed(Math.min(100, Math.max(0, decimals)));
  if (/^-0(\.0*)?$/.test(text)) text = text.slice(1); // no "-0.0"
  return unit ? `${text} ${unit}` : text;
}

export type ScalableRegister = {
  dataType: string;
  byteOrder?: string;
  unit?: string | null;
  scale?: number | null;
  scaleOffset?: number | null;
  decimals?: number | null;
};

export function registerScaling(reg: ScalableRegister): { scale: number; offset: number; decimals: number; unit: string } {
  const scale = reg.scale != null && reg.scale !== 0 && Number.isFinite(reg.scale) ? reg.scale : 1;
  const offset = reg.scaleOffset != null && Number.isFinite(reg.scaleOffset) ? reg.scaleOffset : 0;
  return { scale, offset, decimals: effectiveDecimals(reg.decimals, scale, reg.dataType), unit: reg.unit ?? "" };
}

/** True when scale/offset are the defaults (engineering == raw). */
export function isIdentityScaling(reg: ScalableRegister): boolean {
  const s = registerScaling(reg);
  return s.scale === 1 && s.offset === 0;
}

function spanOf(dataType: string): number {
  if (dataType === "u64" || dataType === "i64" || dataType === "f64") return 4;
  if (dataType === "u32" || dataType === "i32" || dataType === "f32") return 2;
  return 1;
}

/** Decodes the register's full word span by type/byte order; null if any word is missing. */
export function decodeRegisterRaw(
  reg: ScalableRegister & { address: number },
  wordAt: (address: number) => number | null,
): number | null {
  const words: number[] = [];
  for (let i = 0; i < spanOf(reg.dataType); i++) {
    const w = wordAt(reg.address + i);
    if (w === null || w === undefined) return null;
    words.push(w);
  }
  const res = decodeWordsInAddressOrder(reg.dataType, reg.byteOrder ?? "ABCD", words);
  return res.ok ? Number(res.value) : null;
}

type SnapRow = { valueWord: number | null; valueBit: boolean | null } | undefined;
type SnapshotLookup = (unitId: number, functionCode: number, address: number) => SnapRow;
type LiveRegister = ScalableRegister & { unitId: number; functionCode: number; address: number };

/** Decoded raw value of a live register (null for bit banks or missing words). */
export function liveRaw(reg: LiveRegister, snapshotFor: SnapshotLookup): number | null {
  if (reg.functionCode === 1 || reg.functionCode === 2) return null;
  return decodeRegisterRaw(reg, (a) => snapshotFor(reg.unitId, reg.functionCode, a)?.valueWord ?? null);
}

/** The one shared live-value text: "ON"/"OFF" for bits, else scaled "23.5 °C". */
export function liveValueText(reg: LiveRegister, snapshotFor: SnapshotLookup): string {
  const row = snapshotFor(reg.unitId, reg.functionCode, reg.address);
  if (!row) return "—";
  if (row.valueBit !== null && row.valueBit !== undefined) return row.valueBit ? "ON" : "OFF";
  const raw = liveRaw(reg, snapshotFor);
  if (raw === null) return "—";
  const sc = registerScaling(reg);
  return formatEng(engFromRaw(raw, sc.scale, sc.offset), sc.decimals, sc.unit);
}
