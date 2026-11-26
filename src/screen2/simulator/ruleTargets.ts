import type { PageRegister } from "./useSimulatorData";
import { wordSpan } from "./useSimulatorData";

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
