//! Measures of a value followed over a run, one per step: its mean, spread,
//! percentiles, and how much of it repeats with the beat.

/// The mean; `None` for no values.
pub fn mean(v: &[f64]) -> Option<f64> {
    (!v.is_empty()).then(|| v.iter().sum::<f64>() / v.len() as f64)
}

/// The standard deviation; `None` for no values.
pub fn deviation(v: &[f64]) -> Option<f64> {
    let m = mean(v)?;
    Some((v.iter().map(|x| (x - m).powi(2)).sum::<f64>() / v.len() as f64).sqrt())
}

/// The standard deviation over the mean; `None` when the mean is under `floor`.
pub fn variation(v: &[f64], floor: f64) -> Option<f64> {
    let m = mean(v)?;
    (m >= floor).then(|| deviation(v).unwrap_or(0.0) / m)
}

/// The value `p` (0–1) of the way up the sorted values; `None` for none.
pub fn percentile(v: &[f64], p: f64) -> Option<f64> {
    if v.is_empty() {
        return None;
    }
    let mut s = v.to_vec();
    s.sort_by(f64::total_cmp);
    Some(s[((s.len() - 1) as f64 * p.clamp(0.0, 1.0)).round() as usize])
}

/// How much of a series' variance repeats every `period` steps: the variance
/// of its mean at each phase of the period over its whole variance, 0–1. A
/// series following the beat whatever its shape or delay comes near 1; noise
/// comes to about `period / len`. `None` for fewer than two periods, or a
/// series that hardly varies (deviation under `floor`).
pub fn periodic(v: &[f64], period: usize, floor: f64) -> Option<f64> {
    if period == 0 || v.len() < 2 * period {
        return None;
    }
    // Whole periods only, so every phase is weighted alike.
    let v = &v[..v.len() / period * period];
    let m = mean(v)?;
    let total = v.iter().map(|x| (x - m).powi(2)).sum::<f64>() / v.len() as f64;
    if total.sqrt() < floor {
        return None;
    }
    let cycles = (v.len() / period) as f64;
    let folded: f64 = (0..period).map(|p| (v.iter().skip(p).step_by(period).sum::<f64>() / cycles - m).powi(2)).sum::<f64>() / period as f64;
    Some((folded / total).min(1.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mean_spread_and_percentiles() {
        let v = [1.0, 2.0, 3.0, 4.0];
        assert_eq!(mean(&v), Some(2.5));
        assert_eq!(deviation(&[2.0, 2.0]), Some(0.0));
        assert_eq!(variation(&[0.0, 0.0], 0.1), None);
        assert_eq!(variation(&[1.0, 3.0], 0.1), Some(0.5));
        assert_eq!((percentile(&v, 0.0), percentile(&v, 1.0)), (Some(1.0), Some(4.0)));
        assert_eq!((mean(&[]), percentile(&[], 0.5)), (None, None));
    }

    #[test]
    fn a_series_on_the_beat_is_periodic_and_noise_is_not() {
        // A kick's decay every 15 steps, delayed by 4.
        let beat: Vec<f64> = (0..270).map(|i| (-(((i + 11) % 15) as f64) / 3.0).exp()).collect();
        assert!(periodic(&beat, 15, 1e-3).unwrap() > 0.99);
        let mut x = 1u64;
        let noise: Vec<f64> = (0..270)
            .map(|_| {
                x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                (x >> 11) as f64 / (1u64 << 53) as f64
            })
            .collect();
        assert!(periodic(&noise, 15, 1e-3).unwrap() < 0.15);
        assert_eq!(periodic(&[1.0; 270], 15, 1e-3), None, "flat");
        assert_eq!(periodic(&beat[..20], 15, 1e-3), None, "too short");
    }
}
