import { useId, useMemo, type Dispatch, type SetStateAction } from "react";

import type { ProbeKind, ScanKind, ScanRequest, SerialParams, SerialParity } from "../api/slaveScan";
import { SCAN_BAUDS, SCAN_PARITIES, defaultQuantity, defaultWaitMs, unitRange } from "../utils/slaveScan";
import type { ConnectionSettings, PortItem } from "./ConnectionSettingsForm";

export type FormState = {
  kind: ScanKind;
  ports: string[];
  baud: string;
  parity: SerialParity;
  dataBits: string;
  stopBits: string;
  flowControl: string;
  sweepOn: boolean;
  sweepBauds: number[];
  sweepParities: SerialParity[];
  host: string;
  tcpPort: string;
  concurrency: string;
  start: string;
  quantity: string;
  quantityEdited: boolean;
  probe: ProbeKind;
  waitMs: string;
  waitEdited: boolean;
  retries: string;
};

const BAUD_OPTIONS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];
const PARITY_LETTER: Record<SerialParity, string> = { none: "N", even: "E", odd: "O" };
const PARITY_NAME: Record<SerialParity, string> = { none: "None", even: "Even", odd: "Odd" };
const FLOW_OPTIONS = ["none", "hardware", "software"];
const PROBE_OPTIONS: { value: ProbeKind; label: string }[] = [
  { value: "holdingThenInput", label: "03, then 04" },
  { value: "holding", label: "03 only (holding)" },
  { value: "input", label: "04 only (input)" },
];

const inputCls =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60";
const labelCls = "text-xs font-semibold text-slate-700 dark:text-slate-200";
const checkCls = "h-4 w-4 accent-emerald-600";
const pillCls =
  "inline-flex cursor-pointer items-center rounded-full px-3 py-1 text-xs font-semibold transition has-[:checked]:bg-emerald-500/15 has-[:checked]:text-emerald-800 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-emerald-500/40 dark:has-[:checked]:text-emerald-200";

/** The sweep's baud choices: the standard list, plus the current baud in sorted position if it is not in it. */
export function sweepBauds(baud: string): readonly number[] {
  const b = Number(baud);
  if (!Number.isInteger(b) || b <= 0 || SCAN_BAUDS.includes(b)) return SCAN_BAUDS;
  return [...SCAN_BAUDS, b].sort((x, y) => x - y);
}

export function toParity(p: unknown): SerialParity {
  return p === "even" || p === "odd" ? p : "none";
}

export function workspaceSerial(ws: ConnectionSettings): SerialParams {
  return {
    baud: ws.serialBaud ?? 9600,
    parity: toParity(ws.serialParity),
    dataBits: ws.serialDataBits ?? 8,
    stopBits: ws.serialStopBits ?? 1,
    flowControl: ws.serialFlowControl ?? "none",
  };
}

export function initialForm(ws: ConnectionSettings): FormState {
  const kind: ScanKind = ws.kind === "tcp" ? "tcp" : "serial";
  const serial = workspaceSerial(ws);
  return {
    kind,
    ports: ws.serialPort ? [ws.serialPort] : [],
    baud: String(serial.baud),
    parity: serial.parity,
    dataBits: String(serial.dataBits),
    stopBits: String(serial.stopBits),
    flowControl: serial.flowControl,
    sweepOn: false,
    sweepBauds: [],
    sweepParities: [],
    host: ws.tcpHost ?? "127.0.0.1",
    tcpPort: String(ws.tcpPort ?? 502),
    concurrency: "4",
    start: "1",
    quantity: String(defaultQuantity(kind, 1)),
    quantityEdited: false,
    probe: "holdingThenInput",
    waitMs: String(defaultWaitMs(kind)),
    waitEdited: false,
    retries: "0",
  };
}

function intIn(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

/** First reason the form cannot be scanned, or null. The backend validates again. */
export function formProblem(f: FormState): string | null {
  const { min, max } = unitRange(f.kind);
  const start = intIn(f.start, min, max);
  const quantity = intIn(f.quantity, 1, 256);
  if (start === null || quantity === null || start + quantity - 1 > max) {
    return `Start and quantity must stay within ${min}–${max}`;
  }
  if (f.kind === "serial") {
    if (f.ports.length === 0) return "Select at least one serial port";
    if (f.sweepOn && (f.sweepBauds.length === 0 || f.sweepParities.length === 0)) {
      return "Pick at least one baud rate and one parity";
    }
  } else {
    if (!f.host.trim()) return "Enter a host";
    if (intIn(f.tcpPort, 1, 65535) === null) return "TCP port must be 1–65535";
    if (intIn(f.concurrency, 1, 32) === null) return "Parallel checks must be 1–32";
  }
  if (intIn(f.waitMs, 20, 5000) === null) return "Wait must be 20–5000 ms";
  if (intIn(f.retries, 0, 3) === null) return "Retries must be 0–3";
  return null;
}

export function buildRequest(f: FormState, scanId: string): ScanRequest {
  const common = {
    scanId,
    kind: f.kind,
    startUnitId: Number(f.start),
    quantity: Number(f.quantity),
    probe: f.probe,
    waitMs: Number(f.waitMs),
    retries: Number(f.retries),
  };
  if (f.kind === "tcp") {
    return {
      ...common,
      ports: [],
      serial: null,
      sweep: null,
      tcp: { host: f.host.trim(), port: Number(f.tcpPort) },
      concurrency: Number(f.concurrency),
    };
  }
  return {
    ...common,
    ports: f.ports,
    serial: {
      baud: Number(f.baud),
      parity: f.parity,
      dataBits: Number(f.dataBits),
      stopBits: Number(f.stopBits),
      flowControl: f.flowControl,
    },
    sweep: f.sweepOn
      ? {
          bauds: [...f.sweepBauds].sort((x, y) => x - y),
          parities: SCAN_PARITIES.filter((p) => f.sweepParities.includes(p)),
        }
      : null,
    tcp: null,
    concurrency: null,
  };
}

export type SlaveScanFormProps = {
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  portItems: PortItem[];
  /** Read-only while a scan runs. */
  disabled: boolean;
};

/** The scanner's connection and range fields. */
export default function SlaveScanForm({ form, setForm, portItems, disabled }: SlaveScanFormProps) {
  const id = useId();
  const fieldId = (name: string) => `${id}-${name}`;

  const portOptions = useMemo(() => {
    const items = [...portItems];
    for (const p of form.ports) {
      if (!items.some((i) => i.port === p)) items.push({ port: p, label: `${p} (not detected)` });
    }
    return items;
  }, [portItems, form.ports]);

  const baudOptions = useMemo(() => {
    const b = Number(form.baud);
    return BAUD_OPTIONS.includes(b) || !Number.isFinite(b) ? BAUD_OPTIONS : [...BAUD_OPTIONS, b].sort((x, y) => x - y);
  }, [form.baud]);

  const sweepBaudOptions = useMemo(() => sweepBauds(form.baud), [form.baud]);

  const flowOptions = FLOW_OPTIONS.includes(form.flowControl) ? FLOW_OPTIONS : [...FLOW_OPTIONS, form.flowControl];

  function patch(next: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...next }));
  }

  function setKind(kind: ScanKind) {
    setForm((prev) => {
      if (prev.kind === kind) return prev;
      const start = kind === "serial" && prev.start.trim() === "0" ? "1" : prev.start;
      const startNum = intIn(start, unitRange(kind).min, unitRange(kind).max);
      return {
        ...prev,
        kind,
        start,
        quantity: prev.quantityEdited || startNum === null ? prev.quantity : String(defaultQuantity(kind, startNum)),
        waitMs: prev.waitEdited ? prev.waitMs : String(defaultWaitMs(kind)),
      };
    });
  }

  function setStart(start: string) {
    setForm((prev) => {
      const startNum = intIn(start, unitRange(prev.kind).min, unitRange(prev.kind).max);
      return {
        ...prev,
        start,
        quantity: prev.quantityEdited || startNum === null ? prev.quantity : String(defaultQuantity(prev.kind, startNum)),
      };
    });
  }

  function toggleSweep(on: boolean) {
    setForm((prev) => ({
      ...prev,
      sweepOn: on,
      // Pre-tick the current baud and parity whenever the sweep is turned on.
      sweepBauds: on ? sweepBauds(prev.baud).filter((b) => b === Number(prev.baud)) : prev.sweepBauds,
      sweepParities: on ? [prev.parity] : prev.sweepParities,
    }));
  }

  function toggleIn<T>(list: T[], value: T, on: boolean): T[] {
    return on ? (list.includes(value) ? list : [...list, value]) : list.filter((v) => v !== value);
  }

  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-4 disabled:opacity-80">
      <div
        role="radiogroup"
        aria-label="Connection type"
        className="inline-flex w-fit gap-1 rounded-full border border-slate-300 bg-slate-100 p-1 text-slate-700 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300"
      >
        {(
          [
            { value: "serial", label: "Serial (RTU)" },
            { value: "tcp", label: "TCP" },
          ] as const
        ).map((opt) => (
          <label key={opt.value} className={pillCls}>
            <input
              type="radio"
              className="sr-only"
              name={fieldId("kind")}
              value={opt.value}
              checked={form.kind === opt.value}
              onChange={() => setKind(opt.value)}
            />
            {opt.label}
          </label>
        ))}
      </div>

      {form.kind === "serial" ? (
        <>
          <div className="flex flex-col gap-2">
            <span className={labelCls}>Serial port(s)</span>
            {portOptions.length === 0 ? (
              <span className="text-sm text-slate-500 dark:text-slate-400">No serial ports detected.</span>
            ) : (
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {portOptions.map((p) => (
                  <label key={p.port} className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className={checkCls}
                      checked={form.ports.includes(p.port)}
                      onChange={(e) => patch({ ports: toggleIn(form.ports, p.port, e.currentTarget.checked) })}
                    />
                    {p.label || p.port}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="flex flex-col gap-1">
              <label className={labelCls} htmlFor={fieldId("baud")}>
                Baud
              </label>
              <select
                id={fieldId("baud")}
                className={inputCls}
                value={form.baud}
                disabled={form.sweepOn}
                title={form.sweepOn ? "Replaced by the baud rates ticked below" : undefined}
                onChange={(e) => patch({ baud: e.currentTarget.value })}
              >
                {baudOptions.map((b) => (
                  <option key={b} value={String(b)}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls} htmlFor={fieldId("parity")}>
                Parity
              </label>
              <select
                id={fieldId("parity")}
                className={inputCls}
                value={form.parity}
                disabled={form.sweepOn}
                title={form.sweepOn ? "Replaced by the parities ticked below" : undefined}
                onChange={(e) => patch({ parity: toParity(e.currentTarget.value) })}
              >
                {SCAN_PARITIES.map((p) => (
                  <option key={p} value={p}>
                    {PARITY_NAME[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls} htmlFor={fieldId("databits")}>
                Data bits
              </label>
              <select
                id={fieldId("databits")}
                className={inputCls}
                value={form.dataBits}
                onChange={(e) => patch({ dataBits: e.currentTarget.value })}
              >
                {["5", "6", "7", "8"].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls} htmlFor={fieldId("stopbits")}>
                Stop bits
              </label>
              <select
                id={fieldId("stopbits")}
                className={inputCls}
                value={form.stopBits}
                onChange={(e) => patch({ stopBits: e.currentTarget.value })}
              >
                {["1", "2"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls} htmlFor={fieldId("flow")}>
                Flow control
              </label>
              <select
                id={fieldId("flow")}
                className={inputCls}
                value={form.flowControl}
                onChange={(e) => patch({ flowControl: e.currentTarget.value })}
              >
                {flowOptions.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className={checkCls}
                checked={form.sweepOn}
                onChange={(e) => toggleSweep(e.currentTarget.checked)}
              />
              Also try other baud rates &amp; parity
            </label>
            {form.sweepOn ? (
              <div className="ml-6 flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/30">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className={labelCls}>Baud rates</span>
                  {sweepBaudOptions.map((b) => (
                    <label key={b} className="inline-flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        className={checkCls}
                        checked={form.sweepBauds.includes(b)}
                        onChange={(e) => patch({ sweepBauds: toggleIn(form.sweepBauds, b, e.currentTarget.checked) })}
                      />
                      {b}
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className={labelCls}>Parity</span>
                  {SCAN_PARITIES.map((p) => (
                    <label key={p} className="inline-flex items-center gap-1.5 text-sm" title={PARITY_NAME[p]}>
                      <input
                        type="checkbox"
                        className={checkCls}
                        checked={form.sweepParities.includes(p)}
                        onChange={(e) =>
                          patch({ sweepParities: toggleIn(form.sweepParities, p, e.currentTarget.checked) })
                        }
                      />
                      {PARITY_LETTER[p]}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2 flex flex-col gap-1">
            <label className={labelCls} htmlFor={fieldId("host")}>
              Host
            </label>
            <input
              id={fieldId("host")}
              className={inputCls}
              value={form.host}
              onChange={(e) => patch({ host: e.currentTarget.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor={fieldId("tcpport")}>
              TCP port
            </label>
            <input
              id={fieldId("tcpport")}
              type="number"
              min={1}
              max={65535}
              className={inputCls}
              value={form.tcpPort}
              onChange={(e) => patch({ tcpPort: e.currentTarget.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor={fieldId("concurrency")}>
              Parallel checks
            </label>
            <input
              id={fieldId("concurrency")}
              type="number"
              min={1}
              max={32}
              className={inputCls}
              value={form.concurrency}
              onChange={(e) => patch({ concurrency: e.currentTarget.value })}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="flex flex-col gap-1">
          <label className={labelCls} htmlFor={fieldId("start")}>
            Start
          </label>
          <input
            id={fieldId("start")}
            type="number"
            min={unitRange(form.kind).min}
            max={unitRange(form.kind).max}
            className={inputCls}
            value={form.start}
            onChange={(e) => setStart(e.currentTarget.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls} htmlFor={fieldId("quantity")}>
            Quantity
          </label>
          <input
            id={fieldId("quantity")}
            type="number"
            min={1}
            className={inputCls}
            value={form.quantity}
            onChange={(e) => patch({ quantity: e.currentTarget.value, quantityEdited: true })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls} htmlFor={fieldId("probe")}>
            Check with
          </label>
          <select
            id={fieldId("probe")}
            className={inputCls}
            value={form.probe}
            onChange={(e) => patch({ probe: e.currentTarget.value as ProbeKind })}
          >
            {PROBE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls} htmlFor={fieldId("wait")}>
            Wait (ms)
          </label>
          <input
            id={fieldId("wait")}
            type="number"
            min={20}
            max={5000}
            className={inputCls}
            value={form.waitMs}
            onChange={(e) => patch({ waitMs: e.currentTarget.value, waitEdited: true })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls} htmlFor={fieldId("retries")}>
            Retries
          </label>
          <input
            id={fieldId("retries")}
            type="number"
            min={0}
            max={3}
            className={inputCls}
            value={form.retries}
            onChange={(e) => patch({ retries: e.currentTarget.value })}
          />
        </div>
      </div>
    </fieldset>
  );
}
