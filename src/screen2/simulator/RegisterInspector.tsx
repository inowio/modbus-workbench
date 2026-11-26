import { useEffect, useRef, useState } from "react";

import { fmtAddr, type AddrFmt } from "./ruleTargets";
import { rwLabel, type PageRegister } from "./simFilters";
import { addressConflict, parseAddressInput } from "./simRegister";
import { buildPeriodicParams, initialPeriodText, parseSourceParams, periodPlaceholder } from "./sourceParams";
import type { SimDevice } from "./useSimulatorData";

const DEVICE_PRESETS = ["temperature", "humidity", "pressure", "flow", "vibration", "analog", "discrete", "counter"];
const GENERATOR_KINDS = ["sine", "ramp", "decrement", "step", "random", "toggle"];
const MULTI_WORD_TYPES = ["u32", "i32", "f32", "u64", "i64", "f64"];
const BYTE_ORDERS = ["ABCD", "BADC", "CDAB", "DCBA"];
const DISPLAY_FORMATS = ["raw", "dec0", "dec1", "dec2", "hex"];

const FC_LABEL: Record<number, string> = { 1: "Coil", 2: "Discrete", 3: "Holding", 4: "Input" };

function accessLabel(functionCode: number): string {
  return rwLabel(functionCode) === "R/W" ? "Read-Write" : "Read only";
}

type SubTab = "general" | "source" | "advanced";

const INPUT_CLASS = "rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900";
const LABEL_CLASS = "flex flex-col gap-1 text-xs";

type SourceState = {
  kind: string; preset: string; min: number; max: number; periodText: string;
  sourceUnitId: number; sourceConnectionKind: string; sourceFunctionCode: number;
  sourceAddress: number; sourceScale: number; sourceOffset: number; sourceByteOrder: string;
};

function seedSource(register: PageRegister): SourceState {
  const params = parseSourceParams(register.sourceParams);
  return {
    kind: params.kind ?? GENERATOR_KINDS[0],
    preset: params.preset ?? DEVICE_PRESETS[0],
    min: params.min ?? 0,
    max: params.max ?? 100,
    periodText: initialPeriodText(register.valueSource, params),
    sourceUnitId: params.slaveUnitId ?? 1,
    sourceConnectionKind: params.connectionKind ?? "tcp",
    sourceFunctionCode: params.functionCode ?? 3,
    sourceAddress: params.address ?? 1,
    sourceScale: params.scale ?? 1,
    sourceOffset: params.offset ?? 0,
    // Empty string ⇒ "same as this register's byte order" (verbatim mirror).
    sourceByteOrder: params.srcByteOrder ?? "",
  };
}

/** True when two register records differ in any field other than sourceParams (null/""/undefined count as equal). */
function registerFieldsDiffer(a: PageRegister, b: PageRegister): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete("sourceParams");
  for (const k of keys) {
    const x = (a as Record<string, unknown>)[k] ?? "";
    const y = (b as Record<string, unknown>)[k] ?? "";
    if (x !== y) return true;
  }
  return false;
}

export type RegisterInspectorProps = {
  /** A saved register, or a blank draft (id 0) for the "New register" panel. */
  register: PageRegister | null;
  addrFmt?: AddrFmt;
  /** All registers, used to flag an address that is already taken when creating. */
  registers?: PageRegister[];
  /** Save error to show inside the panel for a new draft (it stays open on failure). */
  error?: string | null;
  onCreate?: (reg: PageRegister) => void | boolean | Promise<void | boolean>;
  onDirtyChange?: (dirty: boolean) => void;
  devices: SimDevice[];
  history: number[];
  liveValue: string;
  sourceStatus?: string | null;
  running: boolean;
  onSave: (reg: PageRegister) => void;
  onDuplicate: (reg: PageRegister) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
  onViewDevice: (deviceId: number) => void;
};

function Sparkline({ history }: { history: number[] }) {
  if (history.length < 2) return null;
  const w = 160;
  const h = 40;
  const minV = Math.min(...history);
  const maxV = Math.max(...history);
  const range = maxV - minV || 1;
  const points = history
    .map((v, i) => {
      const x = (i / (history.length - 1)) * w;
      const y = h - ((v - minV) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="text-emerald-500 dark:text-emerald-400">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function RegisterInspector(props: RegisterInspectorProps) {
  const { register, devices, history, liveValue, sourceStatus, running, onSave, onDuplicate, onDelete, onClose, onViewDevice, addrFmt = "dec", registers = [], error, onCreate, onDirtyChange } = props;

  const [tab, setTab] = useState<SubTab>("general");
  const [reg, setReg] = useState<PageRegister | null>(register);

  // Source-param editor state (per-source fields).
  const [kind, setKind] = useState(GENERATOR_KINDS[0]);
  const [preset, setPreset] = useState(DEVICE_PRESETS[0]);
  const [min, setMin] = useState(0);
  const [max, setMax] = useState(100);
  const [periodText, setPeriodText] = useState(""); // "" ⇒ default period
  const [sourceUnitId, setSourceUnitId] = useState(1);
  const [sourceConnectionKind, setSourceConnectionKind] = useState("tcp");
  const [sourceFunctionCode, setSourceFunctionCode] = useState(3);
  const [sourceAddress, setSourceAddress] = useState(1);
  const [sourceScale, setSourceScale] = useState(1);
  const [sourceOffset, setSourceOffset] = useState(0);
  const [sourceByteOrder, setSourceByteOrder] = useState("");
  const [addrText, setAddrText] = useState(() => (register ? fmtAddr(register.address, addrFmt) : ""));

  useEffect(() => {
    if (!register) {
      setReg(null);
      return;
    }
    setReg(register);
    setTab("general");
    const seed = seedSource(register);
    setKind(seed.kind);
    setPreset(seed.preset);
    setMin(seed.min);
    setMax(seed.max);
    setPeriodText(seed.periodText);
    setSourceUnitId(seed.sourceUnitId);
    setSourceConnectionKind(seed.sourceConnectionKind);
    setSourceFunctionCode(seed.sourceFunctionCode);
    setSourceAddress(seed.sourceAddress);
    setSourceScale(seed.sourceScale);
    setSourceOffset(seed.sourceOffset);
    setSourceByteOrder(seed.sourceByteOrder);
    setAddrText(fmtAddr(register.address, addrFmt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register?.id]);

  const srcNow: SourceState = {
    kind, preset, min, max, periodText, sourceUnitId, sourceConnectionKind,
    sourceFunctionCode, sourceAddress, sourceScale, sourceOffset, sourceByteOrder,
  };
  const dirty =
    !!register && !!reg && reg.id === register.id &&
    (registerFieldsDiffer(reg, register) || JSON.stringify(srcNow) !== JSON.stringify(seedSource(register)));

  // Tell the page whether there is anything to lose (and clear it on unmount).
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;
  useEffect(() => {
    onDirtyRef.current?.(dirty);
    return () => onDirtyRef.current?.(false);
  }, [dirty]);

  // Esc closes the panel, unless a modal dialog (e.g. a confirm) is open on top.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const open = !!register;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!register || !reg) return null;

  const isNew = reg.id === 0;
  const parsedAddr = isNew ? parseAddressInput(addrText) : reg.address;
  const addrError = isNew && parsedAddr === null ? "Enter an address from 0 to 65535 (decimal or 0x hex)." : null;
  const conflict =
    isNew && parsedAddr !== null
      ? addressConflict(registers, reg.unitId, reg.functionCode, parsedAddr, reg.dataType, addrFmt)
      : null;
  const blocked = addrError !== null || conflict !== null;

  const set = (patch: Partial<PageRegister>) => setReg((r) => (r ? { ...r, ...patch } : r));
  const device = devices.find((d) => d.id === reg.deviceInstanceId);

  // Mirror the backend's constraints so the inspector can't produce a
  // dataType/byteOrder/valueSource combo the backend rejects. Bit banks are
  // bool-only; hold registers only support u16/i16; single-word types must
  // carry ABCD byte order.
  const isBit = reg.functionCode === 1 || reg.functionCode === 2;
  const isMultiWord = MULTI_WORD_TYPES.includes(reg.dataType);
  const dataTypeOptions = isBit
    ? ["bool"]
    : reg.valueSource === "hold"
      ? ["u16", "i16"]
      : ["u16", "i16", "u32", "i32", "f32", "u64", "i64", "f64"];
  const setDataType = (dataType: string) => {
    const patch: Partial<PageRegister> = { dataType };
    if (!MULTI_WORD_TYPES.includes(dataType)) patch.byteOrder = "ABCD";
    set(patch);
  };
  const handleValueSourceChange = (valueSource: string) => {
    if (valueSource === "hold") {
      const dataType = isBit ? "bool" : reg.dataType === "u16" || reg.dataType === "i16" ? reg.dataType : "u16";
      const patch: Partial<PageRegister> = { valueSource, dataType };
      if (!MULTI_WORD_TYPES.includes(dataType)) patch.byteOrder = "ABCD";
      set(patch);
    } else {
      set({ valueSource });
    }
  };

  const handleFunctionCodeChange = (functionCode: number) => {
    const bit = functionCode === 1 || functionCode === 2;
    const patch: Partial<PageRegister> = { functionCode, dataType: bit ? "bool" : "u16", byteOrder: "ABCD" };
    if (bit && reg.valueSource !== "hold") patch.valueSource = "hold";
    set(patch);
  };

  const buildSourceParams = () =>
    JSON.stringify(
      reg.valueSource === "generator" || reg.valueSource === "device"
        ? buildPeriodicParams(reg.valueSource, { kind, preset, min, max, periodText })
        : reg.valueSource === "route"
        ? {
            slaveUnitId: sourceUnitId,
            connectionKind: sourceConnectionKind,
            functionCode: sourceFunctionCode,
            address: sourceAddress,
            scale: sourceScale,
            offset: sourceOffset,
            // Only persist a source order when it differs from ABCD/blank so the
            // backend keeps its verbatim fast path by default.
            ...(sourceByteOrder ? { srcByteOrder: sourceByteOrder } : {}),
          }
        : {}
    );

  const handleSave = () => {
    const sourceParams = buildSourceParams();
    onSave({ ...reg, sourceParams });
  };

  const handleCreate = () => {
    if (blocked || parsedAddr === null) return;
    void onCreate?.({ ...reg, address: parsedAddr, sourceParams: buildSourceParams() });
  };

  return (
    <div className="flex max-h-screen min-h-0 flex-1 flex-col rounded-2xl lg:max-h-[calc(100vh-11rem)] border border-slate-200 bg-white dark:border-slate-800 dark:bg-white/5">
      {/* Header */}
      <div className="border-b border-slate-100 p-4 dark:border-slate-800">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-bold text-slate-900 dark:text-slate-100">{isNew ? "New register" : reg.alias}</span>
              {dirty && !isNew ? (
                <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
                  Unsaved changes
                </span>
              ) : null}
            </div>
            {isNew ? null : (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Unit {reg.unitId} · {FC_LABEL[reg.functionCode] ?? reg.functionCode} · {fmtAddr(reg.address, addrFmt)}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/10"
          >
            ×
          </button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div role="tablist" aria-label="Register sections" className="flex items-center gap-1 border-b border-slate-100 px-4 dark:border-slate-800">
        {(["general", "source", "advanced"] as SubTab[]).map((t) => {
          const isActive = t === tab;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setTab(t)}
              className={`relative px-3 py-2 text-sm font-semibold capitalize transition ${
                isActive ? "text-emerald-800 dark:text-emerald-200" : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              {t}
              <span className={`absolute inset-x-0 -bottom-px h-0.5 rounded-full transition ${isActive ? "bg-emerald-500" : "bg-transparent"}`} />
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {tab === "general" && (
          <div className="grid grid-cols-2 gap-3">
            {isNew && (
              <>
                <label className={LABEL_CLASS}>
                  Unit ID
                  <input
                    aria-label="Unit ID"
                    type="number"
                    min={0}
                    max={255}
                    value={reg.unitId}
                    onChange={(e) => set({ unitId: Number(e.target.value) })}
                    className={INPUT_CLASS}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Register type
                  <select
                    aria-label="Register type"
                    value={reg.functionCode}
                    onChange={(e) => handleFunctionCodeChange(Number(e.target.value))}
                    className={INPUT_CLASS}
                  >
                    <option value={1}>Coil (0x01)</option>
                    <option value={2}>Discrete input (0x02)</option>
                    <option value={3}>Holding (0x03)</option>
                    <option value={4}>Input (0x04)</option>
                  </select>
                </label>
                <label className={`col-span-2 ${LABEL_CLASS}`}>
                  Address
                  <input
                    aria-label="Address"
                    type="text"
                    value={addrText}
                    aria-invalid={blocked ? "true" : undefined}
                    onChange={(e) => {
                      setAddrText(e.target.value);
                      const n = parseAddressInput(e.target.value);
                      if (n !== null) set({ address: n });
                    }}
                    className={`${INPUT_CLASS} ${blocked ? "border-rose-500 dark:border-rose-500" : ""}`}
                  />
                </label>
              </>
            )}
            <label className={`col-span-2 ${LABEL_CLASS}`}>
              Alias
              <input value={reg.alias} onChange={(e) => set({ alias: e.target.value })} className={INPUT_CLASS} />
            </label>
            <label className={LABEL_CLASS}>
              Data Type
              <select aria-label="Data Type" value={reg.dataType} onChange={(e) => setDataType(e.target.value)} className={INPUT_CLASS} disabled={isBit}>
                {dataTypeOptions.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </label>
            <label className={LABEL_CLASS}>
              Byte Order
              <select aria-label="Byte Order" value={reg.byteOrder} onChange={(e) => set({ byteOrder: e.target.value })} className={INPUT_CLASS} disabled={!isMultiWord}>
                {BYTE_ORDERS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </label>
            <label className={LABEL_CLASS}>
              Display Format
              <select
                aria-label="Display Format"
                value={reg.displayFormat ?? "raw"}
                onChange={(e) => set({ displayFormat: e.target.value })}
                className={INPUT_CLASS}
              >
                {DISPLAY_FORMATS.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </label>
            <label className={LABEL_CLASS}>
              Unit
              <input aria-label="Unit" value={reg.unit ?? ""} onChange={(e) => set({ unit: e.target.value })} className={INPUT_CLASS} />
            </label>
            <div className={LABEL_CLASS}>
              Access
              <span className="py-1 text-sm text-slate-700 dark:text-slate-200">{accessLabel(reg.functionCode)}</span>
            </div>
          </div>
        )}

        {tab === "source" && (
          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL_CLASS}>
              Value source
              <select aria-label="Value source" value={reg.valueSource} onChange={(e) => handleValueSourceChange(e.target.value)} className={INPUT_CLASS}>
                <option value="hold">Hold</option>
                <option value="device" disabled={isBit}>Device</option>
                <option value="generator" disabled={isBit}>Generator</option>
                <option value="route" disabled={isBit}>Route</option>
              </select>
            </label>

            {reg.valueSource === "hold" && (
              <label className={LABEL_CLASS}>
                Initial value
                <input type="number" value={reg.holdValue} onChange={(e) => set({ holdValue: Number(e.target.value) })} className={INPUT_CLASS} />
              </label>
            )}

            {reg.valueSource === "device" && (
              <label className={LABEL_CLASS}>
                Device preset
                <select aria-label="Device preset" value={preset} onChange={(e) => setPreset(e.target.value)} className={INPUT_CLASS}>
                  {DEVICE_PRESETS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </label>
            )}

            {reg.valueSource === "generator" && (
              <label className={LABEL_CLASS}>
                Generator kind
                <select aria-label="Generator kind" value={kind} onChange={(e) => setKind(e.target.value)} className={INPUT_CLASS}>
                  {GENERATOR_KINDS.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </label>
            )}

            {reg.valueSource === "route" && (
              <>
                <label className={LABEL_CLASS}>
                  Source slave unit
                  <input
                    aria-label="Source slave unit"
                    type="number"
                    min={0}
                    max={255}
                    value={sourceUnitId}
                    onChange={(e) => setSourceUnitId(Number(e.target.value))}
                    className={INPUT_CLASS}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Source connection
                  <select aria-label="Source connection" value={sourceConnectionKind} onChange={(e) => setSourceConnectionKind(e.target.value)} className={INPUT_CLASS}>
                    <option value="tcp">TCP</option>
                    <option value="serial">Serial</option>
                  </select>
                </label>
                <label className={LABEL_CLASS}>
                  Source function
                  <select
                    aria-label="Source function"
                    value={sourceFunctionCode}
                    onChange={(e) => setSourceFunctionCode(Number(e.target.value))}
                    className={INPUT_CLASS}
                  >
                    <option value={1}>Read Coils (0x01)</option>
                    <option value={2}>Read Discrete (0x02)</option>
                    <option value={3}>Read Holding (0x03)</option>
                    <option value={4}>Read Input (0x04)</option>
                  </select>
                </label>
                <label className={LABEL_CLASS}>
                  Source address
                  <input
                    aria-label="Source address"
                    type="number"
                    min={0}
                    max={65535}
                    value={sourceAddress}
                    onChange={(e) => setSourceAddress(Number(e.target.value))}
                    className={INPUT_CLASS}
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className={LABEL_CLASS}>
                    Scale
                    <input
                      aria-label="Scale"
                      type="number"
                      step="any"
                      value={sourceScale}
                      onChange={(e) => setSourceScale(Number(e.target.value))}
                      className={INPUT_CLASS}
                    />
                  </label>
                  <label className={LABEL_CLASS}>
                    Offset
                    <input
                      aria-label="Offset"
                      type="number"
                      step="any"
                      value={sourceOffset}
                      onChange={(e) => setSourceOffset(Number(e.target.value))}
                      className={INPUT_CLASS}
                    />
                  </label>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Exposed value = source × scale + offset (e.g. scale 0.1, offset −40 turns a raw 700 into 30).
                </p>
                {isMultiWord ? (
                  <label className={LABEL_CLASS}>
                    Source byte order
                    <select
                      aria-label="Source byte order"
                      value={sourceByteOrder}
                      onChange={(e) => setSourceByteOrder(e.target.value)}
                      className={INPUT_CLASS}
                    >
                      <option value="">Same as this register ({reg.byteOrder})</option>
                      {BYTE_ORDERS.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </>
            )}

            {(reg.valueSource === "device" || reg.valueSource === "generator") && (
              <>
                <label className={LABEL_CLASS}>
                  Min
                  <input aria-label="Min" type="number" value={min} onChange={(e) => setMin(Number(e.target.value))} className={INPUT_CLASS} />
                </label>
                <label className={LABEL_CLASS}>
                  Max
                  <input aria-label="Max" type="number" value={max} onChange={(e) => setMax(Number(e.target.value))} className={INPUT_CLASS} />
                </label>
                <label className={LABEL_CLASS}>
                  Period (ms)
                  <input aria-label="Period ms" type="number" value={periodText} placeholder={periodPlaceholder(reg.valueSource)} onChange={(e) => setPeriodText(e.target.value)} className={INPUT_CLASS} />
                </label>
              </>
            )}
          </div>
        )}

        {tab === "advanced" && (
          <div className="space-y-3">
            <label className={LABEL_CLASS}>
              Sort order
              <input
                aria-label="Sort order"
                type="number"
                value={reg.sortOrder}
                onChange={(e) => set({ sortOrder: Number(e.target.value) })}
                className={`${INPUT_CLASS} w-32`}
              />
            </label>
            <label className={LABEL_CLASS}>
              Raw source params
              <textarea
                aria-label="Raw source params"
                readOnly
                value={reg.sourceParams}
                className={`${INPUT_CLASS} h-24 font-mono text-xs`}
              />
            </label>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Edits apply immediately, even while running.
            </p>
          </div>
        )}

        {blocked || error ? (
          <div role="alert" className="space-y-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
            {addrError ? <p>{addrError}</p> : null}
            {conflict ? <p>{conflict}</p> : null}
            {error ? <p>{error}</p> : null}
          </div>
        ) : null}

        {/* Live Value card */}
        {isNew ? null : <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-white/5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Live Value</span>
            {sourceStatus ? (
              <span className="inline-block rounded-full bg-slate-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                {sourceStatus}
              </span>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-2xl font-bold text-slate-900 dark:text-slate-100">{running ? liveValue : "—"}</span>
            <Sparkline history={history} />
          </div>
        </div>}
      </div>

      {/* Footer */}
      {isNew ? null : (
        <div className="space-y-2 border-t border-slate-100 p-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <div className="flex items-center justify-between">
            <span>
              Device: <span className="font-semibold text-slate-700 dark:text-slate-200">{device ? device.name : "—"}</span>
            </span>
            {device ? (
              <button
                type="button"
                onClick={() => onViewDevice(device.id)}
                className="rounded-full border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                View Device
              </button>
            ) : null}
          </div>
        </div>
      )}

      <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 p-4 dark:border-slate-800">
        {isNew ? (
          <>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={blocked}
              onClick={handleCreate}
              className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-500/60 dark:text-emerald-200"
            >
              Create
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onDuplicate(reg)}
              className="rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100"
            >
              Duplicate
            </button>
            <button
              type="button"
              onClick={() => onDelete(reg.id)}
              className="rounded-full border border-rose-500/60 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-700 dark:text-rose-200"
            >
              Delete
            </button>
            <button
              type="button"
              disabled={!dirty}
              onClick={handleSave}
              className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-500/60 dark:text-emerald-200"
            >
              Save
            </button>
          </>
        )}
      </div>
    </div>
  );
}
