import { vertex, fragment } from "./shader";

/** One shared WebGL context; DOM retains all input, text and accessibility. */
export class GlassRenderer {
  readonly canvas = document.createElement("canvas");
  readonly gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private buffer: WebGLBuffer;
  private texture: WebGLTexture;
  private accumTexture: WebGLTexture;
  private glassTexture: WebGLTexture;
  private elementFbo: WebGLFramebuffer;
  private accumFbo: WebGLFramebuffer;
  private compositeProgram: WebGLProgram;
  private compositeBuffer: WebGLBuffer;
  private scene = document.createElement("canvas");
  private sceneKey = "";
  private sceneWidth = 1;
  private sceneHeight = 1;
  constructor() {
    const gl = this.canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error("WebGL unavailable");
    this.gl = gl;
    const shaders: WebGLShader[] = [];
    const program = gl.createProgram()!;
    try {
      for (const [type, source] of [
        [gl.VERTEX_SHADER, vertex],
        [gl.FRAGMENT_SHADER, fragment],
      ] as const) {
        const shader = gl.createShader(type)!;
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
          throw new Error(
            gl.getShaderInfoLog(shader) || "Shader compilation failed",
          );
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(
          gl.getProgramInfoLog(program) || "Shader linking failed",
        );
    } catch (error) {
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      throw error;
    } finally {
      shaders.forEach((s) => gl.deleteShader(s));
    }
    this.program = program;
    this.buffer = gl.createBuffer()!;
    this.texture = gl.createTexture()!;
    this.accumTexture = gl.createTexture()!;
    this.glassTexture = gl.createTexture()!;
    this.elementFbo = gl.createFramebuffer()!;
    this.accumFbo = gl.createFramebuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.useProgram(program);
    const pos = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    for (const tex of [this.accumTexture, this.glassTexture]) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    this.compositeProgram = this.createCompositeProgram();
    this.compositeBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.compositeBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
  }
  private createCompositeProgram() {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(
      vs,
      `attribute vec2 aPosition; uniform vec4 uRect; uniform vec2 uViewport; varying vec2 vUv; void main(){ vec2 uv=aPosition*.5+.5; vec2 p=(uRect.xy+uv*uRect.zw)/uViewport; gl_Position=vec4(p*2.-1.,0.,1.); vUv=uv; }`,
    );
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(
      fs,
      `precision mediump float; uniform sampler2D uGlass; varying vec2 vUv; void main(){ gl_FragColor=texture2D(uGlass,vUv); }`,
    );
    gl.compileShader(fs);
    const p = gl.createProgram()!;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return p;
  }
  backdrop(width: number, height: number, light: boolean) {
    const key = `${width}:${height}:${light}`;
    if (key === this.sceneKey) {
      this.beginFrame();
      return;
    }
    this.sceneKey = key;
    this.sceneWidth = Math.max(1, Math.round(width));
    this.sceneHeight = Math.max(1, Math.round(height));
    this.scene.width = this.sceneWidth;
    this.scene.height = this.sceneHeight;
    const ctx = this.scene.getContext("2d")!;
    ctx.fillStyle = light ? "#ededf2" : "#0b0c10";
    ctx.fillRect(0, 0, this.sceneWidth, this.sceneHeight);
    for (const [x, y, r, color] of [
      [0.12, 0.15, 0.8, light ? "#dddde8" : "#242633"],
      [0.85, 0.4, 0.6, light ? "#d0d3e1" : "#292d43"],
      [0.4, 1, 0.7, light ? "#fafafa" : "#131419"],
    ] as const) {
      const gradient = ctx.createRadialGradient(
        x * this.sceneWidth,
        y * this.sceneHeight,
        0,
        x * this.sceneWidth,
        y * this.sceneHeight,
        r * this.sceneWidth,
      );
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, light ? "#ededf200" : "#0b0c1000");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, this.sceneWidth, this.sceneHeight);
    }
    ctx.strokeStyle = light ? "#ffffff50" : "#d9ddf219";
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(this.sceneWidth * 0.64 + i * 32, this.sceneHeight * 0.8);
      ctx.lineTo(this.sceneWidth * 0.96 + i * 32, this.sceneHeight * 0.08);
      ctx.stroke();
    }
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.scene,
    );
    gl.bindTexture(gl.TEXTURE_2D, this.accumTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.scene,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.accumFbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.accumTexture,
      0,
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      throw new Error("Liquid glass accumulation framebuffer is incomplete");
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  private beginFrame() {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.accumTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.scene,
    );
  }
  draw(
    target: HTMLCanvasElement,
    rect: DOMRect,
    radius: number | [number, number, number, number],
    light: boolean,
    material = 0.5,
    openBottom = false,
    time = performance.now() / 1000,
  ) {
    if (this.gl.isContextLost()) throw new Error("WebGL context lost");
    const gl = this.gl;
    const dpr = Math.min(
      devicePixelRatio || 1,
      2,
      3072 / Math.max(rect.width, rect.height),
    );
    const w = Math.max(1, Math.round(rect.width * dpr)),
      h = Math.max(1, Math.round(rect.height * dpr));
    this.canvas.width = w;
    this.canvas.height = h;
    gl.bindTexture(gl.TEXTURE_2D, this.glassTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      w,
      h,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.elementFbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.glassTexture,
      0,
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error("Liquid glass element framebuffer is incomplete");
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const uniform = (name: string) => gl.getUniformLocation(this.program, name);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.accumTexture);
    gl.uniform1i(uniform("uScene"), 0);
    gl.uniform2f(uniform("uSize"), rect.width, rect.height);
    gl.uniform2f(uniform("uViewport"), innerWidth, innerHeight);
    gl.uniform2f(uniform("uOffset"), rect.left, rect.top);
    gl.uniform1f(uniform("uDpr"), dpr);
    const radii =
      typeof radius === "number" ? [radius, radius, radius, radius] : radius;
    gl.uniform4f(uniform("uRadii"), radii[0], radii[1], radii[2], radii[3]);
    gl.uniform1f(uniform("uOpenBottom"), openBottom ? 1 : 0);
    // Analytic per-corner geometry matches the DOM border without quantized
    // mask gradients or a second, differently shaped clipping outline.
    gl.uniform1f(uniform("uCornerStyle"), 0);
    gl.uniform1f(uniform("uUseContinuousSdf"), 0);
    gl.uniform1f(uniform("uLight"), light ? 1 : 0);
    gl.uniform1f(uniform("uMaterial"), material);
    gl.uniform1f(uniform("uTime"), time);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.compositeProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.compositeBuffer);
    const localPos = gl.getAttribLocation(this.compositeProgram, "aPosition");
    gl.enableVertexAttribArray(localPos);
    gl.vertexAttribPointer(localPos, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.glassTexture);
    gl.uniform1i(gl.getUniformLocation(this.compositeProgram, "uGlass"), 0);
    gl.uniform4f(
      gl.getUniformLocation(this.compositeProgram, "uRect"),
      0,
      0,
      rect.width,
      rect.height,
    );
    gl.uniform2f(
      gl.getUniformLocation(this.compositeProgram, "uViewport"),
      rect.width,
      rect.height,
    );
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    target.width = w;
    target.height = h;
    target.getContext("2d")?.drawImage(this.canvas, 0, 0);
    // Feed this freshly rendered surface back into the accumulated scene.
    // The next surface therefore samples the already-composited glass below it.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.accumFbo);
    gl.viewport(0, 0, this.sceneWidth, this.sceneHeight);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(
      Math.max(0, Math.floor(rect.left)),
      Math.max(0, Math.floor(this.sceneHeight - rect.top - rect.height)),
      Math.min(this.sceneWidth, Math.ceil(rect.width)),
      Math.min(this.sceneHeight, Math.ceil(rect.height)),
    );
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.compositeProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.compositeBuffer);
    const pos = gl.getAttribLocation(this.compositeProgram, "aPosition");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.glassTexture);
    gl.uniform1i(gl.getUniformLocation(this.compositeProgram, "uGlass"), 0);
    gl.uniform4f(
      gl.getUniformLocation(this.compositeProgram, "uRect"),
      rect.left,
      this.sceneHeight - rect.top - rect.height,
      rect.width,
      rect.height,
    );
    gl.uniform2f(
      gl.getUniformLocation(this.compositeProgram, "uViewport"),
      this.sceneWidth,
      this.sceneHeight,
    );
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.program);
  }
  dispose() {
    this.gl.deleteTexture(this.texture);
    this.gl.deleteTexture(this.accumTexture);
    this.gl.deleteTexture(this.glassTexture);
    this.gl.deleteFramebuffer(this.elementFbo);
    this.gl.deleteFramebuffer(this.accumFbo);
    this.gl.deleteBuffer(this.compositeBuffer);
    this.gl.deleteProgram(this.compositeProgram);
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteProgram(this.program);
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.canvas.width =
      this.canvas.height =
      this.scene.width =
      this.scene.height =
        1;
  }
}
