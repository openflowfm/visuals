//! How evenly a preset moves from one display refresh to the next.
//!
//!   cargo run --release -p visuals-engine --bin motion -- <preset or folder> … [options]
//!
//!   --hz 60,120          the refresh rates to draw at (default 60,120)
//!   --speed 0.25,1,4     the preset speeds (default 0.25,1,4)
//!   --seconds S          how long to measure each (default 4)
//!   --warm S             run this long first, unmeasured (default 3)
//!   --size WxH           the size it draws at (default 512x384)
//!   --dump DIR           also save the first second's pictures as PNGs there
//!   --jitter MS          vary each refresh's time by up to ± this, as a real
//!                        display loop does (default 0)
//!
//! Each preset is drawn from the same synthetic music (a kick on the beat under a
//! chord) at each rate and speed, and every pair of refreshes in a row is
//! measured by block matching: 16 px blocks, each found again in the next
//! picture within ±8 px, to a tenth of a pixel. The motion of a refresh is the
//! mean distance its blocks moved. A preset moves by steps (30 a second × the
//! speed), so a refresh is filed by where it lands in its step — its phase — and
//! motion is averaged per phase. Smooth motion moves as far in every phase of a
//! step; judder is a phase that moves much more than another (a step drawn as a
//! cross-fade moves everything in the refresh that crosses half way and nothing
//! in the others). The figures printed are the most-moving phase over the
//! least-moving one, 1.00 for perfectly even, by motion (only where blocks can be
//! matched: not on noise or soft glows) and by frame difference (every refresh).

use engine::audio::{Audio, FFT_SIZE};
use engine::render::{headless, Renderer};
use engine::runtime::PRESET_RATE;
use std::path::{Path, PathBuf};

const RATE: f64 = 44_100.0;
const BLOCK: usize = 16;
const SEARCH: i32 = 8;

struct Options {
    presets: Vec<PathBuf>,
    hz: Vec<f64>,
    speeds: Vec<f64>,
    seconds: f64,
    warm: f64,
    size: (u32, u32),
    jitter: f64,
    dump: Option<PathBuf>,
}

fn usage() -> ! {
    eprintln!("usage: motion <preset or folder> … [--hz 60,120] [--speed 0.25,1,4] [--seconds S] [--warm S] [--size WxH] [--jitter MS] [--dump DIR]");
    std::process::exit(2);
}

fn list(s: Option<String>) -> Vec<f64> {
    let s = s.unwrap_or_else(|| usage());
    s.split(',').map(|v| v.parse().unwrap_or_else(|_| usage())).collect()
}

fn options() -> Options {
    let mut o = Options { presets: Vec::new(), hz: vec![60.0, 120.0], speeds: vec![0.25, 1.0, 4.0], seconds: 4.0, warm: 3.0, size: (512, 384), jitter: 0.0, dump: None };
    let mut args = std::env::args().skip(1);
    let one = |s: Option<String>| s.and_then(|s| s.parse::<f64>().ok()).unwrap_or_else(|| usage());
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--hz" => o.hz = list(args.next()),
            "--speed" => o.speeds = list(args.next()),
            "--seconds" => o.seconds = one(args.next()),
            "--warm" => o.warm = one(args.next()),
            "--jitter" => o.jitter = one(args.next()),
            "--dump" => o.dump = Some(args.next().unwrap_or_else(|| usage()).into()),
            "--size" => {
                o.size = args
                    .next()
                    .and_then(|s| s.split_once('x').and_then(|(a, b)| Some((a.parse().ok()?, b.parse().ok()?))))
                    .unwrap_or_else(|| usage())
            }
            _ => o.presets.extend(presets(&find(&arg))),
        }
    }
    if o.presets.is_empty() {
        usage();
    }
    o
}

/// A path as given, or else one in the pack.
fn find(preset: &str) -> PathBuf {
    let given = PathBuf::from(preset);
    if given.exists() {
        return given;
    }
    let pack = PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".openflow/visuals/presets").join(preset);
    if pack.exists() {
        return pack;
    }
    eprintln!("no preset at {preset}, nor in the pack");
    std::process::exit(1);
}

/// The `.milk` files at `path`, a file or a folder (not recursed), sorted.
fn presets(path: &Path) -> Vec<PathBuf> {
    if path.is_file() {
        return vec![path.to_owned()];
    }
    let mut out: Vec<PathBuf> = std::fs::read_dir(path)
        .map(|d| d.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().is_some_and(|e| e == "milk")).collect())
        .unwrap_or_default();
    out.sort();
    out
}

/// The music at time `t`: the window ending there.
fn music(t: f64, left: &mut [f32]) {
    for (i, s) in left.iter_mut().enumerate() {
        let at = t - (FFT_SIZE - i) as f64 / RATE;
        let since = at.rem_euclid(0.5);
        let tau = std::f64::consts::TAU;
        let kick = (tau * 55.0 * at).sin() * (-since * 12.0).exp();
        let chord = 0.25 * ((tau * 220.0 * at).sin() + (tau * 277.0 * at).sin() + (tau * 330.0 * at).sin());
        *s = (0.6 * kick + 0.3 * chord).clamp(-1.0, 1.0) as f32;
    }
}

/// A small, deterministic stream for the jitter.
struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }
}

fn luma(rgba: &[u8]) -> Vec<f32> {
    rgba.chunks_exact(4).map(|p| 0.299 * p[0] as f32 + 0.587 * p[1] as f32 + 0.114 * p[2] as f32).collect()
}

/// The mean distance, in pixels, the textured blocks of `a` moved to in `b`, or
/// `None` if too few were textured enough to find.
fn flow(a: &[f32], b: &[f32], w: usize, h: usize) -> Option<f64> {
    let r = SEARCH as usize;
    let mut total = 0.0;
    let mut found = 0usize;
    let mut blocks = 0usize;
    let mut by = r;
    while by + BLOCK + r <= h {
        let mut bx = r;
        while bx + BLOCK + r <= w {
            blocks += 1;
            let mut mean = 0.0;
            for y in 0..BLOCK {
                for x in 0..BLOCK {
                    mean += a[(by + y) * w + bx + x];
                }
            }
            mean /= (BLOCK * BLOCK) as f32;
            let mut var = 0.0;
            for y in 0..BLOCK {
                for x in 0..BLOCK {
                    let d = a[(by + y) * w + bx + x] - mean;
                    var += d * d;
                }
            }
            var /= (BLOCK * BLOCK) as f32;
            if var >= 16.0 {
                let n = (2 * SEARCH + 1) as usize;
                let mut sad = vec![0f32; n * n];
                for (k, cost) in sad.iter_mut().enumerate() {
                    let (dx, dy) = ((k % n) as i32 - SEARCH, (k / n) as i32 - SEARCH);
                    let mut s = 0.0;
                    for y in 0..BLOCK {
                        let ra = (by + y) * w + bx;
                        let rb = ((by + y) as i32 + dy) as usize * w + (bx as i32 + dx) as usize;
                        for x in 0..BLOCK {
                            s += (a[ra + x] - b[rb + x]).abs();
                        }
                    }
                    *cost = s;
                }
                let (best, &min) = sad.iter().enumerate().min_by(|x, y| x.1.total_cmp(y.1)).unwrap();
                let avg = sad.iter().sum::<f32>() / sad.len() as f32;
                let (ix, iy) = ((best % n) as i32, (best / n) as i32);
                // A distinct match, not at the edge of the search.
                if min < 0.5 * avg && ix > 0 && iy > 0 && ix < n as i32 - 1 && iy < n as i32 - 1 {
                    let at = |x: i32, y: i32| sad[y as usize * n + x as usize];
                    let part = |l: f32, c: f32, r: f32| {
                        let d = l - 2.0 * c + r;
                        if d > 0.0 { (0.5 * (l - r) / d).clamp(-0.5, 0.5) } else { 0.0 }
                    };
                    let fx = (ix - SEARCH) as f32 + part(at(ix - 1, iy), min, at(ix + 1, iy));
                    let fy = (iy - SEARCH) as f32 + part(at(ix, iy - 1), min, at(ix, iy + 1));
                    total += ((fx * fx + fy * fy) as f64).sqrt();
                    found += 1;
                }
            }
            bx += BLOCK;
        }
        by += BLOCK;
    }
    (found * 10 >= blocks).then(|| total / found as f64)
}

struct Measure {
    /// Per phase: mean motion (px) over the refreshes it could be measured at,
    /// and mean frame difference over all of them.
    motion: Vec<f64>,
    difference: Vec<f64>,
    /// Refreshes whose motion could not be measured.
    unmeasured: usize,
}

fn measure(r: &mut Renderer, text: &str, o: &Options, hz: f64, speed: f64, seed: u64) -> Measure {
    let (w, h) = (o.size.0 as usize, o.size.1 as usize);
    r.load(text, 1).expect("load");
    let mut audio = Audio::new(RATE as f32);
    let mut left = vec![0f32; FFT_SIZE];
    let mut rng = Lcg(seed);
    let mut t = 0.0;
    let mut position = 0.0f64;
    let mut step = |r: &mut Renderer, audio: &mut Audio, t: &mut f64, position: &mut f64, rng: &mut Lcg| {
        let dt = 1.0 / hz + (rng.next() * 2.0 - 1.0) * o.jitter / 1000.0;
        *t += 1.0 / hz;
        music(*t, &mut left);
        audio.update(&left, &left);
        r.render(audio, dt * speed);
        *position += dt * speed * PRESET_RATE;
    };
    for _ in 0..(o.warm * hz).round() as usize {
        step(r, &mut audio, &mut t, &mut position, &mut rng);
    }
    // Refreshes per step: the phases a refresh can land in (one when a refresh
    // makes a step or more).
    let per = (hz / (PRESET_RATE * speed)).round().max(1.0) as usize;
    let (mut motion, mut moved, mut difference, mut differed) = (vec![0.0; per], vec![0usize; per], vec![0.0; per], vec![0usize; per]);
    let mut before = luma(&r.read_back());
    let mut unmeasured = 0;
    for i in 0..(o.seconds * hz).round() as usize {
        step(r, &mut audio, &mut t, &mut position, &mut rng);
        let rgba = r.read_back();
        if let Some(dir) = o.dump.as_ref().filter(|_| (i as f64) < hz) {
            let file = std::fs::File::create(dir.join(format!("{hz}hz-{speed}x-{i:03}.png"))).expect("create png");
            let mut e = png::Encoder::new(std::io::BufWriter::new(file), w as u32, h as u32);
            e.set_color(png::ColorType::Rgba);
            e.set_depth(png::BitDepth::Eight);
            e.write_header().unwrap().write_image_data(&rgba).unwrap();
        }
        let now = luma(&rgba);
        let diff = before.iter().zip(&now).map(|(a, b)| (a - b).abs() as f64).sum::<f64>() / now.len() as f64;
        let phase = ((position.fract() * per as f64).round() as usize) % per;
        difference[phase] += diff;
        differed[phase] += 1;
        match flow(&before, &now, w, h) {
            Some(m) => {
                motion[phase] += m;
                moved[phase] += 1;
            }
            None => unmeasured += 1,
        }
        before = now;
    }
    let mean = |sum: Vec<f64>, n: &[usize]| sum.iter().zip(n).map(|(s, &n)| if n > 0 { s / n as f64 } else { f64::NAN }).collect();
    Measure { motion: mean(motion, &moved), difference: mean(difference, &differed), unmeasured }
}

/// The most over the least of `values`, ignoring phases with nothing measured.
fn unevenness(values: &[f64]) -> f64 {
    let v: Vec<f64> = values.iter().copied().filter(|v| v.is_finite()).collect();
    let (lo, hi) = v.iter().fold((f64::MAX, 0.0f64), |(lo, hi), &x| (lo.min(x), hi.max(x)));
    if v.is_empty() { f64::NAN } else { hi / lo.max(1e-3) }
}

fn main() {
    let o = options();
    let (device, queue) = headless().expect("a GPU");
    let mut r = Renderer::new(device, queue, o.size.0, o.size.1);
    println!("preset\thz\tspeed\tmotion unevenness\tdifference unevenness\tmotion px/refresh by phase\tdifference by phase\tunmeasured");
    for path in &o.presets {
        let text = engine::preset::decode(&std::fs::read(path).expect("read preset"));
        let name = path.file_stem().unwrap_or_default().to_string_lossy();
        for &hz in &o.hz {
            for &speed in &o.speeds {
                let m = measure(&mut r, &text, &o, hz, speed, 7);
                let list = |v: &[f64]| v.iter().map(|x| format!("{x:.2}")).collect::<Vec<_>>().join(" ");
                println!(
                    "{name}\t{hz}\t{speed}\t{:.2}\t{:.2}\t{}\t{}\t{}",
                    unevenness(&m.motion),
                    unevenness(&m.difference),
                    list(&m.motion),
                    list(&m.difference),
                    m.unmeasured
                );
            }
        }
    }
}
