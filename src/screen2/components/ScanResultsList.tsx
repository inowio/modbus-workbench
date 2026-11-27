import { useMemo, useState, type ReactNode } from "react";
import { FiChevronDown, FiChevronRight, FiPlus } from "react-icons/fi";

import type { ScanFoundEvent } from "../api/slaveScan";
import { formatSettings, groupScanResults } from "../utils/slaveScan";

export type ScanResultsListProps = {
  results: ScanFoundEvent[];
  scanning: boolean;
  isExisting(ev: ScanFoundEvent): boolean;
  onAdd(ev: ScanFoundEvent): void;
  /** False hides the Add button and "already in workspace" badge. */
  allowAdd?: boolean;
};

function rowKey(ev: ScanFoundEvent): string {
  return `${ev.target}|${ev.unitId}|${ev.settings ? formatSettings(ev.settings) : ""}`;
}

/** Unit | Port | Settings | Reply | Time | Action — one grid shared by the header and every row. */
const ROW_GRID =
  "@3xl:grid @3xl:grid-cols-[4rem_minmax(6rem,1fr)_7rem_minmax(8rem,2fr)_4.5rem_9.5rem] @3xl:items-center @3xl:gap-3";

type Tone = "found" | "garbled" | "gateway";

const UNIT_TONE: Record<Tone, string> = {
  found: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
  garbled: "bg-amber-500/15 text-amber-900 dark:text-amber-200",
  gateway: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
};

function HeaderRow() {
  return (
    <div
      aria-hidden="true"
      className={`hidden px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${ROW_GRID}`}
    >
      <span>Unit</span>
      <span>Port</span>
      <span>Settings</span>
      <span>Reply</span>
      <span className="text-right">Time</span>
      <span />
    </div>
  );
}

function ResultRow({ ev, tone, action }: { ev: ScanFoundEvent; tone: Tone; action?: ReactNode }) {
  return (
    <li
      aria-label={`Unit ${ev.unitId} on ${ev.target}`}
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950/30 dark:hover:border-slate-700 ${ROW_GRID}`}
    >
      <span>
        <span
          className={`inline-flex min-w-10 justify-center rounded-md px-2 py-0.5 font-mono text-sm font-semibold ${UNIT_TONE[tone]}`}
        >
          {ev.unitId}
        </span>
      </span>
      <span className="truncate font-mono text-slate-700 dark:text-slate-200" title={ev.target}>
        {ev.target}
      </span>
      <span className="font-mono text-slate-600 dark:text-slate-300">{ev.settings ? formatSettings(ev.settings) : "—"}</span>
      <span className="truncate text-slate-600 dark:text-slate-300" title={ev.detail}>
        {ev.detail}
      </span>
      <span className="font-mono text-xs text-slate-500 @3xl:text-right dark:text-slate-400">{`${ev.responseMs} ms`}</span>
      <span className="ml-auto @3xl:ml-0 @3xl:flex @3xl:justify-end">{action}</span>
    </li>
  );
}

function GroupHeading({ children, count, tone }: { children: ReactNode; count: number; tone: Tone }) {
  const dot: Record<Tone, string> = { found: "bg-emerald-500", garbled: "bg-amber-500", gateway: "bg-slate-400" };
  return (
    <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
      <span className={`h-2 w-2 rounded-full ${dot[tone]}`} aria-hidden="true" />
      {children} ({count})
    </span>
  );
}

/** "COM9 at 19200 8N1: 10 addresses; COM5 at 9600 8N1: 2 addresses" — garbled replies grouped by where they came from. */
export function garbledSummary(events: ScanFoundEvent[]): string {
  const counts = new Map<string, number>();
  for (const ev of events) {
    const key = ev.settings ? `${ev.target} at ${formatSettings(ev.settings)}` : ev.target;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([where, n]) => `${where}: ${n} ${n === 1 ? "address" : "addresses"}`)
    .join("; ");
}

/** The three result groups of a slave scan: Found, then collapsed garbled and gateway groups. */
export default function ScanResultsList({ results, scanning, isExisting, onAdd, allowAdd = true }: ScanResultsListProps) {
  const groups = useMemo(() => groupScanResults(results), [results]);
  const [gatewayOpen, setGatewayOpen] = useState(false);
  const [garbledOpen, setGarbledOpen] = useState(false);

  return (
    <div className="@container flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h3>
          <GroupHeading count={groups.found.length} tone="found">
            Found
          </GroupHeading>
        </h3>
        {groups.found.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {scanning ? "No devices found yet." : "No devices found."}
          </div>
        ) : (
          <>
            <HeaderRow />
            <ul className="flex flex-col gap-1.5">
              {groups.found.map((ev) => (
                <ResultRow
                  key={rowKey(ev)}
                  ev={ev}
                  tone="found"
                  action={
                    !allowAdd ? null : isExisting(ev) ? (
                      <span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-slate-600 dark:border-slate-700 dark:bg-white/5 dark:text-slate-300">
                        already in workspace
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-800 transition hover:border-emerald-500 hover:bg-emerald-500/20 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400"
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
          </>
        )}
      </section>

      {groups.garbled.length > 0 ? (
        <section className="flex flex-col gap-2">
          <button
            type="button"
            className="inline-flex w-fit items-center gap-1 rounded-md transition hover:opacity-80"
            aria-expanded={garbledOpen}
            onClick={() => setGarbledOpen((v) => !v)}
          >
            {garbledOpen ? (
              <FiChevronDown className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
            ) : (
              <FiChevronRight className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
            )}
            <GroupHeading count={groups.garbled.length} tone="garbled">
              Answered but garbled — maybe wrong baud rate
            </GroupHeading>
          </button>
          {garbledOpen ? (
            <>
              <HeaderRow />
              <ul className="flex flex-col gap-1.5">
                {groups.garbled.map((ev) => (
                  <ResultRow key={rowKey(ev)} ev={ev} tone="garbled" />
                ))}
              </ul>
            </>
          ) : (
            <p className="pl-5 text-xs text-slate-500 dark:text-slate-400">
              {garbledSummary(groups.garbled)} — unreadable data, not a working device. Usually a different baud
              rate, another device on the line, or noise.
            </p>
          )}
        </section>
      ) : null}

      {groups.gateway.length > 0 ? (
        <section className="flex flex-col gap-2">
          <button
            type="button"
            className="inline-flex w-fit items-center gap-1 rounded-md transition hover:opacity-80"
            aria-expanded={gatewayOpen}
            onClick={() => setGatewayOpen((v) => !v)}
          >
            {gatewayOpen ? (
              <FiChevronDown className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
            ) : (
              <FiChevronRight className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
            )}
            <GroupHeading count={groups.gateway.length} tone="gateway">
              Gateway reported no device
            </GroupHeading>
          </button>
          {gatewayOpen ? (
            <>
              <HeaderRow />
              <ul className="flex flex-col gap-1.5">
                {groups.gateway.map((ev) => (
                  <ResultRow key={rowKey(ev)} ev={ev} tone="gateway" />
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
