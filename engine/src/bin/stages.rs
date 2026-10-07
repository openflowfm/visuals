//! Every stage's preview picture for one preset, as PNGs — what the editor's nodes
//! show, without the editor.
//!
//!   cargo run --release --bin stages -- <file.milk> [frames] [out dir]
//!
//! Plays a steady tone for `frames` frames (default 120) and writes
//! `<out dir>/<stage>.png` for each of `render::PREVIEWS`.

use engine::audio::Audio;
use engine::render::{headless, Renderer, PREVIEW, PREVIEWS};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(path) = args.first() else {
        eprintln!("usage: stages <file.milk> [frames] [out dir]");
        std::process::exit(2);
    };
    let frames: usize = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(120);
    let out = std::path::PathBuf::from(args.get(2).cloned().unwrap_or_else(|| "stages".into()));
    std::fs::create_dir_all(&out).expect("create out dir");
    let (device, queue) = headless().expect("a GPU");
    let mut renderer = Renderer::new(device, queue, 1280, 720);
    let text = engine::preset::decode(&std::fs::read(path).expect("read preset"));
    renderer.load(&text, 1).expect("load preset");
    renderer.set_previews(true);
    let mut audio = Audio::default();
    let tone: Vec<f32> = (0..1024).map(|i| (i as f32 * 0.07).sin() * 0.7).collect();
    for _ in 0..frames {
        audio.update(&tone, &tone);
        renderer.render(&mut audio, 1.0 / 60.0);
    }
    let pixels = renderer.read_previews().expect("previews");
    let each = (PREVIEW.0 * PREVIEW.1 * 4) as usize;
    for (i, name) in PREVIEWS.iter().enumerate() {
        let file = std::fs::File::create(out.join(format!("{name}.png"))).expect("create png");
        let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), PREVIEW.0, PREVIEW.1);
        encoder.set_color(png::ColorType::Rgba);
        encoder.write_header().unwrap().write_image_data(&pixels[each * i..each * (i + 1)]).unwrap();
    }
    println!("{}: {} stage pictures", out.display(), PREVIEWS.len());
}
