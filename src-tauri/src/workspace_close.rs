//! Releasing everything a workspace holds when the user exits it.
//!
//! Connections are shared per workspace, so leaving one must close them —
//! otherwise another workspace (or the slave scanner) gets "Access is denied"
//! on the same serial port. Closing only the session entry is not enough: the
//! Analyzer polling worker and the simulator's route reads would reopen it on
//! their next read, so they are stopped first, then the sessions are released
//! and we wait until the port or socket is really closed.

use std::time::Duration;

use tauri::Manager;

use crate::analyzer_polling::AnalyzerPollingState;
use crate::modbus::{release_rtu_for_scan, release_tcp_for_scan, ModbusState};

/// How long to wait for the polling worker to end and for in-flight requests
/// to let go of a connection.
const CLOSE_WAIT: Duration = Duration::from_secs(3);

/// Stops the workspace's Analyzer polling and closes its shared TCP and serial
/// sessions, waiting (up to `wait` per step) until they are actually closed.
/// Every step runs even if an earlier one fails; the first error is returned.
pub(crate) async fn release_workspace(
    polling: &AnalyzerPollingState,
    modbus: &ModbusState,
    ws: &str,
    wait: Duration,
) -> Result<(), String> {
    if let Some(worker) = polling.take_worker(ws) {
        worker.abort();
        // An aborted worker drops its clone of the session when it finishes.
        let _ = tokio::time::timeout(wait, worker).await;
    }
    let tcp = release_tcp_for_scan(modbus, ws, wait).await;
    let rtu = release_rtu_for_scan(modbus, ws, wait).await;
    tcp.and(rtu)
}

/// Called when the user exits a workspace: stops its Analyzer polling and TCP
/// simulator, then closes its connections so other workspaces can use them.
#[tauri::command]
pub async fn close_workspace_connections(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let ws = name.trim().to_string();
    if ws.is_empty() {
        return Ok(());
    }
    // The simulator's route reads share the workspace's sessions; stop it first.
    let sim = crate::simulator::simulator_stop(app.clone(), app.state(), ws.clone()).await;
    let released = release_workspace(
        &app.state::<AnalyzerPollingState>(),
        &app.state::<ModbusState>(),
        &ws,
        CLOSE_WAIT,
    )
    .await;
    sim.and(released)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tokio::sync::Mutex as AsyncMutex;
    use tokio_modbus::prelude::*;

    fn dummy_session() -> Arc<AsyncMutex<client::Context>> {
        let (ours, _theirs) = tokio::io::duplex(64);
        Arc::new(AsyncMutex::new(client::rtu::attach_slave(ours, Slave(1))))
    }

    #[tokio::test]
    async fn exiting_stops_polling_and_closes_the_port_it_was_holding() {
        let (polling, modbus) = (AnalyzerPollingState::default(), ModbusState::default());
        let session = dummy_session();
        let weak = Arc::downgrade(&session);
        modbus.rtu_sessions.lock().unwrap().insert("ws".into(), session.clone());
        modbus.rtu_sessions.lock().unwrap().insert("other".into(), dummy_session());
        modbus.tcp_sessions.lock().unwrap().insert("ws".into(), dummy_session());
        // A polling worker that keeps its own clone of the serial session forever,
        // like the Analyzer worker between reads.
        let worker = tokio::spawn(async move {
            let _held = session;
            std::future::pending::<()>().await;
        });
        polling.insert_worker_for_test("ws", tauri::async_runtime::JoinHandle::Tokio(worker));

        release_workspace(&polling, &modbus, "ws", Duration::from_secs(1))
            .await
            .expect("released");

        assert!(!polling.is_running("ws"), "polling stopped");
        assert!(weak.upgrade().is_none(), "the serial session is really closed");
        assert!(!modbus.rtu_sessions.lock().unwrap().contains_key("ws"));
        assert!(!modbus.tcp_sessions.lock().unwrap().contains_key("ws"));
        assert!(
            modbus.rtu_sessions.lock().unwrap().contains_key("other"),
            "other workspaces keep their connections"
        );
    }

    #[tokio::test]
    async fn exiting_a_workspace_with_nothing_open_is_fine() {
        let (polling, modbus) = (AnalyzerPollingState::default(), ModbusState::default());
        release_workspace(&polling, &modbus, "ws", Duration::from_millis(50))
            .await
            .expect("nothing to release");
    }
}
