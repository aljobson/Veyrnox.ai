import { SKIN_SMOOTHING as S } from '../../../../packages/live-edit/smoothing.js';
// Lifted from Video Enhance: both renderers use the same edge-preserving kernel.
export const BILATERAL_GLSL = `
vec3 bilateral(sampler2D source, vec2 uv, vec2 pixel, vec3 color, float amount) {
   vec3 sum=vec3(0.); float weights=0.;
   for(int x=-${S.kernelRadius};x<=${S.kernelRadius};x++){ for(int y=-${S.kernelRadius};y<=${S.kernelRadius};y++){
     vec3 sampleColor=texture2D(source,uv+vec2(float(x),float(y))*pixel*${S.sampleStepPixels.toFixed(1)}).rgb;
     vec3 delta=sampleColor-color;
     float weight=exp(-dot(delta,delta)*${S.rangeWeight.toFixed(1)}-float(x*x+y*y)*${S.spatialWeight});
     sum+=sampleColor*weight; weights+=weight;
   }}
   return mix(color,sum/weights,amount*${S.strengthScale});
}`;
