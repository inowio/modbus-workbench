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

/**
 * A result is already configured when a slave has the same unit ID and connection kind. TCP slaves
 * share the workspace's single host, so a TCP result also has to be on that host (`wsTcpTarget`,
 * "host:port").
 */
export function isAlreadyInWorkspace(
  ev: ScanFoundEvent,
  slaves: { unitId: number; connectionKind: string }[],
  kind: ScanKind,
  wsTcpTarget: string | null,
): boolean {
  if (kind === "tcp" && ev.target !== wsTcpTarget) return false;
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

const NOT_AN_ADDRESS = "Not an IPv4 address or range";
const UNSCANNABLE = "Multicast, broadcast and 0.x addresses can't be scanned";
const MAX_RANGE_ADDRS = 1024;

function parseIpv4(s: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s.trim());
  if (!m) return null;
  let ip = 0;
  for (const part of m.slice(1)) {
    if (part.length > 1 && part.startsWith("0")) return null; // like Rust, no leading zeros
    const n = Number(part);
    if (n > 255) return null;
    ip = ip * 256 + n;
  }
  return ip;
}

function isScannable(ip: number): boolean {
  const first = Math.floor(ip / 2 ** 24);
  return first !== 0 && first < 224;
}

/**
 * Mirrors `slave_scan::types::parse_ip_range`: the same forms, refusals and copy. Returns the
 * number of addresses (after CIDR network/broadcast exclusion), or the error to show.
 */
export function parseIpRange(input: string): { count: number } | { error: string } {
  const s = input.trim();
  const bad = { error: NOT_AN_ADDRESS };
  let start: number;
  let end: number;
  const slash = s.indexOf("/");
  const dash = s.indexOf("-");
  if (slash >= 0) {
    const ip = parseIpv4(s.slice(0, slash));
    const prefixText = s.slice(slash + 1).trim();
    if (ip === null || !/^\d+$/.test(prefixText)) return bad;
    const prefix = Number(prefixText);
    if (prefix > 32) return bad;
    const size = 2 ** (32 - prefix);
    const net = Math.floor(ip / size) * size;
    const bcast = net + size - 1;
    [start, end] = prefix <= 30 ? [net + 1, bcast - 1] : [net, bcast];
  } else if (dash >= 0) {
    const a = parseIpv4(s.slice(0, dash));
    if (a === null) return bad;
    const b = s.slice(dash + 1).trim();
    if (b.includes(".")) {
      const e = parseIpv4(b);
      if (e === null) return bad;
      end = e;
    } else {
      if (!/^\d+$/.test(b) || Number(b) > 255) return bad;
      end = Math.floor(a / 256) * 256 + Number(b);
    }
    start = a;
  } else {
    const ip = parseIpv4(s);
    if (ip === null) return bad;
    start = ip;
    end = ip;
  }
  if (end < start) return { error: "Range end is before its start" };
  if (!isScannable(start) || !isScannable(end)) return { error: UNSCANNABLE };
  const count = end - start + 1;
  if (count > MAX_RANGE_ADDRS) return { error: `Too many addresses (${count}) — the limit is ${MAX_RANGE_ADDRS}` };
  return { count };
}

/** Worst-case time for stage 1 (finding hosts): every address times out on every attempt (stage 1 retries at least once). */
export function estimateRangeSeconds(args: {
  addresses: number;
  connectWaitMs: number;
  retries: number;
  hostConcurrency: number;
}): number {
  const { addresses, connectWaitMs, retries, hostConcurrency } = args;
  return Math.ceil((addresses * connectWaitMs * (Math.max(retries, 1) + 1)) / Math.max(1, hostConcurrency) / 1000);
}

/** Splits a default range such as `192.168.68.1-254` into network, first and last host. */
export function splitDefaultRange(s: string | null): { net: string; from: string; to: string } | null {
  const m = s === null ? null : /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})-(\d{1,3})$/.exec(s.trim());
  return m ? { net: m[1], from: m[2], to: m[3] } : null;
}

/** First problem with the simple range inputs (network, first and last host), or null. */
export function simpleRangeProblem(net: string, from: string, to: string): string | null {
  const octets = net.trim().split(".");
  const netOk =
    octets.length === 3 &&
    octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255 && (o.length === 1 || !o.startsWith("0"))) &&
    Number(octets[0]) !== 0 &&
    Number(octets[0]) < 224;
  if (!netOk) return "Enter the network, like 192.168.68";
  const host = (v: string) => (/^\d+$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= 254 ? Number(v) : null);
  const f = host(from);
  const t = host(to);
  if (f === null || t === null) return "From and To must be 1–254";
  if (f > t) return "From must not be after To";
  return null;
}

export function simpleRangeText(net: string, from: string, to: string): string {
  const norm = (v: string) => (/^\d+$/.test(v.trim()) ? String(Number(v)) : v.trim());
  return `${net.trim()}.${norm(from)}-${norm(to)}`;
}
