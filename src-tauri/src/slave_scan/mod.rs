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
    ScanFlagGuard, SessionKind, SCAN_ALREADY_RUNNING,
};
use crate::settings::get_client_settings;
use crate::workspace::validate_workspace_name;
use engine::{
    cancel_pair, run_scan, Cancel, Connector, Opener, ScanDone, ScanFound, ScanNotice,
    ScanProgress, ScanSink,
};
use transport::{SerialOpener, TcpConnector};
use types::{validate, ScanKind, ScanRequest, ValidScan};

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

/// Reads the workspace connect timeout on the blocking pool.
async fn connect_timeout_of(app: &tauri::AppHandle, ws: &str) -> Result<Duration, String> {
    let (app2, ws2) = (app.clone(), ws.to_string());
    let settings = tauri::async_runtime::spawn_blocking(move || get_client_settings(app2, ws2))
        .await
        .map_err(|e| format!("reading client settings failed: {e}"))??;
    Ok(Duration::from_millis(clamp_timeout_ms(
        settings.connect_timeout_ms,
        DEFAULT_CONNECT_TIMEOUT_MS,
    )))
}

/// Orders resolved addresses IPv4 first, keeping the resolver's order
/// otherwise. On Windows `localhost` resolves to `::1` first, while device
/// simulators often listen on 127.0.0.1 only.
fn ipv4_first(addrs: impl IntoIterator<Item = SocketAddr>) -> Vec<SocketAddr> {
    let (mut v4, v6): (Vec<_>, Vec<_>) = addrs.into_iter().partition(SocketAddr::is_ipv4);
    v4.extend(v6);
    v4
}

/// Resolves the TCP target under the connect timeout.
async fn tcp_connector(host: &str, port: u16, connect_timeout: Duration) -> Result<TcpConnector, String> {
    let host = host.trim();
    let addrs = tokio::time::timeout(connect_timeout, tokio::net::lookup_host((host, port)))
        .await
        .map_err(|_| format!("timed out resolving {host}"))?
        .map_err(|e| format!("could not resolve {host}: {e}"))?;
    let addrs = ipv4_first(addrs);
    if addrs.is_empty() {
        return Err(format!("could not resolve {host}"));
    }
    Ok(TcpConnector::new(addrs, connect_timeout))
}

/// Everything the scan task owns. Dropping it clears the scanning flag and
/// the scan's entry.
struct Prepared {
    flag: ScanFlagGuard,
    entry: ScanEntryGuard,
    cancel: Cancel,
    connector: Option<Arc<TcpConnector>>,
}

/// Steps 2–6 of `start_slave_scan`, free of `AppHandle`. The scan is
/// registered (so it can be cancelled) before the slow steps: resolving the
/// TCP host and waiting for the shared session to close. `Ok(None)` means it
/// was cancelled meanwhile; `done(cancelled)` has been sent and nothing was
/// opened.
#[allow(clippy::too_many_arguments)]
async fn prepare<S: ScanSink>(
    scan_state: &SlaveScanState,
    modbus: &ModbusState,
    polling: &AnalyzerPollingState,
    ws: &str,
    scan: &ValidScan,
    connect_timeout: Duration,
    release_wait: Duration,
    sink: &S,
) -> Result<Option<Prepared>, String> {
    // 2. One scan per workspace.
    check_free(scan_state, ws)?;
    // 3. Analyzer polling uses the same port or connection.
    if polling.is_running(ws) {
        return Err(POLLING_ACTIVE.to_string());
    }
    // 4. From here on the shared session of this kind refuses to (re)open.
    let session_kind = match scan.kind {
        ScanKind::Serial => SessionKind::Rtu,
        ScanKind::Tcp => SessionKind::Tcp,
    };
    let flag = begin_scan(modbus, ws, session_kind)?;
    // Register the scan now so a cancel during the waits below is kept.
    // On any error below, `flag` and `entry` drop and clear themselves.
    let (tx, cancel) = cancel_pair();
    reserve(scan_state, ws, &scan.scan_id, tx)?;
    let entry = ScanEntryGuard::new(scan_state, ws, &scan.scan_id);
    let connector = match (scan.kind, &scan.tcp) {
        (ScanKind::Tcp, Some(t)) => Some(Arc::new(tcp_connector(&t.host, t.port, connect_timeout).await?)),
        _ => None,
    };
    // 5. Close the shared session.
    match scan.kind {
        ScanKind::Serial => release_rtu_for_scan(modbus, ws, release_wait).await?,
        ScanKind::Tcp => release_tcp_for_scan(modbus, ws, release_wait).await?,
    }
    if cancel.is_cancelled() {
        // Free the workspace before telling the UI, so it can start again.
        drop(entry);
        drop(flag);
        sink.done(ScanDone {
            workspace: ws.to_string(),
            scan_id: scan.scan_id.clone(),
            reason: "cancelled".to_string(),
            error: None,
            checked: 0,
            found: 0,
        });
        return Ok(None);
    }
    // 6. Ready to run.
    Ok(Some(Prepared { flag, entry, cancel, connector }))
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
    // 1. Validate.
    let scan = validate(&request)?;
    let connect_timeout = match scan.kind {
        ScanKind::Tcp => connect_timeout_of(&app, &ws).await?,
        ScanKind::Serial => Duration::ZERO, // only TCP scans connect
    };
    let sink = Arc::new(AppSink(app.clone()));
    let scan_id = scan.scan_id.clone();
    let prepared = prepare(
        &scan_state,
        &modbus,
        &polling,
        &ws,
        &scan,
        connect_timeout,
        PORT_RELEASE_WAIT,
        &*sink,
    )
    .await?;
    let Some(Prepared { flag, entry, cancel, connector }) = prepared else {
        return Ok(scan_id);
    };
    // 6. Run it; the task owns both guards.
    tauri::async_runtime::spawn(run_and_report(
        (flag, entry),
        scan,
        ws,
        Arc::new(SerialOpener),
        connector,
        sink,
        cancel,
    ));
    // 7.
    Ok(scan_id)
}

/// The scan task: runs the scan, frees the workspace (scanning flag and
/// scan entry), then sends `done`, so the UI can start again or reconnect as
/// soon as it sees it.
async fn run_and_report<O: Opener, C: Connector, S: ScanSink>(
    guards: (ScanFlagGuard, ScanEntryGuard),
    scan: ValidScan,
    ws: String,
    opener: Arc<O>,
    connector: Option<Arc<C>>,
    sink: Arc<S>,
    cancel: Cancel,
) {
    let scan_id = scan.scan_id.clone();
    let run = tokio::spawn(run_scan(scan, ws.clone(), opener, connector, sink.clone(), cancel));
    let done = match run.await {
        Ok(done) => done,
        Err(e) => {
            log::error!("slave scan {scan_id} in {ws} failed: {e}");
            ScanDone {
                workspace: ws,
                scan_id,
                reason: "failed".to_string(),
                error: Some(format!("scan task failed: {e}")),
                checked: 0,
                found: 0,
            }
        }
    };
    drop(guards);
    sink.done(done);
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

    // ---------- prepare ----------

    use crate::modbus::scan_block_error;
    use engine::{ScanFound, ScanNotice, ScanProgress};
    use tokio::sync::Mutex as AsyncMutex;
    use tokio_modbus::client;
    use tokio_modbus::Slave;
    use types::{ProbeKind, SerialParams};

    #[derive(Default)]
    struct DoneSink(Mutex<Vec<ScanDone>>);

    impl ScanSink for DoneSink {
        fn found(&self, _e: ScanFound) {}
        fn progress(&self, _e: ScanProgress) {}
        fn notice(&self, _e: ScanNotice) {}
        fn done(&self, e: ScanDone) {
            self.0.lock().unwrap().push(e);
        }
    }

    fn serial_scan(id: &str) -> ValidScan {
        ValidScan {
            scan_id: id.into(),
            kind: ScanKind::Serial,
            units: vec![1, 2],
            probe: ProbeKind::Holding,
            wait: Duration::from_millis(50),
            retries: 0,
            ports: vec!["COM_TEST".into()],
            combos: vec![SerialParams {
                baud: 9600,
                parity: "none".into(),
                data_bits: 8,
                stop_bits: 1,
                flow_control: "none".into(),
            }],
            tcp: None,
            concurrency: 1,
        }
    }

    /// Puts a shared RTU session for `ws` in place and keeps it busy (locked)
    /// for `ms`, like an in-flight request.
    fn busy_rtu_session(modbus: &ModbusState, ws: &str, ms: u64) -> tokio::task::JoinHandle<()> {
        let (ours, _theirs) = tokio::io::duplex(64);
        let session = Arc::new(AsyncMutex::new(client::rtu::attach_slave(ours, Slave(1))));
        modbus.rtu_sessions.lock().unwrap().insert(ws.into(), session.clone());
        let in_flight = session.try_lock_owned().expect("fresh session is unlocked");
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(ms)).await;
            drop(in_flight);
        })
    }

    fn assert_released(scan_state: &SlaveScanState, modbus: &ModbusState) {
        assert_eq!(scan_block_error(modbus, "ws", SessionKind::Rtu), None, "flag cleared");
        check_free(scan_state, "ws").expect("entry cleared");
    }

    #[tokio::test]
    async fn cancel_during_port_release_ends_the_scan_unopened() {
        let (scan_state, modbus, polling) =
            (SlaveScanState::default(), ModbusState::default(), AnalyzerPollingState::default());
        let sink = DoneSink::default();
        let holder = busy_rtu_session(&modbus, "ws", 100);
        let scan = serial_scan("s1");

        let cancel_meanwhile = async {
            tokio::time::sleep(Duration::from_millis(30)).await;
            // The scan is registered and owns the port flag while it waits.
            assert!(check_free(&scan_state, "ws").is_err());
            assert!(scan_block_error(&modbus, "ws", SessionKind::Rtu).is_some());
            cancel_scan(&scan_state, "ws", "s1").expect("cancel");
        };
        let (prepared, ()) = tokio::join!(
            prepare(&scan_state, &modbus, &polling, "ws", &scan, Duration::ZERO, Duration::from_secs(1), &sink),
            cancel_meanwhile,
        );

        assert!(prepared.expect("not an error").is_none(), "nothing to run, nothing opened");
        let done = sink.0.lock().unwrap();
        assert_eq!(done.len(), 1);
        assert_eq!(done[0].reason, "cancelled");
        assert_eq!(done[0].scan_id, "s1");
        assert_released(&scan_state, &modbus);
        holder.await.unwrap();
    }

    #[tokio::test]
    async fn release_timeout_clears_flag_and_entry() {
        let (scan_state, modbus, polling) =
            (SlaveScanState::default(), ModbusState::default(), AnalyzerPollingState::default());
        let sink = DoneSink::default();
        let holder = busy_rtu_session(&modbus, "ws", 500);
        let scan = serial_scan("s1");

        let res = prepare(&scan_state, &modbus, &polling, "ws", &scan, Duration::ZERO, Duration::from_millis(20), &sink).await;

        assert_eq!(res.err().as_deref(), Some("Port busy, try again"));
        assert_released(&scan_state, &modbus);
        assert!(sink.0.lock().unwrap().is_empty(), "start failed, so no done event");
        holder.abort();
    }

    #[tokio::test]
    async fn polling_running_is_refused_and_nothing_reserved() {
        let (scan_state, modbus, polling) =
            (SlaveScanState::default(), ModbusState::default(), AnalyzerPollingState::default());
        let worker = tokio::spawn(std::future::pending::<()>());
        polling.insert_worker_for_test("ws", tauri::async_runtime::JoinHandle::Tokio(worker));
        let sink = DoneSink::default();

        let res = prepare(&scan_state, &modbus, &polling, "ws", &serial_scan("s1"), Duration::ZERO, Duration::from_millis(20), &sink).await;

        assert_eq!(
            res.err().as_deref(),
            Some("Stop Analyzer polling before scanning — it is using the connection.")
        );
        assert_released(&scan_state, &modbus);
        assert!(sink.0.lock().unwrap().is_empty());
    }

    // ---------- run_and_report ----------

    use engine::{OpenError, Prober};
    use types::ProbeOutcome;

    struct SilentProber;

    impl Prober for SilentProber {
        fn read(
            &mut self,
            _unit: u8,
            _function_code: u8,
            _wait: Duration,
        ) -> impl std::future::Future<Output = ProbeOutcome> + Send {
            std::future::ready(ProbeOutcome::NoReply)
        }
    }

    struct SilentOpener;

    impl Opener for SilentOpener {
        type P = SilentProber;
        fn open(
            &self,
            _port: &str,
            _params: &SerialParams,
        ) -> impl std::future::Future<Output = Result<SilentProber, OpenError>> + Send {
            std::future::ready(Ok(SilentProber))
        }
    }

    /// Notes, at the moment `done` arrives, whether the workspace is free.
    struct FreeAtDone {
        scanning: crate::modbus::ScanFlags,
        scans: Arc<Mutex<ScanMap>>,
        seen: Mutex<Vec<(String, bool, bool)>>,
    }

    impl ScanSink for FreeAtDone {
        fn found(&self, _e: ScanFound) {}
        fn progress(&self, _e: ScanProgress) {}
        fn notice(&self, _e: ScanNotice) {}
        fn done(&self, e: ScanDone) {
            let flag_clear = !self.scanning.lock().unwrap().contains_key("ws");
            let entry_clear = !lock_scans(&self.scans).contains_key("ws");
            self.seen.lock().unwrap().push((e.reason, flag_clear, entry_clear));
        }
    }

    /// F6: by the time the UI sees `done`, a new scan or a reconnect works.
    #[tokio::test]
    async fn done_is_sent_after_the_workspace_is_free() {
        let (scan_state, modbus, polling) =
            (SlaveScanState::default(), ModbusState::default(), AnalyzerPollingState::default());
        let sink = Arc::new(FreeAtDone {
            scanning: modbus.scanning.clone(),
            scans: scan_state.scans.clone(),
            seen: Mutex::new(Vec::new()),
        });
        let scan = serial_scan("s1");
        let Prepared { flag, entry, cancel, connector: _ } =
            prepare(&scan_state, &modbus, &polling, "ws", &scan, Duration::ZERO, Duration::from_millis(20), &*sink)
                .await
                .expect("prepared")
                .expect("not cancelled");
        run_and_report::<_, TcpConnector, _>(
            (flag, entry),
            scan,
            "ws".into(),
            Arc::new(SilentOpener),
            None,
            sink.clone(),
            cancel,
        )
        .await;
        assert_eq!(*sink.seen.lock().unwrap(), vec![("completed".to_string(), true, true)]);
        assert_released(&scan_state, &modbus);
    }

    // ---------- TCP host resolution ----------

    #[test]
    fn ipv4_addresses_come_first() {
        let v6: SocketAddr = "[::1]:502".parse().unwrap();
        let v4: SocketAddr = "127.0.0.1:502".parse().unwrap();
        let v6b: SocketAddr = "[fe80::1]:502".parse().unwrap();
        let v4b: SocketAddr = "10.0.0.1:502".parse().unwrap();
        assert_eq!(ipv4_first(vec![v6, v4, v6b, v4b]), vec![v4, v4b, v6, v6b]);
        assert_eq!(ipv4_first(vec![v6]), vec![v6]);
    }

    /// F10: on Windows `localhost` resolves to ::1 first; a device simulator
    /// listening on 127.0.0.1 must still be reached.
    #[tokio::test]
    async fn localhost_reaches_an_ipv4_only_listener() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        tokio::spawn(async move {
            let mut held = Vec::new();
            while let Ok((s, _)) = listener.accept().await {
                held.push(s);
            }
        });
        let connector = tcp_connector("localhost", port, Duration::from_millis(500))
            .await
            .expect("localhost resolves");
        connector.connect().await.expect("connects over 127.0.0.1");
    }

    #[tokio::test]
    async fn prepared_scan_holds_flag_and_entry_until_dropped() {
        let (scan_state, modbus, polling) =
            (SlaveScanState::default(), ModbusState::default(), AnalyzerPollingState::default());
        let sink = DoneSink::default();

        let prepared = prepare(&scan_state, &modbus, &polling, "ws", &serial_scan("s1"), Duration::ZERO, Duration::from_millis(20), &sink)
            .await
            .expect("prepared")
            .expect("not cancelled");

        assert!(scan_block_error(&modbus, "ws", SessionKind::Rtu).is_some());
        assert_eq!(scan_block_error(&modbus, "ws", SessionKind::Tcp), None, "serial scan only");
        assert!(check_free(&scan_state, "ws").is_err());
        assert!(!prepared.cancel.is_cancelled());
        drop(prepared);
        assert_released(&scan_state, &modbus);
        assert!(sink.0.lock().unwrap().is_empty());
    }
}
