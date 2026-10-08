//! A preset's warp or comp shader, from MilkDrop's HLSL to a validated `naga` module.
//!
//! MilkDrop 2 compiled its shaders with Direct3D 9's compiler, which was lenient in
//! ways current HLSL is not. So the preset's text is rewritten first — every rewrite
//! is a function here with its own tests — and then compiled HLSL → SPIR-V by
//! glslang and SPIR-V → `naga::Module` by naga, which wgpu turns into Metal. See
//! `docs/milkdrop-engine.md`.
//!
//! What the renderer can rely on in a translated module:
//!
//! - one entry point, `_milkdrop_main`, a fragment shader returning the colour;
//! - inputs at locations 0.. : for warp `uv`, `uv_orig` and a colour the output
//!   is multiplied by; for comp the mesh position and a colour (`hue_shader` and
//!   the output alpha) — `rad`, `ang` and comp's `uv` are derived per pixel;
//! - MilkDrop's uniforms in one buffer, each named `_u_<name>` (`_u_time`, `_u__qa`…);
//! - each texture as `<name>_tex` with a sampler `<name>_smp` (`sampler_main_tex`).

use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Warp,
    Comp,
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("no shader_body")]
    NoBody,
    #[error("glslang: {0}")]
    Compile(String),
    #[error("naga could not read the SPIR-V: {0}")]
    Read(String),
    #[error("naga rejected the module: {0}")]
    Invalid(String),
}

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("pattern"))
}

// --- the rewrites ------------------------------------------------------------

/// Uniforms MilkDrop declares for every shader, by type.
const UNIFORMS: &[(&str, &str)] = &[
    ("float", "time"), ("float", "fps"), ("float", "frame"), ("float", "progress"),
    ("float", "bass"), ("float", "mid"), ("float", "treb"), ("float", "vol"),
    ("float", "bass_att"), ("float", "mid_att"), ("float", "treb_att"), ("float", "vol_att"),
    ("float4", "aspect"), ("float4", "texsize"),
    ("float4", "texsize_noise_lq"), ("float4", "texsize_noise_mq"), ("float4", "texsize_noise_hq"),
    ("float4", "texsize_noise_lq_lite"), ("float4", "texsize_noisevol_lq"), ("float4", "texsize_noisevol_hq"),
    ("float4", "rand_frame"), ("float4", "rand_preset"),
    ("float4", "roam_cos"), ("float4", "roam_sin"), ("float4", "slow_roam_cos"), ("float4", "slow_roam_sin"),
    ("float4", "_qa"), ("float4", "_qb"), ("float4", "_qc"), ("float4", "_qd"),
    ("float4", "_qe"), ("float4", "_qf"), ("float4", "_qg"), ("float4", "_qh"),
    ("float4", "_c5"), ("float4", "_c6"),
    ("float", "blur1_min"), ("float", "blur1_max"), ("float", "blur2_min"),
    ("float", "blur2_max"), ("float", "blur3_min"), ("float", "blur3_max"),
    // Only MilkDrop's default shaders read these, under names no preset uses:
    // _d0 = (decay, gammaadj, echo_zoom, echo_alpha),
    // _d1 = (echo_orient, fshader, brighten, darken), _d2 = (solarize, invert, 0, 0).
    ("float4", "_d0"), ("float4", "_d1"), ("float4", "_d2"),
];

/// Butterchurn's warp shader when a preset has none.
pub const DEFAULT_WARP: &str = "shader_body { ret = tex2D(sampler_main, uv).xyz * _d0.x; }";

/// Butterchurn's comp shader when a preset has none: video echo, gamma, the hue
/// shader, and the four output switches.
pub const DEFAULT_COMP: &str = "shader_body {
  float orient_horiz = fmod(_d1.x, 2.0);
  float orient_x = (orient_horiz != 0.0) ? -1.0 : 1.0;
  float orient_y = (_d1.x >= 2.0) ? -1.0 : 1.0;
  float2 uv_echo = ((uv - 0.5) * (1.0 / _d0.z) * float2(orient_x, orient_y)) + 0.5;
  ret = lerp(tex2D(sampler_main, uv).xyz, tex2D(sampler_main, uv_echo).xyz, _d0.w);
  ret *= _d0.y;
  if (_d1.y >= 1.0) { ret *= hue_shader; }
  else if (_d1.y > 0.001) { ret *= (1.0 - _d1.y) + (_d1.y * hue_shader); }
  if (_d1.z != 0) ret = sqrt(ret);
  if (_d1.w != 0) ret = ret*ret;
  if (_d2.x != 0) ret = ret * (1.0 - ret) * 4.0;
  if (_d2.y != 0) ret = 1.0 - ret;
}";

/// Which preset value each `_d` uniform component of the default shaders holds,
/// by the name equations use ([`default_uniforms`] fills them from it).
const DEFAULT_VALUES: [(&str, &str); 10] = [
    ("_d0.x", "decay"), ("_d0.y", "gammaadj"), ("_d0.z", "echo_zoom"), ("_d0.w", "echo_alpha"),
    ("_d1.x", "echo_orient"), ("_d1.y", "fshader"), ("_d1.z", "brighten"), ("_d1.w", "darken"),
    ("_d2.x", "solarize"), ("_d2.y", "invert"),
];

/// The `_d0`–`_d2` uniforms, filled per [`DEFAULT_VALUES`] from the preset
/// values `get` reads; components no value names stay 0.
pub(crate) fn default_uniforms(get: impl Fn(&str) -> f64) -> [(&'static str, Vec<f32>); 3] {
    let mut d = [("_d0", vec![0.0; 4]), ("_d1", vec![0.0; 4]), ("_d2", vec![0.0; 4])];
    for (uniform, name) in DEFAULT_VALUES {
        let (vector, component) = uniform.split_once('.').unwrap();
        let i = d.iter().position(|(n, _)| *n == vector).unwrap();
        d[i].1["xyzw".find(component).unwrap()] = get(name) as f32;
    }
    d
}

/// A number as an HLSL float literal: `2.0`, `0.98`, `(-0.5)`.
fn literal(v: f64) -> String {
    let text = if v.fract() == 0.0 && v.abs() < 1e15 {
        format!("{:.1}", v.abs())
    } else {
        let t = format!("{:.6}", v.abs());
        t.trim_end_matches('0').to_string()
    };
    if v < 0.0 { format!("(-{text})") } else { text }
}

/// Whether `if (a op b)` holds, when both sides are numbers.
fn constant_condition(condition: &str) -> Option<bool> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let c = re(&RE, r"^\(?(-?[\d.]+)\)?\s*(!=|>=|>|==)\s*(-?[\d.]+)$").captures(condition.trim())?;
    let (a, b): (f64, f64) = (c[1].parse().ok()?, c[3].parse().ok()?);
    Some(match &c[2] {
        "!=" => a != b,
        ">=" => a >= b,
        ">" => a > b,
        _ => a == b,
    })
}

/// MilkDrop's default warp or comp shader as standalone code for `preset`: the
/// values the engine passes it in `_d` uniforms (decay, gamma, echo, the hue
/// shader and the output switches) written in as numbers, and the switches that
/// numbers now decide folded away. The same picture the moment it is written,
/// and plain MilkDrop that any player can run — the `_d` uniforms are this
/// engine's alone.
pub fn written_default(kind: Kind, preset: &crate::preset::Preset) -> String {
    let values = crate::runtime::base_values(&preset.values, crate::runtime::BASE_DEFAULTS);
    let mut text = match kind {
        Kind::Warp => DEFAULT_WARP,
        Kind::Comp => DEFAULT_COMP,
    }
    .to_string();
    for (uniform, name) in DEFAULT_VALUES {
        text = text.replace(uniform, &literal(values.get(name).copied().unwrap_or(0.0)));
    }
    // Lines of `if (number op number) statement`, and `else if` after them:
    // kept as the bare statement when they hold, dropped when they don't.
    static IF: OnceLock<Regex> = OnceLock::new();
    let if_line = re(&IF, r"^(\s*)(else\s+)?if\s*\((.+?)\)\s+(.*)$");
    let mut out = Vec::new();
    let mut taken: Option<bool> = None;
    for line in text.lines().flat_map(|l| if l.trim_start().starts_with("shader_body {") && l.trim() != "shader_body {" {
        // `shader_body { body }` on one line: its own lines, so the body reads like the comp's.
        let body = l.trim().trim_start_matches("shader_body {").trim_end_matches('}').trim().to_string();
        vec!["shader_body {".to_string(), format!("  {body}"), "}".to_string()]
    } else {
        vec![l.to_string()]
    }) {
        let folded = if_line.captures(&line).and_then(|c| {
            let holds = constant_condition(&c[3])?;
            Some((c[1].to_string(), c.get(2).is_some(), holds, c[4].to_string()))
        });
        match folded {
            Some((indent, chained, holds, statement)) => {
                if chained && taken == Some(true) {
                    continue;
                }
                taken = Some(holds);
                if holds {
                    let statement = statement.trim();
                    let statement = statement.strip_prefix('{').and_then(|s| s.strip_suffix('}')).unwrap_or(statement).trim();
                    out.push(format!("{indent}{statement}"));
                }
            }
            None => {
                taken = None;
                out.push(line);
            }
        }
    }
    let what = match kind {
        Kind::Warp => "warp, with this preset's decay",
        Kind::Comp => "composite, with this preset's gamma, echo and switches",
    };
    format!("// MilkDrop's default {what} written in.\n{}", out.join("\n").replace("shader_body {", "shader_body\n{"))
}

/// MilkDrop's random rotation matrices, `float4x3` in its preamble.
const ROTATIONS: &[&str] = &[
    "rot_s1", "rot_s2", "rot_s3", "rot_s4", "rot_d1", "rot_d2", "rot_d3", "rot_d4",
    "rot_f1", "rot_f2", "rot_f3", "rot_f4", "rot_vf1", "rot_vf2", "rot_vf3", "rot_vf4",
    "rot_uf1", "rot_uf2", "rot_uf3", "rot_uf4", "rot_rand1", "rot_rand2", "rot_rand3", "rot_rand4",
];

/// Textures every shader can read.
pub const TEXTURES_2D: &[&str] = &[
    "sampler_main", "sampler_fw_main", "sampler_fc_main", "sampler_pw_main", "sampler_pc_main",
    "sampler_blur1", "sampler_blur2", "sampler_blur3",
    "sampler_noise_lq", "sampler_noise_lq_lite", "sampler_noise_mq", "sampler_noise_hq",
    "sampler_pw_noise_lq",
];
pub const TEXTURES_3D: &[&str] = &["sampler_noisevol_lq", "sampler_noisevol_hq"];

/// Rewrite 1 and 4: MilkDrop's preamble. Uniforms live in one buffer under `_u_`
/// names, because D3D9 let a shader assign to a uniform and HLSL no longer does;
/// the names presets use are `static` copies, filled at the top of `main` by
/// [`copy_uniforms`]. The rotations are stored 4×4 — `float4x3` in a buffer packs
/// so that its members overlap, which naga refuses — and cast down on copy.
pub fn preamble() -> String {
    let mut out = String::from("cbuffer _md {\n");
    for (ty, name) in UNIFORMS {
        out += &format!("  {ty} _u_{name};\n");
    }
    for name in ROTATIONS {
        out += &format!("  float4x4 _u_{name};\n");
    }
    out += "};\n";
    for (ty, name) in UNIFORMS {
        out += &format!("static {ty} {name};\n");
    }
    for name in ROTATIONS {
        out += &format!("static float4x3 {name};\n");
    }
    for name in TEXTURES_2D {
        out += &format!("Texture2D {name}_tex; SamplerState {name}_smp;\n");
    }
    for name in TEXTURES_3D {
        out += &format!("Texture3D {name}_tex; SamplerState {name}_smp;\n");
    }
    for i in 0..32 {
        out += &format!("#define q{} _q{}.{}\n", i + 1, (b'a' + (i / 4) as u8) as char, ['x', 'y', 'z', 'w'][i % 4]);
    }
    out += "#define M_PI 3.14159265359\n#define M_PI_2 6.28318530718\n#define M_INV_PI_2 0.159154943091895\n";
    out += "#define GetMain(uv) (sampler_main_tex.Sample(sampler_main_smp,uv).xyz)\n";
    out += "#define GetPixel(uv) (sampler_main_tex.Sample(sampler_main_smp,uv).xyz)\n";
    out += "#define GetBlur1(uv) (sampler_blur1_tex.Sample(sampler_blur1_smp,uv).xyz*_c5.x + _c5.y)\n";
    out += "#define GetBlur2(uv) (sampler_blur2_tex.Sample(sampler_blur2_smp,uv).xyz*_c5.z + _c5.w)\n";
    out += "#define GetBlur3(uv) (sampler_blur3_tex.Sample(sampler_blur3_smp,uv).xyz*_c6.x + _c6.y)\n";
    out += "#define lum(x) (dot(x,float3(0.32,0.49,0.29)))\n";
    // `tex2D(main, uv)`: presets name built-in textures without the prefix too.
    for name in TEXTURES_2D.iter().chain(TEXTURES_3D) {
        let short = name.trim_start_matches("sampler_");
        out += &format!("#define {short}_tex {name}_tex\n#define {short}_smp {name}_smp\n");
    }
    out
}

/// A texture sampled but never declared — MilkDrop loads textures by name, and
/// some presets never declare theirs — is declared, so the shader compiles and the
/// renderer binds it like any other preset texture.
pub fn declare_textures(head: &str, body: &str) -> String {
    static USE: OnceLock<Regex> = OnceLock::new();
    let known = |name: &str| {
        TEXTURES_2D.iter().chain(TEXTURES_3D).any(|t| *t == name || t.trim_start_matches("sampler_") == name)
            || head.contains(&format!("{name}_tex;"))
    };
    let mut seen = std::collections::BTreeSet::new();
    for m in re(&USE, r"\b(\w+)_tex\.Sample").captures_iter(&format!("{head}\n{body}")) {
        let name = m[1].to_owned();
        if !known(&name) {
            seen.insert(name);
        }
    }
    seen.iter().map(|n| format!("Texture2D {n}_tex; SamplerState {n}_smp;\n")).collect()
}

/// The statements at the top of `main` that fill the `static` copies.
pub fn copy_uniforms() -> String {
    let mut out = String::new();
    for (_, name) in UNIFORMS {
        out += &format!("{name} = _u_{name}; ");
    }
    for name in ROTATIONS {
        out += &format!("{name} = (float4x3)_u_{name}; ");
    }
    out
}

/// Rewrite 3: DX9's combined samplers, split. naga does not read a combined
/// image-sampler, so `sampler2D s;` becomes a texture and a sampler and
/// `tex2D(s, uv)` becomes `s_tex.Sample(s_smp, uv)`. 3D likewise.
pub fn split_samplers(code: &str) -> String {
    static CALL: OnceLock<Regex> = OnceLock::new();
    static LOD: OnceLock<Regex> = OnceLock::new();
    static BIAS: OnceLock<Regex> = OnceLock::new();
    static DECL: OnceLock<Regex> = OnceLock::new();
    // `tex2Dlod(s, float4(uv, 0, lod))` and `tex2Dbias(s, float4(uv, 0, bias))`
    // take their extra argument in `.w`; HLSL's methods want it separately.
    let code = re(&LOD, r"\btex2D[lL]od\s*\(\s*(\w+)\s*,").replace_all(code, "_tex2Dlod(${1}_tex, ${1}_smp,");
    let code = re(&BIAS, r"\btex2D[bB]ias\s*\(\s*(\w+)\s*,").replace_all(&code, "_tex2Dbias(${1}_tex, ${1}_smp,");
    let code = re(&CALL, r"\btex([23])[dD]\s*\(\s*(\w+)\s*,").replace_all(&code, "${2}_tex.Sample(${2}_smp,");
    re(&DECL, r"(?m)^(\s*)(?:uniform\s+)?sampler([23])D\s+(\w+)\s*;")
        .replace_all(&code, "${1}Texture${2}D ${3}_tex; SamplerState ${3}_smp;")
        .into_owned()
}

/// Helpers the sampler rewrite calls into. Macros, because glslang's HLSL front
/// end will not pass a texture to a function.
const HELPERS: &str = "\
#define _tex2Dlod(t, s, uv) (t.SampleLevel(s, (uv).xy, (uv).w))\n\
#define _tex2Dbias(t, s, uv) (t.SampleBias(s, (uv).xy, (uv).w))\n";

/// Rewrite 2, the preset's half: its top-level variables made `static`, since HLSL
/// treats a global as a uniform and D3D9 let presets assign to theirs. Samplers it
/// declares that the preamble already has are dropped rather than redeclared, and
/// `texture` declarations, which nothing reads, go too.
pub fn fix_head(head: &str) -> String {
    static SAMPLER: OnceLock<Regex> = OnceLock::new();
    static VARIABLE: OnceLock<Regex> = OnceLock::new();
    let sampler = re(&SAMPLER, r"^(\s*)(?:(?:uniform|static|const)\s+)?(sampler(?:2D|3D)?|texture)\s+(\w+)\s*;\s*$");
    let variable = re(&VARIABLE, r"^(\s*)((?:float|half|int|bool|uint|double)(?:[1-4](?:x[1-4])?)?\s+\w+\s*[=,;\[])");
    let known = |name: &str| TEXTURES_2D.contains(&name) || TEXTURES_3D.contains(&name);

    let mut out = String::new();
    let mut statement = String::new();
    let mut depth = 0usize;
    for ch in head.chars() {
        statement.push(ch);
        // A preprocessor line ends at its newline and is never a declaration.
        if ch == '\n' && depth == 0 && statement.trim_start().starts_with('#') {
            out += &statement;
            statement.clear();
            continue;
        }
        match ch {
            '{' => {
                if depth == 0 {
                    out += &statement;
                    statement.clear();
                }
                depth += 1;
            }
            '}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    out += &statement;
                    statement.clear();
                }
            }
            ';' if depth == 0 => {
                if let Some(m) = sampler.captures(&statement) {
                    if &m[2] == "texture" || known(&m[3]) {
                        out += &m[1];
                    } else {
                        out += &format!("{}sampler2D {};", &m[1], &m[3]);
                    }
                } else if let Some(m) = variable.captures(&statement) {
                    out += &statement.replacen(&m[2], &format!("static {}", &m[2]), 1);
                } else {
                    out += &statement;
                }
                statement.clear();
            }
            _ => {}
        }
    }
    out.push_str(&statement);
    out
}

/// Comments out, newlines kept, so later passes see only code and glslang's line
/// numbers still match. A comment holding a `;` or `{` was splitting declarations.
pub fn strip_comments(code: &str) -> String {
    let mut out = String::with_capacity(code.len());
    let mut chars = code.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '/' && chars.peek() == Some(&'/') {
            for c in chars.by_ref() {
                if c == '\n' {
                    out.push('\n');
                    break;
                }
            }
        } else if c == '/' && chars.peek() == Some(&'*') {
            chars.next();
            let mut last = ' ';
            for c in chars.by_ref() {
                if c == '\n' {
                    out.push('\n');
                }
                if last == '*' && c == '/' {
                    break;
                }
                last = c;
            }
            out.push(' ');
        } else {
            out.push(c);
        }
    }
    out
}

/// The shader body is the first balanced `{ … }` after `shader_body`. Anything
/// after it — authors sign their presets there — was never code.
pub fn body_block(after: &str) -> &str {
    let Some(open) = after.find('{') else { return after };
    let mut depth = 0;
    for (i, c) in after[open..].char_indices() {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return &after[..open + i + 1];
                }
            }
            _ => {}
        }
    }
    after
}

/// `sampler s = sampler_state { AddressU = WRAP; … };` is Direct3D effect syntax.
/// The states are dropped — MilkDrop chooses a texture's filtering and wrapping by
/// its name prefix (`sampler_fw_…`), not by these — leaving `sampler s;`.
pub fn drop_sampler_states(code: &str) -> String {
    static STATE: OnceLock<Regex> = OnceLock::new();
    re(&STATE, r"(?s)=\s*sampler_state\s*\{.*?\}").replace_all(code, "").into_owned()
}

/// `-(a < b)`: D3D9 treated a comparison as a float, so negating one was fine; HLSL
/// will not negate a bool. Every `-(…)` becomes `-(1.0*(…))`, which means the same
/// for numbers and makes a bool a number.
pub fn negatable(code: &str) -> String {
    let mut out = String::with_capacity(code.len() + 16);
    let mut stack: Vec<bool> = Vec::new();
    for c in code.chars() {
        // The preprocessor spaces tokens out, so `-(` may arrive as `- (`.
        let negated = out.trim_end().ends_with('-');
        match c {
            '(' if negated => {
                out.push_str("(1.0*(");
                stack.push(true);
            }
            '(' => {
                out.push('(');
                stack.push(false);
            }
            ')' => {
                out.push(')');
                if stack.pop() == Some(true) {
                    out.push(')');
                }
            }
            _ => out.push(c),
        }
    }
    out
}

/// Intrinsics MilkDrop presets call with arguments current HLSL will not take, and
/// the truncation helpers [`truncating`] wraps assignments in.
const OVERLOADS: &str = "\
float normalize(float x) { return x / abs(x); }\n\
float2 mul(float2 a, float b) { return a * b; } float3 mul(float3 a, float b) { return a * b; } float4 mul(float4 a, float b) { return a * b; }\n\
float _t1(float x) { return x; } float _t1(float2 x) { return x.x; } float _t1(float3 x) { return x.x; } float _t1(float4 x) { return x.x; }\n\
float _t1(int x) { return x; } float _t1(bool x) { return x; }\n\
float2 _t2(float x) { return x; } float2 _t2(float2 x) { return x; } float2 _t2(float3 x) { return x.xy; } float2 _t2(float4 x) { return x.xy; }\n\
float3 _t3(float x) { return x; } float3 _t3(float3 x) { return x; } float3 _t3(float4 x) { return x.xyz; }\n";

/// `ret.y += v * 0.02;` with `v` a vector: D3D9 truncated the right side to the
/// first component(s), and HLSL now refuses. An assignment to a one-, two- or
/// three-component swizzle gets its right side wrapped in `_t1`/`_t2`/`_t3`,
/// overloads that truncate exactly as D3D9 did and pass a right-sized value
/// through unchanged.
pub fn truncating(code: &str) -> String {
    static TARGET: OnceLock<Regex> = OnceLock::new();
    let target = re(&TARGET, r"\.([xyzwrgba]{1,3})\s*([+\-*/]?=)");
    let mut out = String::with_capacity(code.len() + 64);
    let mut at = 0;
    for m in target.captures_iter(code) {
        let whole = m.get(0).unwrap();
        if whole.start() < at {
            continue;
        }
        let after = whole.end();
        let before = code[..whole.start()].chars().last().unwrap_or(' ');
        // `a.x == b`, `a.x <= b`: comparisons, not assignments.
        if code[after..].starts_with('=') || !(before.is_alphanumeric() || before == '_' || before == ']' || before == ')') {
            continue;
        }
        // The right side runs to the `;` (or the `)` of a `for`) at depth zero.
        let mut depth = 0i32;
        let mut end = None;
        for (i, c) in code[after..].char_indices() {
            match c {
                '(' | '[' => depth += 1,
                ')' | ']' if depth == 0 => {
                    end = Some(after + i);
                    break;
                }
                ')' | ']' => depth -= 1,
                ';' | ',' if depth == 0 => {
                    end = Some(after + i);
                    break;
                }
                _ => {}
            }
        }
        let Some(end) = end else { continue };
        out += &code[at..after];
        out += &format!(" _t{}({})", m[1].len(), code[after..end].trim());
        at = end;
    }
    out += &code[at..];
    out
}

/// `float4 a[2] = { 1, 2, 3, 4, 5, 6, 7, 8 };`: D3D9 filled an array of vectors
/// from a flat list, and HLSL wants one braced group per element.
pub fn grouped_initializers(code: &str) -> String {
    static ARRAY: OnceLock<Regex> = OnceLock::new();
    re(&ARRAY, r"(float([234]))\s+(\w+)\s*\[\s*(\d+)\s*\]\s*=\s*\{([^{}]*)\}")
        .replace_all(code, |m: &regex::Captures| {
            let width: usize = m[2].parse().unwrap();
            let count: usize = m[4].parse().unwrap();
            // Split on commas outside parentheses: `11.0/3.0` and `f(a, b)` are one item.
            let mut items = Vec::new();
            let mut depth = 0;
            let mut item = String::new();
            for c in m[5].chars() {
                match c {
                    '(' => depth += 1,
                    ')' => depth -= 1,
                    ',' if depth == 0 => {
                        items.push(std::mem::take(&mut item));
                        continue;
                    }
                    _ => {}
                }
                item.push(c);
            }
            if !item.trim().is_empty() {
                items.push(item);
            }
            if items.len() != width * count {
                return m[0].to_owned();
            }
            let groups: Vec<String> = items
                .chunks(width)
                .map(|chunk| format!("{{{}}}", chunk.iter().map(|s| s.trim()).collect::<Vec<_>>().join(", ")))
                .collect();
            format!("{} {}[{}] = {{{}}}", &m[1], &m[3], &m[4], groups.join(", "))
        })
        .into_owned()
}

/// `double` is a 64-bit float in HLSL now, and Metal has none; MilkDrop's was 32.
pub fn no_doubles(code: &str) -> String {
    static DOUBLE: OnceLock<Regex> = OnceLock::new();
    re(&DOUBLE, r"\bdouble([1-4]?)\b").replace_all(code, "float$1").into_owned()
}

/// The whole HLSL source for one shader, or `None` when the preset has none —
/// the renderer then draws MilkDrop's default for that stage.
pub fn hlsl(kind: Kind, text: &str) -> Result<Option<String>, Error> {
    if text.trim().is_empty() {
        return Ok(None);
    }
    let text = strip_comments(text);
    // A preset whose macros the preprocessor refuses is kept as written; the
    // compile then says what is wrong with it.
    let text = preprocess(&text).unwrap_or(text);
    let at = text.find("shader_body").ok_or(Error::NoBody)?;
    let tidy = |code: &str| truncating(&grouped_initializers(&negatable(&no_doubles(&split_samplers(code)))));
    let head = tidy(&fix_head(&drop_sampler_states(&text[..at])));
    let body = tidy(body_block(&text[at + "shader_body".len()..]));
    // As Butterchurn's wrappers: the warp mesh supplies `uv` and `uv_orig`; the
    // comp mesh supplies its position and a colour, and `uv` is flipped from it.
    // `rad` and `ang` are per pixel, never interpolated.
    let (inputs, setup, result) = match kind {
        Kind::Warp => (
            "float2 uv : TEXCOORD0, float2 uv_orig : TEXCOORD1, float4 _color : TEXCOORD2",
            "float rad = length(uv_orig - 0.5); float ang = atan2(uv_orig.x - 0.5, uv_orig.y - 0.5);",
            "float4(ret, 1) * _color",
        ),
        Kind::Comp => (
            "float2 _uv : TEXCOORD0, float4 _color : TEXCOORD1",
            "float2 uv = float2(_uv.x, 1.0 - _uv.y); float2 uv_orig = uv; \
             float rad = length(uv - 0.5); float ang = atan2(uv.x - 0.5, uv.y - 0.5); float3 hue_shader = _color.rgb;",
            "float4(ret, _color.a)",
        ),
    };
    Ok(Some(format!(
        "{}{HELPERS}{OVERLOADS}{}{head}\nfloat4 {ENTRY}({inputs}) : SV_Target {{\n  float3 ret = 0;\n  {}\n  {setup}\n{body}\n  return {result};\n}}\n",
        preamble(),
        declare_textures(&head, &body),
        copy_uniforms(),
    )))
}

// --- compiling ---------------------------------------------------------------

/// HLSL to SPIR-V through glslang's C interface.
///
/// The C interface rather than the `glslang` crate's safe wrapper, because the
/// wrapper parses inside its constructor and an HLSL entry point has to be named
/// before parsing.
pub fn spirv(source: &str) -> Result<Vec<u32>, Error> {
    use glslang_sys as sys;
    with_input(source, |input, messages| unsafe {
        let shader = sys::glslang_shader_create(input);
        let entry = std::ffi::CString::new(ENTRY).unwrap();
        sys::glslang_shader_set_entry_point(shader, entry.as_ptr());
        sys::glslang_shader_set_options(
            shader,
            (sys::glslang_shader_options_t::AUTO_MAP_BINDINGS.0 | sys::glslang_shader_options_t::AUTO_MAP_LOCATIONS.0) as _,
        );
        if sys::glslang_shader_preprocess(shader, input) == 0 || sys::glslang_shader_parse(shader, input) == 0 {
            let message = log(sys::glslang_shader_get_info_log(shader));
            sys::glslang_shader_delete(shader);
            return Err(Error::Compile(message));
        }
        let program = sys::glslang_program_create();
        sys::glslang_program_add_shader(program, shader);
        let ok = sys::glslang_program_link(program, messages as _) != 0 && sys::glslang_program_map_io(program) != 0;
        if !ok {
            let message = log(sys::glslang_program_get_info_log(program));
            sys::glslang_program_delete(program);
            sys::glslang_shader_delete(shader);
            return Err(Error::Compile(message));
        }
        sys::glslang_program_SPIRV_generate(program, sys::glslang_stage_t::Fragment);
        let size = sys::glslang_program_SPIRV_get_size(program);
        let words = std::slice::from_raw_parts(sys::glslang_program_SPIRV_get_ptr(program), size).to_vec();
        sys::glslang_program_delete(program);
        sys::glslang_shader_delete(shader);
        Ok(words)
    })
}

/// The preset's own text with its own `#define`s applied, by glslang's
/// preprocessor. Presets rename things with macros — `#define main
/// sampler_fw_main` is real — and the textual rewrites must see what the author
/// meant, not the macro's name.
pub fn preprocess(source: &str) -> Result<String, Error> {
    use glslang_sys as sys;
    with_input(source, |input, _| unsafe {
        let shader = sys::glslang_shader_create(input);
        if sys::glslang_shader_preprocess(shader, input) == 0 {
            let message = log(sys::glslang_shader_get_info_log(shader));
            sys::glslang_shader_delete(shader);
            return Err(Error::Compile(message));
        }
        let code = log(sys::glslang_shader_get_preprocessed_code(shader));
        sys::glslang_shader_delete(shader);
        // glslang marks where it was with `#line`; nothing downstream wants them.
        Ok(code.lines().filter(|l| !l.trim_start().starts_with("#line")).collect::<Vec<_>>().join("\n"))
    })
}

/// The entry point's name: one no preset `#define`s.
const ENTRY: &str = "_milkdrop_main";

unsafe fn log(text: *const std::os::raw::c_char) -> String {
    if text.is_null() {
        return String::new();
    }
    unsafe { std::ffi::CStr::from_ptr(text) }.to_string_lossy().trim().to_owned()
}

/// Build glslang's input for HLSL fragment source and hand it to `run`.
fn with_input<T>(
    source: &str,
    run: impl FnOnce(&glslang_sys::glslang_input_t, i32) -> Result<T, Error>,
) -> Result<T, Error> {
    use glslang_sys as sys;
    // Initialises glslang's process-wide state once.
    glslang::Compiler::acquire().ok_or_else(|| Error::Compile("glslang would not initialise".into()))?;
    // The default limits, as the `glslang` crate defines them. A one-field
    // newtype over the C struct; the size check keeps the transmute honest.
    const _: () = assert!(
        std::mem::size_of::<glslang::limits::ResourceLimits>() == std::mem::size_of::<sys::glslang_resource_t>()
    );
    let limits: sys::glslang_resource_t = unsafe { std::mem::transmute(glslang::limits::DEFAULT_LIMITS) };

    let code = std::ffi::CString::new(source).map_err(|e| Error::Compile(e.to_string()))?;
    let messages = sys::glslang_messages_t::READ_HLSL.0
        | sys::glslang_messages_t::HLSL_DX9_COMPATIBLE.0
        | sys::glslang_messages_t::SPV_RULES.0
        | sys::glslang_messages_t::VULKAN_RULES.0;
    let input = sys::glslang_input_t {
        language: sys::glslang_source_t::HLSL,
        stage: sys::glslang_stage_t::Fragment,
        client: sys::glslang_client_t::Vulkan,
        client_version: sys::glslang_target_client_version_t::Vulkan1_0,
        target_language: sys::glslang_target_language_t::SPIRV,
        target_language_version: sys::glslang_target_language_version_t::SPIRV1_0,
        code: code.as_ptr(),
        default_version: 100,
        default_profile: sys::glslang_profile_t::None,
        force_default_version_and_profile: 0,
        forward_compatible: 0,
        messages: sys::glslang_messages_t(messages),
        resource: &limits,
        callbacks: unsafe { std::mem::zeroed() },
        callbacks_ctx: std::ptr::null_mut(),
    };
    run(&input, messages)
}

/// SPIR-V to a validated naga module, ready for wgpu.
pub fn module(words: &[u32]) -> Result<(naga::Module, naga::valid::ModuleInfo), Error> {
    let options = naga::front::spv::Options::default();
    let bytes: Vec<u8> = words.iter().flat_map(|w| w.to_le_bytes()).collect();
    let module = naga::front::spv::parse_u8_slice(&bytes, &options).map_err(|e| Error::Read(e.to_string()))?;
    let info = naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::default())
        .validate(&module)
        .map_err(|e| Error::Invalid(format!("{:?}", e.into_inner())))?;
    Ok((module, info))
}

/// The whole path: a preset's shader text to a module, `None` when it has none.
pub fn translate(kind: Kind, text: &str) -> Result<Option<(naga::Module, naga::valid::ModuleInfo)>, Error> {
    let Some(source) = hlsl(kind, text)? else { return Ok(None) };
    module(&spirv(&source)?).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn compiles(kind: Kind, text: &str) {
        if let Err(error) = translate(kind, text) {
            panic!("{error}\n---\n{}", hlsl(kind, text).unwrap().unwrap());
        }
    }

    #[test]
    fn an_ordinary_comp_shader_compiles() {
        compiles(Kind::Comp, "shader_body { ret = tex2D(sampler_main, uv).xyz * hue_shader; }");
    }

    #[test]
    fn operator_chains_and_blur_macros_compile() {
        // The shape the old converter turned into `&&`.
        compiles(Kind::Comp, "shader_body { ret = GetMain(uv)*0.5 + GetBlur1(uv)*0.2 - GetBlur2(uv) + lum(uv); }");
    }

    #[test]
    fn writes_to_uniforms_compile() {
        compiles(Kind::Warp, "shader_body { q1 = q1 * 2; time = 0; ret = GetPixel(uv) * q1; }");
    }

    #[test]
    fn a_presets_globals_are_writable() {
        compiles(Kind::Comp, "float3 acc; float k = 2;\nshader_body { acc = 0; k = 3; ret = acc + k; }");
        assert!(fix_head("float3 acc; float k = 2;").contains("static float3 acc;"));
        assert!(fix_head("float3 acc; float k = 2;").contains("static float k = 2;"));
    }

    #[test]
    fn a_presets_own_samplers_split_and_redeclarations_drop() {
        let head = "sampler sampler_pw_noise_lq;\nsampler2D sampler_clouds;\ntexture t;\n";
        let fixed = split_samplers(&fix_head(head));
        assert!(!fixed.contains("sampler_pw_noise_lq"), "{fixed}");
        assert!(fixed.contains("Texture2D sampler_clouds_tex; SamplerState sampler_clouds_smp;"), "{fixed}");
        compiles(Kind::Comp, &format!("{head}shader_body {{ ret = tex2D(sampler_clouds, uv).xyz + tex2D(sampler_pw_noise_lq, uv).xyz; }}"));
    }

    #[test]
    fn functions_and_3d_noise_compile() {
        compiles(
            Kind::Warp,
            "float3 f(float3 x) { return x * x; }\nshader_body { ret = f(tex3D(sampler_noisevol_hq, float3(uv, time)).xyz) + mul(float3(1,0,0), (float3x3)rot_s1); }",
        );
    }

    #[test]
    fn lod_and_bias_samples_compile() {
        compiles(Kind::Comp, "shader_body { ret = tex2Dlod(sampler_main, float4(uv, 0, 2)).xyz + tex2Dbias(sampler_main, float4(uv,0,1)).xyz; }");
    }

    #[test]
    fn doubles_become_floats() {
        assert_eq!(no_doubles("double a; double3 b;"), "float a; float3 b;");
        compiles(Kind::Comp, "shader_body { double k = 0.5; ret = k; }");
    }

    #[test]
    fn comments_with_semicolons_do_not_hide_declarations() {
        compiles(Kind::Comp, "// set up; then draw {\nfloat radi; /* a; b */ float anz;\nshader_body { radi = 1; anz = 2; ret = radi * anz; }");
    }

    #[test]
    fn text_after_the_body_is_not_code() {
        compiles(Kind::Comp, "shader_body { ret = 1; }\nwritten by martin\nEND");
    }

    #[test]
    fn effect_sampler_states_are_dropped() {
        compiles(
            Kind::Comp,
            "sampler sampler_grad = sampler_state { AddressU = WRAP; AddressV = WRAP; };\nshader_body { ret = tex2D(sampler_grad, uv).xyz; }",
        );
    }

    #[test]
    fn comparisons_can_be_negated() {
        assert_eq!(negatable("a-(b<c)*d"), "a-(1.0*(b<c))*d");
        assert_eq!(negatable("f(x)-(y)"), "f(x)-(1.0*(y))");
        compiles(Kind::Comp, "shader_body { ret = 1; ret-=-(lum(ret)<0.5)*ret*0.2; }");
    }

    #[test]
    fn a_scalar_normalizes() {
        compiles(Kind::Warp, "shader_body { float2 z = uv; uv += 0.5*z*normalize(z.x); ret = GetPixel(uv); }");
    }

    #[test]
    fn a_define_above_a_declaration_does_not_hide_it() {
        compiles(Kind::Comp, "#define K 2\nfloat z, z0, radi;\nshader_body { radi = K; ret = radi; }");
    }

    #[test]
    fn swizzle_assignments_truncate_like_d3d9() {
        assert_eq!(truncating("ret.y += (a - b)*c;"), "ret.y += _t1((a - b)*c);");
        assert_eq!(truncating("if (a.x == b) c.xy = d;"), "if (a.x == b) c.xy = _t2(d);");
        assert_eq!(truncating("for (i.x = 0; i.x < 3; i.x += 1)"), "for (i.x = _t1(0); i.x < 3; i.x += _t1(1))");
        compiles(Kind::Comp, "shader_body { float3 c = 1; float3 b1 = 0; ret = 0; ret.y += (ret.y - b1.y)*0.02 + c; ret.xy = c; }");
    }

    #[test]
    fn flat_initializers_are_grouped() {
        assert_eq!(
            grouped_initializers("const float4 s[2] = { 0, 0, 11.0/3.0, f(a, b), 1, 2, 3, 4 };"),
            "const float4 s[2] = {{0, 0, 11.0/3.0, f(a, b)}, {1, 2, 3, 4}};"
        );
        compiles(Kind::Comp, "const float4 s[2] = { 0.0, 0.0, 0, 11.0/3.0, 0.0, 1.0, 0, -2.0/3.0 };\nshader_body { ret = s[1].xyz; }");
    }

    #[test]
    fn short_and_undeclared_texture_names_compile() {
        compiles(Kind::Warp, "shader_body { ret = tex2D(main, uv).xyz + tex2D(blur1, uv).xyz + tex2D(snh, uv).xyz; }");
    }

    #[test]
    fn a_vector_multiplies_by_a_scalar() {
        compiles(Kind::Warp, "shader_body { ret = tex2D(sampler_fc_main, mul((uv-0.5)*(1 - rad*0.01),1) + 0.5).xyz; }");
    }

    #[test]
    fn a_presets_macros_apply_before_the_rewrites() {
        let source = hlsl(Kind::Warp, "#define main sampler_fw_main\nsampler base01;\nshader_body { ret = tex2D(main, uv).xyz; }")
            .unwrap()
            .unwrap();
        assert!(source.contains("sampler_fw_main_tex.Sample(sampler_fw_main_smp"), "{source}");
        compiles(Kind::Warp, "#define main sampler_fw_main\n#define base01 sampler_pw_rand00\nsampler base01;\nshader_body { ret = tex2D(main, uv).xyz + tex2D(base01, uv).xyz; }");
    }

    #[test]
    fn the_default_shaders_compile() {
        compiles(Kind::Warp, DEFAULT_WARP);
        compiles(Kind::Comp, DEFAULT_COMP);
    }

    fn preset(values: &[(&str, f64)]) -> crate::preset::Preset {
        let mut p = crate::preset::parse("");
        p.values = values.iter().map(|(k, v)| (k.to_string(), *v)).collect();
        p
    }

    #[test]
    fn a_written_default_has_the_presets_values_as_numbers() {
        let warp = written_default(Kind::Warp, &preset(&[("fDecay", 0.9)]));
        assert!(warp.contains("ret = tex2D(sampler_main, uv).xyz * 0.9;"), "{warp}");
        let comp = written_default(Kind::Comp, &preset(&[("fGammaAdj", 1.5), ("fVideoEchoAlpha", 0.25), ("nVideoEchoOrientation", 3.0), ("bInvert", 1.0)]));
        for want in ["ret *= 1.5;", "(1.0 / 2.0)", "fmod(3.0, 2.0)", "uv_echo).xyz, 0.25);", "ret = 1.0 - ret;"] {
            assert!(comp.contains(want), "{want} in\n{comp}");
        }
        // Switches the numbers turn off are gone, not left as `if (0.0 != 0)`.
        for gone in ["_d", "if (", "sqrt", "hue_shader", "ret*ret"] {
            assert!(!comp.contains(gone), "{gone} in\n{comp}");
        }
        compiles(Kind::Warp, &warp);
        compiles(Kind::Comp, &comp);
    }

    #[test]
    fn a_written_default_folds_the_hue_shader_chain() {
        let full = written_default(Kind::Comp, &preset(&[("fShader", 1.0)]));
        assert!(full.contains("ret *= hue_shader;") && !full.contains("(1.0 - "), "{full}");
        let part = written_default(Kind::Comp, &preset(&[("fShader", 0.5), ("bBrighten", 1.0)]));
        assert!(part.contains("ret *= (1.0 - 0.5) + (0.5 * hue_shader);") && part.contains("ret = sqrt(ret);"), "{part}");
        assert!(!part.contains("else"), "{part}");
        compiles(Kind::Comp, &full);
        compiles(Kind::Comp, &part);
        // The defaults when the file leaves them out: MilkDrop's 0.98 decay and gamma 2.
        assert!(written_default(Kind::Warp, &preset(&[])).contains("* 0.98;"));
        assert!(written_default(Kind::Comp, &preset(&[])).contains("ret *= 2.0;"));
    }

    #[test]
    fn no_shader_is_no_module() {
        assert!(translate(Kind::Warp, "  ").unwrap().is_none());
        assert!(matches!(translate(Kind::Warp, "ret = 1;"), Err(Error::NoBody)));
    }
}
