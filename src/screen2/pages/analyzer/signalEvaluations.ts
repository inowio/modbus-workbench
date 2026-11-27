// Page-level glue: turns the signal list + live updates into SignalEvaluation per signal.
// Pure: no React/Tauri/DOM.

import type { AnalyzerSignal, AnalyzerTile, AnalyzerTileSignalInfo } from "../../api/analyzer";
import { parseAnalyzerRawSnapshotFromJson } from "../../utils/analyzerSignalDecoder";
import {
  evaluateCalculatedSignal,
  evaluateRegisterSignal,
  type SignalEvaluation,
  worstState,
} from "../../utils/analyzerSignalEval";
import { getChartKind } from "./chartKind";

export type LiveSignalUpdate = {
  state: string;
  error?: string | null;
  rawWords?: number[] | null;
  rawBools?: boolean[] | null;
  tsMs: number;
};

export function computeSignalEvaluations(args: {
  signals: AnalyzerSignal[];
  live: Record<string, LiveSignalUpdate>;
  /**
   * Age-derived state (OK/STALE/DISCONNECTED). Pass it ONLY while polling is running: it is merged
   * into each register evaluation's `state` (worst of decoded and age) so STALE reaches calculated
   * dependents. Omit it for at-rest/static evaluation: values then decode from the raw state alone,
   * exactly like 0.5.0, and no age staleness applies.
   */
  uiState?: (signal: AnalyzerSignal, live: LiveSignalUpdate | null) => string;
}): Record<string, SignalEvaluation> {
  const out: Record<string, SignalEvaluation> = {};
  const calculated: AnalyzerSignal[] = [];

  for (const signal of args.signals) {
    if (signal.kind === "calculated") {
      calculated.push(signal);
      continue;
    }
    const live = Object.prototype.hasOwnProperty.call(args.live, signal.id) ? args.live[signal.id] : null;
    const snapshot = parseAnalyzerRawSnapshotFromJson(signal.lastValueJson ?? null);
    const rawState = (live?.state ?? signal.state ?? "DISCONNECTED").toString().toUpperCase();
    const decoded = evaluateRegisterSignal({
      state: rawState,
      error: live?.error ?? null,
      errorJson: signal.errorJson ?? null,
      rawWords: live?.rawWords ?? snapshot?.rawWords ?? null,
      rawBools: live?.rawBools ?? snapshot?.rawBools ?? null,
      functionCode: signal.functionCode ?? 0,
      dataType: signal.dataType ?? "",
      order: signal.order ?? "",
      displayFormat: signal.displayFormat ?? "dec",
      decoderJson: signal.decoderJson,
    });
    out[signal.id] = args.uiState
      ? { ...decoded, state: worstState([decoded.state, args.uiState(signal, live)]) }
      : decoded;
  }

  // Calculated signals may (in principle) read other calculated ones: resolve in passes.
  let pending = calculated;
  while (pending.length > 0) {
    const calcIds = new Set(pending.map((s) => s.id));
    const ready = pending.filter((s) => !s.inputSignalIds.some((id) => calcIds.has(id) && id !== s.id));
    const batch = ready.length > 0 ? ready : pending; // cycle: evaluate with what exists
    for (const s of batch) out[s.id] = evaluateCalculatedSignal(s.decoderJson, out);
    const done = new Set(batch.map((s) => s.id));
    pending = pending.filter((s) => !done.has(s.id));
  }

  return out;
}

/** input signal id -> ids of the calculated signals that read it. */
export function dependentsBySignalId(signals: AnalyzerSignal[]): Record<string, string[]> {
  const out: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  for (const s of signals) {
    if (s.kind !== "calculated") continue;
    for (const input of s.inputSignalIds ?? []) {
      const list = out[input] ?? (out[input] = []);
      if (!list.includes(s.id)) list.push(s.id);
    }
  }
  return out;
}

/** Chart/trend tiles whose primary signal is `signalId`. */
export function chartTilesUsingSignal(
  signalId: string,
  tiles: AnalyzerTile[],
  tileSignals: Record<number, AnalyzerTileSignalInfo[]>,
): AnalyzerTile[] {
  return tiles.filter((t) => {
    const kind = (t.kind || "").toLowerCase();
    const isTrend = kind === "trend" || (kind === "chart" && getChartKind(t.configJson) === "trend");
    const isChart = kind === "chart" || isTrend;
    if (!isChart) return false;
    const links = tileSignals[t.id] ?? [];
    const primary = links.find((s) => s.role === "primary") ?? links[0] ?? null;
    return primary?.signalId === signalId;
  });
}
