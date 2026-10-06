//! Why one preset's shader does not compile: the error, and the generated HLSL
//! around the line it names.
//!
//!   cargo run --release --bin explain -- <file.milk> <warp|comp>

use engine::{preset, shader};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [path, kind] = &args[..] else {
        eprintln!("usage: explain <file.milk> <warp|comp>");
        std::process::exit(2);
    };
    let kind = if kind == "warp" { shader::Kind::Warp } else { shader::Kind::Comp };
    let preset = preset::parse(&preset::decode(&std::fs::read(path).expect("read")));
    let text = if kind == shader::Kind::Warp { &preset.warp } else { &preset.comp };
    let Ok(Some(source)) = shader::hlsl(kind, text) else {
        println!("no shader, or no shader_body");
        return;
    };
    match shader::translate(kind, text) {
        Ok(_) => println!("compiles"),
        Err(error) => {
            let message = error.to_string();
            println!("{message}");
            let lines: Vec<&str> = source.lines().collect();
            for line in message.lines() {
                // `ERROR: 0:228: …` — the number after `0:`.
                let Some(at) = line
                    .split_once("ERROR: 0:")
                    .and_then(|(_, rest)| rest.split(':').next())
                    .and_then(|n| n.trim().parse::<usize>().ok())
                else {
                    continue;
                };
                for n in at.saturating_sub(3)..(at + 2).min(lines.len()) {
                    println!("{:5}{} {}", n + 1, if n + 1 == at { ">" } else { " " }, lines[n]);
                }
                break;
            }
        }
    }
}
