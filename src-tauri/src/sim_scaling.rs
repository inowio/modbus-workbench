//! Engineering-unit scaling helpers for simulator registers.
//!
//! Engineering value = raw * scale + offset. Defaults (scale 1, offset 0)
//! must reproduce the pre-scaling behaviour exactly.

use std::collections::HashMap;

use crate::models::SimRegister;

const MAX_SAFE: f64 = 9_007_199_254_740_992.0; // 2^53

/// The shortest decimal that round-trips to the same f32 (230.6999969… → 230.7).
/// An f32 holds ~7 significant digits; decoding it to the nearest f64 would
/// otherwise surface float noise in rules and display. Non-finite values pass through.
pub fn f32_shortest(v: f64) -> f64 {
    if !v.is_finite() {
        return v;
    }
    format!("{}", v as f32).parse::<f64>().unwrap_or(v)
}

/// Engineering value for a raw register value.
pub fn eng_from_raw(raw: f64, scale: f64, offset: f64) -> f64 {
    raw * scale + offset
}

fn is_integer_type(data_type: &str) -> bool {
    matches!(data_type, "u16" | "i16" | "u32" | "i32" | "u64" | "i64" | "bool")
}

fn type_range(data_type: &str) -> Option<(f64, f64)> {
    match data_type {
        "u16" => Some((0.0, 65535.0)),
        "i16" => Some((-32768.0, 32767.0)),
        "u32" => Some((0.0, 4_294_967_295.0)),
        "i32" => Some((-2_147_483_648.0, 2_147_483_647.0)),
        "u64" => Some((0.0, MAX_SAFE)),
        "i64" => Some((-MAX_SAFE, MAX_SAFE)),
        "bool" => Some((0.0, 1.0)),
        _ => None,
    }
}

/// Raw register value for an engineering value: `(eng - offset) / scale`.
/// Integer types are rounded half-away-from-zero (except when scale == 1 and
/// offset == 0, where the identity is preserved) and clamped to the type's
/// range; float types are left unrounded. Scale 0 is treated as 1.
pub fn raw_from_eng(eng: f64, scale: f64, offset: f64, data_type: &str) -> f64 {
    let eng = if eng.is_finite() { eng } else { 0.0 };
    let scale = if scale == 0.0 { 1.0 } else { scale };
    let identity = scale == 1.0 && offset == 0.0;
    let mut raw = (eng - offset) / scale;
    if is_integer_type(data_type) && !identity {
        // Pre-round to 9 decimals so float noise (23.45/0.1 = 234.49999999999997)
        // doesn't flip a true half; f64::round is half-away-from-zero.
        raw = ((raw * 1e9).round() / 1e9).round();
    }
    match type_range(data_type) {
        Some((lo, hi)) => raw.clamp(lo, hi),
        None => raw,
    }
}

/// Decimal places of the shortest round-trip representation of `|x|`.
fn decimal_places(x: f64) -> usize {
    let x = x.abs();
    if !x.is_finite() {
        return 0;
    }
    match format!("{}", x).split_once('.') {
        Some((_, frac)) => frac.len(),
        None => 0,
    }
}

/// Number of decimals: explicit (clamped 0..=6), else for integer types the
/// larger of the decimal places of |scale| and of the offset (max 6), and 6 for
/// float types (display trims trailing zeros; this is the comparison precision).
pub fn effective_decimals(decimals: Option<i64>, scale: f64, offset: f64, data_type: &str) -> u32 {
    if let Some(d) = decimals {
        return d.clamp(0, 6) as u32;
    }
    if !is_integer_type(data_type) {
        return 6;
    }
    let s = scale.abs();
    let places = if !s.is_finite() || s == 0.0 { 0 } else { decimal_places(s) };
    places.max(decimal_places(offset)).min(6) as u32
}

/// Decimals rule comparisons round to (R7). Integer types: never coarser than
/// one raw step — max(explicit, automatic) — so explicit display decimals 0 on a
/// ×0.1 register don't turn "> 35.5" into "> 36". Float types: the explicit
/// decimals when set, else 6. Display keeps using `effective_decimals`.
pub fn compare_decimals(decimals: Option<i64>, scale: f64, offset: f64, data_type: &str) -> u32 {
    let explicit = effective_decimals(decimals, scale, offset, data_type);
    if is_integer_type(data_type) {
        explicit.max(effective_decimals(None, scale, offset, data_type))
    } else {
        explicit
    }
}

pub fn round_to(value: f64, decimals: u32) -> f64 {
    let f = 10f64.powi(decimals as i32);
    (value * f).round() / f
}

#[derive(Debug, Clone, PartialEq)]
pub struct RegMeta {
    pub data_type: String,
    pub byte_order: String,
    pub scale: f64,
    pub offset: f64,
    /// Decimals rule comparisons round to (not the display decimals).
    pub decimals: u32,
}

/// Keyed by (unit id, function code, start address).
pub type RegMetaMap = HashMap<(u8, u8, u16), RegMeta>;

pub fn build_reg_meta(regs: &[SimRegister]) -> RegMetaMap {
    let mut map = RegMetaMap::new();
    for r in regs {
        if !(0..=255).contains(&r.unit_id)
            || !(0..=255).contains(&r.function_code)
            || !(0..=65535).contains(&r.address)
        {
            continue;
        }
        let scale = r.scale.filter(|s| *s != 0.0 && s.is_finite()).unwrap_or(1.0);
        let offset = r.scale_offset.filter(|o| o.is_finite()).unwrap_or(0.0);
        map.insert(
            (r.unit_id as u8, r.function_code as u8, r.address as u16),
            RegMeta {
                data_type: r.data_type.clone(),
                byte_order: r.byte_order.clone(),
                scale,
                offset,
                decimals: compare_decimals(r.decimals, scale, offset, &r.data_type),
            },
        );
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_from_eng_inverts_scale_and_offset() {
        assert_eq!(raw_from_eng(23.45, 0.1, 0.0, "u16"), 235.0);
        assert!((raw_from_eng(23.45, 0.1, 0.0, "f32") - 234.5).abs() < 1e-9);
        assert_eq!(raw_from_eng(-10.0, -0.5, -40.0, "i16"), -60.0);
        assert_eq!(raw_from_eng(1e9, 1.0, 0.0, "u16"), 65535.0);
        assert_eq!(raw_from_eng(-5.0, 1.0, 0.0, "u16"), 0.0);
    }

    #[test]
    fn raw_from_eng_is_identity_without_scaling() {
        // R1: no rounding at scale 1 / offset 0 (clamp only).
        assert_eq!(raw_from_eng(49.7, 1.0, 0.0, "u16"), 49.7);
        assert_eq!(raw_from_eng(-3.2, 1.0, 0.0, "i32"), -3.2);
        assert_eq!(raw_from_eng(70000.5, 1.0, 0.0, "u16"), 65535.0);
        // Non-default scaling still rounds.
        assert_eq!(raw_from_eng(49.7, 1.0, 1.0, "u16"), 49.0);
    }

    #[test]
    fn eng_from_raw_round_trips() {
        for (scale, offset) in [(0.1, 0.0), (-0.5, -40.0)] {
            for x in [-20.0, 0.0, 23.5, 100.0] {
                let raw = raw_from_eng(x, scale, offset, "i16");
                let back = eng_from_raw(raw, scale, offset);
                assert!((back - x).abs() <= scale.abs(), "x={x} scale={scale} back={back}");
            }
        }
    }

    #[test]
    fn effective_decimals_from_scale() {
        assert_eq!(effective_decimals(None, 1.0, 0.0, "u16"), 0);
        assert_eq!(effective_decimals(None, 0.1, 0.0, "u16"), 1);
        assert_eq!(effective_decimals(None, 0.25, 0.0, "i16"), 2);
        assert_eq!(effective_decimals(None, 2.5, 0.0, "u16"), 1);
        assert_eq!(effective_decimals(None, 1.0, 0.0, "f32"), 6);
        assert_eq!(effective_decimals(None, 0.1, 0.0, "f64"), 6);
        assert_eq!(effective_decimals(Some(9), 1.0, 0.0, "u16"), 6);
        assert_eq!(effective_decimals(Some(2), 0.1, 0.0, "u16"), 2);
        assert_eq!(effective_decimals(Some(2), 1.0, 0.0, "f32"), 2);
        assert_eq!(effective_decimals(None, -0.5, 0.0, "u16"), 1);
        assert_eq!(effective_decimals(None, 1e-9, 0.0, "u16"), 6);
        // The offset counts too: scale 1, offset 0.25 needs 2 places.
        assert_eq!(effective_decimals(None, 1.0, 0.25, "u16"), 2);
        assert_eq!(effective_decimals(None, 0.1, -40.5, "i16"), 1);
        assert_eq!(effective_decimals(None, 0.1, 0.125, "i16"), 3);
    }

    #[test]
    fn f32_shortest_drops_float_noise() {
        assert_eq!(f32_shortest(230.7f32 as f64), 230.7);
        assert_eq!(f32_shortest(23.3f32 as f64), 23.3);
        assert_eq!(f32_shortest(49.95f32 as f64), 49.95);
        assert_eq!(f32_shortest(35.5), 35.5);
        assert!(f32_shortest(f64::NAN).is_nan());
        assert_eq!(f32_shortest(f64::INFINITY), f64::INFINITY);
    }

    #[test]
    fn round_to_rounds_half_away() {
        assert_eq!(round_to(2.345, 2), 2.35);
        assert_eq!(round_to(-1.5, 0), -2.0);
    }

    #[test]
    fn build_reg_meta_defaults_and_keys() {
        let mk = |scale, offset, decimals| SimRegister {
            id: 1, unit_id: 3, function_code: 3, address: 10, alias: String::new(),
            data_type: "u16".into(), hold_value: 0, sort_order: 0, device_instance_id: None,
            value_source: "hold".into(), byte_order: "ABCD".into(), source_params: "{}".into(),
            interval_ms: 1000, unit: None, display_format: None, scale, scale_offset: offset, decimals,
        };
        let m = build_reg_meta(&[mk(None, None, None)]);
        let v = m.get(&(3, 3, 10)).unwrap();
        assert_eq!((v.scale, v.offset, v.decimals), (1.0, 0.0, 0));
        let m = build_reg_meta(&[mk(Some(0.1), Some(-40.0), None)]);
        let v = m.get(&(3, 3, 10)).unwrap();
        assert_eq!((v.scale, v.offset, v.decimals), (0.1, -40.0, 1));
    }

    #[test]
    fn build_reg_meta_compares_at_least_one_raw_step() {
        let mk = |scale, decimals, data_type: &str| SimRegister {
            id: 1, unit_id: 1, function_code: 3, address: 0, alias: String::new(),
            data_type: data_type.into(), hold_value: 0, sort_order: 0, device_instance_id: None,
            value_source: "hold".into(), byte_order: "ABCD".into(), source_params: "{}".into(),
            interval_ms: 1000, unit: None, display_format: None, scale, scale_offset: None, decimals,
        };
        let dec = |scale, decimals, dt| build_reg_meta(&[mk(scale, decimals, dt)])[&(1, 3, 0)].decimals;
        // Explicit 0 decimals on a ×0.1 register still compares at 0.1 (so "> 35.5" stays 35.5).
        assert_eq!(dec(Some(0.1), Some(0), "u16"), 1);
        // Finer explicit decimals are kept.
        assert_eq!(dec(Some(0.1), Some(3), "u16"), 3);
        assert_eq!(dec(None, Some(2), "u16"), 2);
        // R7: floats use explicit decimals when set, else 6.
        assert_eq!(dec(None, Some(2), "f32"), 2);
        assert_eq!(dec(Some(0.1), Some(1), "f64"), 1);
        assert_eq!(dec(None, None, "f32"), 6);
    }

    #[test]
    fn raw_from_eng_maps_non_finite_to_zero() {
        for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert_eq!(raw_from_eng(bad, 0.1, 0.0, "u16"), 0.0);
            assert_eq!(raw_from_eng(bad, 1.0, 0.0, "u16"), 0.0);
            assert_eq!(raw_from_eng(bad, 0.5, 0.0, "f32"), 0.0);
        }
        // eng 0 with offset 40, scale 0.5: (0 - 40) / 0.5 = -80.
        assert_eq!(raw_from_eng(f64::NAN, 0.5, 40.0, "i16"), -80.0);
    }
}
