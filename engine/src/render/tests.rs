use super::*;
use crate::fx::Mirror;

/// A target's pixels, RGBA rows top to bottom (row 0 of a presented target
/// is the top of the picture).
fn read_target(r: &Renderer, target: &Target) -> Vec<u8> {
    read_targets(r.device(), r.queue(), &[target], false).unwrap()
}

const W: u32 = 64;
const H: u32 = 36;
const SPIRAL: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../test/fixtures/milk/Fixture - Spiral Test.milk"));

/// `text` loaded at `w`×`h`, every shader its own; None without a GPU.
fn renderer(w: u32, h: u32, text: &str) -> Option<Renderer> {
    let (device, queue) = headless()?;
    let mut r = Renderer::new(device, queue, w, h);
    let loaded = r.load(text, 1).unwrap();
    assert!(loaded.fell_back.is_empty(), "{:?}", loaded.fell_back);
    Some(r)
}

/// The tone every test hears.
fn tone() -> Vec<f32> {
    (0..1024).map(|i| (i as f32 * 0.05).sin() * 0.8).collect()
}

/// `n` refreshes `dt` seconds apart, each hearing [`tone`].
fn play(r: &mut Renderer, audio: &mut Audio, n: usize, dt: f64) {
    let tone = tone();
    for _ in 0..n {
        audio.update(&tone, &tone);
        r.render(audio, dt);
    }
}

/// The Spiral fixture at 64×36, with `frames` frames made.
fn spiral(frames: usize) -> Option<(Renderer, Audio)> {
    let mut r = renderer(W, H, SPIRAL)?;
    let mut audio = Audio::default();
    play(&mut r, &mut audio, frames, 1.0 / 60.0);
    Some((r, audio))
}

/// The picture presented through the master pass with `m`.
fn presented(r: &mut Renderer, m: Master) -> Vec<u8> {
    let target = Target::new(r.device(), (W, H), "shown");
    r.set_master(m);
    r.present(&target.view, FORMAT, (W, H));
    read_target(r, &target)
}

#[test]
fn fit_keeps_the_aspect_and_fills_when_it_matches() {
    // The same aspect fills the area.
    assert_eq!(fit((3840, 2160), (1920, 1080)), (0.0, 0.0, 3840.0, 2160.0));
    // A portrait picture in a landscape window: bars at the sides.
    assert_eq!(fit((1920, 1080), (1080, 1920)), ((1920.0 - 607.5) / 2.0, 0.0, 607.5, 1080.0));
    // A landscape picture on a portrait display: bars above and below.
    assert_eq!(fit((1440, 3440), (1920, 1080)), (0.0, (3440.0 - 810.0) / 2.0, 1440.0, 810.0));
    // The display's aspect but for rounding: it fills, no sliver of a bar.
    assert_eq!(fit((1440, 3440), (932, 2226)), (0.0, 0.0, 1440.0, 3440.0));
}

#[test]
fn resizing_carries_the_picture_on_at_the_new_aspect() {
    let Some((mut r, mut audio)) = spiral(30) else { return };
    let lit = |p: &[u8]| p.chunks(4).filter(|p| p[0] > 8 || p[1] > 8 || p[2] > 8).count();
    r.set_trails(0.9);
    play(&mut r, &mut audio, 2, 1.0 / 60.0);
    r.keep_outgoing();

    // Portrait: the presets read the new size and aspect.
    r.resize(H, W);
    let size = r.size();
    assert_eq!((size.texsize_x, size.texsize_y), (H as f64, W as f64));
    assert!(size.aspect_x() < 1.0 && size.aspect_y() == 1.0);
    // The picture so far is carried over, not black.
    let carried = r.read_back();
    assert_eq!(carried.len(), (H * W * 4) as usize);
    assert!(lit(&carried) > carried.len() / 4 / 4, "the picture is carried over");
    // So is the outgoing snapshot a transition fades from.
    let outgoing = presented(&mut r, Master { fade: 1.0, ..Master::default() });
    assert!(lit(&outgoing) > 0, "the outgoing snapshot is carried over");
    // It draws on at the new size, trails included.
    play(&mut r, &mut audio, 10, 1.0 / 60.0);
    let drawn = r.read_back();
    assert_eq!(drawn.len(), (H * W * 4) as usize);
    assert!(lit(&drawn) > 0);

    // Shown in a landscape window, it keeps its aspect: black at the sides, the
    // picture in the middle.
    let shown = presented(&mut r, Master::default());
    let column = |x: u32| (0..H).map(|y| &shown[((y * W + x) * 4) as usize..][..3]).collect::<Vec<_>>();
    assert!(column(0).iter().all(|p| p.iter().all(|&c| c == 0)), "a bar at the left");
    assert!(column(W - 1).iter().all(|p| p.iter().all(|&c| c == 0)), "a bar at the right");
    assert!(column(W / 2).iter().any(|p| p.iter().any(|&c| c > 8)), "the picture in the middle");

    // The same size again changes nothing; back to landscape draws as before.
    r.resize(H, W);
    assert_eq!(r.read_back().len(), (H * W * 4) as usize);
    r.resize(W, H);
    play(&mut r, &mut audio, 2, 1.0 / 60.0);
    assert_eq!(r.read_back().len(), (W * H * 4) as usize);
    assert!(lit(&presented(&mut r, Master::default())) > 0);
}

fn within(a: &[u8], b: &[u8], by: i32) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(&x, &y)| (x as i32 - y as i32).abs() <= by)
}

/// FNV-1a: a hash that is the same on every machine and Rust version.
fn fnv(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |h, &b| (h ^ b as u64).wrapping_mul(0x0100_0000_01b3))
}

#[test]
fn the_noise_textures_and_the_rng_after_them_are_pinned() {
    // Recorded on main before render.rs was split: any change to how the noise
    // is made, or to how much of the rng it uses, changes every preset that
    // samples noise or reads `rand_frame`.
    let (noise, mut rng) = noise_data();
    let got: Vec<(&str, usize, u32, u32, u64)> = noise.iter().map(|(name, data, side, depth)| (*name, data.len(), *side, *depth, fnv(data))).collect();
    let want = [
        ("noise_lq", 262144, 256, 1, 0x19ee_ef43_76ea_f56a),
        ("noise_lq_lite", 4096, 32, 1, 0xd5c7_cb99_a777_d320),
        ("noise_mq", 262144, 256, 1, 0xba08_1da6_7639_cca9),
        ("noise_hq", 262144, 256, 1, 0x946f_7159_1958_99f5),
        ("noisevol_lq", 131072, 32, 32, 0xd4d6_1de1_3e80_3e44),
        ("noisevol_hq", 131072, 32, 32, 0xe355_28bb_1378_a8ec),
    ];
    assert_eq!(got, want);
    let next: Vec<f64> = (0..4).map(|_| rng.random()).collect();
    assert_eq!(next, [0.407324416723607, 0.9245738508599992, 0.894555663611509, 0.8517825925096167]);
}

#[test]
fn a_preset_loaded_while_frozen_draws_after_its_equations() {
    let Some((mut r, mut audio)) = spiral(0) else { return };
    assert!(!r.pending);
    r.render(&mut audio, 0.0);
    assert!(r.pending, "the first frozen draw has run the equations");
    let frame = r.clock.frame;
    r.render(&mut audio, 0.0);
    assert_eq!(r.clock.frame, frame, "frozen, they run once");
}

#[test]
fn the_default_master_is_a_plain_blit() {
    let Some((mut r, _)) = spiral(20) else { return };
    let drawn = r.read_back();
    assert!(drawn.chunks(4).any(|p| p[0] > 0 || p[1] > 0 || p[2] > 0), "the spiral draws something");
    assert_eq!(r.master(), Master::default());
    assert!(within(&presented(&mut r, Master::default()), &drawn, 1));
}

#[test]
fn master_colour_effects() {
    let Some((mut r, _)) = spiral(20) else { return };
    let drawn = r.read_back();
    let inverted = presented(&mut r, Master { invert: 1.0, ..Default::default() });
    let ok = inverted.chunks(4).zip(drawn.chunks(4)).all(|(i, d)| (0..3).all(|c| (i[c] as i32 - (255 - d[c] as i32)).abs() <= 2));
    assert!(ok, "invert = 1 is 255 − x");
    let zero = |p: &[u8]| p.chunks(4).all(|p| p[0] == 0 && p[1] == 0 && p[2] == 0);
    assert!(zero(&presented(&mut r, Master { black: 1.0, flash: 1.0, ..Default::default() })), "black = 1 is black, even over a flash");
    assert!(zero(&presented(&mut r, Master { brightness: 0.0, ..Default::default() })), "brightness 0 is black");
    let hue0 = presented(&mut r, Master::default());
    let hue1 = presented(&mut r, Master { hue: 1.0, ..Default::default() });
    assert!(within(&hue0, &hue1, 2), "a whole turn of hue is the identity");
    let half = presented(&mut r, Master { hue: 0.5, ..Default::default() });
    assert!(!within(&hue0, &half, 2), "half a turn changes the colours");
    let white = presented(&mut r, Master { flash: 1.0, ..Default::default() });
    assert!(white.chunks(4).all(|p| p[..3] == [255, 255, 255]), "flash = 1 is white");
}

#[test]
fn master_mirrors() {
    let Some((mut r, _)) = spiral(20) else { return };
    let (w, h) = (W as usize, H as usize);
    let at = |p: &[u8], x: usize, y: usize| p[(y * w + x) * 4..(y * w + x) * 4 + 3].to_vec();
    let symmetric_x = |p: &[u8]| (0..h).all(|y| (0..w).all(|x| within(&at(p, x, y), &at(p, w - 1 - x, y), 1)));
    let symmetric_y = |p: &[u8]| (0..h).all(|y| (0..w).all(|x| within(&at(p, x, y), &at(p, x, h - 1 - y), 1)));
    let plain = presented(&mut r, Master::default());
    assert!(!symmetric_x(&plain), "the spiral is not symmetric to begin with");
    let x = presented(&mut r, Master { mirror: Mirror::X, ..Default::default() });
    assert!(symmetric_x(&x));
    let quad = presented(&mut r, Master { mirror: Mirror::Quad, punch: 0.5, ..Default::default() });
    assert!(symmetric_x(&quad) && symmetric_y(&quad));
}

#[test]
fn fade_shows_the_outgoing_snapshot() {
    let Some((mut r, mut audio)) = spiral(20) else { return };
    assert!(presented(&mut r, Master { fade: 1.0, ..Default::default() }).chunks(4).all(|p| p[..3] == [0, 0, 0]), "black before any snapshot");
    let kept = r.read_back();
    r.keep_outgoing();
    play(&mut r, &mut audio, 10, 1.0 / 60.0);
    assert!(!within(&r.read_back(), &kept, 1), "the picture has moved on");
    assert!(within(&presented(&mut r, Master { fade: 1.0, ..Default::default() }), &kept, 1));
}

#[test]
fn trails_echo_without_brightening() {
    let Some((mut r, mut audio)) = spiral(20) else { return };
    r.set_trails(0.9);
    play(&mut r, &mut audio, 1, 1.0 / 60.0);
    let mut previous = r.read_back();
    for _ in 0..8 {
        play(&mut r, &mut audio, 1, 1.0 / 60.0);
        let now = r.read_back();
        let ok = now.chunks(4).zip(previous.chunks(4)).all(|(n, p)| (0..3).all(|c| n[c] as i32 >= (p[c] as f32 * 0.9).floor() as i32 - 2));
        assert!(ok, "every pixel keeps at least 0.9 of the frame before");
        previous = now;
    }
    r.set_trails(5.0);
    assert_eq!(r.trails, 0.98);
}

#[test]
fn a_preset_draws_something() {
    let Some(mut r) = renderer(256, 192, SPIRAL) else { return };
    play(&mut r, &mut Audio::default(), 30, 1.0 / 60.0);
    let pixels = r.read_back();
    assert_eq!(pixels.len(), 256 * 192 * 4);
    assert!(pixels.chunks(4).all(|p| p[3] == 255), "comp writes opaque pixels");
}

/// The Spiral fixture at 64×36, run for `seconds` of real time at `hz`
/// refreshes a second and `speed`, hearing the same tone throughout.
fn run_at(hz: f64, speed: f64, seconds: f64) -> Option<Renderer> {
    run_with(hz, speed, seconds).map(|(r, _)| r)
}

/// [`run_at`], and the audio it heard, to carry on with.
fn run_with(hz: f64, speed: f64, seconds: f64) -> Option<(Renderer, Audio)> {
    let mut r = renderer(W, H, SPIRAL)?;
    let mut audio = Audio::default();
    play(&mut r, &mut audio, (seconds * hz).round() as usize, speed / hz);
    Some((r, audio))
}

fn mean_difference(a: &[u8], b: &[u8]) -> f64 {
    a.iter().zip(b).map(|(&x, &y)| (x as f64 - y as f64).abs()).sum::<f64>() / a.len() as f64
}

#[test]
fn a_second_is_thirty_steps_at_any_refresh_rate() {
    let Some(at30) = run_at(30.0, 1.0, 1.0) else { return };
    assert_eq!((at30.steps(), at30.clock.frame), (30, 30), "the equations run once a step, 30 times a second");
    let picture = at30.read_back();
    for hz in [60.0, 120.0, 144.0] {
        let r = run_at(hz, 1.0, 1.0).unwrap();
        assert_eq!((r.steps(), r.clock.frame), (30, 30), "{hz} Hz");
        // Motion, decay, waves and shapes are fed back once a step whatever the
        // display does in between: the same picture, to the bit.
        assert!(r.read_back() == picture, "{hz} Hz draws a different picture after a second");
    }
}

#[test]
fn speed_scales_the_preset_clock() {
    let Some(half) = run_at(120.0, 0.5, 2.0) else { return };
    assert_eq!(half.steps(), 30, "half speed: 30 steps in 2 s");
    let at30 = run_at(30.0, 1.0, 1.0).unwrap();
    let time = |r: &Renderer| r.runner.as_ref().unwrap().get("time");
    assert_eq!(time(&half), time(&at30), "the preset's time ran at half speed");
    assert!(half.read_back() == at30.read_back(), "the same steps, so the same picture");
    let double = run_at(60.0, 2.0, 0.5).unwrap();
    assert_eq!(double.steps(), 30);
    assert!(double.read_back() == half.read_back());
}

#[test]
fn between_steps_the_picture_moves_on_without_a_jump() {
    let Some(on) = run_at(30.0, 1.0, 1.0) else { return };
    let step = on.read_back();
    // 29 steps and nearly all of the 30th, at 120 Hz.
    let (mut r, mut audio) = run_with(120.0, 1.0, 29.0 / 30.0).unwrap();
    let mut at = |r: &mut Renderer, steps: f64| {
        r.render(&mut audio, steps / PRESET_RATE);
        r.read_back()
    };
    let quarter = at(&mut r, 0.25);
    let nearly = at(&mut r, 0.74);
    assert_eq!(r.steps(), 29);
    assert!(mean_difference(&nearly, &step) < 1.5, "just short of a step is nearly that step: {}", mean_difference(&nearly, &step));
    assert!(mean_difference(&quarter, &step) > mean_difference(&nearly, &step), "a quarter of the way is further from it");
    let landed = at(&mut r, 0.01);
    assert_eq!(r.steps(), 30);
    assert!(landed == step, "landing on the step is the step");
}

/// A white square sliding right at a steady 1.5 widths a second of preset
/// time, on black: its warp shader draws black, so it leaves no trail.
const SLIDE: &str = "[preset00]
MILKDROP_PRESET_VERSION=201
PSVERSION=2
fGammaAdj=1.0
fWaveAlpha=0.0
zoom=1.0
rot=0.0
warp=0.0
mv_a=0.0
shapecode_0_enabled=1
shapecode_0_sides=4
shapecode_0_x=0.1
shapecode_0_y=0.5
shapecode_0_rad=0.04
shapecode_0_r=1
shapecode_0_g=1
shapecode_0_b=1
shapecode_0_a=1
shapecode_0_r2=1
shapecode_0_g2=1
shapecode_0_b2=1
shapecode_0_a2=1
shapecode_0_border_a=0
shape_0_per_frame1=x = 0.1 + time*1.5;
warp_1=`shader_body {
warp_2=`ret = 0;
warp_3=`}
";

/// A comp shader that brightens the whole picture steadily with `time`.
const RAMP: &str = "[preset00]
MILKDROP_PRESET_VERSION=201
PSVERSION=2
fDecay=0.0
fWaveAlpha=0.0
comp_1=`shader_body {
comp_2=`ret = float3(1,1,1) * saturate(0.05 + time);
comp_3=`}
";

/// `text` drawn at 256×144, `hz` refreshes a second at `speed`: 3 steps, then
/// each refresh over the next `steps`, measured by `measure`.
fn each_refresh(text: &str, hz: f64, speed: f64, steps: f64, mut measure: impl FnMut(&[u8]) -> f64) -> Option<Vec<f64>> {
    let mut r = renderer(256, 144, text)?;
    let mut audio = Audio::default();
    let per = speed / hz;
    let warm = (3.0 / PRESET_RATE / per).round() as usize;
    let mut out = Vec::new();
    for i in 0..warm + (steps / PRESET_RATE / per).round() as usize {
        r.render(&mut audio, per);
        if i >= warm {
            out.push(measure(&r.read_back()));
        }
    }
    Some(out)
}

/// How far each refresh's change is from the mean change: 0 for perfectly
/// even motion.
fn unevenness(values: &[f64]) -> f64 {
    let moves: Vec<f64> = values.windows(2).map(|w| w[1] - w[0]).collect();
    let mean = moves.iter().sum::<f64>() / moves.len() as f64;
    moves.iter().map(|m| (m - mean).abs()).fold(0.0, f64::max)
}

/// Where the bright pixels are across, in pixels: the square, not the faint
/// picture of it a refresh between steps carries on from (the warp's black
/// is mixed in by the fraction).
fn across(pixels: &[u8]) -> f64 {
    let (mut sum, mut n) = (0.0f64, 0.0f64);
    for (i, p) in pixels.chunks(4).enumerate() {
        if p[0] as u32 + p[1] as u32 + p[2] as u32 > 3 * 160 {
            sum += (i % 256) as f64;
            n += 1.0;
        }
    }
    sum / n.max(1.0)
}

fn brightness(pixels: &[u8]) -> f64 {
    pixels.chunks(4).map(|p| p[0] as f64).sum::<f64>() / (pixels.len() / 4) as f64
}

#[test]
fn between_steps_motion_is_even_at_every_refresh_rate_and_speed() {
    // A step moves the square 1.5 × 256 / 30 = 12.8 px and brightens the
    // ramp by 255 / 30 = 8.5 levels. Drawn as a jump at one refresh in the
    // step (or a cross-fade, which flips at half way), some refreshes would
    // move a whole step and the rest nothing: off the mean by most of a step.
    // Even, each refresh moves its share, off the mean by no more than the
    // rounding to whole pixels (the square's edges, ±½ px each end) and
    // 8-bit levels.
    for (hz, speed) in [(60.0, 1.0), (120.0, 1.0), (60.0, 0.25), (120.0, 0.25), (60.0, 4.0), (120.0, 4.0)] {
        let Some(xs) = each_refresh(SLIDE, hz, speed, 10.0, across) else { return };
        assert!((xs[xs.len() - 1] - xs[0]) > 60.0, "{hz} Hz at {speed}×: the square moved across");
        let off = unevenness(&xs);
        assert!(off < 1.5, "{hz} Hz at {speed}×: a refresh moves the square {off:.2} px off the mean");
        let levels = each_refresh(RAMP, hz, speed, 10.0, brightness).unwrap();
        assert!((levels[levels.len() - 1] - levels[0]) > 40.0, "{hz} Hz at {speed}×: the ramp brightened");
        let off = unevenness(&levels);
        assert!(off < 1.5, "{hz} Hz at {speed}×: a refresh brightens the ramp {off:.2} levels off the mean");
    }
}

/// Like Dancer/Comet Mirror/448: a square climbing the left half and
/// leaving a trail, a hard fade a step (`× 0.85 − 0.02`), a fold that mirrors
/// the left half onto the right (`dx = x − ox`), and blur in comp.
const FOLD: &str = "[preset00]
MILKDROP_PRESET_VERSION=201
PSVERSION=2
fGammaAdj=1.0
fWaveAlpha=0.0
zoom=1.0
rot=0.0
warp=0.0
mv_a=0.0
shapecode_0_enabled=1
shapecode_0_sides=4
shapecode_0_x=0.25
shapecode_0_y=0.1
shapecode_0_rad=0.1
shapecode_0_r=1
shapecode_0_g=0.6
shapecode_0_b=0.2
shapecode_0_a=1
shapecode_0_r2=1
shapecode_0_g2=0.6
shapecode_0_b2=0.2
shapecode_0_a2=1
shapecode_0_border_a=0
shape_0_per_frame1=y = 0.1 + time*1.2;
per_pixel_1=dx = above(x, 0.5) * (2*x - 1);
warp_1=`shader_body {
warp_2=`ret = tex2D(sampler_main, uv).xyz * 0.85 - 0.02;
warp_3=`}
comp_1=`shader_body {
comp_2=`ret = tex2D(sampler_main, uv).xyz + GetBlur1(uv) * 0.5;
comp_3=`}
";

#[test]
fn between_steps_a_folding_fading_trail_changes_evenly() {
    // Each refresh between steps should change the picture about as much as
    // any other in the step. Moving the fold by a fraction smears the right
    // half across the picture and back: drawn that way, at 120 Hz one phase
    // of a step changed this picture 2.1× as much as another (and 448's by
    // ~50 levels a refresh against 1.4 a step). Now 1.07–1.28.
    for (hz, speed) in [(60.0, 1.0), (120.0, 1.0), (60.0, 0.25), (120.0, 0.25)] {
        let mut before: Vec<u8> = Vec::new();
        let Some(changes) = each_refresh(FOLD, hz, speed, 12.0, |p| {
            let d = if before.is_empty() { f64::NAN } else { mean_difference(&before, p) };
            before = p.to_vec();
            d
        }) else {
            return;
        };
        let per = (hz / (PRESET_RATE * speed)).round() as usize;
        let mut by_phase = vec![0.0; per];
        for (i, d) in changes.iter().enumerate().skip(1) {
            by_phase[i % per] += d;
        }
        let (lo, hi) = by_phase.iter().fold((f64::MAX, 0.0f64), |(lo, hi), &v| (lo.min(v), hi.max(v)));
        assert!(lo > 0.0, "{hz} Hz at {speed}×: every refresh moves the picture on");
        assert!(hi / lo < 1.5, "{hz} Hz at {speed}×: one phase of a step changes the picture {:.2}× as much as another: {by_phase:?}", hi / lo);
    }
}

#[test]
fn blur_ranges_nest_and_keep_butterchurns_quirk() {
    // Level 1 is too narrow: both ends become avg − 0.05 = 0.46. Level 2 is
    // clamped to that adjusted range (0.46..0.46), then widened the same way
    // to 0.41. Level 3, clamped to 0.6..0.3, ends at 0.45 − 0.05.
    let text = "[preset00]\nper_frame_1=b1n = 0.5; b1x = 0.52; b2n = 0; b2x = 1; b3n = 0.6; b3x = 0.3;\n";
    let Some(mut r) = renderer(W, H, text) else { return };
    play(&mut r, &mut Audio::default(), 1, 1.0 / 30.0);
    let (mins, maxs) = Renderer::blur_values(r.runner.as_ref().unwrap());
    let near = |a: [f64; 3], b: [f64; 3]| a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-9);
    assert!(near(mins, [0.46, 0.41, 0.4]), "{mins:?}");
    assert!(near(maxs, [0.46, 0.41, 0.4]), "{maxs:?}");
}

#[test]
fn stage_previews_and_live_values() {
    let Some(mut r) = renderer(256, 192, SPIRAL) else { return };
    assert!(r.read_previews().is_none(), "off until asked for");
    let all: Vec<usize> = (0..PREVIEWS.len()).collect();
    r.set_previews(&all, PREVIEW);
    let mut audio = Audio::default();
    play(&mut r, &mut audio, 30, 1.0 / 60.0);
    let read = r.read_previews().unwrap();
    assert_eq!((read.size, read.which), (PREVIEW, all));
    let pixels = read.pixels;
    let each = (PREVIEW.0 * PREVIEW.1 * 4) as usize;
    assert_eq!(pixels.len(), each * PREVIEWS.len());
    let comp = &pixels[each * 3..];
    assert!(comp[..each].chunks(4).any(|p| p[0] > 0 || p[1] > 0 || p[2] > 0), "comp's preview has a picture");
    let lit = |which: usize| pixels[each * which..each * (which + 1)].chunks(4).any(|p| p[0] > 0 || p[1] > 0 || p[2] > 0);
    let drew: Vec<&str> = (4..PREVIEWS.len()).filter(|&w| lit(w)).map(|w| PREVIEWS[w]).collect();
    assert!(!drew.is_empty(), "some drawing stage's preview has its drawing");
    let off: Vec<&str> = (0..4).filter(|i| r.runner.as_ref().unwrap().waves[*i].is_none()).map(|i| PREVIEWS[4 + i]).collect();
    assert!(off.iter().all(|w| !drew.contains(w)), "a wave that is off draws nothing: {drew:?}");

    // A subset at twice the size: only those, ascending, at that size; an
    // unknown stage is ignored.
    let big = (PREVIEW.0 * 2, PREVIEW.1 * 2);
    let layer = PREVIEWS.iter().position(|n| *n == drew[0]).unwrap();
    r.set_previews(&[layer, 0, 3, 99], big);
    play(&mut r, &mut audio, 4, 1.0 / 30.0);
    let read = r.read_previews().unwrap();
    assert_eq!((read.size, read.which.clone()), (big, vec![0, 3, layer]));
    let each = (big.0 * big.1 * 4) as usize;
    assert_eq!(read.pixels.len(), each * 3);
    let lit = |i: usize| read.pixels[each * i..each * (i + 1)].chunks(4).any(|p| p[0] > 0 || p[1] > 0 || p[2] > 0);
    assert!((0..3).all(lit), "each picture of the subset has its picture");
    // Too big is clamped; none, or only indices that aren't stages, stops them.
    assert!(r.set_previews(&[1], (10_000, 10_000)));
    r.render(&mut audio, 1.0 / 30.0);
    assert_eq!(r.read_previews().unwrap().size, PREVIEW_MAX);
    assert!(!r.set_previews(&[99], PREVIEW));
    assert!(r.read_previews().is_none());
    assert!(r.set_previews(&[1], PREVIEW));
    assert!(!r.set_previews(&[], PREVIEW));
    assert!(r.read_previews().is_none());

    assert!(r.set_value(crate::runtime::Owner::Base, "fDecay", 0.5));
    r.render(&mut audio, 1.0 / 60.0);
    assert_eq!(r.runner.as_ref().unwrap().base_value("decay"), 0.5);
    assert_eq!(r.runner.as_ref().unwrap().preset.values["fDecay"], 0.5);
    assert!(!r.set_value(crate::runtime::Owner::Waves(0), "enabled", 1.0), "turning a wave on needs a reload");
}
