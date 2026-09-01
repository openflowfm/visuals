/**
 * The small amount of WebGL2 the compositor needs, and nothing more.
 *
 * There is no scene graph here and there shouldn't be. Every layer is one
 * full-screen pass, so the only objects worth naming are a program, a target to
 * draw into, and the triangle that covers the screen.
 */

/**
 * One triangle, not two.
 *
 * A full-screen quad is two triangles with a seam down the diagonal, where
 * neighbouring fragments come from different primitives and interpolation is
 * very slightly discontinuous. A single oversized triangle covers the viewport
 * with no seam and one fewer vertex, and it is the standard trick for exactly
 * this kind of pass.
 */
const VERTEX = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export interface Program {
  program: WebGLProgram;
  uniform(name: string): WebGLUniformLocation | null;
}

export function compile(gl: WebGL2RenderingContext, fragment: string, label: string): Program {
  const build = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`${label}: ${log}`);
    }
    return shader;
  };

  const vs = build(gl.VERTEX_SHADER, VERTEX);
  const fs = build(gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`${label}: ${log}`);
  }

  // Uniform lookups are string hashes into the driver, so they are cached. A
  // frame touches a dozen per layer and this runs sixty times a second.
  const cache = new Map<string, WebGLUniformLocation | null>();
  return {
    program,
    uniform(name) {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
      return cache.get(name) ?? null;
    },
  };
}

export interface Target {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  resize(width: number, height: number): void;
  free(): void;
}

/**
 * Whether this driver will let us render into half floats.
 *
 * Asked once per context and cached, because `getExtension` is not free and this
 * is asked on every target a resize creates.
 */
const floatable = new WeakMap<WebGL2RenderingContext, boolean>();
function halfFloatOk(gl: WebGL2RenderingContext): boolean {
  const known = floatable.get(gl);
  if (known !== undefined) return known;
  const has = gl.getExtension('EXT_color_buffer_float') !== null;
  floatable.set(gl, has);
  return has;
}

/**
 * Every intermediate buffer, in half floats where the driver allows it.
 *
 * This was RGBA8, and eight bits between the flow and the screen cost two things
 * that both showed up as "it looks cheaper than the reference" and neither of
 * which was in the flows.
 *
 * **Light above white was thrown away before anything could use it.** The
 * renderer deliberately carries colour past one — see OVERBRIGHT — and the
 * output stage's shoulder is built to roll that excess back down into the top of
 * the range, which is what puts a genuinely white core on a lit stroke. Written
 * to eight bits first, everything above one clamped to one *before* the shoulder
 * saw it, and the shoulder maps one to 0.908. So no pixel the app has ever drawn
 * reached higher than 232 of 255: our whites were grey, by construction, on
 * every wall.
 *
 * **And a gradient had nowhere to be smooth.** A halo falling off over a few
 * hundred pixels crosses far fewer than 256 levels, so it arrived at the output
 * stage already stepped, and no amount of dithering at the end can put back
 * detail that was quantised at the start. The contour rings visible across the
 * dark side of a lit tube were this.
 *
 * Half floats rather than full: the precision needed is a few thousand levels
 * across the range, not sixteen million, and this is three buffers at the wall's
 * resolution plus the feedback history — bandwidth a show pays for every frame.
 */
export function createTarget(gl: WebGL2RenderingContext): Target {
  const texture = gl.createTexture()!;
  const framebuffer = gl.createFramebuffer()!;
  const deep = halfFloatOk(gl);
  let w = 0;
  let h = 0;

  const resize = (width: number, height: number) => {
    if (width === w && height === h) return;
    w = width;
    h = height;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (deep) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // CLAMP_TO_EDGE and not REPEAT: an effect that samples past the edge should
    // smear the edge pixel, not wrap the opposite side of the frame into view.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  return {
    framebuffer,
    texture,
    resize,
    free() {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
    },
  };
}

export function drawFullscreen(gl: WebGL2RenderingContext): void {
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/** 0xRRGGBB to the 0–1 triple a shader wants. */
export function rgb(color: number): [number, number, number] {
  return [((color >> 16) & 0xff) / 255, ((color >> 8) & 0xff) / 255, (color & 0xff) / 255];
}
