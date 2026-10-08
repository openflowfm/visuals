//! Helpers shared by the bins that include this module with `mod common;`.
//! Everything here is used by every bin that includes it.

/// A size given as `WxH` (for example `1920x1080`), or `None` when it isn't one.
pub fn parse_size(s: &str) -> Option<(u32, u32)> {
    let (w, h) = s.split_once('x')?;
    Some((w.parse().ok()?, h.parse().ok()?))
}

#[cfg(test)]
mod tests {
    use super::parse_size;

    #[test]
    fn reads_width_by_height() {
        assert_eq!(parse_size("1920x1080"), Some((1920, 1080)));
        assert_eq!(parse_size("0x0"), Some((0, 0)));
    }

    #[test]
    fn refuses_anything_else() {
        for s in ["", "1920", "1920x", "x1080", "1920X1080", "wxh", "-1x10", "1920x1080x2"] {
            assert_eq!(parse_size(s), None, "{s}");
        }
    }
}
