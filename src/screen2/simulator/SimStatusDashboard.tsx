import { useEffect, useState } from "react";
import { FiRefreshCw } from "react-icons/fi";

import { fmtDuration, useNow } from "./useNow";

type SimConfig = { enabled: boolean; host: string; port: number; tickMs: number };
type ListenInfo = { bound: string; port: number; addresses: string[] };
type SimStatus = { running: boolean; listen: ListenInfo | null; clientCount: number; startedAtMs?: number | null };

type Props = {
  config: SimConfig | null;
  status: SimStatus;
  listen: ListenInfo | null;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
  /** May resolve false when the backend rejects the value (the draft then reverts). */
  onSaveConfig: (patch: Partial<SimConfig>) => CommitResult;
  onChangeExpose: (host: string) => void;
  onChangePort: (port: number) => CommitResult;
  onRefresh: () => void;
  registerCount: number;
  unitCount: number;
  deviceCount: number;
};

type CommitResult = void | boolean | Promise<void | boolean>;

const CARD_CLASS = "rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-white/5";

/**
 * Integer input that edits a local draft and commits only on blur/Enter when
 * the draft is valid. Escape reverts. Invalid drafts show a red border + message.
 * A commit that resolves `false` (backend rejected it) reverts the draft to the
 * saved value. `value: null` (config not loaded yet) shows an empty, disabled,
 * unvalidated field.
 */
function DraftIntInput({
  value, min, max, label, message, className, disabled, onCommit,
}: {
  value: number | null;
  min: number;
  max: number;
  label: string;
  message: string;
  className: string;
  disabled?: boolean;
  onCommit: (n: number) => CommitResult;
}) {
  const saved = value === null ? "" : String(value);
  const [draft, setDraft] = useState(saved);
  useEffect(() => { setDraft(saved); }, [saved]);

  const loading = value === null;
  const trimmed = draft.trim();
  const n = Number(trimmed);
  const valid = /^\d+$/.test(trimmed) && n >= min && n <= max;
  const invalid = !loading && !valid;

  const commit = () => {
    if (loading || !valid || n === value) return;
    void Promise.resolve(onCommit(n)).then((ok) => {
      if (ok === false) setDraft(saved);
    });
  };

  return (
    <>
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        aria-invalid={invalid ? "true" : undefined}
        className={`${className} ${invalid ? "border-rose-500 dark:border-rose-500" : "border-slate-300 dark:border-slate-700"}`}
        value={draft}
        disabled={disabled || loading}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          else if (e.key === "Escape") { e.preventDefault(); setDraft(saved); }
        }}
      />
      {invalid ? <span role="alert" className="text-xs text-rose-600 dark:text-rose-300">{message}</span> : null}
    </>
  );
}

export default function SimStatusDashboard({
  config,
  status,
  listen,
  busy,
  onStart,
  onStop,
  onSaveConfig,
  onChangeExpose,
  onChangePort,
  onRefresh,
  registerCount,
  unitCount,
  deviceCount,
}: Props) {
  const [addressesExpanded, setAddressesExpanded] = useState(false);

  const host = config?.host ?? "0.0.0.0";
  const port = config ? config.port : null;
  const effectiveListen = status.listen ?? listen;
  const now = useNow(status.running);
  const uptime = status.running && status.startedAtMs ? fmtDuration(now - status.startedAtMs) : "—";
  const exposeLabel = host === "127.0.0.1" ? "Local only" : "LAN / Intranet";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Exposed surface */}
        <div className={CARD_CLASS}>
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Exposed</span>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {registerCount} register{registerCount === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {unitCount} unit{unitCount === 1 ? "" : "s"} · {deviceCount} device{deviceCount === 1 ? "" : "s"}
          </p>
        </div>

        {/* Accessible At */}
        <div className={CARD_CLASS}>
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Accessible At</span>
          {status.running && effectiveListen && effectiveListen.addresses.length > 0 ? (
            <div className="mt-1">
              <p className="font-mono text-sm text-slate-900 dark:text-slate-100">{effectiveListen.addresses[0]}</p>
              {effectiveListen.addresses.length > 1 ? (
                <button
                  type="button"
                  className="mt-1 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
                  onClick={() => setAddressesExpanded((v) => !v)}
                >
                  {addressesExpanded ? "Show less" : `and ${effectiveListen.addresses.length - 1} more`}
                </button>
              ) : null}
              {addressesExpanded ? (
                <ul className="mt-1 space-y-0.5">
                  {effectiveListen.addresses.slice(1).map((addr) => (
                    <li key={addr} className="font-mono text-sm text-slate-900 dark:text-slate-100">
                      {addr}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Not listening — Start to expose on {exposeLabel}{port !== null ? `:${port}` : ""}
            </p>
          )}
        </div>

        {/* Connected Clients */}
        <div className={CARD_CLASS}>
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Connected Clients</span>
          <p className="mt-1 text-sm text-slate-900 dark:text-slate-100">{status.clientCount}</p>
        </div>

        {/* Uptime */}
        <div className={CARD_CLASS}>
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Uptime</span>
          <p data-testid="uptime-value" className="mt-1 text-sm tabular-nums text-slate-900 dark:text-slate-100">{uptime}</p>
        </div>
      </div>

      {/* Server controls */}
      <div className={CARD_CLASS}>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${status.running ? "bg-emerald-500" : "bg-slate-400"}`} />
            <span className="text-sm font-semibold">{status.running ? "Listening" : "Stopped"}</span>
          </div>

          <label className="flex items-center gap-2 text-sm">
            Expose
            <select
              aria-label="Expose"
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
              value={host}
              disabled={status.running}
              onChange={(e) => onChangeExpose(e.target.value)}
            >
              <option value="0.0.0.0">LAN / Intranet (0.0.0.0)</option>
              <option value="127.0.0.1">Local only (127.0.0.1)</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm">
            Port
            <DraftIntInput
              label="Port"
              value={port}
              min={1}
              max={65535}
              message="Enter 1–65535."
              className="w-24 rounded-lg border bg-white px-2 py-1 dark:bg-slate-900"
              disabled={status.running}
              onCommit={onChangePort}
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            Tick
            <DraftIntInput
              label="Tick interval (ms)"
              value={config ? config.tickMs : null}
              min={10}
              max={60000}
              message="Enter 10–60000 ms."
              className="w-20 rounded-lg border bg-white px-2 py-1 dark:bg-slate-900"
              disabled={status.running}
              onCommit={(tickMs) => onSaveConfig({ tickMs })}
            />
            <span className="text-slate-500 dark:text-slate-400">ms</span>
          </label>

          {status.running ? (
            <button
              type="button"
              disabled={busy}
              onClick={onStop}
              className="rounded-full border border-rose-500/60 bg-rose-500/10 px-4 py-1.5 text-sm font-semibold text-rose-700 dark:text-rose-200"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={onStart}
              className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-1.5 text-sm font-semibold text-emerald-800 dark:text-emerald-200"
            >
              Start
            </button>
          )}

          <button
            type="button"
            aria-label="Refresh"
            title="Refresh"
            onClick={onRefresh}
            className="ml-auto rounded-full border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-white/5"
          >
            <FiRefreshCw className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
