//! Live effects on the finished picture: the master pass, drawn every time the
//! picture is presented, and the trails echo, drawn once per made frame.
//!
//! The master pass is what a VJ plays on top of whatever preset is running —
//! brightness, hue, invert, mirror, strobe, blackout, a beat punch and the fade
//! to the outgoing preset's snapshot. With [`Master::default`] it is a plain blit.

/// How the master pass folds the picture onto itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Mirror {
    #[default]
    Off,
    /// The left half mirrored onto the right.
    X,
    /// One half mirrored onto the other vertically.
    Y,
    /// Both: a four-way kaleidoscope.
    Quad,
}

/// What the master pass does to the finished picture. Default is the identity.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Master {
    /// A multiplier: 1 is as drawn (0..2 expected).
    pub brightness: f32,
    /// Hue rotation in turns (0 and 1 are the identity).
    pub hue: f32,
    /// 0..1 mix toward 1 − colour.
    pub invert: f32,
    pub mirror: Mirror,
    /// 0..1 mix toward white (strobe).
    pub flash: f32,
    /// 0..1 mix toward black (blackout, strobe gaps).
    pub black: f32,
    /// 0..1: zoom in by up to 12% about the centre and brighten by up to 35%.
    pub punch: f32,
    /// 0..1 share of the outgoing preset's snapshot (transitions).
    pub fade: f32,
}

impl Default for Master {
    fn default() -> Self {
        Self { brightness: 1.0, hue: 0.0, invert: 0.0, mirror: Mirror::Off, flash: 0.0, black: 0.0, punch: 0.0, fade: 0.0 }
    }
}

/// The master pass's uniform, three `vec4f`s: `t` between the frame before and
/// the latest (see [`MASTER`]), then the effects.
pub fn uniforms(m: &Master, t: f32) -> [f32; 12] {
    let (mx, my) = match m.mirror {
        Mirror::Off => (0.0, 0.0),
        Mirror::X => (1.0, 0.0),
        Mirror::Y => (0.0, 1.0),
        Mirror::Quad => (1.0, 1.0),
    };
    let unit = |v: f32| v.clamp(0.0, 1.0);
    [
        unit(t),
        m.brightness.max(0.0),
        m.hue,
        unit(m.invert),
        mx,
        my,
        unit(m.flash),
        unit(m.black),
        unit(m.punch),
        unit(m.fade),
        0.0,
        0.0,
    ]
}

/// The master pass: the frame before and the latest mixed by `t`, the outgoing
/// snapshot mixed by `fade`, then the effects, into a window the right way up.
pub const MASTER: &str = "
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
  let p = vec2f(f32(i & 1u) * 2.0 - 1.0, f32(i >> 1u) * 2.0 - 1.0);
  var o: Out;
  o.pos = vec4f(p, 0.0, 1.0);
  o.uv = p * 0.5 + 0.5;
  return o;
}
struct U { a: vec4f, b: vec4f, c: vec4f }
@group(0) @binding(0) var before: texture_2d<f32>;
@group(0) @binding(1) var after: texture_2d<f32>;
@group(0) @binding(2) var outgoing: texture_2d<f32>;
@group(0) @binding(3) var smp: sampler;
@group(0) @binding(4) var<uniform> u: U;
@fragment fn fs(in: Out) -> @location(0) vec4f {
  let t = u.a.x; let brightness = u.a.y; let hue = u.a.z; let invert = u.a.w;
  let flash = u.b.z; let black = u.b.w; let punch = u.c.x; let fade = u.c.y;
  var uv = in.uv;
  uv = select(uv, min(uv, 1.0 - uv), u.b.xy > vec2f(0.5));
  uv = 0.5 + (uv - 0.5) * (1.0 - 0.12 * punch);
  var c = mix(textureSample(before, smp, uv).rgb, textureSample(after, smp, uv).rgb, t);
  c = mix(c, textureSample(outgoing, smp, uv).rgb, fade);
  let angle = hue * 6.283185307179586;
  let k = vec3f(0.5773502691896258);
  let cs = cos(angle);
  c = c * cs + cross(k, c) * sin(angle) + k * dot(k, c) * (1.0 - cs);
  c = mix(c, 1.0 - c, invert);
  c = c * brightness * (1.0 + 0.35 * punch);
  c = mix(c, vec3f(1.0), flash);
  c = mix(c, vec3f(0.0), black);
  return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), 1.0);
}";

/// The trails echo: the brighter of this frame and the frame before faded by
/// `k`, per channel. Both textures are the size of the target.
pub const TRAILS: &str = "
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32(i & 1u) * 2.0 - 1.0, f32(i >> 1u) * 2.0 - 1.0);
  return vec4f(p, 0.0, 1.0);
}
@group(0) @binding(0) var latest: texture_2d<f32>;
@group(0) @binding(1) var before: texture_2d<f32>;
@group(0) @binding(2) var<uniform> k: vec4f;
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let at = vec2i(pos.xy);
  let c = max(textureLoad(latest, at, 0).rgb, textureLoad(before, at, 0).rgb * k.x);
  return vec4f(c, 1.0);
}";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_the_identity_and_packs_t() {
        let u = uniforms(&Master::default(), 1.0);
        assert_eq!(u, [1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
        let quad = uniforms(&Master { mirror: Mirror::Quad, ..Default::default() }, 2.0);
        assert_eq!((quad[0], quad[4], quad[5]), (1.0, 1.0, 1.0));
    }
}
