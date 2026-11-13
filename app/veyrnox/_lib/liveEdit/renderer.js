import { createWigLayer } from './wigLayer.js';
import { normalize } from './settings.js';
import { hairTexture, hairRgb } from '../../../../packages/live-edit/hair.js';
import { MAKEUP, rgb } from '../../../../packages/live-edit/makeup.js';
import { createMakeupMasks } from './makeupMasks.js';
import { VERTEX, FRAGMENT } from './shaders.js';
import { createFaceMask } from './masks.js';
import { colorMatrix, toneLut, EFFECTS } from '../../../../packages/live-edit/effects.js';
import { drawStickers } from '../../../../packages/live-edit/stickers.js';

/** One full-resolution pipeline for preview and export; no page WASM. */
export function createPhotoRenderer(output, source, { onWigChange = () => {}, onWig = () => {} } = {}) {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('graphics-unavailable');
    const ctx = output.getContext('2d');
    const shaders = [], textures = [];
    let program, buffer, landmarks, makeupKey, hairMask, wigLayer, wigMask, wigKey, wigStatus, wigApplied = false, closed = false;
    function close() {
        if (closed) return;
        closed = true; wigLayer?.close(); wigMask = null; landmarks = undefined; makeupKey = undefined; hairMask = null;
        textures.forEach(t => gl.deleteTexture(t)); shaders.forEach(s => gl.deleteShader(s));
        if (buffer) gl.deleteBuffer(buffer); if (program) gl.deleteProgram(program);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        canvas.width = canvas.height = output.width = output.height = 1;
    }
    try {
        const width = source.videoWidth || (source.naturalWidth ?? source.width), height = source.videoHeight || (source.naturalHeight ?? source.height);
        const bound = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), ...gl.getParameter(gl.MAX_VIEWPORT_DIMS));
        if (!ctx || Math.max(width, height) > bound) throw new Error('photo-too-large');
        wigLayer = createWigLayer(width, height, onWigChange);
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
        const locations = Object.fromEntries(['source','mask','lut','pixel','row0','row1','row2','offset','touch','finish','makeupMask','makeupStrength[0]','makeupColor[0]','shadowSecond','lipFinish','hairMask','hairColor','hairSecond','hairParams','wigImage','wigOpacity'].map(k => [k, gl.getUniformLocation(program, k)]));
        for (let unit = 0; unit < 3; unit++) {
            const texture = gl.createTexture(); textures.push(texture); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        }
        const makeupTexture = gl.createTexture(); textures.push(makeupTexture);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D_ARRAY, makeupTexture);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.uniform1i(locations.makeupMask, 3);
        const hairGlTexture = gl.createTexture(); textures.push(hairGlTexture);
        gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, hairGlTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.uniform1i(locations.hairMask, 4);
        const wigTexture = gl.createTexture(); textures.push(wigTexture);
        gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, wigTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        gl.uniform1i(locations.wigImage, 5);
        function upload(unit, input) {
            gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, textures[unit]);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, input);
        }
        upload(0, source);
        gl.uniform1i(locations.source, 0); gl.uniform1i(locations.mask, 1); gl.uniform1i(locations.lut, 2);
        gl.uniform2f(locations.pixel, 1 / width, 1 / height); gl.viewport(0, 0, width, height);
        let lutKind, mask;
        const api = {
            /** Live sources (a playing <video>): upload the current frame. Stills never call this. */
            updateSource() {
                if (closed || gl.isContextLost()) throw new Error('graphics-lost');
                upload(0, source);
            },
            prepareWig(settings) {
                const wig = normalize(settings).wig;
                return wig.strength > 0 ? wigLayer.prepare(wig.style) : Promise.resolve();
            },
            setHairMask(value) {
                hairMask = null; wigMask = null; wigLayer.invalidate();
                if (closed || gl.isContextLost()) throw new Error('graphics-lost');
                hairMask = hairTexture(value);
                gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, hairGlTexture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, hairMask?.width ?? 1, hairMask?.height ?? 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, hairMask?.data ?? new Uint8Array(4));
                if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) { hairMask = null; throw new Error('graphics-lost'); }
                wigMask = hairMask ? value : null;
                return Boolean(hairMask);
            },
            setLandmarks(points) {
                landmarks = points?.slice(); makeupKey = undefined; wigLayer.invalidate();
                if (landmarks?.length !== 1434) api.setHairMask(null);
                mask = createFaceMask(width, height, points); upload(1, mask);
                mask.width = mask.height = 1;
            },
            /** Whether the last draw actually composited a wig (export uses this to say when a chosen wig was left out). */
            wigApplied() { return wigApplied; },
            // quiet: a hold-to-compare draw (no wig by design) must not announce "wig off" to assistive technology.
            draw(settings, { quiet = false } = {}) {
                if (closed || gl.isContextLost()) throw new Error('graphics-lost');
                const s = normalize(settings);
                const wig = wigLayer.render(s.wig, landmarks, wigMask);
                wigApplied = wig.active;
                if (wigStatus !== wig.status) { wigStatus = wig.status; if (!quiet) onWig(wig.status); }
                gl.uniform1f(locations.wigOpacity, wig.active ? wig.opacity : 0);
                if (wig.active && wigKey !== wig.key) {
                    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, wigTexture);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, wig.image); wigKey = wig.key;
                }
                const makeupActive = landmarks?.length === 1434 && MAKEUP.some(e => s.makeup[e.id].strength > 0);
                const hairActive = landmarks?.length === 1434 && hairMask && s.hair.strength > 0;
                const neutral = !wig.active && !hairActive && !makeupActive && EFFECTS.every(e => s[e.id] === 0) && (s.look === 'original' || s.strength === 0) && (s.lut === 'none' || s.lutStrength === 0);
                ctx.clearRect(0, 0, width, height);
                if (neutral) ctx.drawImage(source, 0, 0);
                else {
                    gl.uniform3fv(locations.hairColor, hairRgb(s.hair.shade));
                    gl.uniform3fv(locations.hairSecond, hairRgb(s.hair.shade2));
                    gl.uniform4f(locations.hairParams, (hairActive || wig.active) ? s.hair.strength : 0, ['solid', 'ombre', 'highlights'].indexOf(s.hair.mode), hairMask?.top ?? 0, hairMask?.span ?? 1);
                    const key = `${s.makeup.eyeliner.wing}:${s.makeup.lashes.volume}`;
                    if (makeupKey !== key) {
                        const masks = createMakeupMasks(width, height, landmarks, s.makeup);
                        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D_ARRAY, makeupTexture);
                        gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, masks.width, masks.height, MAKEUP.length, 0, gl.RGBA, gl.UNSIGNED_BYTE, masks.data);
                        makeupKey = key;
                    }
                    gl.uniform1fv(locations['makeupStrength[0]'], MAKEUP.map(e => s.makeup[e.id].strength));
                    gl.uniform3fv(locations['makeupColor[0]'], MAKEUP.flatMap(e => rgb(s.makeup[e.id].shade)));
                    gl.uniform3fv(locations.shadowSecond, rgb(s.makeup.eyeshadow.shade2));
                    gl.uniform1i(locations.lipFinish, ['matte', 'gloss', 'tint'].indexOf(s.makeup.lips.finish));
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
