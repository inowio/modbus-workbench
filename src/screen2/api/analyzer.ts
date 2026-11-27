import { invoke } from "@tauri-apps/api/core";

export type AnalyzerTile = {
  id: number;
  kind: string;
  title: string;
  configJson: string;
  pollingEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  tabId: number;
};

export type AnalyzerTab = {
  id: number;
  name: string;
  position: number;
};

export type AnalyzerTileLayout = {
  tileId: number;
  breakpoint: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type AnalyzerTileLayoutUpsert = {
  breakpoint: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type AnalyzerSignal = {
  id: string;
  kind: "register" | "calculated";
  slaveId: number | null;
  connectionKind: string;
  functionKind: string;
  registerRowId: number | null;
  address: number | null;
  functionCode: number | null;
  alias: string | null;
  dataType: string | null;
  order: string | null;
  displayFormat: string | null;
  inputSignalIds: string[];
  decoderJson: string;
  lastValueJson?: string | null;
  lastUpdatedTsMs?: number | null;
  state: string;
  errorJson?: string | null;
};

export type AnalyzerSignalUpsert = {
  id: string;
  kind?: "register" | "calculated";
  slaveId: number | null;
  functionKind: string;
  registerRowId: number | null;
  decoderJson?: string;
};

export type AnalyzerTileSignalInfo = {
  tileId: number;
  signalId: string;
  kind: "register" | "calculated";
  role: string;
  functionCode: number;
  address: number;
  alias: string;
  dataType: string;
  order: string;
  displayFormat: string;
  decoderJson: string;
  lastValueJson?: string | null;
  lastUpdatedTsMs?: number | null;
  state: string;
  errorJson?: string | null;
};

export async function startAnalyzerPolling(workspaceName: string): Promise<void> {
  await invoke<void>("start_analyzer_polling", { name: workspaceName });
}

export async function stopAnalyzerPolling(workspaceName: string): Promise<void> {
  await invoke<void>("stop_analyzer_polling", { name: workspaceName });
}

/** Whether Analyzer polling is running in the backend (it keeps running after the page is left). */
export async function isAnalyzerPollingRunning(workspaceName: string): Promise<boolean> {
  return await invoke<boolean>("analyzer_polling_running", { name: workspaceName });
}

export async function listAnalyzerTiles(workspaceName: string): Promise<AnalyzerTile[]> {
  return await invoke<AnalyzerTile[]>("list_analyzer_tiles", { name: workspaceName });
}

export async function listAnalyzerTileLayouts(
  workspaceName: string,
): Promise<AnalyzerTileLayout[]> {
  return await invoke<AnalyzerTileLayout[]>("list_analyzer_tile_layouts", { name: workspaceName });
}

export async function saveAnalyzerTileLayouts(
  workspaceName: string,
  tileId: number,
  layouts: AnalyzerTileLayoutUpsert[],
): Promise<void> {
  await invoke<void>("save_analyzer_tile_layouts", {
    name: workspaceName,
    tileId,
    layouts,
  });
}

export async function deleteAnalyzerSignal(workspaceName: string, signalId: string): Promise<void> {
  await invoke<void>("delete_analyzer_signal", {
    name: workspaceName,
    signalId,
  });
}

export async function setAnalyzerTilePollingEnabled(
  workspaceName: string,
  tileId: number,
  pollingEnabled: boolean,
): Promise<AnalyzerTile> {
  const nowIso = new Date().toISOString();
  return await invoke<AnalyzerTile>("set_analyzer_tile_polling_enabled", {
    name: workspaceName,
    tileId,
    pollingEnabled,
    nowIso,
  });
}

export async function listAnalyzerSignals(workspaceName: string): Promise<AnalyzerSignal[]> {
  return await invoke<AnalyzerSignal[]>("list_analyzer_signals", { name: workspaceName });
}

export async function upsertAnalyzerSignal(
  workspaceName: string,
  signal: AnalyzerSignalUpsert,
): Promise<AnalyzerSignal> {
  return await invoke<AnalyzerSignal>("upsert_analyzer_signal", {
    name: workspaceName,
    signal: {
      ...signal,
      decoderJson: signal.decoderJson ?? "{}",
    },
  });
}

export async function createAnalyzerTile(
  workspaceName: string,
  tile: {
    kind: string;
    title: string;
    configJson: string;
    pollingEnabled: boolean;
    tabId: number;
    layouts: Array<{ breakpoint: string; x: number; y: number; w: number; h: number }>;
    signalLinks: Array<{ signalId: string; role: string }>;
  },
): Promise<AnalyzerTile> {
  const nowIso = new Date().toISOString();
  return await invoke<AnalyzerTile>("create_analyzer_tile", {
    name: workspaceName,
    tile,
    nowIso,
  });
}

export async function updateAnalyzerTile(
  workspaceName: string,
  tileId: number,
  patch: {
    kind: string;
    title: string;
    configJson: string;
    pollingEnabled: boolean;
    signalLinks: Array<{ signalId: string; role: string }>;
  },
): Promise<AnalyzerTile> {
  const nowIso = new Date().toISOString();
  return await invoke<AnalyzerTile>("update_analyzer_tile", {
    name: workspaceName,
    tileId,
    patch,
    nowIso,
  });
}

export async function deleteAnalyzerTile(workspaceName: string, tileId: number): Promise<void> {
  await invoke<void>("delete_analyzer_tile", { name: workspaceName, tileId });
}

export async function listAnalyzerTileSignals(
  workspaceName: string,
  tileId: number,
): Promise<AnalyzerTileSignalInfo[]> {
  return await invoke<AnalyzerTileSignalInfo[]>("list_analyzer_tile_signals", {
    name: workspaceName,
    tileId,
  });
}

export async function listAnalyzerTabs(workspaceName: string): Promise<AnalyzerTab[]> {
  return await invoke<AnalyzerTab[]>("list_analyzer_tabs", { name: workspaceName });
}

export async function createAnalyzerTab(workspaceName: string, tabName: string): Promise<AnalyzerTab> {
  const nowIso = new Date().toISOString();
  return await invoke<AnalyzerTab>("create_analyzer_tab", { name: workspaceName, tabName, nowIso });
}

export async function renameAnalyzerTab(
  workspaceName: string,
  tabId: number,
  tabName: string,
): Promise<AnalyzerTab> {
  const nowIso = new Date().toISOString();
  return await invoke<AnalyzerTab>("rename_analyzer_tab", { name: workspaceName, tabId, tabName, nowIso });
}

export async function reorderAnalyzerTabs(workspaceName: string, tabIds: number[]): Promise<void> {
  await invoke<void>("reorder_analyzer_tabs", { name: workspaceName, tabIds });
}

/** Deleting a tab with tiles requires one choice: move them to another tab, or delete them. */
export async function deleteAnalyzerTab(
  workspaceName: string,
  tabId: number,
  opts: { moveTilesTo?: number; deleteTiles?: boolean },
): Promise<void> {
  await invoke<void>("delete_analyzer_tab", {
    name: workspaceName,
    tabId,
    moveTilesTo: opts.moveTilesTo ?? null,
    deleteTiles: opts.deleteTiles ?? false,
  });
}

export async function moveAnalyzerTileToTab(workspaceName: string, tileId: number, tabId: number): Promise<void> {
  await invoke<void>("move_analyzer_tile_to_tab", { name: workspaceName, tileId, tabId });
}

export async function duplicateAnalyzerTile(
  workspaceName: string,
  tileId: number,
  tabId: number,
): Promise<AnalyzerTile> {
  const nowIso = new Date().toISOString();
  return await invoke<AnalyzerTile>("duplicate_analyzer_tile", { name: workspaceName, tileId, tabId, nowIso });
}
