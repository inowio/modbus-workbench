import type { PageRegister } from "./useSimulatorData";
import { wordSpan } from "./useSimulatorData";
import {
  INTEGER_TYPES,
  decimalPlaces,
  effectiveDecimals,
  engFromRaw,
  formatEng,
  rawFromEng,
  registerScaling,
  roundHalfAway,
} from "./scaling";

export type AddrFmt = "dec" | "hex";

const BANK_NAME: Record<number, string> = { 1: "coil", 2: "discrete input", 3: "holding", 4: "input" };

/** Readable bank name ("coil", "holding", ...). */
export function bankName(bank: number): string {
  return BANK_NAME[bank] ?? "register";
}

/** Address in the user's Dec/Hex preference (hex is 0x-prefixed, 4 digits). */
export function fmtAddr(a: number, fmt: AddrFmt): string {
  return fmt === "hex" ? `0x${a.toString(16).toUpperCase().padStart(4, "0")}` : String(a);
}

/** The register covering `address` (span-aware for multi-word types), if any. */
export function findTargetRegister(
  registers: readonly PageRegister[],
  unit: number,
  bank: number,
  address: number,
): PageRegister | undefined {
  return registers.find(
    (r) =>
      r.unitId === unit &&
      r.functionCode === bank &&
      address >= r.address &&
      address < r.address + wordSpan(r.dataType),
  );
}

/** `Temperature (input 1)` when the register has an alias, else `input 1`. */
export function targetLabel(reg: PageRegister | undefined, bank: number, address: number, fmt: AddrFmt): string {
  const base = `${bankName(bank)} ${fmtAddr(address, fmt)}`;
  const alias = reg?.alias?.trim();
  return alias ? `${alias} (${base})` : base;
}

/**
 * The register that STARTS at `address` (rules reference a register by its
 * start address; the engine looks its type/scaling up there).
 */
export function exactRegister(
  registers: readonly PageRegister[] | undefined,
  unit: number,
  bank: number,
  address: number,
): PageRegister | undefined {
  return registers?.find((r) => r.unitId === unit && r.functionCode === bank && r.address === address);
}

/** Coils/discrete inputs, and "bool" registers, read as On/Off. */
export function isBitTarget(bank: number, reg?: PageRegister): boolean {
  return bank === 1 || bank === 2 || reg?.dataType === "bool";
}

/** Stable `<select>` value for a register reference. */
export function refKey(unit: number, bank: number, address: number): string {
  return `${unit}:${bank}:${address}`;
}

/** Dropdown text: "Temperature · input 0x0001" (alias first), plus "· unit N" in a multi-unit workspace. */
export function registerOptionLabel(reg: PageRegister, fmt: AddrFmt, showUnit: boolean): string {
  const loc = `${bankName(reg.functionCode)} ${fmtAddr(reg.address, fmt)}`;
  const alias = reg.alias?.trim();
  const text = alias ? `${alias} · ${loc}` : loc;
  return showUnit ? `${text} · unit ${reg.unitId}` : text;
}

/**
 * Short name for rule summaries: the alias when it is unique in the workspace,
 * else `Temperature (input 1)` / `input 1`.
 */
export function ruleRegisterName(
  reg: PageRegister | undefined,
  bank: number,
  address: number,
  fmt: AddrFmt,
  registers: readonly PageRegister[] | undefined,
): string {
  const alias = reg?.alias?.trim();
  if (alias && registers && registers.filter((r) => r.alias?.trim() === alias).length === 1) return alias;
  return targetLabel(reg, bank, address, fmt);
}

/**
 * A rule value in the register's engineering units: On/Off for bits, else the
 * register's decimals (or the value's own, if it has more) and unit. With no
 * register the stored number is shown as-is.
 */
export function formatRuleValue(value: number, bank: number, reg: PageRegister | undefined, withUnit = true): string {
  if (!Number.isFinite(value)) return String(value);
  if (isBitTarget(bank, reg) && (value === 0 || value === 1)) return value === 1 ? "On" : "Off";
  if (!reg) return String(value);
  const sc = registerScaling(reg);
  const decimals = Math.min(6, Math.max(sc.decimals, decimalPlaces(Math.abs(value))));
  return formatEng(value, decimals, withUnit ? sc.unit : "", sc.trim);
}

export type RuleJoin = "all" | "any";

/** One comparison of a condition trigger, as stored (engineering units). */
export type StoredCondition = {
  unit: number;
  bank: number;
  address: number;
  op: string;
  value: number;
  deadband: number;
};

const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

function toCondition(c: Record<string, unknown>): StoredCondition {
  return {
    unit: num(c.unit, 1),
    bank: num(c.bank, 1),
    address: num(c.address, 0),
    op: typeof c.op === "string" ? c.op : "==",
    value: num(c.value, 0),
    deadband: Math.max(0, num(c.deadband, 0)),
  };
}

/**
 * Reads a condition trigger in either shape: legacy single
 * `{unit,bank,address,op,value}` or `{join, conditions:[…]}` (mirrors the
 * backend's `parse_condition_trigger`; defaults match it too).
 */
export function readConditions(t: Record<string, unknown>): { join: RuleJoin; conditions: StoredCondition[] } {
  if (Array.isArray(t.conditions)) {
    const conditions = t.conditions
      .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
      .map(toCondition);
    return { join: t.join === "any" ? "any" : "all", conditions };
  }
  return { join: "all", conditions: [toCondition(t)] };
}

/** Operators that take a deadband. */
export const DEADBAND_OPS = new Set([">", ">=", "<", "<="]);

/**
 * The engineering value a Set of `value` actually stores on `reg`, mirroring
 * the engine: a single-word integer register at scale 1 / offset 0 takes the
 * legacy truncate-and-wrap path (`value as i64 as u16`); otherwise
 * `rawFromEng` (round to nearest step, clamp), with integer encodes truncating
 * and f32 losing precision.
 */
export function storedEngValue(value: number, reg: PageRegister): number {
  const sc = registerScaling(reg);
  const dt = reg.dataType;
  if (sc.scale === 1 && sc.offset === 0 && wordSpan(dt) === 1 && INTEGER_TYPES.has(dt)) {
    const w = ((Math.trunc(value) % 65536) + 65536) % 65536;
    return dt === "i16" && w > 32767 ? w - 65536 : w;
  }
  let raw = rawFromEng(value, sc.scale, sc.offset, dt);
  if (INTEGER_TYPES.has(dt)) raw = Math.trunc(raw);
  else if (dt === "f32") raw = Math.fround(raw);
  return engFromRaw(raw, sc.scale, sc.offset);
}

/** Decimals that show one raw step of `reg` (at least the register's own). */
function stepDecimals(reg: PageRegister): number {
  const sc = registerScaling(reg);
  return Math.max(sc.decimals, effectiveDecimals(null, sc.scale, sc.offset, reg.dataType));
}

/** "Will be stored as 25.6 °C" when a Set value isn't exactly representable on `reg`. */
export function setHint(value: number, reg: PageRegister | undefined, bank: number): string | null {
  if (!reg || isBitTarget(bank, reg) || !Number.isFinite(value) || reg.dataType === "f64") return null;
  const stored = storedEngValue(value, reg);
  const tol = (reg.dataType === "f32" ? 1e-6 : 1e-9) * Math.max(1, Math.abs(value));
  if (Math.abs(stored - value) <= tol) return null;
  const sc = registerScaling(reg);
  return `Will be stored as ${formatEng(stored, stepDecimals(reg), sc.unit, sc.trim)}`;
}

/**
 * Inc/Dec hint for an integer target. At scale 1 / offset 0 the engine
 * truncates the amount (legacy path), so |by| < 1 does nothing. Otherwise each
 * firing moves round(by / scale) whole steps (half away from zero, after the
 * same 1e-9 pre-rounding as `rawFromEng`): 0 steps → does nothing; a different
 * amount than typed → "Moves by 0.2 °C each time".
 */
export function stepHint(by: number, reg: PageRegister | undefined, bank: number): string | null {
  if (!reg || isBitTarget(bank, reg) || !Number.isFinite(by) || by === 0 || !INTEGER_TYPES.has(reg.dataType)) return null;
  const sc = registerScaling(reg);
  const step = Math.abs(sc.scale);
  const stepText = formatEng(step, Math.min(6, decimalPlaces(step)), sc.unit);
  if (sc.scale === 1 && sc.offset === 0) {
    return Math.abs(by) < 1 ? `Smaller than one step (${stepText}) — does nothing` : null;
  }
  const steps = roundHalfAway(roundHalfAway((by / sc.scale) * 1e9) / 1e9);
  const moved = steps * sc.scale;
  if (steps === 0) return `Smaller than half a step (${stepText}) — does nothing`;
  if (Math.abs(moved - by) <= 1e-9 * Math.max(1, Math.abs(by))) return null;
  return `Moves by ${formatEng(moved, stepDecimals(reg), sc.unit)} each time`;
}
