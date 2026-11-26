//! Real transports for the scan engine: serial RTU through `tokio_serial`
//! and Modbus TCP through `tokio_modbus`.

use std::collections::HashMap;
use std::future::Future;
use std::io;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::task::{Context, Poll};
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::TcpStream;
use tokio::time::timeout;
use tokio_modbus::client::{self, Reader};
use tokio_modbus::slave::SlaveContext;
use tokio_modbus::{Error, ProtocolError, Slave};
use tokio_serial::SerialPortBuilderExt;

use super::engine::{Connector, OpenError, Opener, Prober};
use super::types::{format_settings, ProbeOutcome, SerialParams};
use crate::modbus::{
    parse_serial_data_bits, parse_serial_flow_control, parse_serial_parity,
    parse_serial_stop_bits,
};

/// Bounds the blocking serial open. The open is not raced against cancel,
/// so this also bounds how long a cancel can wait on it.
const OPEN_TIMEOUT: Duration = Duration::from_secs(5);

// ---------- byte counting ----------

/// Passes I/O through, adding every byte read to a shared counter, so a
/// timed-out check can tell silence from noise.
#[derive(Debug)]
pub struct CountingStream<T> {
    inner: T,
    bytes_read: Arc<AtomicU64>,
}

impl<T> CountingStream<T> {
    pub fn new(inner: T, bytes_read: Arc<AtomicU64>) -> Self {
        Self { inner, bytes_read }
    }
}

impl<T: AsyncRead + Unpin> AsyncRead for CountingStream<T> {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        let before = buf.filled().len();
        let res = Pin::new(&mut this.inner).poll_read(cx, buf);
        if let Poll::Ready(Ok(())) = res {
            let n = buf.filled().len().saturating_sub(before);
            this.bytes_read.fetch_add(n as u64, Ordering::SeqCst);
        }
        res
    }
}

impl<T: AsyncWrite + Unpin> AsyncWrite for CountingStream<T> {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.get_mut().inner).poll_write(cx, buf)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_shutdown(cx)
    }

    fn poll_write_vectored(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bufs: &[io::IoSlice<'_>],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.get_mut().inner).poll_write_vectored(cx, bufs)
    }

    fn is_write_vectored(&self) -> bool {
        self.inner.is_write_vectored()
    }
}

// ---------- shared request/reply handling ----------

/// The unit that sent a reply, from tokio-modbus's header-mismatch message
/// ("expected/request = Header { slave_id: 4 }, actual/response = Header {
/// slave_id: 9 }"). `None` if the message has another shape.
fn replying_unit(message: &str) -> Option<u8> {
    let (_, actual) = message.split_once("actual/response")?;
    let (_, rest) = actual.split_once("slave_id:")?;
    let digits: String = rest.trim_start().chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

/// Maps a tokio-modbus reply to a probe outcome (timeouts are handled by
/// the caller; `TcpProber` handles a mismatched reply itself, so the
/// protocol errors here are serial ones).
fn outcome_of(reply: tokio_modbus::Result<()>) -> ProbeOutcome {
    match reply {
        Ok(Ok(())) => ProbeOutcome::Value,
        Ok(Err(code)) => ProbeOutcome::Exception(u8::from(code)),
        // The RTU header (the unit) matched, only the function differs: the
        // unit is there and answered an earlier request late.
        Err(Error::Protocol(ProtocolError::FunctionCodeMismatch { .. })) => ProbeOutcome::LateReply,
        Err(Error::Protocol(ProtocolError::HeaderMismatch { message, .. })) => {
            ProbeOutcome::Garbled(match replying_unit(&message) {
                Some(u) => format!("reply from unit {u}"),
                None => "reply from another unit".to_string(),
            })
        }
        Err(Error::Transport(e)) if e.kind() == io::ErrorKind::InvalidData => {
            ProbeOutcome::Garbled("CRC or framing error".to_string())
        }
        Err(Error::Transport(e)) => ProbeOutcome::LinkError(e.to_string()),
    }
}

/// Windows `ERROR_OPERATION_ABORTED`: an overlapped read was cancelled, not a lost link.
const ERROR_OPERATION_ABORTED: i32 = 995;

fn is_aborted(reply: &tokio_modbus::Result<()>) -> bool {
    matches!(reply, Err(Error::Transport(e)) if e.raw_os_error() == Some(ERROR_OPERATION_ABORTED))
}

fn is_decode_error(reply: &tokio_modbus::Result<()>) -> bool {
    matches!(reply, Err(Error::Transport(e)) if e.kind() == io::ErrorKind::InvalidData)
}

/// An open stream that more than one client context can be attached to in
/// turn (only one uses it at a time). The lock is only taken inside `poll_*`,
/// never across an `.await`.
#[derive(Debug)]
struct SharedStream<T>(Arc<Mutex<T>>);

impl<T> SharedStream<T> {
    fn new(inner: T) -> Self {
        Self(Arc::new(Mutex::new(inner)))
    }

    fn lock(&self) -> MutexGuard<'_, T> {
        // A poisoned stream is still a stream; the next request reports any
        // real I/O failure.
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

impl<T> Clone for SharedStream<T> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

impl<T: AsyncRead + Unpin> AsyncRead for SharedStream<T> {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut *self.lock()).poll_read(cx, buf)
    }
}

impl<T: AsyncWrite + Unpin> AsyncWrite for SharedStream<T> {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut *self.lock()).poll_write(cx, buf)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut *self.lock()).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut *self.lock()).poll_shutdown(cx)
    }
}

/// One open port or connection, reused for many unit IDs.
struct Session {
    ctx: client::Context,
    /// Builds a fresh client context on the same open stream.
    attach: Box<dyn Fn() -> client::Context + Send>,
}

impl Session {
    fn new(attach: Box<dyn Fn() -> client::Context + Send>) -> Self {
        Self { ctx: attach(), attach }
    }

    async fn read_one(&mut self, function_code: u8) -> tokio_modbus::Result<()> {
        match function_code {
            3 => self.ctx.read_holding_registers(0, 1).await.map(|r| r.map(drop)),
            4 => self.ctx.read_input_registers(0, 1).await.map(|r| r.map(drop)),
            fc => Err(Error::Transport(io::Error::new(
                io::ErrorKind::Unsupported,
                format!("function code {fc} is not a scan probe"),
            ))),
        }
    }

    async fn request(&mut self, unit: u8, function_code: u8) -> tokio_modbus::Result<()> {
        self.ctx.set_slave(Slave(unit));
        let mut reply = self.read_one(function_code).await;
        if is_aborted(&reply) {
            // Windows aborted the read that was waiting on the port (os error
            // 995) — some USB-serial drivers do that when the port's settings
            // change. The link is fine: start clean and ask this unit once more.
            self.ctx = (self.attach)();
            self.ctx.set_slave(Slave(unit));
            reply = self.read_one(function_code).await;
        }
        if is_decode_error(&reply) {
            // After a decode error tokio-util's `Framed` ends its stream once,
            // so the next request would fail as if the link were gone. A
            // fresh context on the same stream starts clean, and drops the
            // rest of the bad frame with the old read buffer.
            self.ctx = (self.attach)();
        }
        reply
    }
}

// ---------- serial ----------

fn serial_builder(port: &str, params: &SerialParams) -> Result<tokio_serial::SerialPortBuilder, String> {
    Ok(tokio_serial::new(port, params.baud)
        .parity(parse_serial_parity(Some(params.parity.clone()))?)
        .data_bits(parse_serial_data_bits(Some(i64::from(params.data_bits)))?)
        .stop_bits(parse_serial_stop_bits(Some(i64::from(params.stop_bits)))?)
        .flow_control(parse_serial_flow_control(Some(params.flow_control.clone()))?))
}

/// Pauses before each new try when Windows says a port is still in use.
/// Closing a COM port finishes asynchronously, so reopening it straight away
/// (next sweep setting, or right after the shared session let it go) can be
/// refused for a moment with "Access is denied".
const BUSY_PORT_RETRY: [Duration; 5] = [
    Duration::from_millis(50),
    Duration::from_millis(100),
    Duration::from_millis(200),
    Duration::from_millis(400),
    Duration::from_millis(800),
];

/// "Access is denied" — the port is still held, by us (closing) or by someone else.
fn port_busy(e: &tokio_serial::Error) -> bool {
    e.kind() == tokio_serial::ErrorKind::Io(io::ErrorKind::PermissionDenied)
}

/// Runs `attempt`, and while it fails because the port is busy, tries again
/// after each pause in `pauses`. Any other result is returned at once.
async fn retry_while_busy<T, F, Fut>(mut attempt: F, pauses: &[Duration]) -> Result<T, OpenError>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<Result<T, tokio_serial::Error>, OpenError>>,
{
    let mut pauses = pauses.iter();
    loop {
        match attempt().await? {
            Ok(v) => return Ok(v),
            Err(e) if port_busy(&e) => match pauses.next() {
                Some(pause) => tokio::time::sleep(*pause).await,
                None => return Err(OpenError::Failed(e.to_string())),
            },
            Err(e) => return Err(OpenError::Failed(e.to_string())),
        }
    }
}

/// Opens the scan's serial ports: each port once, re-configured for every
/// further sweep setting (see [`PortCache`]). Dropping it closes the ports.
pub struct SerialOpener {
    cache: PortCache<tokio_serial::SerialStream>,
}

impl SerialOpener {
    pub fn new() -> Self {
        Self { cache: PortCache::new() }
    }
}

impl Default for SerialOpener {
    fn default() -> Self {
        Self::new()
    }
}

/// Opens `port` at `params` on the blocking pool, retrying while Windows still reports it busy.
async fn open_serial(port: String, params: SerialParams) -> Result<tokio_serial::SerialStream, OpenError> {
    let builder = serial_builder(&port, &params).map_err(OpenError::Failed)?;
    retry_while_busy(
        || {
            let builder = builder.clone();
            let port = port.clone();
            async move {
                // If the wait runs out, the blocking open still finishes on
                // its own and the stream it returns is dropped, closing the port.
                timeout(
                    OPEN_TIMEOUT,
                    tokio::task::spawn_blocking(move || builder.open_native_async()),
                )
                .await
                .map_err(|_| OpenError::TimedOut(format!("timed out opening {port}")))?
                .map_err(|e| OpenError::Failed(format!("port open task failed: {e}")))
            }
        },
        &BUSY_PORT_RETRY,
    )
    .await
}

impl Opener for SerialOpener {
    type P = SerialProber;

    fn open(
        &self,
        port: &str,
        params: &SerialParams,
    ) -> impl Future<Output = Result<SerialProber, OpenError>> + Send {
        let port = port.to_string();
        let params = params.clone();
        async move {
            let reconfig_params = params.clone();
            let open_port = port.clone();
            self.cache
                .prober(
                    &port,
                    move |stream| reconfigure_serial(stream, &reconfig_params),
                    move || open_serial(open_port, params),
                )
                .await
        }
    }
}

/// One open serial port at fixed settings.
pub struct SerialProber {
    session: Session,
    bytes_read: Arc<AtomicU64>,
}

impl SerialProber {
    /// Speaks Modbus RTU over `stream`, counting the bytes that come back.
    #[cfg(test)]
    pub fn attach<T>(stream: T) -> Self
    where
        T: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        let bytes_read = Arc::new(AtomicU64::new(0));
        let shared = SharedStream::new(CountingStream::new(stream, bytes_read.clone()));
        Self::over(shared, bytes_read)
    }

    /// Speaks Modbus RTU over an already shared stream (a port kept open across sweep settings).
    fn over<T>(shared: SharedStream<CountingStream<T>>, bytes_read: Arc<AtomicU64>) -> Self
    where
        T: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        let attach = move || client::rtu::attach_slave(shared.clone(), Slave(1));
        Self { session: Session::new(Box::new(attach)), bytes_read }
    }
}

/// A port the scanner opened, kept until the scan ends.
type OpenPort<T> = (SharedStream<CountingStream<T>>, Arc<AtomicU64>);

/// Hands out probers for serial ports. The first setting opens the port; every
/// later setting on the same port re-configures the open port instead of
/// closing and re-opening it. On Windows a closed COM port is released
/// asynchronously (and some USB adapters take seconds), so an immediate
/// re-open is refused with "Access is denied". Ports close when the opener is
/// dropped, i.e. when the scan ends.
struct PortCache<T> {
    ports: Mutex<HashMap<String, OpenPort<T>>>,
}

impl<T> PortCache<T>
where
    T: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    fn new() -> Self {
        Self { ports: Mutex::new(HashMap::new()) }
    }

    fn cached(&self, port: &str) -> Option<OpenPort<T>> {
        let ports = self.ports.lock().unwrap_or_else(|e| e.into_inner());
        ports.get(port).map(|(s, b)| (s.clone(), b.clone()))
    }

    fn keep(&self, port: &str, open: OpenPort<T>) {
        let mut ports = self.ports.lock().unwrap_or_else(|e| e.into_inner());
        ports.insert(port.to_string(), open);
    }

    /// A prober for `port` at `params`: re-configures a port already open
    /// (via `reconfigure`), otherwise opens it (via `open`) and keeps it.
    async fn prober<R, O, Fut>(
        &self,
        port: &str,
        reconfigure: R,
        open: O,
    ) -> Result<SerialProber, OpenError>
    where
        R: FnOnce(&mut T) -> Result<(), String>,
        O: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, OpenError>>,
    {
        if let Some((shared, bytes_read)) = self.cached(port) {
            reconfigure(&mut shared.lock().inner).map_err(OpenError::Failed)?;
            return Ok(SerialProber::over(shared, bytes_read));
        }
        let stream = open().await?;
        let bytes_read = Arc::new(AtomicU64::new(0));
        let shared = SharedStream::new(CountingStream::new(stream, bytes_read.clone()));
        self.keep(port, (shared.clone(), bytes_read.clone()));
        Ok(SerialProber::over(shared, bytes_read))
    }
}

/// Applies `params` to an open port.
///
/// It deliberately does not purge the port's buffers: on Windows that aborts
/// the read already waiting on the port (os error 995). Stray bytes from the
/// previous setting don't matter, because the Modbus client empties its read
/// buffer before every request.
fn reconfigure_serial(stream: &mut tokio_serial::SerialStream, params: &SerialParams) -> Result<(), String> {
    use tokio_serial::SerialPort;
    let setting = |e: tokio_serial::Error| format!("could not apply {}: {e}", format_settings(params));
    stream.set_baud_rate(params.baud).map_err(setting)?;
    stream
        .set_parity(parse_serial_parity(Some(params.parity.clone()))?)
        .map_err(setting)?;
    stream
        .set_data_bits(parse_serial_data_bits(Some(i64::from(params.data_bits)))?)
        .map_err(setting)?;
    stream
        .set_stop_bits(parse_serial_stop_bits(Some(i64::from(params.stop_bits)))?)
        .map_err(setting)?;
    stream
        .set_flow_control(parse_serial_flow_control(Some(params.flow_control.clone()))?)
        .map_err(setting)?;
    Ok(())
}

impl Prober for SerialProber {
    fn read(
        &mut self,
        unit: u8,
        function_code: u8,
        wait: Duration,
    ) -> impl Future<Output = ProbeOutcome> + Send {
        async move {
            let before = self.bytes_read.load(Ordering::SeqCst);
            match timeout(wait, self.session.request(unit, function_code)).await {
                Ok(reply) => outcome_of(reply),
                Err(_) => {
                    let n = self.bytes_read.load(Ordering::SeqCst).saturating_sub(before);
                    if n > 0 {
                        ProbeOutcome::Garbled(format!("{n} bytes received, no valid reply"))
                    } else {
                        ProbeOutcome::NoReply
                    }
                }
            }
        }
    }
}

// ---------- TCP ----------

/// Opens one Modbus TCP connection per scan worker.
///
/// The first connect tries each resolved address in order (the caller puts
/// IPv4 first); later connects go straight to the address that worked.
pub struct TcpConnector {
    addrs: Vec<SocketAddr>,
    connect_timeout: Duration,
    working: Arc<Mutex<Option<SocketAddr>>>,
}

impl TcpConnector {
    pub fn new(addrs: Vec<SocketAddr>, connect_timeout: Duration) -> Self {
        Self { addrs, connect_timeout, working: Arc::new(Mutex::new(None)) }
    }

    fn candidates(&self) -> Vec<SocketAddr> {
        let working = *self.working.lock().unwrap_or_else(|e| e.into_inner());
        working.map_or_else(|| self.addrs.clone(), |a| vec![a])
    }
}

async fn open_tcp_session(addr: SocketAddr, limit: Duration) -> Result<Session, String> {
    let stream = timeout(limit, TcpStream::connect(addr))
        .await
        .map_err(|_| format!("timed out after {} ms", limit.as_millis()))?
        .map_err(|e| e.to_string())?;
    let shared = SharedStream::new(stream);
    let attach = move || client::tcp::attach_slave(shared.clone(), Slave(1));
    Ok(Session::new(Box::new(attach)))
}

impl Connector for TcpConnector {
    type P = TcpProber;

    fn connect(&self) -> impl Future<Output = Result<TcpProber, String>> + Send {
        let candidates = self.candidates();
        let connect_timeout = self.connect_timeout;
        let working = self.working.clone();
        async move {
            let mut last_error = "no address to connect to".to_string();
            for addr in candidates {
                match open_tcp_session(addr, connect_timeout).await {
                    Ok(session) => {
                        *working.lock().unwrap_or_else(|e| e.into_inner()) = Some(addr);
                        return Ok(TcpProber { addr, connect_timeout, session: Some(session) });
                    }
                    Err(e) => last_error = e,
                }
            }
            Err(last_error)
        }
    }
}

/// One TCP worker's connection, reused for many unit IDs.
///
/// After a timeout or a reply that does not match the request, a reply may
/// still be on its way (gateways answer only after their own serial
/// timeout), and it would be read as the answer to the next request. So the
/// connection is dropped and a fresh one opened before the next check.
pub struct TcpProber {
    addr: SocketAddr,
    connect_timeout: Duration,
    /// `None` only between dropping a dirty connection and reconnecting.
    session: Option<Session>,
}

/// Pauses before each extra reconnect attempt. Single-connection devices and
/// gateways can take a moment to free the slot of the connection just
/// dropped.
const RECONNECT_BACKOFF: [Duration; 3] =
    [Duration::from_millis(100), Duration::from_millis(250), Duration::from_millis(500)];

impl TcpProber {
    /// Opens a fresh connection: one attempt, then one more after each
    /// backoff pause, each bounded by the connect timeout. The pauses are
    /// async sleeps, and the engine races every read against cancel, so a
    /// cancel drops this at once.
    async fn reconnect(&mut self) -> Result<(), String> {
        self.session = None;
        let mut last_error = String::new();
        for pause in std::iter::once(Duration::ZERO).chain(RECONNECT_BACKOFF) {
            if !pause.is_zero() {
                tokio::time::sleep(pause).await;
            }
            match open_tcp_session(self.addr, self.connect_timeout).await {
                Ok(session) => {
                    self.session = Some(session);
                    return Ok(());
                }
                Err(e) => last_error = e,
            }
        }
        Err(format!("reconnect failed: {last_error}"))
    }
}

impl Prober for TcpProber {
    fn read(
        &mut self,
        unit: u8,
        function_code: u8,
        wait: Duration,
    ) -> impl Future<Output = ProbeOutcome> + Send {
        async move {
            if self.session.is_none() {
                if let Err(e) = self.reconnect().await {
                    return ProbeOutcome::LinkError(e);
                }
            }
            let Some(session) = self.session.as_mut() else {
                return ProbeOutcome::LinkError("not connected".to_string());
            };
            match timeout(wait, session.request(unit, function_code)).await {
                // A mismatched reply is a stale answer to an earlier request.
                Ok(Err(Error::Protocol(_))) | Err(_) => {}
                Ok(reply) => return outcome_of(reply),
            }
            // Reconnect now rather than on the next read, so the next check's
            // response time does not include the connect.
            match self.reconnect().await {
                Ok(()) => ProbeOutcome::NoReply,
                Err(e) => ProbeOutcome::LinkError(e),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slave_scan::engine::{
        cancel_pair, run_scan, ScanDone, ScanFound, ScanHost, ScanNotice, ScanProgress, ScanSink,
    };
    use crate::slave_scan::types::{Category, ProbeKind, ScanKind, TcpTarget, ValidScan};
    use std::future;
    use std::net::SocketAddr;
    use std::sync::Mutex;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio_modbus::prelude::*;
    use tokio_modbus::server::tcp::{accept_tcp_connection, Server};
    use tokio_modbus::server::Service;

    fn busy() -> tokio_serial::Error {
        tokio_serial::Error::new(
            tokio_serial::ErrorKind::Io(io::ErrorKind::PermissionDenied),
            "Access is denied.",
        )
    }

    #[tokio::test]
    async fn a_port_is_opened_once_and_reconfigured_for_later_settings() {
        // A sweep must not close and re-open the port between settings (Windows
        // refuses the re-open while the old handle is still being released).
        let cache: PortCache<tokio::io::DuplexStream> = PortCache::new();
        let opens = Arc::new(AtomicU64::new(0));
        let reconfigs = Arc::new(AtomicU64::new(0));
        let mut ends = Vec::new();
        for _ in 0..3 {
            let (o, r) = (opens.clone(), reconfigs.clone());
            let (a, b) = tokio::io::duplex(64);
            ends.push(b);
            let prober = cache
                .prober(
                    "COM14",
                    move |_s| {
                        r.fetch_add(1, Ordering::SeqCst);
                        Ok(())
                    },
                    move || {
                        o.fetch_add(1, Ordering::SeqCst);
                        async move { Ok(a) }
                    },
                )
                .await;
            assert!(prober.is_ok());
            drop(prober); // the engine drops each setting's prober before the next
        }
        assert_eq!(opens.load(Ordering::SeqCst), 1);
        assert_eq!(reconfigs.load(Ordering::SeqCst), 2);

        // A different port is opened on its own.
        let (a, _b) = tokio::io::duplex(64);
        let other = cache.prober("COM5", |_s| Ok(()), move || async move { Ok(a) }).await;
        assert!(other.is_ok());
        assert_eq!(cache.ports.lock().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn a_setting_the_port_rejects_is_an_open_error() {
        let cache: PortCache<tokio::io::DuplexStream> = PortCache::new();
        let (a, _b) = tokio::io::duplex(64);
        assert!(cache.prober("COM14", |_s| Ok(()), move || async move { Ok(a) }).await.is_ok());
        let second = cache
            .prober(
                "COM14",
                |_s| Err("could not apply 1200 8N1: unsupported".to_string()),
                || async { Err::<tokio::io::DuplexStream, _>(OpenError::Failed("must not reopen".into())) },
            )
            .await;
        assert!(matches!(second, Err(OpenError::Failed(ref m)) if m.contains("could not apply 1200 8N1")));
        // The port stays open for the next setting.
        assert_eq!(cache.ports.lock().unwrap().len(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn busy_port_is_retried_until_it_opens() {
        // The second sweep setting reopens the port while Windows is still closing it.
        let tries = Arc::new(AtomicU64::new(0));
        let t = tries.clone();
        let opened = retry_while_busy(
            move || {
                let n = t.fetch_add(1, Ordering::SeqCst);
                async move { Ok(if n < 2 { Err(busy()) } else { Ok("port") }) }
            },
            &BUSY_PORT_RETRY,
        )
        .await;
        assert_eq!(opened.ok(), Some("port"));
        assert_eq!(tries.load(Ordering::SeqCst), 3);
    }

    #[tokio::test(start_paused = true)]
    async fn other_open_errors_are_not_retried() {
        let tries = Arc::new(AtomicU64::new(0));
        let t = tries.clone();
        let opened: Result<&str, OpenError> = retry_while_busy(
            move || {
                t.fetch_add(1, Ordering::SeqCst);
                async {
                    Ok(Err(tokio_serial::Error::new(
                        tokio_serial::ErrorKind::NoDevice,
                        "The system cannot find the file specified.",
                    )))
                }
            },
            &BUSY_PORT_RETRY,
        )
        .await;
        assert!(matches!(opened, Err(OpenError::Failed(ref m)) if m.contains("cannot find")));
        assert_eq!(tries.load(Ordering::SeqCst), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn a_port_that_stays_busy_fails_after_the_last_pause() {
        // Held by another program: give up with the OS message after the pauses run out.
        let tries = Arc::new(AtomicU64::new(0));
        let t = tries.clone();
        let opened: Result<&str, OpenError> = retry_while_busy(
            move || {
                t.fetch_add(1, Ordering::SeqCst);
                async { Ok(Err(busy())) }
            },
            &BUSY_PORT_RETRY,
        )
        .await;
        assert!(matches!(opened, Err(OpenError::Failed(ref m)) if m.contains("Access is denied")));
        assert_eq!(tries.load(Ordering::SeqCst), 1 + BUSY_PORT_RETRY.len() as u64);
    }

    const WAIT: Duration = Duration::from_millis(100);

    /// Unit 3 holds a value, unit 4 has no such register, unit 150 answers
    /// like a gateway only after 150 ms, unit 200 never answers, and every
    /// other unit gets a gateway "no device" exception.
    #[derive(Clone)]
    struct TestService;

    type Reply = Result<Option<Response>, ExceptionCode>;

    impl Service for TestService {
        type Request = SlaveRequest<'static>;
        type Response = Option<Response>;
        type Exception = ExceptionCode;
        type Future = Pin<Box<dyn Future<Output = Reply> + Send>>;

        fn call(&self, req: SlaveRequest<'static>) -> Self::Future {
            let reply: Reply = match (req.slave, req.request) {
                (3, Request::ReadHoldingRegisters(_, n)) => {
                    Ok(Some(Response::ReadHoldingRegisters(vec![42; usize::from(n)])))
                }
                (3, _) => Err(ExceptionCode::IllegalFunction),
                (4, _) => Err(ExceptionCode::IllegalDataAddress),
                (150, Request::ReadHoldingRegisters(_, n)) => {
                    return Box::pin(async move {
                        tokio::time::sleep(Duration::from_millis(150)).await;
                        Ok(Some(Response::ReadHoldingRegisters(vec![7; usize::from(n)])))
                    });
                }
                (200, _) => Ok(None),
                _ => Err(ExceptionCode::GatewayTargetDevice),
            };
            Box::pin(future::ready(reply))
        }
    }

    async fn start_server() -> SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("local addr");
        let server = Server::new(listener);
        tokio::spawn(async move {
            let new_service = |_addr: SocketAddr| Ok(Some(TestService));
            let on_connected = move |stream, socket_addr| async move {
                accept_tcp_connection(stream, socket_addr, new_service)
            };
            let on_error = |err| log::error!("test server error: {err}");
            let _ = server.serve(&on_connected, on_error).await;
        });
        addr
    }

    fn connector(addr: SocketAddr) -> TcpConnector {
        connector_with(addr, Duration::from_secs(2))
    }

    fn connector_with(addr: SocketAddr, connect_timeout: Duration) -> TcpConnector {
        TcpConnector::new(vec![addr], connect_timeout)
    }

    #[tokio::test]
    async fn tcp_prober_against_in_process_server() {
        let addr = start_server().await;
        let mut p = connector(addr).connect().await.expect("connect");
        assert_eq!(p.read(3, 3, WAIT).await, ProbeOutcome::Value);
        assert_eq!(p.read(4, 3, WAIT).await, ProbeOutcome::Exception(2));
        assert_eq!(p.read(9, 3, WAIT).await, ProbeOutcome::Exception(0x0B));
        assert_eq!(p.read(3, 4, WAIT).await, ProbeOutcome::Exception(1));
    }

    #[tokio::test]
    async fn tcp_prober_timeout_is_no_reply() {
        let addr = start_server().await;
        let mut p = connector(addr).connect().await.expect("connect");
        assert_eq!(p.read(200, 3, Duration::from_millis(30)).await, ProbeOutcome::NoReply);
        assert_eq!(p.read(3, 3, WAIT).await, ProbeOutcome::Value, "connection still usable");
    }

    #[tokio::test]
    async fn tcp_late_reply_is_not_read_as_the_next_units_answer() {
        let addr = start_server().await;
        let mut p = connector(addr).connect().await.expect("connect");
        // Unit 150 answers after 150 ms, well past the wait.
        assert_eq!(p.read(150, 3, Duration::from_millis(40)).await, ProbeOutcome::NoReply);
        // On the old connection unit 150's late reply would arrive first and
        // be taken for unit 3's (or block it); the prober reconnected instead.
        assert_eq!(p.read(3, 3, WAIT).await, ProbeOutcome::Value);
        assert_eq!(p.read(4, 3, WAIT).await, ProbeOutcome::Exception(2));
    }

    /// A raw server that answers unit 1 with the wrong transaction id and
    /// every other unit correctly; counts the connections it accepts.
    async fn start_mismatch_server() -> (SocketAddr, Arc<AtomicU64>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let accepted = Arc::new(AtomicU64::new(0));
        let count = accepted.clone();
        tokio::spawn(async move {
            while let Ok((mut s, _)) = listener.accept().await {
                count.fetch_add(1, Ordering::SeqCst);
                tokio::spawn(async move {
                    let mut req = [0u8; 12];
                    while s.read_exact(&mut req).await.is_ok() {
                        let tid = if req[6] == 1 { req[1].wrapping_add(5) } else { req[1] };
                        let reply = [req[0], tid, 0, 0, 0, 5, req[6], 3, 2, 0, 42];
                        if s.write_all(&reply).await.is_err() {
                            return;
                        }
                    }
                });
            }
        });
        (addr, accepted)
    }

    #[tokio::test]
    async fn tcp_mismatched_reply_is_no_reply_and_reconnects() {
        let (addr, accepted) = start_mismatch_server().await;
        let mut p = connector(addr).connect().await.expect("connect");
        assert_eq!(p.read(1, 3, WAIT).await, ProbeOutcome::NoReply);
        assert_eq!(p.read(2, 3, WAIT).await, ProbeOutcome::Value);
        assert_eq!(p.read(3, 3, WAIT).await, ProbeOutcome::Value);
        // The server may count an accept a moment after the client connected.
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(
            accepted.load(Ordering::SeqCst),
            2,
            "the dirty connection was replaced once; clean replies keep it"
        );
    }

    #[tokio::test]
    async fn tcp_reconnect_failure_is_a_link_error() {
        // Accepts one connection that never answers, then stops listening.
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (s, _) = listener.accept().await.unwrap();
            drop(listener);
            tokio::time::sleep(Duration::from_secs(5)).await;
            drop(s);
        });
        let c = connector_with(addr, Duration::from_millis(300));
        let mut p = c.connect().await.expect("connect");
        match p.read(1, 3, Duration::from_millis(30)).await {
            ProbeOutcome::LinkError(e) => assert!(e.starts_with("reconnect failed"), "{e}"),
            other => panic!("expected LinkError, got {other:?}"),
        }
    }

    /// A listener that can be closed and reopened on the same port while
    /// accepted connections stay open.
    fn reusable_listener(addr: SocketAddr) -> TcpListener {
        let socket = tokio::net::TcpSocket::new_v4().expect("socket");
        socket.set_reuseaddr(true).expect("reuseaddr");
        socket.bind(addr).expect("bind");
        socket.listen(16).expect("listen")
    }

    /// Answers every request with a valid FC03 value.
    async fn answer_all(mut s: TcpStream) {
        let mut req = [0u8; 12];
        while s.read_exact(&mut req).await.is_ok() {
            let reply = [req[0], req[1], 0, 0, 0, 5, req[6], 3, 2, 0, 42];
            if s.write_all(&reply).await.is_err() {
                return;
            }
        }
    }

    /// F1: a single-connection device or gateway may not have freed its slot
    /// yet when the prober reconnects. The first reconnect is refused (nothing
    /// listens), a later one is accepted, and the scan goes on.
    #[tokio::test]
    async fn tcp_reconnect_is_retried() {
        let first = reusable_listener("127.0.0.1:0".parse().unwrap());
        let addr = first.local_addr().unwrap();
        tokio::spawn(async move {
            // The first connection never answers, so the check times out.
            let (silent, _) = first.accept().await.unwrap();
            drop(first);
            tokio::time::sleep(Duration::from_millis(60)).await;
            let again = reusable_listener(addr);
            while let Ok((s, _)) = again.accept().await {
                tokio::spawn(answer_all(s));
            }
            drop(silent);
        });
        let mut p = connector_with(addr, Duration::from_millis(300)).connect().await.expect("connect");
        assert_eq!(p.read(1, 3, Duration::from_millis(30)).await, ProbeOutcome::NoReply);
        assert_eq!(p.read(2, 3, WAIT).await, ProbeOutcome::Value, "next unit found");
    }

    #[tokio::test]
    async fn tcp_connect_failure_is_an_error() {
        // Bind then drop, so nothing listens on the port.
        let addr = TcpListener::bind("127.0.0.1:0").await.unwrap().local_addr().unwrap();
        // Windows retries a refused localhost connect for ~2 s; the timeout
        // bounds it either way.
        let c = connector_with(addr, Duration::from_millis(300));
        assert!(c.connect().await.is_err());
    }

    /// A raw server whose first reply has a bad MBAP protocol id and whose
    /// later replies are valid FC03 answers.
    async fn start_bad_then_good_server() -> SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut s, _) = listener.accept().await.unwrap();
            let mut first = true;
            loop {
                let mut req = [0u8; 12];
                if s.read_exact(&mut req).await.is_err() {
                    return;
                }
                let proto: [u8; 2] = if first { [0x12, 0x34] } else { [0, 0] };
                first = false;
                let reply = [req[0], req[1], proto[0], proto[1], 0, 5, req[6], 3, 2, 0, 42];
                if s.write_all(&reply).await.is_err() {
                    return;
                }
            }
        });
        addr
    }

    #[tokio::test]
    async fn tcp_prober_recovers_after_a_framing_error() {
        let addr = start_bad_then_good_server().await;
        let mut p = connector(addr).connect().await.expect("connect");
        assert_eq!(
            p.read(1, 3, WAIT).await,
            ProbeOutcome::Garbled("CRC or framing error".into())
        );
        // tokio-util ends the framed stream once after a decode error; the
        // prober must not mistake that for a lost connection.
        assert_eq!(p.read(2, 3, WAIT).await, ProbeOutcome::Value);
        assert_eq!(p.read(3, 3, WAIT).await, ProbeOutcome::Value);
    }

    fn crc16(data: &[u8]) -> u16 {
        let mut crc = 0xFFFFu16;
        for &b in data {
            crc ^= u16::from(b);
            for _ in 0..8 {
                crc = if crc & 1 != 0 { (crc >> 1) ^ 0xA001 } else { crc >> 1 };
            }
        }
        crc
    }

    fn rtu_frame(body: &[u8]) -> Vec<u8> {
        let mut f = body.to_vec();
        f.extend_from_slice(&crc16(body).to_le_bytes());
        f
    }

    /// Plays one RTU device on the far end of a duplex pipe. For each 8-byte
    /// request, `reply` decides what goes back (nothing for an empty Vec).
    fn rtu_device(reply: fn(u8, u8) -> Vec<u8>) -> SerialProber {
        let (ours, mut theirs) = tokio::io::duplex(256);
        tokio::spawn(async move {
            let mut req = [0u8; 8];
            while theirs.read_exact(&mut req).await.is_ok() {
                let out = reply(req[0], req[1]);
                if !out.is_empty() && theirs.write_all(&out).await.is_err() {
                    return;
                }
            }
        });
        SerialProber::attach(ours)
    }

    /// A stream whose first `aborts` reads fail with os error 995, like a
    /// Windows driver cancelling the pending read when port settings change.
    struct Aborting<T> {
        inner: T,
        aborts: u32,
    }

    impl<T: AsyncRead + Unpin> AsyncRead for Aborting<T> {
        fn poll_read(mut self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &mut ReadBuf<'_>) -> Poll<io::Result<()>> {
            if self.aborts > 0 {
                self.aborts -= 1;
                return Poll::Ready(Err(io::Error::from_raw_os_error(ERROR_OPERATION_ABORTED)));
            }
            Pin::new(&mut self.inner).poll_read(cx, buf)
        }
    }

    impl<T: AsyncWrite + Unpin> AsyncWrite for Aborting<T> {
        fn poll_write(mut self: Pin<&mut Self>, cx: &mut Context<'_>, b: &[u8]) -> Poll<io::Result<usize>> {
            Pin::new(&mut self.inner).poll_write(cx, b)
        }
        fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
            Pin::new(&mut self.inner).poll_flush(cx)
        }
        fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
            Pin::new(&mut self.inner).poll_shutdown(cx)
        }
    }

    /// An RTU device at unit 1 behind a stream that aborts its first `aborts` reads.
    fn aborting_device(aborts: u32) -> SerialProber {
        let (ours, mut theirs) = tokio::io::duplex(256);
        tokio::spawn(async move {
            let mut req = [0u8; 8];
            while theirs.read_exact(&mut req).await.is_ok() {
                if req[0] == 1 && theirs.write_all(&rtu_frame(&[1, req[1], 2, 0, 42])).await.is_err() {
                    return;
                }
            }
        });
        SerialProber::attach(Aborting { inner: ours, aborts })
    }

    #[tokio::test]
    async fn a_read_aborted_once_is_asked_again() {
        // The sweep's next setting: the driver aborted the waiting read (os error 995).
        let mut p = aborting_device(1);
        assert_eq!(p.read(1, 3, WAIT).await, ProbeOutcome::Value);
    }

    #[tokio::test]
    async fn a_port_that_keeps_aborting_is_a_link_error() {
        let mut p = aborting_device(u32::MAX);
        assert!(matches!(p.read(1, 3, WAIT).await, ProbeOutcome::LinkError(_)));
    }

    #[tokio::test]
    async fn serial_prober_maps_replies() {
        let mut p = rtu_device(|unit, fc| match unit {
            1 => rtu_frame(&[1, fc, 2, 0, 42]),
            2 => rtu_frame(&[2, fc | 0x80, 2]),
            3 => vec![0xFF, 0xFF, 0xFF],
            4 => rtu_frame(&[9, fc, 2, 0, 42]),
            // Same unit, other function: a late answer to an earlier request.
            6 => rtu_frame(&[6, if fc == 3 { 4 } else { 3 }, 2, 0, 42]),
            _ => vec![],
        });
        assert_eq!(p.read(1, 3, WAIT).await, ProbeOutcome::Value);
        assert_eq!(p.read(2, 3, WAIT).await, ProbeOutcome::Exception(2));
        assert_eq!(p.read(5, 3, Duration::from_millis(30)).await, ProbeOutcome::NoReply);
        assert_eq!(
            p.read(3, 3, Duration::from_millis(50)).await,
            ProbeOutcome::Garbled("3 bytes received, no valid reply".into())
        );
        assert_eq!(p.read(4, 3, WAIT).await, ProbeOutcome::Garbled("reply from unit 9".into()));
        // F11: the unit is there; it answered an earlier request late.
        assert_eq!(
            crate::slave_scan::types::classify(&p.read(6, 3, WAIT).await),
            Some((Category::Found, "late reply".to_string()))
        );
        assert_eq!(p.read(1, 4, WAIT).await, ProbeOutcome::Value, "port still usable");
    }

    #[tokio::test]
    async fn counting_stream_counts_bytes_read() {
        let (a, mut b) = tokio::io::duplex(64);
        let bytes = Arc::new(AtomicU64::new(0));
        let mut s = CountingStream::new(a, bytes.clone());
        b.write_all(b"hello").await.unwrap();
        let mut buf = [0u8; 5];
        s.read_exact(&mut buf).await.unwrap();
        s.write_all(b"xy").await.unwrap();
        assert_eq!(&buf, b"hello");
        assert_eq!(bytes.load(Ordering::SeqCst), 5, "writes are not counted");
    }

    #[derive(Default)]
    struct Recorder {
        found: Mutex<Vec<ScanFound>>,
        done: Mutex<Vec<ScanDone>>,
    }

    impl ScanSink for Recorder {
        fn found(&self, e: ScanFound) {
            self.found.lock().unwrap().push(e);
        }
        fn progress(&self, _e: ScanProgress) {}
        fn notice(&self, _e: ScanNotice) {}
        fn host(&self, _e: ScanHost) {}
        fn done(&self, e: ScanDone) {
            self.done.lock().unwrap().push(e);
        }
    }

    #[tokio::test]
    async fn run_scan_tcp_end_to_end() {
        let addr = start_server().await;
        let scan = ValidScan {
            scan_id: "e2e".into(),
            kind: ScanKind::Tcp,
            units: (1..=10).collect(),
            probe: ProbeKind::Holding,
            wait: WAIT,
            retries: 0,
            ports: vec![],
            combos: vec![],
            tcp: Some(TcpTarget { host: "127.0.0.1".into(), port: addr.port() }),
            concurrency: 4,
            hosts: vec![],
            host_concurrency: 0,
            connect_wait: Duration::ZERO,
        };
        let sink = Arc::new(Recorder::default());
        let (_tx, cancel) = cancel_pair();
        let done = run_scan(
            scan,
            "ws".into(),
            Arc::new(SerialOpener::new()),
            Some(Arc::new(connector(addr))),
            sink.clone(),
            cancel,
        )
        .await;

        assert_eq!(done.reason, "completed", "{done:?}");
        assert_eq!(done.checked, 10);
        assert_eq!(done.found, 2);
        let mut found: Vec<(u8, Category, String)> = sink
            .found
            .lock()
            .unwrap()
            .iter()
            .map(|f| (f.unit_id, f.category, f.detail.clone()))
            .collect();
        found.sort_by_key(|f| f.0);
        let units = |c: Category| -> Vec<u8> {
            found.iter().filter(|f| f.1 == c).map(|f| f.0).collect()
        };
        assert_eq!(units(Category::Found), vec![3, 4]);
        assert_eq!(units(Category::GatewayNoDevice), vec![1, 2, 5, 6, 7, 8, 9, 10]);
        assert_eq!(found[2], (3, Category::Found, "reply".to_string()));
        assert_eq!(found[3], (4, Category::Found, "exception 0x02".to_string()));
        assert_eq!(found[8], (9, Category::GatewayNoDevice, "gateway exception 0x0B".to_string()));
        assert!(sink.done.lock().unwrap().is_empty(), "the caller sends done");
    }
}
