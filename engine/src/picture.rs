//! Pictures the engine reads back, written out as files.

use std::io::{BufWriter, Write};
use std::path::Path;

/// Writes `rgba` (`width × height` pixels, 8 bits a channel, rows top to bottom)
/// to `path` as a PNG.
pub fn save_png(path: &Path, width: u32, height: u32, rgba: &[u8]) -> std::io::Result<()> {
    let mut out = BufWriter::new(std::fs::File::create(path)?);
    write_png(&mut out, width, height, rgba)?;
    out.flush()
}

fn write_png(out: impl Write, width: u32, height: u32, rgba: &[u8]) -> std::io::Result<()> {
    let mut encoder = png::Encoder::new(out, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header()?;
    writer.write_image_data(rgba)?;
    writer.finish()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_a_png_that_reads_back() {
        let path = std::env::temp_dir().join(format!("visuals-save-png-{}.png", std::process::id()));
        let pixels: Vec<u8> = (0..2 * 3 * 4).map(|i| i as u8 * 10).collect();
        save_png(&path, 2, 3, &pixels).unwrap();
        let decoder = png::Decoder::new(std::fs::File::open(&path).unwrap());
        let mut reader = decoder.read_info().unwrap();
        let mut back = vec![0; reader.output_buffer_size()];
        let info = reader.next_frame(&mut back).unwrap();
        std::fs::remove_file(&path).unwrap();
        assert_eq!((info.width, info.height, info.color_type, info.bit_depth), (2, 3, png::ColorType::Rgba, png::BitDepth::Eight));
        assert_eq!(&back[..info.buffer_size()], &pixels[..]);
    }

    #[test]
    fn refuses_pixels_that_do_not_fit_the_size() {
        assert!(write_png(Vec::new(), 2, 2, &[0; 4]).is_err());
    }
}
