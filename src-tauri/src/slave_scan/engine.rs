//! Scan engine: probes unit IDs over abstract transports, cancellable,
//! sequential per serial port, parallel across ports and TCP workers.
//!
//! Transports come in through [`Opener`] (serial), [`Connector`] (TCP) and
//! [`Prober`]; events go out through [`ScanSink`]. Nothing here touches Tauri
//! or real I/O, so the whole engine is tested with fakes.

use std::collections::VecDeque;
use std::future::Future;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::Serialize;
use tokio::sync::{watch, Notify};
use tokio::task::JoinSet;

use super::types::{
    classify, format_settings, probe_order, Category, FloodGuard, FloodVerdict, ProbeKind,
    ProbeOutcome, ProgressThrottle, ScanKind, SerialParams, ValidScan,
};

const FLOOD_THRESHOLD: usize = 16;
const PROGRESS_GAP: Duration = Duration::from_millis(100);

const TCP_FLOOD_NOTICE: &str =
    "This device answers every unit ID — it probably ignores the unit ID; use 1 (or 255)";

fn serial_flood_notice(settings: &str) -> String {
    format!(
        "Every address answered at {settings} — echo/loopback adapter or wrong settings; \
         skipped the rest of this setting"
    )
}

fn tcp_fallback_notice(n: usize) -> String {
    format!("Device accepts {n} connection(s); scanning {n} at a time")
}

/// Locks a std mutex, recovering the data if another task panicked while
/// holding it (the engine's state stays usable; nothing here is left torn).
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ---------- transport traits ----------

/// One open conversation (a serial port at fixed settings, or a TCP
/// connection). The implementation bounds each read by `wait` itself.
pub trait Prober: Send {
    fn read(
        &mut self,
        unit: u8,
        function_code: u8,
        wait: Duration,
    ) -> impl Future<Output = ProbeOutcome> + Send;
}

pub trait Opener: Send + Sync + 'static {
    type P: Prober + 'static;
    fn open(
        &self,
        port: &str,
        params: &SerialParams,
    ) -> impl Future<Output = Result<Self::P, String>> + Send;
}

pub trait Connector: Send + Sync + 'static {
    type P: Prober + 'static;
    fn connect(&self) -> impl Future<Output = Result<Self::P, String>> + Send;
}

// ---------- events ----------

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanFound {
    pub workspace: String,
    pub scan_id: String,
    pub target: String,
    pub unit_id: u8,
    pub settings: Option<SerialParams>,
    pub category: Category,
    pub detail: String,
    pub function_code: u8,
    pub response_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanCurrent {
    pub target: String,
    pub unit_id: u8,
    pub settings: Option<SerialParams>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub workspace: String,
    pub scan_id: String,
    pub checked: u64,
    pub total: u64,
    pub current: ScanCurrent,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanNotice {
    pub workspace: String,
    pub scan_id: String,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanDone {
    pub workspace: String,
    pub scan_id: String,
    /// "completed" | "cancelled" | "failed"
    pub reason: String,
    pub error: Option<String>,
    pub checked: u64,
    pub found: u64,
}

/// Receives scan events. Calls are synchronous and must not block for long:
/// progress is sent while a short-lived std mutex is held so events stay in
/// order.
pub trait ScanSink: Send + Sync + 'static {
    fn found(&self, e: ScanFound);
    fn progress(&self, e: ScanProgress);
    fn notice(&self, e: ScanNotice);
    fn done(&self, e: ScanDone);
}

// ---------- cancellation ----------

#[derive(Clone)]
pub struct Cancel(watch::Receiver<bool>);

impl Cancel {
    pub fn is_cancelled(&self) -> bool {
        *self.0.borrow()
    }

    /// Resolves once cancel is requested. If the sender is dropped without
    /// cancelling, nobody can cancel any more, so this never resolves.
    pub async fn cancelled(&mut self) {
        // The `Ref` from `wait_for` is dropped at the end of this statement.
        let closed = self.0.wait_for(|c| *c).await.is_err();
        if closed && !self.is_cancelled() {
            std::future::pending::<()>().await;
        }
    }
}

pub fn cancel_pair() -> (watch::Sender<bool>, Cancel) {
    let (tx, rx) = watch::channel(false);
    (tx, Cancel(rx))
}

// ---------- probing one unit ----------

/// Probes one unit: for each function code in the probe order, up to
/// `retries + 1` attempts, stopping at the first answer that is not a
/// timeout. Returns `(outcome, function code, ms of that attempt)`, or
/// `None` if cancelled.
pub async fn probe_unit<P: Prober>(
    p: &mut P,
    unit: u8,
    kind: ProbeKind,
    retries: u8,
    wait: Duration,
    cancel: &mut Cancel,
) -> Option<(ProbeOutcome, u8, u64)> {
    let mut last = (0u8, 0u64);
    for &fc in probe_order(kind) {
        for _ in 0..=retries {
            if cancel.is_cancelled() {
                return None;
            }
            let t0 = tokio::time::Instant::now();
            let outcome = tokio::select! {
                biased;
                _ = cancel.cancelled() => return None,
                o = p.read(unit, fc, wait) => o,
            };
            let ms = u64::try_from(t0.elapsed().as_millis()).unwrap_or(u64::MAX);
            if outcome != ProbeOutcome::NoReply {
                return Some((outcome, fc, ms));
            }
            last = (fc, ms);
        }
    }
    Some((ProbeOutcome::NoReply, last.0, last.1))
}

// ---------- shared scan context ----------

struct ProgressState {
    throttle: ProgressThrottle,
    last_checked_sent: u64,
}

struct Ctx<S: ScanSink> {
    workspace: String,
    scan_id: String,
    sink: Arc<S>,
    total: u64,
    checked: AtomicU64,
    found: AtomicU64,
    progress: Mutex<ProgressState>,
    cancel_seen: AtomicBool,
}

impl<S: ScanSink> Ctx<S> {
    fn notice(&self, message: String) {
        self.sink.notice(ScanNotice {
            workspace: self.workspace.clone(),
            scan_id: self.scan_id.clone(),
            message,
        });
    }

    fn saw_cancel(&self) {
        self.cancel_seen.store(true, Ordering::SeqCst);
    }

    /// Reports one finished check: a found event if it classifies, then the
    /// counters and (throttled) progress. Returns the category for the flood
    /// guard.
    fn record(
        &self,
        target: &str,
        unit: u8,
        settings: Option<&SerialParams>,
        outcome: &ProbeOutcome,
        function_code: u8,
        response_ms: u64,
    ) -> Option<Category> {
        let class = classify(outcome);
        if let Some((category, detail)) = &class {
            if *category == Category::Found {
                self.found.fetch_add(1, Ordering::SeqCst);
            }
            self.sink.found(ScanFound {
                workspace: self.workspace.clone(),
                scan_id: self.scan_id.clone(),
                target: target.to_string(),
                unit_id: unit,
                settings: settings.cloned(),
                category: *category,
                detail: detail.clone(),
                function_code,
                response_ms,
            });
        }
        self.checked.fetch_add(1, Ordering::SeqCst);
        self.emit_progress(target, unit, settings);
        class.map(|(c, _)| c)
    }

    fn emit_progress(&self, target: &str, unit: u8, settings: Option<&SerialParams>) {
        let mut st = lock(&self.progress);
        // Read under the lock so events leave in increasing `checked` order.
        let checked = self.checked.load(Ordering::SeqCst);
        if checked <= st.last_checked_sent {
            return;
        }
        let now = tokio::time::Instant::now().into_std();
        if !st.throttle.should_emit(now, checked >= self.total) {
            return;
        }
        st.last_checked_sent = checked;
        self.sink.progress(ScanProgress {
            workspace: self.workspace.clone(),
            scan_id: self.scan_id.clone(),
            checked,
            total: self.total,
            current: ScanCurrent {
                target: target.to_string(),
                unit_id: unit,
                settings: settings.cloned(),
            },
        });
    }
}

// ---------- entry point ----------

/// Runs a whole scan and sends `done` before returning it. `connector` is
/// only used (and required) for TCP scans; `opener` only for serial ones.
pub async fn run_scan<O: Opener, C: Connector, S: ScanSink>(
    scan: ValidScan,
    workspace: String,
    opener: Arc<O>,
    connector: Option<Arc<C>>,
    sink: Arc<S>,
    cancel: Cancel,
) -> ScanDone {
    let units = scan.units.len() as u64;
    let total = match scan.kind {
        ScanKind::Serial => units * scan.combos.len() as u64 * scan.ports.len() as u64,
        ScanKind::Tcp => units,
    };
    let ctx = Arc::new(Ctx {
        workspace,
        scan_id: scan.scan_id.clone(),
        sink,
        total,
        checked: AtomicU64::new(0),
        found: AtomicU64::new(0),
        progress: Mutex::new(ProgressState {
            throttle: ProgressThrottle::new(PROGRESS_GAP),
            last_checked_sent: 0,
        }),
        cancel_seen: AtomicBool::new(false),
    });
    let scan = Arc::new(scan);

    let result = match scan.kind {
        ScanKind::Serial => scan_serial_ports(scan, ctx.clone(), opener, cancel).await,
        ScanKind::Tcp => match connector {
            Some(c) => scan_tcp_pool(scan, ctx.clone(), c, cancel).await,
            None => Err("internal error: no TCP connector for a TCP scan".to_string()),
        },
    };

    let (reason, error) = if ctx.cancel_seen.load(Ordering::SeqCst) {
        ("cancelled", None)
    } else {
        match result {
            Ok(()) => ("completed", None),
            Err(e) => ("failed", Some(e)),
        }
    };
    let done = ScanDone {
        workspace: ctx.workspace.clone(),
        scan_id: ctx.scan_id.clone(),
        reason: reason.to_string(),
        error,
        checked: ctx.checked.load(Ordering::SeqCst),
        found: ctx.found.load(Ordering::SeqCst),
    };
    ctx.sink.done(done.clone());
    done
}

/// Waits for every task, so no port or connection outlives the scan; a
/// panicked task makes the scan fail.
async fn join_all(set: &mut JoinSet<()>) -> Result<(), String> {
    let mut error = None;
    while let Some(res) = set.join_next().await {
        if let Err(e) = res {
            log::error!("slave scan task failed: {e}");
            error.get_or_insert_with(|| format!("scan task failed: {e}"));
        }
    }
    error.map_or(Ok(()), Err)
}

// ---------- serial ----------

async fn scan_serial_ports<O: Opener, S: ScanSink>(
    scan: Arc<ValidScan>,
    ctx: Arc<Ctx<S>>,
    opener: Arc<O>,
    cancel: Cancel,
) -> Result<(), String> {
    let mut set = JoinSet::new();
    for port in &scan.ports {
        set.spawn(serial_port_task(
            port.clone(),
            scan.clone(),
            ctx.clone(),
            opener.clone(),
            cancel.clone(),
        ));
    }
    join_all(&mut set).await
}

enum ComboEnd {
    Finished,
    Cancelled,
    PortLost,
}

/// One port: every combo in order, one open port at a time, strictly
/// sequential checks. The prober is dropped at the end of each combo and on
/// every early return.
async fn serial_port_task<O: Opener, S: ScanSink>(
    port: String,
    scan: Arc<ValidScan>,
    ctx: Arc<Ctx<S>>,
    opener: Arc<O>,
    mut cancel: Cancel,
) {
    for combo in &scan.combos {
        if cancel.is_cancelled() {
            ctx.saw_cancel();
            return;
        }
        // Not raced against cancel: the open (a blocking call in production)
        // runs to completion so the port is closed again before `done` goes
        // out; the check right after drops it at once.
        let mut prober = match opener.open(&port, combo).await {
            Ok(p) => p,
            Err(e) => {
                ctx.notice(format!("{port}: could not open at {}: {e}", format_settings(combo)));
                continue;
            }
        };
        if cancel.is_cancelled() {
            ctx.saw_cancel();
            return;
        }
        let end = scan_combo(&port, combo, &mut prober, &scan, &ctx, &mut cancel).await;
        drop(prober);
        match end {
            ComboEnd::Finished => {}
            ComboEnd::Cancelled => {
                ctx.saw_cancel();
                return;
            }
            ComboEnd::PortLost => return,
        }
    }
}

async fn scan_combo<P: Prober, S: ScanSink>(
    port: &str,
    combo: &SerialParams,
    prober: &mut P,
    scan: &ValidScan,
    ctx: &Ctx<S>,
    cancel: &mut Cancel,
) -> ComboEnd {
    let mut guard = FloodGuard::new(FLOOD_THRESHOLD);
    for &unit in &scan.units {
        let Some((outcome, fc, ms)) =
            probe_unit(prober, unit, scan.probe, scan.retries, scan.wait, cancel).await
        else {
            return ComboEnd::Cancelled;
        };
        if let ProbeOutcome::LinkError(e) = &outcome {
            ctx.notice(format!("{port} stopped responding: {e}"));
            return ComboEnd::PortLost;
        }
        let category = ctx.record(port, unit, Some(combo), &outcome, fc, ms);
        if guard.record(category) != FloodVerdict::Continue {
            ctx.notice(serial_flood_notice(&format_settings(combo)));
            return ComboEnd::Finished;
        }
    }
    ComboEnd::Finished
}

// ---------- TCP ----------

/// Work queue and worker bookkeeping, all under one lock so "queue empty and
/// nothing in flight" is checked atomically.
///
/// A worker is *settled* once its capacity is known: its connect failed, its
/// first check got a usable answer, its connection broke before that, or it
/// left without checking anything. Devices that allow one connection often
/// accept extra ones and reset them on the first request, so the fallback
/// notice waits until every worker is settled to report the final count.
struct PoolState {
    queue: VecDeque<u8>,
    in_flight: usize,
    unsettled: usize,
    live: usize,
    retired: bool,
    notice_sent: bool,
    stopped: bool,
    flood: FloodGuard,
    last_error: Option<String>,
}

struct Pool {
    state: Mutex<PoolState>,
    /// Wakes idle workers when a unit is put back, finishes, or the pool stops.
    changed: Notify,
}

enum Take {
    Unit(u8),
    Wait,
    Exhausted,
}

impl Pool {
    /// Worker 0 is already connected (live); all `workers` are unsettled.
    fn new(units: VecDeque<u8>, workers: usize) -> Self {
        Self {
            state: Mutex::new(PoolState {
                queue: units,
                in_flight: 0,
                unsettled: workers,
                live: 1,
                retired: false,
                notice_sent: false,
                stopped: false,
                flood: FloodGuard::new(FLOOD_THRESHOLD),
                last_error: None,
            }),
            changed: Notify::new(),
        }
    }

    fn try_take(&self) -> Take {
        let mut st = lock(&self.state);
        if st.stopped {
            return Take::Exhausted;
        }
        if let Some(u) = st.queue.pop_front() {
            st.in_flight += 1;
            return Take::Unit(u);
        }
        if st.in_flight == 0 {
            Take::Exhausted
        } else {
            // Another worker may still put its unit back.
            Take::Wait
        }
    }

    /// Next unit, or `None` when the work is done, the pool stopped, or
    /// cancel was requested.
    async fn take(&self, cancel: &mut Cancel) -> Option<u8> {
        loop {
            let notified = self.changed.notified();
            tokio::pin!(notified);
            // Register before checking so a wake between check and await is kept.
            notified.as_mut().enable();
            match self.try_take() {
                Take::Unit(u) => return Some(u),
                Take::Exhausted => return None,
                Take::Wait => {}
            }
            tokio::select! {
                biased;
                _ = cancel.cancelled() => return None,
                _ = &mut notified => {}
            }
        }
    }

    fn connected(&self) {
        lock(&self.state).live += 1;
    }

    /// Settles a worker whose connect failed. Returns the live count if the
    /// fallback notice is due now.
    fn connect_failed(&self) -> Option<usize> {
        let mut st = lock(&self.state);
        st.retired = true;
        Self::settle_one(&mut st)
    }

    /// Settles a worker that left (cancel, or no work) before its first check.
    fn settle(&self) -> Option<usize> {
        Self::settle_one(&mut lock(&self.state))
    }

    /// A check finished; `first` settles the worker. Returns whether this
    /// check tripped the flood guard, and the fallback notice count if due.
    fn finish(&self, category: Option<Category>, first: bool) -> (bool, Option<usize>) {
        let result = {
            let mut st = lock(&self.state);
            st.in_flight = st.in_flight.saturating_sub(1);
            let flooded = st.flood.record(category) == FloodVerdict::AllFound;
            if flooded {
                st.stopped = true;
            }
            let notice = if first { Self::settle_one(&mut st) } else { None };
            (flooded, notice)
        };
        self.changed.notify_waiters();
        result
    }

    /// A check was abandoned because of cancel.
    fn abandon(&self) {
        {
            let mut st = lock(&self.state);
            st.in_flight = st.in_flight.saturating_sub(1);
        }
        self.changed.notify_waiters();
    }

    /// A worker's connection broke: its unit goes back on the queue and the
    /// worker stops. Returns the live count if the fallback notice is due.
    fn retire(&self, unit: u8, err: String, first: bool) -> Option<usize> {
        let notice = {
            let mut st = lock(&self.state);
            st.in_flight = st.in_flight.saturating_sub(1);
            st.queue.push_front(unit);
            st.live = st.live.saturating_sub(1);
            st.retired = true;
            st.last_error = Some(err);
            if first {
                Self::settle_one(&mut st)
            } else {
                Self::notice_due(&mut st)
            }
        };
        self.changed.notify_waiters();
        notice
    }

    fn settle_one(st: &mut PoolState) -> Option<usize> {
        st.unsettled = st.unsettled.saturating_sub(1);
        Self::notice_due(st)
    }

    /// One notice per scan, once every worker is settled and some worker
    /// was lost, and only while one is still alive (otherwise the scan fails).
    fn notice_due(st: &mut PoolState) -> Option<usize> {
        if st.retired && !st.notice_sent && st.unsettled == 0 && st.live > 0 {
            st.notice_sent = true;
            Some(st.live)
        } else {
            None
        }
    }
}

fn send_fallback_notice<S: ScanSink>(ctx: &Ctx<S>, due: Option<usize>) {
    if let Some(n) = due {
        ctx.notice(tcp_fallback_notice(n));
    }
}

async fn scan_tcp_pool<C: Connector, S: ScanSink>(
    scan: Arc<ValidScan>,
    ctx: Arc<Ctx<S>>,
    connector: Arc<C>,
    mut cancel: Cancel,
) -> Result<(), String> {
    let target: Arc<str> = match &scan.tcp {
        Some(t) => format!("{}:{}", t.host, t.port).into(),
        None => return Err("internal error: TCP scan without a target".to_string()),
    };
    let first = tokio::select! {
        biased;
        _ = cancel.cancelled() => {
            ctx.saw_cancel();
            return Ok(());
        }
        r = connector.connect() => r,
    };
    let first = first.map_err(|e| format!("could not connect to {target}: {e}"))?;

    let workers = scan.concurrency.max(1);
    let pool = Arc::new(Pool::new(scan.units.iter().copied().collect(), workers));
    let mut set = JoinSet::new();
    set.spawn(tcp_worker(
        first,
        target.clone(),
        scan.clone(),
        ctx.clone(),
        pool.clone(),
        cancel.clone(),
    ));
    for _ in 1..workers {
        set.spawn(tcp_connect_then_work(
            connector.clone(),
            target.clone(),
            scan.clone(),
            ctx.clone(),
            pool.clone(),
            cancel.clone(),
        ));
    }
    join_all(&mut set).await?;

    let st = lock(&pool.state);
    if !st.stopped && !st.queue.is_empty() && !ctx.cancel_seen.load(Ordering::SeqCst) {
        let err = st.last_error.as_deref().unwrap_or("connection lost");
        return Err(format!("{target} stopped responding: {err}"));
    }
    Ok(())
}

async fn tcp_connect_then_work<C: Connector, S: ScanSink>(
    connector: Arc<C>,
    target: Arc<str>,
    scan: Arc<ValidScan>,
    ctx: Arc<Ctx<S>>,
    pool: Arc<Pool>,
    mut cancel: Cancel,
) {
    let connected = tokio::select! {
        biased;
        _ = cancel.cancelled() => None,
        r = connector.connect() => Some(r),
    };
    match connected {
        None => {
            ctx.saw_cancel();
            send_fallback_notice(&ctx, pool.settle());
        }
        Some(Err(e)) => {
            log::info!("slave scan: extra connection to {target} refused: {e}");
            send_fallback_notice(&ctx, pool.connect_failed());
        }
        Some(Ok(prober)) => {
            pool.connected();
            tcp_worker(prober, target, scan, ctx, pool, cancel).await;
        }
    }
}

/// Takes units from the pool until it runs dry, stops, or this connection
/// breaks. The prober is dropped on every return.
async fn tcp_worker<P: Prober, S: ScanSink>(
    mut prober: P,
    target: Arc<str>,
    scan: Arc<ValidScan>,
    ctx: Arc<Ctx<S>>,
    pool: Arc<Pool>,
    mut cancel: Cancel,
) {
    let mut settled = false;
    loop {
        let Some(unit) = pool.take(&mut cancel).await else {
            if cancel.is_cancelled() {
                ctx.saw_cancel();
            }
            break;
        };
        match probe_unit(&mut prober, unit, scan.probe, scan.retries, scan.wait, &mut cancel).await
        {
            None => {
                pool.abandon();
                ctx.saw_cancel();
                break;
            }
            Some((ProbeOutcome::LinkError(e), _, _)) => {
                log::info!("slave scan: connection to {target} lost: {e}");
                send_fallback_notice(&ctx, pool.retire(unit, e, !settled));
                return;
            }
            Some((outcome, fc, ms)) => {
                let category = ctx.record(&target, unit, None, &outcome, fc, ms);
                let (flooded, due) = pool.finish(category, !settled);
                settled = true;
                send_fallback_notice(&ctx, due);
                if flooded {
                    ctx.notice(TCP_FLOOD_NOTICE.to_string());
                }
            }
        }
    }
    if !settled {
        send_fallback_notice(&ctx, pool.settle());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slave_scan::types::{
        Category, ProbeKind, ProbeOutcome, ScanKind, SerialParams, TcpTarget, ValidScan,
    };
    use std::collections::{HashMap, HashSet};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    // ---------- fakes ----------

    #[derive(Clone)]
    struct Script {
        map: HashMap<(u8, u8), ProbeOutcome>,
        default: ProbeOutcome,
    }

    impl Default for Script {
        fn default() -> Self {
            Self { map: HashMap::new(), default: ProbeOutcome::NoReply }
        }
    }

    impl Script {
        fn with(mut self, unit: u8, fc: u8, o: ProbeOutcome) -> Self {
            self.map.insert((unit, fc), o);
            self
        }
        fn all(o: ProbeOutcome) -> Self {
            Self { map: HashMap::new(), default: o }
        }
    }

    /// (label, unit, fc); label is "port baud parity" or "tcp#n".
    type Calls = Arc<Mutex<Vec<(String, u8, u8)>>>;

    struct InFlight(Arc<AtomicUsize>);
    impl InFlight {
        fn enter(cur: &Arc<AtomicUsize>, max: &Arc<AtomicUsize>) -> Self {
            let n = cur.fetch_add(1, Ordering::SeqCst) + 1;
            max.fetch_max(n, Ordering::SeqCst);
            Self(cur.clone())
        }
    }
    impl Drop for InFlight {
        fn drop(&mut self) {
            self.0.fetch_sub(1, Ordering::SeqCst);
        }
    }

    struct FakeProber {
        label: String,
        script: Script,
        delay: Duration,
        link_error: bool,
        calls: Calls,
        in_flight: Arc<AtomicUsize>,
        max_in_flight: Arc<AtomicUsize>,
        live: Arc<AtomicUsize>,
    }

    impl Drop for FakeProber {
        fn drop(&mut self) {
            self.live.fetch_sub(1, Ordering::SeqCst);
        }
    }

    impl Prober for FakeProber {
        fn read(
            &mut self,
            unit: u8,
            function_code: u8,
            _wait: Duration,
        ) -> impl std::future::Future<Output = ProbeOutcome> + Send {
            self.calls.lock().unwrap().push((self.label.clone(), unit, function_code));
            let outcome = if self.link_error {
                ProbeOutcome::LinkError("reset".into())
            } else {
                self.script
                    .map
                    .get(&(unit, function_code))
                    .cloned()
                    .unwrap_or_else(|| self.script.default.clone())
            };
            let delay = self.delay;
            let cur = self.in_flight.clone();
            let max = self.max_in_flight.clone();
            async move {
                let _g = InFlight::enter(&cur, &max);
                if !delay.is_zero() {
                    tokio::time::sleep(delay).await;
                }
                outcome
            }
        }
    }

    #[derive(Default)]
    struct PortCounters {
        live: Arc<AtomicUsize>,
        in_flight: Arc<AtomicUsize>,
        max_in_flight: Arc<AtomicUsize>,
    }

    #[derive(Default)]
    struct FakeOpener {
        scripts: HashMap<(String, u32, String), Script>,
        fail_ports: HashSet<String>,
        delay: Duration,
        calls: Calls,
        opens: Mutex<Vec<(String, u32, String)>>,
        ports: Mutex<HashMap<String, Arc<PortCounters>>>,
        /// Opens that happened while a prober for the same port was alive.
        overlap_violations: AtomicUsize,
    }

    impl FakeOpener {
        fn script(mut self, port: &str, baud: u32, parity: &str, s: Script) -> Self {
            self.scripts.insert((port.into(), baud, parity.into()), s);
            self
        }
        fn counters(&self, port: &str) -> Arc<PortCounters> {
            self.ports.lock().unwrap().entry(port.into()).or_default().clone()
        }
        fn opens(&self) -> Vec<(String, u32, String)> {
            self.opens.lock().unwrap().clone()
        }
    }

    impl Opener for FakeOpener {
        type P = FakeProber;
        fn open(
            &self,
            port: &str,
            params: &SerialParams,
        ) -> impl std::future::Future<Output = Result<FakeProber, String>> + Send {
            self.opens.lock().unwrap().push((port.into(), params.baud, params.parity.clone()));
            let result = if self.fail_ports.contains(port) {
                Err("access denied".to_string())
            } else {
                let c = self.counters(port);
                if c.live.fetch_add(1, Ordering::SeqCst) != 0 {
                    self.overlap_violations.fetch_add(1, Ordering::SeqCst);
                }
                let key = (port.to_string(), params.baud, params.parity.clone());
                Ok(FakeProber {
                    label: format!("{} {} {}", port, params.baud, params.parity),
                    script: self.scripts.get(&key).cloned().unwrap_or_default(),
                    delay: self.delay,
                    link_error: false,
                    calls: self.calls.clone(),
                    in_flight: c.in_flight.clone(),
                    max_in_flight: c.max_in_flight.clone(),
                    live: c.live.clone(),
                })
            };
            async move { result }
        }
    }

    #[derive(Default)]
    struct FakeConnector {
        script: Script,
        delay: Duration,
        /// `Some(n)`: only the first n connects succeed.
        accept: Option<usize>,
        /// Connection indexes whose every read is a LinkError.
        link_error_conns: HashSet<usize>,
        connects: AtomicUsize,
        calls: Calls,
        in_flight: Arc<AtomicUsize>,
        max_in_flight: Arc<AtomicUsize>,
        live: Arc<AtomicUsize>,
    }

    impl Connector for FakeConnector {
        type P = FakeProber;
        fn connect(&self) -> impl std::future::Future<Output = Result<FakeProber, String>> + Send {
            let n = self.connects.fetch_add(1, Ordering::SeqCst);
            let result = if self.accept.is_some_and(|a| n >= a) {
                Err("connection refused".to_string())
            } else {
                self.live.fetch_add(1, Ordering::SeqCst);
                Ok(FakeProber {
                    label: format!("tcp#{n}"),
                    script: self.script.clone(),
                    delay: self.delay,
                    link_error: self.link_error_conns.contains(&n),
                    calls: self.calls.clone(),
                    in_flight: self.in_flight.clone(),
                    max_in_flight: self.max_in_flight.clone(),
                    live: self.live.clone(),
                })
            };
            async move { result }
        }
    }

    #[derive(Clone, Debug)]
    enum Ev {
        Found(ScanFound),
        Progress(ScanProgress),
        Notice(ScanNotice),
        Done(ScanDone),
    }

    #[derive(Default)]
    struct RecordingSink {
        events: Mutex<Vec<Ev>>,
    }

    impl ScanSink for RecordingSink {
        fn found(&self, e: ScanFound) {
            self.events.lock().unwrap().push(Ev::Found(e));
        }
        fn progress(&self, e: ScanProgress) {
            self.events.lock().unwrap().push(Ev::Progress(e));
        }
        fn notice(&self, e: ScanNotice) {
            self.events.lock().unwrap().push(Ev::Notice(e));
        }
        fn done(&self, e: ScanDone) {
            self.events.lock().unwrap().push(Ev::Done(e));
        }
    }

    struct Run {
        done: ScanDone,
        events: Vec<Ev>,
    }

    impl Run {
        fn found(&self) -> Vec<ScanFound> {
            self.events
                .iter()
                .filter_map(|e| if let Ev::Found(f) = e { Some(f.clone()) } else { None })
                .collect()
        }
        fn notices(&self) -> Vec<String> {
            self.events
                .iter()
                .filter_map(|e| if let Ev::Notice(n) = e { Some(n.message.clone()) } else { None })
                .collect()
        }
        fn progress(&self) -> Vec<ScanProgress> {
            self.events
                .iter()
                .filter_map(|e| if let Ev::Progress(p) = e { Some(p.clone()) } else { None })
                .collect()
        }
    }

    // ---------- helpers ----------

    fn combo(baud: u32, parity: &str) -> SerialParams {
        SerialParams {
            baud,
            parity: parity.into(),
            data_bits: 8,
            stop_bits: 1,
            flow_control: "none".into(),
        }
    }

    fn serial_scan(units: std::ops::RangeInclusive<u8>, ports: &[&str]) -> ValidScan {
        ValidScan {
            scan_id: "s1".into(),
            kind: ScanKind::Serial,
            units: units.collect(),
            probe: ProbeKind::HoldingThenInput,
            wait: Duration::from_millis(200),
            retries: 0,
            ports: ports.iter().map(|p| p.to_string()).collect(),
            combos: vec![combo(9600, "none")],
            tcp: None,
            concurrency: 1,
        }
    }

    fn tcp_scan(units: std::ops::RangeInclusive<u8>, concurrency: usize) -> ValidScan {
        ValidScan {
            kind: ScanKind::Tcp,
            ports: vec![],
            combos: vec![],
            tcp: Some(TcpTarget { host: "10.0.0.5".into(), port: 502 }),
            concurrency,
            probe: ProbeKind::Holding,
            ..serial_scan(units, &[])
        }
    }

    async fn run_with(
        scan: ValidScan,
        opener: Arc<FakeOpener>,
        connector: Option<Arc<FakeConnector>>,
        cancel: Cancel,
    ) -> Run {
        let sink = Arc::new(RecordingSink::default());
        let done = run_scan(scan, "ws1".into(), opener, connector, sink.clone(), cancel).await;
        let events = sink.events.lock().unwrap().clone();
        let dones: Vec<&ScanDone> =
            events.iter().filter_map(|e| if let Ev::Done(d) = e { Some(d) } else { None }).collect();
        assert_eq!(dones.len(), 1, "exactly one done event");
        assert!(matches!(events.last(), Some(Ev::Done(_))), "done is the last event");
        Run { done, events }
    }

    async fn run_serial(scan: ValidScan, opener: Arc<FakeOpener>) -> Run {
        let (_tx, cancel) = cancel_pair();
        run_with(scan, opener, None, cancel).await
    }

    async fn run_tcp(scan: ValidScan, connector: Arc<FakeConnector>) -> Run {
        let (_tx, cancel) = cancel_pair();
        run_with(scan, Arc::new(FakeOpener::default()), Some(connector), cancel).await
    }

    fn calls(c: &Calls) -> Vec<(String, u8, u8)> {
        c.lock().unwrap().clone()
    }

    // ---------- tests ----------

    #[tokio::test(start_paused = true)]
    async fn finds_value_and_exception_units() {
        let opener = Arc::new(FakeOpener::default().script(
            "COM1",
            9600,
            "none",
            Script::default()
                .with(3, 3, ProbeOutcome::Value)
                .with(7, 3, ProbeOutcome::Exception(2)),
        ));
        let r = run_serial(serial_scan(1..=10, &["COM1"]), opener).await;
        let found = r.found();
        assert_eq!(found.len(), 2);
        assert_eq!((found[0].unit_id, found[0].category), (3, Category::Found));
        assert_eq!((found[1].unit_id, found[1].category), (7, Category::Found));
        assert_eq!(found[1].detail, "exception 0x02");
        assert_eq!(found[0].target, "COM1");
        assert_eq!(found[0].settings, Some(combo(9600, "none")));
        assert_eq!(found[0].workspace, "ws1");
        assert_eq!(found[0].scan_id, "s1");
        assert_eq!(r.done.reason, "completed");
        assert_eq!(r.done.error, None);
        assert_eq!(r.done.checked, 10);
        assert_eq!(r.done.found, 2);
    }

    #[tokio::test(start_paused = true)]
    async fn holding_then_input_falls_back_only_on_timeout() {
        let opener = Arc::new(FakeOpener::default().script(
            "COM1",
            9600,
            "none",
            Script::default()
                .with(5, 4, ProbeOutcome::Value)
                .with(6, 3, ProbeOutcome::Exception(2)),
        ));
        let log = opener.calls.clone();
        let r = run_serial(serial_scan(5..=6, &["COM1"]), opener).await;
        let found = r.found();
        assert_eq!(found.len(), 2);
        assert_eq!((found[0].unit_id, found[0].function_code), (5, 4));
        assert_eq!((found[1].unit_id, found[1].function_code), (6, 3));
        let fcs_for_6: Vec<u8> =
            calls(&log).iter().filter(|c| c.1 == 6).map(|c| c.2).collect();
        assert_eq!(fcs_for_6, vec![3], "FC4 is never tried after an exception on FC3");
    }

    #[tokio::test(start_paused = true)]
    async fn retries_per_function_code() {
        let opener = Arc::new(FakeOpener::default());
        let log = opener.calls.clone();
        let mut scan = serial_scan(1..=3, &["COM1"]);
        scan.retries = 2;
        let r = run_serial(scan, opener).await;
        for unit in 1..=3u8 {
            let fcs: Vec<u8> = calls(&log).iter().filter(|c| c.1 == unit).map(|c| c.2).collect();
            assert_eq!(fcs, vec![3, 3, 3, 4, 4, 4], "unit {unit}");
        }
        assert!(r.found().is_empty());
        assert_eq!(r.done.checked, 3);
    }

    #[tokio::test(start_paused = true)]
    async fn probe_unit_returns_none_when_cancelled() {
        let opener = FakeOpener { delay: Duration::from_secs(5), ..Default::default() };
        let mut p = opener.open("COM1", &combo(9600, "none")).await.unwrap();
        let (tx, mut cancel) = cancel_pair();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(10)).await;
            let _ = tx.send(true);
        });
        let r = probe_unit(&mut p, 1, ProbeKind::HoldingThenInput, 3, Duration::from_secs(5), &mut cancel)
            .await;
        assert_eq!(r, None);
        assert!(cancel.is_cancelled());
    }

    #[tokio::test(start_paused = true)]
    async fn sweep_runs_combos_sequentially_per_port() {
        let opener = Arc::new(FakeOpener::default());
        let mut scan = serial_scan(1..=5, &["COM1"]);
        scan.combos = vec![combo(9600, "none"), combo(19200, "even")];
        let r = run_serial(scan, opener.clone()).await;
        assert_eq!(
            opener.opens(),
            vec![("COM1".into(), 9600, "none".into()), ("COM1".into(), 19200, "even".into())]
        );
        assert_eq!(opener.overlap_violations.load(Ordering::SeqCst), 0);
        assert_eq!(opener.counters("COM1").live.load(Ordering::SeqCst), 0, "port dropped at end");
        let progress = r.progress();
        assert!(progress.iter().all(|p| p.total == 10));
        assert_eq!(progress.last().unwrap().checked, 10);
        assert_eq!(r.done.checked, 10);
    }

    #[tokio::test(start_paused = true)]
    async fn ports_run_in_parallel() {
        let opener = Arc::new(FakeOpener { delay: Duration::from_millis(50), ..Default::default() });
        let mut scan = serial_scan(1..=4, &["COM1", "COM2"]);
        scan.probe = ProbeKind::Holding;
        let t0 = tokio::time::Instant::now();
        let r = run_serial(scan, opener.clone()).await;
        let elapsed = t0.elapsed();
        assert!(
            elapsed >= Duration::from_millis(200) && elapsed < Duration::from_millis(300),
            "elapsed {elapsed:?}"
        );
        for port in ["COM1", "COM2"] {
            assert_eq!(opener.counters(port).max_in_flight.load(Ordering::SeqCst), 1, "{port}");
        }
        assert_eq!(r.done.checked, 8);
    }

    #[tokio::test(start_paused = true)]
    async fn open_failure_on_one_port_others_continue() {
        let mut opener = FakeOpener::default().script(
            "COM_OK",
            9600,
            "none",
            Script::default().with(2, 3, ProbeOutcome::Value),
        );
        opener.fail_ports.insert("COM_BAD".into());
        let r = run_serial(serial_scan(1..=3, &["COM_BAD", "COM_OK"]), Arc::new(opener)).await;
        let notices = r.notices();
        assert_eq!(notices.len(), 1);
        assert_eq!(notices[0], "COM_BAD: could not open at 9600 8N1: access denied");
        let found = r.found();
        assert_eq!(found.len(), 1);
        assert_eq!((found[0].target.as_str(), found[0].unit_id), ("COM_OK", 2));
        assert_eq!(r.done.reason, "completed");
    }

    #[tokio::test(start_paused = true)]
    async fn link_error_mid_scan_ends_that_port() {
        let opener = Arc::new(FakeOpener::default().script(
            "COM1",
            9600,
            "none",
            Script::default().with(3, 3, ProbeOutcome::LinkError("gone".into())),
        ));
        let log = opener.calls.clone();
        let mut scan = serial_scan(1..=6, &["COM1"]);
        scan.combos = vec![combo(9600, "none"), combo(19200, "none")];
        let r = run_serial(scan, opener.clone()).await;
        assert!(calls(&log).iter().all(|c| c.1 <= 3), "no reads after the link error");
        assert_eq!(opener.opens().len(), 1, "the port's remaining combos are skipped too");
        assert_eq!(opener.counters("COM1").live.load(Ordering::SeqCst), 0);
        assert_eq!(r.notices(), vec!["COM1 stopped responding: gone".to_string()]);
        assert_eq!(r.done.reason, "completed");
        assert_eq!(r.done.checked, 2);
    }

    #[tokio::test(start_paused = true)]
    async fn serial_flood_skips_combo() {
        let opener = Arc::new(FakeOpener::default().script(
            "COM1",
            9600,
            "none",
            Script::all(ProbeOutcome::Garbled("CRC error".into())),
        ));
        let log = opener.calls.clone();
        let mut scan = serial_scan(1..=30, &["COM1"]);
        scan.probe = ProbeKind::Holding;
        scan.combos = vec![combo(9600, "none"), combo(19200, "none")];
        let r = run_serial(scan, opener).await;
        let log = calls(&log);
        assert_eq!(log.iter().filter(|c| c.0 == "COM1 9600 none").count(), 16);
        assert_eq!(log.iter().filter(|c| c.0 == "COM1 19200 none").count(), 30);
        assert_eq!(
            r.notices(),
            vec!["Every address answered at 9600 8N1 — echo/loopback adapter or wrong settings; \
                  skipped the rest of this setting"
                .to_string()]
        );
        assert_eq!(r.found().len(), 16);
        assert!(r.found().iter().all(|f| f.category == Category::Garbled));
        assert_eq!(r.done.found, 0, "garbled rows are not counted as found");
        assert_eq!(r.done.reason, "completed");
    }

    #[tokio::test(start_paused = true)]
    async fn cancel_is_prompt() {
        let opener = Arc::new(FakeOpener { delay: Duration::from_secs(5), ..Default::default() });
        let (tx, cancel) = cancel_pair();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(10)).await;
            let _ = tx.send(true);
        });
        let t0 = tokio::time::Instant::now();
        let r = run_with(serial_scan(1..=247, &["COM1", "COM2"]), opener.clone(), None, cancel).await;
        assert!(t0.elapsed() < Duration::from_millis(100), "elapsed {:?}", t0.elapsed());
        assert_eq!(r.done.reason, "cancelled");
        assert_eq!(r.done.checked, 0);
        for port in ["COM1", "COM2"] {
            assert_eq!(opener.counters(port).live.load(Ordering::SeqCst), 0, "{port} dropped");
        }
    }

    #[tokio::test(start_paused = true)]
    async fn tcp_cancel_is_prompt() {
        let connector =
            Arc::new(FakeConnector { delay: Duration::from_secs(5), ..Default::default() });
        let (tx, cancel) = cancel_pair();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(10)).await;
            let _ = tx.send(true);
        });
        let t0 = tokio::time::Instant::now();
        let r = run_with(
            tcp_scan(0..=255, 4),
            Arc::new(FakeOpener::default()),
            Some(connector.clone()),
            cancel,
        )
        .await;
        assert!(t0.elapsed() < Duration::from_millis(100), "elapsed {:?}", t0.elapsed());
        assert_eq!(r.done.reason, "cancelled");
        assert_eq!(connector.live.load(Ordering::SeqCst), 0, "connections dropped");
    }

    #[tokio::test(start_paused = true)]
    async fn tcp_concurrency_respected() {
        let connector =
            Arc::new(FakeConnector { delay: Duration::from_millis(20), ..Default::default() });
        let r = run_tcp(tcp_scan(1..=40, 4), connector.clone()).await;
        assert_eq!(connector.max_in_flight.load(Ordering::SeqCst), 4);
        assert_eq!(r.done.checked, 40);
        assert_eq!(r.done.reason, "completed");
        assert_eq!(connector.live.load(Ordering::SeqCst), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn tcp_found_event_shape() {
        let connector = Arc::new(FakeConnector {
            script: Script::default().with(9, 3, ProbeOutcome::Value),
            ..Default::default()
        });
        let r = run_tcp(tcp_scan(1..=10, 2), connector).await;
        let found = r.found();
        assert_eq!(found.len(), 1);
        assert_eq!((found[0].target.as_str(), found[0].unit_id), ("10.0.0.5:502", 9));
        assert_eq!(found[0].settings, None);
        let progress = r.progress();
        assert!(progress.iter().all(|p| p.total == 10 && p.current.target == "10.0.0.5:502"));
    }

    #[tokio::test(start_paused = true)]
    async fn tcp_worker0_connect_fail_is_failed() {
        let connector = Arc::new(FakeConnector { accept: Some(0), ..Default::default() });
        let r = run_tcp(tcp_scan(1..=10, 4), connector).await;
        assert_eq!(r.done.reason, "failed");
        let err = r.done.error.clone().unwrap();
        assert!(err.contains("could not connect"), "{err}");
        assert_eq!(err, "could not connect to 10.0.0.5:502: connection refused");
        assert_eq!(r.done.checked, 0);
    }

    #[tokio::test(start_paused = true)]
    async fn tcp_fallback_shrinks_pool() {
        let connector = Arc::new(FakeConnector {
            accept: Some(1),
            delay: Duration::from_millis(5),
            ..Default::default()
        });
        let log = connector.calls.clone();
        let r = run_tcp(tcp_scan(1..=20, 4), connector).await;
        let log = calls(&log);
        for unit in 1..=20u8 {
            assert_eq!(log.iter().filter(|c| c.1 == unit).count(), 1, "unit {unit}");
        }
        assert_eq!(r.done.checked, 20);
        assert_eq!(r.notices(), vec!["Device accepts 1 connection(s); scanning 1 at a time".to_string()]);
        assert_eq!(r.done.reason, "completed");
    }

    #[tokio::test(start_paused = true)]
    async fn tcp_link_error_requeues_unit() {
        let connector = Arc::new(FakeConnector {
            link_error_conns: HashSet::from([2]),
            delay: Duration::from_millis(5),
            ..Default::default()
        });
        let log = connector.calls.clone();
        let r = run_tcp(tcp_scan(1..=20, 4), connector.clone()).await;
        let ok_reads: Vec<(String, u8, u8)> =
            calls(&log).into_iter().filter(|c| c.0 != "tcp#2").collect();
        for unit in 1..=20u8 {
            assert_eq!(ok_reads.iter().filter(|c| c.1 == unit).count(), 1, "unit {unit}");
        }
        assert_eq!(r.done.checked, 20);
        assert_eq!(r.notices(), vec!["Device accepts 3 connection(s); scanning 3 at a time".to_string()]);
        assert_eq!(r.done.reason, "completed");
        assert_eq!(connector.live.load(Ordering::SeqCst), 0);
    }

    /// Real time on a multi-thread runtime, so workers race for the queue and
    /// requeued units for real.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn tcp_pool_multi_thread_checks_every_unit_once() {
        let connector = Arc::new(FakeConnector {
            link_error_conns: HashSet::from([1, 3, 5]),
            delay: Duration::from_millis(1),
            ..Default::default()
        });
        let log = connector.calls.clone();
        let r = run_tcp(tcp_scan(0..=199, 8), connector.clone()).await;
        let broken = ["tcp#1", "tcp#3", "tcp#5"];
        let ok_reads: Vec<(String, u8, u8)> =
            calls(&log).into_iter().filter(|c| !broken.contains(&c.0.as_str())).collect();
        for unit in 0..=199u8 {
            assert_eq!(ok_reads.iter().filter(|c| c.1 == unit).count(), 1, "unit {unit}");
        }
        assert_eq!(r.done.checked, 200);
        assert_eq!(r.done.reason, "completed");
        assert_eq!(r.notices(), vec![tcp_fallback_notice(5)]);
        assert!(connector.max_in_flight.load(Ordering::SeqCst) <= 8);
        assert_eq!(connector.live.load(Ordering::SeqCst), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn tcp_all_connections_lost_is_failed() {
        let connector =
            Arc::new(FakeConnector { link_error_conns: HashSet::from([0]), ..Default::default() });
        let r = run_tcp(tcp_scan(1..=10, 1), connector).await;
        assert_eq!(r.done.reason, "failed");
        assert_eq!(r.done.error.as_deref(), Some("10.0.0.5:502 stopped responding: reset"));
        assert!(r.notices().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn tcp_flood_stops_scan() {
        let connector = Arc::new(FakeConnector {
            script: Script::all(ProbeOutcome::Value),
            delay: Duration::from_millis(5),
            ..Default::default()
        });
        let r = run_tcp(tcp_scan(0..=255, 4), connector).await;
        assert!(r.done.checked >= 16 && r.done.checked <= 16 + 4, "checked {}", r.done.checked);
        assert_eq!(
            r.notices(),
            vec!["This device answers every unit ID — it probably ignores the unit ID; use 1 (or 255)"
                .to_string()]
        );
        assert_eq!(r.done.reason, "completed");
        assert_eq!(r.done.found, r.done.checked);
    }

    #[tokio::test(start_paused = true)]
    async fn progress_is_throttled_and_final_forced() {
        let mut scan = serial_scan(1..=100, &["COM1"]);
        scan.probe = ProbeKind::Holding;
        let r = run_serial(scan, Arc::new(FakeOpener::default())).await;
        let progress = r.progress();
        assert!(progress.len() <= 3, "{} progress events", progress.len());
        let last = progress.last().unwrap();
        assert_eq!((last.checked, last.total), (100, 100));
        assert_eq!(progress.iter().filter(|p| p.checked == p.total).count(), 1);
        assert!(progress.windows(2).all(|w| w[0].checked < w[1].checked));
    }

    #[test]
    fn events_serialize_camel_case() {
        let f = ScanFound {
            workspace: "w".into(),
            scan_id: "s".into(),
            target: "COM1".into(),
            unit_id: 3,
            settings: None,
            category: Category::GatewayNoDevice,
            detail: "d".into(),
            function_code: 3,
            response_ms: 12,
        };
        let v = serde_json::to_value(&f).unwrap();
        for k in ["scanId", "unitId", "functionCode", "responseMs"] {
            assert!(v.get(k).is_some(), "{k}");
        }
        assert_eq!(v["category"], "gatewayNoDevice");
        let p = ScanProgress {
            workspace: "w".into(),
            scan_id: "s".into(),
            checked: 1,
            total: 2,
            current: ScanCurrent { target: "t".into(), unit_id: 1, settings: Some(combo(9600, "none")) },
        };
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["current"]["unitId"], 1);
        assert_eq!(v["current"]["settings"]["dataBits"], 8);
        let d = ScanDone {
            workspace: "w".into(),
            scan_id: "s".into(),
            reason: "completed".into(),
            error: None,
            checked: 0,
            found: 0,
        };
        assert!(serde_json::to_value(&d).unwrap().get("scanId").is_some());
    }
}
