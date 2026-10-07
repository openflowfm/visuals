//! MilkDrop's equation language, EEL: parsed, resolved to variable slots, and run.
//!
//! **The grammar is MilkDrop's** (ns-eel2), which is wider than the one Butterchurn's
//! converter accepts: `^` for power, `a ? b : c`, `$PI`, `1e3`, `loop`, `while` and
//! `exec2` used as values. Presets that use those fail in Butterchurn and work here.
//!
//! **The meaning is Butterchurn's** wherever Butterchurn compiles a preset, because
//! that is the reference the engine is measured against:
//!
//! - `/` gives 0 for a zero divisor; `/=` divides as written. `%` floors both sides
//!   and gives 0 for a zero divisor; `%=` is a float remainder.
//! - `==` and `!=` compare within 1e-5; `<`, `>`, `<=`, `>=` exactly.
//! - `if()`, `!`, `band`, `bor` treat |x| > 1e-5 as true; `&&` and `||` treat any
//!   non-zero as true.
//! - `sqrt` takes `abs` first; `pow` gives 0 for a result that is not finite;
//!   `rand(n)` is `floor(random * floor(n))`, or `random` for n < 1.
//!
//! Variable names are case-insensitive. Every name gets a slot in a [`Symbols`]
//! table shared by all of a preset's programs, so `q1` written in per-frame is the
//! same slot read by per-vertex.

use std::collections::HashMap;

const EPSILON: f64 = 0.00001;
/// MilkDrop's cap on `loop` and `while` iterations.
const MAX_LOOP: usize = 1_048_576;
/// `megabuf` and `gmegabuf` hold this many values, as in MilkDrop.
pub const MEGABUF: usize = 1_048_576;

#[derive(Debug, thiserror::Error, PartialEq)]
#[error("{message} at {at}")]
pub struct Error {
    pub message: String,
    /// Byte offset into the source.
    pub at: usize,
}

/// Every variable a preset's programs name, by slot.
#[derive(Debug, Default, Clone)]
pub struct Symbols {
    slots: HashMap<String, usize>,
    names: Vec<String>,
}

impl Symbols {
    pub fn slot(&mut self, name: &str) -> usize {
        let name = name.to_ascii_lowercase();
        if let Some(&slot) = self.slots.get(&name) {
            return slot;
        }
        let slot = self.names.len();
        self.slots.insert(name.clone(), slot);
        self.names.push(name);
        slot
    }
    pub fn get(&self, name: &str) -> Option<usize> {
        self.slots.get(&name.to_ascii_lowercase()).copied()
    }
    pub fn len(&self) -> usize {
        self.names.len()
    }
    pub fn is_empty(&self) -> bool {
        self.names.is_empty()
    }
    pub fn names(&self) -> &[String] {
        &self.names
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Op {
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    Pow,
    Eq,
    Ne,
    Lt,
    Gt,
    Le,
    Ge,
    And,
    Or,
    BitAnd,
    BitOr,
}

/// An assignment's operator: `=`, or a compound one.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Assign {
    Set,
    Add,
    Sub,
    Mul,
    /// Raw division, as Butterchurn's `/=`.
    Div,
    /// Float remainder, as Butterchurn's `%=`.
    Mod,
    Pow,
    BitAnd,
    BitOr,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Buffer {
    Local,
    Global,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Func {
    Sin, Cos, Tan, Asin, Acos, Atan, Atan2, Sqrt, Sqr, Pow, Exp, Log, Log10, Abs,
    Min, Max, Sign, Rand, Floor, Int, Ceil, Invsqrt, Sigmoid, Bor, Band, Bnot,
    Equal, Above, Below, Fmod, Freembuf, Memcpy, Memset,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    Num(f64),
    Var(usize),
    Mem(Buffer, Box<Expr>),
    Neg(Box<Expr>),
    Not(Box<Expr>),
    Binary(Op, Box<Expr>, Box<Expr>),
    /// `if(c, a, b)` and `c ? a : b`: only the chosen side is evaluated.
    If(Box<Expr>, Box<Expr>, Box<Expr>),
    SetVar(Assign, usize, Box<Expr>),
    SetMem(Assign, Buffer, Box<Expr>, Box<Expr>),
    /// `a; b; c` — the value is the last one's.
    Seq(Vec<Expr>),
    Loop(Box<Expr>, Box<Expr>),
    While(Box<Expr>),
    Call(Func, Vec<Expr>),
}

/// A compiled program: one block of a preset's equations.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Program {
    pub body: Vec<Expr>,
}

// --- lexing -----------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Num(f64),
    Name(String),
    Sym(&'static str),
}

const SYMBOLS: &[&str] = &[
    "===", "!==", "==", "!=", "<=", ">=", "&&", "||", "+=", "-=", "*=", "/=", "%=", "^=", "&=", "|=",
    "+", "-", "*", "/", "%", "^", "<", ">", "=", "!", "&", "|", "(", ")", ",", ";", "?", ":", "[", "]",
];

fn lex(source: &str) -> Result<Vec<(Tok, usize)>, Error> {
    let bytes = source.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i] as char;
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        // `//` and `/* */` comments, which MilkDrop allows in equations — and `\\`,
        // which authors used the same way and MilkDrop let pass.
        if source[i..].starts_with("//") || source[i..].starts_with("\\\\") {
            i = source[i..].find('\n').map_or(bytes.len(), |n| i + n);
            continue;
        }
        if source[i..].starts_with("/*") {
            i = source[i + 2..].find("*/").map_or(bytes.len(), |n| i + 2 + n + 2);
            continue;
        }
        let start = i;
        if c == '$' {
            // `$PI`, `$E`, `$PHI`, `$x1F` (hex), `$'a'` (a character code).
            let rest = &source[i + 1..];
            let lower = rest.to_ascii_lowercase();
            let (value, len) = if lower.starts_with("phi") {
                (1.618_033_988_749_895, 3)
            } else if lower.starts_with("pi") {
                (std::f64::consts::PI, 2)
            } else if lower.starts_with('e') {
                (std::f64::consts::E, 1)
            } else if lower.starts_with('x') {
                let digits = rest[1..].chars().take_while(|c| c.is_ascii_hexdigit()).count();
                (i64::from_str_radix(&rest[1..1 + digits], 16).unwrap_or(0) as f64, 1 + digits)
            } else if rest.starts_with('\'') && rest.len() >= 3 {
                (rest.as_bytes()[1] as f64, 3)
            } else {
                return Err(Error { message: "unknown $ constant".into(), at: i });
            };
            out.push((Tok::Num(value), start));
            i += 1 + len;
            continue;
        }
        // A lone `.` is a number to ns-eel — zero — and presets rely on it: `.-.4`.
        if c == '.' && !bytes.get(i + 1).is_some_and(u8::is_ascii_digit) {
            out.push((Tok::Num(0.0), start));
            i += 1;
            continue;
        }
        if c.is_ascii_digit() || (c == '.' && bytes.get(i + 1).is_some_and(u8::is_ascii_digit)) {
            if source[i..].starts_with("0x") || source[i..].starts_with("0X") {
                let digits = source[i + 2..].chars().take_while(|c| c.is_ascii_hexdigit()).count();
                out.push((Tok::Num(i64::from_str_radix(&source[i + 2..i + 2 + digits], 16).unwrap_or(0) as f64), start));
                i += 2 + digits;
                continue;
            }
            let mut j = i;
            while j < bytes.len() && (bytes[j].is_ascii_digit() || bytes[j] == b'.') {
                j += 1;
            }
            if j < bytes.len() && (bytes[j] == b'e' || bytes[j] == b'E') {
                let mut k = j + 1;
                if k < bytes.len() && (bytes[k] == b'+' || bytes[k] == b'-') {
                    k += 1;
                }
                if k < bytes.len() && bytes[k].is_ascii_digit() {
                    while k < bytes.len() && bytes[k].is_ascii_digit() {
                        k += 1;
                    }
                    j = k;
                }
            }
            // `5.` and `1.2.3` both happen; take the longest prefix that parses.
            let text = &source[i..j];
            let value = text.parse::<f64>().or_else(|_| {
                let mut end = text.len();
                loop {
                    end -= 1;
                    if end == 0 {
                        break Ok(0.0);
                    }
                    if let Ok(v) = text[..end].parse::<f64>() {
                        break Ok::<f64, ()>(v);
                    }
                }
            });
            out.push((Tok::Num(value.unwrap_or(0.0)), start));
            i = j;
            continue;
        }
        if c.is_ascii_alphabetic() || c == '_' {
            let mut j = i;
            while j < bytes.len() && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_' || bytes[j] == b'.') {
                j += 1;
            }
            out.push((Tok::Name(source[i..j].to_ascii_lowercase()), start));
            i = j;
            continue;
        }
        let Some(sym) = SYMBOLS.iter().find(|s| source[i..].starts_with(**s)) else {
            return Err(Error { message: format!("unexpected '{c}'"), at: i });
        };
        out.push((Tok::Sym(sym), start));
        i += sym.len();
    }
    Ok(out)
}

// --- parsing ----------------------------------------------------------------

struct Parser<'a> {
    toks: Vec<(Tok, usize)>,
    at: usize,
    end: usize,
    symbols: &'a mut Symbols,
}

impl Parser<'_> {
    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.at).map(|t| &t.0)
    }
    fn offset(&self) -> usize {
        self.toks.get(self.at).map_or(self.end, |t| t.1)
    }
    fn fail<T>(&self, message: impl Into<String>) -> Result<T, Error> {
        Err(Error { message: message.into(), at: self.offset() })
    }
    fn is(&self, sym: &str) -> bool {
        matches!(self.peek(), Some(Tok::Sym(s)) if *s == sym)
    }
    fn eat(&mut self, sym: &str) -> bool {
        if self.is(sym) {
            self.at += 1;
            true
        } else {
            false
        }
    }
    fn expect(&mut self, sym: &str) -> Result<(), Error> {
        if self.eat(sym) { Ok(()) } else { self.fail(format!("expected '{sym}'")) }
    }

    /// Statements separated by `;`, up to `stop` (or the end).
    fn sequence(&mut self, stop: &[&str]) -> Result<Vec<Expr>, Error> {
        let mut out = Vec::new();
        loop {
            while self.eat(";") {}
            if self.peek().is_none() || stop.iter().any(|s| self.is(s)) {
                return Ok(out);
            }
            out.push(self.expression()?);
            if !self.eat(";") && !(self.peek().is_none() || stop.iter().any(|s| self.is(s))) {
                // MilkDrop tolerates a missing `;` between statements on separate lines.
                continue;
            }
        }
    }

    fn block(&mut self, stop: &[&str]) -> Result<Expr, Error> {
        let mut seq = self.sequence(stop)?;
        Ok(if seq.len() == 1 { seq.pop().unwrap() } else { Expr::Seq(seq) })
    }

    fn expression(&mut self) -> Result<Expr, Error> {
        self.assignment()
    }

    fn assignment(&mut self) -> Result<Expr, Error> {
        let left = self.ternary()?;
        let op = match self.peek() {
            Some(Tok::Sym("=")) => Assign::Set,
            Some(Tok::Sym("+=")) => Assign::Add,
            Some(Tok::Sym("-=")) => Assign::Sub,
            Some(Tok::Sym("*=")) => Assign::Mul,
            Some(Tok::Sym("/=")) => Assign::Div,
            Some(Tok::Sym("%=")) => Assign::Mod,
            Some(Tok::Sym("^=")) => Assign::Pow,
            Some(Tok::Sym("&=")) => Assign::BitAnd,
            Some(Tok::Sym("|=")) => Assign::BitOr,
            _ => return Ok(left),
        };
        self.at += 1;
        let value = Box::new(self.assignment()?);
        match left {
            Expr::Var(slot) => Ok(Expr::SetVar(op, slot, value)),
            Expr::Mem(buffer, index) => Ok(Expr::SetMem(op, buffer, index, value)),
            _ => self.fail("can only assign to a variable or megabuf"),
        }
    }

    fn ternary(&mut self) -> Result<Expr, Error> {
        let condition = self.binary(0)?;
        if !self.eat("?") {
            return Ok(condition);
        }
        let then = self.assignment()?;
        let otherwise = if self.eat(":") { self.assignment()? } else { Expr::Num(0.0) };
        Ok(Expr::If(Box::new(condition), Box::new(then), Box::new(otherwise)))
    }

    fn binary(&mut self, min: u8) -> Result<Expr, Error> {
        let mut left = self.unary()?;
        loop {
            let (op, precedence) = match self.peek() {
                Some(Tok::Sym("||")) => (Op::Or, 1),
                Some(Tok::Sym("&&")) => (Op::And, 2),
                Some(Tok::Sym("|")) => (Op::BitOr, 3),
                Some(Tok::Sym("&")) => (Op::BitAnd, 4),
                Some(Tok::Sym("==" | "===")) => (Op::Eq, 5),
                Some(Tok::Sym("!=" | "!==")) => (Op::Ne, 5),
                Some(Tok::Sym("<")) => (Op::Lt, 6),
                Some(Tok::Sym(">")) => (Op::Gt, 6),
                Some(Tok::Sym("<=")) => (Op::Le, 6),
                Some(Tok::Sym(">=")) => (Op::Ge, 6),
                Some(Tok::Sym("+")) => (Op::Add, 7),
                Some(Tok::Sym("-")) => (Op::Sub, 7),
                Some(Tok::Sym("*")) => (Op::Mul, 8),
                Some(Tok::Sym("/")) => (Op::Div, 8),
                Some(Tok::Sym("%")) => (Op::Mod, 8),
                _ => return Ok(left),
            };
            if precedence < min {
                return Ok(left);
            }
            self.at += 1;
            let right = self.binary(precedence + 1)?;
            left = Expr::Binary(op, Box::new(left), Box::new(right));
        }
    }

    fn unary(&mut self) -> Result<Expr, Error> {
        if self.eat("-") {
            return Ok(Expr::Neg(Box::new(self.unary()?)));
        }
        if self.eat("+") {
            return self.unary();
        }
        if self.eat("!") {
            return Ok(Expr::Not(Box::new(self.unary()?)));
        }
        self.power()
    }

    /// `^` binds tighter than the unary operators' operands and associates right.
    fn power(&mut self) -> Result<Expr, Error> {
        let base = self.primary()?;
        if self.eat("^") {
            let exponent = self.unary()?;
            return Ok(Expr::Binary(Op::Pow, Box::new(base), Box::new(exponent)));
        }
        Ok(base)
    }

    fn primary(&mut self) -> Result<Expr, Error> {
        match self.peek().cloned() {
            Some(Tok::Num(n)) => {
                self.at += 1;
                Ok(Expr::Num(n))
            }
            Some(Tok::Sym("(")) => {
                self.at += 1;
                let inner = self.block(&[")"])?;
                self.expect(")")?;
                Ok(inner)
            }
            Some(Tok::Name(name)) => {
                self.at += 1;
                if self.eat("(") {
                    return self.call(&name);
                }
                if self.eat("[") {
                    // `buf[i]` — EEL2's indexing into memory, relative to `buf`'s value.
                    let base = Expr::Var(self.symbols.slot(&name));
                    let index = self.block(&["]"])?;
                    self.expect("]")?;
                    return Ok(Expr::Mem(Buffer::Local, Box::new(Expr::Binary(Op::Add, Box::new(base), Box::new(index)))));
                }
                Ok(Expr::Var(self.symbols.slot(&name)))
            }
            _ => self.fail("expected a value"),
        }
    }

    fn arguments(&mut self) -> Result<Vec<Expr>, Error> {
        let mut args = Vec::new();
        if self.eat(")") {
            return Ok(args);
        }
        loop {
            args.push(self.block(&[",", ")"])?);
            if self.eat(")") {
                return Ok(args);
            }
            self.expect(",")?;
        }
    }

    fn call(&mut self, name: &str) -> Result<Expr, Error> {
        let args = self.arguments()?;
        let n = args.len();
        let arity = |want: std::ops::RangeInclusive<usize>, this: &Self| -> Result<(), Error> {
            if want.contains(&n) { Ok(()) } else { this.fail(format!("{name}() takes {want:?} arguments, not {n}")) }
        };
        let mut args = args.into_iter();
        let mut next = || Box::new(args.next().unwrap_or(Expr::Num(0.0)));
        let func = |f: Func, args: Vec<Expr>| Expr::Call(f, args);
        Ok(match name {
            "if" => {
                arity(3..=3, self)?;
                Expr::If(next(), next(), next())
            }
            "loop" => {
                arity(2..=2, self)?;
                Expr::Loop(next(), next())
            }
            "while" => {
                arity(1..=1, self)?;
                Expr::While(next())
            }
            "exec2" | "exec3" => Expr::Seq(args.collect()),
            "assign" => {
                arity(2..=2, self)?;
                let (target, value) = (next(), next());
                match *target {
                    Expr::Var(slot) => Expr::SetVar(Assign::Set, slot, value),
                    Expr::Mem(buffer, index) => Expr::SetMem(Assign::Set, buffer, index, value),
                    _ => return self.fail("assign() needs a variable"),
                }
            }
            "megabuf" | "gmegabuf" => {
                arity(1..=1, self)?;
                Expr::Mem(if name == "megabuf" { Buffer::Local } else { Buffer::Global }, next())
            }
            _ => {
                let (f, range) = match name {
                    "sin" => (Func::Sin, 1..=1),
                    "cos" => (Func::Cos, 1..=1),
                    "tan" => (Func::Tan, 1..=1),
                    "asin" => (Func::Asin, 1..=1),
                    "acos" => (Func::Acos, 1..=1),
                    "atan" => (Func::Atan, 1..=1),
                    "atan2" => (Func::Atan2, 2..=2),
                    "sqrt" => (Func::Sqrt, 1..=1),
                    "sqr" => (Func::Sqr, 1..=1),
                    "pow" => (Func::Pow, 2..=2),
                    "exp" => (Func::Exp, 1..=1),
                    "log" => (Func::Log, 1..=1),
                    "log10" => (Func::Log10, 1..=1),
                    "abs" => (Func::Abs, 1..=1),
                    "min" => (Func::Min, 1..=usize::MAX),
                    "max" => (Func::Max, 1..=usize::MAX),
                    "sign" => (Func::Sign, 1..=1),
                    "rand" => (Func::Rand, 1..=1),
                    "floor" => (Func::Floor, 1..=1),
                    "int" => (Func::Int, 1..=1),
                    "ceil" => (Func::Ceil, 1..=1),
                    "invsqrt" => (Func::Invsqrt, 1..=1),
                    "sigmoid" => (Func::Sigmoid, 2..=2),
                    "bor" => (Func::Bor, 2..=2),
                    "band" => (Func::Band, 2..=2),
                    "bnot" => (Func::Bnot, 1..=1),
                    "equal" => (Func::Equal, 2..=2),
                    "above" => (Func::Above, 2..=2),
                    "below" => (Func::Below, 2..=2),
                    "fmod" => (Func::Fmod, 2..=2),
                    "freembuf" => (Func::Freembuf, 1..=1),
                    "memcpy" => (Func::Memcpy, 3..=3),
                    "memset" => (Func::Memset, 3..=3),
                    _ => return self.fail(format!("unknown function {name}()")),
                };
                arity(range, self)?;
                func(f, args.collect())
            }
        })
    }
}

/// Compile one block of equations, adding the names it uses to `symbols`.
pub fn compile(source: &str, symbols: &mut Symbols) -> Result<Program, Error> {
    let toks = lex(source)?;
    let mut parser = Parser { toks, at: 0, end: source.len(), symbols };
    let body = parser.sequence(&[])?;
    if parser.peek().is_some() {
        return parser.fail("unexpected token");
    }
    Ok(Program { body })
}

// --- running ----------------------------------------------------------------

/// What equations write besides variables: the two buffers, and the random source.
pub struct Memory {
    pub local: Vec<f64>,
    pub global: Vec<f64>,
    rng: u64,
}

impl Memory {
    pub fn new(seed: u64) -> Self {
        Self { local: Vec::new(), global: Vec::new(), rng: seed | 1 }
    }
    /// A uniform [0, 1). xorshift64*: fast, and repeatable for recorded runs.
    pub fn random(&mut self) -> f64 {
        self.rng ^= self.rng >> 12;
        self.rng ^= self.rng << 25;
        self.rng ^= self.rng >> 27;
        (self.rng.wrapping_mul(0x2545_F491_4F6C_DD1D) >> 11) as f64 / (1u64 << 53) as f64
    }
    fn buffer(&mut self, buffer: Buffer) -> &mut Vec<f64> {
        match buffer {
            Buffer::Local => &mut self.local,
            Buffer::Global => &mut self.global,
        }
    }
    fn read(&mut self, buffer: Buffer, index: f64) -> f64 {
        let i = index.floor();
        if !(0.0..MEGABUF as f64).contains(&i) {
            return 0.0;
        }
        self.buffer(buffer).get(i as usize).copied().unwrap_or(0.0)
    }
    fn slot(&mut self, buffer: Buffer, index: f64) -> Option<&mut f64> {
        let i = index.floor();
        if !(0.0..MEGABUF as f64).contains(&i) {
            return None;
        }
        let buf = self.buffer(buffer);
        let i = i as usize;
        if buf.len() <= i {
            buf.resize(i + 1, 0.0);
        }
        Some(&mut buf[i])
    }
}

fn truthy(x: f64) -> bool {
    x.abs() > EPSILON
}

fn apply(op: Assign, old: f64, value: f64) -> f64 {
    match op {
        Assign::Set => value,
        Assign::Add => old + value,
        Assign::Sub => old - value,
        Assign::Mul => old * value,
        Assign::Div => old / value,
        Assign::Mod => old % value,
        Assign::Pow => pow(old, value),
        Assign::BitAnd => ((old.floor() as i64) & (value.floor() as i64)) as f64,
        Assign::BitOr => ((old.floor() as i64) | (value.floor() as i64)) as f64,
    }
}

fn pow(x: f64, y: f64) -> f64 {
    let z = x.powf(y);
    if z.is_finite() { z } else { 0.0 }
}

impl Program {
    /// Run the program on `vars` (indexed by [`Symbols`] slot). Returns the value
    /// of the last statement.
    pub fn run(&self, vars: &mut [f64], memory: &mut Memory) -> f64 {
        let mut last = 0.0;
        for expr in &self.body {
            last = eval(expr, vars, memory);
        }
        last
    }

    pub fn is_empty(&self) -> bool {
        self.body.is_empty()
    }
}

pub fn eval(expr: &Expr, vars: &mut [f64], memory: &mut Memory) -> f64 {
    match expr {
        Expr::Num(n) => *n,
        Expr::Var(slot) => vars[*slot],
        Expr::Mem(buffer, index) => {
            let i = eval(index, vars, memory);
            memory.read(*buffer, i)
        }
        Expr::Neg(e) => -eval(e, vars, memory),
        Expr::Not(e) => {
            if truthy(eval(e, vars, memory)) {
                0.0
            } else {
                1.0
            }
        }
        Expr::Binary(op, a, b) => {
            // `&&` and `||` short-circuit, and test plain non-zero, as JavaScript does.
            if let Op::And | Op::Or = op {
                let left = eval(a, vars, memory);
                let truthy_js = |x: f64| x != 0.0 && !x.is_nan();
                return match op {
                    Op::And => (truthy_js(left) && truthy_js(eval(b, vars, memory))) as u8 as f64,
                    _ => (truthy_js(left) || truthy_js(eval(b, vars, memory))) as u8 as f64,
                };
            }
            let x = eval(a, vars, memory);
            let y = eval(b, vars, memory);
            match op {
                Op::Add => x + y,
                Op::Sub => x - y,
                Op::Mul => x * y,
                Op::Div => {
                    if y == 0.0 {
                        0.0
                    } else {
                        x / y
                    }
                }
                Op::Mod => {
                    if y == 0.0 {
                        0.0
                    } else {
                        let (fx, fy) = (x.floor(), y.floor());
                        if fy == 0.0 { f64::NAN } else { fx % fy }
                    }
                }
                Op::Pow => pow(x, y),
                Op::Eq => ((x - y).abs() < EPSILON) as u8 as f64,
                Op::Ne => ((x - y).abs() >= EPSILON) as u8 as f64,
                Op::Lt => (x < y) as u8 as f64,
                Op::Gt => (x > y) as u8 as f64,
                Op::Le => (x <= y) as u8 as f64,
                Op::Ge => (x >= y) as u8 as f64,
                Op::BitAnd => ((x.floor() as i64) & (y.floor() as i64)) as f64,
                Op::BitOr => ((x.floor() as i64) | (y.floor() as i64)) as f64,
                Op::And | Op::Or => unreachable!(),
            }
        }
        Expr::If(c, a, b) => {
            if truthy(eval(c, vars, memory)) {
                eval(a, vars, memory)
            } else {
                eval(b, vars, memory)
            }
        }
        Expr::SetVar(op, slot, value) => {
            let v = eval(value, vars, memory);
            let out = apply(*op, vars[*slot], v);
            vars[*slot] = out;
            out
        }
        Expr::SetMem(op, buffer, index, value) => {
            let i = eval(index, vars, memory);
            let v = eval(value, vars, memory);
            match memory.slot(*buffer, i) {
                Some(cell) => {
                    *cell = apply(*op, *cell, v);
                    *cell
                }
                None => v,
            }
        }
        Expr::Seq(list) => {
            let mut last = 0.0;
            for e in list {
                last = eval(e, vars, memory);
            }
            last
        }
        Expr::Loop(count, body) => {
            // Butterchurn's `for (i = 0; i < n; i++)`: a fractional count rounds up.
            let n = eval(count, vars, memory);
            let mut last = 0.0;
            let mut i = 0usize;
            while (i as f64) < n && i < MAX_LOOP {
                last = eval(body, vars, memory);
                i += 1;
            }
            last
        }
        Expr::While(body) => {
            let mut i = 0;
            loop {
                let v = eval(body, vars, memory);
                i += 1;
                if !truthy(v) || i >= MAX_LOOP {
                    return v;
                }
            }
        }
        Expr::Call(f, args) => call(*f, args, vars, memory),
    }
}

fn call(f: Func, args: &[Expr], vars: &mut [f64], memory: &mut Memory) -> f64 {
    let arg = |i: usize, vars: &mut [f64], memory: &mut Memory| eval(&args[i], vars, memory);
    let a = |vars: &mut [f64], memory: &mut Memory| eval(&args[0], vars, memory);
    match f {
        Func::Sin => a(vars, memory).sin(),
        Func::Cos => a(vars, memory).cos(),
        Func::Tan => a(vars, memory).tan(),
        Func::Asin => a(vars, memory).asin(),
        Func::Acos => a(vars, memory).acos(),
        Func::Atan => a(vars, memory).atan(),
        Func::Atan2 => {
            let y = arg(0, vars, memory);
            y.atan2(arg(1, vars, memory))
        }
        Func::Sqrt => a(vars, memory).abs().sqrt(),
        Func::Sqr => {
            let x = a(vars, memory);
            x * x
        }
        Func::Pow => {
            let x = arg(0, vars, memory);
            pow(x, arg(1, vars, memory))
        }
        Func::Exp => a(vars, memory).exp(),
        Func::Log => a(vars, memory).ln(),
        Func::Log10 => a(vars, memory).ln() * std::f64::consts::LOG10_E,
        Func::Abs => a(vars, memory).abs(),
        Func::Min | Func::Max => {
            let mut out = arg(0, vars, memory);
            for i in 1..args.len() {
                let v = arg(i, vars, memory);
                // JavaScript's Math.min/max: any NaN makes NaN.
                out = if out.is_nan() || v.is_nan() {
                    f64::NAN
                } else if f == Func::Min {
                    out.min(v)
                } else {
                    out.max(v)
                };
            }
            out
        }
        Func::Sign => {
            let x = a(vars, memory);
            if x > 0.0 {
                1.0
            } else if x < 0.0 {
                -1.0
            } else {
                0.0
            }
        }
        Func::Rand => {
            let n = a(vars, memory).floor();
            // Butterchurn's `rand`: the bound is floored, the result is not.
            if n < 1.0 { memory.random() } else { memory.random() * n }
        }
        Func::Floor | Func::Int => a(vars, memory).floor(),
        Func::Ceil => a(vars, memory).ceil(),
        Func::Invsqrt => 1.0 / a(vars, memory).abs().sqrt(),
        Func::Sigmoid => {
            let x = arg(0, vars, memory);
            let t = 1.0 + (-x * arg(1, vars, memory)).exp();
            if t.abs() > EPSILON { 1.0 / t } else { 0.0 }
        }
        Func::Bor => {
            let x = arg(0, vars, memory);
            (truthy(x) || truthy(arg(1, vars, memory))) as u8 as f64
        }
        Func::Band => {
            let x = arg(0, vars, memory);
            let y = arg(1, vars, memory);
            (truthy(x) && truthy(y)) as u8 as f64
        }
        Func::Bnot => (!truthy(a(vars, memory))) as u8 as f64,
        Func::Equal => {
            let x = arg(0, vars, memory);
            ((x - arg(1, vars, memory)).abs() < EPSILON) as u8 as f64
        }
        Func::Above => {
            let x = arg(0, vars, memory);
            (x > arg(1, vars, memory)) as u8 as f64
        }
        Func::Below => {
            let x = arg(0, vars, memory);
            (x < arg(1, vars, memory)) as u8 as f64
        }
        Func::Fmod => {
            let x = arg(0, vars, memory);
            x % arg(1, vars, memory)
        }
        Func::Freembuf => a(vars, memory),
        Func::Memcpy => {
            let (dst, src, len) = (arg(0, vars, memory), arg(1, vars, memory), arg(2, vars, memory));
            let (mut d, mut s, mut n) = (dst.floor() as i64, src.floor() as i64, len.floor() as i64);
            if s < 0 {
                n += s;
                d -= s;
                s = 0;
            }
            if d < 0 {
                n += d;
                s -= d;
                d = 0;
            }
            let values: Vec<f64> = (0..n.max(0)).map(|k| memory.read(Buffer::Local, (s + k) as f64)).collect();
            for (k, v) in values.into_iter().enumerate() {
                if let Some(cell) = memory.slot(Buffer::Local, (d + k as i64) as f64) {
                    *cell = v;
                }
            }
            dst
        }
        Func::Memset => {
            let (dst, value, len) = (arg(0, vars, memory), arg(1, vars, memory), arg(2, vars, memory));
            for k in 0..len.floor().max(0.0) as i64 {
                if let Some(cell) = memory.slot(Buffer::Local, dst.floor() + k as f64) {
                    *cell = value;
                }
            }
            dst
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Run `source` and read back the named variables.
    fn run(source: &str, read: &[&str]) -> Vec<f64> {
        let mut symbols = Symbols::default();
        let program = compile(source, &mut symbols).unwrap_or_else(|e| panic!("{e}: {source}"));
        for name in read {
            symbols.slot(name);
        }
        let mut vars = vec![0.0; symbols.len()];
        program.run(&mut vars, &mut Memory::new(1));
        read.iter().map(|n| vars[symbols.get(n).unwrap()]).collect()
    }

    #[test]
    fn arithmetic_and_precedence() {
        assert_eq!(run("a = 1 + 2 * 3 - 4 / 2;", &["a"]), [5.0]);
        assert_eq!(run("a = -2 ^ 2; b = 2 ^ 3 ^ 2;", &["a", "b"]), [-4.0, 512.0]);
        assert_eq!(run("a = (1 + 2) * 3;", &["a"]), [9.0]);
    }

    #[test]
    fn butterchurns_division_and_remainder() {
        assert_eq!(run("a = 1 / 0; b = 7.5 % 2; c = 5 % 0;", &["a", "b", "c"]), [0.0, 1.0, 0.0]);
        let d = run("d = 1; d /= 0; e = 7.5; e %= 2;", &["d", "e"]);
        assert!(d[0].is_infinite(), "`/=` divides as written");
        assert_eq!(d[1], 1.5, "`%=` is a float remainder");
    }

    #[test]
    fn comparisons_and_truth() {
        assert_eq!(run("a = 1 == 1.000001; b = 1 != 1.000001; c = 2 < 3;", &["a", "b", "c"]), [1.0, 0.0, 1.0]);
        assert_eq!(run("a = if(0.000001, 1, 2); b = !0.000001; c = 0.000001 && 1;", &["a", "b", "c"]), [2.0, 1.0, 1.0]);
        assert_eq!(run("a = band(1, 0) + bor(0, 1) + bnot(0) + equal(2, 2) + above(3, 2) + below(3, 2);", &["a"]), [4.0]);
    }

    #[test]
    fn functions() {
        assert_eq!(run("a = sqrt(-4); b = pow(-2, 0.5); c = sqr(3); d = sign(-2);", &["a", "b", "c", "d"]), [2.0, 0.0, 9.0, -1.0]);
        assert_eq!(run("a = min(3, 1, 2); b = max(3, 1, 2); c = int(-1.5); d = abs(-2);", &["a", "b", "c", "d"]), [1.0, 3.0, -2.0, 2.0]);
        assert_eq!(run("a = 3 & 5; b = 3 | 5;", &["a", "b"]), [1.0, 7.0]);
        // Butterchurn's `rand(n)` is `random * floor(n)`: a fraction, not a whole number.
        let r = run("a = rand(10.7);", &["a"])[0];
        assert!((0.0..10.0).contains(&r) && r.fract() != 0.0);
    }

    #[test]
    fn names_are_case_insensitive_and_shared() {
        let mut symbols = Symbols::default();
        let init = compile("Q1 = 2;", &mut symbols).unwrap();
        let frame = compile("x = q1 * 3;", &mut symbols).unwrap();
        let mut vars = vec![0.0; symbols.len()];
        let mut memory = Memory::new(1);
        init.run(&mut vars, &mut memory);
        frame.run(&mut vars, &mut memory);
        assert_eq!(vars[symbols.get("x").unwrap()], 6.0);
    }

    #[test]
    fn control_flow() {
        assert_eq!(run("a = 0; loop(3, a += 1; b = a);", &["a", "b"]), [3.0, 3.0]);
        assert_eq!(run("a = 5; while(a -= 1; a > 2);", &["a"]), [2.0]);
        assert_eq!(run("a = 1 ? 2 : 3; b = 0 ? 2 : 3; c = exec2(d = 4, d + 1);", &["a", "b", "c"]), [2.0, 3.0, 5.0]);
        assert_eq!(run("a = (b = 3; b + 1); assign(c, 7);", &["a", "c"]), [4.0, 7.0]);
    }

    #[test]
    fn memory() {
        assert_eq!(run("megabuf(3) = 2; a = megabuf(3) + megabuf(-1); gmegabuf(1) += 5; b = gmegabuf(1);", &["a", "b"]), [2.0, 5.0]);
        assert_eq!(run("memset(10, 7, 3); memcpy(20, 10, 3); a = megabuf(22);", &["a"]), [7.0]);
    }

    #[test]
    fn constants_numbers_and_comments() {
        let v = run("a = $PI; b = 0x10 + $x10; c = 1e3 + .5 + 5.; // done\n/* d = 9; */", &["a", "b", "c", "d"]);
        assert_eq!(v, [std::f64::consts::PI, 32.0, 1005.5, 0.0]);
    }

    #[test]
    fn ns_eel_lexer_quirks() {
        assert_eq!(run("a = .-.4; \\\\ b = 9;\nc = 1;", &["a", "b", "c"]), [-0.4, 0.0, 1.0]);
    }

    #[test]
    fn errors_say_where() {
        let mut symbols = Symbols::default();
        assert!(compile("a = ;", &mut symbols).is_err());
        assert!(compile("a = nosuch(1);", &mut symbols).unwrap_err().message.contains("nosuch"));
    }
}
