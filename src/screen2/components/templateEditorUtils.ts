// Pure helpers for the virtual-device (template) editor.

import type { TemplateRegister } from "./AddDeviceModal";
import { parseSourceParams } from "../simulator/sourceParams";

const FOUR_WORD = new Set(["u64", "i64", "f64"]);
const TWO_WORD = new Set(["u32", "i32", "f32"]);

/** Number of 16-bit words a data type occupies (bool/u16/i16 = 1). */
export function wordSpan(dataType: string): number {
  return FOUR_WORD.has(dataType) ? 4 : TWO_WORD.has(dataType) ? 2 : 1;
}

type Placed = Pick<TemplateRegister, "offset" | "bank" | "dataType">;

/** First offset after every register already placed in `bank` (span-aware). */
export function nextFreeOffset(regs: Placed[], bank: number): number {
  let end = 0;
  for (const r of regs) if (r.bank === bank) end = Math.max(end, r.offset + wordSpan(r.dataType));
  return end;
}

/**
 * Maps a register index to the offset of the first other register in the same
 * bank whose word span overlaps it. Registers without overlap are absent.
 */
export function findOverlaps(regs: Placed[]): Map<number, number> {
  const out = new Map<number, number>();
  regs.forEach((a, i) => {
    const aEnd = a.offset + wordSpan(a.dataType);
    for (let j = 0; j < regs.length; j += 1) {
      if (j === i) continue;
      const b = regs[j];
      if (b.bank !== a.bank) continue;
      if (a.offset < b.offset + wordSpan(b.dataType) && b.offset < aEnd) {
        out.set(i, b.offset);
        return;
      }
    }
  });
  return out;
}

/** `custom_<slug>` from a name, with `_2`, `_3`… against taken keys. Empty if no usable characters. */
export function slugKey(name: string, taken: string[]): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!slug) return "";
  const base = `custom_${slug}`;
  let key = base;
  for (let n = 2; taken.includes(key); n += 1) key = `${base}_${n}`;
  return key;
}

/** Alias to show/save: the typed alias, else `Reg <offset>`. */
export function regLabel(r: { alias: string; offset: number }): string {
  const a = r.alias.trim();
  return a !== "" ? a : `Reg ${r.offset}`;
}

export function formatOffset(n: number, fmt: "dec" | "hex"): string {
  return fmt === "hex" ? `0x${n.toString(16).toUpperCase().padStart(4, "0")}` : String(n);
}

/** Parses decimal or 0x-hex text into a non-negative integer, else null. */
export function parseOffset(text: string): number | null {
  const t = text.trim();
  if (/^0x[0-9a-f]+$/i.test(t)) return parseInt(t.slice(2), 16);
  if (/^\d+$/.test(t)) return Number(t);
  return null;
}

function periodText(ms: number): string {
  return ms >= 1000 && ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`;
}

/** Short parameter summary for a register's value source. */
export function sourceSummary(r: TemplateRegister): string {
  const p = parseSourceParams(r.sourceParams);
  switch (r.valueSource) {
    case "generator": {
      const range = typeof p.min === "number" && typeof p.max === "number" ? ` ${p.min}–${p.max}` : "";
      const per = typeof p.periodMs === "number" ? ` · ${periodText(p.periodMs)}` : "";
      const unit = range && r.unit?.trim() ? ` ${r.unit.trim()}` : "";
      return `${p.kind ?? "sine"}${range}${unit}${per}`;
    }
    case "device":
      return `preset ${p.preset ?? "temperature"}`;
    case "route":
      return `route → unit ${p.slaveUnitId ?? "?"} · FC${p.functionCode ?? "?"} @${p.address ?? "?"}`;
    default:
      return "hold";
  }
}

/** The standard device categories, in the order the editor lists them. */
export const STANDARD_CATEGORIES = ["Sensors", "Power", "I/O", "Drives", "Learning", "Custom"];

/**
 * Categories the editor offers: the standard ones, then any other category
 * already used by a device (first spelling wins, compared ignoring case).
 * "Workspace" is reserved for devices built from a workspace's slaves.
 */
export function categoryOptions(inUse: string[]): string[] {
  const out = [...STANDARD_CATEGORIES];
  const seen = new Set(out.map((c) => c.toLowerCase()));
  for (const raw of inUse) {
    const c = raw.trim().replace(/\s+/g, " ");
    const k = c.toLowerCase();
    if (!c || k === "workspace" || seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/**
 * The category to save: trimmed, single-spaced, and snapped to an existing
 * option when it differs only in case — so "sensors" joins "Sensors" in the
 * Add Device gallery instead of starting a new group. Empty → "Custom".
 */
export function normalizeCategory(value: string, options: string[]): string {
  const c = value.trim().replace(/\s+/g, " ");
  if (!c) return "Custom";
  return options.find((o) => o.toLowerCase() === c.toLowerCase()) ?? c;
}
