/**
 * A WebGL 2 renderer for Stuxnet.OpenGL shaders: one full-screen quad with the plugin's inputs
 * (time, resolution, playback_frame, screen_texture). Used by the shader editor and behind the
 * animated theme timeline.
 */
import { parseLog, ShaderError, toWebGL } from "../core/shader";

function compile(gl: WebGL2RenderingContext, type: number, src: string): { shader: WebGLShader | null; log: string } {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s) ?? "compile failed";
    gl.deleteShader(s);
    return { shader: null, log };
  }
  return { shader: s, log: "" };
}

export interface BuildResult {
  vertexErrors: ShaderError[];
  fragmentErrors: ShaderError[];
  linkError: string | null;
  ok: boolean;
}

export class ShaderRenderer {
  readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  frame = 0;

  static create(canvas: HTMLCanvasElement): ShaderRenderer | null {
    const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false });
    return gl ? new ShaderRenderer(gl) : null;
  }

  private constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    // position (vec3) + uv (vec2), two triangles covering the screen
    const quad = new Float32Array([-1, -1, 0, 0, 0, 1, -1, 0, 1, 0, 1, 1, 0, 1, 1, -1, -1, 0, 0, 0, 1, 1, 0, 1, 1, -1, 1, 0, 0, 1]);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  }

  /** Compile both shaders. On failure the previous program keeps drawing. */
  build(vertexSrc: string, fragmentSrc: string): BuildResult {
    const gl = this.gl;
    const vs = toWebGL(vertexSrc);
    const fs = toWebGL(fragmentSrc);
    const v = compile(gl, gl.VERTEX_SHADER, vs.source);
    const f = compile(gl, gl.FRAGMENT_SHADER, fs.source);
    const res: BuildResult = { vertexErrors: parseLog(v.log, vs.offset), fragmentErrors: parseLog(f.log, fs.offset), linkError: null, ok: false };
    if (!v.shader || !f.shader) {
      if (v.shader) gl.deleteShader(v.shader);
      if (f.shader) gl.deleteShader(f.shader);
      return res;
    }
    const p = gl.createProgram()!;
    gl.attachShader(p, v.shader);
    gl.attachShader(p, f.shader);
    gl.bindAttribLocation(p, 0, "in_position");
    gl.bindAttribLocation(p, 1, "in_uv");
    gl.linkProgram(p);
    gl.deleteShader(v.shader);
    gl.deleteShader(f.shader);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      res.linkError = gl.getProgramInfoLog(p) ?? "link failed";
      gl.deleteProgram(p);
      return res;
    }
    if (this.program) gl.deleteProgram(this.program);
    this.program = p;
    this.uniforms = Object.fromEntries(["time", "resolution", "playback_frame", "screen_texture"].map((n) => [n, gl.getUniformLocation(p, n)]));
    this.frame = 0;
    res.ok = true;
    return res;
  }

  /** What screen_texture shows (drawn upright, like the game's screen dump). */
  setScreen(source: TexImageSource) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  get ready() {
    return !!this.program;
  }

  /** Draw a frame. `size` fixes the drawing size (off-screen use); otherwise it follows the canvas on screen. */
  draw(time: number, size?: { w: number; h: number }) {
    const gl = this.gl;
    const c = gl.canvas as HTMLCanvasElement;
    const w = size ? size.w : Math.max(1, Math.round(c.clientWidth * Math.min(2, devicePixelRatio)));
    const h = size ? size.h : Math.max(1, Math.round(c.clientHeight * Math.min(2, devicePixelRatio)));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    if (!this.program) return;
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.program);
    const u = this.uniforms;
    if (u.time) gl.uniform1f(u.time, time);
    if (u.resolution) gl.uniform2f(u.resolution, w, h);
    if (u.playback_frame) gl.uniform1i(u.playback_frame, this.frame);
    if (u.screen_texture) gl.uniform1i(u.screen_texture, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.frame++;
  }
}
