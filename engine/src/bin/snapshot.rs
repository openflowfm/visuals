//! Render a preset without a window and save the last frame.
//!
//!   cargo run --release --bin snapshot -- <file.milk> [frames] [out.png] [WxH]
//!
//! The audio is fixed — a kick on every beat at 120 bpm under a chord — so a
//! snapshot repeats. This is the engine's half of the harness's recorded mode.

use engine::audio::Audio;
use engine::render::{headless, Renderer};

fn music(frame: usize, left: &mut [f32], right: &mut [f32]) {
    let since = (frame % 30) as f32 / 30.0;
    for i in 0..left.len() {
        let t = (frame * 735 + i) as f32 / 44_100.0;
        let kick = (2.0 * std::f32::consts::PI * 55.0 * t).sin() * (-since * 6.0).exp();
        let chord = 0.25
            * ((2.0 * std::f32::consts::PI * 220.0 * t).sin()
                + (2.0 * std::f32::consts::PI * 277.0 * t).sin()
                + (2.0 * std::f32::consts::PI * 330.0 * t).sin());
        left[i] = (0.6 * kick + 0.3 * chord).clamp(-1.0, 1.0);
        right[i] = left[i];
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(path) = args.first() else {
        eprintln!("usage: snapshot <file.milk> [frames] [out.png] [WxH]");
        std::process::exit(2);
    };
    let frames: usize = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(180);
    let out = args.get(2).cloned().unwrap_or_else(|| "snapshot.png".into());
    let (w, h) = args
        .get(3)
        .and_then(|s| s.split_once('x'))
        .and_then(|(a, b)| Some((a.parse().ok()?, b.parse().ok()?)))
        .unwrap_or((1280, 720));
    let (device, queue) = headless().expect("a GPU");
    let mut renderer = Renderer::new(device, queue, w, h);
    let text = engine::preset::decode(&std::fs::read(path).expect("read preset"));
    let loaded = renderer.load(&text, 1).expect("load preset");
    for (kind, why) in &loaded.fell_back {
        eprintln!("{kind:?} shader fell back: {}", why.lines().next().unwrap_or(""));
    }
    let mut audio = Audio::default();
    let (mut left, mut right) = (vec![0f32; 1024], vec![0f32; 1024]);
    let started = std::time::Instant::now();
    for frame in 0..frames {
        music(frame, &mut left, &mut right);
        audio.update(&left, &right);
        renderer.render(&mut audio, 1.0 / 60.0);
    }
    let pixels = renderer.read_back();
    let per_frame = started.elapsed().as_secs_f64() * 1000.0 / frames as f64;
    let file = std::fs::File::create(&out).expect("create png");
    let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), w, h);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.write_header().unwrap().write_image_data(&pixels).unwrap();
    println!("{out}: {frames} frames at {w}x{h}, {per_frame:.2} ms/frame (CPU + submit, not GPU-synced)");
}
