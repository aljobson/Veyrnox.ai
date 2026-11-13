import { VERTEX, FRAGMENT } from './shaders.js';
import { createFaceMask } from './masks.js';
import { colorMatrix, normalize, toneLut, EFFECTS } from '../../../../packages/live-edit/effects.js';
import { drawStickers } from '../../../../packages/live-edit/stickers.js';

/** One full-resolution pipeline for preview and export; no page WASM. */
export function createPhotoRenderer(output, source) {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('graphics-unavailable');
    const ctx = output.getContext('2d');
    const shaders = [], textures = [];
    let program, buffer, closed = false;
    function close() {
        if (closed) return;
        closed = true;
        textures.forEach(t => gl.deleteTexture(t)); shaders.forEach(s => gl.deleteShader(s));
        if (buffer) gl.deleteBuffer(buffer); if (program) gl.deleteProgram(program);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        canvas.width = canvas.height = output.width = output.height = 1;
    }
    try {
        const width = source.naturalWidth ?? source.width, height = source.naturalHeight ?? source.height;
        const bound = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), ...gl.getParameter(gl.MAX_VIEWPORT_DIMS));
        if (!ctx || Math.max(width, height) > bound) throw new Error('photo-too-large');
        canvas.width = output.width = width; canvas.height = output.height = height;
        const compile = (type, code) => {
            const shader = gl.createShader(type); shaders.push(shader); gl.shaderSource(shader, code); gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('graphics-unavailable');
            return shader;
        };
        program = gl.createProgram();
        gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('graphics-unavailable');
        gl.useProgram(program); gl.disable(gl.DITHER); gl.disable(gl.BLEND);
        buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        const locations = Object.fromEntries(['source','mask','lut','pixel','row0','row1','row2','offset','touch','finish'].map(k => [k, gl.getUniformLocation(program, k)]));
        for (let unit = 0; unit < 3; unit++) {
            const texture = gl.createTexture(); textures.push(texture); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        }
        function upload(unit, input) {
            gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, textures[unit]);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, input);
        }
        upload(0, source);
        gl.uniform1i(locations.source, 0); gl.uniform1i(locations.mask, 1); gl.uniform1i(locations.lut, 2);
        gl.uniform2f(locations.pixel, 1 / width, 1 / height); gl.viewport(0, 0, width, height);
        let lutKind, mask;
        const api = {
            setLandmarks(points) {
                mask = createFaceMask(width, height, points); upload(1, mask);
                mask.width = mask.height = 1;
            },
            draw(settings) {
                if (closed || gl.isContextLost()) throw new Error('graphics-lost');
                const s = normalize(settings);
                const neutral = EFFECTS.every(e => s[e.id] === 0) && (s.look === 'original' || s.strength === 0) && (s.lut === 'none' || s.lutStrength === 0);
                ctx.clearRect(0, 0, width, height);
                if (neutral) ctx.drawImage(source, 0, 0);
                else {
                    if (lutKind !== s.lut) {
                        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, textures[2]);
                        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, toneLut(s.lut)); lutKind = s.lut;
                    }
                    const m = colorMatrix(s);
                    for (let row = 0; row < 3; row++) gl.uniform4fv(locations[`row${row}`], m.slice(row * 5, row * 5 + 4));
                    gl.uniform3f(locations.offset, m[4], m[9], m[14]);
                    gl.uniform4f(locations.touch, s.smoothing, s.blemish, s.teeth, s.eyes);
                    gl.uniform3f(locations.finish, s.vignette, s.grain, s.lut === 'none' ? 0 : s.lutStrength);
                    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
                    if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) throw new Error('graphics-lost');
                    ctx.drawImage(canvas, 0, 0);
                }
                drawStickers(ctx, s.stickers, width, height);
            }, close,
        };
        api.setLandmarks(null); return api;
    } catch (error) { close(); throw error; }
}
