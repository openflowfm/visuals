//! A preset's palette, gathered over several pictures: how its colour divides
//! among twelve hues, how warm or cold and how varied it is, how colourful
//! (Hasler and Süsstrunk's measure), and the shares of dark and of pale bright
//! pixels.

use super::colour::hsv;

/// Hue bins, 30° each, centred on the hue they're named for (red at 0°).
pub const HUES: [&str; 12] = ["red", "orange", "yellow", "chartreuse", "green", "spring", "cyan", "azure", "blue", "violet", "magenta", "rose"];
/// A pixel counts towards a hue when at least this saturated and this bright
/// (as [`super::colour::Hues`]).
const MIN_SATURATION: f32 = 0.25;
const MIN_VALUE: f32 = 0.2;
/// Below this coloured weight per pixel the pictures are grey: no hue shares.
const MIN_COLOURED: f64 = 0.01;
/// The hue warm colour centres on (orange); cold is opposite (azure).
const WARM: f64 = 30.0;

/// Colour gathered from any number of RGBA pictures.
#[derive(Debug, Clone, Default)]
pub struct Palette {
    /// Per hue bin: saturation × value summed.
    weight: [f64; 12],
    /// The weighted unit vectors of every coloured pixel's hue.
    x: f64,
    y: f64,
    /// Hasler–Süsstrunk opponent channels: sums and sums of squares, 0–255.
    rg: (f64, f64),
    yb: (f64, f64),
    dark: usize,
    pale: usize,
    pixels: usize,
}

impl Palette {
    pub fn add(&mut self, rgba: &[u8]) {
        for p in rgba.chunks_exact(4) {
            self.pixels += 1;
            let (r, g, b) = (p[0] as f64, p[1] as f64, p[2] as f64);
            let (rg, yb) = (r - g, 0.5 * (r + g) - b);
            self.rg = (self.rg.0 + rg, self.rg.1 + rg * rg);
            self.yb = (self.yb.0 + yb, self.yb.1 + yb * yb);
            let (h, s, v) = hsv(p[0], p[1], p[2]);
            if v < 0.08 {
                self.dark += 1;
            }
            if v > 0.6 && s < 0.2 {
                self.pale += 1;
            }
            if s < MIN_SATURATION || v < MIN_VALUE {
                continue;
            }
            let w = (s * v) as f64;
            self.weight[((h + 15.0) / 30.0) as usize % 12] += w;
            let a = (h as f64).to_radians();
            self.x += w * a.cos();
            self.y += w * a.sin();
        }
    }

    /// Saturation × value of the coloured pixels, per pixel of every picture: 0 grey, up to 1.
    pub fn coloured(&self) -> f64 {
        self.weight.iter().sum::<f64>() / self.pixels.max(1) as f64
    }

    fn colourful(&self) -> bool {
        self.pixels > 0 && self.coloured() >= MIN_COLOURED
    }

    /// Each hue bin's share of the coloured weight, in [`HUES`]' order, summing
    /// to 1; `None` for grey pictures.
    pub fn shares(&self) -> Option<[f64; 12]> {
        let total: f64 = self.weight.iter().sum();
        self.colourful().then(|| self.weight.map(|w| w / total))
    }

    /// How warm the colour is: the weighted mean of the cosine of each hue's
    /// angle from orange, 1 all orange, −1 all azure, near 0 for green, purple
    /// or a balance; `None` for grey pictures.
    pub fn temperature(&self) -> Option<f64> {
        let total: f64 = self.weight.iter().sum();
        let warm = WARM.to_radians();
        self.colourful().then(|| (self.x * warm.cos() + self.y * warm.sin()) / total)
    }

    /// How spread over the hue circle the colour is: 0 one hue, 1 every hue
    /// evenly (or two opposite); `None` for grey pictures.
    pub fn spread(&self) -> Option<f64> {
        let total: f64 = self.weight.iter().sum();
        self.colourful().then(|| 1.0 - self.x.hypot(self.y) / total)
    }

    /// Hasler and Süsstrunk's colourfulness over every pixel, divided by 100:
    /// 0 grey, about 0.3 moderately and 1 extremely colourful.
    pub fn colourfulness(&self) -> f64 {
        let n = self.pixels.max(1) as f64;
        let sd = |(s, q): (f64, f64)| (q / n - (s / n).powi(2)).max(0.0);
        let (mrg, myb) = (self.rg.0 / n, self.yb.0 / n);
        ((sd(self.rg) + sd(self.yb)).sqrt() + 0.3 * mrg.hypot(myb)) / 100.0
    }

    /// The share of pixels that are nearly black (value under 0.08).
    pub fn dark(&self) -> f64 {
        self.dark as f64 / self.pixels.max(1) as f64
    }

    /// The share of pixels bright and nearly grey (value over 0.6, saturation
    /// under 0.2): white, silver, chrome highlights.
    pub fn pale(&self) -> f64 {
        self.pale as f64 / self.pixels.max(1) as f64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn palette(pixels: &[([u8; 3], usize)]) -> Palette {
        let mut p = Palette::default();
        let rgba: Vec<u8> = pixels.iter().flat_map(|&(c, n)| std::iter::repeat_n([c[0], c[1], c[2], 255], n)).flatten().collect();
        p.add(&rgba);
        p
    }

    #[test]
    fn pure_red_is_all_red_and_warm() {
        let p = palette(&[([255, 0, 0], 100)]);
        let s = p.shares().unwrap();
        assert_eq!(s[0], 1.0);
        assert!(p.temperature().unwrap() > 0.8);
        assert!(p.spread().unwrap() < 1e-9);
        assert!(p.colourfulness() > 0.8);
    }

    #[test]
    fn blue_is_cold_and_red_and_cyan_spread() {
        let blue = palette(&[([0, 60, 255], 100)]);
        assert!(blue.shares().unwrap()[7] + blue.shares().unwrap()[8] > 0.99);
        assert!(blue.temperature().unwrap() < -0.7, "{:?}", blue.temperature());
        let both = palette(&[([255, 0, 0], 50), ([0, 255, 255], 50)]);
        assert!(both.spread().unwrap() > 0.99);
    }

    #[test]
    fn grey_has_no_hues_and_counts_dark_and_pale() {
        let p = palette(&[([0, 0, 0], 50), ([220, 220, 220], 25), ([90, 90, 90], 25)]);
        assert_eq!((p.shares(), p.temperature(), p.spread()), (None, None, None));
        assert_eq!((p.dark(), p.pale()), (0.5, 0.25));
        assert!(p.colourfulness() < 1e-9);
    }
}
