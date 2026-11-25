import { Suspense, lazy, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { FiCopy, FiCornerUpRight, FiMoreVertical, FiPlus, FiSettings, FiTrash2, FiX } from "react-icons/fi";
import { Responsive } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { AnalyzerTab, AnalyzerTile } from "../../api/analyzer";
import type { AnalyzerTrendPoint } from "../../components/AnalyzerTrendTile";
import type { BreakpointLayouts, GridLayout } from "./layoutTypes";
import { coerceBreakpointLayouts, coerceGridLayout } from "./layoutTypes";
import { getChartKind } from "./chartKind";
import PickTabDialog from "./PickTabDialog";
import { MdOutlineSync, MdOutlineSyncDisabled } from "react-icons/md";
import { RiInformation2Line, RiLayout4Line, RiStopMiniFill } from "react-icons/ri";

const LazyAnalyzerTrendTile = lazy(() => import("../../components/AnalyzerTrendTile"));
const ResponsiveAny = Responsive as any;

type Props = {
  /** The selected tab's tiles. */
  tiles: AnalyzerTile[];
  /** Any tab has tiles: an empty grid is then just an empty tab. */
  workspaceHasTiles: boolean;

  pollingWanted: boolean;

  gridReady: boolean;
  layoutEditMode: boolean;
  /** Focus view: no tile menus (only read-only tile information) and no layout editing. */
  focusMode: boolean;

  gridHostRef: RefObject<HTMLDivElement | null>;
  effectiveGridWidth: number;
  gridLayouts: BreakpointLayouts;
  onGridLayoutsChange: (next: BreakpointLayouts) => void;
  derivedBreakpoint: "desktop" | "mobile";
  schedulePersistLayouts: (breakpoint: "desktop" | "mobile", layout: GridLayout) => void;

  renderTileValue: (tile: AnalyzerTile, isRunning: boolean) => { label: string; state: string };
  renderTrendTile: (tile: AnalyzerTile, isRunning: boolean) => { points: AnalyzerTrendPoint[]; state: string };

  nowTsMs: number;
  trendWindowMs: number | null;

  getTilePollingIntervalMs: (tileId: number) => number | null;
  getTilePrimarySignalId: (tileId: number) => string | null;
  getTileInfo: (tileId: number) => {
    tileType: string;
    tileName: string;
    signalId: string;
    connection: string;
    slaveId: number | null;
    unitId: number | null;
    registerAddress: number | null;
    registerAddressFormatted: string;
    registerType: string;
    calculatedSource: string | null;
    pollIntervalMs: number | null;
  } | null;

  onConfigureSignals: () => void;
  onAddTile: () => void;

  onToggleTilePolling: (tile: AnalyzerTile) => void;
  onEditTile: (tile: AnalyzerTile) => void;
  onDeleteTile: (tile: AnalyzerTile) => void;

  tabs: AnalyzerTab[];
  onMoveTile: (tile: AnalyzerTile, tabId: number) => void;
  onDuplicateTile: (tile: AnalyzerTile, tabId: number) => void;
  /** Reports whether a tile's Info dialog is open (focus view pauses tab cycling meanwhile). */
  onInfoOpenChange?: (open: boolean) => void;
};

export default function AnalyzerTilesCard(props: Props) {
  const [tileMenuOpenId, setTileMenuOpenId] = useState<number | null>(null);
  const [infoTileId, setInfoTileId] = useState<number | null>(null);
  const [pickTab, setPickTab] = useState<{ mode: "move" | "duplicate"; tile: AnalyzerTile } | null>(null);

  const editingLayout = props.layoutEditMode && !props.focusMode;
  const hasTiles = props.tiles.length > 0;
  const skeletonCount = Math.min(hasTiles ? props.tiles.length : 6, 6);

  const effectiveLayouts = useMemo(() => {
    const makeStatic = !editingLayout;
    const mapLayout = (items: GridLayout): GridLayout =>
      items.map((it) => ({
        ...it,
        static: makeStatic,
      }));

    return {
      desktop: mapLayout(props.gridLayouts.desktop ?? []),
      mobile: mapLayout(props.gridLayouts.mobile ?? []),
    } satisfies BreakpointLayouts;
  }, [props.gridLayouts, editingLayout]);

  const runningByTileId = useMemo(() => {
    const out = new Map<number, boolean>();
    for (const t of props.tiles) {
      out.set(t.id, Boolean(props.pollingWanted && t.pollingEnabled));
    }
    return out;
  }, [props.pollingWanted, props.tiles]);

  const onInfoOpenChangeRef = useRef(props.onInfoOpenChange);
  onInfoOpenChangeRef.current = props.onInfoOpenChange;
  const infoOpen = infoTileId != null;
  useEffect(() => {
    onInfoOpenChangeRef.current?.(infoOpen);
    if (!infoOpen) return;
    return () => onInfoOpenChangeRef.current?.(false);
  }, [infoOpen]);

  // Focus view hides the tile menu; close it too, or its Escape handler would eat the first Escape.
  useEffect(() => {
    if (props.focusMode) setTileMenuOpenId(null);
  }, [props.focusMode]);

  useEffect(() => {
    if (tileMenuOpenId == null) return;

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) {
        setTileMenuOpenId(null);
        return;
      }

      if (
        target.closest("[data-tile-menu-root]") ||
        target.closest("[data-tile-menu-btn]")
      ) {
        return;
      }

      setTileMenuOpenId(null);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Handled: the page's focus-view Escape (on window) skips prevented events.
      e.preventDefault();
      setTileMenuOpenId(null);
    };

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [tileMenuOpenId]);

  useEffect(() => {
    if (infoTileId == null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setInfoTileId(null);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [infoTileId]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800/70 dark:bg-slate-900/60">
      {editingLayout ? (
        <div className="text-xs text-amber-800 dark:text-amber-200">Drag tiles to move. Resize from the bottom-right corner.</div>
      ) : null}

      {props.tiles.length === 0 ? (
        <div className="mt-3 flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center dark:border-slate-700 dark:bg-slate-950/30">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
            <RiLayout4Line className="h-6 w-6" aria-hidden="true" />
          </span>
          {props.workspaceHasTiles ? (
            <>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">This tab has no tiles</div>
              <div className="max-w-md text-xs text-slate-600 dark:text-slate-300">
                Add a tile to show a live value or trend on this tab.
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">No tiles yet</div>
              <div className="max-w-md text-xs text-slate-600 dark:text-slate-300">
                Tiles show live values and trends for the signals you configure on this workspace. Start by
                configuring your signals, then add a tile to visualize one.
              </div>
            </>
          )}
          {props.focusMode ? null : (
            <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
              {props.workspaceHasTiles ? null : (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
                  onClick={props.onConfigureSignals}
                >
                  <FiSettings className="h-4 w-4" aria-hidden="true" />
                  Configure Signals
                </button>
              )}
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
                onClick={props.onAddTile}
              >
                <FiPlus className="h-4 w-4" aria-hidden="true" />
                Add a tile
              </button>
            </div>
          )}
        </div>
      ) : (
        <div
          ref={props.gridHostRef}
          className={`mt-3 transition-all duration-200 ${props.gridReady ? "opacity-100" : "pointer-events-none opacity-0"}`}
        >
          {props.gridReady ? (
            <ResponsiveAny
              className="layout"
              width={props.effectiveGridWidth}
              layouts={effectiveLayouts as any}
              breakpoints={{ desktop: 768, mobile: 0 }}
              cols={{ desktop: 12, mobile: 4 }}
              rowHeight={22}
              margin={[12, 12]}
              containerPadding={[0, 0]}
              isDraggable={editingLayout}
              isResizable={editingLayout}
              draggableHandle=".tile-drag-handle"
              resizeHandles={editingLayout ? ["se"] : []}
              onLayoutChange={(current: unknown, all: unknown) => {
                if (!editingLayout) return;
                const nextAll = coerceBreakpointLayouts(all);
                props.onGridLayoutsChange(nextAll);
                props.schedulePersistLayouts(props.derivedBreakpoint, coerceGridLayout(current));
              }}
            >
              {props.tiles.map((t) => {
              const kind = (t.kind || "").toLowerCase();
              const chartKind = getChartKind(t.configJson);
              const isTrend = kind === "trend" || (kind === "chart" && chartKind === "trend");

              const isRunning = runningByTileId.get(t.id) ?? false;
              const value = isTrend ? null : props.renderTileValue(t, isRunning);
              const trend = isTrend ? props.renderTrendTile(t, isRunning) : null;

              const pollingIntervalMs = props.getTilePollingIntervalMs(t.id);
              const primarySignalId = props.getTilePrimarySignalId(t.id);
              const statusText =
                isRunning && pollingIntervalMs != null && pollingIntervalMs > 0
                  ? primarySignalId
                    ? `Polling (${primarySignalId} every ${Math.round(pollingIntervalMs)}ms)`
                    : `Polling (${Math.round(pollingIntervalMs)}ms)`
                  : isRunning
                    ? "Polling"
                    : "Stopped";
              const tilePollingEnabled = Boolean(t.pollingEnabled);

              return (
                <div
                  key={String(t.id)}
                  className={`relative flex h-full flex-col overflow-visible rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/30 ${tileMenuOpenId === t.id ? "z-10" : ""}`}
                >
                  <div
                    className={`tile-drag-handle flex items-start justify-between gap-3 ${editingLayout ? "cursor-move" : "cursor-default"}`}
                  >
                    <div className="min-w-0">
                      <div
                        className={`truncate text-sm font-semibold ${tilePollingEnabled ? "text-emerald-700 dark:text-emerald-400" : "text-slate-600 dark:text-slate-400"}`}
                      >
                        {t.title || `Tile ${t.id}`}
                      </div>
                      <div className={`mt-1 flex flex-row items-center gap-1 text-xs ${isRunning ? "text-emerald-700 dark:text-emerald-600" : "text-slate-500 dark:text-slate-400"}`}>
                        {
                          isRunning ? (
                            <MdOutlineSync className="h-4 w-4 animate-spin text-emerald-600 dark:text-emerald-500" aria-hidden="true" />
                          ) : tilePollingEnabled ? (
                            <RiStopMiniFill className="h-4 w-4 text-rose-700 dark:text-rose-400" aria-hidden="true" />
                          ) : (
                            <MdOutlineSyncDisabled className="h-4 w-4 text-slate-500 dark:text-slate-400" aria-hidden="true" />
                          )
                        }
                        {tilePollingEnabled ? statusText : "Disabled"}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {props.focusMode ? (
                        <button
                          type="button"
                          className="rounded-xl border border-slate-300 bg-slate-100 p-2 text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-200 dark:hover:border-slate-600"
                          onClick={() => setInfoTileId(t.id)}
                          aria-label="Tile information"
                          title="Tile information"
                        >
                          <RiInformation2Line className="h-4 w-4" aria-hidden="true" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          data-tile-menu-btn
                          className="rounded-xl border border-slate-300 bg-slate-100 p-2 text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-200 dark:hover:border-slate-600"
                          onClick={(e) => {
                            e.stopPropagation();
                            setTileMenuOpenId((prev) => (prev === t.id ? null : t.id));
                          }}
                          title="Tile menu"
                        >
                          <FiMoreVertical className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {tileMenuOpenId === t.id && !props.focusMode ? (
                    <div
                      data-tile-menu-root
                      className="absolute right-3 top-12 z-50 w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-950/95"
                    >
                      {tilePollingEnabled ? (
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-white/5"
                          onClick={() => {
                            setTileMenuOpenId(null);
                            props.onToggleTilePolling(t);
                          }}
                        >
                          <MdOutlineSyncDisabled className="h-4 w-4 rotate-90" aria-hidden="true" />
                          Disable Polling
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-white/5"
                          onClick={() => {
                            setTileMenuOpenId(null);
                            props.onToggleTilePolling(t);
                          }}
                        >
                          <MdOutlineSync className="h-4 w-4" aria-hidden="true" />
                          Enable Polling
                        </button>
                      )}

                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-white/5"
                        onClick={() => {
                          setTileMenuOpenId(null);
                          setInfoTileId(t.id);
                        }}
                      >
                        <RiInformation2Line className="h-4 w-4" />
                        Information
                      </button>

                      <div className="my-1 h-px bg-slate-200 dark:bg-slate-800" />

                      {props.tabs.length > 1 ? (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-white/5"
                        onClick={() => {
                          setTileMenuOpenId(null);
                          setPickTab({ mode: "move", tile: t });
                        }}
                      >
                        <FiCornerUpRight className="h-4 w-4" aria-hidden="true" />
                        Move to tab…
                      </button>
                      ) : null}

                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-white/5"
                        onClick={() => {
                          setTileMenuOpenId(null);
                          setPickTab({ mode: "duplicate", tile: t });
                        }}
                      >
                        <FiCopy className="h-4 w-4" aria-hidden="true" />
                        Duplicate…
                      </button>


                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-white/5"
                        onClick={() => {
                          setTileMenuOpenId(null);
                          props.onEditTile(t);
                        }}
                      >
                        <FiSettings className="h-4 w-4" />
                        Edit
                      </button>

                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-rose-800 hover:bg-rose-500/10 dark:text-rose-200"
                        onClick={() => {
                          setTileMenuOpenId(null);
                          props.onDeleteTile(t);
                        }}
                      >
                        <FiTrash2 className="h-4 w-4" />
                        Delete
                      </button>
                    </div>
                  ) : null}

                  {isTrend ? (
                    <div className="mt-4 min-h-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-950/30">
                      <Suspense fallback={<div className="text-xs text-slate-500 dark:text-slate-400">Loading chart…</div>}>
                        <div className="h-full">
                          <LazyAnalyzerTrendTile
                            title={t.title || `Tile ${t.id}`}
                            points={trend?.points ?? []}
                            nowTsMs={props.nowTsMs}
                            windowMs={props.trendWindowMs}
                          />
                        </div>
                      </Suspense>
                    </div>
                  ) : (
                    <div className="mt-4 min-h-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-950/30">
                      <div className="text-[11px] font-semibold uppercase dark:font-normal tracking-[0.22em] text-slate-500 dark:text-slate-400">Value</div>
                      <div className="mt-1 truncate font-mono text-lg text-slate-900 dark:text-slate-100">{value?.label ?? "NA"}</div>
                    </div>
                  )}

                  {editingLayout ? (
                    <div className="pointer-events-none absolute bottom-1 right-1 text-slate-400/80 dark:text-slate-500/80">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path d="M6 14L14 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                        <path d="M9 14L14 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                        <path d="M12 14L14 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                      </svg>
                    </div>
                  ) : null}
                </div>
              );
              })}
            </ResponsiveAny>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: skeletonCount || 3 }, (_, idx) => (
                <div
                  key={`tile-skeleton-${idx}`}
                  className="h-36 animate-pulse rounded-2xl border border-slate-200 bg-slate-100 dark:border-slate-800/70 dark:bg-slate-950/40"
                />
              ))}
            </div>
          )}
        </div>
      )}

      {pickTab ? (
        <PickTabDialog
          mode={pickTab.mode}
          tileTitle={pickTab.tile.title || `Tile ${pickTab.tile.id}`}
          tabs={props.tabs}
          currentTabId={pickTab.tile.tabId}
          onCancel={() => setPickTab(null)}
          onConfirm={(tabId) => {
            const { mode, tile } = pickTab;
            setPickTab(null);
            if (mode === "move") props.onMoveTile(tile, tabId);
            else props.onDuplicateTile(tile, tabId);
          }}
        />
      ) : null}

      {infoTileId != null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="analyzer-tileinfo-title"
            className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/40">
              <div className="min-w-0">
                <div id="analyzer-tileinfo-title" className="truncate text-sm font-semibold text-emerald-700 dark:text-emerald-400">Tile information</div>
              </div>

              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
                onClick={() => setInfoTileId(null)}
                title="Close"
              >
                <FiX className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="max-h-[70vh] overflow-auto p-4">
              {(() => {
                const info = props.getTileInfo(infoTileId);
                if (!info) {
                  return <div className="text-sm text-slate-600 dark:text-slate-300">No information available.</div>;
                }

                const slaveLabel =
                  info.unitId != null
                    ? `Unit ${info.unitId}${info.slaveId != null ? ` (Slave #${info.slaveId})` : ""}`
                    : info.slaveId != null
                      ? `Slave #${info.slaveId}`
                      : "—";

                return (
                  <div className="grid grid-cols-1 gap-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-3 dark:border-slate-800 dark:bg-slate-950/40">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Tile type:</div>
                          <div className="mt-1 ml-1 text-sm text-slate-900 dark:text-slate-100">{info.tileType}</div>
                        </div>

                        <div>
                          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Tile name:</div>
                          <div className="mt-1 ml-1 text-sm text-slate-900 dark:text-slate-100">{info.tileName}</div>
                        </div>

                        <div>
                          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Signal ID:</div>
                          <div className="mt-1 ml-1 text-sm font-mono text-slate-900 dark:text-slate-100">{info.signalId}</div>
                        </div>

                        <div>
                          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Connection:</div>
                          <div className="mt-1 ml-1 text-sm text-slate-900 dark:text-slate-100">{info.connection}</div>
                        </div>

                        <div>
                          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Slave/Unit:</div>
                          <div className="mt-1 text-sm text-slate-900 dark:text-slate-100">{slaveLabel}</div>
                        </div>

                        {info.calculatedSource != null ? (
                          <div className="sm:col-span-2">
                            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Source:</div>
                            <div className="mt-1 ml-1 text-sm text-slate-900 dark:text-slate-100">{info.calculatedSource}</div>
                          </div>
                        ) : (
                          <>
                            <div>
                              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Register Type:</div>
                              <div className="mt-1 ml-1 text-sm text-slate-900 dark:text-slate-100">{info.registerType}</div>
                            </div>

                            <div>
                              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Register Address:</div>
                              <div className="mt-1 ml-1 text-sm text-slate-900 dark:text-slate-100">
                                {info.registerAddress != null ? info.registerAddressFormatted : ""}
                              </div>
                            </div>
                          </>
                        )}

                        <div>
                          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Poll interval:</div>
                          <div className="mt-1 ml-1 text-sm text-slate-900 dark:text-slate-100">
                            {info.pollIntervalMs != null ? `${Math.round(info.pollIntervalMs)} ms` : "—"}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
