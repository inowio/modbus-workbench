import { useMemo, useState } from "react";
import { FiChevronDown, FiChevronRight } from "react-icons/fi";

import type { ScanFoundEvent, ScanHostEvent } from "../api/slaveScan";
import ScanResultsList from "./ScanResultsList";

export type ScanHostsListProps = {
  /** Latest event per host. */
  hosts: ScanHostEvent[];
  results: ScanFoundEvent[];
  scanning: boolean;
  /** The scan ended by cancel: hosts still "open" were never scanned. */
  cancelled: boolean;
};

const noop = () => {};
const never = () => false;

/** Orders "a.b.c.d:port" by address, then port. */
function hostOrder(a: string, b: string): number {
  const key = (h: string) => {
    const [ip, port] = h.split(":");
    const octets = ip.split(".").map(Number);
    return [...octets, Number(port)];
  };
  const ka = key(a);
  const kb = key(b);
  for (let i = 0; i < ka.length; i++) {
    const d = (ka[i] || 0) - (kb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

const BADGE_BASE = "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap";
const NEUTRAL = "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-white/5 dark:text-slate-300";
const GOOD = "border-emerald-600/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200";
const WARN = "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200";

function statusBadge(host: ScanHostEvent, scanning: boolean, cancelled: boolean): { text: string; cls: string } {
  switch (host.status) {
    case "devices":
      return { text: `${host.found} device(s)`, cls: GOOD };
    case "answersAll":
      return { text: "answers every unit ID", cls: WARN };
    case "gateway":
      return { text: "gateway", cls: NEUTRAL };
    case "noModbus":
      return { text: "port open, no Modbus reply", cls: NEUTRAL };
    case "lost":
      return { text: "connection lost during scan", cls: "border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-200" };
    default:
      if (scanning) return { text: "scanning…", cls: GOOD };
      return { text: cancelled ? "not scanned (cancelled)" : "port open", cls: NEUTRAL };
  }
}

function HostRow({
  host,
  results,
  scanning,
  cancelled,
}: {
  host: ScanHostEvent;
  results: ScanFoundEvent[];
  scanning: boolean;
  cancelled: boolean;
}) {
  const own = useMemo(() => results.filter((r) => r.target === host.host), [results, host.host]);
  const collapsible = own.length > 0;
  const replies = Math.max(host.found, own.length);
  // Until the user toggles it, an answers-every-unit-ID host stays collapsed (even if it became one mid-scan).
  const [override, setOverride] = useState<boolean | null>(null);
  const expanded = override ?? host.status !== "answersAll";
  const badge = statusBadge(host, scanning, cancelled);

  return (
    <section aria-label={`Host ${host.host}`} className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">{host.host}</span>
        <span className={`${BADGE_BASE} ${badge.cls}`}>{badge.text}</span>
        {host.status === "devices" && host.gateway ? <span className={`${BADGE_BASE} ${NEUTRAL}`}>gateway</span> : null}
        {host.connectMs !== null ? (
          <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{`${host.connectMs} ms`}</span>
        ) : null}
        {collapsible ? (
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1 rounded-md text-xs font-medium text-slate-600 transition hover:opacity-80 dark:text-slate-300"
            aria-expanded={expanded}
            onClick={() => setOverride(!expanded)}
          >
            {expanded ? (
              <FiChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <FiChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {expanded ? "hide replies" : `show ${replies} replies`}
          </button>
        ) : null}
      </div>
      {collapsible && expanded ? (
        <ScanResultsList results={own} scanning={scanning} isExisting={never} onAdd={noop} allowAdd={false} />
      ) : null}
    </section>
  );
}

/** Range scan results: one block per host that answered the connect, with its unit rows underneath. */
export default function ScanHostsList({ hosts, results, scanning, cancelled }: ScanHostsListProps) {
  const sorted = useMemo(() => [...hosts].sort((a, b) => hostOrder(a.host, b.host)), [hosts]);

  if (sorted.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
        {scanning ? "No hosts found yet." : "No hosts found."}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {sorted.map((h) => (
        <HostRow key={h.host} host={h} results={results} scanning={scanning} cancelled={cancelled} />
      ))}
    </div>
  );
}
