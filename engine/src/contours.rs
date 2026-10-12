//! Optional external geometry for the basic waveform stage. Coordinates are
//! top-left source pixels; emission touches only stroke coverage, never the room.
use crate::draw::{Blend, Cmd, DrawList, Source, Topology, Vertex};
use crate::runtime::Size;

#[derive(Clone, Debug, serde::Deserialize)]
pub struct Point {
    pub x: f32,
    pub y: f32,
    pub color: Option<[f32; 3]>,
}
#[derive(Clone, Debug, serde::Deserialize)]
pub struct Path {
    pub closed: bool,
    pub points: Vec<Point>,
}
#[derive(Clone, Debug, serde::Deserialize)]
pub struct Contours {
    pub width: u32,
    pub height: u32,
    pub mix: f32,
    pub color: Option<[f32; 3]>,
    pub paths: Vec<Path>,
}
impl Contours {
    pub fn validate(&self) -> Result<(), &'static str> {
        let color_ok = |color: Option<[f32; 3]>| color.is_none_or(|c| c.iter().all(|v| v.is_finite() && (0.0..=1.0).contains(v)));
        if self.width == 0 || self.height == 0 || self.width > 640 || self.height > 360 || !self.mix.is_finite() || !(0.0..=1.0).contains(&self.mix) || !color_ok(self.color) || self.paths.len() > 512
        {
            return Err("invalid contour dimensions, mix, color or path count");
        }
        let mut count = 0usize;
        for path in &self.paths {
            count += path.points.len();
            if count > 8192 || path.points.len() < 2 || (path.closed && path.points.len() < 3) {
                return Err("contours require 2 points per path (3 closed), at most 8192 total");
            }
            for point in &path.points {
                if !point.x.is_finite() || !point.y.is_finite() || !(0.0..=self.width as f32).contains(&point.x) || !(0.0..=self.height as f32).contains(&point.y) || !color_ok(point.color) {
                    return Err("contour points must be finite source pixels with RGB 0..1");
                }
            }
        }
        Ok(())
    }
    /// Screen-space antialias fringes surrounding an additive, constant-width
    /// stroke. No implicit segment connects separate paths. Geometry is already
    /// stabilized by the source; native refreshes crossfade rather than invent
    /// correspondence between unrelated path ordinals.
    pub(crate) fn draw(&self, size: &Size, bass: f64, list: &mut DrawList) {
        self.draw_width(size, bass, list, None);
    }
    pub(crate) fn draw_width(&self, size: &Size, bass: f64, list: &mut DrawList, width: Option<f32>) {
        let first = list.vertices.len() as u32;
        let scale = size.texsize_y as f32 / 720.0;
        let fit = (size.texsize_x as f32 / self.width as f32).min(size.texsize_y as f32 / self.height as f32);
        let offset = [(size.texsize_x as f32 - self.width as f32 * fit) * 0.5, (size.texsize_y as f32 - self.height as f32 * fit) * 0.5];
        let core = width.map_or(0.65 * scale.max(0.5), |w| w * fit * 0.5);
        let offsets = [-(core + 1.0), -core, core, core + 1.0];
        let alpha = [0.0, 1.0, 1.0, 0.0];
        let emission = (self.mix * (0.85 + 0.15 * bass.clamp(0.0, 2.0) as f32)).min(1.0);
        let fallback = self.color.unwrap_or([0.1, 0.9, 1.0]);
        for path in &self.paths {
            let n = path.points.len();
            for i in 0..n.saturating_sub(1) + usize::from(path.closed) {
                let (a, b) = (&path.points[i % n], &path.points[(i + 1) % n]);
                let pixel = |p: &Point| [offset[0] + p.x * fit, offset[1] + p.y * fit];
                let (a_pos, b_pos) = (pixel(a), pixel(b));
                let (dx, dy) = (b_pos[0] - a_pos[0], b_pos[1] - a_pos[1]);
                let length = dx.hypot(dy);
                if length < 0.001 {
                    continue;
                }
                let normal = [-dy / length, dx / length];
                let vertex = |p: [f32; 2], c: [f32; 3], offset: usize| Vertex {
                    pos: [(p[0] + normal[0] * offsets[offset]) / size.texsize_x as f32 * 2.0 - 1.0, (p[1] + normal[1] * offsets[offset]) / size.texsize_y as f32 * 2.0 - 1.0],
                    color: [c[0], c[1], c[2], alpha[offset] * emission],
                    uv: [0.0; 2],
                    textured: 0.0,
                };
                for strip in 0..3 {
                    let (a0, a1, b0, b1) = (
                        vertex(a_pos, a.color.unwrap_or(fallback), strip),
                        vertex(a_pos, a.color.unwrap_or(fallback), strip + 1),
                        vertex(b_pos, b.color.unwrap_or(fallback), strip),
                        vertex(b_pos, b.color.unwrap_or(fallback), strip + 1),
                    );
                    list.vertices.extend([a0, b0, a1, a1, b0, b1]);
                }
            }
        }
        let count = list.vertices.len() as u32 - first;
        if count > 0 {
            list.cmds.push(Cmd { topology: Topology::Triangles, blend: Blend::Additive, first, count, source: Source::External });
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_and_unbounded_geometry() {
        let mut c = Contours { width: 320, height: 180, mix: 0.5, color: None, paths: vec![] };
        assert!(c.validate().is_ok());
        c.paths.push(Path { closed: false, points: vec![Point { x: 0.0, y: 0.0, color: None }, Point { x: 1.0, y: 1.0, color: None }] });
        assert!(c.validate().is_ok());
        c.paths[0].points[1].x = f32::NAN;
        assert!(c.validate().is_err());
        c.paths[0].points[1].x = 321.0;
        assert!(c.validate().is_err());
        c.paths[0].points[1].x = 1.0;
        c.paths[0].points = vec![c.paths[0].points[0].clone(); 8193];
        assert!(c.validate().is_err());
    }
}
