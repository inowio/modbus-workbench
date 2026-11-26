import { useEffect, useState } from "react";
import { RiCloseLine } from "react-icons/ri";

import {
  DEADBAND_OPS,
  bankName,
  exactRegister,
  findTargetRegister,
  fmtAddr,
  isBitTarget,
  readConditions,
  refKey,
  registerOptionLabel,
  setHint,
  stepHint,
  targetLabel,
  type AddrFmt,
  type RuleJoin,
} from "../simulator/ruleTargets";
import { registerScaling } from "../simulator/scaling";
import type { PageRegister } from "../simulator/useSimulatorData";

export type SimRule = {
  id: number;
  name: string;
  enabled: boolean;
  trigger: string;
  actions: string;
  sortOrder: number;
};

/** One condition row. `value`/`deadband` are kept as typed text (engineering units). */
type CondRow = {
  unit: number;
  bank: number;
  address: number;
  op: string;
  value: string;
  deadband: string;
};

type TriggerForm = {
  type: string;
  ms: number;
  /** onWrite target (conditions carry their own). */
  unit: number;
  bank: number;
  address: number;
  join: RuleJoin;
  conds: CondRow[];
};

type ActionRow = {
  type: string;
  unit: number;
  bank: number;
  address: number;
  /** Engineering-unit text for Set / Inc / Dec. */
  value: string;
  by: string;
  srcUnit: number;
  srcBank: number;
  srcAddr: number;
  scale: number;
  offset: number;
  min: number;
  max: number;
  delayMs: number;
  dataType: string;
  byteOrder: string;
};

const ACTION_TYPES = ["u16", "i16", "u32", "i32", "f32", "u64", "i64", "f64"];
const BYTE_ORDERS = ["ABCD", "BADC", "CDAB", "DCBA"];
const MULTI_WORD = new Set(["u32", "i32", "f32", "u64", "i64", "f64"]);
const OPS = ["==", "!=", "<", ">", ">=", "<="];

const EMPTY_RULE: SimRule = {
  id: 0,
  name: "",
  enabled: true,
  trigger: "",
  actions: "",
  sortOrder: 0,
};

const DEFAULT_COND: CondRow = { unit: 1, bank: 3, address: 0, op: "==", value: "0", deadband: "" };

const DEFAULT_TRIGGER: TriggerForm = {
  type: "interval",
  ms: 1000,
  unit: 1,
  bank: 3,
  address: 0,
  join: "all",
  conds: [DEFAULT_COND],
};

const DEFAULT_ACTION: ActionRow = {
  type: "set",
  unit: 1,
  bank: 3,
  address: 0,
  value: "0",
  by: "1",
  srcUnit: 1,
  srcBank: 3,
  srcAddr: 0,
  scale: 1,
  offset: 0,
  min: 0,
  max: 100,
  delayMs: 0,
  dataType: "u16",
  byteOrder: "ABCD",
};

const BANKS = [
  { value: 1, label: "Coils (1)" },
  { value: 2, label: "Discrete input (2)" },
  { value: 3, label: "Holding (3)" },
  { value: 4, label: "Input (4)" },
];

// The backend only emits write events for coil and holding writes (a client
// cannot write discrete inputs or input registers), so an onWrite trigger on
// bank 2/4 could never fire — restrict its bank options accordingly.
const WRITABLE_BANKS = BANKS.filter((b) => b.value === 1 || b.value === 3);

const numText = (v: unknown, fallback: string): string =>
  typeof v === "number" && Number.isFinite(v) ? String(v) : fallback;

/** Typed text → number; blank or junk → NaN. */
const parseNum = (text: string): number => (text.trim() === "" ? NaN : Number(text));

/** The register a picked dropdown value refers to, so a new row starts on a real register. */
function firstRegister(registers: readonly PageRegister[] | undefined): PageRegister | undefined {
  return registers?.[0];
}

/** Stored-type fallback for an action that targets `reg` (word banks only). */
function typeOf(reg: PageRegister): { dataType: string; byteOrder: string } {
  return {
    dataType: ACTION_TYPES.includes(reg.dataType) ? reg.dataType : "u16",
    byteOrder: reg.byteOrder || "ABCD",
  };
}

function defaultCond(registers: readonly PageRegister[] | undefined): CondRow {
  const r = firstRegister(registers);
  return r ? { ...DEFAULT_COND, unit: r.unitId, bank: r.functionCode, address: r.address } : { ...DEFAULT_COND };
}

function defaultAction(registers: readonly PageRegister[] | undefined): ActionRow {
  const r = firstRegister(registers);
  if (!r) return { ...DEFAULT_ACTION };
  const isWord = r.functionCode === 3 || r.functionCode === 4;
  return {
    ...DEFAULT_ACTION,
    unit: r.unitId,
    bank: r.functionCode,
    address: r.address,
    srcUnit: r.unitId,
    srcBank: r.functionCode,
    srcAddr: r.address,
    ...(isWord ? typeOf(r) : {}),
  };
}

function parseTrigger(raw: string | undefined, registers: readonly PageRegister[] | undefined): TriggerForm {
  const base: TriggerForm = { ...DEFAULT_TRIGGER, conds: [defaultCond(registers)] };
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return base;
    const form: TriggerForm = {
      ...base,
      type: parsed.type ?? base.type,
      ms: parsed.ms ?? base.ms,
      unit: parsed.unit ?? base.unit,
      bank: parsed.bank ?? base.bank,
      address: parsed.address ?? base.address,
    };
    if (parsed.type === "condition") {
      // Reads both the legacy single shape and {join, conditions:[…]}.
      const { join, conditions } = readConditions(parsed);
      if (conditions.length > 0) {
        form.join = join;
        form.conds = conditions.map((c) => ({
          unit: c.unit,
          bank: c.bank,
          address: c.address,
          op: c.op,
          value: String(c.value),
          deadband: c.deadband > 0 ? String(c.deadband) : "",
        }));
      }
    }
    return form;
  } catch {
    return base;
  }
}

function parseActions(raw: string | undefined): ActionRow[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((a) => ({
      type: a.type ?? DEFAULT_ACTION.type,
      unit: a.unit ?? DEFAULT_ACTION.unit,
      bank: a.bank ?? DEFAULT_ACTION.bank,
      address: a.address ?? DEFAULT_ACTION.address,
      value: numText(a.value, DEFAULT_ACTION.value),
      by: numText(a.by, DEFAULT_ACTION.by),
      srcUnit: a.srcUnit ?? DEFAULT_ACTION.srcUnit,
      srcBank: a.srcBank ?? DEFAULT_ACTION.srcBank,
      srcAddr: a.srcAddr ?? DEFAULT_ACTION.srcAddr,
      scale: a.scale ?? DEFAULT_ACTION.scale,
      offset: a.offset ?? DEFAULT_ACTION.offset,
      min: a.min ?? DEFAULT_ACTION.min,
      max: a.max ?? DEFAULT_ACTION.max,
      delayMs: a.delayMs ?? DEFAULT_ACTION.delayMs,
      dataType: a.dataType ?? DEFAULT_ACTION.dataType,
      byteOrder: a.byteOrder ?? DEFAULT_ACTION.byteOrder,
    }));
  } catch {
    return [];
  }
}

/** Number to store; a non-numeric field (already blocked by validation) falls back to 0. */
const storedNum = (text: string): number => {
  const n = parseNum(text);
  return Number.isFinite(n) ? n : 0;
};

/** `bandApplies(c)`: whether condition `c` carries a deadband (level op on a non-bit register). */
function buildTriggerJson(t: TriggerForm, bandApplies: (c: CondRow) => boolean): string {
  if (t.type === "interval") {
    return JSON.stringify({ type: "interval", ms: t.ms });
  }
  if (t.type === "condition") {
    // Always the list shape; deadband only where it applies and non-zero.
    const conditions = t.conds.map((c) => {
      const out: Record<string, unknown> = { unit: c.unit, bank: c.bank, address: c.address, op: c.op, value: storedNum(c.value) };
      const band = storedNum(c.deadband);
      if (bandApplies(c) && band > 0) out.deadband = band;
      return out;
    });
    return JSON.stringify({ type: "condition", join: t.conds.length > 1 ? t.join : "all", conditions });
  }
  return JSON.stringify({ type: "onWrite", unit: t.unit, bank: t.bank, address: t.address });
}

// Multi-word width applies to word banks (holding/input) for value-producing
// actions; toggle and bit banks are always single-word.
function typeApplies(a: ActionRow): boolean {
  return a.type !== "toggle" && (a.bank === 3 || a.bank === 4);
}

function buildActionJson(a: ActionRow): Record<string, unknown> {
  const base: Record<string, unknown> = { type: a.type, unit: a.unit, bank: a.bank, address: a.address };
  // Only persist a delay/width when non-default, keeping stored JSON minimal.
  if (a.delayMs > 0) base.delayMs = a.delayMs;
  if (typeApplies(a) && a.dataType !== "u16") {
    base.dataType = a.dataType;
    if (MULTI_WORD.has(a.dataType)) base.byteOrder = a.byteOrder;
  }
  switch (a.type) {
    case "set":
      return { ...base, value: storedNum(a.value) };
    case "inc":
    case "dec":
      return { ...base, by: storedNum(a.by) };
    case "toggle":
      return { ...base };
    case "copy":
      return { ...base, srcUnit: a.srcUnit, srcBank: a.srcBank, srcAddr: a.srcAddr, scale: a.scale, offset: a.offset };
    case "randomize":
      return { ...base, min: a.min, max: a.max };
    default:
      return base;
  }
}

function Warn({ text }: { text: string }) {
  return <div className="col-span-full text-[11px] text-amber-700 dark:text-amber-300">{text}</div>;
}

function Hint({ text }: { text: string }) {
  return <div className="col-span-full text-[11px] text-slate-500 dark:text-slate-400">{text}</div>;
}

const inputCls =
  "rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900";

/**
 * A register dropdown ("Temperature · input 0x0001"). A stored reference with
 * no register at that start address stays selected as its own option, so
 * opening and saving a legacy rule never changes what it points at.
 */
function RegisterSelect(props: {
  label: string;
  unit: number;
  bank: number;
  address: number;
  registers: readonly PageRegister[] | undefined;
  fmt: AddrFmt;
  onPick: (reg: PageRegister) => void;
}) {
  const regs = props.registers ?? [];
  const key = refKey(props.unit, props.bank, props.address);
  const matched = exactRegister(regs, props.unit, props.bank, props.address);
  const multiUnit = new Set(regs.map((r) => r.unitId)).size > 1;
  const storedLabel = `${bankName(props.bank)} ${fmtAddr(props.address, props.fmt)}${multiUnit || props.unit !== 1 ? ` · unit ${props.unit}` : ""}${props.registers ? " (no register)" : ""}`;
  return (
    <select
      aria-label={props.label}
      value={key}
      onChange={(e) => {
        const reg = regs.find((r) => refKey(r.unitId, r.functionCode, r.address) === e.target.value);
        if (reg) props.onPick(reg);
      }}
      className={inputCls}
    >
      {matched ? null : <option value={key}>{storedLabel}</option>}
      {regs.map((r) => (
        <option key={r.id} value={refKey(r.unitId, r.functionCode, r.address)}>
          {registerOptionLabel(r, props.fmt, multiUnit)}
        </option>
      ))}
    </select>
  );
}

/** Engineering value input: On/Off for bits, else a number with the register's unit beside it. */
function ValueInput(props: {
  label: string;
  unitTestId: string;
  value: string;
  bank: number;
  reg: PageRegister | undefined;
  onChange: (text: string) => void;
}) {
  if (isBitTarget(props.bank, props.reg) && (props.value === "0" || props.value === "1")) {
    return (
      <select aria-label={props.label} value={props.value} onChange={(e) => props.onChange(e.target.value)} className={inputCls}>
        <option value="1">On</option>
        <option value="0">Off</option>
      </select>
    );
  }
  return <NumberWithUnit {...props} />;
}

function NumberWithUnit(props: {
  label: string;
  unitTestId: string;
  value: string;
  bank: number;
  reg: PageRegister | undefined;
  onChange: (text: string) => void;
}) {
  const unit = props.reg && !isBitTarget(props.bank, props.reg) ? registerScaling(props.reg).unit : "";
  return (
    <span className="flex items-center gap-1">
      <input
        aria-label={props.label}
        type="number"
        step="any"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className={`${inputCls} min-w-0 flex-1`}
      />
      {unit ? <span data-testid={props.unitTestId} className="text-slate-500 dark:text-slate-400">{unit}</span> : null}
    </span>
  );
}

export default function SimRuleModal(props: {
  open: boolean;
  initial: SimRule | null;
  onClose: () => void;
  onSubmit: (rule: SimRule) => void | Promise<void>;
  /** Workspace registers: the dropdown choices, and used to warn about targets that don't exist. */
  registers?: readonly PageRegister[];
  /** Dec/Hex address display. */
  addrFmt?: AddrFmt;
  /** Save error to show inside the dialog (it stays open on failure). */
  error?: string | null;
}) {
  const [rule, setRule] = useState<SimRule>(EMPTY_RULE);
  const [trigger, setTrigger] = useState<TriggerForm>(DEFAULT_TRIGGER);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const fmt: AddrFmt = props.addrFmt ?? "dec";

  useEffect(() => {
    if (!props.open) return;
    const next = props.initial ?? EMPTY_RULE;
    setRule(next);
    setTrigger(parseTrigger(next.trigger, props.registers));
    setActions(parseActions(next.actions));
    // Registers refresh while open; re-seeding on them would wipe the user's input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.initial]);

  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        props.onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props.open, props.onClose]);

  if (!props.open) return null;

  const set = (patch: Partial<SimRule>) => setRule((r) => ({ ...r, ...patch }));
  const setTriggerField = (patch: Partial<TriggerForm>) => setTrigger((t) => ({ ...t, ...patch }));
  const updateCond = (idx: number, patch: Partial<CondRow>) =>
    setTrigger((t) => ({ ...t, conds: t.conds.map((c, i) => (i === idx ? { ...c, ...patch } : c)) }));
  const addCond = () => setTrigger((t) => ({ ...t, conds: [...t.conds, defaultCond(props.registers)] }));
  const removeCond = (idx: number) => setTrigger((t) => ({ ...t, conds: t.conds.filter((_, i) => i !== idx) }));

  const addAction = () => setActions((rows) => [...rows, defaultAction(props.registers)]);
  const removeAction = (idx: number) => setActions((rows) => rows.filter((_, i) => i !== idx));
  const updateAction = (idx: number, patch: Partial<ActionRow>) =>
    setActions((rows) => rows.map((row, i) => (i === idx ? { ...row, ...patch } : row)));

  const regAt = (unit: number, bank: number, address: number) => exactRegister(props.registers, unit, bank, address);

  /** onWrite matches the written word, so any word of a register counts. */
  const missingText = (unit: number, bank: number, address: number): string | null => {
    if (!props.registers) return null;
    if (findTargetRegister(props.registers, unit, bank, address)) return null;
    return `No register at ${bankName(bank)} ${fmtAddr(address, fmt)} on unit ${unit} — this does nothing until you add one.`;
  };
  /** Conditions and actions use the register STARTING at the address (its type and scaling). */
  const refWarn = (unit: number, bank: number, address: number): string | null => {
    if (!props.registers || regAt(unit, bank, address)) return null;
    const covering = findTargetRegister(props.registers, unit, bank, address);
    if (covering) {
      return `${bankName(bank)} ${fmtAddr(address, fmt)} is inside ${targetLabel(covering, bank, covering.address, fmt)} — pick the register itself to use its type and scaling.`;
    }
    return missingText(unit, bank, address);
  };

  /** Picking a register for a value field: a bit register starts at On rather than a meaningless number. */
  const bitValue = (reg: PageRegister, current: string): string =>
    isBitTarget(reg.functionCode, reg) && current !== "0" && current !== "1" ? "1" : current;

  const isCondition = trigger.type === "condition";
  const multi = trigger.conds.length > 1;
  const onWriteWarn = trigger.type === "onWrite" ? missingText(trigger.unit, trigger.bank, trigger.address) : null;

  const nameMissing = rule.name.trim() === "";
  const noActions = actions.length === 0;
  // Deadband applies to level comparisons on word registers; a bit is only 0/1.
  const bandApplies = (c: CondRow) => DEADBAND_OPS.has(c.op) && !isBitTarget(c.bank, regAt(c.unit, c.bank, c.address));
  const negativeBand = isCondition && trigger.conds.some((c) => bandApplies(c) && parseNum(c.deadband) < 0);
  const badCondNumber =
    isCondition &&
    trigger.conds.some(
      (c) =>
        (c.op !== "changed" && !Number.isFinite(parseNum(c.value))) ||
        (bandApplies(c) && c.deadband.trim() !== "" && !Number.isFinite(parseNum(c.deadband))),
    );
  const badActionNumber = actions.some(
    (a) =>
      (a.type === "set" && !Number.isFinite(parseNum(a.value))) ||
      ((a.type === "inc" || a.type === "dec") && !Number.isFinite(parseNum(a.by))),
  );
  const changedInMulti = isCondition && multi && trigger.conds.some((c) => c.op === "changed");
  const saveBlock = nameMissing
    ? "Enter a rule name."
    : noActions
      ? "Add at least one action."
      : negativeBand
        ? "Deadband can't be negative."
        : changedInMulti
          ? "\"changed\" can only be used as the only condition."
          : badCondNumber || badActionNumber
            ? "Enter a number for each value."
            : null;

  const handleSubmit = () => {
    if (saveBlock) return;
    const triggerJson = buildTriggerJson(trigger, bandApplies);
    const actionsJson = JSON.stringify(actions.map(buildActionJson));
    void props.onSubmit({ ...rule, trigger: triggerJson, actions: actionsJson });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sim-rule-title"
        className="max-h-full w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <div id="sim-rule-title" className="min-w-0 truncate text-sm font-semibold text-emerald-700 dark:text-emerald-200">
            {rule.id ? "Edit rule" : "Add rule"}
          </div>
          <button type="button" onClick={props.onClose} title="Close"
            className="flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-500">
            <RiCloseLine className="h-4 w-3" aria-hidden="true" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs">
            Rule name
            <input
              aria-label="Rule name"
              value={rule.name}
              onChange={(e) => set({ name: e.target.value })}
              className={inputCls}
            />
          </label>

          <label className="flex flex-row items-center gap-2 text-xs">
            <input
              type="checkbox"
              aria-label="Enabled"
              checked={rule.enabled}
              onChange={(e) => set({ enabled: e.target.checked })}
            />
            Enabled
          </label>

          <label className="flex flex-col gap-1 text-xs">
            Trigger type
            <select
              aria-label="Trigger type"
              value={trigger.type}
              onChange={(e) => setTriggerField({ type: e.target.value })}
              className={inputCls}
            >
              <option value="interval">Every N ms</option>
              <option value="condition">When a condition is met</option>
              <option value="onWrite">When a client writes</option>
            </select>
          </label>

          {trigger.type === "interval" && (
            <label className="flex flex-col gap-1 text-xs">
              Interval (ms)
              <input
                aria-label="Trigger interval ms"
                type="number"
                min={0}
                value={trigger.ms}
                onChange={(e) => setTriggerField({ ms: Number(e.target.value) })}
                className={inputCls}
              />
            </label>
          )}

          {trigger.type === "onWrite" && (
            <>
              <label className="flex flex-col gap-1 text-xs">
                Unit
                <input
                  aria-label="Trigger unit"
                  type="number"
                  min={0}
                  max={255}
                  value={trigger.unit}
                  onChange={(e) => setTriggerField({ unit: Number(e.target.value) })}
                  className={inputCls}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Bank
                <select
                  aria-label="Trigger bank"
                  value={trigger.bank}
                  onChange={(e) => setTriggerField({ bank: Number(e.target.value) })}
                  className={inputCls}
                >
                  {WRITABLE_BANKS.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Address
                <input
                  aria-label="Trigger address"
                  type="number"
                  min={0}
                  max={65535}
                  value={trigger.address}
                  onChange={(e) => setTriggerField({ address: Number(e.target.value) })}
                  className={inputCls}
                />
              </label>
              {onWriteWarn ? <div className="col-span-2"><Warn text={onWriteWarn} /></div> : null}
            </>
          )}

          {isCondition && (
            <div className="col-span-2 flex flex-col gap-2">
              {multi ? (
                <label className="flex items-center gap-2 text-xs">
                  When
                  <select
                    aria-label="Condition join"
                    value={trigger.join}
                    onChange={(e) => setTriggerField({ join: e.target.value === "any" ? "any" : "all" })}
                    className={inputCls}
                  >
                    <option value="all">All of</option>
                    <option value="any">Any of</option>
                  </select>
                  these are true
                </label>
              ) : null}

              {trigger.conds.map((c, idx) => {
                const reg = regAt(c.unit, c.bank, c.address);
                const warn = refWarn(c.unit, c.bank, c.address);
                // `changed` is an event, not a level: single-condition only.
                const ops = multi ? (c.op === "changed" ? [...OPS, "changed"] : OPS) : [...OPS, "changed"];
                return (
                  <div key={idx} className="grid grid-cols-6 items-end gap-2 rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-700">
                    <label className="col-span-2 flex flex-col gap-1">
                      Register
                      <RegisterSelect
                        label={`Condition register ${idx}`}
                        unit={c.unit}
                        bank={c.bank}
                        address={c.address}
                        registers={props.registers}
                        fmt={fmt}
                        onPick={(r) => updateCond(idx, { unit: r.unitId, bank: r.functionCode, address: r.address, value: bitValue(r, c.value) })}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      Op
                      <select
                        aria-label={`Condition op ${idx}`}
                        value={c.op}
                        onChange={(e) => updateCond(idx, { op: e.target.value })}
                        className={inputCls}
                      >
                        {ops.map((op) => (
                          <option key={op} value={op}>{op}</option>
                        ))}
                      </select>
                    </label>
                    {c.op !== "changed" ? (
                      <label className="flex flex-col gap-1">
                        Value
                        <ValueInput
                          label={`Condition value ${idx}`}
                          unitTestId={`cond-value-unit-${idx}`}
                          value={c.value}
                          bank={c.bank}
                          reg={reg}
                          onChange={(text) => updateCond(idx, { value: text })}
                        />
                      </label>
                    ) : null}
                    {bandApplies(c) ? (
                      <label className="flex flex-col gap-1" title="Re-arms only after the value moves back past the threshold by this much">
                        Deadband
                        <NumberWithUnit
                          label={`Condition deadband ${idx}`}
                          unitTestId={`cond-deadband-unit-${idx}`}
                          value={c.deadband}
                          bank={c.bank}
                          reg={reg}
                          onChange={(text) => updateCond(idx, { deadband: text })}
                        />
                      </label>
                    ) : null}
                    {multi ? (
                      <button
                        type="button"
                        aria-label={`Remove condition ${idx}`}
                        onClick={() => removeCond(idx)}
                        className="justify-self-start rounded-full border border-rose-500/60 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-700 dark:border-rose-500/60 dark:text-rose-300"
                      >
                        Remove
                      </button>
                    ) : null}
                    {warn ? <Warn text={warn} /> : null}
                  </div>
                );
              })}

              {!(trigger.conds.length === 1 && trigger.conds[0].op === "changed") ? (
                <button
                  type="button"
                  onClick={addCond}
                  className="self-start text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
                >
                  + Add condition
                </button>
              ) : null}
            </div>
          )}
        </div>

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">Actions</div>
            <button
              type="button"
              name="Add action"
              onClick={addAction}
              className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-500/60 dark:text-emerald-200"
            >
              Add action
            </button>
          </div>

          {noActions ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              No actions yet — add one, or the rule does nothing.
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            {actions.map((action, idx) => {
              const reg = regAt(action.unit, action.bank, action.address);
              const pickTarget = (r: PageRegister) =>
                updateAction(idx, {
                  unit: r.unitId,
                  bank: r.functionCode,
                  address: r.address,
                  value: action.type === "set" ? bitValue(r, action.value) : action.value,
                  // Record the register's type as the stored fallback (used only if it later disappears).
                  ...(r.functionCode === 3 || r.functionCode === 4 ? typeOf(r) : {}),
                });
              const w = refWarn(action.unit, action.bank, action.address);
              const ws = action.type === "copy" ? refWarn(action.srcUnit, action.srcBank, action.srcAddr) : null;
              const hint =
                action.type === "set"
                  ? setHint(parseNum(action.value), reg, action.bank)
                  : action.type === "inc" || action.type === "dec"
                    ? stepHint(parseNum(action.by), reg, action.bank)
                    : null;
              return (
                <div
                  key={idx}
                  className="grid grid-cols-6 items-end gap-2 rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-700"
                >
                  <label className="flex flex-col gap-1">
                    Type
                    <select
                      aria-label={`Action type ${idx}`}
                      value={action.type}
                      onChange={(e) => updateAction(idx, { type: e.target.value })}
                      className={inputCls}
                    >
                      <option value="set">Set</option>
                      <option value="inc">Increment</option>
                      <option value="dec">Decrement</option>
                      <option value="toggle">Toggle</option>
                      <option value="copy">Copy from</option>
                      <option value="randomize">Randomize</option>
                    </select>
                  </label>

                  {action.type === "copy" && (
                    <label className="col-span-2 flex flex-col gap-1">
                      From
                      <RegisterSelect
                        label={`Action source ${idx}`}
                        unit={action.srcUnit}
                        bank={action.srcBank}
                        address={action.srcAddr}
                        registers={props.registers}
                        fmt={fmt}
                        onPick={(r) => updateAction(idx, { srcUnit: r.unitId, srcBank: r.functionCode, srcAddr: r.address })}
                      />
                    </label>
                  )}

                  <label className="col-span-2 flex flex-col gap-1">
                    {action.type === "copy" ? "To" : "Register"}
                    <RegisterSelect
                      label={`Action target ${idx}`}
                      unit={action.unit}
                      bank={action.bank}
                      address={action.address}
                      registers={props.registers}
                      fmt={fmt}
                      onPick={pickTarget}
                    />
                  </label>

                  {action.type === "set" && (
                    <label className="flex flex-col gap-1">
                      Value
                      <ValueInput
                        label={`Action value ${idx}`}
                        unitTestId={`action-value-unit-${idx}`}
                        value={action.value}
                        bank={action.bank}
                        reg={reg}
                        onChange={(text) => updateAction(idx, { value: text })}
                      />
                    </label>
                  )}

                  {(action.type === "inc" || action.type === "dec") && (
                    <label className="flex flex-col gap-1">
                      By
                      <NumberWithUnit
                        label={`Action by ${idx}`}
                        unitTestId={`action-by-unit-${idx}`}
                        value={action.by}
                        bank={action.bank}
                        reg={reg}
                        onChange={(text) => updateAction(idx, { by: text })}
                      />
                    </label>
                  )}

                  {action.type === "copy" && (
                    <>
                      <label className="flex flex-col gap-1">
                        Scale
                        <input
                          aria-label={`Action scale ${idx}`}
                          type="number"
                          value={action.scale}
                          onChange={(e) => updateAction(idx, { scale: Number(e.target.value) })}
                          className={inputCls}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        Offset
                        <input
                          aria-label={`Action offset ${idx}`}
                          type="number"
                          value={action.offset}
                          onChange={(e) => updateAction(idx, { offset: Number(e.target.value) })}
                          className={inputCls}
                        />
                      </label>
                    </>
                  )}

                  {action.type === "randomize" && (
                    <>
                      <label className="flex flex-col gap-1">
                        Min
                        <input
                          aria-label={`Action min ${idx}`}
                          type="number"
                          value={action.min}
                          onChange={(e) => updateAction(idx, { min: Number(e.target.value) })}
                          className={inputCls}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        Max
                        <input
                          aria-label={`Action max ${idx}`}
                          type="number"
                          value={action.max}
                          onChange={(e) => updateAction(idx, { max: Number(e.target.value) })}
                          className={inputCls}
                        />
                      </label>
                    </>
                  )}

                  <label className="flex flex-col gap-1">
                    Delay (ms)
                    <input
                      aria-label={`Action delay ${idx}`}
                      type="number"
                      min={0}
                      value={action.delayMs}
                      onChange={(e) => updateAction(idx, { delayMs: Math.max(0, Number(e.target.value)) })}
                      className={inputCls}
                    />
                  </label>

                  {/* The target's own type wins; these are only the fallback for a reference with no register. */}
                  {typeApplies(action) && !reg && (
                    <label className="flex flex-col gap-1">
                      Target type
                      <select
                        aria-label={`Action data type ${idx}`}
                        value={action.dataType}
                        onChange={(e) => updateAction(idx, { dataType: e.target.value })}
                        className={inputCls}
                      >
                        {ACTION_TYPES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </label>
                  )}

                  {typeApplies(action) && !reg && MULTI_WORD.has(action.dataType) && (
                    <label className="flex flex-col gap-1">
                      Byte order
                      <select
                        aria-label={`Action byte order ${idx}`}
                        value={action.byteOrder}
                        onChange={(e) => updateAction(idx, { byteOrder: e.target.value })}
                        className={inputCls}
                      >
                        {BYTE_ORDERS.map((b) => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                      </select>
                    </label>
                  )}

                  {hint ? <Hint text={hint} /> : null}
                  {w ? <Warn text={w} /> : null}
                  {ws ? <Warn text={ws.replace("No register at", "No source register at")} /> : null}

                  <button
                    type="button"
                    aria-label={`Remove action ${idx}`}
                    onClick={() => removeAction(idx)}
                    className="justify-self-start rounded-full border border-rose-500/60 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-700 dark:border-rose-500/60 dark:text-rose-300"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {props.error ? (
          <div role="alert" className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">{props.error}</div>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100"
          >
            Cancel
          </button>
          {saveBlock ? <span className="self-center text-xs text-slate-500 dark:text-slate-400">{saveBlock}</span> : null}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saveBlock !== null}
            className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-50 dark:border-emerald-500/60 dark:text-emerald-200"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
