import { useEffect, useRef, useState, type RefObject } from "react";
import { FiCode, FiCopy, FiList, FiPlus, FiTrash2 } from "react-icons/fi";
import { RiCloseLine } from "react-icons/ri";

import { useAppAddressFormat } from "../utils/addressFormatPref";
import { GENERATOR_DEFAULT_PERIOD_MS, initialPeriodText, periodPlaceholder } from "../simulator/sourceParams";
import type { DeviceTemplate, TemplateRegister } from "./AddDeviceModal";
import {
  categoryOptions, findOverlaps, formatOffset, nextFreeOffset, normalizeCategory, parseOffset, regLabel,
  slugKey, sourceSummary,
} from "./templateEditorUtils";

/** Select value for the "type a new category" choice (can't clash with a real one: it has spaces trimmed out). */
const NEW_CATEGORY = " new ";

const BANKS = [
  { value: 1, label: "Coil (1)" },
  { value: 2, label: "Discrete (2)" },
  { value: 3, label: "Holding (3)" },
  { value: 4, label: "Input (4)" },
];
const NUMERIC_TYPES = ["u16", "i16", "u32", "i32", "f32", "u64", "i64", "f64"];
const MULTI_WORD = new Set(["u32", "i32", "f32", "u64", "i64", "f64"]);
const BYTE_ORDERS = ["ABCD", "BADC", "CDAB", "DCBA"];
const GENERATOR_KINDS = ["sine", "ramp", "decrement", "step", "random", "toggle"];
const DEVICE_PRESETS = ["temperature", "humidity", "pressure", "flow", "vibration", "analog", "discrete", "counter"];

const VALUE_SOURCES = [
  { value: "hold", label: "Hold — fixed value", bitOk: true },
  { value: "device", label: "Device preset — realistic signal", bitOk: false },
  { value: "generator", label: "Generator — synthetic waveform", bitOk: false },
  { value: "route", label: "Route — mirror a real slave", bitOk: false },
];

// Curated, device-oriented glyphs for the icon picker. Each carries search
// keywords (also the tooltip/aria text). Stored as a plain string (same as the
// built-ins), so imported/custom icons stay compatible; SVG icons can be layered
// on later without changing the data shape.
type IconChoice = { glyph: string; label: string };
const ICON_CHOICES: IconChoice[] = [
  { glyph: "📟", label: "device controller pager terminal" },
  { glyph: "🎛️", label: "plc controller hmi knobs panel" },
  { glyph: "🖥️", label: "hmi scada display screen panel" },
  { glyph: "🗄️", label: "plc server cabinet rack enclosure" },
  { glyph: "🎚️", label: "relay switch contactor slider level" },
  { glyph: "🔀", label: "relay switch router crossover network" },
  { glyph: "🔌", label: "power plug socket outlet supply" },
  { glyph: "⚡", label: "power energy voltage electric meter" },
  { glyph: "🔋", label: "battery charge ups power backup" },
  { glyph: "☀️", label: "solar pv irradiance light energy" },
  { glyph: "🌡️", label: "temperature thermostat heat sensor rtd" },
  { glyph: "💧", label: "humidity water moisture flow level" },
  { glyph: "🌀", label: "motor pump fan vibration spin drive" },
  { glyph: "💨", label: "air flow wind fan blower pressure" },
  { glyph: "🔥", label: "heat heater burner furnace flame" },
  { glyph: "❄️", label: "cooling chiller cold refrigeration hvac" },
  { glyph: "🚰", label: "valve water tap flow actuator" },
  { glyph: "🛢️", label: "tank silo oil drum level storage" },
  { glyph: "⚙️", label: "gear motor machine engine drive" },
  { glyph: "🔧", label: "maintenance service tool wrench" },
  { glyph: "🧲", label: "proximity inductive sensor magnet" },
  { glyph: "🧭", label: "pressure gauge compass meter" },
  { glyph: "🧪", label: "analyzer lab chemical ph process" },
  { glyph: "📊", label: "meter data analytics chart" },
  { glyph: "📈", label: "trend rate graph analytics" },
  { glyph: "🧮", label: "counter tally totalizer count" },
  { glyph: "⏱️", label: "timer stopwatch cycle time" },
  { glyph: "⏲️", label: "timer clock schedule interval" },
  { glyph: "🚦", label: "andon stack light tower status signal" },
  { glyph: "🚥", label: "andon traffic signal status light" },
  { glyph: "🔦", label: "pick to light picking guide lamp put" },
  { glyph: "💡", label: "light lamp indicator pick to light" },
  { glyph: "🔆", label: "light brightness indicator beacon" },
  { glyph: "🔔", label: "alarm bell notify andon call" },
  { glyph: "🚨", label: "alarm alert warning beacon fault" },
  { glyph: "🔊", label: "buzzer sounder horn audio alarm" },
  { glyph: "🧯", label: "safety fire extinguisher protection" },
  { glyph: "📶", label: "wireless signal cellular rssi strength" },
  { glyph: "🛜", label: "wireless wifi access point gateway" },
  { glyph: "📡", label: "wireless gateway antenna rf telemetry satellite" },
  { glyph: "🌐", label: "gateway network internet web iot" },
  { glyph: "📱", label: "handheld mobile terminal device scanner" },
  { glyph: "🏷️", label: "barcode label tag scanner sku rfid" },
  { glyph: "📷", label: "camera vision inspection machine" },
  { glyph: "🖨️", label: "printer label print marking" },
  { glyph: "⚖️", label: "scale weigh load balance weight" },
  { glyph: "🤖", label: "robot cobot automation controller" },
  { glyph: "🦾", label: "robot arm actuator manipulator gripper" },
  { glyph: "🏭", label: "factory plant line industrial cell" },
  { glyph: "📦", label: "box package carton warehouse kitting" },
  { glyph: "🔒", label: "security lock access safety guard" },
  { glyph: "🔩", label: "bolt fastener hardware assembly" },
];

const blankReg = (): TemplateRegister => ({
  offset: 0, bank: 3, dataType: "u16", byteOrder: "ABCD", valueSource: "hold", sourceParams: "{}", alias: "",
});

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
const labelCls = "flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300";

// --- Params helpers -------------------------------------------------------

type Params = Record<string, unknown>;

function parseParams(raw: string): Params {
  try {
    const p = JSON.parse(raw);
    return p && typeof p === "object" && !Array.isArray(p) ? (p as Params) : {};
  } catch {
    return {};
  }
}
const numOr = (v: unknown, d: number) => (typeof v === "number" && !Number.isNaN(v) ? v : d);
const strOr = (v: unknown, d: string) => (typeof v === "string" ? v : d);

/** Fresh, minimal params for a newly-picked value source. */
function defaultParamsFor(source: string): string {
  switch (source) {
    case "generator":
      return JSON.stringify({ kind: "sine", min: 0, max: 100, periodMs: 1000 });
    case "device":
      return JSON.stringify({ preset: "temperature", min: 0, max: 100 });
    case "route":
      return JSON.stringify({ slaveUnitId: 1, connectionKind: "tcp", functionCode: 3, address: 1, scale: 1, offset: 0 });
    default:
      return "{}";
  }
}


const BANK_SHORT: Record<number, string> = { 1: "Coil", 2: "Discrete", 3: "Holding", 4: "Input" };

export default function TemplateEditorModal(props: {
  open: boolean;
  initial: DeviceTemplate | null;
  /** Keys already used by other templates (for a uniqueness hint). */
  takenKeys: string[];
  /** Categories already used by devices, offered alongside the standard ones. */
  categories?: string[];
  /**
   * Treat `initial` as a *pre-filled draft for a brand-new* device rather than
   * an existing one to edit: the key stays editable and clash-guarded. Used by
   * "Save as virtual device", which pre-fills from a live device but must not
   * silently overwrite an existing template that happens to share the key.
   */
  forceNew?: boolean;
  onClose: () => void;
  onSave: (t: DeviceTemplate) => void | Promise<void>;
}) {
  const [t, setT] = useState<DeviceTemplate>(() => props.initial ?? emptyTemplate());
  // Editing an existing custom template keeps its key locked (it's the identity).
  const [isEdit, setIsEdit] = useState(false);
  // Once the user types a key by hand it stops following the name.
  const [keyTouched, setKeyTouched] = useState(false);
  const [iconModalOpen, setIconModalOpen] = useState(false);
  // True while the user is typing a category that isn't in the list yet.
  const [typingCategory, setTypingCategory] = useState(false);
  const [sel, setSel] = useState(0);
  const [focusTick, setFocusTick] = useState(0);
  const aliasRef = useRef<HTMLInputElement>(null);
  const [addrFmt] = useAppAddressFormat();

  useEffect(() => {
    if (!props.open) return;
    setT(props.initial ?? emptyTemplate());
    setIsEdit(!!props.initial && !props.forceNew);
    setKeyTouched(false);
    setTypingCategory(false);
    setSel(0);
  }, [props.open, props.initial, props.forceNew]);

  useEffect(() => {
    if (focusTick > 0) aliasRef.current?.focus();
  }, [focusTick]);

  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      // Escape closes the topmost layer first: the icon picker, then the editor.
      if (iconModalOpen) setIconModalOpen(false);
      else props.onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props.open, props.onClose, iconModalOpen]);

  if (!props.open) return null;

  const set = (patch: Partial<DeviceTemplate>) => setT((prev) => ({ ...prev, ...patch }));
  const setName = (name: string) =>
    setT((prev) => ({
      ...prev,
      name,
      ...(!isEdit && !keyTouched ? { templateKey: slugKey(name, props.takenKeys) } : {}),
    }));
  const setReg = (i: number, patch: Partial<TemplateRegister>) =>
    setT((prev) => ({ ...prev, registers: prev.registers.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));

  const addReg = () => {
    const last = t.registers[t.registers.length - 1];
    const bank = last ? last.bank : 3;
    const reg: TemplateRegister = {
      ...blankReg(),
      bank,
      dataType: bank === 1 || bank === 2 ? "bool" : "u16",
      offset: nextFreeOffset(t.registers, bank),
    };
    setT((prev) => ({ ...prev, registers: [...prev.registers, reg] }));
    setSel(t.registers.length);
    setFocusTick((n) => n + 1);
  };
  const duplicateReg = (i: number) => {
    const src = t.registers[i];
    const copy: TemplateRegister = {
      ...src,
      offset: nextFreeOffset(t.registers, src.bank),
      alias: `${regLabel(src)} (copy)`,
    };
    setT((prev) => ({ ...prev, registers: [...prev.registers.slice(0, i + 1), copy, ...prev.registers.slice(i + 1)] }));
    setSel(i + 1);
  };
  const removeReg = (i: number) => {
    setT((prev) => ({ ...prev, registers: prev.registers.filter((_, idx) => idx !== i) }));
    setSel((s) => (s > i || s >= t.registers.length - 1 ? Math.max(0, s - 1) : s));
  };

  const categories = categoryOptions([...(props.categories ?? []), props.initial?.category ?? ""]);
  const pickCategory = (value: string) => {
    if (value === NEW_CATEGORY) {
      setTypingCategory(true);
      set({ category: "" });
    } else {
      setTypingCategory(false);
      set({ category: value });
    }
  };

  const keyTrim = t.templateKey.trim();
  const keyClashes = !isEdit && props.takenKeys.includes(keyTrim);
  const overlaps = findOverlaps(t.registers);
  const valid = keyTrim !== "" && t.name.trim() !== "" && !keyClashes && overlaps.size === 0;
  const blocker =
    t.name.trim() === "" ? "Enter a name to save."
      : keyTrim === "" ? "Enter a key (Advanced) to save."
        : keyClashes ? "Choose a different key (Advanced)."
          : overlaps.size > 0 ? `Fix overlapping registers to save (${overlaps.size}).`
            : null;
  const selIdx = Math.min(sel, t.registers.length - 1);
  const selected = selIdx >= 0 ? t.registers[selIdx] : null;

  const save = () =>
    void props.onSave({
      ...t,
      templateKey: keyTrim,
      // "sensors" joins "Sensors" rather than starting a new gallery group.
      category: normalizeCategory(t.category, categories),
      // Never persist an empty alias: fall back to the placeholder shown in the list.
      registers: t.registers.map((r) => ({ ...r, alias: regLabel(r) })),
    });

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="tpl-editor-title"
        className="@container flex h-[92vh] w-[96vw] max-w-[1800px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-6 py-3 dark:border-slate-800">
          <div className="min-w-0">
            <div id="tpl-editor-title" className="truncate text-sm font-semibold text-emerald-700 dark:text-emerald-200">
              {isEdit ? "Edit virtual device" : "New virtual device"}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Describe the device, then add the registers it exposes.
            </div>
          </div>
          <button type="button" onClick={props.onClose} title="Close" aria-label="Close"
            className="flex shrink-0 items-center rounded-full border border-slate-300 bg-slate-100 p-1.5 text-slate-600 transition hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:bg-white/5 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white">
            <RiCloseLine className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body: details on top, then list | editor panes. Stacks and scrolls on narrow widths. */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4 @4xl:overflow-hidden">
          {/* Identity */}
          <section className="grid shrink-0 grid-cols-1 gap-3 @3xl:grid-cols-[auto_minmax(0,1fr)] @3xl:items-start">
            <IconField value={t.icon} onOpen={() => setIconModalOpen(true)} />
            <div className="space-y-2">
              <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,2fr)]">
                <label className={labelCls}>Name
                  <input aria-label="Template name" placeholder="e.g. Power Meter" value={t.name}
                    onChange={(e) => setName(e.target.value)} className={inputCls} />
                </label>
                <div className={labelCls}>
                  <label htmlFor="tpl-category">Category</label>
                  <select id="tpl-category" aria-label="Category"
                    value={typingCategory ? NEW_CATEGORY : normalizeCategory(t.category, categories)}
                    onChange={(e) => pickCategory(e.target.value)} className={inputCls}>
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                    <option value={NEW_CATEGORY}>New category…</option>
                  </select>
                  {typingCategory ? (
                    <input aria-label="New category name" placeholder="e.g. HVAC" value={t.category} autoFocus
                      onChange={(e) => set({ category: e.target.value })} className={inputCls} />
                  ) : null}
                </div>
                <label className={labelCls}>Description
                  <input aria-label="Description" placeholder="What this device represents" value={t.description}
                    onChange={(e) => set({ description: e.target.value })} className={inputCls} />
                </label>
              </div>
              <details className="text-xs text-slate-600 dark:text-slate-300">
                <summary className="cursor-pointer select-none font-medium">Advanced</summary>
                <label className={`${labelCls} mt-2 max-w-sm`}>Key
                  <input aria-label="Template key" placeholder="custom_power_meter" value={t.templateKey} disabled={isEdit}
                    onChange={(e) => { setKeyTouched(true); set({ templateKey: e.target.value.replace(/\s+/g, "_").toLowerCase() }); }}
                    className={`${inputCls} font-mono ${isEdit ? "cursor-not-allowed opacity-60" : ""}`} />
                </label>
              </details>
              {keyClashes ? (
                <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
                  A device with key “{keyTrim}” already exists. Choose a different key.
                </div>
              ) : null}
            </div>
          </section>

          {/* Registers: list | editor */}
          <section className="grid min-h-0 flex-1 grid-cols-1 gap-4 @4xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            {/* List pane */}
            <div className="flex min-h-[16rem] min-w-0 flex-col rounded-xl border border-slate-200 dark:border-slate-700">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-700">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Registers · {t.registers.length}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Offsets are relative to the device’s base address.</div>
                </div>
                <button type="button" onClick={addReg}
                  className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-500/20 dark:border-emerald-500/60 dark:text-emerald-200">
                  <FiPlus className="h-3.5 w-3.5" aria-hidden="true" /> Add register
                </button>
              </div>
              {t.registers.length === 0 ? (
                <div className="m-3 rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  No registers yet. Add one to expose data on this device.
                </div>
              ) : (
                <ul aria-label="Registers" className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                  {t.registers.map((r, i) => {
                    const clash = overlaps.get(i);
                    const active = i === selIdx;
                    return (
                      <li key={i}
                        className={`flex items-center gap-1 px-2 py-1.5 ${clash !== undefined
                          ? "bg-rose-500/10 ring-1 ring-inset ring-rose-400/60"
                          : active ? "bg-emerald-500/10" : ""}`}>
                        <button type="button" aria-label={`Register ${i + 1}: ${regLabel(r)}, offset ${formatOffset(r.offset, addrFmt)}, ${(BANK_SHORT[r.bank] ?? String(r.bank)).toLowerCase()}`} aria-current={active ? "true" : undefined}
                          onClick={() => setSel(i)}
                          className="grid min-w-0 flex-1 grid-cols-[1.5rem_minmax(0,1.4fr)_4rem_5rem_3rem_minmax(0,1.6fr)] items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-sm transition hover:bg-slate-100 dark:hover:bg-white/5">
                          <span className="text-xs text-slate-400">{i + 1}</span>
                          <span className={`truncate font-medium ${r.alias.trim() === "" ? "italic text-slate-400" : ""}`}>{regLabel(r)}</span>
                          <span className="font-mono text-xs">{formatOffset(r.offset, addrFmt)}</span>
                          <span className="text-xs">{BANK_SHORT[r.bank] ?? r.bank}</span>
                          <span className="font-mono text-xs">{r.dataType}</span>
                          <span className="truncate text-xs text-slate-500 dark:text-slate-400">{sourceSummary(r)}</span>
                          {clash !== undefined ? (
                            <span className="col-span-5 col-start-2 text-xs font-medium text-rose-700 dark:text-rose-300">
                              Overlaps offset {formatOffset(clash, addrFmt)}
                            </span>
                          ) : null}
                        </button>
                        <button type="button" aria-label={`Duplicate register ${i + 1}: ${regLabel(r)}`} title="Duplicate register" onClick={() => duplicateReg(i)}
                          className="shrink-0 rounded-lg p-2 text-slate-500 transition hover:bg-slate-500/10 dark:text-slate-300">
                          <FiCopy className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button type="button" aria-label={`Remove register ${i + 1}: ${regLabel(r)}`} title="Remove register" onClick={() => removeReg(i)}
                          className="shrink-0 rounded-lg p-2 text-rose-600 transition hover:bg-rose-500/10 dark:text-rose-300">
                          <FiTrash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Editor pane */}
            <div className="@container min-h-0 min-w-0 overflow-y-auto rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              {selected ? (
                <RegisterEditor key={selIdx} index={selIdx} reg={selected} addrFmt={addrFmt} aliasRef={aliasRef}
                  onChange={(patch) => setReg(selIdx, patch)} />
              ) : (
                <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                  Select a register to edit it.
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 px-6 py-3 dark:border-slate-800">
          {blocker ? <span role="status" className="mr-auto text-xs text-slate-500 dark:text-slate-400">{blocker}</span> : null}
          <button type="button" onClick={props.onClose}
            className="rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-500">
            Cancel
          </button>
          <button type="button" disabled={!valid} onClick={save}
            className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-500/60 dark:text-emerald-200">
            Save device
          </button>
        </div>
      </div>
    </div>

    <IconPickerModal
      open={iconModalOpen}
      value={t.icon}
      onPick={(icon) => { set({ icon }); setIconModalOpen(false); }}
      onClose={() => setIconModalOpen(false)}
    />
    </>
  );
}


// --- Icon field (compact trigger) + picker modal --------------------------

function IconField(props: { value: string; onOpen: () => void }) {
  const { value, onOpen } = props;
  return (
    <button type="button" onClick={onOpen} aria-label="Choose device icon" title="Choose icon"
      className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-left transition hover:border-emerald-400 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:border-emerald-500/60">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-white text-2xl leading-none dark:border-slate-700 dark:bg-slate-900">
        {value || "❔"}
      </span>
      <span className="text-xs">
        <span className="block font-semibold text-slate-600 dark:text-slate-300">Icon</span>
        <span className="block text-slate-500 dark:text-slate-400">Choose icon</span>
      </span>
    </button>
  );
}

function IconPickerModal(props: { open: boolean; value: string; onPick: (icon: string) => void; onClose: () => void }) {
  const { open, value, onPick, onClose } = props;
  const [q, setQ] = useState("");

  useEffect(() => { if (open) setQ(""); }, [open]);

  if (!open) return null;

  const query = q.trim().toLowerCase();
  // Keep an imported/custom glyph outside the curated set selectable.
  const base: IconChoice[] =
    value && !ICON_CHOICES.some((c) => c.glyph === value)
      ? [{ glyph: value, label: "current custom" }, ...ICON_CHOICES]
      : ICON_CHOICES;
  const list = query ? base.filter((c) => c.label.includes(query) || c.glyph === q.trim()) : base;

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
      onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Choose device icon" onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-200">Choose an icon</div>
          <button type="button" onClick={onClose} title="Close" aria-label="Close"
            className="flex items-center rounded-full border border-slate-300 bg-slate-100 p-1.5 text-slate-600 transition hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:bg-white/5 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white">
            <RiCloseLine className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="shrink-0 px-5 pt-4">
          <input aria-label="Search icons" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search — relay, andon, wireless, pump…"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100" />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {list.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">No icons match “{q.trim()}”.</div>
          ) : (
            <div role="radiogroup" aria-label="Device icon" className="grid grid-cols-6 gap-2 sm:grid-cols-8">
              {list.map((c) => {
                const active = c.glyph === value;
                return (
                  <button key={c.glyph} type="button" role="radio" aria-checked={active} aria-label={`Icon ${c.glyph}`} title={c.label}
                    onClick={() => onPick(c.glyph)}
                    className={`flex aspect-square items-center justify-center rounded-lg border text-2xl leading-none transition ${active
                      ? "border-emerald-500 bg-emerald-500/15 ring-2 ring-emerald-500/30"
                      : "border-slate-200 bg-white hover:border-emerald-400 hover:bg-emerald-500/5 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-emerald-500/60"}`}>
                    {c.glyph}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// --- Register editor (right pane) -----------------------------------------

/** Offset field: shows the app address format, accepts decimal or 0x input. */
function OffsetInput(props: { index: number; value: number; addrFmt: "dec" | "hex"; onChange: (n: number) => void }) {
  const { index: i, value, addrFmt, onChange } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const bad = draft !== null && parseOffset(draft) === null;
  return (
    <input aria-label={`Offset ${i}`} value={draft ?? formatOffset(value, addrFmt)}
      aria-invalid={bad || undefined}
      onFocus={() => setDraft(formatOffset(value, addrFmt))}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = parseOffset(e.target.value);
        if (n !== null) onChange(n);
      }}
      onBlur={() => setDraft(null)}
      className={`${inputCls} font-mono ${bad ? "border-rose-400" : ""}`} />
  );
}

function RegisterEditor(props: {
  index: number;
  reg: TemplateRegister;
  addrFmt: "dec" | "hex";
  aliasRef: RefObject<HTMLInputElement | null>;
  onChange: (patch: Partial<TemplateRegister>) => void;
}) {
  const { index: i, reg: r, addrFmt, aliasRef, onChange } = props;
  const isBit = r.bank === 1 || r.bank === 2;
  const isMulti = MULTI_WORD.has(r.dataType);
  const typeOptions = r.valueSource === "hold" ? ["u16", "i16"] : NUMERIC_TYPES;

  const changeBank = (bank: number) => {
    const patch: Partial<TemplateRegister> = { bank };
    if (bank === 1 || bank === 2) {
      // Bit banks only carry a boolean, driven by a fixed value.
      patch.dataType = "bool";
      patch.byteOrder = "ABCD";
      if (r.valueSource !== "hold") { patch.valueSource = "hold"; patch.sourceParams = "{}"; }
    } else if (r.dataType === "bool") {
      patch.dataType = "u16";
    }
    onChange(patch);
  };

  const changeSource = (valueSource: string) => {
    const patch: Partial<TemplateRegister> = { valueSource, sourceParams: defaultParamsFor(valueSource) };
    if (valueSource === "hold" && !["u16", "i16", "bool"].includes(r.dataType)) {
      patch.dataType = isBit ? "bool" : "u16";
    }
    onChange(patch);
  };

  const changeType = (dataType: string) => {
    const patch: Partial<TemplateRegister> = { dataType };
    if (!MULTI_WORD.has(dataType)) patch.byteOrder = "ABCD";
    onChange(patch);
  };

  return (
    <div className="space-y-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Register {i + 1}
      </div>
      <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
        <label className={`${labelCls} @2xl:col-span-2`}>Alias
          <input ref={aliasRef} aria-label={`Alias ${i}`} placeholder={`Reg ${r.offset}`} value={r.alias}
            onChange={(e) => onChange({ alias: e.target.value })} className={inputCls} />
        </label>
        <label className={labelCls}>Offset
          <OffsetInput index={i} value={r.offset} addrFmt={addrFmt} onChange={(offset) => onChange({ offset })} />
        </label>
        <label className={labelCls}>Bank
          <select aria-label={`Bank ${i}`} value={r.bank} onChange={(e) => changeBank(Number(e.target.value))} className={inputCls}>
            {BANKS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
          </select>
        </label>
        <div className={labelCls}><span>Type</span>
          {isBit ? (
            <span className="px-0.5 py-1.5 text-sm font-normal text-slate-700 dark:text-slate-200">bit</span>
          ) : (
            <select aria-label={`Type ${i}`} value={r.dataType} onChange={(e) => changeType(e.target.value)} className={inputCls}>
              {typeOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
        </div>
        <div className={labelCls}><span>Byte order</span>
          {isMulti ? (
            <select aria-label={`Order ${i}`} value={r.byteOrder} onChange={(e) => onChange({ byteOrder: e.target.value })} className={inputCls}>
              {BYTE_ORDERS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          ) : (
            <span className="px-0.5 py-1.5 text-sm font-normal text-slate-500 dark:text-slate-400">—</span>
          )}
        </div>
        <label className={`${labelCls} @2xl:col-span-2`}>Value source
          <select aria-label={`Source ${i}`} value={r.valueSource} onChange={(e) => changeSource(e.target.value)} className={inputCls}>
            {VALUE_SOURCES.map((s) => (
              <option key={s.value} value={s.value} disabled={isBit && !s.bitOk}>{s.label}</option>
            ))}
          </select>
        </label>
      </div>

      <ParamsEditor index={i} reg={r} isMulti={isMulti} onChange={(sourceParams) => onChange({ sourceParams })} />
    </div>
  );
}

// --- Params editor (form ⟷ JSON) -----------------------------------------

function ParamsEditor(props: {
  index: number;
  reg: TemplateRegister;
  isMulti: boolean;
  onChange: (sourceParams: string) => void;
}) {
  const { index: i, reg: r, isMulti, onChange } = props;
  const [mode, setMode] = useState<"form" | "json">("form");
  const [draft, setDraft] = useState(r.sourceParams);
  const [err, setErr] = useState<string | null>(null);

  const params = parseParams(r.sourceParams);
  const patch = (p: Params) => onChange(JSON.stringify({ ...params, ...p }));

  const openJson = () => {
    let pretty = r.sourceParams;
    try { pretty = JSON.stringify(JSON.parse(r.sourceParams), null, 2); } catch { /* keep raw */ }
    setDraft(pretty);
    setErr(null);
    setMode("json");
  };
  const onDraft = (v: string) => {
    setDraft(v);
    try {
      const p = JSON.parse(v);
      if (p && typeof p === "object" && !Array.isArray(p)) { setErr(null); onChange(JSON.stringify(p)); }
      else setErr("Parameters must be a JSON object, e.g. { }");
    } catch {
      setErr("Not valid JSON yet");
    }
  };

  const hasParams = r.valueSource !== "hold";

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">Parameters</div>
        {hasParams ? (
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-xs dark:border-slate-600">
            <button type="button" aria-label={`Params form view ${i}`} onClick={() => setMode("form")}
              className={`inline-flex items-center gap-1 px-2 py-1 transition ${mode === "form" ? "bg-emerald-500/15 font-semibold text-emerald-800 dark:text-emerald-200" : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"}`}>
              <FiList className="h-3 w-3" aria-hidden="true" /> Form
            </button>
            <button type="button" aria-label={`Params JSON view ${i}`} onClick={openJson}
              className={`inline-flex items-center gap-1 border-l border-slate-300 px-2 py-1 transition dark:border-slate-600 ${mode === "json" ? "bg-emerald-500/15 font-semibold text-emerald-800 dark:text-emerald-200" : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"}`}>
              <FiCode className="h-3 w-3" aria-hidden="true" /> JSON
            </button>
          </div>
        ) : null}
      </div>

      {!hasParams ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Holds a fixed value — no parameters. The value can be changed live once the device is running.
        </p>
      ) : mode === "json" ? (
        <div className="space-y-1">
          <textarea aria-label={`Params JSON ${i}`} value={draft} onChange={(e) => onDraft(e.target.value)} rows={4} spellCheck={false}
            className={`w-full rounded-lg border bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 outline-none transition focus:ring-2 focus:ring-emerald-500/20 dark:bg-slate-900 dark:text-slate-100 ${err ? "border-rose-400 focus:border-rose-500" : "border-slate-300 focus:border-emerald-500 dark:border-slate-700"}`} />
          {err ? <div className="text-xs text-rose-600 dark:text-rose-400">{err}</div>
            : <div className="text-xs text-slate-400 dark:text-slate-500">Advanced: edit the raw parameter object.</div>}
        </div>
      ) : (
        <ParamsForm index={i} source={r.valueSource} params={params} isMulti={isMulti} byteOrder={r.byteOrder}
          patch={patch} setParams={(p) => onChange(JSON.stringify(p))} />
      )}
    </div>
  );
}

/** Period field with its own text draft so clearing it (to retype) doesn't snap back to 1000 mid-edit. */
function GeneratorPeriod(props: { index: number; periodMs: unknown; onChange: (ms: number) => void }) {
  const { index: i, periodMs, onChange } = props;
  const [text, setText] = useState(() => String(numOr(periodMs, GENERATOR_DEFAULT_PERIOD_MS)));
  return (
    <label className={labelCls}>Period (ms)
      <input aria-label={`Period ${i}`} type="number" min={0} value={text} placeholder={periodPlaceholder("generator")}
        onChange={(e) => {
          setText(e.target.value);
          // Empty saves as the default period; the field stays empty while typing.
          onChange(e.target.value === "" ? GENERATOR_DEFAULT_PERIOD_MS : Number(e.target.value));
        }} className={inputCls} />
    </label>
  );
}

function ParamsForm(props: {
  index: number;
  source: string;
  params: Params;
  isMulti: boolean;
  byteOrder: string;
  patch: (p: Params) => void;
  setParams: (p: Params) => void;
}) {
  const { index: i, source, params, isMulti, byteOrder, patch, setParams } = props;

  if (source === "generator") {
    return (
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <label className={labelCls}>Waveform
          <select aria-label={`Generator kind ${i}`} value={strOr(params.kind, "sine")} onChange={(e) => patch({ kind: e.target.value })} className={inputCls}>
            {GENERATOR_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label className={labelCls}>Min
          <input aria-label={`Min ${i}`} type="number" value={numOr(params.min, 0)} onChange={(e) => patch({ min: Number(e.target.value) })} className={inputCls} />
        </label>
        <label className={labelCls}>Max
          <input aria-label={`Max ${i}`} type="number" value={numOr(params.max, 100)} onChange={(e) => patch({ max: Number(e.target.value) })} className={inputCls} />
        </label>
        <GeneratorPeriod index={i} periodMs={params.periodMs} onChange={(periodMs) => patch({ periodMs })} />
      </div>
    );
  }

  if (source === "device") {
    return (
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <label className={labelCls}>Preset
          <select aria-label={`Device preset ${i}`} value={strOr(params.preset, "temperature")} onChange={(e) => patch({ preset: e.target.value })} className={inputCls}>
            {DEVICE_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className={labelCls}>Min
          <input aria-label={`Min ${i}`} type="number" value={numOr(params.min, 0)} onChange={(e) => patch({ min: Number(e.target.value) })} className={inputCls} />
        </label>
        <label className={labelCls}>Max
          <input aria-label={`Max ${i}`} type="number" value={numOr(params.max, 100)} onChange={(e) => patch({ max: Number(e.target.value) })} className={inputCls} />
        </label>
        <label className={labelCls}>Period (ms)
          <input aria-label={`Period ${i}`} type="number" min={0} value={initialPeriodText("device", params)} placeholder={periodPlaceholder("device")}
            onChange={(e) => {
              // A preset only carries a period when the user types one.
              if (e.target.value === "") { const { periodMs: _drop, ...rest } = params; setParams(rest); }
              else patch({ periodMs: Number(e.target.value) });
            }} className={inputCls} />
        </label>
      </div>
    );
  }

  if (source === "route") {
    return (
      <div className="space-y-2.5">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <label className={labelCls}>Slave unit
            <input aria-label={`Source unit ${i}`} type="number" min={0} max={255} value={numOr(params.slaveUnitId, 1)}
              onChange={(e) => patch({ slaveUnitId: Number(e.target.value) })} className={inputCls} />
          </label>
          <label className={labelCls}>Connection
            <select aria-label={`Source connection ${i}`} value={strOr(params.connectionKind, "tcp")} onChange={(e) => patch({ connectionKind: e.target.value })} className={inputCls}>
              <option value="tcp">TCP</option>
              <option value="serial">Serial</option>
            </select>
          </label>
          <label className={labelCls}>Function
            <select aria-label={`Source function ${i}`} value={numOr(params.functionCode, 3)} onChange={(e) => patch({ functionCode: Number(e.target.value) })} className={inputCls}>
              <option value={1}>Coils (0x01)</option>
              <option value={2}>Discrete (0x02)</option>
              <option value={3}>Holding (0x03)</option>
              <option value={4}>Input (0x04)</option>
            </select>
          </label>
          <label className={labelCls}>Address
            <input aria-label={`Source address ${i}`} type="number" min={0} max={65535} value={numOr(params.address, 1)}
              onChange={(e) => patch({ address: Number(e.target.value) })} className={inputCls} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <label className={labelCls}>Scale
            <input aria-label={`Scale ${i}`} type="number" step="any" value={numOr(params.scale, 1)}
              onChange={(e) => patch({ scale: Number(e.target.value) })} className={inputCls} />
          </label>
          <label className={labelCls}>Offset
            <input aria-label={`Route offset ${i}`} type="number" step="any" value={numOr(params.offset, 0)}
              onChange={(e) => patch({ offset: Number(e.target.value) })} className={inputCls} />
          </label>
          {isMulti ? (
            <label className={labelCls}>Source byte order
              <select aria-label={`Source byte order ${i}`} value={strOr(params.srcByteOrder, "")}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) patch({ srcByteOrder: v });
                  else { const { srcByteOrder: _drop, ...rest } = params; setParams(rest); }
                }} className={inputCls}>
                <option value="">Same as register ({byteOrder})</option>
                {BYTE_ORDERS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
          ) : null}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">Exposed value = source × scale + offset.</p>
      </div>
    );
  }

  return null;
}

function emptyTemplate(): DeviceTemplate {
  return { templateKey: "", name: "", category: "Custom", description: "", icon: "📟", registers: [blankReg()] };
}
