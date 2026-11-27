import { useEffect } from "react";
import type { AnalyzerTab, AnalyzerTile } from "../../api/analyzer";

export type TabStatus = "error" | "stale" | null;
export type CycleSeconds = 0 | 10 | 30 | 60;

const CYCLE_VALUES: readonly CycleSeconds[] = [0, 10, 30, 60];

function lastTabKey(ws: string) {
  return `inowio.analyzer.lastTab.${ws}`;
}

function cycleKey(ws: string) {
  return `inowio.analyzer.cycle.${ws}`;
}

/** Tabs by position (then id), the order the strip shows them in. */
export function sortTabs(tabs: AnalyzerTab[]): AnalyzerTab[] {
  return [...tabs].sort((a, b) => a.position - b.position || a.id - b.id);
}

/** The wanted tab if it still exists, else the first tab by position (-1 only for an empty list). */
export function resolveSelectedTab(tabs: AnalyzerTab[], wanted: number | null): number {
  if (wanted != null && tabs.some((t) => t.id === wanted)) return wanted;
  return sortTabs(tabs)[0]?.id ?? -1;
}

/** The tab after (dir 1) or before (dir -1) the current one, wrapping around. */
export function nextTabId(tabs: AnalyzerTab[], currentId: number, dir: 1 | -1): number {
  const ordered = sortTabs(tabs);
  if (ordered.length === 0) return currentId;
  const idx = ordered.findIndex((t) => t.id === currentId);
  if (idx < 0) return ordered[0].id;
  return ordered[(idx + dir + ordered.length) % ordered.length].id;
}

export function readLastTabId(ws: string): number | null {
  try {
    const raw = window.localStorage.getItem(lastTabKey(ws));
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeLastTabId(ws: string, id: number) {
  try {
    window.localStorage.setItem(lastTabKey(ws), String(id));
  } catch {
    /* ignore */
  }
}

export function readCycleSeconds(ws: string): CycleSeconds {
  try {
    const n = Number(window.localStorage.getItem(cycleKey(ws)));
    return CYCLE_VALUES.find((v) => v === n) ?? 0;
  } catch {
    return 0;
  }
}

export function writeCycleSeconds(ws: string, s: CycleSeconds) {
  try {
    window.localStorage.setItem(cycleKey(ws), String(s));
  } catch {
    /* ignore */
  }
}

/**
 * A tab's status dot: only while running; "error" if any polling-enabled tile is in Error,
 * else "stale" if any is Stale. Disconnected and polling-disabled tiles never dot.
 */
export function tabStatus(
  tiles: AnalyzerTile[],
  tileState: (tile: AnalyzerTile) => string,
  running: boolean,
): TabStatus {
  if (!running) return null;
  let stale = false;
  for (const tile of tiles) {
    if (!tile.pollingEnabled) continue;
    const state = (tileState(tile) || "").toUpperCase();
    if (state === "ERROR") return "error";
    if (state === "STALE") stale = true;
  }
  return stale ? "stale" : null;
}

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

/**
 * Ctrl+1..Ctrl+9 select the tab at that position (displayed order). Ignored while typing in a field
 * or while a modal dialog is open. Listens on the window, so it works whatever UI is shown (e.g. focus view).
 */
export function useTabShortcuts(tabs: AnalyzerTab[], onSelect: (id: number) => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(e: KeyboardEvent) {
      if (!e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
      if (!/^[1-9]$/.test(e.key)) return;
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const tab = sortTabs(tabs)[Number(e.key) - 1];
      if (!tab) return;
      e.preventDefault();
      onSelect(tab.id);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tabs, onSelect, enabled]);
}
