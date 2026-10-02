import { lookSettings } from './videoEnhance.mjs';

const VERTEX = `attribute vec2 position; varying vec2 uv;
void main(){ uv=(position+1.0)*0.5; gl_Position=vec4(position,0.,1.); }`;
const FRAGMENT = `precision mediump float;
varying vec2 uv; uniform sampler2D source; uniform sampler2D mask;
uniform vec2 pixel; uniform float smoothing; uniform vec3 look;
void main(){
 vec4 original=texture2D(source,uv); vec3 color=original.rgb;
 float amount=texture2D(mask,uv).r*smoothing;
 if(amount>0.001){
   vec3 sum=vec3(0.); float weights=0.;
   for(int x=-2;x<=2;x++){ for(int y=-2;y<=2;y++){
     vec3 sampleColor=texture2D(source,uv+vec2(float(x),float(y))*pixel*2.).rgb;
     vec3 delta=sampleColor-color;
     float weight=exp(-dot(delta,delta)*65.-float(x*x+y*y)*0.18);
     sum+=sampleColor*weight; weights+=weight;
   }}
   color=mix(color,sum/weights,amount*0.85);
 }
 float luma=dot(color,vec3(0.2126,0.7152,0.0722));
 color=mix(vec3(luma),color,look.x);
 color=(color-0.5)*look.y+0.5+vec3(look.z,0.,-look.z);
 gl_FragColor=vec4(clamp(color,0.,1.),original.a);
}`;

const OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
const LEFT_EYE = [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246];
const RIGHT_EYE = [263,249,390,373,374,380,381,382,362,398,384,385,386,387,388,466];
const LIPS = [61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185];
const LEFT_BROW = [70,63,105,66,107,55,65,52,53,46];
const RIGHT_BROW = [336,296,334,293,300,276,283,282,295,285];

export function createRenderer(canvas) {
    const gl = canvas.getContext('webgl', { alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('This browser does not support the video preview. Try desktop Chrome.');
    const shaders = [], textures = [];
    let program, buffer, closed = false;
    function close() {
        if (closed) return;
        closed = true;
        textures.forEach(texture => gl.deleteTexture(texture));
        shaders.forEach(shader => gl.deleteShader(shader));
        if (buffer) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    try {
        const compile = (type, code) => {
            const shader = gl.createShader(type); shaders.push(shader);
            gl.shaderSource(shader, code); gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('The video filter could not initialize.');
            return shader;
        };
        program = gl.createProgram();
        gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
        gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('The video filter could not initialize.');
        gl.useProgram(program);
        buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, 'position');
        gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        const locations = Object.fromEntries(['source','mask','pixel','smoothing','look'].map(key => [key, gl.getUniformLocation(program, key)]));
        [0,1].forEach(unit => {
            const texture = gl.createTexture(); textures.push(texture); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        });
        const mask = document.createElement('canvas');
        const ctx = mask.getContext('2d');
        if (!ctx) throw new Error('The video filter could not initialize.');
        function polygon(points, indices, expansion = 1) {
            const center = indices.reduce((a, i) => ({ x: a.x + points[i].x / indices.length, y: a.y + points[i].y / indices.length }), {x:0,y:0});
            ctx.beginPath();
            indices.forEach((index, i) => {
                const x = (center.x + (points[index].x - center.x) * expansion) * mask.width;
                const y = (center.y + (points[index].y - center.y) * expansion) * mask.height;
                if (i) ctx.lineTo(x,y); else ctx.moveTo(x,y);
            });
            ctx.closePath(); ctx.fill();
        }
        return {
            draw(video, faces, settings) {
                if (closed || gl.isContextLost()) throw new Error('The video preview lost graphics access. Choose the video again to retry.');
                const width = video.videoWidth ?? video.width, height = video.videoHeight ?? video.height;
                if (canvas.width !== width || canvas.height !== height) {
                    canvas.width = mask.width = width;
                    canvas.height = mask.height = height;
                }
                ctx.filter = 'none'; ctx.fillStyle = 'black'; ctx.fillRect(0,0,mask.width,mask.height);
                // Clear on every frame: no face or multiple faces never reuses an old mask.
                if (faces.length === 1) {
                    ctx.filter = `blur(${Math.max(2, mask.width / 200)}px)`;
                    ctx.fillStyle = 'white'; polygon(faces[0], OVAL, 0.92);
                    ctx.fillStyle = 'black';
                    for (const region of [LEFT_EYE,RIGHT_EYE,LIPS,LEFT_BROW,RIGHT_BROW]) polygon(faces[0], region, 1.5);
                }
                gl.viewport(0,0,canvas.width,canvas.height);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
                [video,mask].forEach((input, unit) => {
                    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D,textures[unit]);
                    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,input);
                });
                gl.uniform1i(locations.source,0); gl.uniform1i(locations.mask,1);
                gl.uniform2f(locations.pixel,1/canvas.width,1/canvas.height);
                gl.uniform1f(locations.smoothing,Math.max(0,Math.min(100,settings.smoothing))/100);
                const look = lookSettings(settings.look, settings.intensity);
                gl.uniform3f(locations.look,look.saturation,look.contrast,look.warmth);
                gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
                if (gl.isContextLost()) throw new Error('The video preview lost graphics access. Choose the video again to retry.');
            },
            close,
        };
    } catch (error) { close(); throw error; }
}
