import { decodeWordsInAddressOrder } from "../utils/modbusValueCodec";

/**
 * Engineering-unit scaling for simulator registers. Mirrors
 * `src-tauri/src/sim_scaling.rs` exactly: engineering = raw * scale + offset.
 * Defaults (scale 1, offset 0) reproduce the pre-scaling behaviour.
 */

const MAX_SAFE = 9_007_199_254_740_992; // 2^53

/** Data types encoded as integers (raw values round to a whole step when scaled). */
export const INTEGER_TYPES: ReadonlySet<string> = new Set(["u16", "i16", "u32", "i32", "u64", "i64", "bool"]);

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
export function roundHalfAway(x: number): number {
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
export function decimalPlaces(s: number): number {
  const text = String(s);
  const m = /^(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(text);
  if (m) {
    const frac = m[2]?.length ?? 0;
    return Math.max(0, frac - Number(m[3]));
  }
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

/**
 * Automatic (null) decimals: integer types use the larger of the decimal places
 * of |scale| and of the offset (max 6); float types use 6 (display trims
 * trailing zeros). Explicit decimals are clamped 0..6 and shown fixed.
 */
export function effectiveDecimals(decimals: number | null | undefined, scale: number, offset: number, dataType: string): number {
  if (decimals !== null && decimals !== undefined && Number.isFinite(decimals)) {
    return Math.min(6, Math.max(0, Math.trunc(decimals)));
  }
  if (!INTEGER_TYPES.has(dataType)) return 6;
  const s = Math.abs(scale);
  const scalePlaces = !Number.isFinite(s) || s === 0 ? 0 : decimalPlaces(s);
  const offsetPlaces = Number.isFinite(offset) ? decimalPlaces(Math.abs(offset)) : 0;
  return Math.min(6, Math.max(scalePlaces, offsetPlaces));
}

/** `trim` drops trailing zeros (used for automatic decimals on float types). */
export function formatEng(value: number, decimals: number, unit?: string | null, trim = false): string {
  let text = value.toFixed(Math.min(100, Math.max(0, decimals)));
  if (trim && text.includes(".")) text = text.replace(/\.?0+$/, "");
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

export function registerScaling(reg: ScalableRegister): { scale: number; offset: number; decimals: number; unit: string; trim: boolean } {
  const scale = reg.scale != null && reg.scale !== 0 && Number.isFinite(reg.scale) ? reg.scale : 1;
  const offset = reg.scaleOffset != null && Number.isFinite(reg.scaleOffset) ? reg.scaleOffset : 0;
  return {
    scale,
    offset,
    decimals: effectiveDecimals(reg.decimals, scale, offset, reg.dataType),
    unit: reg.unit ?? "",
    // Automatic decimals on a float type: show only the digits that matter.
    trim: reg.decimals == null && !INTEGER_TYPES.has(reg.dataType),
  };
}

/** True when scale/offset are the defaults (engineering == raw). */
export function isIdentityScaling(reg: ScalableRegister): boolean {
  const s = registerScaling(reg);
  return s.scale === 1 && s.offset === 0;
}

/**
 * The shortest decimal that round-trips to the same f32 (230.6999969… → 230.7),
 * mirroring Rust `f32_shortest`. An f32 holds ~7 significant digits; without this
 * the 6-decimal float display would show the noise. Non-finite values pass through.
 */
export function f32Shortest(x: number): number {
  if (!Number.isFinite(x)) return x;
  for (let p = 1; p <= 9; p++) {
    const candidate = Number(x.toPrecision(p));
    if (Math.fround(candidate) === x) return candidate;
  }
  return x;
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
  if (!res.ok) return null;
  const value = Number(res.value);
  return reg.dataType === "f32" ? f32Shortest(value) : value;
}

type SnapRow = { valueWord: number | null; valueBit: boolean | null } | undefined;
type SnapshotLookup = (unitId: number, functionCode: number, address: number) => SnapRow;
type LiveRegister = ScalableRegister & { unitId: number; functionCode: number; address: number };

/** Decoded raw value of a live register (null for bit banks or missing words). */
export function liveRaw(reg: LiveRegister, snapshotFor: SnapshotLookup): number | null {
  if (reg.functionCode === 1 || reg.functionCode === 2) return null;
  return decodeRegisterRaw(reg, (a) => snapshotFor(reg.unitId, reg.functionCode, a)?.valueWord ?? null);
}

/** The live raw word(s) of a register's full span (null for bit banks or missing words). */
export function liveWords(reg: LiveRegister, snapshotFor: SnapshotLookup): number[] | null {
  if (reg.functionCode === 1 || reg.functionCode === 2) return null;
  const words: number[] = [];
  for (let i = 0; i < spanOf(reg.dataType); i++) {
    const w = snapshotFor(reg.unitId, reg.functionCode, reg.address + i)?.valueWord;
    if (w === null || w === undefined) return null;
    words.push(w);
  }
  return words;
}

/** "raw 235" for one word; "raw 0x4366 0xB333" (address order) for several. */
export function rawWordsText(words: number[]): string {
  if (words.length === 1) return `raw ${words[0]}`;
  return `raw ${words.map((w) => `0x${w.toString(16).toUpperCase().padStart(4, "0")}`).join(" ")}`;
}

/** The one shared live-value text: "ON"/"OFF" for bits, else scaled "23.5 °C". */
export function liveValueText(reg: LiveRegister, snapshotFor: SnapshotLookup): string {
  const row = snapshotFor(reg.unitId, reg.functionCode, reg.address);
  if (!row) return "—";
  if (row.valueBit !== null && row.valueBit !== undefined) return row.valueBit ? "ON" : "OFF";
  const raw = liveRaw(reg, snapshotFor);
  if (raw === null) return "—";
  const sc = registerScaling(reg);
  return formatEng(engFromRaw(raw, sc.scale, sc.offset), sc.decimals, sc.unit, sc.trim);
}
