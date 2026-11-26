//! Slave (unit ID) scanner: Tauri commands, the per-workspace scan registry
//! and the event sink. The scan itself lives in [`engine`], the transports in
//! [`transport`].

pub mod engine;
pub mod transport;
pub mod types;

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::Serialize;
use tauri::Emitter;
use tokio::sync::watch;

use crate::analyzer_polling::AnalyzerPollingState;
use crate::modbus::{
    begin_scan, clamp_timeout_ms, release_rtu_for_scan, release_tcp_for_scan, ModbusState,
    SCAN_ALREADY_RUNNING,
};
use crate::settings::get_client_settings;
use crate::workspace::validate_workspace_name;
use engine::{
    cancel_pair, run_scan, ScanDone, ScanFound, ScanNotice, ScanProgress, ScanSink,
};
use transport::{SerialOpener, TcpConnector};
use types::{validate, ScanKind, ScanRequest};

const POLLING_ACTIVE: &str = "Stop Analyzer polling before scanning — it is using the connection.";
const PORT_RELEASE_WAIT: Duration = Duration::from_secs(3);
const DEFAULT_CONNECT_TIMEOUT_MS: i64 = 2000;

type ScanMap = HashMap<String /* ws */, (String /* scan_id */, watch::Sender<bool>)>;

/// Running scans by workspace. Each entry keeps the scan's cancel sender
/// alive until the scan task ends: dropping it never cancels.
#[derive(Default)]
pub struct SlaveScanState {
    scans: Arc<Mutex<ScanMap>>,
}

/// Recovers from poisoning: the map holds no invariant a panic could break,
/// and entries must still be removable afterwards.
fn lock_scans(scans: &Mutex<ScanMap>) -> MutexGuard<'_, ScanMap> {
    scans.lock().unwrap_or_else(|e| e.into_inner())
}

fn check_free(state: &SlaveScanState, ws: &str) -> Result<(), String> {
    if lock_scans(&state.scans).contains_key(ws) {
        return Err(SCAN_ALREADY_RUNNING.to_string());
    }
    Ok(())
}

fn reserve(
    state: &SlaveScanState,
    ws: &str,
    scan_id: &str,
    tx: watch::Sender<bool>,
) -> Result<(), String> {
    let mut scans = lock_scans(&state.scans);
    if scans.contains_key(ws) {
        return Err(SCAN_ALREADY_RUNNING.to_string());
    }
    scans.insert(ws.to_string(), (scan_id.to_string(), tx));
    Ok(())
}

/// Requests cancel of `scan_id` in `ws`. Ok when nothing matches.
fn cancel_scan(state: &SlaveScanState, ws: &str, scan_id: &str) -> Result<(), String> {
    if let Some((id, tx)) = lock_scans(&state.scans).get(ws) {
        if id == scan_id {
            // Fails only if the scan already ended; that is still cancelled.
            let _ = tx.send(true);
        }
    }
    Ok(())
}

/// Removes the scan's entry when the scan task ends, on every path. Leaves a
/// newer scan's entry for the same workspace alone.
struct ScanEntryGuard {
    scans: Arc<Mutex<ScanMap>>,
    ws: String,
    scan_id: String,
}

impl ScanEntryGuard {
    fn new(state: &SlaveScanState, ws: &str, scan_id: &str) -> Self {
        Self { scans: state.scans.clone(), ws: ws.to_string(), scan_id: scan_id.to_string() }
    }
}

impl Drop for ScanEntryGuard {
    fn drop(&mut self) {
        let mut scans = lock_scans(&self.scans);
        if scans.get(&self.ws).is_some_and(|(id, _)| *id == self.scan_id) {
            scans.remove(&self.ws);
        }
    }
}

// ---------- events ----------

/// Sends scan events to the UI. `emit` only queues the event, so it never
/// blocks the engine.
pub struct AppSink(pub tauri::AppHandle);

impl AppSink {
    fn emit<T: Serialize + Clone>(&self, event: &str, payload: T) {
        if let Err(e) = self.0.emit(event, payload) {
            log::warn!("slave scan: failed to emit {event}: {e}");
        }
    }
}

impl ScanSink for AppSink {
    fn found(&self, e: ScanFound) {
        self.emit("slave_scan_found", e);
    }
    fn progress(&self, e: ScanProgress) {
        self.emit("slave_scan_progress", e);
    }
    fn notice(&self, e: ScanNotice) {
        self.emit("slave_scan_notice", e);
    }
    fn done(&self, e: ScanDone) {
        self.emit("slave_scan_done", e);
    }
}

// ---------- commands ----------

/// Builds the TCP connector: the workspace connect timeout (read on the
/// blocking pool) and the target resolved under that same timeout.
async fn tcp_connector(
    app: &tauri::AppHandle,
    ws: &str,
    host: &str,
    port: u16,
) -> Result<TcpConnector, String> {
    let (app2, ws2) = (app.clone(), ws.to_string());
    let settings = tauri::async_runtime::spawn_blocking(move || get_client_settings(app2, ws2))
        .await
        .map_err(|e| format!("reading client settings failed: {e}"))??;
    let connect_timeout = Duration::from_millis(clamp_timeout_ms(
        settings.connect_timeout_ms,
        DEFAULT_CONNECT_TIMEOUT_MS,
    ));
    let host = host.trim();
    let addr: SocketAddr = tokio::time::timeout(connect_timeout, tokio::net::lookup_host((host, port)))
        .await
        .map_err(|_| format!("timed out resolving {host}"))?
        .map_err(|e| format!("could not resolve {host}: {e}"))?
        .next()
        .ok_or_else(|| format!("could not resolve {host}"))?;
    Ok(TcpConnector { addr, connect_timeout })
}

#[tauri::command]
pub async fn start_slave_scan(
    app: tauri::AppHandle,
    scan_state: tauri::State<'_, SlaveScanState>,
    modbus: tauri::State<'_, ModbusState>,
    polling: tauri::State<'_, AnalyzerPollingState>,
    name: String,
    request: ScanRequest,
) -> Result<String, String> {
    let ws = validate_workspace_name(&name)?;
    // 1. Validate (including the TCP target, before anything is touched).
    let scan = validate(&request)?;
    let connector = match (&scan.kind, &scan.tcp) {
        (ScanKind::Tcp, Some(t)) => Some(Arc::new(tcp_connector(&app, &ws, &t.host, t.port).await?)),
        _ => None,
    };
    // 2. One scan per workspace.
    check_free(&scan_state, &ws)?;
    // 3. Analyzer polling uses the same port or connection.
    if polling.is_running(&ws) {
        return Err(POLLING_ACTIVE.to_string());
    }
    // 4. From here on the shared sessions refuse to (re)open.
    let flag = begin_scan(&modbus, &ws)?;
    // 5. Close the shared session; `flag` drops (clearing it) on error.
    match scan.kind {
        ScanKind::Serial => release_rtu_for_scan(&modbus, &ws, PORT_RELEASE_WAIT).await?,
        ScanKind::Tcp => release_tcp_for_scan(&modbus, &ws, PORT_RELEASE_WAIT).await?,
    }
    // 6. Register the scan and run it; the task owns both guards.
    let scan_id = scan.scan_id.clone();
    let (tx, cancel) = cancel_pair();
    reserve(&scan_state, &ws, &scan_id, tx)?;
    let entry = ScanEntryGuard::new(&scan_state, &ws, &scan_id);
    let sink = Arc::new(AppSink(app.clone()));
    let task_ws = ws.clone();
    tauri::async_runtime::spawn(async move {
        let _flag = flag;
        let _entry = entry;
        let scan_id = scan.scan_id.clone();
        let run = tokio::spawn(run_scan(
            scan,
            task_ws.clone(),
            Arc::new(SerialOpener),
            connector,
            sink.clone(),
            cancel,
        ));
        // `run_scan` sends `done` itself; only a panic needs one sent here.
        if let Err(e) = run.await {
            log::error!("slave scan {scan_id} in {task_ws} failed: {e}");
            sink.done(ScanDone {
                workspace: task_ws,
                scan_id,
                reason: "failed".to_string(),
                error: Some(format!("scan task failed: {e}")),
                checked: 0,
                found: 0,
            });
        }
    });
    // 7.
    Ok(scan_id)
}

#[tauri::command]
pub fn cancel_slave_scan(
    scan_state: tauri::State<'_, SlaveScanState>,
    name: String,
    scan_id: String,
) -> Result<(), String> {
    let ws = validate_workspace_name(&name)?;
    cancel_scan(&scan_state, &ws, &scan_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::watch;

    const RUNNING: &str = "A scan is already running in this workspace";

    #[test]
    fn second_start_refused() {
        let state = SlaveScanState::default();
        let (tx1, _rx1) = watch::channel(false);
        let (tx2, _rx2) = watch::channel(false);
        reserve(&state, "ws", "s1", tx1).expect("first reservation");
        assert_eq!(check_free(&state, "ws").err().as_deref(), Some(RUNNING));
        assert_eq!(reserve(&state, "ws", "s2", tx2).err().as_deref(), Some(RUNNING));
        let (tx3, _rx3) = watch::channel(false);
        reserve(&state, "other", "s3", tx3).expect("other workspace is independent");
    }

    #[test]
    fn cancel_sends_true_only_for_the_matching_scan() {
        let state = SlaveScanState::default();
        let (tx, rx) = watch::channel(false);
        reserve(&state, "ws", "s1", tx).unwrap();

        cancel_scan(&state, "ws", "other-id").expect("mismatch is Ok");
        assert!(!*rx.borrow());
        cancel_scan(&state, "nope", "s1").expect("unknown workspace is Ok");
        assert!(!*rx.borrow());

        cancel_scan(&state, "ws", "s1").expect("cancel");
        assert!(*rx.borrow());
        cancel_scan(&state, "ws", "s1").expect("idempotent");
        assert!(*rx.borrow());
    }

    #[test]
    fn entry_guard_removes_only_its_own_scan() {
        let state = SlaveScanState::default();
        let (tx, rx) = watch::channel(false);
        reserve(&state, "ws", "s1", tx).unwrap();
        let guard = ScanEntryGuard::new(&state, "ws", "s1");
        assert!(check_free(&state, "ws").is_err());
        drop(guard);
        check_free(&state, "ws").expect("entry removed when the scan task ends");
        // The sender went with the entry; dropping it must not read as cancel.
        assert!(!*rx.borrow());

        // A stale guard leaves a newer scan's entry alone.
        let (tx2, _rx2) = watch::channel(false);
        reserve(&state, "ws", "s2", tx2).unwrap();
        drop(ScanEntryGuard::new(&state, "ws", "s1"));
        assert!(check_free(&state, "ws").is_err());
    }
}
