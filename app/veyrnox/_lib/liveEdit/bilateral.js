// Lifted from Video Enhance: both renderers use the same edge-preserving kernel.
export const BILATERAL_GLSL = `
vec3 bilateral(sampler2D source, vec2 uv, vec2 pixel, vec3 color, float amount) {
   vec3 sum=vec3(0.); float weights=0.;
   for(int x=-2;x<=2;x++){ for(int y=-2;y<=2;y++){
     vec3 sampleColor=texture2D(source,uv+vec2(float(x),float(y))*pixel*2.).rgb;
     vec3 delta=sampleColor-color;
     float weight=exp(-dot(delta,delta)*65.-float(x*x+y*y)*0.18);
     sum+=sampleColor*weight; weights+=weight;
   }}
   return mix(color,sum/weights,amount*0.85);
}`;
