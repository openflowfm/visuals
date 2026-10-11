use super::*;

const W: usize = SIZE.0 as usize;
const H: usize = SIZE.1 as usize;

/// A fixed pseudo-random byte per pixel and seed.
fn noise(x: usize, y: usize, seed: u64) -> u8 {
    let h = ((x as u64).wrapping_mul(73_856_093) ^ (y as u64).wrapping_mul(19_349_663) ^ seed.wrapping_mul(83_492_791)).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    (h >> 56) as u8
}

/// Feeds every condition `picture(condition, step)` and returns the features.
fn collect(picture: impl Fn(Condition, u32) -> Vec<u8>) -> BTreeMap<String, Option<f32>> {
    let mut c = Collector::new();
    for condition in Condition::ALL {
        for step in 1..=STEPS {
            if Collector::wants(condition, step) {
                let rgba = picture(condition, step);
                let small = analyse::shrink(&rgba, W, H, 2);
                c.add(condition, step, &rgba, &small);
            }
        }
    }
    c.finish()
}

fn solid(r: u8, g: u8, b: u8) -> Vec<u8> {
    [r, g, b, 255].repeat(W * H)
}

/// A textured blue pattern, scrolling right 2 px a step, brighter on the beat.
fn scrolling(step: u32) -> Vec<u8> {
    let beat = if step % BEAT as u32 == 0 { 60.0 } else { 0.0 };
    (0..W * H)
        .flat_map(|i| {
            let (x, y) = ((i % W) as f32 - 2.0 * step as f32, (i / W) as f32);
            let pattern = ((x * 0.35).sin() * (y * 0.22).cos() + 0.3 * (x * 0.065 + y * 0.145).sin()).clamp(-1.0, 1.0);
            let v = (100.0 + 70.0 * pattern + beat).clamp(0.0, 255.0) as u8;
            [v / 4, v / 2, v, 255]
        })
        .collect()
}

fn get(f: &BTreeMap<String, Option<f32>>, name: &str) -> Option<f32> {
    *f.get(name).unwrap_or_else(|| panic!("no feature {name}"))
}

#[test]
fn every_feature_is_named_once_and_given() {
    let names: Vec<&str> = NAMES.iter().map(|(n, _)| *n).collect();
    let mut unique = names.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), names.len());
    let f = collect(|_, s| scrolling(s));
    assert_eq!(f.keys().map(String::as_str).collect::<Vec<_>>(), unique, "finish gives exactly the named features");
}

#[test]
fn a_still_red_picture_and_a_moving_blue_one_differ_as_they_should() {
    let red = collect(|_, _| solid(220, 20, 10));
    let blue = collect(|_, s| scrolling(s));
    assert!(get(&red, "hue_red").unwrap() > 0.9);
    assert!(get(&red, "hue_temperature").unwrap() > 0.5);
    assert!(get(&blue, "hue_temperature").unwrap() < -0.5);
    assert_eq!((get(&red, "difference"), get(&red, "speed"), get(&red, "motion_coherence")), (Some(0.0), None, None), "still and flat");
    assert_eq!(get(&red, "correlation"), None, "flat");
    assert!(get(&blue, "difference").unwrap() > 1.0);
    // 2 px at 384 is 1 px at 192. A fifth of the steps measured follow a beat,
    // whose flash the matching loses: those count as the search's 8 px.
    let (speed, p90) = (get(&blue, "speed").unwrap(), get(&blue, "speed_p90").unwrap());
    assert!((p90 - 1.0).abs() < 0.3, "{p90}");
    assert!((speed - (0.8 + 0.2 * 8.0)).abs() < 0.3, "{speed}");
    assert!(get(&blue, "motion_coherence").unwrap() > 0.9);
    assert!(get(&blue, "pulse_brightness").unwrap() > 0.9, "brighter on every beat");
    assert_eq!(get(&red, "pulse_brightness"), None, "steady");
    // The same pictures under every condition: nothing reacts, no waves or shapes.
    for name in ["reactivity", "waves_difference", "shapes_difference", "reactivity_motion"] {
        assert_eq!(get(&blue, name), Some(0.0), "{name}");
    }
}

/// A pattern periodic in the log of the radius and in the angle, so it can zoom
/// and turn forever: each step it zooms by e^`zoom` and turns `turn` radians
/// anticlockwise on screen.
fn spinning(zoom: f32, turn: f32) -> impl Fn(Condition, u32) -> Vec<u8> {
    let polar: Vec<(f32, f32)> = (0..W * H)
        .map(|i| {
            let (x, y) = ((i % W) as f32 - W as f32 / 2.0 + 0.5, H as f32 / 2.0 - (i / W) as f32 - 0.5);
            (x.hypot(y).max(1.0).ln(), y.atan2(x))
        })
        .collect();
    move |_, step| {
        let (du, dt) = (zoom * step as f32, turn * step as f32);
        polar
            .iter()
            .flat_map(|&(u, t)| {
                let (u, t) = (u - du, t - dt);
                let pattern = (u * 9.0).sin() * (t * 10.0).cos() + 0.5 * (u * 23.0).sin() * (t * 7.0).sin();
                let v = (120.0 + 80.0 * pattern.clamp(-1.0, 1.0)) as u8;
                [v, v / 2, v / 3, 255]
            })
            .collect()
    }
}

#[test]
fn zooming_out_and_turning_clockwise_are_as_strong_as_their_opposites() {
    let strength = |f: &BTreeMap<String, Option<f32>>, name: &str| get(f, name).unwrap_or_else(|| panic!("{name} unmeasured"));
    let (anticlockwise, clockwise) = (collect(spinning(0.0, 0.015)), collect(spinning(0.0, -0.015)));
    let (zoom_in, zoom_out) = (collect(spinning(0.015, 0.0)), collect(spinning(-0.015, 0.0)));
    let (a, c) = (strength(&anticlockwise, "motion_swirl_strength"), strength(&clockwise, "motion_swirl_strength"));
    assert!(a > 0.3 && (a - c).abs() < 0.2 * a, "anticlockwise {a}, clockwise {c}");
    assert!(strength(&anticlockwise, "motion_swirl") > 0.3 && strength(&clockwise, "motion_swirl") < -0.3, "the signed swirl keeps its way");
    assert!(strength(&anticlockwise, "motion_radial_strength") < 0.5 * a, "a turn isn't a zoom");
    let (i, o) = (strength(&zoom_in, "motion_radial_strength"), strength(&zoom_out, "motion_radial_strength"));
    assert!(i > 0.3 && (i - o).abs() < 0.2 * i, "in {i}, out {o}");
    assert!(strength(&zoom_in, "motion_radial") * strength(&zoom_out, "motion_radial") < 0.0, "the signed radial keeps its way");
    assert!(strength(&zoom_in, "motion_swirl_strength") < 0.5 * i, "a zoom isn't a turn");
}

#[test]
fn reactivity_and_waves_come_from_the_other_conditions() {
    let f = collect(|c, s| match c {
        Condition::Silence => solid(0, 0, 0),
        Condition::NoWaves => scrolling(s + 7),
        _ => scrolling(s),
    });
    assert!(get(&f, "reactivity").unwrap() > 10.0);
    assert!(get(&f, "reactivity_motion").unwrap() > 1.0);
    assert_eq!(get(&f, "silence_difference"), Some(0.0));
    assert!(get(&f, "waves_difference").unwrap() > 1.0);
    assert_eq!(get(&f, "shapes_difference"), Some(0.0));
}

#[test]
fn noise_is_grainy_and_unfollowable() {
    let f = collect(|_, s| (0..W * H).flat_map(|i| [noise(i % W, i / W, s as u64); 3].into_iter().chain([255])).collect());
    assert!(get(&f, "grain_ratio").unwrap() > 1.3, "{:?}", get(&f, "grain_ratio"));
    assert!(get(&f, "correlation").unwrap().abs() < 0.1);
    assert!(get(&f, "motion_found").unwrap() < 0.2);
    assert_eq!(get(&f, "hue_red"), None, "grey");
    assert!(get(&f, "mirror_lr").unwrap().abs() < 0.1);
}

#[test]
fn the_clip_spans_two_seconds_from_step_90() {
    let steps = clip_steps();
    assert_eq!(steps.len(), 24);
    assert_eq!((steps[0], steps[1], steps[2], steps[23]), (90, 92, 95, 147));
    assert!(steps.iter().all(|&s| Collector::wants(Condition::Music, s)));
    assert_eq!(clip_name("0123456789abcdef0123"), "0123456789abcdef.webp");
}

#[test]
fn the_file_round_trips_and_starts_afresh_when_measured_otherwise() {
    let dir = std::env::temp_dir().join(format!("visuals-features-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("features.json");
    let mut f = Features::default();
    f.rows.push(Row { path: "b/x.milk".into(), hash: "ab".into(), style: "b".into(), features: [("speed".to_string(), None), ("brightness".to_string(), Some(0.5))].into(), clip: "ab.webp".into() });
    f.skipped.push(Skipped { path: "a/y.milk".into(), hash: "cd".into(), why: "timed out".into() });
    f.save(&file).unwrap();
    let text = std::fs::read_to_string(&file).unwrap();
    assert!(text.contains("\"speed\": null") && text.contains("\"conditions\": [\n    \"music\""), "{text}");
    assert_eq!(Features::load(&file), Some(f.clone()));
    f.analysis += 1;
    f.save(&file).unwrap();
    assert_eq!(Features::load(&file), None);
    std::fs::remove_dir_all(dir).unwrap();
}
