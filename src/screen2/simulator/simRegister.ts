import { fmtAddr, bankName, type AddrFmt } from "./ruleTargets";
import { wordSpan } from "./useSimulatorData";

export type SimRegister = {
  id: number;
  unitId: number;
  functionCode: number;
  address: number;
  alias: string;
  dataType: string;
  holdValue: number;
  sortOrder: number;
  valueSource: string;
  byteOrder: string;
  sourceParams: string;
  intervalMs: number;
  unit?: string | null;
  displayFormat?: string | null;
};

/** Parses a user-typed address: decimal ("257") or hex ("0x101"). Null if invalid / out of 0–65535. */
export function parseAddressInput(text: string): number | null {
  const t = text.trim();
  let n: number;
  if (/^0x[0-9a-f]+$/i.test(t)) n = parseInt(t.slice(2), 16);
  else if (/^\d+$/.test(t)) n = Number(t);
  else return null;
  return n >= 0 && n <= 65535 ? n : null;
}

/** First address (from 0) on unit+bank where `span` consecutive words are free. */
export function firstFreeAddress(
  registers: readonly SimRegister[],
  unitId: number,
  functionCode: number,
  span = 1,
): number {
  const taken = new Set<number>();
  for (const r of registers) {
    if (r.unitId !== unitId || r.functionCode !== functionCode) continue;
    for (let a = r.address; a < r.address + wordSpan(r.dataType); a++) taken.add(a);
  }
  for (let start = 0; start + span - 1 <= 65535; start++) {
    let free = true;
    for (let a = start; a < start + span; a++) if (taken.has(a)) { free = false; break; }
    if (free) return start;
  }
  return 0;
}

/** A blank draft for the "New register" panel (id 0 marks it as not yet saved). */
export function blankRegister(registers: readonly SimRegister[]): SimRegister {
  return {
    id: 0,
    unitId: 1,
    functionCode: 3,
    address: firstFreeAddress(registers, 1, 3),
    alias: "",
    dataType: "u16",
    holdValue: 0,
    sortOrder: 0,
    valueSource: "hold",
    byteOrder: "ABCD",
    sourceParams: "{}",
    intervalMs: 1000,
    unit: null,
    displayFormat: null,
  };
}

/**
 * Message when unit+bank+address (+ word span) is already taken or runs past
 * 65535, else null.
 */
export function addressConflict(
  registers: readonly SimRegister[],
  unitId: number,
  functionCode: number,
  address: number,
  dataType: string,
  fmt: AddrFmt,
): string | null {
  const span = wordSpan(dataType);
  if (address + span - 1 > 65535) return "This register would run past address 65535.";
  for (const r of registers) {
    if (r.unitId !== unitId || r.functionCode !== functionCode) continue;
    const rs = wordSpan(r.dataType);
    if (address < r.address + rs && r.address < address + span) {
      const who = r.alias?.trim() ? ` by "${r.alias.trim()}"` : "";
      return `Unit ${unitId} ${bankName(functionCode)} ${fmtAddr(r.address, fmt)} is already used${who}.`;
    }
  }
  return null;
}
