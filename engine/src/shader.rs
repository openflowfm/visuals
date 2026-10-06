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
//! - one entry point, `main`, a fragment shader returning the colour;
//! - inputs, in order: `uv`, `uv_orig`, `rad`, `ang`, and for comp `hue_shader`;
//! - MilkDrop's uniforms in one buffer, each named `_u_<name>` (`_u_time`, `_u__qa`…);
//! - each texture as `<name>_tex` with a sampler `<name>_smp` (`sampler_main_tex`).

use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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
];

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
    out
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
    let at = text.find("shader_body").ok_or(Error::NoBody)?;
    let head = no_doubles(&split_samplers(&fix_head(&text[..at])));
    let body = no_doubles(&split_samplers(&text[at + "shader_body".len()..]));
    let inputs = match kind {
        Kind::Warp => "float2 uv : TEXCOORD0, float2 uv_orig : TEXCOORD1, float rad : TEXCOORD2, float ang : TEXCOORD3",
        Kind::Comp => "float2 uv : TEXCOORD0, float2 uv_orig : TEXCOORD1, float rad : TEXCOORD2, float ang : TEXCOORD3, float3 hue_shader : TEXCOORD4",
    };
    Ok(Some(format!(
        "{}{HELPERS}{head}\nfloat4 main({inputs}) : SV_Target {{\n  float3 ret = 0;\n  {}\n{body}\n  return float4(ret, 1);\n}}\n",
        preamble(),
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
    use std::ffi::{CStr, CString};

    // Initialises glslang's process-wide state once.
    glslang::Compiler::acquire().ok_or_else(|| Error::Compile("glslang would not initialise".into()))?;
    // The default limits, as the `glslang` crate defines them. A one-field
    // newtype over the C struct; the size check keeps the transmute honest.
    const _: () = assert!(
        std::mem::size_of::<glslang::limits::ResourceLimits>() == std::mem::size_of::<sys::glslang_resource_t>()
    );
    let limits: sys::glslang_resource_t = unsafe { std::mem::transmute(glslang::limits::DEFAULT_LIMITS) };

    let code = CString::new(source).map_err(|e| Error::Compile(e.to_string()))?;
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
    let log = |text: *const std::os::raw::c_char| unsafe { CStr::from_ptr(text).to_string_lossy().trim().to_owned() };

    unsafe {
        let shader = sys::glslang_shader_create(&input);
        let entry = CString::new("main").unwrap();
        sys::glslang_shader_set_entry_point(shader, entry.as_ptr());
        sys::glslang_shader_set_options(
            shader,
            (sys::glslang_shader_options_t::AUTO_MAP_BINDINGS.0 | sys::glslang_shader_options_t::AUTO_MAP_LOCATIONS.0) as _,
        );
        if sys::glslang_shader_preprocess(shader, &input) == 0 || sys::glslang_shader_parse(shader, &input) == 0 {
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
    }
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
    fn no_shader_is_no_module() {
        assert!(translate(Kind::Warp, "  ").unwrap().is_none());
        assert!(matches!(translate(Kind::Warp, "ret = 1;"), Err(Error::NoBody)));
    }
}
