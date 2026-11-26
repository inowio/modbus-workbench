import { useMemo, useState, type ReactNode } from "react";
import { FiChevronDown, FiChevronRight, FiPlus } from "react-icons/fi";

import type { ScanFoundEvent } from "../api/slaveScan";
import { formatSettings, groupScanResults } from "../utils/slaveScan";

export type ScanResultsListProps = {
  results: ScanFoundEvent[];
  scanning: boolean;
  isExisting(ev: ScanFoundEvent): boolean;
  onAdd(ev: ScanFoundEvent): void;
};

function rowKey(ev: ScanFoundEvent): string {
  return `${ev.target}|${ev.unitId}|${ev.settings ? formatSettings(ev.settings) : ""}`;
}

function ResultRow({
  ev,
  action,
}: {
  ev: ScanFoundEvent;
  action?: ReactNode;
}) {
  return (
    <li
      aria-label={`Unit ${ev.unitId} on ${ev.target}`}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950/30"
    >
      <span className="w-12 font-mono font-semibold text-slate-900 dark:text-slate-100">{ev.unitId}</span>
      <span className="min-w-20 text-slate-700 dark:text-slate-200">{ev.target}</span>
      {ev.settings ? <span className="font-mono text-slate-600 dark:text-slate-300">{formatSettings(ev.settings)}</span> : null}
      <span className="text-slate-600 dark:text-slate-300">{ev.detail}</span>
      <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{`${ev.responseMs} ms`}</span>
      {action ? <span className="ml-auto">{action}</span> : null}
    </li>
  );
}

/** The three result groups of a slave scan: Found, garbled, and a collapsed gateway group. */
export default function ScanResultsList({ results, scanning, isExisting, onAdd }: ScanResultsListProps) {
  const groups = useMemo(() => groupScanResults(results), [results]);
  const [gatewayOpen, setGatewayOpen] = useState(false);

  const headingCls = "text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300";

  return (
    <div className="mt-4 flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className={headingCls}>{`Found (${groups.found.length})`}</h3>
        {groups.found.length === 0 ? (
          <div className="text-sm text-slate-500 dark:text-slate-400">
            {scanning ? "No devices found yet." : "No devices found."}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {groups.found.map((ev) => (
              <ResultRow
                key={rowKey(ev)}
                ev={ev}
                action={
                  isExisting(ev) ? (
                    <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-white/5 dark:text-slate-300">
                      already in workspace
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-800 transition hover:border-emerald-500 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400"
                      onClick={() => onAdd(ev)}
                    >
                      <FiPlus className="h-3.5 w-3.5" aria-hidden="true" />
                      Add
                    </button>
                  )
                }
              />
            ))}
          </ul>
        )}
      </section>

      {groups.garbled.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className={headingCls}>{`Answered but garbled — maybe wrong baud rate (${groups.garbled.length})`}</h3>
          <ul className="flex flex-col gap-2">
            {groups.garbled.map((ev) => (
              <ResultRow key={rowKey(ev)} ev={ev} />
            ))}
          </ul>
        </section>
      ) : null}

      {groups.gateway.length > 0 ? (
        <section className="flex flex-col gap-2">
          <button
            type="button"
            className={`inline-flex w-fit items-center gap-1 ${headingCls}`}
            aria-expanded={gatewayOpen}
            onClick={() => setGatewayOpen((v) => !v)}
          >
            {gatewayOpen ? (
              <FiChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <FiChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {`Gateway reported no device (${groups.gateway.length})`}
          </button>
          {gatewayOpen ? (
            <ul className="flex flex-col gap-2">
              {groups.gateway.map((ev) => (
                <ResultRow key={rowKey(ev)} ev={ev} />
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
