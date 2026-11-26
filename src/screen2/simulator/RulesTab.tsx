import { FiEdit2, FiTrash2 } from "react-icons/fi";

import type { SimRule } from "../components/SimRuleModal";
import {
  DEADBAND_OPS,
  bankName,
  exactRegister,
  findTargetRegister,
  fmtAddr,
  formatRuleValue,
  readConditions,
  ruleRegisterName,
  targetLabel,
  type AddrFmt,
} from "./ruleTargets";
import type { PageRegister, SimDevice } from "./useSimulatorData";

const BANK_LABEL: Record<number, string> = { 1: "coil", 2: "discrete", 3: "holding", 4: "input" };
const bankLabel = (bank: number): string => BANK_LABEL[bank] ?? "reg";

/** Legacy onWrite triggers with a missing or negative address match any address (backend semantics). */
const isAnyAddress = (address: unknown): boolean => address === undefined || address === null || Number(address) < 0;

type ActionRow = {
  type: string;
  bank: number;
  address: number;
  value?: number;
  by?: number;
  srcBank?: number;
  srcAddr?: number;
  min?: number;
  max?: number;
};

/** Human summary of a trigger's JSON, e.g. `holding[5] > 60`. */
export function ruleSummary(rule: SimRule): string {
  try {
    const t = JSON.parse(rule.trigger) as Record<string, unknown>;
    const bank = bankLabel(Number(t.bank));
    switch (t.type) {
      case "interval":
        return `interval ${t.ms}ms`;
      case "condition": {
        const { join, conditions } = readConditions(t);
        return conditions
          .map((c) => `${bankLabel(c.bank)}[${c.address}] ${c.op} ${c.value}`)
          .join(join === "any" ? " or " : " and ");
      }
      case "onWrite":
        return `onWrite ${bank}[${isAnyAddress(t.address) ? "any" : t.address}]`;
      default:
        return String(t.type ?? "unknown trigger");
    }
  } catch {
    return "invalid trigger";
  }
}

/** Human summary of a rule's actions JSON, e.g. `Set holding[10]=1 · Inc holding[1] by 2`. */
export function actionsSummary(rule: SimRule): string {
  let rows: ActionRow[];
  try {
    const parsed = JSON.parse(rule.actions);
    if (!Array.isArray(parsed) || parsed.length === 0) return "—";
    rows = parsed;
  } catch {
    return "—";
  }
  return rows
    .map((a) => {
      const bank = bankLabel(Number(a.bank));
      switch (a.type) {
        case "set":
          return `Set ${bank}[${a.address}]=${a.value}`;
        case "inc":
          return `Inc ${bank}[${a.address}] by ${a.by}`;
        case "dec":
          return `Dec ${bank}[${a.address}] by ${a.by}`;
        case "toggle":
          return `Toggle ${bank}[${a.address}]`;
        case "copy":
          return `Copy ${bankLabel(Number(a.srcBank))}[${a.srcAddr}]→${bank}[${a.address}]`;
        case "randomize":
          return `Randomize ${bank}[${a.address}] ${a.min}..${a.max}`;
        default:
          return String(a.type ?? "unknown action");
      }
    })
    .join(" · ");
}

const OP_LABEL: Record<string, string> = { "==": "=", "!=": "≠", ">=": "≥", "<=": "≤" };

type Piece = { text: string; missing: boolean; title?: string };
type Resolved = {
  /** Short name (alias when unique) for the summary text. */
  label: string;
  missing: boolean;
  /** Why it is flagged, or the full location of a found register. */
  title?: string;
  /** The register starting at this address (its units/decimals format values). */
  reg?: PageRegister;
  bank: number;
};
/** `anyWord`: a write to any word of a register counts (onWrite matches the written address). */
type Resolver = (unit: unknown, bank: unknown, address: unknown, anyWord?: boolean) => Resolved;

function makeResolver(registers: readonly PageRegister[] | undefined, fmt: AddrFmt): Resolver {
  return (unit, bank, address, anyWord = false) => {
    const u = Number(unit ?? 1);
    const b = Number(bank);
    const a = Number(address);
    const loc = `${bankName(b)} ${fmtAddr(a, fmt)}`;
    // Rules reference a register by its START address (the engine looks it up there).
    const reg = exactRegister(registers, u, b, a);
    if (reg) {
      const alias = reg.alias?.trim();
      return { label: ruleRegisterName(reg, b, a, fmt, registers), missing: false, title: alias ? `${alias} · ${loc}` : undefined, reg, bank: b };
    }
    if (!registers) return { label: loc, missing: false, bank: b };
    const covering = findTargetRegister(registers, u, b, a);
    if (covering && anyWord) return { label: targetLabel(covering, b, a, fmt), missing: false, bank: b };
    return {
      label: loc,
      missing: true,
      title: covering ? "Points inside a register, not at its start" : "No such register",
      bank: b,
    };
  };
}

const opText = (op: string): string => OP_LABEL[op] ?? op;

function conditionText(c: { op: string; value: number; deadband: number }, r: Resolved): string {
  if (c.op === "changed") return `${r.label} changed`;
  const value = formatRuleValue(c.value, r.bank, r.reg);
  const band = DEADBAND_OPS.has(c.op) && c.deadband > 0 ? ` (±${formatRuleValue(c.deadband, r.bank, r.reg, false)})` : "";
  return `${r.label} ${opText(c.op)} ${value}${band}`;
}

/** Combined title: the first problem wins, else every found register's location. */
function combineTitles(parts: Resolved[]): string | undefined {
  const problem = parts.find((p) => p.missing);
  if (problem) return problem.title;
  const found = parts.map((p) => p.title).filter((t): t is string => !!t);
  return found.length ? found.join(", ") : undefined;
}

function triggerPiece(rule: SimRule, resolve: Resolver): Piece {
  try {
    const t = JSON.parse(rule.trigger) as Record<string, unknown>;
    switch (t.type) {
      case "interval":
        return { text: `Every ${t.ms} ms`, missing: false };
      case "condition": {
        const { join, conditions } = readConditions(t);
        const resolved = conditions.map((c) => resolve(c.unit, c.bank, c.address));
        const parts = conditions.map((c, i) => conditionText(c, resolved[i]));
        const text = parts.length === 1 ? parts[0] : `${join === "any" ? "Any of" : "All of"}: ${parts.join(", ")}`;
        return { text, missing: resolved.some((r) => r.missing), title: combineTitles(resolved) };
      }
      case "onWrite": {
        if (isAnyAddress(t.address)) return { text: `On write to ${bankLabel(Number(t.bank))} (any address)`, missing: false };
        const r = resolve(t.unit, t.bank, t.address, true);
        return { text: `On write to ${r.label}`, missing: r.missing, title: r.title };
      }
      default:
        return { text: String(t.type ?? "unknown trigger"), missing: false };
    }
  } catch {
    return { text: "invalid trigger", missing: false };
  }
}

function actionPieces(rule: SimRule, resolve: Resolver): Piece[] {
  let rows: Record<string, unknown>[];
  try {
    const parsed = JSON.parse(rule.actions);
    if (!Array.isArray(parsed)) return [];
    rows = parsed;
  } catch {
    return [];
  }
  return rows.map((a) => {
    const dst = resolve(a.unit, a.bank, a.address);
    const own = { missing: dst.missing, title: dst.title };
    const eng = (v: unknown) => (typeof v === "number" ? formatRuleValue(v, dst.bank, dst.reg) : String(v));
    switch (a.type) {
      case "set":
        return { text: `Set ${dst.label} = ${eng(a.value)}`, ...own };
      case "inc":
        return { text: `Increment ${dst.label} by ${eng(a.by)}`, ...own };
      case "dec":
        return { text: `Decrement ${dst.label} by ${eng(a.by)}`, ...own };
      case "toggle":
        return { text: `Toggle ${dst.label}`, ...own };
      case "copy": {
        const src = resolve(a.srcUnit, a.srcBank, a.srcAddr);
        return { text: `Copy ${src.label} → ${dst.label}`, missing: dst.missing || src.missing, title: combineTitles([src, dst]) };
      }
      case "randomize":
        return { text: `Randomize ${dst.label} ${a.min}..${a.max}`, ...own };
      default:
        return { text: String(a.type ?? "unknown action"), missing: false };
    }
  });
}

function PieceView({ piece }: { piece: Piece }) {
  return piece.missing ? (
    <span title={piece.title ?? "No such register"} className="text-amber-700 dark:text-amber-300">{piece.text}</span>
  ) : (
    <span title={piece.title}>{piece.text}</span>
  );
}

/** Best-effort scope resolution: does the trigger target a unit that maps to a known device? */
function ruleScope(rule: SimRule, devices: SimDevice[]): string {
  try {
    const t = JSON.parse(rule.trigger) as Record<string, unknown>;
    // A multi-condition trigger is scoped by its first condition's unit.
    const unit = t.type === "condition" ? (readConditions(t).conditions[0]?.unit ?? NaN) : Number(t.unit);
    if (!Number.isFinite(unit)) return "—";
    const device = devices.find((d) => d.unitId === unit);
    return device?.name ?? "—";
  } catch {
    return "—";
  }
}

export default function RulesTab(props: {
  rules: SimRule[];
  devices: SimDevice[];
  /** Workspace registers: lets the table show aliases and flag missing targets. */
  registers?: readonly PageRegister[];
  addrFmt?: AddrFmt;
  onAdd: () => void;
  onEdit: (rule: SimRule) => void;
  onToggle: (rule: SimRule, enabled: boolean) => void;
  onDelete: (id: number) => void;
}) {
  const { rules, devices, registers, onAdd, onEdit, onToggle, onDelete } = props;
  const resolve = makeResolver(registers, props.addrFmt ?? "dec");

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-white/5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Rules</h2>
        <button
          type="button"
          className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-3 py-1.5 text-sm font-semibold text-emerald-800 dark:text-emerald-200"
          onClick={onAdd}
        >
          + Add Rule
        </button>
      </div>

      <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">Rule changes apply immediately, even while the simulator is running.</p>

      {rules.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">No rules yet. Click "Add Rule".</p>
      ) : (
        <div className="overflow-x-auto" data-testid="rules-scroll">
        <table className="w-full min-w-[640px] table-fixed border-collapse text-left text-sm">
          <thead>
            <tr className="text-xs text-slate-500">
              <th className="py-1">Name</th>
              <th>Scope</th>
              <th>Trigger</th>
              <th>Actions</th>
              <th>Enabled</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-1 truncate">{rule.name}</td>
                <td className="truncate text-xs">{ruleScope(rule, devices)}</td>
                <td className="font-mono text-xs"><PieceView piece={triggerPiece(rule, resolve)} /></td>
                <td className="truncate font-mono text-xs">
                  {(() => {
                    const pieces = actionPieces(rule, resolve);
                    if (pieces.length === 0) return "—";
                    return pieces.map((p, i) => (
                      <span key={i}>{i > 0 ? " · " : null}<PieceView piece={p} /></span>
                    ));
                  })()}
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={rule.name.trim() ? `Enable ${rule.name.trim()}` : `Enable rule #${rule.id}`}
                    checked={rule.enabled}
                    onChange={(e) => onToggle(rule, e.target.checked)}
                  />
                </td>
                <td className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      aria-label={`Edit rule ${rule.name}`}
                      title="Edit rule"
                      className="rounded-md p-1.5 text-emerald-700 transition hover:bg-emerald-500/10 dark:text-emerald-300"
                      onClick={() => onEdit(rule)}
                    >
                      <FiEdit2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete rule ${rule.name}`}
                      title="Delete rule"
                      className="rounded-md p-1.5 text-rose-600 transition hover:bg-rose-500/10 dark:text-rose-300"
                      onClick={() => onDelete(rule.id)}
                    >
                      <FiTrash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
