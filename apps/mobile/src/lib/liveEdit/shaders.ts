import { SKIN_SMOOTHING as S } from './smoothing';
// SkSL uses pixel coordinates. Both preview and export consume these same programs.
export const MATRIX = `uniform shader image; uniform float m[20];
half4 main(float2 p) { half4 c=image.eval(p); float3 v=c.a>0. ? c.rgb/c.a : float3(0.);
return half4(clamp(float3(dot(v,float3(m[0],m[1],m[2]))+m[4],dot(v,float3(m[5],m[6],m[7]))+m[9],dot(v,float3(m[10],m[11],m[12]))+m[14]),0.,1.)*c.a,c.a); }`;
const BILATERAL = `float3 blur(float2 p,float3 c) {
 float3 total=float3(0.); float weight=0.;
 for(int y=-${S.kernelRadius};y<=${S.kernelRadius};y++) for(int x=-${S.kernelRadius};x<=${S.kernelRadius};x++) {
  float2 d=float2(float(x),float(y)); float3 s=original.eval(p+d*radius).rgb;
  float3 diff=s-c; float w=exp(-dot(d,d)*${S.spatialWeight}-dot(diff,diff)*${S.rangeWeight.toFixed(1)});
  total+=s*w; weight+=w;
 } return total/max(weight,.00001);
}`;
export const SMOOTH = `uniform shader original; uniform shader mask; uniform float amount; uniform float radius;
${BILATERAL}
half4 main(float2 p) { half4 c=original.eval(p); float a=mask.eval(p).r*amount;
 if(a<=0.) return c; return half4(mix(c.rgb,blur(p,c.rgb),a*${S.strengthScale}),c.a); }`;
export const MAKEUP_SHADER = `uniform shader image; uniform shader original; uniform shader mask;
uniform float amount; uniform float kind; uniform float finish; uniform float3 pigment; uniform float3 second; uniform float radius;
${BILATERAL}
float soft(float b,float s) { float d=b<=.25 ? ((16.*b-12.)*b+4.)*b : sqrt(max(b,0.)); return s<=.5 ? b-(1.-2.*s)*b*(1.-b) : b+(2.*s-1.)*(d-b); }
float3 softLight(float3 b,float3 s) { return float3(soft(b.r,s.r),soft(b.g,s.g),soft(b.b,s.b)); }
half4 main(float2 p) { half4 c=image.eval(p); float2 m=mask.eval(p).rg; float a=m.r*amount;
 if(a<=0.) return c; float3 ink=kind==2. ? mix(pigment,second,m.g) : pigment; float3 target=c.rgb*ink;
 if(kind==0.) target=softLight(blur(p,original.eval(p).rgb),ink);
 if(kind==1.) target=softLight(c.rgb,ink);
 if(kind==6.) { if(finish==0.) target=mix(c.rgb*ink,ink,.65);
 if(finish==1.) { float h=pow(max(0.,1.-abs(m.g-.68)/.22),8.)*.55; target=mix(c.rgb*ink,ink,.4); target=target+h-target*h; }
 if(finish==2.) target=softLight(c.rgb,ink); }
 return half4(mix(c.rgb,target,a),c.a); }`;
export const HAIR_SHADER = `uniform shader image; uniform shader mask;
uniform float amount; uniform float mode; uniform float top; uniform float span; uniform float height;
uniform float3 first; uniform float3 second;
float lin(float v) { return v<=.04045 ? v/12.92 : pow((v+.055)/1.055,2.4); }
float srgb(float v) { return v<=.0031308 ? v*12.92 : 1.055*pow(max(v,0.),1./2.4)-.055; }
float3 linear(float3 v) { return float3(lin(v.r),lin(v.g),lin(v.b)); }
half4 main(float2 p) { half4 c=image.eval(p); float a=smoothstep(.2,.8,mask.eval(p).r)*amount;
 if(a<=0.) return c; float3 weights=float3(.2126,.7152,.0722), base=linear(clamp(c.rgb,0.,1.)); float y=dot(base,weights);
 float g=mode==1. ? smoothstep(.25,.85,(p.y/height-top)/span) : 0.; float3 ink=mix(linear(first),linear(second),g); float3 chroma=ink-dot(ink,weights);
 float gamut=1.; for(int i=0;i<3;i++) { if(chroma[i]>0.) gamut=min(gamut,(1.-y)/chroma[i]); else if(chroma[i]<0.) gamut=min(gamut,-y/chroma[i]); }
 if(mode==2.) a*=smoothstep(.08,.55,y); float3 outColor=mix(base,float3(y)+chroma*gamut,a);
 return half4(float3(srgb(outColor.r),srgb(outColor.g),srgb(outColor.b)),c.a); }`;
