import type { ProbeKind, ScanFoundEvent, ScanKind, SerialParams, SerialParity } from "../api/slaveScan";

export const SCAN_BAUDS: readonly number[] = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];

export const SCAN_PARITIES: readonly SerialParity[] = ["none", "even", "odd"];

/** Valid unit IDs: serial skips 0 (broadcast), TCP allows 0–255. */
export function unitRange(kind: ScanKind): { min: number; max: number } {
  return kind === "serial" ? { min: 1, max: 247 } : { min: 0, max: 255 };
}

/** The rest of the range from `start`, never negative. */
export function defaultQuantity(kind: ScanKind, start: number): number {
  return Math.max(0, unitRange(kind).max - start + 1);
}

/**
 * Default wait per attempt. TCP is slower because RTU gateways answer an absent unit only after
 * their own serial timeout, and serialise requests.
 */
export function defaultWaitMs(kind: ScanKind): number {
  return kind === "serial" ? 200 : 1000;
}

export function estimateScanSeconds(args: {
  addresses: number;
  combos: number;
  waitMs: number;
  retries: number;
  probe: ProbeKind;
  parallelism: number;
}): number {
  const { addresses, combos, waitMs, retries, probe, parallelism } = args;
  const functionCodes = probe === "holdingThenInput" ? 2 : 1;
  const ms = (addresses * combos * waitMs * (retries + 1) * functionCodes) / Math.max(1, parallelism);
  return Math.ceil(ms / 1000);
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  if (total < 60) return `about ${total} s`;
  if (total < 3600) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return s === 0 ? `about ${m} min` : `about ${m} min ${s} s`;
  }
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return m === 0 ? `about ${h} h` : `about ${h} h ${m} min`;
}

const PARITY_LETTER: Record<string, string> = { none: "N", even: "E", odd: "O" };

/** e.g. `19200 8E1`. */
export function formatSettings(p: SerialParams): string {
  const letter = PARITY_LETTER[p.parity] ?? (p.parity.charAt(0).toUpperCase() || "?");
  return `${p.baud} ${p.dataBits}${letter}${p.stopBits}`;
}

function resultKey(ev: ScanFoundEvent): string {
  return `${ev.target}|${ev.unitId}|${ev.settings ? formatSettings(ev.settings) : ""}`;
}

function byUnitThenTarget(a: ScanFoundEvent, b: ScanFoundEvent): number {
  if (a.unitId !== b.unitId) return a.unitId - b.unitId;
  if (a.target !== b.target) return a.target < b.target ? -1 : 1;
  return 0;
}

/** Splits results into the three categories, keeping the first event per target|unit|settings. */
export function groupScanResults(events: ScanFoundEvent[]): {
  found: ScanFoundEvent[];
  garbled: ScanFoundEvent[];
  gateway: ScanFoundEvent[];
} {
  const seen = new Set<string>();
  const found: ScanFoundEvent[] = [];
  const garbled: ScanFoundEvent[] = [];
  const gateway: ScanFoundEvent[] = [];
  for (const ev of events) {
    const key = resultKey(ev);
    if (seen.has(key)) continue;
    seen.add(key);
    if (ev.category === "found") found.push(ev);
    else if (ev.category === "garbled") garbled.push(ev);
    else gateway.push(ev);
  }
  // Array.prototype.sort is stable, so equal keys (same unit and target) keep arrival order.
  found.sort(byUnitThenTarget);
  garbled.sort(byUnitThenTarget);
  gateway.sort(byUnitThenTarget);
  return { found, garbled, gateway };
}

/** A result is already configured when a slave has the same unit ID and connection kind. */
export function isAlreadyInWorkspace(
  ev: ScanFoundEvent,
  slaves: { unitId: number; connectionKind: string }[],
  kind: ScanKind,
): boolean {
  return slaves.some((s) => s.unitId === ev.unitId && s.connectionKind === kind);
}

/** `Slave 17`, or `Slave 17 (2)`, `(3)`… when taken (case-insensitive). */
export function suggestSlaveName(unitId: number, existingNames: string[]): string {
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const base = `Slave ${unitId}`;
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** A unique scan ID of at most 64 characters (the backend's limit). */
export function newScanId(): string {
  const random = Math.random().toString(36).slice(2, 10) || "0";
  return `scan-${Date.now()}-${random}`;
}
