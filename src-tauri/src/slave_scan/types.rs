//! Pure, AppHandle-free types and logic for the slave scanner.

use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

const SERIAL_MAX_UNIT: u32 = 247;
const TCP_MAX_UNIT: u32 = 255;
const MIN_WAIT_MS: u64 = 20;
const MAX_WAIT_MS: u64 = 5000;
const MAX_RETRIES: u8 = 3;
const DEFAULT_TCP_CONCURRENCY: u8 = 4;
const MAX_TCP_CONCURRENCY: u8 = 32;
const MAX_SCAN_ID_LEN: usize = 64;
const PARITIES: [&str; 3] = ["none", "even", "odd"];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScanKind {
    Serial,
    Tcp,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProbeKind {
    Holding,
    Input,
    HoldingThenInput,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialParams {
    pub baud: u32,
    /// "none" | "even" | "odd"
    pub parity: String,
    pub data_bits: u8,
    pub stop_bits: u8,
    /// Passed through as the app stores it; only checked to be non-empty.
    pub flow_control: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sweep {
    pub bauds: Vec<u32>,
    pub parities: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TcpTarget {
    pub host: String,
    pub port: u16,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRequest {
    pub scan_id: String,
    pub kind: ScanKind,
    pub start_unit_id: u16,
    pub quantity: u16,
    pub probe: ProbeKind,
    pub wait_ms: u64,
    pub retries: u8,
    pub ports: Vec<String>,
    pub serial: Option<SerialParams>,
    pub sweep: Option<Sweep>,
    pub tcp: Option<TcpTarget>,
    pub concurrency: Option<u8>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ValidScan {
    pub scan_id: String,
    pub kind: ScanKind,
    pub units: Vec<u8>,
    pub probe: ProbeKind,
    pub wait: Duration,
    pub retries: u8,
    pub ports: Vec<String>,
    pub combos: Vec<SerialParams>,
    pub tcp: Option<TcpTarget>,
    /// 1 for serial scans; concurrency applies only to TCP.
    pub concurrency: usize,
}

fn check_parity(p: &str) -> Result<(), String> {
    if PARITIES.contains(&p) {
        Ok(())
    } else {
        Err(format!("parity must be one of none, even, odd (got \"{p}\")"))
    }
}

pub fn validate(req: &ScanRequest) -> Result<ValidScan, String> {
    if req.scan_id.is_empty() || req.scan_id.chars().count() > MAX_SCAN_ID_LEN {
        return Err(format!("scanId must be 1–{MAX_SCAN_ID_LEN} characters"));
    }
    if req.quantity == 0 {
        return Err("quantity must be at least 1".into());
    }
    if !(MIN_WAIT_MS..=MAX_WAIT_MS).contains(&req.wait_ms) {
        return Err(format!("waitMs must be within {MIN_WAIT_MS}–{MAX_WAIT_MS}"));
    }
    if req.retries > MAX_RETRIES {
        return Err(format!("retries must be within 0–{MAX_RETRIES}"));
    }

    let (min_unit, max_unit, range_msg) = match req.kind {
        ScanKind::Serial => (1, SERIAL_MAX_UNIT, "start/quantity must stay within 1–247 for serial"),
        ScanKind::Tcp => (0, TCP_MAX_UNIT, "start/quantity must stay within 0–255 for TCP"),
    };
    let start = u32::from(req.start_unit_id);
    let last = start + u32::from(req.quantity) - 1; // quantity >= 1; u32 cannot overflow
    if start < min_unit || last > max_unit {
        return Err(range_msg.into());
    }
    // Both ends are <= 255 after the check above, so the narrowing is lossless.
    let units: Vec<u8> = (start..=last).map(|u| u as u8).collect();

    let mut ports = Vec::new();
    let mut combos = Vec::new();
    let mut tcp = None;
    let concurrency;

    match req.kind {
        ScanKind::Serial => {
            if req.ports.is_empty() {
                return Err("ports must contain at least one serial port".into());
            }
            for (i, p) in req.ports.iter().enumerate() {
                if p.trim().is_empty() {
                    return Err("ports must not contain empty names".into());
                }
                if req.ports[..i].contains(p) {
                    return Err(format!("ports contains a duplicate: {p}"));
                }
            }
            ports = req.ports.clone();
            let base = req
                .serial
                .as_ref()
                .ok_or_else(|| "serial parameters are required for a serial scan".to_string())?;
            if base.baud == 0 {
                return Err("serial.baud must be greater than 0".into());
            }
            check_parity(&base.parity)?;
            if !(5..=8).contains(&base.data_bits) {
                return Err("serial.dataBits must be within 5–8".into());
            }
            if !(1..=2).contains(&base.stop_bits) {
                return Err("serial.stopBits must be within 1–2".into());
            }
            if base.flow_control.is_empty() {
                return Err("serial.flowControl must not be empty".into());
            }
            match &req.sweep {
                None => combos.push(base.clone()),
                Some(sw) => {
                    if sw.bauds.is_empty() {
                        return Err("sweep.bauds must not be empty".into());
                    }
                    if sw.parities.is_empty() {
                        return Err("sweep.parities must not be empty".into());
                    }
                    if sw.bauds.contains(&0) {
                        return Err("sweep.bauds must be greater than 0".into());
                    }
                    for p in &sw.parities {
                        check_parity(p)?;
                    }
                    for &baud in &sw.bauds {
                        for parity in &sw.parities {
                            combos.push(SerialParams { baud, parity: parity.clone(), ..base.clone() });
                        }
                    }
                }
            }
            concurrency = 1;
        }
        ScanKind::Tcp => {
            let t = req
                .tcp
                .as_ref()
                .ok_or_else(|| "tcp target is required for a TCP scan".to_string())?;
            if t.host.trim().is_empty() {
                return Err("tcp.host must not be empty".into());
            }
            if t.port == 0 {
                return Err("tcp.port must be within 1–65535".into());
            }
            tcp = Some(t.clone());
            let c = req.concurrency.unwrap_or(DEFAULT_TCP_CONCURRENCY);
            if !(1..=MAX_TCP_CONCURRENCY).contains(&c) {
                return Err(format!("concurrency must be within 1–{MAX_TCP_CONCURRENCY}"));
            }
            concurrency = usize::from(c);
        }
    }

    Ok(ValidScan {
        scan_id: req.scan_id.clone(),
        kind: req.kind,
        units,
        probe: req.probe,
        wait: Duration::from_millis(req.wait_ms),
        retries: req.retries,
        ports,
        combos,
        tcp,
        concurrency,
    })
}

#[derive(Clone, Debug, PartialEq)]
pub enum ProbeOutcome {
    Value,
    /// Serial: the unit answered an earlier request late (same unit, other
    /// function code), so it is there.
    LateReply,
    Exception(u8),
    NoReply,
    Garbled(String),
    LinkError(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Category {
    Found,
    Garbled,
    GatewayNoDevice,
}

/// Maps a probe outcome to a result row; `None` means nothing was found.
pub fn classify(o: &ProbeOutcome) -> Option<(Category, String)> {
    match o {
        ProbeOutcome::Value => Some((Category::Found, "reply".into())),
        ProbeOutcome::LateReply => Some((Category::Found, "late reply".into())),
        ProbeOutcome::Exception(c @ (0x0A | 0x0B)) => {
            Some((Category::GatewayNoDevice, format!("gateway exception 0x{c:02X}")))
        }
        ProbeOutcome::Exception(c) => Some((Category::Found, format!("exception 0x{c:02X}"))),
        ProbeOutcome::Garbled(s) => Some((Category::Garbled, s.clone())),
        ProbeOutcome::NoReply | ProbeOutcome::LinkError(_) => None,
    }
}

pub fn probe_order(kind: ProbeKind) -> &'static [u8] {
    match kind {
        ProbeKind::Holding => &[3],
        ProbeKind::Input => &[4],
        ProbeKind::HoldingThenInput => &[3, 4],
    }
}

pub fn format_settings(p: &SerialParams) -> String {
    let letter = match p.parity.as_str() {
        "even" => 'E',
        "odd" => 'O',
        _ => 'N',
    };
    format!("{} {}{}{}", p.baud, p.data_bits, letter, p.stop_bits)
}

/// Rate-limits progress events; `force` always passes.
pub struct ProgressThrottle {
    min_gap: Duration,
    last: Option<Instant>,
}

impl ProgressThrottle {
    pub fn new(min_gap: Duration) -> Self {
        Self { min_gap, last: None }
    }

    pub fn should_emit(&mut self, now: Instant, force: bool) -> bool {
        let due = match self.last {
            None => true,
            Some(l) => now.saturating_duration_since(l) >= self.min_gap,
        };
        if force || due {
            self.last = Some(now);
            true
        } else {
            false
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FloodVerdict {
    Continue,
    AllFound,
    AllGarbled,
}

/// Detects a bus that answers every address identically: `threshold`
/// identical leading categories (Found or Garbled) in a row. Any miss or
/// mixed category disarms it for the rest of the scan.
pub struct FloodGuard {
    threshold: usize,
    count: usize,
    kind: Option<Category>,
    disarmed: bool,
}

impl FloodGuard {
    pub fn new(threshold: usize) -> Self {
        Self { threshold, count: 0, kind: None, disarmed: false }
    }

    pub fn record(&mut self, c: Option<Category>) -> FloodVerdict {
        if self.disarmed {
            return FloodVerdict::Continue;
        }
        let cat = match c {
            Some(cat @ (Category::Found | Category::Garbled)) => cat,
            _ => {
                self.disarmed = true;
                return FloodVerdict::Continue;
            }
        };
        match self.kind {
            None => self.kind = Some(cat),
            Some(k) if k != cat => {
                self.disarmed = true;
                return FloodVerdict::Continue;
            }
            Some(_) => {}
        }
        self.count += 1;
        if self.count >= self.threshold {
            self.disarmed = true;
            return if cat == Category::Found {
                FloodVerdict::AllFound
            } else {
                FloodVerdict::AllGarbled
            };
        }
        FloodVerdict::Continue
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn params() -> SerialParams {
        SerialParams {
            baud: 9600,
            parity: "none".into(),
            data_bits: 8,
            stop_bits: 1,
            flow_control: "none".into(),
        }
    }

    fn serial_req() -> ScanRequest {
        ScanRequest {
            scan_id: "s1".into(),
            kind: ScanKind::Serial,
            start_unit_id: 1,
            quantity: 247,
            probe: ProbeKind::Holding,
            wait_ms: 200,
            retries: 0,
            ports: vec!["COM3".into()],
            serial: Some(params()),
            sweep: None,
            tcp: None,
            concurrency: None,
        }
    }

    fn tcp_req() -> ScanRequest {
        ScanRequest {
            kind: ScanKind::Tcp,
            start_unit_id: 0,
            quantity: 10,
            ports: vec![],
            serial: None,
            tcp: Some(TcpTarget { host: "127.0.0.1".into(), port: 502 }),
            ..serial_req()
        }
    }

    #[test]
    fn validate_defaults_serial() {
        let v = validate(&serial_req()).unwrap();
        assert_eq!(v.units.len(), 247);
        assert_eq!(v.units[0], 1);
        assert_eq!(*v.units.last().unwrap(), 247);
        assert_eq!(v.combos, vec![params()]);
        assert_eq!(v.concurrency, 1);
    }

    #[test]
    fn validate_rejects_serial_unit_zero() {
        let mut r = serial_req();
        r.start_unit_id = 0;
        assert!(validate(&r).unwrap_err().contains("1–247"));
    }

    #[test]
    fn validate_rejects_range_overflow() {
        let mut r = serial_req();
        r.start_unit_id = 240;
        r.quantity = 10;
        assert!(validate(&r).is_err());
        let mut t = tcp_req();
        t.start_unit_id = 250;
        t.quantity = 6;
        assert!(validate(&t).is_ok());
        t.quantity = 7;
        assert!(validate(&t).is_err());
    }

    #[test]
    fn validate_bounds() {
        let mut r = serial_req();
        r.quantity = 1;
        for (w, ok) in [(19, false), (20, true), (5000, true), (5001, false)] {
            r.wait_ms = w;
            assert_eq!(validate(&r).is_ok(), ok, "wait {w}");
        }
        r.wait_ms = 200;
        r.retries = 4;
        assert!(validate(&r).is_err());
        r.retries = 3;
        assert!(validate(&r).is_ok());
        r.quantity = 0;
        assert!(validate(&r).is_err());
        r.quantity = 1;
        r.scan_id = String::new();
        assert!(validate(&r).is_err());
        r.scan_id = "x".repeat(65);
        assert!(validate(&r).is_err());
        r.scan_id = "x".repeat(64);
        assert!(validate(&r).is_ok());

        let mut t = tcp_req();
        t.concurrency = Some(0);
        assert!(validate(&t).is_err());
        t.concurrency = Some(33);
        assert!(validate(&t).is_err());
        t.concurrency = Some(32);
        assert_eq!(validate(&t).unwrap().concurrency, 32);
        t.concurrency = None;
        assert_eq!(validate(&t).unwrap().concurrency, 4);
    }

    #[test]
    fn validate_serial_requires_ports_and_params() {
        let mut r = serial_req();
        r.ports = vec![];
        assert!(validate(&r).is_err());
        r.ports = vec!["COM3".into(), "COM3".into()];
        assert!(validate(&r).is_err());
        let mut r = serial_req();
        r.serial = None;
        assert!(validate(&r).is_err());
    }

    #[test]
    fn validate_sweep_builds_combos() {
        let mut r = serial_req();
        r.serial = Some(SerialParams {
            data_bits: 7,
            stop_bits: 2,
            flow_control: "hardware".into(),
            ..params()
        });
        r.sweep = Some(Sweep {
            bauds: vec![9600, 19200],
            parities: vec!["none".into(), "even".into()],
        });
        let v = validate(&r).unwrap();
        let got: Vec<(u32, &str)> = v.combos.iter().map(|c| (c.baud, c.parity.as_str())).collect();
        assert_eq!(got, vec![(9600, "none"), (9600, "even"), (19200, "none"), (19200, "even")]);
        assert!(v
            .combos
            .iter()
            .all(|c| c.data_bits == 7 && c.stop_bits == 2 && c.flow_control == "hardware"));

        r.sweep = Some(Sweep { bauds: vec![], parities: vec!["none".into()] });
        assert!(validate(&r).is_err());
        r.sweep = Some(Sweep { bauds: vec![9600], parities: vec![] });
        assert!(validate(&r).is_err());
        r.sweep = Some(Sweep { bauds: vec![9600], parities: vec!["mark".into()] });
        assert!(validate(&r).is_err());
    }

    #[test]
    fn validate_tcp_requires_target() {
        assert!(validate(&tcp_req()).is_ok());
        let mut t = tcp_req();
        t.tcp = None;
        assert!(validate(&t).is_err());
        let mut t = tcp_req();
        t.tcp = Some(TcpTarget { host: String::new(), port: 502 });
        assert!(validate(&t).is_err());
        let mut t = tcp_req();
        t.tcp = Some(TcpTarget { host: "h".into(), port: 0 });
        assert!(validate(&t).is_err());
    }

    #[test]
    fn classify_rules() {
        assert_eq!(classify(&ProbeOutcome::Value), Some((Category::Found, "reply".to_string())));
        assert_eq!(
            classify(&ProbeOutcome::Exception(2)),
            Some((Category::Found, "exception 0x02".to_string()))
        );
        assert_eq!(classify(&ProbeOutcome::Exception(0x0B)).unwrap().0, Category::GatewayNoDevice);
        assert_eq!(classify(&ProbeOutcome::Exception(0x0A)).unwrap().0, Category::GatewayNoDevice);
        assert_eq!(classify(&ProbeOutcome::NoReply), None);
        assert_eq!(
            classify(&ProbeOutcome::Garbled("x".into())),
            Some((Category::Garbled, "x".to_string()))
        );
        assert_eq!(classify(&ProbeOutcome::LinkError("e".into())), None);
        assert_eq!(
            classify(&ProbeOutcome::LateReply),
            Some((Category::Found, "late reply".to_string()))
        );
    }

    #[test]
    fn format_settings_letters() {
        let p = SerialParams { baud: 19200, parity: "even".into(), ..params() };
        assert_eq!(format_settings(&p), "19200 8E1");
        let p = SerialParams { stop_bits: 2, ..params() };
        assert_eq!(format_settings(&p), "9600 8N2");
    }

    #[test]
    fn throttle_min_gap() {
        let t0 = Instant::now();
        let mut t = ProgressThrottle::new(Duration::from_millis(100));
        assert!(t.should_emit(t0, false));
        assert!(!t.should_emit(t0 + Duration::from_millis(50), false));
        assert!(t.should_emit(t0 + Duration::from_millis(100), false));
        assert!(t.should_emit(t0 + Duration::from_millis(101), true));
    }

    #[test]
    fn flood_guard() {
        let mut g = FloodGuard::new(16);
        for _ in 0..15 {
            assert_eq!(g.record(Some(Category::Found)), FloodVerdict::Continue);
        }
        assert_eq!(g.record(Some(Category::Found)), FloodVerdict::AllFound);

        let mut g = FloodGuard::new(16);
        for _ in 0..15 {
            g.record(Some(Category::Found));
        }
        assert_eq!(g.record(None), FloodVerdict::Continue);
        for _ in 0..40 {
            assert_eq!(g.record(Some(Category::Found)), FloodVerdict::Continue);
        }

        let mut g = FloodGuard::new(16);
        for _ in 0..15 {
            assert_eq!(g.record(Some(Category::Garbled)), FloodVerdict::Continue);
        }
        assert_eq!(g.record(Some(Category::Garbled)), FloodVerdict::AllGarbled);
    }

    #[test]
    fn probe_order_values() {
        assert_eq!(probe_order(ProbeKind::Holding), &[3]);
        assert_eq!(probe_order(ProbeKind::Input), &[4]);
        assert_eq!(probe_order(ProbeKind::HoldingThenInput), &[3, 4]);
    }
}
