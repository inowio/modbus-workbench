import { getCurrentWindow } from "@tauri-apps/api/window";

/** OS full screen for the app window (needs core:window:allow-set-fullscreen). */
export async function setWindowFullscreen(on: boolean): Promise<void> {
  await getCurrentWindow().setFullscreen(on);
}

/** The window's real full-screen state (needs core:window:allow-is-fullscreen). */
export async function isWindowFullscreen(): Promise<boolean> {
  return getCurrentWindow().isFullscreen();
}

/** Calls `cb` whenever the window is resized (entering/leaving full screen resizes it). Resolves to an unlisten. */
export async function onWindowResized(cb: () => void): Promise<() => void> {
  return getCurrentWindow().onResized(() => cb());
}
