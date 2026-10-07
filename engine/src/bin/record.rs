//! Render presets to a video, frame by frame, from an audio file — footage for
//! the teaser, in sync with its music and the same every run.
//!
//!   cargo run --release --bin record -- <audio> <out.mp4|out.mov> --cut <seconds> <file.milk> [--cut …] [options]
//!
//!   --cut <s> <preset>  from `s` seconds on, draw this preset (a path, or one in the
//!                       pack at ~/.openflow/visuals/presets); give at least one
//!   --cuts <file>       cuts from a file, one `<seconds> <preset>` a line, `#` comments
//!   --size WxH          the size it draws at (default 1920x1080)
//!   --fps N             frames per second (default 60)
//!   --from <s>          start this far into the audio (default 0)
//!   --to <s>            stop here (default the end of the audio)
//!   --warm <s>          run each preset this long, unseen, before its cut, so it
//!                       lands already drawing (default 2)
//!
//! ffmpeg reads the audio (any format it knows) and encodes the video: H.264 for
//! `.mp4`, ProRes 422 HQ for `.mov`. The audio is muxed in, so the file plays back
//! with what the presets heard.

use engine::audio::{Audio, FFT_SIZE};
use engine::render::{headless, Renderer};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const RATE: usize = 44_100;

struct Options {
    audio: PathBuf,
    out: PathBuf,
    cuts: Vec<(f64, PathBuf)>,
    size: (u32, u32),
    fps: u32,
    from: f64,
    to: Option<f64>,
    warm: f64,
}

fn usage() -> ! {
    eprintln!("usage: record <audio> <out.mp4|out.mov> --cut <seconds> <file.milk> [--cut …] [--cuts file] [--size WxH] [--fps N] [--from s] [--to s] [--warm s]");
    std::process::exit(2);
}

fn options() -> Options {
    let mut args = std::env::args().skip(1);
    let (Some(audio), Some(out)) = (args.next(), args.next()) else { usage() };
    let mut o = Options {
        audio: audio.into(),
        out: out.into(),
        cuts: Vec::new(),
        size: (1920, 1080),
        fps: 60,
        from: 0.0,
        to: None,
        warm: 2.0,
    };
    let seconds = |s: Option<String>| s.and_then(|s| s.parse::<f64>().ok()).unwrap_or_else(|| usage());
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--cut" => {
                let at = seconds(args.next());
                let Some(preset) = args.next() else { usage() };
                o.cuts.push((at, find(&preset)));
            }
            "--cuts" => {
                let Some(file) = args.next() else { usage() };
                let text = std::fs::read_to_string(&file).unwrap_or_else(|e| {
                    eprintln!("{file}: {e}");
                    std::process::exit(1);
                });
                for line in text.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')) {
                    let Some((at, preset)) = line.split_once(char::is_whitespace) else { usage() };
                    o.cuts.push((seconds(Some(at.into())), find(preset.trim())));
                }
            }
            "--size" => {
                o.size = args
                    .next()
                    .and_then(|s| s.split_once('x').and_then(|(a, b)| Some((a.parse().ok()?, b.parse().ok()?))))
                    .unwrap_or_else(|| usage())
            }
            "--fps" => o.fps = args.next().and_then(|s| s.parse().ok()).unwrap_or_else(|| usage()),
            "--from" => o.from = seconds(args.next()),
            "--to" => o.to = Some(seconds(args.next())),
            "--warm" => o.warm = seconds(args.next()),
            _ => usage(),
        }
    }
    if o.cuts.is_empty() {
        usage();
    }
    o.cuts.sort_by(|a, b| a.0.total_cmp(&b.0));
    o
}

/// A preset path as given, or else one in the pack.
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

/// The whole file as interleaved stereo f32 at 44.1 kHz.
fn decode(audio: &Path) -> Vec<f32> {
    let mut child = Command::new("ffmpeg")
        .args(["-v", "error", "-i"])
        .arg(audio)
        .args(["-f", "f32le", "-ac", "2", "-ar", &RATE.to_string(), "-"])
        .stdout(Stdio::piped())
        .spawn()
        .expect("run ffmpeg");
    let mut bytes = Vec::new();
    child.stdout.take().unwrap().read_to_end(&mut bytes).expect("read decoded audio");
    if !child.wait().expect("ffmpeg").success() {
        eprintln!("ffmpeg could not read {}", audio.display());
        std::process::exit(1);
    }
    bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect()
}

/// The window the presets hear at time `t`: the samples ending there, as it would
/// be live. Silence before the start and after the end.
fn hear(samples: &[f32], t: f64, left: &mut [f32], right: &mut [f32]) {
    let end = (t * RATE as f64).round() as isize;
    for i in 0..FFT_SIZE {
        let at = end - FFT_SIZE as isize + i as isize;
        let (l, r) = if at >= 0 && (at as usize) * 2 + 1 < samples.len() {
            (samples[at as usize * 2], samples[at as usize * 2 + 1])
        } else {
            (0.0, 0.0)
        };
        left[i] = l;
        right[i] = r;
    }
}

fn encoder(o: &Options) -> std::process::Child {
    let (w, h) = o.size;
    let mov = o.out.extension().is_some_and(|e| e.eq_ignore_ascii_case("mov"));
    let video: &[&str] = if mov {
        &["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le", "-c:a", "pcm_s16le"]
    } else {
        &["-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "320k"]
    };
    let mut cmd = Command::new("ffmpeg");
    cmd.args(["-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", &format!("{w}x{h}")])
        .args(["-r", &o.fps.to_string(), "-i", "-", "-ss", &o.from.to_string()]);
    if let Some(to) = o.to {
        cmd.args(["-t", &(to - o.from).to_string()]);
    }
    cmd.arg("-i").arg(&o.audio).args(["-map", "0:v", "-map", "1:a"]).args(video).args(["-shortest"]).arg(&o.out);
    cmd.stdin(Stdio::piped()).spawn().expect("run ffmpeg")
}

fn main() {
    let o = options();
    let samples = decode(&o.audio);
    let length = (samples.len() / 2) as f64 / RATE as f64;
    let to = o.to.unwrap_or(length).min(length);
    let frames = ((to - o.from) * o.fps as f64).floor() as usize;
    let (w, h) = o.size;

    let (device, queue) = headless().expect("a GPU");
    let mut renderer = Renderer::new(device, queue, w, h);
    let mut audio = Audio::new(RATE as f32);
    let mut ffmpeg = encoder(&o);
    let mut pipe = ffmpeg.stdin.take().unwrap();
    let (mut left, mut right) = (vec![0f32; FFT_SIZE], vec![0f32; FFT_SIZE]);
    let mut current = None;
    let started = std::time::Instant::now();

    for frame in 0..frames {
        let t = o.from + frame as f64 / o.fps as f64;
        // The preset whose cut is the latest at or before `t`; the first one also
        // covers anything before its cut.
        let cut = o.cuts.iter().rposition(|(at, _)| *at <= t).unwrap_or(0);
        if current != Some(cut) {
            let path = &o.cuts[cut].1;
            let text = engine::preset::decode(&std::fs::read(path).expect("read preset"));
            match renderer.load(&text, cut as u64 + 1) {
                Ok(loaded) => {
                    for (kind, why) in &loaded.fell_back {
                        eprintln!("{}: {kind:?} shader fell back: {}", path.display(), why.lines().next().unwrap_or(""));
                    }
                }
                Err(e) => {
                    eprintln!("{}: {e}", path.display());
                    std::process::exit(1);
                }
            }
            current = Some(cut);
            // Run it unseen over the music before the cut, so it lands already
            // drawing rather than from an empty frame.
            for k in (1..=(o.warm * o.fps as f64).round() as usize).rev() {
                hear(&samples, t - k as f64 / o.fps as f64, &mut left, &mut right);
                audio.update(&left, &right);
                renderer.render(&mut audio, 1.0 / o.fps as f64);
            }
        }
        hear(&samples, t, &mut left, &mut right);
        audio.update(&left, &right);
        renderer.render(&mut audio, 1.0 / o.fps as f64);
        if pipe.write_all(&renderer.read_back()).is_err() {
            break;
        }
        if frame % (o.fps as usize * 2) == 0 {
            eprint!("\r{t:6.1}s / {to:.1}s");
        }
    }
    drop(pipe);
    let ok = ffmpeg.wait().expect("ffmpeg").success();
    eprintln!();
    if !ok {
        eprintln!("ffmpeg failed to encode {}", o.out.display());
        std::process::exit(1);
    }
    let took = started.elapsed().as_secs_f64();
    println!("{}: {frames} frames at {w}x{h}, {:.1} fps", o.out.display(), frames as f64 / took);
}
