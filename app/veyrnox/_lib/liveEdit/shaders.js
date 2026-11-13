import { BILATERAL_GLSL } from './bilateral.js';
export const VERTEX = `#version 300 es
in vec2 position; out vec2 uv;
void main(){ uv=vec2((position.x+1.)*.5,(1.-position.y)*.5); gl_Position=vec4(position,0.,1.); }`;
export const FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv; out vec4 outputColor;
uniform sampler2D source; uniform sampler2D mask; uniform sampler2D lut;
uniform vec2 pixel; uniform vec4 row0; uniform vec4 row1; uniform vec4 row2; uniform vec3 offset;
uniform vec4 touch; uniform vec3 finish;
${BILATERAL_GLSL.replaceAll('texture2D', 'texture')}
void main(){
 vec4 original=texture(source,uv); vec3 color=original.rgb; vec3 region=texture(mask,uv).rgb;
 float amount=region.r*touch.x;
 if(amount>0.) color=bilateral(source,uv,pixel,color,amount);
 if(region.r*touch.y>0.) {
   vec3 softened=bilateral(source,uv,pixel*2.,original.rgb,1.);
   float difference=length(softened-original.rgb);
   color=mix(color,softened,region.r*touch.y*smoothstep(.015,.12,difference));
 }
 float hi=max(color.r,max(color.g,color.b)), lo=min(color.r,min(color.g,color.b));
 float light=dot(color,vec3(.2126,.7152,.0722));
 float whitePixels=smoothstep(.3,.7,light)*(1.-smoothstep(.1,.4,hi-lo));
 float whiten=whitePixels*region.g*touch.z;
 color=mix(color,vec3(light),whiten*.65); color+=vec3(whiten*.16+region.b*touch.w*whitePixels*.15);
 vec4 rgba=vec4(color,original.a);
 color=vec3(dot(row0,rgba),dot(row1,rgba),dot(row2,rgba))+offset;
 if(finish.z>0.) {
   vec3 lookup=clamp(color,0.,1.)*(255./256.)+vec3(.5/256.);
   vec3 mapped=vec3(texture(lut,vec2(lookup.r,.5)).r,texture(lut,vec2(lookup.g,.5)).g,texture(lut,vec2(lookup.b,.5)).b);
   color=mix(color,mapped,finish.z);
 }
 color*=1.-finish.x*smoothstep(.2,.7,length(uv-.5));
 // Source-pixel deterministic noise: export and preview are identical.
 float noise=fract(sin(dot(floor(uv/pixel),vec2(12.9898,78.233)))*43758.5453)-.5;
 color+=noise*finish.y*.12;
 outputColor=vec4(clamp(color,0.,1.),original.a);
}`;
