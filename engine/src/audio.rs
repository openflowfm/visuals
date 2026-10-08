//! What MilkDrop hears: a 1024-sample window per channel, an FFT, and the
//! `bass`/`mid`/`treb` levels presets read.
//!
//! A port of Butterchurn's `AudioProcessor`, `FFT` and `AudioLevels`, in `f32`
//! where Butterchurn uses `Float32Array`, so the numbers match it.

pub const FFT_SIZE: usize = 1024;
pub const NUM_SAMPS: usize = 512;

/// A sample, -1..1, as the byte Butterchurn hears: what a browser's
/// `AnalyserNode.getByteTimeDomainData` makes of it — `128 × (v + 1)`,
/// truncated and clamped to 0..255 (Chromium's `RealtimeAnalyser`) — so a
/// waveform here is the size it is in the BlackHole visualizer for the same input.
pub fn to_byte(v: f32) -> u8 {
    (128.0 * (v as f64 + 1.0)).clamp(0.0, 255.0) as u8
}

/// One frame's audio, as the rest of the engine reads it.
pub struct Audio {
    /// The mono window, -128..127, as Butterchurn's `timeArray`.
    pub time: [f32; FFT_SIZE],
    /// Left and right, smoothed and halved to 512 samples — what waveforms draw.
    pub time_l: [f32; NUM_SAMPS],
    pub time_r: [f32; NUM_SAMPS],
    /// Spectra for the mono mix and each side.
    pub freq: Vec<f32>,
    pub freq_l: Vec<f32>,
    pub freq_r: Vec<f32>,
    fft: Fft,
    levels: Levels,
}

impl Default for Audio {
    fn default() -> Self {
        Self::new(44_100.0)
    }
}

impl Audio {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            time: [0.0; FFT_SIZE],
            time_l: [0.0; NUM_SAMPS],
            time_r: [0.0; NUM_SAMPS],
            freq: vec![0.0; NUM_SAMPS],
            freq_l: vec![0.0; NUM_SAMPS],
            freq_r: vec![0.0; NUM_SAMPS],
            fft: Fft::new(FFT_SIZE, NUM_SAMPS, true),
            levels: Levels::new(sample_rate),
        }
    }

    pub fn set_sample_rate(&mut self, sample_rate: f32) {
        let levels = Levels::new(sample_rate);
        self.levels.starts = levels.starts;
        self.levels.stops = levels.stops;
    }

    /// Take a window of samples, -1..1, as Butterchurn takes its byte arrays:
    /// each sample becomes an unsigned byte ([`to_byte`]).
    pub fn update(&mut self, left: &[f32], right: &[f32]) {
        let byte = to_byte;
        let mut mono = [128u8; FFT_SIZE];
        let mut l = [128u8; FFT_SIZE];
        let mut r = [128u8; FFT_SIZE];
        let n = left.len().min(right.len()).min(FFT_SIZE);
        let at = FFT_SIZE - n;
        for i in 0..n {
            l[at + i] = byte(left[left.len() - n + i]);
            r[at + i] = byte(right[right.len() - n + i]);
            mono[at + i] = byte((left[left.len() - n + i] + right[right.len() - n + i]) * 0.5);
        }
        self.update_bytes(&mono, &l, &r);
    }

    /// Butterchurn's `processAudio`, exactly: the signed samples, the halved and
    /// smoothed waveform channels, and three FFTs.
    pub fn update_bytes(&mut self, mono: &[u8; FFT_SIZE], left: &[u8; FFT_SIZE], right: &[u8; FFT_SIZE]) {
        // Int8Array storage: the subtraction wraps exactly as the typed array does.
        let signed = |b: u8| (b as i32 - 128) as i8 as f32;
        let mut signed_l = [0f32; FFT_SIZE];
        let mut signed_r = [0f32; FFT_SIZE];
        let (mut last, mut j) = (0usize, 0usize);
        for i in 0..FFT_SIZE {
            self.time[i] = signed(mono[i]);
            signed_l[i] = signed(left[i]);
            signed_r[i] = signed(right[i]);
            // `tempTimeArray` is an Int8Array too: the average is truncated.
            let temp_l = (0.5 * (signed_l[i] + signed_l[last])).trunc();
            let temp_r = (0.5 * (signed_r[i] + signed_r[last])).trunc();
            if i % 2 == 0 {
                self.time_l[j] = temp_l;
                self.time_r[j] = temp_r;
                j += 1;
            }
            last = i;
        }
        self.freq = self.fft.time_to_frequency(&self.time);
        self.freq_l = self.fft.time_to_frequency(&signed_l);
        self.freq_r = self.fft.time_to_frequency(&signed_r);
    }

    /// Advance the levels one frame. `fps` is the renderer's running estimate.
    pub fn update_levels(&mut self, fps: f64, frame: u64) {
        self.levels.update(&self.freq, fps, frame);
    }

    pub fn bass(&self) -> f64 {
        self.levels.val[0] as f64
    }
    pub fn mid(&self) -> f64 {
        self.levels.val[1] as f64
    }
    pub fn treb(&self) -> f64 {
        self.levels.val[2] as f64
    }
    pub fn bass_att(&self) -> f64 {
        self.levels.att[0] as f64
    }
    pub fn mid_att(&self) -> f64 {
        self.levels.att[1] as f64
    }
    pub fn treb_att(&self) -> f64 {
        self.levels.att[2] as f64
    }
}

struct Levels {
    starts: [usize; 3],
    stops: [usize; 3],
    val: [f32; 3],
    imm: [f32; 3],
    att: [f32; 3],
    avg: [f32; 3],
    long_avg: [f32; 3],
}

impl Levels {
    fn new(sample_rate: f32) -> Self {
        let bucket = sample_rate / FFT_SIZE as f32;
        let edge = |hz: f32| ((hz / bucket).round() as i64 - 1).clamp(0, NUM_SAMPS as i64 - 1) as usize;
        let (bass_low, bass_high, mid_high, treb_high) = (edge(20.0), edge(320.0), edge(2800.0), edge(11025.0));
        Self { starts: [bass_low, bass_high, mid_high], stops: [bass_high, mid_high, treb_high], val: [0.0; 3], imm: [0.0; 3], att: [1.0; 3], avg: [1.0; 3], long_avg: [1.0; 3] }
    }

    fn update(&mut self, freq: &[f32], fps: f64, frame: u64) {
        let fps = if !fps.is_finite() || fps < 15.0 { 15.0 } else { fps.min(144.0) };
        let adjust = |rate: f64| rate.powf(30.0 / fps) as f32;
        self.imm = [0.0; 3];
        for i in 0..3 {
            for j in self.starts[i]..self.stops[i] {
                self.imm[i] += freq[j];
            }
        }
        for i in 0..3 {
            let rate = adjust(if self.imm[i] > self.avg[i] { 0.2 } else { 0.5 });
            self.avg[i] = self.avg[i] * rate + self.imm[i] * (1.0 - rate);
            let rate = adjust(if frame < 50 { 0.9 } else { 0.992 });
            self.long_avg[i] = self.long_avg[i] * rate + self.imm[i] * (1.0 - rate);
            if self.long_avg[i] < 0.001 {
                self.val[i] = 1.0;
                self.att[i] = 1.0;
            } else {
                self.val[i] = self.imm[i] / self.long_avg[i];
                self.att[i] = self.avg[i] / self.long_avg[i];
            }
        }
    }
}

/// Butterchurn's radix-2 FFT with its equalisation, in `f32`.
struct Fft {
    samples_in: usize,
    samples_out: usize,
    nfreq: usize,
    equalize: Vec<f32>,
    bitrev: Vec<usize>,
    cossin: (Vec<f32>, Vec<f32>),
}

impl Fft {
    fn new(samples_in: usize, samples_out: usize, equalize: bool) -> Self {
        let nfreq = samples_out * 2;
        let equalize = if equalize {
            let inv = 1.0 / samples_out as f32;
            (0..samples_out).map(|i| -0.02 * ((samples_out - i) as f32 * inv).ln()).collect()
        } else {
            vec![1.0; samples_out]
        };
        let mut bitrev: Vec<usize> = (0..nfreq).collect();
        let mut j = 0;
        for i in 0..nfreq {
            if j > i {
                bitrev.swap(i, j);
            }
            let mut m = nfreq >> 1;
            while m >= 1 && j >= m {
                j -= m;
                m >>= 1;
            }
            j += m;
        }
        let (mut cos, mut sin) = (Vec::new(), Vec::new());
        let mut size = 2;
        while size <= nfreq {
            let theta = -2.0 * std::f64::consts::PI / size as f64;
            cos.push(theta.cos() as f32);
            sin.push(theta.sin() as f32);
            size <<= 1;
        }
        Self { samples_in, samples_out, nfreq, equalize, bitrev, cossin: (cos, sin) }
    }

    fn time_to_frequency(&self, input: &[f32]) -> Vec<f32> {
        let mut real = vec![0f32; self.nfreq];
        let mut imag = vec![0f32; self.nfreq];
        for i in 0..self.nfreq {
            let idx = self.bitrev[i];
            real[i] = if idx < self.samples_in { input[idx] } else { 0.0 };
        }
        let (mut size, mut t) = (2, 0);
        while size <= self.nfreq {
            let (wpr, wpi) = (self.cossin.0[t], self.cossin.1[t]);
            let (mut wr, mut wi) = (1f32, 0f32);
            let half = size >> 1;
            for m in 0..half {
                let mut i = m;
                while i < self.nfreq {
                    let j = i + half;
                    let tr = wr * real[j] - wi * imag[j];
                    let ti = wr * imag[j] + wi * real[j];
                    real[j] = real[i] - tr;
                    imag[j] = imag[i] - ti;
                    real[i] += tr;
                    imag[i] += ti;
                    i += size;
                }
                let w = wr;
                wr = w * wpr - wi * wpi;
                wi = wi * wpr + w * wpi;
            }
            size <<= 1;
            t += 1;
        }
        (0..self.samples_out).map(|i| self.equalize[i] * (real[i] * real[i] + imag[i] * imag[i]).sqrt()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silence_reads_zero_then_one_once_the_long_average_dies_away() {
        let mut audio = Audio::default();
        audio.update(&[0.0; 1024], &[0.0; 1024]);
        audio.update_levels(60.0, 0);
        assert_eq!(audio.bass(), 0.0, "the long average starts at 1");
        for frame in 1..3000 {
            audio.update_levels(60.0, frame);
        }
        assert_eq!(audio.bass(), 1.0, "a long average under 0.001 reads as 1");
    }

    #[test]
    fn a_tone_lands_in_its_bin() {
        let mut audio = Audio::default();
        // 1 kHz: bin 1000 / (44100 / 1024) ≈ 23.
        let tone: Vec<f32> = (0..1024).map(|i| (i as f32 * 2.0 * std::f32::consts::PI * 1000.0 / 44_100.0).sin() * 0.8).collect();
        audio.update(&tone, &tone);
        let peak = (0..NUM_SAMPS).max_by(|&a, &b| audio.freq[a].total_cmp(&audio.freq[b])).unwrap();
        assert!((22..=24).contains(&peak), "{peak}");
        assert_eq!(audio.time_l.len(), 512);
    }
}
