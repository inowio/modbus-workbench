//! IP range scans in two stages: find the hosts that accept a TCP connection
//! on the port, then scan the unit IDs of each open host with the single-host
//! TCP engine ([`scan_tcp_host`]).
//!
//! Hosts are reached through [`HostProbe`] and connected to through
//! [`ConnectorFactory`], so this is tested with fakes like the engine.

use std::future::Future;
use std::net::{Ipv4Addr, SocketAddrV4};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use tokio::task::JoinSet;

use super::engine::{
    scan_tcp_host, Cancel, Connector, Ctx, HostOutcome, HostStatus, ScanDone, ScanSink,
    PROGRESS_GAP,
};
use super::types::{ProgressThrottle, ValidScan};

/// Hosts whose unit IDs are scanned at the same time in stage 2.
const HOSTS_AT_ONCE: usize = 4;

fn no_host_notice(port: u16) -> String {
    format!("No host answered on port {port} in this range")
}

/// What one connect attempt in stage 1 found.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reach {
    Open { ms: u64 },
    Refused,
    TimedOut,
}

/// Tries one TCP connection. The implementation bounds the attempt by `wait`
/// itself and closes the connection at once.
pub trait HostProbe: Send + Sync + 'static {
    fn reach(&self, addr: SocketAddrV4, wait: Duration) -> impl Future<Output = Reach> + Send;
}

/// Makes the connector used to scan one open host's unit IDs.
pub trait ConnectorFactory: Send + Sync + 'static {
    type C: Connector;
    fn for_host(&self, addr: SocketAddrV4) -> Self::C;
}

/// Runs a whole IP range scan and returns its `done` event without sending
/// it, like [`super::engine::run_scan`]. Every other event has been sent by
/// then, and no connect attempt or connection outlives the call.
///
/// `done` is `cancelled` if cancel was seen at any point, else `completed`
/// even when some hosts failed (their status says so); it is `failed` only
/// for an internal error. `checked` counts unit checks only.
pub async fn run_range_scan<H: HostProbe, F: ConnectorFactory, S: ScanSink>(
    scan: ValidScan,
    workspace: String,
    probe: Arc<H>,
    factory: Arc<F>,
    sink: Arc<S>,
    cancel: Cancel,
) -> ScanDone {
    let ctx = Arc::new(Ctx::new(workspace, scan.scan_id.clone(), sink, 0));
    let scan = Arc::new(scan);
    let result = match scan.tcp.as_ref().map(|t| t.port) {
        Some(port) => run_stages(&scan, &ctx, port, probe, factory, cancel).await,
        None => Err("internal error: range scan without a port".to_string()),
    };
    let (reason, error) = if ctx.cancel_seen.load(Ordering::SeqCst) {
        ("cancelled", None)
    } else {
        match result {
            Ok(()) => ("completed", None),
            Err(e) => ("failed", Some(e)),
        }
    };
    ScanDone {
        workspace: ctx.workspace.clone(),
        scan_id: ctx.scan_id.clone(),
        reason: reason.to_string(),
        error,
        checked: ctx.checked.load(Ordering::SeqCst),
        found: ctx.found.load(Ordering::SeqCst),
    }
}

async fn run_stages<H: HostProbe, F: ConnectorFactory, S: ScanSink>(
    scan: &Arc<ValidScan>,
    ctx: &Arc<Ctx<S>>,
    port: u16,
    probe: Arc<H>,
    factory: Arc<F>,
    cancel: Cancel,
) -> Result<(), String> {
    let mut open = find_hosts(scan, ctx, port, probe, cancel.clone()).await?;
    if ctx.cancel_seen.load(Ordering::SeqCst) {
        return Ok(());
    }
    if open.is_empty() {
        ctx.notice(no_host_notice(port));
        return Ok(());
    }
    open.sort_by_key(|h| h.0);
    scan_hosts(scan, ctx, port, &open, factory, cancel).await
}

// ---------- stage 1: find hosts ----------

/// Tries every address, at most `host_concurrency` at a time, and returns
/// the open ones with their connect time. Each open host is reported as soon
/// as it answers. On cancel every attempt in flight is dropped at once.
async fn find_hosts<H: HostProbe, S: ScanSink>(
    scan: &ValidScan,
    ctx: &Ctx<S>,
    port: u16,
    probe: Arc<H>,
    mut cancel: Cancel,
) -> Result<Vec<(Ipv4Addr, u64)>, String> {
    let total = scan.hosts.len() as u64;
    let limit = scan.host_concurrency.max(1);
    let mut throttle = ProgressThrottle::new(PROGRESS_GAP);
    let mut addresses = scan.hosts.iter().copied();
    let mut set = JoinSet::new();
    let mut tried = 0u64;
    let mut open = Vec::new();
    let mut error = None;
    loop {
        while set.len() < limit && !cancel.is_cancelled() {
            let Some(ip) = addresses.next() else { break };
            let addr = SocketAddrV4::new(ip, port);
            set.spawn(reach_host(probe.clone(), addr, scan.connect_wait, scan.retries.max(1), cancel.clone()));
        }
        if cancel.is_cancelled() {
            ctx.saw_cancel();
            break;
        }
        let joined = tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                ctx.saw_cancel();
                break;
            }
            j = set.join_next() => j,
        };
        let (addr, reach) = match joined {
            None => break,
            Some(Ok(r)) => r,
            Some(Err(e)) => {
                log::error!("slave scan: host probe task failed: {e}");
                error.get_or_insert_with(|| format!("scan task failed: {e}"));
                continue;
            }
        };
        let Some(reach) = reach else {
            ctx.saw_cancel();
            break;
        };
        tried += 1;
        if let Reach::Open { ms } = reach {
            open.push((*addr.ip(), ms));
            ctx.host(addr.to_string(), HostStatus::Open, Some(ms), 0, false);
        }
        let now = tokio::time::Instant::now().into_std();
        if throttle.should_emit(now, tried >= total) {
            ctx.hosts_progress(tried, total, addr.to_string());
        }
    }
    // Aborts whatever is still in flight (only after cancel) and waits for it.
    set.shutdown().await;
    error.map_or(Ok(open), Err)
}

/// One address: retries a timed-out connect up to `retries` times; a
/// refused one is final. `None` if cancelled.
async fn reach_host<H: HostProbe>(
    probe: Arc<H>,
    addr: SocketAddrV4,
    wait: Duration,
    retries: u8,
    mut cancel: Cancel,
) -> (SocketAddrV4, Option<Reach>) {
    for _ in 0..=retries {
        if cancel.is_cancelled() {
            return (addr, None);
        }
        let reach = tokio::select! {
            biased;
            _ = cancel.cancelled() => return (addr, None),
            r = tokio::time::timeout(wait, probe.reach(addr, wait)) => r.unwrap_or(Reach::TimedOut),
        };
        if reach != Reach::TimedOut {
            return (addr, Some(reach));
        }
    }
    (addr, Some(Reach::TimedOut))
}

// ---------- stage 2: scan each open host ----------

/// Scans the open hosts (sorted, indexed from 1), at most [`HOSTS_AT_ONCE`]
/// at a time, and reports each host's final status as it finishes.
async fn scan_hosts<F: ConnectorFactory, S: ScanSink>(
    scan: &Arc<ValidScan>,
    ctx: &Arc<Ctx<S>>,
    port: u16,
    open: &[(Ipv4Addr, u64)],
    factory: Arc<F>,
    cancel: Cancel,
) -> Result<(), String> {
    let targets: Vec<String> =
        open.iter().map(|(ip, _)| SocketAddrV4::new(*ip, port).to_string()).collect();
    ctx.total.store(scan.units.len() as u64 * open.len() as u64, Ordering::SeqCst);
    ctx.set_hosts(&targets);

    let mut next = 0;
    let mut set = JoinSet::new();
    let mut error = None;
    loop {
        while set.len() < HOSTS_AT_ONCE && next < open.len() {
            if cancel.is_cancelled() {
                ctx.saw_cancel();
                break;
            }
            let addr = SocketAddrV4::new(open[next].0, port);
            set.spawn(scan_one_host(
                next,
                addr,
                scan.clone(),
                ctx.clone(),
                factory.clone(),
                cancel.clone(),
            ));
            next += 1;
        }
        // Each host scan ends promptly on cancel by itself.
        let (i, outcome) = match set.join_next().await {
            None => break,
            Some(Ok(r)) => r,
            Some(Err(e)) => {
                log::error!("slave scan: host scan task failed: {e}");
                error.get_or_insert_with(|| format!("scan task failed: {e}"));
                continue;
            }
        };
        let status = host_status(&outcome);
        if let Err(e) = &outcome.result {
            log::info!("slave scan: {e}");
        }
        // A host cut short by cancel was not fully scanned, so "no Modbus
        // reply" would be a guess: it gets no final status, and the UI shows
        // it as not scanned. Findings (devices, gateway, ...) still count.
        let interrupted = cancel.is_cancelled()
            && outcome.result.is_ok()
            && status == HostStatus::NoModbus;
        if !interrupted {
            ctx.host(targets[i].clone(), status, Some(open[i].1), outcome.found, outcome.gateway);
        }
    }
    error.map_or(Ok(()), Err)
}

async fn scan_one_host<F: ConnectorFactory, S: ScanSink>(
    i: usize,
    addr: SocketAddrV4,
    scan: Arc<ValidScan>,
    ctx: Arc<Ctx<S>>,
    factory: Arc<F>,
    cancel: Cancel,
) -> (usize, HostOutcome) {
    let connector = Arc::new(factory.for_host(addr));
    let target: Arc<str> = addr.to_string().into();
    let prefix: Arc<str> = format!("{target}: ").into();
    (i, scan_tcp_host(scan, ctx, connector, target, Some(prefix), cancel).await)
}

/// A host's final status, in order of precedence.
fn host_status(o: &HostOutcome) -> HostStatus {
    match &o.result {
        Err(_) if o.any_reply => HostStatus::Lost,
        Err(_) => HostStatus::NoModbus,
        Ok(()) if o.answers_all => HostStatus::AnswersAll,
        Ok(()) if o.found > 0 => HostStatus::Devices,
        Ok(()) if o.gateway => HostStatus::Gateway,
        Ok(()) => HostStatus::NoModbus,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slave_scan::engine::{
        cancel_pair, HostStatus, Prober, ScanFound, ScanHost, ScanNotice, ScanPhase, ScanProgress,
    };
    use crate::slave_scan::types::{ProbeKind, ProbeOutcome, ScanKind, TcpTarget};
    use std::collections::HashMap;
    use std::net::Ipv4Addr;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    // ---------- fakes ----------

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

    /// Scripts a `Reach` per address (default `TimedOut`), after a delay.
    struct FakeProbe {
        script: HashMap<Ipv4Addr, Reach>,
        default: Reach,
        delays: HashMap<Ipv4Addr, Duration>,
        delay: Duration,
        calls: Mutex<HashMap<Ipv4Addr, usize>>,
        in_flight: Arc<AtomicUsize>,
        max_in_flight: Arc<AtomicUsize>,
    }

    impl Default for FakeProbe {
        fn default() -> Self {
            Self {
                script: HashMap::new(),
                default: Reach::TimedOut,
                delays: HashMap::new(),
                delay: Duration::ZERO,
                calls: Mutex::new(HashMap::new()),
                in_flight: Arc::default(),
                max_in_flight: Arc::default(),
            }
        }
    }

    impl FakeProbe {
        fn with(mut self, d: u8, r: Reach) -> Self {
            self.script.insert(ip(d), r);
            self
        }
        fn open(self, d: u8, ms: u64) -> Self {
            self.with(d, Reach::Open { ms })
        }
        fn calls(&self, d: u8) -> usize {
            self.calls.lock().unwrap().get(&ip(d)).copied().unwrap_or(0)
        }
    }

    impl HostProbe for FakeProbe {
        fn reach(&self, addr: SocketAddrV4, _wait: Duration) -> impl Future<Output = Reach> + Send {
            *self.calls.lock().unwrap().entry(*addr.ip()).or_default() += 1;
            let reach = self.script.get(addr.ip()).copied().unwrap_or(self.default);
            let delay = self.delays.get(addr.ip()).copied().unwrap_or(self.delay);
            let (cur, max) = (self.in_flight.clone(), self.max_in_flight.clone());
            async move {
                let _g = InFlight::enter(&cur, &max);
                if !delay.is_zero() {
                    tokio::time::sleep(delay).await;
                }
                reach
            }
        }
    }

    /// One host's unit-ID behaviour.
    #[derive(Clone, Default)]
    struct HostScript {
        /// Answer per unit, for every function code.
        answers: HashMap<u8, ProbeOutcome>,
        /// Every other unit; `None` is no reply.
        default: Option<ProbeOutcome>,
        refuse_connect: bool,
        /// Reads on this host that work before every read is a LinkError.
        link_error_after: Option<usize>,
        delay: Duration,
    }

    impl HostScript {
        fn answering(units: &[u8]) -> Self {
            Self {
                answers: units.iter().map(|&u| (u, ProbeOutcome::Value)).collect(),
                ..Default::default()
            }
        }
        fn all(o: ProbeOutcome) -> Self {
            Self { default: Some(o), ..Default::default() }
        }
    }

    #[derive(Default)]
    struct FakeFactory {
        hosts: HashMap<Ipv4Addr, HostScript>,
        default: HostScript,
        live: Arc<AtomicUsize>,
        max_live: Arc<AtomicUsize>,
    }

    impl FakeFactory {
        fn host(mut self, d: u8, s: HostScript) -> Self {
            self.hosts.insert(ip(d), s);
            self
        }
    }

    impl ConnectorFactory for FakeFactory {
        type C = FakeConnector;
        fn for_host(&self, addr: SocketAddrV4) -> FakeConnector {
            FakeConnector {
                script: self.hosts.get(addr.ip()).cloned().unwrap_or_else(|| self.default.clone()),
                reads: Arc::default(),
                live: self.live.clone(),
                max_live: self.max_live.clone(),
            }
        }
    }

    struct FakeConnector {
        script: HostScript,
        /// Reads on this host, over all its connections.
        reads: Arc<AtomicUsize>,
        live: Arc<AtomicUsize>,
        max_live: Arc<AtomicUsize>,
    }

    impl Connector for FakeConnector {
        type P = FakeProber;
        fn connect(&self) -> impl Future<Output = Result<FakeProber, String>> + Send {
            let result = if self.script.refuse_connect {
                Err("connection refused".to_string())
            } else {
                let n = self.live.fetch_add(1, Ordering::SeqCst) + 1;
                self.max_live.fetch_max(n, Ordering::SeqCst);
                Ok(FakeProber {
                    script: self.script.clone(),
                    reads: self.reads.clone(),
                    live: self.live.clone(),
                })
            };
            async move { result }
        }
    }

    struct FakeProber {
        script: HostScript,
        reads: Arc<AtomicUsize>,
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
            _function_code: u8,
            _wait: Duration,
        ) -> impl Future<Output = ProbeOutcome> + Send {
            let n = self.reads.fetch_add(1, Ordering::SeqCst);
            let outcome = if self.script.link_error_after.is_some_and(|k| n >= k) {
                ProbeOutcome::LinkError("reset".into())
            } else {
                self.script
                    .answers
                    .get(&unit)
                    .cloned()
                    .or_else(|| self.script.default.clone())
                    .unwrap_or(ProbeOutcome::NoReply)
            };
            let delay = self.script.delay;
            async move {
                if !delay.is_zero() {
                    tokio::time::sleep(delay).await;
                }
                outcome
            }
        }
    }

    #[derive(Clone, Debug)]
    #[allow(dead_code)] // payloads are kept for Debug output of failed assertions
    enum Ev {
        Found(ScanFound),
        Progress(ScanProgress),
        Notice(ScanNotice),
        Host(ScanHost),
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
        fn host(&self, e: ScanHost) {
            self.events.lock().unwrap().push(Ev::Host(e));
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
        fn hosts(&self) -> Vec<ScanHost> {
            self.events
                .iter()
                .filter_map(|e| if let Ev::Host(h) = e { Some(h.clone()) } else { None })
                .collect()
        }
        fn opened(&self) -> Vec<ScanHost> {
            self.hosts().into_iter().filter(|h| h.status == HostStatus::Open).collect()
        }
        /// The host's final (not `open`) status event; there is at most one.
        fn final_of(&self, d: u8) -> Option<ScanHost> {
            let target = target(d);
            let finals: Vec<ScanHost> = self
                .hosts()
                .into_iter()
                .filter(|h| h.host == target && h.status != HostStatus::Open)
                .collect();
            assert!(finals.len() <= 1, "{target}: {finals:?}");
            finals.into_iter().next()
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
        /// Index of the first event matching `f`.
        fn first(&self, f: impl Fn(&Ev) -> bool) -> Option<usize> {
            self.events.iter().position(f)
        }
        fn last(&self, f: impl Fn(&Ev) -> bool) -> Option<usize> {
            self.events.iter().rposition(f)
        }
    }

    // ---------- helpers ----------

    fn ip(d: u8) -> Ipv4Addr {
        Ipv4Addr::new(10, 0, 0, d)
    }

    fn target(d: u8) -> String {
        format!("10.0.0.{d}:502")
    }

    fn range_scan(
        addresses: std::ops::RangeInclusive<u8>,
        units: std::ops::RangeInclusive<u8>,
    ) -> ValidScan {
        ValidScan {
            scan_id: "r1".into(),
            kind: ScanKind::TcpRange,
            units: units.collect(),
            probe: ProbeKind::Holding,
            wait: Duration::from_millis(200),
            retries: 0,
            ports: vec![],
            combos: vec![],
            tcp: Some(TcpTarget { host: String::new(), port: 502 }),
            concurrency: 1,
            hosts: addresses.map(ip).collect(),
            host_concurrency: 64,
            connect_wait: Duration::from_millis(300),
        }
    }

    async fn run_with(
        scan: ValidScan,
        probe: Arc<FakeProbe>,
        factory: Arc<FakeFactory>,
        cancel: Cancel,
    ) -> Run {
        let sink = Arc::new(RecordingSink::default());
        let done = run_range_scan(scan, "ws1".into(), probe, factory, sink.clone(), cancel).await;
        let events = sink.events.lock().unwrap().clone();
        assert!(
            !events.iter().any(|e| matches!(e, Ev::Done(_))),
            "run_range_scan leaves done to its caller"
        );
        assert_eq!(done.workspace, "ws1");
        assert_eq!(done.scan_id, "r1");
        Run { done, events }
    }

    async fn run(scan: ValidScan, probe: Arc<FakeProbe>, factory: Arc<FakeFactory>) -> Run {
        let (_tx, cancel) = cancel_pair();
        run_with(scan, probe, factory, cancel).await
    }

    fn cancel_after(ms: u64) -> Cancel {
        let (tx, cancel) = cancel_pair();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(ms)).await;
            let _ = tx.send(true);
        });
        cancel
    }

    fn is_unit_check(e: &Ev) -> bool {
        matches!(e, Ev::Found(_)) || matches!(e, Ev::Progress(p) if p.phase == ScanPhase::Units)
    }

    // ---------- stage 1 ----------

    #[tokio::test(start_paused = true)]
    async fn stage_one_finds_open_hosts_live() {
        let mut probe = FakeProbe { delay: Duration::from_millis(300), ..Default::default() }
            .open(3, 4)
            .open(7, 9)
            .with(5, Reach::Refused);
        // Open hosts answer at once; the timed-out ones take the whole wait.
        probe.delays = HashMap::from([(ip(3), Duration::ZERO), (ip(7), Duration::ZERO)]);
        let r = run(range_scan(1..=10, 1..=3), Arc::new(probe), Arc::new(FakeFactory::default())).await;

        let opened = r.opened();
        let opened: Vec<(String, Option<u64>)> =
            opened.iter().map(|h| (h.host.clone(), h.connect_ms)).collect();
        assert_eq!(opened, vec![(target(3), Some(4)), (target(7), Some(9))]);
        let last_open = r.last(|e| matches!(e, Ev::Host(h) if h.status == HostStatus::Open)).unwrap();
        let first_check = r.first(is_unit_check).expect("unit checks ran");
        assert!(last_open < first_check, "open events come before any unit check");
        let stage_one_end = r
            .first(|e| matches!(e, Ev::Progress(p) if p.phase == ScanPhase::Hosts && p.checked == p.total))
            .unwrap();
        assert!(last_open < stage_one_end, "open hosts are reported while stage 1 runs");
        for d in [3, 7] {
            let fin = r.final_of(d).expect("final status");
            assert_eq!(fin.status, HostStatus::NoModbus);
            let at = r.first(|e| matches!(e, Ev::Host(h) if h.host == target(d) && h.status != HostStatus::Open));
            assert!(at.unwrap() > last_open);
        }
        assert_eq!(r.hosts().len(), 4, "nothing listed for refused or timed-out addresses");
        assert_eq!(r.done.reason, "completed");
        assert_eq!(r.done.checked, 6, "unit checks only");
    }

    #[tokio::test(start_paused = true)]
    async fn host_concurrency_respected() {
        let probe = Arc::new(FakeProbe { delay: Duration::from_millis(50), ..Default::default() });
        let mut scan = range_scan(1..=40, 1..=3);
        scan.host_concurrency = 8;
        let r = run(scan, probe.clone(), Arc::new(FakeFactory::default())).await;
        assert_eq!(probe.max_in_flight.load(Ordering::SeqCst), 8);
        assert!((1..=40).all(|d| probe.calls(d) == 2));
        assert_eq!(probe.in_flight.load(Ordering::SeqCst), 0);
        assert_eq!(r.done.reason, "completed");
    }

    #[tokio::test(start_paused = true)]
    async fn timed_out_connect_is_retried_refused_is_not() {
        let probe = Arc::new(FakeProbe::default().with(2, Reach::Refused).open(3, 1));
        let mut scan = range_scan(1..=3, 1..=2);
        scan.retries = 1;
        run(scan, probe.clone(), Arc::new(FakeFactory::default())).await;
        assert_eq!(probe.calls(1), 2, "timed out: tried again");
        assert_eq!(probe.calls(2), 1, "refused is final");
        assert_eq!(probe.calls(3), 1, "open at once");
    }

    #[tokio::test(start_paused = true)]
    async fn stage_one_retries_timeouts_at_least_once_even_with_zero_retries() {
        let probe = Arc::new(FakeProbe::default().with(2, Reach::Refused).open(3, 1));
        let scan = range_scan(1..=3, 1..=2);
        assert_eq!(scan.retries, 0);
        run(scan, probe.clone(), Arc::new(FakeFactory::default())).await;
        assert_eq!(probe.calls(1), 2, "timed out: tried once more");
        assert_eq!(probe.calls(2), 1, "refused is final");
    }

    #[tokio::test(start_paused = true)]
    async fn empty_range_completes_with_notice() {
        let probe = FakeProbe { default: Reach::Refused, ..Default::default() };
        let r = run(range_scan(1..=5, 1..=10), Arc::new(probe), Arc::new(FakeFactory::default())).await;
        assert_eq!(r.notices(), vec!["No host answered on port 502 in this range".to_string()]);
        assert!(r.hosts().is_empty());
        assert_eq!(r.done.reason, "completed");
        assert_eq!(r.done.error, None);
        assert_eq!((r.done.checked, r.done.found), (0, 0));
    }

    #[tokio::test(start_paused = true)]
    async fn cancel_in_stage_one_is_prompt() {
        let probe = Arc::new(FakeProbe { delay: Duration::from_secs(5), ..Default::default() });
        let t0 = tokio::time::Instant::now();
        let r = run_with(
            range_scan(1..=40, 1..=10),
            probe.clone(),
            Arc::new(FakeFactory::default()),
            cancel_after(10),
        )
        .await;
        assert!(t0.elapsed() < Duration::from_millis(100), "elapsed {:?}", t0.elapsed());
        assert_eq!(r.done.reason, "cancelled");
        assert_eq!(probe.in_flight.load(Ordering::SeqCst), 0, "in-flight attempts dropped");
        assert!(probe.max_in_flight.load(Ordering::SeqCst) > 1);
        assert!(r.hosts().is_empty());
        assert_eq!(r.done.checked, 0);
    }

    // ---------- stage 2 ----------

    #[tokio::test(start_paused = true)]
    async fn stage_two_scans_each_host_with_statuses() {
        let probe = FakeProbe::default().open(1, 1).open(2, 1).open(3, 1).open(4, 1);
        let factory = FakeFactory::default()
            .host(1, HostScript::answering(&[1]))
            .host(2, HostScript::all(ProbeOutcome::Value))
            .host(3, HostScript::all(ProbeOutcome::Exception(0x0B)))
            .host(4, HostScript::default());
        let mut scan = range_scan(1..=4, 1..=20);
        scan.concurrency = 2;
        let r = run(scan, Arc::new(probe), Arc::new(factory)).await;

        let a = r.final_of(1).unwrap();
        assert_eq!((a.status, a.found, a.gateway), (HostStatus::Devices, 1, false));
        let b = r.final_of(2).unwrap();
        assert_eq!(b.status, HostStatus::AnswersAll);
        assert!(b.found >= 16, "found {}", b.found);
        let c = r.final_of(3).unwrap();
        assert_eq!((c.status, c.found, c.gateway), (HostStatus::Gateway, 0, true));
        let d = r.final_of(4).unwrap();
        assert_eq!((d.status, d.found, d.gateway), (HostStatus::NoModbus, 0, false));
        assert!([&a, &b, &c, &d].iter().all(|h| h.connect_ms == Some(1)));
        assert_eq!(r.done.found, 1 + b.found);
        assert_eq!(r.done.reason, "completed");
        assert_eq!(r.done.error, None);
    }

    #[tokio::test(start_paused = true)]
    async fn non_modbus_host_is_no_modbus() {
        let probe = FakeProbe::default().open(1, 2);
        let factory = FakeFactory::default()
            .host(1, HostScript { refuse_connect: true, ..Default::default() });
        let r = run(range_scan(1..=1, 1..=10), Arc::new(probe), Arc::new(factory)).await;
        let h = r.final_of(1).unwrap();
        assert_eq!((h.status, h.found, h.gateway), (HostStatus::NoModbus, 0, false));
        assert_eq!(r.done.reason, "completed", "a failed host does not fail the scan");
        assert_eq!(r.done.error, None);
    }

    #[tokio::test(start_paused = true)]
    async fn lost_after_replies_is_lost() {
        let probe = FakeProbe::default().open(1, 2);
        let factory = FakeFactory::default()
            .host(1, HostScript { link_error_after: Some(1), ..HostScript::answering(&[1]) });
        let r = run(range_scan(1..=1, 1..=10), Arc::new(probe), Arc::new(factory)).await;
        let h = r.final_of(1).unwrap();
        assert_eq!((h.status, h.found), (HostStatus::Lost, 1));
        assert_eq!(r.done.reason, "completed");
        assert_eq!(r.done.found, 1);
    }

    #[tokio::test(start_paused = true)]
    async fn at_most_four_hosts_in_stage_two() {
        let probe = FakeProbe { default: Reach::Open { ms: 1 }, ..Default::default() };
        let factory = Arc::new(FakeFactory {
            default: HostScript { delay: Duration::from_millis(50), ..Default::default() },
            ..Default::default()
        });
        let r = run(range_scan(1..=10, 1..=3), Arc::new(probe), factory.clone()).await;
        // One connection per host (parallel checks 1), so live connections
        // are hosts being scanned.
        assert_eq!(factory.max_live.load(Ordering::SeqCst), 4);
        assert_eq!(factory.live.load(Ordering::SeqCst), 0);
        assert!((1..=10).all(|d| r.final_of(d).is_some()));
        assert_eq!(r.done.checked, 30);
    }

    #[tokio::test(start_paused = true)]
    async fn notices_are_prefixed_with_the_host() {
        let probe = FakeProbe::default().open(9, 1);
        let factory = FakeFactory::default().host(9, HostScript::all(ProbeOutcome::Exception(0x0B)));
        let r = run(range_scan(1..=10, 1..=5), Arc::new(probe), Arc::new(factory)).await;
        let notices = r.notices();
        assert_eq!(notices.len(), 1, "{notices:?}");
        assert!(notices[0].starts_with("10.0.0.9:502: "), "{}", notices[0]);
        assert!(notices[0].ends_with("Gateway detected; scanning 1 at a time"), "{}", notices[0]);
    }

    #[tokio::test(start_paused = true)]
    async fn progress_phases() {
        let probe = FakeProbe { default: Reach::Refused, ..Default::default() }.open(4, 1).open(2, 1);
        let factory = FakeFactory::default()
            .host(2, HostScript::answering(&[3]))
            .host(4, HostScript::answering(&[1, 5]));
        let r = run(range_scan(1..=6, 1..=5), Arc::new(probe), Arc::new(factory)).await;
        let progress = r.progress();
        let split = progress.iter().position(|p| p.phase == ScanPhase::Units).expect("stage 2");
        let (hosts, units) = progress.split_at(split);
        assert!(!hosts.is_empty());
        assert!(hosts.iter().all(|p| p.phase == ScanPhase::Hosts
            && p.total == 6
            && p.current.unit_id == 0
            && p.host_index.is_none()
            && p.host_count.is_none()));
        let last = hosts.last().unwrap();
        assert_eq!((last.checked, last.total), (6, 6));
        assert!(units.iter().all(|p| p.phase == ScanPhase::Units
            && p.total == 10
            && p.host_count == Some(2)));
        for p in units {
            let index = if p.current.target == target(2) { 1 } else { 2 };
            assert_eq!(p.host_index, Some(index), "{p:?}");
        }
        assert_eq!(units.last().unwrap().checked, 10);
        assert_eq!((r.done.checked, r.done.found), (10, 3));
    }

    #[tokio::test(start_paused = true)]
    async fn cancel_in_stage_two_is_prompt() {
        let probe = FakeProbe::default().open(1, 1).open(2, 1).open(3, 1);
        let factory = Arc::new(FakeFactory {
            default: HostScript { delay: Duration::from_secs(5), ..Default::default() },
            ..Default::default()
        });
        let mut scan = range_scan(1..=3, 1..=50);
        scan.concurrency = 4;
        let t0 = tokio::time::Instant::now();
        let r = run_with(scan, Arc::new(probe), factory.clone(), cancel_after(10)).await;
        assert!(t0.elapsed() < Duration::from_millis(100), "elapsed {:?}", t0.elapsed());
        assert_eq!(r.done.reason, "cancelled");
        assert_eq!(factory.live.load(Ordering::SeqCst), 0, "connections dropped");
        assert!(factory.max_live.load(Ordering::SeqCst) > 0, "stage 2 had started");
        assert!(
            (1..=3).all(|d| r.final_of(d).is_none()),
            "an interrupted host gets no final status: {:?}",
            r.hosts()
        );
    }

    /// Real time on a multi-thread runtime, so reach tasks, host scans and
    /// their worker pools race for real.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn range_scan_multi_thread_reports_every_host_once() {
        let mut probe = FakeProbe { default: Reach::Refused, delay: Duration::from_millis(1), ..Default::default() };
        let open: Vec<u8> = (1..=30).filter(|d| d % 3 == 0).collect();
        for &d in &open {
            probe = probe.open(d, u64::from(d));
        }
        let factory = Arc::new(FakeFactory {
            default: HostScript { delay: Duration::from_millis(1), ..HostScript::answering(&[2, 7]) },
            ..Default::default()
        });
        let mut scan = range_scan(1..=30, 1..=20);
        scan.host_concurrency = 8;
        scan.concurrency = 4;
        let r = run(scan, Arc::new(probe), factory.clone()).await;

        let mut opened: Vec<String> = r.opened().into_iter().map(|h| h.host).collect();
        opened.sort();
        let mut expected: Vec<String> = open.iter().map(|&d| target(d)).collect();
        expected.sort();
        assert_eq!(opened, expected, "each open host reported open once");
        for &d in &open {
            let fin = r.final_of(d).expect("final status");
            assert_eq!((fin.status, fin.found), (HostStatus::Devices, 2), "{fin:?}");
        }
        let n = open.len() as u64;
        assert_eq!((r.done.checked, r.done.found), (20 * n, 2 * n));
        assert_eq!(r.done.reason, "completed");
        let units: Vec<ScanProgress> =
            r.progress().into_iter().filter(|p| p.phase == ScanPhase::Units).collect();
        assert!(units.windows(2).all(|w| w[0].checked < w[1].checked));
        assert_eq!(units.last().map(|p| (p.checked, p.total)), Some((20 * n, 20 * n)));
        assert_eq!(factory.live.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn host_events_serialize_camel_case() {
        let h = ScanHost {
            workspace: "w".into(),
            scan_id: "s".into(),
            host: "10.0.0.1:502".into(),
            status: HostStatus::AnswersAll,
            connect_ms: Some(3),
            found: 2,
            gateway: false,
        };
        let v = serde_json::to_value(&h).unwrap();
        assert_eq!(v["scanId"], "s");
        assert_eq!(v["connectMs"], 3);
        assert_eq!(v["status"], "answersAll");
        let no_modbus = serde_json::to_value(HostStatus::NoModbus).unwrap();
        assert_eq!(no_modbus, "noModbus");
        assert_eq!(serde_json::to_value(ScanPhase::Hosts).unwrap(), "hosts");
        let p = ScanProgress {
            workspace: "w".into(),
            scan_id: "s".into(),
            checked: 1,
            total: 2,
            current: crate::slave_scan::engine::ScanCurrent {
                target: "10.0.0.1:502".into(),
                unit_id: 1,
                settings: None,
            },
            phase: ScanPhase::Units,
            host_index: Some(1),
            host_count: Some(3),
        };
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!((v["phase"].clone(), v["hostIndex"].clone(), v["hostCount"].clone()),
                   ("units".into(), 1.into(), 3.into()));
    }
}
