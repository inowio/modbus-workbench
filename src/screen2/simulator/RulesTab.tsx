import { FiEdit2, FiTrash2 } from "react-icons/fi";

import type { SimRule } from "../components/SimRuleModal";
import { findTargetRegister, targetLabel, type AddrFmt } from "./ruleTargets";
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
      case "condition":
        return `${bank}[${t.address}] ${t.op} ${t.value}`;
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

type Piece = { text: string; missing: boolean };
type Resolver = (unit: unknown, bank: unknown, address: unknown) => { label: string; missing: boolean };

function makeResolver(registers: readonly PageRegister[] | undefined, fmt: AddrFmt): Resolver {
  return (unit, bank, address) => {
    const b = Number(bank);
    const a = Number(address);
    const reg = registers ? findTargetRegister(registers, Number(unit ?? 1), b, a) : undefined;
    return { label: targetLabel(reg, b, a, fmt), missing: registers !== undefined && !reg };
  };
}

function triggerPiece(rule: SimRule, resolve: Resolver): Piece {
  try {
    const t = JSON.parse(rule.trigger) as Record<string, unknown>;
    switch (t.type) {
      case "interval":
        return { text: `Every ${t.ms} ms`, missing: false };
      case "condition": {
        const r = resolve(t.unit, t.bank, t.address);
        const op = String(t.op);
        const text = op === "changed" ? `${r.label} changed` : `${r.label} ${OP_LABEL[op] ?? op} ${t.value}`;
        return { text, missing: r.missing };
      }
      case "onWrite": {
        if (isAnyAddress(t.address)) return { text: `On write to ${bankLabel(Number(t.bank))} (any address)`, missing: false };
        const r = resolve(t.unit, t.bank, t.address);
        return { text: `On write to ${r.label}`, missing: r.missing };
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
    switch (a.type) {
      case "set":
        return { text: `Set ${dst.label} = ${a.value}`, missing: dst.missing };
      case "inc":
        return { text: `Increment ${dst.label} by ${a.by}`, missing: dst.missing };
      case "dec":
        return { text: `Decrement ${dst.label} by ${a.by}`, missing: dst.missing };
      case "toggle":
        return { text: `Toggle ${dst.label}`, missing: dst.missing };
      case "copy": {
        const src = resolve(a.srcUnit, a.srcBank, a.srcAddr);
        return { text: `Copy ${src.label} → ${dst.label}`, missing: dst.missing || src.missing };
      }
      case "randomize":
        return { text: `Randomize ${dst.label} ${a.min}..${a.max}`, missing: dst.missing };
      default:
        return { text: String(a.type ?? "unknown action"), missing: false };
    }
  });
}

function PieceView({ piece }: { piece: Piece }) {
  return piece.missing ? (
    <span title="No such register" className="text-amber-700 dark:text-amber-300">{piece.text}</span>
  ) : (
    <span>{piece.text}</span>
  );
}

/** Best-effort scope resolution: does the trigger target a unit that maps to a known device? */
function ruleScope(rule: SimRule, devices: SimDevice[]): string {
  try {
    const t = JSON.parse(rule.trigger) as Record<string, unknown>;
    const unit = Number(t.unit);
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
