// Legacy per-workspace address format of the TCP Simulator page. The app-wide
// setting (addressFormatPref.ts) replaced it; only the type and the old key
// shape remain (the first-run upgrade scans keys with this prefix).

export type AddressFormat = "dec" | "hex";

export function addressFormatStorageKey(workspace: string): string {
  return `inowio.simulator.addressFormat.${workspace}`;
}
