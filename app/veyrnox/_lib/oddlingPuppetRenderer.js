// Local, deterministic pixel puppetry. No inference, uploads or gateway access.
import { puppetPose } from './oddlingPuppetRigs.js';

export const PUPPET_VERTEX_SHADER = `
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = vec2((position.x + 1.0) * 0.5, (1.0 - position.y) * 0.5);
  gl_Position = vec4(position, 0.0, 1.0);
}`;

export const PUPPET_FRAGMENT_SHADER = `
precision highp float;
varying vec2 uv;
uniform sampler2D plate;
uniform sampler2D head;
uniform vec2 size;
uniform vec2 pivot;
uniform vec4 chest;
uniform vec4 arm0;
uniform vec4 arm1;
uniform vec4 lower;
uniform vec4 eye0;
uniform vec4 eye1;
uniform vec3 lid0;
uniform vec3 lid1;
uniform vec4 pose; // blink, breath, angle, nod
uniform vec4 pose2; // arm swing, weight shift, alternating step, torso sway

vec3 eyelid(vec3 color, vec2 point, vec4 eye, vec3 lid) {
  vec2 d = (point - eye.xy) / eye.zw;
  float coverage = (1.0 - smoothstep(1.02, 1.3, length(d))) * pose.x;
  float seamY = 0.12 * d.x * d.x;
  float seam = (1.0 - smoothstep(0.06, 0.19, abs(d.y - seamY)))
    * (1.0 - smoothstep(0.8, 1.0, abs(d.x)));
  return mix(color, mix(lid, lid * 0.42, seam), coverage);
}

void main() {
  vec2 point = uv * size;
  vec2 localChest = (point - chest.xy) / chest.zw;
  float weight = pow(max(0.0, 1.0 - dot(localChest, localChest)), 2.0);
  // Every warp reaches zero at its body-zone boundary, keeping the backdrop fixed.
  vec2 bodyPoint = point - (point - chest.xy) * pose.y * weight;
  bodyPoint -= vec2(pose2.w * 12.0, abs(pose2.z) * 5.0) * weight;

  vec2 localArm0 = (point - arm0.xy) / arm0.zw;
  vec2 localArm1 = (point - arm1.xy) / arm1.zw;
  float armWeight0 = pow(max(0.0, 1.0 - dot(localArm0, localArm0)), 2.0);
  float armWeight1 = pow(max(0.0, 1.0 - dot(localArm1, localArm1)), 2.0);
  float reach0 = 0.45 + 0.55 * smoothstep(-1.0, 1.0, localArm0.y);
  float reach1 = 0.45 + 0.55 * smoothstep(-1.0, 1.0, localArm1.y);
  bodyPoint -= vec2(pose2.x * 26.0 * reach0, abs(pose2.x) * 7.0) * armWeight0;
  bodyPoint -= vec2(-pose2.x * 26.0 * reach1, abs(pose2.x) * 7.0) * armWeight1;

  vec2 localLower = (point - lower.xy) / lower.zw;
  float lowerWeight = pow(max(0.0, 1.0 - dot(localLower, localLower)), 2.0);
  float legSide = smoothstep(-0.18, 0.18, localLower.x) * 2.0 - 1.0;
  bodyPoint -= vec2(pose2.y * 14.0, pose2.z * 10.0 * legSide) * lowerWeight;
  vec3 color = texture2D(plate, bodyPoint / size).rgb;

  float c = cos(pose.z), s = sin(pose.z);
  float neckBlend = smoothstep(0.0, 80.0, pivot.y - point.y);
  vec2 delta = point - pivot - vec2(0.0, pose.w * neckBlend);
  vec2 source = vec2(c * delta.x + s * delta.y, -s * delta.x + c * delta.y) + pivot;
  vec4 face = texture2D(head, source / size);
  vec3 faceColor = eyelid(face.rgb / max(face.a, 0.00392), source, eye0, lid0);
  faceColor = eyelid(faceColor, source, eye1, lid1);
  gl_FragColor = vec4(mix(color, faceColor, face.a), 1.0);
}`;

const smooth = (low, high, value) => {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

// Rebuild only the small area originally occupied by the head from the existing
// studio backdrop's left/right row samples. This is a stationary clean plate,
// not a shifted second copy of the photograph. Source files are never modified.
export function preparePuppetPixels(source, polygon, rig) {
  const { width, height, data } = source;
  const plate = new Uint8Array(data);
  const head = new Uint8Array(data.length);
  const at = (x, y, channel) => data[(Math.max(0, Math.min(height - 1, Math.round(y))) * width
    + Math.max(0, Math.min(width - 1, Math.round(x)))) * 4 + channel];
  const lids = rig.eyes.map(([x, y, , ry]) => rig.shutter ? [0.055, 0.05, 0.045]
    : [0, 1, 2].map((channel) => at(x, y + ry * 2.3, channel) / 255));
  const xs = rig.head.map(([x]) => x), ys = rig.head.map(([, y]) => y);
  const minX = Math.max(0, Math.floor(Math.min(...xs)) - 10);
  const maxX = Math.min(width - 1, Math.ceil(Math.max(...xs)) + 10);
  const minY = Math.max(0, Math.floor(Math.min(...ys)) - 10);
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...ys)) + 10);
  const extents = [];
  for (let y = minY; y <= maxY; y += 1) {
    let left = minX, right = maxX;
    while (left <= right && !polygon[(y * width + left) * 4 + 3]) left++;
    while (right >= left && !polygon[(y * width + right) * 4 + 3]) right--;
    if (left <= right) extents[y] = [left, right];
  }
  // Sample just outside THIS head, not the distant image edges: studio lighting
  // often has a bright centre. Stop above the collar so clothing is not sampled.
  const lastBackgroundRow = Math.max(minY, Math.min(maxY, Math.floor((rig.pivot?.[1] ?? maxY + 75) - 75)));
  for (let y = minY; y <= maxY; y += 1) {
    const row = Math.min(y, lastBackgroundRow);
    const bounds = extents[row] || [width * 0.1, width * 0.9];
    const leftX = Math.max(0, bounds[0] - 22), rightX = Math.min(width - 1, bounds[1] + 22);
    const median = (x, channel) => {
      const samples = Array.from({ length: 9 }, (_, index) => at(x + index - 4, row, channel)).sort((a, b) => a - b);
      return samples[4];
    };
    const left = [0, 1, 2].map((channel) => median(leftX, channel));
    const right = [0, 1, 2].map((channel) => median(rightX, channel));
    for (let x = minX; x <= maxX; x += 1) {
      const index = (y * width + x) * 4;
      const shape = polygon[index + 3] / 255;
      if (!shape) continue;
      const mix = Math.max(0, Math.min(1, (x - leftX) / Math.max(1, rightX - leftX)));
      const bg = left.map((value, channel) => value + (right[channel] - value) * mix);
      const distance = Math.hypot(...bg.map((value, channel) => (data[index + channel] - value) / 255));
      const alpha = shape * smooth(0.045, 0.11, distance);
      if (alpha < 1 / 255) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        plate[index + channel] = Math.round(bg[channel]);
        const foreground = Math.max(0, Math.min(255,
          (data[index + channel] - bg[channel] * (1 - alpha)) / alpha));
        // Premultiplied storage prevents black fringes under linear filtering.
        head[index + channel] = Math.round(foreground * alpha);
      }
      head[index + 3] = Math.round(alpha * 255);
    }
  }
  return { plate, head, lids };
}

export function createOddlingPuppet(canvas, image, id, rig) {
  const gl = canvas.getContext('webgl', { alpha: false, depth: false, antialias: false,
    preserveDrawingBuffer: true, premultipliedAlpha: false });
  if (!gl) throw new Error('puppet_webgl_unavailable');
  const shaders = [], textures = [];
  let program, buffer;
  const destroy = () => {
    textures.forEach((texture) => gl.deleteTexture(texture));
    shaders.forEach((shader) => gl.deleteShader(shader));
    if (buffer) gl.deleteBuffer(buffer);
    if (program) gl.deleteProgram(program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  };
  try {
    for (const [type, text] of [[gl.VERTEX_SHADER, PUPPET_VERTEX_SHADER], [gl.FRAGMENT_SHADER, PUPPET_FRAGMENT_SHADER]]) {
      const shader = gl.createShader(type);
      shaders.push(shader);
      gl.shaderSource(shader, text);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('puppet_shader_failed');
    }
    program = gl.createProgram();
    shaders.forEach((shader) => gl.attachShader(program, shader));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('puppet_link_failed');
    gl.useProgram(program);
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 1, 1, 1, -1, -1, 1, -1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const width = image.naturalWidth, height = image.naturalHeight;
    if (width !== 1024 || height !== 1536) throw new Error('puppet_portrait_dimensions');
    const scratch = document.createElement('canvas');
    scratch.width = width; scratch.height = height;
    const ctx = scratch.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('puppet_canvas_unavailable');
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, width, height);
    ctx.clearRect(0, 0, width, height);
    ctx.beginPath();
    rig.head.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath(); ctx.fill();
    ctx.lineWidth = 12; ctx.lineJoin = 'round'; ctx.stroke();
    const layers = preparePuppetPixels(pixels, ctx.getImageData(0, 0, width, height).data, rig);
    scratch.width = 0; scratch.height = 0;

    for (const [unit, name] of ['plate', 'head'].entries()) {
      const texture = gl.createTexture();
      textures.push(texture);
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, layers[name]);
      gl.uniform1i(gl.getUniformLocation(program, name), unit);
    }
    gl.uniform2f(gl.getUniformLocation(program, 'size'), width, height);
    gl.uniform2fv(gl.getUniformLocation(program, 'pivot'), rig.pivot);
    gl.uniform4fv(gl.getUniformLocation(program, 'chest'), rig.chest);
    rig.arms.forEach((arm, index) => gl.uniform4fv(gl.getUniformLocation(program, `arm${index}`), arm));
    gl.uniform4fv(gl.getUniformLocation(program, 'lower'), rig.lower);
    rig.eyes.forEach((eye, index) => {
      gl.uniform4fv(gl.getUniformLocation(program, `eye${index}`), eye);
      gl.uniform3fv(gl.getUniformLocation(program, `lid${index}`), layers.lids[index]);
    });
    canvas.width = 512; canvas.height = 768;
    gl.viewport(0, 0, canvas.width, canvas.height);
    const poseLocation = gl.getUniformLocation(program, 'pose');
    const pose2Location = gl.getUniformLocation(program, 'pose2');
    let lost = false;
    const onLost = (event) => { event.preventDefault(); lost = true; };
    canvas.addEventListener('webglcontextlost', onLost);
    return {
      render(seconds) {
        if (lost || gl.isContextLost()) return false;
        const pose = puppetPose(seconds, id, rig);
        gl.uniform4f(poseLocation, pose.blink, pose.breath, pose.angle, pose.nod);
        gl.uniform4f(pose2Location, pose.armSwing, pose.weightShift, pose.step, pose.torsoSway);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        const blinkState = pose.blink > 0.9 ? 'closed' : 'open';
        if (canvas.dataset.blinkState !== blinkState) canvas.dataset.blinkState = blinkState;
        const bodyState = pose.step > 0.35 ? 'right-step' : pose.step < -0.35 ? 'left-step' : 'weight-shift';
        if (canvas.dataset.bodyMotionState !== bodyState) canvas.dataset.bodyMotionState = bodyState;
        canvas.dataset.danceState = bodyState;
        return true;
      },
      destroy() { canvas.removeEventListener('webglcontextlost', onLost); destroy(); },
    };
  } catch (error) {
    destroy();
    throw error;
  }
}
